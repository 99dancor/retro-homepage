'use strict';
// Farming Hub ↔ Spiel (Mod „FS25 Hub Link“ ab 3.0, games/fs25-export/FS25_FarmingHubExport/FarmingHubLive.lua).
//
// Das Spiel kann keine Website aufrufen. Die Mod schreibt deshalb farmingHubLive.xml (Aufgaben ihres Produktionsberaters,
// ihre Einstellungen, welche Inbox sie zuletzt gelesen hat), und der Hub legt farmingHubInbox.xml daneben (Einstellungen,
// offene Aufgaben und Notizen der Website). Beide liegen per FTP in modSettings/FS25_FarmingHubExport/<savegameN>, also
// neben dem Spielstand-Ordner, den die Seitenverwaltung eingetragen hat. Der Abruf läuft öfter als der große FTP-Abruf
// (Vorgabe alle 45 Sekunden) und holt nur diese eine kleine Datei.
//
// Aufgaben aus dem Spiel werden zu normalen Aufgaben des Hofs (source 'game', fester Schlüssel game_key). Behebt jemand das
// Problem im Spiel, hakt der Hub sie selbst ab. Hakt jemand sie im Hub ab, solange das Problem noch besteht, gilt das als
// „gesehen“: Sie kommt erst wieder, wenn das Problem einmal weg war. Aufgaben mit source 'game' gehen nie zurück in die
// Inbox, damit nichts im Kreis läuft.
//
// Abhaken im Spiel (Overlay ab Mod 3.1): Die Live-Datei listet unter <done> jede Meldung und jede Hub-Aufgabe, die jemand im
// Spiel abgehakt hat, mit eigener Nummer. Der Hub hakt sie ab (Meldung: wie „gesehen“, Hub-Aufgabe: wie auf der Website,
// regelmäßige bekommen die nächste Runde) und bestätigt die Nummern in der Inbox unter <doneAck>. Jede Nummer zählt nur einmal.
//
// Einstellungen (fs_live_settings): Export an/aus, Produktionsberater an/aus und je Hof Prüfungen und Schwellen. Jede
// Änderung zählt rev hoch, die höhere Nummer gewinnt (Hub oder Konsole im Spiel).
const path = require('node:path');
const { Readable } = require('node:stream');
const crypto = require('node:crypto');
const { db, now, getSetting, setSetting, tx } = require('./db');
const X = require('./fsxml');
const N = require('./fsnames');
const feeds = require('./fsfeeds');

const MOD_DIR = 'FS25_FarmingHubExport';
const LIVE = 'farmingHubLive.xml';
const INBOX = 'farmingHubInbox.xml';
const EVERY = 45, MIN = 20;
// Prüfungen je Hof mit Vorgabe (wie FarmingHubLive.FARM_KEYS in der Mod)
const FARM_KEYS = {
  input: true, inputHours: 6, inputPct: 10, output: true, outputPct: 85, pallets: true, stall: true, stallPct: 15, stallFullPct: 85, silo: true, siloPct: 90,
};
const LIMITS = { inputHours: [1, 240], inputPct: [1, 90], outputPct: [10, 100], stallPct: [1, 90], stallFullPct: [10, 100], siloPct: [10, 100] };
const KINDS = {
  input: '⏳ Eingang läuft leer', stopped: '⛔ Produktion steht', output: '📦 Ausgang voll', blocked: '🚧 Paletten-Ausgang blockiert',
  food: '🌾 Futter knapp', supply: '💧 Stall: knapp', product: '🪣 Stall: voll', pallets: '🚧 Stall: kein Palettenplatz', silo: '🏚 Silo voll',
};
// Push nur, wenn wirklich etwas steht, und nur an den, der für diese Stelle zuständig ist
const PUSH = new Set(['stopped', 'blocked']);

// ---------- Einstellungen ----------
function json(key, fallback) { try { return JSON.parse(getSetting(key, '') || 'null') || fallback; } catch { return fallback; } }
function settings() {
  const s = json('fs_live_settings', {});
  return { rev: Number(s.rev) || 0, export: s.export !== false, advisor: s.advisor !== false, farms: s.farms && typeof s.farms === 'object' ? s.farms : {} };
}
function farmSettings(id, s = settings()) {
  const own = s.farms[String(id)] || {};
  const out = {};
  for (const [k, d] of Object.entries(FARM_KEYS)) out[k] = own[k] === undefined || own[k] === null ? d : own[k];
  return out;
}
function storeSettings(s) { setSetting('fs_live_settings', JSON.stringify(s)); }
function bump(s) { s.rev = Math.max(s.rev, Number(state().settingsRev) || 0) + 1; return s; }
// Seitenverwaltung: Export und Produktionsberater global
function saveGlobal(b) {
  const s = settings();
  s.export = b.export === '1' || b.export === true;
  s.advisor = b.advisor === '1' || b.advisor === true;
  storeSettings(bump(s));
}
// Hof-Reiter „Aufgaben“: Prüfungen und Schwellen eines Hofs
function saveFarm(id, b) {
  const s = settings(), f = {};
  for (const [k, d] of Object.entries(FARM_KEYS)) {
    if (typeof d === 'boolean') f[k] = b[k] === '1';
    else {
      const [lo, hi] = LIMITS[k];
      const v = Number(String(b[k] ?? '').replace(',', '.'));
      f[k] = Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v * 10) / 10)) : d;
    }
  }
  s.farms[String(Number(id))] = f;
  storeSettings(bump(s));
}

// ---------- Zustand ----------
function state() { return json('fs_live_state', {}); }
function setState(patch) { const s = { ...state(), ...patch }; setSetting('fs_live_state', JSON.stringify(s)); return s; }
const enabled = () => getSetting('fs_live_on', '1') === '1' && !!feeds.ftpConfig().host;
function interval() { const v = Math.round(Number(getSetting('fs_int_live', ''))); return Math.max(MIN, Number.isFinite(v) && v > 0 ? v : EVERY); }
// Austausch-Ordner: von Hand eingetragen, sonst neben dem Spielstand-Ordner (/profile/savegame2 → /profile/modSettings/FS25_FarmingHubExport/savegame2)
function dir() {
  const own = (getSetting('fs_live_dir', '') || '').trim();
  if (own) return own;
  const sg = feeds.ftpConfig().dir.replace(/\/+$/, '') || '/';
  const name = path.posix.basename(sg) || 'savegame1';
  return path.posix.join(path.posix.dirname(sg), 'modSettings', MOD_DIR, name);
}

// ---------- Datei der Mod lesen ----------
function read(xml) {
  const s = X.parse(xml);
  if (s.n !== 'farmingHubLive') throw new Error('Keine farmingHubLive.xml.');
  const num = (v, d = null) => X.num(v, d);
  const st = X.kid(s, 'settings');
  const settingsOf = node => {
    if (!node) return null;
    const farms = {};
    for (const f of X.kids(node, 'farm')) {
      const id = num(f.a.id);
      if (!id) continue;
      const o = {};
      for (const [k, d] of Object.entries(FARM_KEYS)) if (f.a[k] !== undefined) o[k] = typeof d === 'boolean' ? f.a[k] === 'true' : num(f.a[k], d);
      farms[String(id)] = o;
    }
    return { rev: num(node.a.rev, 0), export: node.a.export !== 'false', advisor: node.a.advisor !== 'false', farms };
  };
  const tasks = X.kids(X.kid(s, 'tasks'), 'task').map(t => ({
    key: t.a.key || '', kind: t.a.kind || '', farm: num(t.a.farm, 0), uid: t.a.uid || '', name: t.a.name || '', fill: t.a.fill || '', fillTitle: t.a.fillTitle || '',
    sev: num(t.a.sev, 2), level: num(t.a.level), cap: num(t.a.cap), pct: num(t.a.pct), hours: num(t.a.hours),
  })).filter(t => t.key && t.farm > 0);
  const done = X.kids(X.kid(s, 'done'), 'item').map(d => ({
    id: d.a.id || '', game: d.a.game || '', task: num(d.a.task), by: (d.a.by || '').slice(0, 60), farm: num(d.a.farm, 0),
  })).filter(d => d.id && (d.game || d.task));
  return { version: num(s.a.version, 1), mod: s.a.mod || '', seq: num(s.a.seq, 0), ack: num(s.a.ack, 0), saveDir: s.a.saveDir || '', mapTitle: s.a.mapTitle || '',
    time: s.a.time || '', day: num(s.a.day), minute: num(s.a.minute), settings: settingsOf(st), tasks, done };
}

// ---------- Titel auf Deutsch ----------
// Name eines Gebäudes: wie im Hub (Hof-Gebäude, deutsche Namen), sonst der Name aus dem Spiel
function placeName(t, names) {
  return (names && names.get(t.uid)) || require('./fsprod').germanBuilding(t.name) || t.name || 'Gebäude';
}
// Ware: über den Namen (MILK → Milch), Stallanzeigen kommen nur mit Titel in der Sprache des Servers („Liquid Manure“)
function goodName(t) {
  if (t.fill && N.FILL[t.fill]) return N.FILL[t.fill];
  const k = String(t.fillTitle || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (k && N.FILL[k]) return N.FILL[k];
  return t.fillTitle || (t.fill ? N.fill(t.fill) : '');
}
const pct = v => (v === null || v === undefined ? '' : `${Math.round(v)} %`);
function duration(h) {
  if (h === null || h === undefined) return '';
  if (h < 1) return 'unter 1 Stunde';
  if (h < 48) return `${Math.round(h)} ${Math.round(h) === 1 ? 'Stunde' : 'Stunden'}`;
  return `${Math.round(h / 24)} Tage`;
}
function titleOf(t, names) {
  const place = placeName(t, names), good = goodName(t);
  switch (t.kind) {
    case 'input': return t.hours !== null ? `${place}: ${good} reicht noch ${duration(t.hours)}` : `${place}: ${good} fast leer (${pct(t.pct)})`;
    case 'stopped': return `${place} steht: ${good || 'Zutat'} fehlt`;
    case 'output': return t.pct >= 99 ? `${place}: ${good} voll` : `${place}: ${good} fast voll (${pct(t.pct)})`;
    case 'blocked': return `${place}: Paletten-Ausgang blockiert${good ? ` (${good})` : ''}`;
    case 'food': return t.pct < 1 ? `${place}: Futter leer` : `${place}: Futter knapp (${pct(t.pct)})`;
    case 'supply': return t.pct < 1 ? `${place}: ${good} leer` : `${place}: ${good} knapp (${pct(t.pct)})`;
    case 'product': return t.pct >= 99 ? `${place}: ${good} voll` : `${place}: ${good} fast voll (${pct(t.pct)})`;
    case 'pallets': return `${place}: kein Platz für neue Paletten`;
    case 'silo': return `${place}: ${good || 'Lager'} fast voll (${pct(t.pct)})`;
    default: return `${place}: ${good || t.kind}`;
  }
}
function noteOf(t) {
  const l = n => Math.round(n).toLocaleString('de-DE');
  const bits = [KINDS[t.kind] ? KINDS[t.kind].replace(/^\S+\s/, '') : 'Meldung aus dem Spiel'];
  if (t.level !== null && t.cap) bits.push(`${l(t.level)} von ${l(t.cap)} l`);
  if (t.kind === 'input' && t.hours !== null) bits.push('Reichweite in Spielstunden bei laufender Produktion');
  return bits.join(' · ');
}

// ---------- Aufgaben abgleichen ----------
// list: Aufgaben aus der Live-Datei (alle offenen Probleme). Gibt die neu angelegten Aufgaben zurück.
function syncTasks(list, names = null) {
  const keys = new Set(list.map(t => t.key));
  const made = [];
  tx(() => {
    for (const t of list) {
      const title = titleOf(t, names).slice(0, 120), note = noteOf(t);
      const open = db.prepare("SELECT id FROM fs_tasks WHERE source = 'game' AND game_key = ? AND done_at IS NULL ORDER BY id DESC").get(t.key);
      if (open) {
        db.prepare('UPDATE fs_tasks SET title = ?, note = ?, game_open = 1, game_kind = ? WHERE id = ?').run(title, note, t.kind, open.id);
        continue;
      }
      // Im Hub abgehakt, im Spiel noch nicht behoben: nicht neu anlegen
      if (db.prepare("SELECT 1 FROM fs_tasks WHERE source = 'game' AND game_key = ? AND game_open = 1").get(t.key)) continue;
      // Wer zuletzt für diese Stelle zuständig war, ist es wieder
      const prev = db.prepare("SELECT assignee_id FROM fs_tasks WHERE source = 'game' AND game_key = ? AND assignee_id IS NOT NULL ORDER BY id DESC").get(t.key);
      const id = Number(db.prepare(`INSERT INTO fs_tasks(farm_id, title, note, assignee_id, repeat, repeat_n, source, game_key, game_open, game_kind, created_at)
        VALUES (?, ?, ?, ?, '', 1, 'game', ?, 1, ?, ?)`).run(t.farm, title, note, prev ? prev.assignee_id : null, t.key, t.kind, now()).lastInsertRowid);
      made.push({ id, farm: t.farm, title, kind: t.kind, assignee_id: prev ? prev.assignee_id : null });
    }
    // Im Spiel behoben: offene abhaken, „gesehen“ vergessen
    for (const r of db.prepare("SELECT id, game_key, done_at FROM fs_tasks WHERE source = 'game' AND game_open = 1").all()) {
      if (keys.has(r.game_key)) continue;
      db.prepare('UPDATE fs_tasks SET game_open = 0, done_at = COALESCE(done_at, ?) WHERE id = ?').run(now(), r.id);
    }
  });
  for (const m of made) {
    if (!m.assignee_id || !PUSH.has(m.kind)) continue;
    require('./notify').send(m.assignee_id, 'fshub', { key: 'fs-game-' + m.id, title: '🚜 Aus dem Spiel', body: m.title, url: `/farming/hof/${m.farm}?tab=aufgaben` });
  }
  return made;
}
// Ohne Mod-Verbindung (Spielstand gewechselt, Mod entfernt) bleiben die Aufgaben stehen; das Abhaken übernimmt dann der Mensch
function openGameTasks(farmId) {
  return db.prepare("SELECT * FROM fs_tasks WHERE source = 'game' AND done_at IS NULL AND farm_id = ?").all(Number(farmId));
}

// ---------- Inbox für die Mod ----------
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\r?\n/g, '&#10;');
const attr = (k, v) => (v === null || v === undefined || v === '' ? '' : ` ${k}="${esc(v)}"`);
function settingsXml(s) {
  const farms = Object.keys(s.farms).map(Number).filter(Boolean).sort((a, b) => a - b).map(id => {
    const f = farmSettings(id, s);
    return `    <farm id="${id}"${Object.entries(f).map(([k, v]) => attr(k, typeof v === 'boolean' ? String(v) : String(v))).join('')}/>`;
  });
  return `  <settings rev="${s.rev}" export="${s.export}" advisor="${s.advisor}">\n${farms.join('\n')}${farms.length ? '\n' : ''}  </settings>`;
}
// Inhalt ohne Laufnummer (zum Vergleichen): Einstellungen, offene Hub-Aufgaben (nie die aus dem Spiel), Notizen, „gesehen“
function inboxBody() {
  const hub = require('./fshub');
  const tasks = db.prepare(`SELECT t.*, a.username AS assignee, a.display_name AS assignee_display FROM fs_tasks t LEFT JOIN users a ON a.id = t.assignee_id
    WHERE t.done_at IS NULL AND COALESCE(t.source, '') <> 'game' ORDER BY t.farm_id, t.id LIMIT 200`).all();
  const notes = db.prepare(`SELECT n.id, n.body, u.username, u.display_name FROM fs_notes n LEFT JOIN users u ON u.id = n.user_id
    ORDER BY n.created_at DESC, n.id DESC LIMIT 20`).all();
  const seen = db.prepare("SELECT DISTINCT game_key FROM fs_tasks WHERE source = 'game' AND game_open = 1 AND done_at IS NOT NULL ORDER BY game_key").all();
  const acked = (state().doneSeen || []).slice(-50);
  return [
    settingsXml(settings()),
    `  <tasks>\n${tasks.map(t => `    <task id="${t.id}" farm="${t.farm_id || 0}"${attr('title', t.title)}${attr('note', t.note && t.note.slice(0, 300))}${attr('due', hub.dueLabel(t))}${attr('assignee', t.assignee_display || t.assignee)}${attr('field', t.field)}/>`).join('\n')}\n  </tasks>`,
    `  <notes>\n${notes.map(n => `    <note id="${n.id}"${attr('by', n.display_name || n.username || '')}${attr('text', String(n.body).slice(0, 500))}/>`).join('\n')}\n  </notes>`,
    `  <dismissed>\n${seen.map(r => `    <game${attr('key', r.game_key)}/>`).join('\n')}\n  </dismissed>`,
    `  <doneAck>\n${acked.map(id => `    <d${attr('id', id)}/>`).join('\n')}\n  </doneAck>`,
  ].join('\n');
}
function inboxXml(seq, body = inboxBody()) {
  return `<?xml version="1.0" encoding="utf-8" standalone="no"?>\n<farmingHubInbox version="1" seq="${seq}" at="${now()}">\n${body}\n</farmingHubInbox>\n`;
}

// ---------- Live-Datei anwenden ----------
function names() {
  try {
    const m = require('./fshub').model();
    return new Map(m.farms.flatMap(f => f.buildings.filter(b => b.uid).map(b => [b.uid, b.name])));
  } catch { return new Map(); }
}
// Im Spiel abgehakt: jede Nummer einmal. Gibt die Anzahl neu übernommener Einträge zurück.
function applyDone(list) {
  const seen = state().doneSeen || [];
  const known = new Set(seen);
  let n = 0;
  // ohne tx: completeTask hat ihre eigene
  {
    for (const d of list || []) {
      if (known.has(d.id)) continue;
      known.add(d.id); seen.push(d.id);
      if (d.game) {
        const t = db.prepare("SELECT id FROM fs_tasks WHERE source = 'game' AND game_key = ? AND done_at IS NULL ORDER BY id DESC").get(d.game);
        if (t) { db.prepare('UPDATE fs_tasks SET done_at = ?, done_game_by = ? WHERE id = ?').run(now(), d.by || '', t.id); n++; }
      } else if (d.task) {
        const t = db.prepare("SELECT id, farm_id, done_at FROM fs_tasks WHERE id = ? AND COALESCE(source, '') <> 'game'").get(d.task);
        // Nur Aufgaben des Hofs, zu dem der Spieler gehört (oder für alle Höfe)
        if (!t || t.done_at || (t.farm_id && d.farm && t.farm_id !== d.farm)) continue;
        require('./fshub').completeTask(t.id, { id: null });
        db.prepare('UPDATE fs_tasks SET done_game_by = ? WHERE id = ?').run(d.by || '', t.id);
        n++;
      }
    }
  }
  setState({ doneSeen: seen.slice(-200) });
  return n;
}
function apply(live) {
  // Einstellungen: die höhere Nummer gewinnt (hubSet in der Konsole)
  if (live.settings && live.settings.rev > settings().rev) storeSettings(live.settings);
  applyDone(live.done);
  // Produktionsberater aus: die Mod meldet nichts, alles Offene wird abgehakt
  const made = syncTasks(live.tasks, names());
  setState({ seq: live.seq, ack: live.ack, mod: live.mod, saveDir: live.saveDir, mapTitle: live.mapTitle, time: live.time, at: now(), settingsRev: live.settings ? live.settings.rev : 0,
    problems: live.tasks.length });
  return made;
}

// ---------- FTP ----------
let running = false, nextAt = 0, timer = null;
async function run({ force = false } = {}) {
  if (running || !enabled()) return state();
  running = true;
  const d = dir();
  let st = state();
  if (st.dir !== d) st = setState({ dir: d, seq: 0, ack: 0, sig: '', at: null, inboxSeq: 0, inboxHash: '', uploadedAt: null, mod: '', problems: 0 });
  try {
    const client = await feeds.ftpConnect(feeds.ftpConfig());
    try {
      let list = [];
      try { list = await client.list(d); } catch { list = []; }
      const f = list.find(x => x.isFile && x.name === LIVE);
      if (f) {
        const sig = `${f.size}:${f.rawModifiedAt || ''}`;
        if (force || sig !== st.sig) {
          const live = read((await feeds.fetchFile(client, path.posix.join(d, LIVE))).toString('utf8'));
          if (force || live.seq !== st.seq) apply(live);
          st = setState({ sig });
        }
      }
      // Inbox: nur hochladen, wenn sich etwas geändert hat, oder die Mod sie nach 5 Minuten noch nicht bestätigt hat
      const body = inboxBody(), hash = crypto.createHash('sha1').update(body).digest('hex');
      st = state();
      const stale = st.inboxSeq && (st.ack || 0) < st.inboxSeq && (!st.uploadedAt || now() - st.uploadedAt > 300);
      if (force || hash !== st.inboxHash || stale) {
        // Laufnummer = Uhrzeit beim Ändern: steigt immer, auch nach einem Backup oder Neustart
        const seq = hash !== st.inboxHash || !st.inboxSeq ? Math.max(now(), (Number(st.inboxSeq) || 0) + 1) : st.inboxSeq;
        await client.ensureDir(d);
        await client.uploadFrom(Readable.from([Buffer.from(inboxXml(seq, body), 'utf8')]), path.posix.join(d, INBOX));
        setState({ inboxSeq: seq, inboxHash: hash, uploadedAt: now() });
      }
    } finally { client.close(); }
    setState({ error: null, tried: now() });
  } catch (e) {
    setState({ error: String(e && e.message || e).slice(0, 200), tried: now() });
  } finally {
    running = false;
    nextAt = Date.now() + interval() * 1000;
  }
  return state();
}
function soon() { nextAt = 0; }
function start() {
  if (timer) return;
  timer = setInterval(() => { if (enabled() && Date.now() >= nextAt) run(); }, 5000);
  timer.unref();
}

// Für Seitenverwaltung und Hof: verbunden, wenn die Mod in den letzten 5 Minuten etwas Neues geschrieben hat
function status() {
  const st = state(), s = settings();
  const fresh = !!st.at && now() - st.at < 300;
  return { on: enabled(), dir: dir(), connected: fresh, at: st.at || null, mod: st.mod || '', problems: st.problems || 0, error: st.error || null, tried: st.tried || null,
    inboxSeq: st.inboxSeq || 0, ack: st.ack || 0, export: s.export, advisor: s.advisor, interval: interval() };
}

module.exports = { FARM_KEYS, LIMITS, KINDS, MOD_DIR, LIVE, INBOX, settings, farmSettings, saveGlobal, saveFarm, read, titleOf, syncTasks, openGameTasks, applyDone,
  inboxBody, inboxXml, apply, dir, run, soon, start, status, enabled, interval };
