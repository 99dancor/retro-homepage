'use strict';
// Link-Vorschläge: Mitglieder schlagen Links vor (Musik, Videos, Playlists, Dateien, Privat), der Admin prüft und
// genehmigt, JDownloader (src/jdownloader.js) lädt nur, was die Regeln erlauben, und die Seite sortiert es ein.
//
// Ablauf: new → checking (Linksammler löst auf, nichts wird geladen) → checked (Vorschau mit Haken) → queued (nur die
// gewählten Links in der Downloadliste, Rest verworfen) → loading → sorting (Dateien abholen, prüfen, einsortieren) → done.
// Daneben: rejected (abgelehnt), withdrawn (zurückgezogen), failed (Fehler oder abgebrochen).
//
// Zuordnung zu JDownloader: Jeder Vorschlag bekommt einen eigenen Zielordner <jd_out>/hp-<id>. Pakete im Linksammler
// und in der Downloadliste erkennt die Seite an diesem Ordner, fertige Dateien holt sie aus JD_DIR/hp-<id> ab.
const fs = require('node:fs');
const path = require('node:path');
const dns = require('node:dns').promises;
const net = require('node:net');
const { db, now, getSetting, setSetting, tx, MUSIC_DIR, UPLOAD_DIR, JD_DIR } = require('./db');
const jd = require('./jdownloader');

const KINDS = {
  musik: { icon: '🎵', label: 'Musik', hint: 'Song oder Album, nur der Ton' },
  video: { icon: '🎬', label: 'Video', hint: 'einzelnes Video' },
  playlist: { icon: '📋', label: 'Playlist', hint: 'wird eine eigene Playlist im Mediaplayer' },
  datei: { icon: '📦', label: 'Datei', hint: 'Spielstand, Mod, Archiv, PDF … in die Downloads' },
  privat: { icon: '🔞', label: 'Privat', hint: 'nur im abgetrennten Bereich Privat' },
};
const STATUS = {
  new: ['🆕', 'Vorgeschlagen'], checking: ['🔍', 'Wird geprüft'], checked: ['📋', 'Geprüft, wartet auf Freigabe'],
  queued: ['⏳', 'Genehmigt, wartet auf JDownloader'], loading: ['⬇️', 'Lädt'], sorting: ['🗂️', 'Wird einsortiert'],
  done: ['✅', 'Fertig'], rejected: ['⛔', 'Abgelehnt'], withdrawn: ['↩️', 'Zurückgezogen'], failed: ['⚠️', 'Fehlgeschlagen'],
};
const OPEN = ['new', 'checking', 'checked'];
const ACTIVE = ['queued', 'loading', 'sorting'];
const GB = 1024 ** 3;

// ---------- Regeln (Seitenverwaltung → Downloads → Regeln) ----------
const DEFAULT_RULES = {
  musik: { order: ['m4a', 'opus', 'mp3'], ext: 'mp3 m4a aac opus ogg oga flac wav' },
  video: { order: ['mp4', 'webm'], maxRes: 1080, ext: 'mp4 m4v webm' },
  datei: { ext: 'zip 7z rar pdf txt jpg jpeg png gif webp xml json sav mp3 m4a mp4 webm', maxGb: 20 },
  privat: { ext: 'mp4 m4v webm jpg jpeg png gif webp', maxRes: 1080 },
  maxReqGb: 10,        // ab dieser Größe nur mit Hinweis und nie von selbst
  minFreeGb: 50,       // so viel muss nach dem Download noch frei sein
  maxOpen: 10,         // offene Vorschläge pro Mitglied
  who: 'members',      // members | upload (nur mit Upload-Recht) | off
  trustedMaxGb: 2,     // vertrauenswürdige Konten: bis zu dieser Größe ohne Freigabe
  autoCheck: true,     // gleich nach dem Vorschlag prüfen (lädt nichts)
};
const AUDIO_FORMATS = ['m4a', 'opus', 'mp3'];
const VIDEO_FORMATS = ['mp4', 'webm'];
const RESOLUTIONS = [480, 720, 1080, 1440, 2160];
// Immer gesperrt, egal welche Regel (zusätzlich zur Sperrliste der Downloads)
const NEVER = ['exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'pif', 'ps1', 'vbs', 'vbe', 'js', 'wsf', 'hta', 'jar', 'apk', 'dmg', 'lnk', 'reg', 'cpl', 'msc', 'sh', 'iso'];

const extList = s => [...new Set(String(s || '').toLowerCase().split(/[\s,;]+/).map(e => e.replace(/^\*?\./, '')).filter(e => /^[a-z0-9]{1,10}$/.test(e)))];
const num = (v, d, min, max) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d; };

function rules() {
  let saved = {};
  try { saved = JSON.parse(getSetting('jd_rules', '{}')) || {}; } catch { saved = {}; }
  const r = structuredClone(DEFAULT_RULES);
  for (const k of ['musik', 'video', 'datei', 'privat']) Object.assign(r[k], saved[k] || {});
  for (const k of ['maxReqGb', 'minFreeGb', 'maxOpen', 'who', 'trustedMaxGb', 'autoCheck']) if (saved[k] !== undefined) r[k] = saved[k];
  return r;
}
function saveRules(b) {
  const order = (v, all) => { const list = [...new Set(String(v || '').split(/[\s,>]+/).filter(x => all.includes(x)))]; return list.length ? list : all; };
  const r = {
    musik: { order: order(b.musik_order, AUDIO_FORMATS), ext: extList(b.musik_ext).join(' ') },
    video: { order: order(b.video_order, VIDEO_FORMATS), maxRes: RESOLUTIONS.includes(Number(b.video_res)) ? Number(b.video_res) : 1080, ext: extList(b.video_ext).join(' ') },
    datei: { ext: extList(b.datei_ext).join(' '), maxGb: num(b.datei_gb, 20, 0.1, 500) },
    privat: { ext: extList(b.privat_ext).join(' '), maxRes: RESOLUTIONS.includes(Number(b.privat_res)) ? Number(b.privat_res) : 1080 },
    maxReqGb: num(b.max_req_gb, 10, 0.1, 1000), minFreeGb: num(b.min_free_gb, 50, 0, 10000), maxOpen: Math.round(num(b.max_open, 10, 1, 100)),
    who: ['members', 'upload', 'off'].includes(b.who) ? b.who : 'members', trustedMaxGb: num(b.trusted_gb, 2, 0, 100), autoCheck: b.auto_check === '1',
  };
  setSetting('jd_rules', JSON.stringify(r));
  return r;
}
// Wo JDownloader die Dateien hinschreibt (Pfad im JDownloader-Container) und wo die Seite sie findet
const jdOut = () => String(getSetting('jd_out', '/output') || '/output').trim().replace(/\/+$/, '') || '/output';
const destFor = id => jdOut() + '/hp-' + id;
const localFor = id => path.join(JD_DIR, 'hp-' + id);
const QUARANTINE = () => path.join(JD_DIR, 'quarantaene');

function canSuggest(user) {
  if (!user) return false;
  if (user.isAdmin) return true;
  const who = rules().who;
  return who === 'members' || (who === 'upload' && user.canUpload);
}
const allowedKinds = user => Object.keys(KINDS).filter(k => k !== 'privat' || (user && user.canPrivate));

// ---------- Links prüfen ----------
const YT_ID = /(?:[?&]v=|youtu\.be\/|\/shorts\/|\/embed\/|\/live\/)([\w-]{11})(?![\w-])/;
function youtubeId(url) { const m = String(url || '').match(YT_ID); return m && /youtube\.com|youtu\.be|youtube-nocookie\.com/i.test(url) ? m[1] : null; }
function isYoutubePlaylist(url) {
  try { const u = new URL(url); return /(^|\.)youtube\.com$/i.test(u.hostname) && !!u.searchParams.get('list') && (u.pathname === '/playlist' || !u.searchParams.get('v')); } catch { return false; }
}
// Was steckt hinter dem Link? Vorschlag für die Art (nur ein Hinweis, das Mitglied wählt selbst)
function guessKind(url) {
  if (isYoutubePlaylist(url)) return 'playlist';
  if (youtubeId(url)) return 'musik';
  const e = path.extname(String(url).split(/[?#]/)[0]).slice(1).toLowerCase();
  if (DEFAULT_RULES.musik.ext.split(' ').includes(e)) return 'musik';
  if (DEFAULT_RULES.video.ext.split(' ').includes(e)) return 'video';
  return 'datei';
}

function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return privateIp(v.slice(7));
  return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}
// Nur http(s) ins Internet: keine internen Adressen, damit niemand über die Seite das Heimnetz abfragt.
// Gibt die bereinigte Adresse zurück oder wirft einen Fehler mit Text für das Mitglied.
async function checkUrl(raw, { resolve = true } = {}) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { throw new Error('Das ist kein gültiger Link.'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Nur Links mit http:// oder https:// gehen.');
  if (u.username || u.password) throw new Error('Links mit Benutzername oder Kennwort gehen nicht.');
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host.includes('.') || /\.(local|lan|home|internal|localdomain|intranet|corp|arpa)$/.test(host) || host === 'localhost' || host.endsWith('.localhost'))
    throw new Error('Interne Adressen gehen nicht, nur Links ins Internet.');
  if (net.isIP(host) && privateIp(host)) throw new Error('Interne Adressen gehen nicht, nur Links ins Internet.');
  if (resolve && !net.isIP(host) && process.env.LINKREQ_NO_DNS !== '1') {
    let addrs = [];
    try { addrs = await dns.lookup(host, { all: true }); } catch { addrs = []; }  // nicht auflösbar: JDownloader meldet „nicht abrufbar“
    if (addrs.some(a => privateIp(a.address))) throw new Error('Dieser Link zeigt ins Heimnetz und geht deshalb nicht.');
  }
  if (u.href.length > 2000) throw new Error('Der Link ist zu lang.');
  return u.href;
}

// ---------- Vorschläge ----------
const str = (v, n) => String(v ?? '').trim().slice(0, n);
const MEMBER_VIS = ['members', 'friends', 'private'];
async function suggest(user, b) {
  if (!canSuggest(user)) throw new Error('Du darfst gerade keine Links vorschlagen.');
  const r = rules();
  const urls = [...new Set(String(b.urls || b.url || '').split(/[\s]+/).map(s => s.trim()).filter(Boolean))].slice(0, 20);
  if (!urls.length) throw new Error('Füge mindestens einen Link ein.');
  if (!user.isAdmin) {
    const open = db.prepare(`SELECT COUNT(*) AS n FROM link_requests WHERE user_id = ? AND status IN ('new','checking','checked')`).get(user.id).n;
    if (open + urls.length > r.maxOpen) throw new Error(`Du hast schon ${open} offene Vorschläge (höchstens ${r.maxOpen}). Warte, bis sie erledigt sind.`);
  }
  const clean = [];
  for (const u of urls) {
    try { clean.push(await checkUrl(u)); } catch (e) { throw new Error(`${u.slice(0, 80)}: ${e.message}`); }
  }
  const kinds = allowedKinds(user);
  const vis = user.isAdmin && b.visibility === 'public' ? 'public' : MEMBER_VIS.includes(b.visibility) ? b.visibility : 'members';
  const ids = [];
  tx(() => {
    for (const url of clean) {
      const kind = kinds.includes(b.kind) ? b.kind : guessKind(url);
      const mode = kind === 'playlist' && b.mode === 'video' ? 'video' : 'audio';
      const auto = user.isAdmin ? (b.start === '1' ? 1 : 0) : 0;
      ids.push(Number(db.prepare(`INSERT INTO link_requests(user_id, url, kind, mode, title, note, visibility, auto, created_at, updated_at)
                                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(user.id, url, kind, mode, str(b.title, 120) || null, str(b.note, 500) || null, kind === 'privat' ? 'members' : vis, auto, now(), now()).lastInsertRowid));
    }
  });
  if (!user.isAdmin) {
    const n = ids.length;
    require('./notify').toAdmins(`🔗 ${user.name} schlägt ${n === 1 ? 'einen Link' : n + ' Links'} vor`, clean[0].slice(0, 120), '/admin/files/vorschlaege', 'linkreq-new');
  }
  require('./events').info('Downloads', `${ids.length} Link-Vorschlag/-Vorschläge von ${user.username}`, user.id);
  if (jd.configured() && (r.autoCheck || user.isAdmin)) for (const id of ids) startCheck(id);
  return ids;
}

const get = id => db.prepare('SELECT * FROM link_requests WHERE id = ?').get(Number(id));
const items = id => db.prepare('SELECT * FROM link_items WHERE request_id = ? ORDER BY pos, id').all(Number(id));
function setStatus(id, status, extra = {}) {
  const cols = Object.keys(extra);
  db.prepare(`UPDATE link_requests SET status = ?, updated_at = ?${cols.map(c => `, ${c} = ?`).join('')} WHERE id = ?`)
    .run(status, now(), ...cols.map(c => extra[c]), Number(id));
}

// Pakete eines Vorschlags im Linksammler oder in der Downloadliste: am Zielordner erkennbar
function ours(id, pkgs) {
  const tail = 'hp-' + id;
  return (pkgs || []).filter(p => {
    const s = String(p.saveTo || '').replace(/[\\/]+$/, '');
    return s === destFor(id) || s.endsWith('/' + tail) || s.endsWith('\\' + tail) || String(p.name || '').startsWith(`HP#${id} `);
  });
}

// ---------- Varianten (YouTube): genau eine pro Video nach den Regeln ----------
function variantInfo(v) {
  const s = (String(v.id || '') + ' ' + String(v.name || '')).toLowerCase();
  const res = Number((s.match(/(\d{3,4})p(?![a-z])/) || [])[1]) || 0;
  const kbit = Number((s.match(/(\d{2,3})\s*kbit/) || [])[1]) || 0;
  const junk = /subtitle|untertitel|description|beschreibung|thumbnail|image|bild|\bjpg\b|\bsrt\b|\btxt\b|3d|storyboard/.test(s);
  let format = null;
  if (!res) {
    if (/\bm4a\b|_m4a|m4a_|\baac\b|_aac/.test(s)) format = 'm4a';
    else if (/opus|ogg|vorbis/.test(s)) format = 'opus';
    else if (/mp3/.test(s)) format = 'mp3';
  } else if (/webm|vp9|vp8/.test(s)) format = 'webm';
  else if (/mp4|h264|h\.264|avc/.test(s)) format = 'mp4';
  return { id: v.id, name: v.name || String(v.id), res, kbit, junk, audio: !res && !!format, format };
}
// wantAudio: nur Ton; sonst Video bis maxRes. Gibt die beste Variante oder null.
function pickVariant(list, rule, wantAudio) {
  const order = rule.order || (wantAudio ? AUDIO_FORMATS : VIDEO_FORMATS);
  const cands = list.map(variantInfo).filter(v => !v.junk && v.format && order.includes(v.format) &&
    (wantAudio ? v.audio : v.res && v.res <= (rule.maxRes || 1080)));
  cands.sort((a, b) => (wantAudio ? 0 : b.res - a.res) || order.indexOf(a.format) - order.indexOf(b.format) || b.kbit - a.kbit);
  return cands[0] || null;
}
// Welche Regel gilt für die Art, und will sie nur Ton?
function ruleFor(req, r = rules()) {
  if (req.kind === 'musik' || (req.kind === 'playlist' && req.mode !== 'video')) return { rule: r.musik, audio: true, media: true };
  if (req.kind === 'video' || req.kind === 'playlist') return { rule: r.video, audio: false, media: true };
  if (req.kind === 'privat') return { rule: { ...r.privat, order: r.video.order }, audio: false, media: true };
  return { rule: r.datei, audio: false, media: false };
}
const extOf = name => path.extname(String(name || '')).slice(1).toLowerCase();
function blockedExt() { return [...new Set([...NEVER, ...require('./filecats').blockedExt()])]; }

// Bewertet die gefundenen Links: Haken oder Grund, warum nicht. links: [{ uuid, name, url, bytesTotal, availability, variant }]
function judge(req, links, r = rules()) {
  const { rule } = ruleFor(req, r);
  const allowed = extList(rule.ext), blocked = blockedExt();
  const seen = new Set();
  const maxFile = req.kind === 'datei' ? (rule.maxGb || 20) * GB : Infinity;
  return links.map((l, pos) => {
    const e = extOf(l.name), yt = youtubeId(l.url), it = { pos, jd_link: l.uuid, name: String(l.name || 'Datei'), url: l.url || null,
      size: Number(l.bytesTotal) > 0 ? Number(l.bytesTotal) : 0, variant: l.variant ? l.variant.name || null : null, variant_id: l.variant ? String(l.variant.id || '') : null, chosen: 0, note: null, existing_track: null };
    if (blocked.includes(e)) it.note = `.${e} ist nie erlaubt`;
    else if (String(l.availability || '').toUpperCase() === 'OFFLINE') it.note = 'nicht abrufbar (offline)';
    else if (!allowed.includes(e)) it.note = /^(srt|vtt|txt|jpg|jpeg|png|webp|nfo)$/.test(e) && yt ? 'Beiwerk (Untertitel, Bild, Beschreibung) wird nicht gebraucht' : `.${e || '?'} ist für ${KINDS[req.kind].label} nicht erlaubt`;
    else if (it.size > maxFile) it.note = `größer als ${rule.maxGb} GB`;
    else if (l.noVariant) it.note = l.noVariant;
    else if (yt && seen.has(yt)) it.note = 'gleiches Video schon gewählt';
    else {
      const sid = yt ? 'youtube:' + yt : null;
      const had = sid ? db.prepare('SELECT id FROM tracks WHERE source_id = ? AND privat = ? LIMIT 1').get(sid, req.kind === 'privat' ? 1 : 0)
        : db.prepare('SELECT id FROM tracks WHERE source_url = ? LIMIT 1').get(String(l.url || '')) ;
      const hadFile = !had && req.kind === 'datei' && l.url && db.prepare('SELECT id FROM files WHERE source_url = ? LIMIT 1').get(String(l.url));
      if (had && req.kind !== 'datei') { it.note = 'schon im Mediaplayer'; it.existing_track = had.id; }
      else if (hadFile) it.note = 'schon in den Downloads';
      else it.chosen = 1;
    }
    if (yt && (it.chosen || it.existing_track)) seen.add(yt);
    return it;
  });
}

// ---------- Prüfen: Linksammler auflösen lassen ----------
const busy = new Set();   // Vorschläge, an denen gerade gearbeitet wird
const wait = ms => new Promise(r => setTimeout(r, ms));
const CHECK_POLL_MS = Number(process.env.JD_POLL_MS) || 2000;
const CHECK_MAX_MS = 5 * 60e3;

function startCheck(id) {
  if (busy.has(id)) return;
  setStatus(id, 'checking', { reason: null });
  busy.add(id);
  check(id).catch(e => {
    if ((get(id) || {}).status === 'checking') setStatus(id, 'new', { reason: 'Prüfen ging nicht: ' + e.message });
    require('./events').warn('Downloads', `Vorschlag ${id} prüfen: ${e.message}`);
  }).finally(() => busy.delete(id));
}
async function removeOurCrawled(id) {
  const pk = ours(id, await jd.crawledPackages());
  if (pk.length) await jd.removeCrawled([], pk.map(p => p.uuid));
}
async function check(id) {
  const req = get(id);
  if (!req) return;
  await removeOurCrawled(id);   // nach einem Neustart oder „noch mal prüfen“ von vorn
  await jd.addLinks(req.url, req.kind === 'playlist' ? undefined : `HP#${id} ${req.title || ''}`.trim(), destFor(id));
  const start = Date.now();
  let pk = [];
  await wait(CHECK_POLL_MS / 2);
  for (;;) {
    const collecting = await jd.isCollecting();
    pk = ours(id, await jd.crawledPackages());
    if (!collecting && pk.length) break;
    if (Date.now() - start > CHECK_MAX_MS) { if (pk.length) break; throw new Error('JDownloader hat nach 5 Minuten nichts gefunden.'); }
    if (!collecting && Date.now() - start > 20e3) throw new Error('JDownloader hat unter diesem Link nichts gefunden.');
    await wait(CHECK_POLL_MS);
  }
  const { rule, audio, media } = ruleFor(req);
  let links = await jd.crawledLinks(pk.map(p => p.uuid));
  // YouTube und Co.: Variante nach den Regeln wählen, bevor bewertet wird
  if (media) {
    let changed = false;
    for (const l of links) {
      if (!l.variants) continue;
      const list = await jd.getVariants(l.uuid).catch(() => []);
      const best = pickVariant(Array.isArray(list) ? list : [], rule, audio);
      if (!best) { l.noVariant = audio ? 'keine passende Tonspur' : `kein ${rule.order.join('/')} bis ${rule.maxRes}p`; continue; }
      if (!l.variant || String(l.variant.id) !== String(best.id)) { await jd.setVariant(l.uuid, best.id); changed = true; }
    }
    if (changed) {
      await wait(CHECK_POLL_MS / 2);
      const keep = Object.fromEntries(links.filter(l => l.noVariant).map(l => [l.uuid, l.noVariant]));
      links = (await jd.crawledLinks(pk.map(p => p.uuid))).map(l => (keep[l.uuid] ? { ...l, noVariant: keep[l.uuid] } : l));
    }
  }
  // Reihenfolge wie im Linksammler (Playlist: wie bei YouTube)
  const pkOrder = pk.map(p => p.uuid);
  links.sort((a, b) => pkOrder.indexOf(a.packageUUID) - pkOrder.indexOf(b.packageUUID));
  const judged = judge(req, links);
  // Name: Wunschname, sonst Paketname (Playlist) bzw. Name der ersten gewählten Datei
  const first = judged.find(i => i.chosen) || judged[0];
  const title = req.title || (req.kind === 'playlist' ? String(pk[0].name || '') : first ? first.name.replace(/\.[a-z0-9]{1,5}$/i, '') : '').slice(0, 120) || null;
  tx(() => {
    db.prepare('DELETE FROM link_items WHERE request_id = ?').run(id);
    const ins = db.prepare(`INSERT INTO link_items(request_id, pos, jd_link, name, url, size, variant, variant_id, chosen, note, existing_track)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const it of judged) ins.run(id, it.pos, it.jd_link, it.name, it.url, it.size, it.variant, it.variant_id, it.chosen, it.note, it.existing_track);
    db.prepare('UPDATE link_requests SET title = ?, bytes_total = ? WHERE id = ?').run(title, judged.filter(i => i.chosen).reduce((n, i) => n + i.size, 0), id);
  });
  const fresh = get(id);
  if (fresh.status !== 'checking') return;   // inzwischen abgelehnt oder zurückgezogen
  setStatus(id, 'checked');
  // Von selbst weiter: Admin hat „gleich laden“ gewählt, oder vertrauenswürdiges Konto unter der Grenze
  const owner = fresh.user_id && db.prepare('SELECT id, role, jd_trusted FROM users WHERE id = ?').get(fresh.user_id);
  const r = rules();
  const n = judged.filter(i => i.chosen).length;
  const trusted = owner && owner.jd_trusted && fresh.bytes_total <= r.trustedMaxGb * GB;
  if (n && (fresh.auto || trusted) && fresh.bytes_total <= r.maxReqGb * GB) {
    const admin = owner && owner.role === 'admin' ? owner.id : null;
    await approve(id, admin, {}).catch(e => setStatus(id, 'checked', { reason: e.message }));
  }
}

// ---------- Freigabe ----------
function freeBytes(dir) {
  try { const s = fs.statfsSync(dir); return s.bavail * s.bsize; } catch { return null; }
}
// opts: { visibility, chosen: [item ids] (sonst wie geprüft), title }
async function approve(id, adminId, opts = {}) {
  const req = get(id);
  if (!req) throw new Error('Diesen Vorschlag gibt es nicht.');
  if (req.status !== 'checked') throw new Error(req.status === 'new' ? 'Erst prüfen, dann genehmigen.' : 'Dieser Vorschlag ist nicht mehr offen.');
  const all = items(id);
  if (Array.isArray(opts.chosen)) {
    const want = new Set(opts.chosen.map(Number)), blocked = blockedExt();
    for (const it of all) it.chosen = want.has(it.id) && !blocked.includes(extOf(it.name)) && !it.existing_track ? 1 : 0;
  }
  const pick = all.filter(i => i.chosen);
  if (!pick.length && !all.some(i => i.existing_track)) throw new Error('Nichts ausgewählt.');
  const total = pick.reduce((n, i) => n + i.size, 0);
  const free = freeBytes(fs.existsSync(JD_DIR) ? JD_DIR : MUSIC_DIR), r = rules();
  if (free !== null && free - total < r.minFreeGb * GB) {
    throw new Error(`Zu wenig Platz: danach wären nur noch ${require('./util').fmtSize(Math.max(0, free - total))} frei (mindestens ${r.minFreeGb} GB).`);
  }
  // Nur die gewählten Links gehen in die Downloadliste, alles andere fliegt aus dem Linksammler
  const pk = ours(id, await jd.crawledPackages());
  const crawled = pk.length ? await jd.crawledLinks(pk.map(p => p.uuid)) : [];
  const keep = new Set(pick.map(i => Number(i.jd_link)));
  const drop = crawled.filter(l => !keep.has(Number(l.uuid))).map(l => l.uuid);
  if (pick.length && !crawled.some(l => keep.has(Number(l.uuid)))) {
    setStatus(id, 'new', { reason: 'JDownloader hat die geprüften Links nicht mehr (neu gestartet?). Bitte noch einmal prüfen.' });
    throw new Error('JDownloader hat die geprüften Links nicht mehr. Bitte noch einmal prüfen.');
  }
  if (drop.length) await jd.removeCrawled(drop, []);
  const vis = ['public', 'members', 'friends', 'private'].includes(opts.visibility) ? opts.visibility : req.visibility;
  tx(() => {
    db.prepare('UPDATE link_items SET chosen = 0 WHERE request_id = ?').run(id);
    for (const it of pick) db.prepare('UPDATE link_items SET chosen = 1 WHERE id = ?').run(it.id);
    db.prepare('UPDATE link_requests SET visibility = ?, title = COALESCE(?, title), bytes_total = ?, decided_by = ? WHERE id = ?')
      .run(req.kind === 'privat' ? 'members' : vis, str(opts.title, 120) || null, total, adminId || null, id);
  });
  if (!pick.length) return sortNow(id);   // alles schon da: nur die Playlist anlegen
  await jd.moveToDownloads([...keep], []);
  await jd.start().catch(() => {});
  setStatus(id, 'queued', { reason: null, bytes_done: 0 });
  kick();
}
async function reject(id, adminId, reason) {
  const req = get(id);
  if (!req || !OPEN.includes(req.status)) throw new Error('Dieser Vorschlag ist nicht mehr offen.');
  setStatus(id, 'rejected', { reason: str(reason, 300) || null, decided_by: adminId || null });
  if (jd.configured()) await removeOurCrawled(id).catch(() => {});
  if (req.user_id) {
    require('./notify').send(req.user_id, 'vorschlag', { key: 'linkreq-' + id, title: '⛔ Vorschlag abgelehnt', body: (reason ? reason + ' · ' : '') + req.url.slice(0, 100), url: '/files/vorschlaege' });
  }
}
async function withdraw(id, user) {
  const req = get(id);
  if (!req || req.user_id !== user.id) throw new Error('Diesen Vorschlag gibt es nicht.');
  if (!OPEN.includes(req.status)) throw new Error('Der Vorschlag ist schon genehmigt und lässt sich nicht mehr zurückziehen.');
  setStatus(id, 'withdrawn');
  if (jd.configured()) await removeOurCrawled(id).catch(() => {});
}
// Admin bricht einen laufenden Download ab
async function abort(id) {
  const req = get(id);
  if (!req || !ACTIVE.includes(req.status)) throw new Error('Hier läuft nichts.');
  setStatus(id, 'failed', { reason: 'Vom Admin abgebrochen.' });
  const pk = ours(id, await jd.packages());
  if (pk.length) await jd.removeDownloads([], pk.map(p => p.uuid));
  fs.rmSync(localFor(id), { recursive: true, force: true });
}
// Fehlgeschlagen oder abgelehnt: noch einmal von vorn (Admin)
function reopen(id) {
  const req = get(id);
  if (!req || !['failed', 'rejected', 'new', 'checked'].includes(req.status)) throw new Error('Das geht hier nicht.');
  setStatus(id, 'new', { reason: null });
  if (jd.configured()) startCheck(Number(id));
}

// ---------- Wächter: Fortschritt abfragen, fertige Pakete abholen ----------
const ERR = /fehl|error|offline|not found|nicht gefunden|abgebrochen|aborted|skipped|übersprungen|ungültig|invalid|unavailable|nicht verfügbar|plugin defect|defekt/i;
let timer = null, ticking = false, lastTick = 0;
function kick() { if (timer) { clearTimeout(timer); timer = setTimeout(loop, 500); } }
async function loop() {
  timer = null;
  let active = false;
  try { active = await tick(); } catch { active = false; }
  timer = setTimeout(loop, active ? Number(process.env.JD_TICK_MS) || 5000 : 60e3);
  timer.unref();
}
async function tick() {
  if (ticking) return true;
  ticking = true;
  lastTick = Date.now();
  try {
    // Nach einem Neustart: angefangene Prüfungen und Einsortierungen wieder aufnehmen
    for (const r of db.prepare("SELECT id, status FROM link_requests WHERE status IN ('checking', 'sorting')").all()) {
      if (busy.has(r.id)) continue;
      if (r.status === 'sorting') { busy.add(r.id); await finish(r.id).finally(() => busy.delete(r.id)); }
      else if (jd.configured()) startCheck(r.id);
    }
    const reqs = db.prepare("SELECT * FROM link_requests WHERE status IN ('queued', 'loading')").all();
    if (!reqs.length) return busy.size > 0;
    if (!jd.configured()) return false;
    const pkgs = await jd.packages();
    for (const req of reqs) {
      if (busy.has(req.id)) continue;
      const pk = ours(req.id, pkgs);
      if (!pk.length) {
        // Nicht mehr in der Liste: entweder schon fertig und von JDownloader entfernt, oder verloren
        if (localFiles(req.id).length) await sortNow(req.id);
        else if (now() - req.updated_at > 15 * 60) setStatus(req.id, 'failed', { reason: 'JDownloader hat das Paket nicht mehr in der Downloadliste.' });
        continue;
      }
      const links = await jd.links(pk.map(p => p.uuid));
      const done = links.reduce((n, l) => n + (Number(l.bytesLoaded) || 0), 0);
      const total = links.reduce((n, l) => n + (Number(l.bytesTotal) || 0), 0) || req.bytes_total;
      const speed = pk.reduce((n, p) => n + (Number(p.speed) || 0), 0);
      const eta = Math.max(0, ...pk.map(p => Number(p.eta) || 0));
      const finished = links.filter(l => l.finished);
      const broken = links.filter(l => !l.finished && !l.running && ERR.test(String(l.status || '')));
      db.prepare('UPDATE link_requests SET bytes_done = ?, bytes_total = ?, speed = ?, eta = ?, status = ?, updated_at = ? WHERE id = ?')
        .run(done, total, speed, eta, done > 0 || speed > 0 ? 'loading' : req.status, req.status === 'queued' && !(done > 0 || speed > 0) ? req.updated_at : now(), req.id);
      if (links.length && finished.length + broken.length === links.length) {
        if (!finished.length) {
          setStatus(req.id, 'failed', { reason: 'JDownloader konnte nichts laden: ' + String(broken[0].status || '').slice(0, 160) });
          await jd.removeDownloads([], pk.map(p => p.uuid)).catch(() => {});
          continue;
        }
        await sortNow(req.id, pk.map(p => p.uuid), broken.map(l => String(l.name || '')));
      }
    }
    return true;
  } finally { ticking = false; }
}
async function sortNow(id, packageUUIDs = [], brokenNames = []) {
  busy.add(id);
  setStatus(id, 'sorting');
  try {
    await finish(id, brokenNames);
    if (packageUUIDs.length) await jd.removeDownloads([], packageUUIDs).catch(() => {});
  } finally { busy.delete(id); }
}

// ---------- Einsortieren ----------
function walk(dir, out = []) {
  let list = [];
  try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const d of list) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) walk(p, out);
    else if (d.isFile() && !/\.(part|tmp|crdownload)$/i.test(d.name) && !d.name.startsWith('.')) out.push(p);
  }
  return out;
}
const localFiles = id => walk(localFor(id));

// Echter Dateityp: die ersten Bytes müssen zur Endung passen. Ausführbares nie.
const MAGIC = {
  mp3: b => b.toString('latin1', 0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0),
  aac: b => b[0] === 0xff && (b[1] & 0xf0) === 0xf0,
  m4a: b => b.toString('latin1', 4, 8) === 'ftyp', mp4: b => b.toString('latin1', 4, 8) === 'ftyp', m4v: b => b.toString('latin1', 4, 8) === 'ftyp', mov: b => b.toString('latin1', 4, 8) === 'ftyp' || b.toString('latin1', 4, 8) === 'moov',
  webm: b => b.readUInt32BE(0) === 0x1a45dfa3, mkv: b => b.readUInt32BE(0) === 0x1a45dfa3,
  ogg: b => b.toString('latin1', 0, 4) === 'OggS', oga: b => b.toString('latin1', 0, 4) === 'OggS', opus: b => b.toString('latin1', 0, 4) === 'OggS',
  flac: b => b.toString('latin1', 0, 4) === 'fLaC', wav: b => b.toString('latin1', 0, 4) === 'RIFF',
  jpg: b => b[0] === 0xff && b[1] === 0xd8, jpeg: b => b[0] === 0xff && b[1] === 0xd8, png: b => b.toString('latin1', 1, 4) === 'PNG',
  gif: b => b.toString('latin1', 0, 4) === 'GIF8', webp: b => b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP',
  zip: b => b.toString('latin1', 0, 2) === 'PK', pdf: b => b.toString('latin1', 0, 5) === '%PDF-', '7z': b => b.toString('latin1', 0, 2) === "7z", rar: b => b.toString('latin1', 0, 4) === 'Rar!',
};
function sniff(file) {
  const b = Buffer.alloc(16);
  let fd;
  try { fd = fs.openSync(file, 'r'); fs.readSync(fd, b, 0, 16, 0); } catch { return 'nicht lesbar'; } finally { if (fd !== undefined) fs.closeSync(fd); }
  if (b.toString('latin1', 0, 2) === 'MZ' || b.readUInt32BE(0) === 0x7f454c46 || b.toString('latin1', 0, 2) === '#!' || b.readUInt32BE(0) === 0xcafebabe || b.readUInt32BE(0) === 0xcffaedfe)
    return 'ausführbares Programm';
  const e = extOf(file);
  if (MAGIC[e] && !MAGIC[e](b)) return `Inhalt passt nicht zur Endung .${e}`;
  return null;
}
const MIME = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', opus: 'audio/ogg', ogg: 'audio/ogg', oga: 'audio/ogg', flac: 'audio/flac', wav: 'audio/wav',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  zip: 'application/zip', pdf: 'application/pdf', txt: 'text/plain' };
const AUDIO = ['mp3', 'm4a', 'aac', 'opus', 'ogg', 'oga', 'flac', 'wav'], VIDEO = ['mp4', 'm4v', 'webm', 'mov'];

const seg = s => String(s || '').replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+|\.+$/g, '').slice(0, 80).trim();
// Freier Name unter base/rel (… (2).m4a, falls schon da)
function freeName(base, rel) {
  const dir = path.dirname(rel), e = path.extname(rel), stem = path.basename(rel, e);
  for (let i = 1; ; i++) {
    const r = path.join(dir, i === 1 ? stem + e : `${stem} (${i})${e}`);
    if (!fs.existsSync(path.join(base, r))) return r;
  }
}
async function moveFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try { fs.renameSync(from, to); } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    await fs.promises.copyFile(from, to);   // anderes Laufwerk (JDownloader-Freigabe → data): kopieren, dann löschen
    fs.rmSync(from, { force: true });
  }
}
function siteAdmin() { const a = db.prepare("SELECT id FROM users WHERE role = 'admin' AND disabled = 0 ORDER BY id LIMIT 1").get(); return a ? a.id : null; }

// Fertige Dateien eines Vorschlags einsortieren. Idempotent: was schon drin ist, steht in result.
async function finish(id, brokenNames = []) {
  const req = get(id);
  if (!req) return;
  let result = {};
  try { result = JSON.parse(req.result || '{}') || {}; } catch { result = {}; }
  result.tracks ||= []; result.files ||= []; result.skipped ||= []; result.byPos ||= {};
  const save = () => db.prepare('UPDATE link_requests SET result = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(result), now(), id);
  const its = items(id);
  const byName = new Map(its.map(i => [i.name.toLowerCase(), i]));
  const { rule } = ruleFor(req);
  const allowed = extList(rule.ext), blocked = blockedExt(), privat = req.kind === 'privat' ? 1 : 0;
  // Wem gehört es? „Angemeldete“/„Alle“: der Seite (Admin), „Nur ich“/„Nur Freunde“: dem Mitglied, ohne seinen Speicher
  const ownerVis = ['private', 'friends'].includes(req.visibility) && req.user_id;
  const owner = ownerVis ? req.user_id : req.decided_by || siteAdmin();
  const music = require('./music'), cats = require('./filecats');
  for (const file of localFiles(id)) {
    const name = path.basename(file), e = extOf(name), it = byName.get(name.toLowerCase());
    const problem = blocked.includes(e) ? `.${e} ist nie erlaubt` : !allowed.includes(e) ? `.${e || '?'} ist nicht erlaubt` : sniff(file);
    if (problem) {
      const q = path.join(QUARANTINE(), 'hp-' + id);
      await moveFile(file, path.join(q, freeName(q, name))).catch(() => fs.rmSync(file, { force: true }));
      result.skipped.push({ name, why: problem + ' (Quarantäne)' });
      require('./events').warn('Downloads', `Vorschlag ${id}: ${name} in Quarantäne (${problem})`);
      save();
      continue;
    }
    const size = fs.statSync(file).size, yt = it && youtubeId(it.url), sourceId = yt ? 'youtube:' + yt : null, sourceUrl = (it && it.url) || req.url;
    const asTrack = req.kind !== 'datei' && (AUDIO.includes(e) || VIDEO.includes(e));
    if (asTrack) {
      const kind = VIDEO.includes(e) && !(e === 'webm' && ruleFor(req).audio) ? 'video' : 'audio';
      const tags = kind === 'audio' ? music.readTags(file) : {}, guess = music.fromFilename(name);
      const title = tags.title || guess.title || name, artist = tags.artist || guess.artist || null;
      const rel = freeName(MUSIC_DIR, path.join(...[privat ? 'privat' : null, kind === 'video' ? 'videos' : seg(artist) || 'Unbekannt', (seg(kind === 'video' ? path.basename(name, path.extname(name)) : title) || 'Titel') + '.' + e].filter(Boolean)));
      await moveFile(file, path.join(MUSIC_DIR, rel));
      const tid = Number(db.prepare(`INSERT INTO tracks(title, artist, album, original_name, stored_name, size, mime, visibility, uploader_id, created_at, kind, source_url, source_id, requested_by, privat)
                                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(title.slice(0, 200), artist, tags.album || null, name, rel, size, MIME[e] || null, req.visibility, owner, now(), kind, sourceUrl, sourceId, req.user_id, privat).lastInsertRowid);
      result.tracks.push(tid);
      if (it) result.byPos[it.pos] = tid;
    } else {
      const list = cats.list();
      const rel = freeName(UPLOAD_DIR, path.join(privat ? 'privat' : 'jd', seg(name) || 'datei'));
      await moveFile(file, path.join(UPLOAD_DIR, rel));
      const category = privat ? 'Privat' : cats.guess(name, list);
      const fid = Number(db.prepare(`INSERT INTO files(title, description, category, original_name, stored_name, size, mime, visibility, uploader_id, created_at, source_url, source_id, requested_by, privat)
                                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run((req.kind === 'datei' && req.title && its.filter(i => i.chosen).length === 1 ? req.title : name).slice(0, 200), req.note && req.user_id === owner ? req.note : null,
          category, name, rel, size, MIME[e] || null, req.visibility, owner, now(), sourceUrl, sourceId, req.user_id, privat).lastInsertRowid);
      result.files.push(fid);
    }
    save();
  }
  for (const n of brokenNames) if (n && !result.skipped.some(s => s.name === n)) result.skipped.push({ name: n, why: 'JDownloader konnte es nicht laden' });
  // Playlist: gleiche Reihenfolge wie die Quelle, vorhandene Titel kommen mit hinein
  if (req.kind === 'playlist' && !result.playlist && req.user_id) {
    const order = its.map(i => result.byPos[i.pos] || i.existing_track).filter(Boolean);
    if (order.length) {
      const pid = Number(db.prepare('INSERT INTO playlists(user_id, title, visibility, created_at, updated_at, source_url, privat) VALUES (?, ?, ?, ?, ?, ?, 0)')
        .run(req.user_id, (req.title || 'Playlist').slice(0, 100), req.visibility === 'public' ? 'members' : req.visibility, now(), now(), req.url).lastInsertRowid);
      const ins = db.prepare('INSERT INTO playlist_tracks(playlist_id, position, track_id) VALUES (?, ?, ?)');
      tx(() => [...new Set(order)].forEach((t, i) => ins.run(pid, i, t)));
      result.playlist = pid;
    }
  }
  if (!result.tracks.length && result.existing === undefined) result.existing = its.filter(i => i.existing_track).map(i => i.existing_track);
  save();
  fs.rmSync(localFor(id), { recursive: true, force: true });
  const got = result.tracks.length + result.files.length;
  const ok = got || result.playlist || (result.existing || []).length;
  setStatus(id, ok ? 'done' : 'failed', { reason: ok ? null : 'Keine passende Datei angekommen' + (result.skipped[0] ? ': ' + result.skipped[0].why : '.'), speed: 0, eta: 0, bytes_done: get(id).bytes_total });
  if (req.user_id) {
    const where = result.playlist ? 'als Playlist im Mediaplayer' : result.tracks.length ? 'im Mediaplayer' : 'in den Downloads';
    require('./notify').send(req.user_id, 'vorschlag', { key: 'linkreq-' + id,
      title: ok ? `✅ Dein Vorschlag liegt ${where}` : '⚠️ Dein Vorschlag hat nicht geklappt',
      body: (req.title || req.url).slice(0, 120) + (result.skipped.length ? ` · ${result.skipped.length} übersprungen` : ''), url: resultUrl(get(id)) || '/files/vorschlaege' });
  }
  require('./events').info('Downloads', `Vorschlag ${id} fertig: ${result.tracks.length} Titel, ${result.files.length} Dateien${result.playlist ? ', Playlist' : ''}, ${result.skipped.length} übersprungen`);
}

// ---------- Anzeige ----------
function parseResult(r) { try { return JSON.parse(r.result || '{}') || {}; } catch { return {}; } }
function resultUrl(r) {
  if (r.status !== 'done') return null;
  const res = parseResult(r);
  if (res.playlist) return '/musik?playlist=' + res.playlist;
  if ((res.tracks || []).length) return '/musik';
  if ((res.files || []).length) return r.kind === 'privat' ? '/files?ort=privat' : '/files?ort=neu';
  return null;
}
// Weg eines Vorschlags als Pfeilkette: [{ t, c }] mit c = d (erledigt), c (gerade), x (abgebrochen), '' (kommt noch)
function steps(r, res, pct) {
  const when = require('./util').fmtDate(r.created_at);
  if (['rejected', 'withdrawn', 'failed'].includes(r.status)) {
    const t = { rejected: 'Abgelehnt', withdrawn: 'Zurückgezogen', failed: 'Fehlgeschlagen' }[r.status];
    return [{ t: 'Vorgeschlagen ' + when, c: 'd' }, { t: t + (r.reason ? ': „' + r.reason + '“' : ''), c: 'x' }];
  }
  if (r.status === 'done') {
    const got = [];
    if (res.playlist) got.push('📋 Playlist angelegt');
    if ((res.tracks || []).length) got.push((res.tracks.length === 1 ? '1 Titel' : res.tracks.length + ' Titel') + ' im Mediaplayer');
    if ((res.files || []).length) got.push((res.files.length === 1 ? '1 Datei' : res.files.length + ' Dateien') + ' in den Downloads');
    if (!got.length) got.push('war schon da');
    return [{ t: 'Vorgeschlagen ' + when, c: 'd' }, { t: 'Genehmigt', c: 'd' }, { t: 'Geladen', c: 'd' }, ...got.map(t => ({ t, c: 'd' }))];
  }
  const seq = ['Vorgeschlagen ' + when, 'Prüfen', 'Freigabe', 'Laden', 'Einsortieren'];
  const at = { new: 1, checking: 1, checked: 2, queued: 3, loading: 3, sorting: 4 }[r.status] || 1;
  const now = { new: 'Wartet auf Prüfung', checking: 'In Prüfung', checked: 'Wartet auf Freigabe', queued: 'Wartet auf JDownloader', loading: `Lädt ${pct} %`, sorting: 'Wird einsortiert' }[r.status];
  return seq.map((t, i) => ({ t: i === at ? now : t, c: i < at ? 'd' : i === at ? 'c' : '' }));
}
function row(r) {
  const [icon, label] = STATUS[r.status] || ['❔', r.status];
  const res = parseResult(r);
  const pct = r.bytes_total ? Math.min(100, Math.round(r.bytes_done / r.bytes_total * 100)) : 0;
  return {
    steps: steps(r, res, pct),
    ...r, kindIcon: (KINDS[r.kind] || KINDS.datei).icon, kindLabel: (KINDS[r.kind] || KINDS.datei).label, statusIcon: icon, statusLabel: label,
    pct, open: OPEN.includes(r.status), active: ACTIVE.includes(r.status),
    resultUrl: resultUrl(r), counts: { tracks: (res.tracks || []).length, files: (res.files || []).length, skipped: (res.skipped || []).length, playlist: res.playlist || null },
    skipped: res.skipped || [], host: (() => { try { return new URL(r.url).hostname.replace(/^www\./, ''); } catch { return ''; } })(),
  };
}
// usable: wie viele gefundene Dateien geladen würden oder schon da sind (0 = nach den Regeln passt nichts)
const SELECT = `SELECT r.*, u.username, u.display_name, (SELECT COUNT(*) FROM link_items i WHERE i.request_id = r.id AND (i.chosen = 1 OR i.existing_track IS NOT NULL)) AS usable
                FROM link_requests r LEFT JOIN users u ON u.id = r.user_id`;
function mine(userId) { return db.prepare(`${SELECT} WHERE r.user_id = ? ORDER BY r.created_at DESC, r.id DESC LIMIT 200`).all(userId).map(row); }
function forAdmin(filter) {
  const where = filter === 'offen' ? `r.status IN ('new','checking','checked')` : filter === 'laufend' ? `r.status IN ('queued','loading','sorting')`
    : `r.status IN ('done','rejected','withdrawn','failed')`;
  return db.prepare(`${SELECT} WHERE ${where} ORDER BY r.created_at ${filter === 'erledigt' ? 'DESC' : 'ASC'}, r.id LIMIT 300`).all().map(row);
}
function counts() {
  const c = Object.fromEntries(db.prepare('SELECT status, COUNT(*) AS n FROM link_requests GROUP BY status').all().map(x => [x.status, x.n]));
  const sum = list => list.reduce((n, s) => n + (c[s] || 0), 0);
  return { offen: sum(OPEN), laufend: sum(ACTIVE), erledigt: sum(['done', 'rejected', 'withdrawn', 'failed']) };
}
function detail(id) { const r = db.prepare(`${SELECT} WHERE r.id = ?`).get(Number(id)); return r ? { ...row(r), items: items(id) } : null; }

// Verbindung testen (Seitenverwaltung → Downloads → Regeln → Verbindung)
async function test() {
  const out = { url: jd.baseUrl(), ok: false, warn: [] };
  try {
    out.version = await jd.version();
    out.state = await jd.state().catch(() => null);
    out.ok = true;
  } catch (e) { out.error = e.message; }
  try {
    const host = new URL(out.url).hostname;
    if (net.isIP(host) ? !privateIp(host) : host.includes('.') && !/\.(local|lan|home|internal)$/.test(host)) {
      out.warn.push('Die Adresse sieht nach einer öffentlichen aus. Die Schnittstelle hat keine Anmeldung: nur über ein internes Docker-Netz verbinden, nie über den Proxy oder eine Portfreigabe.');
    }
  } catch { /* keine Adresse */ }
  out.dir = JD_DIR;
  try { fs.accessSync(JD_DIR, fs.constants.R_OK | fs.constants.W_OK); out.dirOk = true; } catch { out.dirOk = false; }
  return out;
}
// Warteschlange: Zustand von JDownloader und laufende Vorschläge
async function queue() {
  const out = { configured: jd.configured(), lastTick, items: db.prepare(`${SELECT} WHERE r.status IN ('queued','loading','sorting') ORDER BY r.created_at`).all().map(row) };
  if (!out.configured) return out;
  try { out.state = await jd.state(); out.ok = true; } catch (e) { out.ok = false; out.error = e.message; }
  return out;
}

function start() {
  if (timer || process.env.LINKREQ_WORKER === '0') return;
  timer = setTimeout(loop, 3000);
  timer.unref();
}

module.exports = {
  KINDS, STATUS, DEFAULT_RULES, AUDIO_FORMATS, VIDEO_FORMATS, RESOLUTIONS, rules, saveRules, canSuggest, allowedKinds, checkUrl, guessKind, youtubeId, isYoutubePlaylist,
  suggest, startCheck, approve, reject, withdraw, abort, reopen, tick, start, kick, mine, forAdmin, counts, detail, get, test, queue, pickVariant, variantInfo, judge, sniff, privateIp,
  _busy: busy,
};
