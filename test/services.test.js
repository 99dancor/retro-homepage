'use strict';
// Dienste ohne Browser: Minecraft- und Steam-Abfrage gegen nachgebaute Server, Website/Port/Jellyfin/Immich/Nextcloud,
// Formular → Zeile (Schlüssel bleibt stehen), was Besucher sehen, wann ein Dienst als offline gilt und „Sag Bescheid“.
// Aufruf: node --test test/services.test.js (läuft mit npm test)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const dgram = require('node:dgram');
const { once } = require('node:events');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'svc-test-'));
process.env.PUID = '0';
const { db, now, setSetting } = require('../src/db');
const svc = require('../src/services');

const listen = async server => { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return server.address().port; };
// Freier Port, an dem niemand lauscht
async function closedPort() {
  const s = net.createServer();
  const port = await listen(s);
  await new Promise(r => s.close(r));
  return port;
}
let nextUser = 0;
const user = (role = 'user') => {
  const id = Number(db.prepare("INSERT INTO users(username, password_hash, role, created_at) VALUES (?, 'x', ?, ?)").run('u' + ++nextUser, role, now()).lastInsertRowid);
  return { id, isAdmin: role === 'admin' };
};
const row = (fields = {}) => {
  const f = { kind: 'http', name: 'Test', icon: '🌐', config: '{}', visibility: 'public', show_on: 'home,widget', every: 60, notify_down: 0, enabled: 1, position: 1, ...fields };
  const id = Number(db.prepare('INSERT INTO services(kind, name, icon, config, visibility, show_on, every, notify_down, enabled, position, state, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(f.kind, f.name, f.icon, typeof f.config === 'string' ? f.config : JSON.stringify(f.config), f.visibility, f.show_on, f.every, f.notify_down, f.enabled, f.position, f.state || 'unknown', now()).lastInsertRowid);
  return id;
};

test('varint: Minecraft-Zahlen hin und zurück, auch -1', () => {
  for (const n of [0, 1, 127, 128, 300, 25565, 2097151, 2147483647]) {
    const b = svc.varint(n);
    assert.deepEqual(svc.readVarint(b, 0), { value: n, pos: b.length });
  }
  assert.deepEqual([...svc.varint(300)], [0xac, 0x02]);
  assert.equal(svc.varint(-1).length, 5);
  assert.equal(svc.readVarint(svc.varint(-1), 0).value, -1);
  assert.equal(svc.readVarint(Buffer.from([0x80]), 0), null, 'unvollständig');
  assert.throws(() => svc.readVarint(Buffer.from([0x80, 0x80, 0x80, 0x80, 0x80, 0x80]), 0));
});

test('Minecraft: Server List Ping gegen einen nachgebauten Server', async () => {
  let handshake = null;
  const mc = net.createServer(s => {
    let buf = Buffer.alloc(0);
    s.on('data', d => {
      buf = Buffer.concat([buf, d]);
      const len = svc.readVarint(buf, 0);
      if (!len || buf.length < len.pos + len.value) return;
      const id = svc.readVarint(buf, len.pos);
      const ver = svc.readVarint(buf, id.pos), hl = svc.readVarint(buf, ver.pos);
      handshake = { id: id.value, version: ver.value, host: buf.slice(hl.pos, hl.pos + hl.value).toString(), port: buf.readUInt16BE(hl.pos + hl.value), next: buf[hl.pos + hl.value + 2] };
      const json = Buffer.from(JSON.stringify({ version: { name: '1.21.4' }, players: { online: 3, max: 20 }, description: { text: '§aChaos', extra: [{ text: 'craft' }] } }));
      const body = Buffer.concat([svc.varint(0), svc.varint(json.length), json]);
      const out = Buffer.concat([svc.varint(body.length), body]);
      // In zwei Stücken, wie es über das Netz auch kommen kann
      s.write(out.slice(0, 7));
      setTimeout(() => s.end(out.slice(7)), 20);
    });
  });
  const port = await listen(mc);
  try {
    const r = await svc.minecraftPing('127.0.0.1', port);
    assert.deepEqual(handshake, { id: 0, version: -1, host: '127.0.0.1', port, next: 1 });
    assert.equal(r.json.players.online, 3);
    const c = await svc.CHECKS.minecraft({ host: '127.0.0.1', port });
    assert.equal(c.state, 'up');
    assert.deepEqual({ ...c.info }, { players: 3, max: 20, version: '1.21.4', motd: 'Chaoscraft' });
    await assert.rejects(svc.minecraftPing('127.0.0.1', await closedPort()), /Verbindung abgelehnt/);
  } finally { mc.close(); }
});

// A2S_INFO-Antwort wie von einem Valheim-Server
function a2sReply() {
  const s = t => Buffer.from(t + '\0', 'utf8');
  return Buffer.concat([Buffer.from([0xff, 0xff, 0xff, 0xff, 0x49, 17]), s('Wikinger-Server'), s('Mittelerde'), s('valheim'), s('Valheim'),
    Buffer.from([0, 0, 4, 10, 0, 0x64, 0x6c, 1, 0]), s('0.219.16')]);
}

test('Steam: A2S lesen, mit Challenge wie neuere Server', async () => {
  const info = svc.parseA2S(a2sReply());
  assert.deepEqual(info, { name: 'Wikinger-Server', map: 'Mittelerde', folder: 'valheim', game: 'Valheim', players: 4, max: 10, bots: 0, password: true, version: '0.219.16' });
  assert.throws(() => svc.parseA2S(Buffer.from([0xff, 0xff, 0xff, 0xff, 0x41, 1, 2, 3, 4])), /keine Server-Info/);

  const udp = dgram.createSocket('udp4');
  const seen = [];
  udp.on('message', (msg, from) => {
    seen.push(msg.length);
    // Erste Anfrage ohne Challenge: 0x41 mit vier Bytes zurück; danach muss die Anfrage sie anhängen
    if (msg.length === 25) return udp.send(Buffer.from([0xff, 0xff, 0xff, 0xff, 0x41, 9, 8, 7, 6]), from.port, from.address);
    assert.deepEqual([...msg.slice(-4)], [9, 8, 7, 6]);
    udp.send(a2sReply(), from.port, from.address);
  });
  udp.bind(0, '127.0.0.1');
  await once(udp, 'listening');
  try {
    const r = await svc.CHECKS.steam({ host: '127.0.0.1', port: udp.address().port });
    assert.deepEqual(seen, [25, 29]);
    assert.equal(r.state, 'up');
    assert.deepEqual([r.info.players, r.info.max, r.info.map, r.info.server, r.info.password], [4, 10, 'Mittelerde', 'Wikinger-Server', true]);
  } finally { udp.close(); }
});

test('Website, Port, Jellyfin, Immich, Nextcloud gegen einen nachgebauten Server', async () => {
  const keys = [];
  const srv = http.createServer((q, s) => {
    keys.push(q.headers['x-emby-token'] || q.headers['x-api-key'] || q.headers['nc-token'] || null);
    const json = o => { s.setHeader('content-type', 'application/json'); s.end(JSON.stringify(o)); };
    const u = q.url;
    if (u === '/ok') return s.end('hallo');
    if (u === '/kaputt') { s.statusCode = 500; return s.end(); }
    if (u === '/langsam') return setTimeout(() => s.end('ok'), 250);
    if (u === '/jf/System/Info/Public') return json({ Version: '10.10.3', ServerName: 'Kino' });
    if (u.startsWith('/jf/Sessions')) return json([{ UserName: 'anna', NowPlayingItem: { SeriesName: 'Dark', Name: 'Folge 1' } }, { UserName: 'bernd' }]);
    if (u === '/jf/Items/Counts') return json({ MovieCount: 120, SeriesCount: 14, EpisodeCount: 400, SongCount: 0 });
    if (u === '/jfbad/System/Info/Public') return json({ Version: '10.10.3' });
    if (u.startsWith('/jfbad/')) { s.statusCode = 401; return s.end(); }
    if (u === '/im/api/server/ping') return json({ res: 'pong' });
    if (u === '/im/api/server/version') return json({ major: 1, minor: 120, patch: 2 });
    if (u === '/im/api/server/statistics') return json({ photos: 5000, videos: 30, usage: 123 });
    if (u === '/im/api/server/storage') return json({ diskSizeRaw: 1000, diskUseRaw: 250 });
    if (u === '/nope/api/server/ping') return json({ res: 'nein' });
    if (u === '/nc/status.php') return json({ installed: true, maintenance: true, versionstring: '30.0.1' });
    if (u === '/html/status.php') return s.end('<html>Anmelden</html>');
    s.statusCode = 404;
    s.end();
  });
  const port = await listen(srv);
  const base = `http://127.0.0.1:${port}`;
  try {
    assert.equal((await svc.probe('http', { url: base + '/ok' })).state, 'up');
    const bad = await svc.probe('http', { url: base + '/kaputt' });
    assert.deepEqual([bad.state, bad.error], ['down', 'HTTP 500']);
    assert.equal((await svc.probe('http', { url: base + '/langsam', slow: 100 })).state, 'warn');
    assert.equal((await svc.probe('http', { url: 'ftp://x' })).state, 'down');
    assert.equal((await svc.probe('tcp', { host: '127.0.0.1', port })).state, 'up');
    const off = await svc.probe('tcp', { host: '127.0.0.1', port: await closedPort() });
    assert.deepEqual([off.state, off.error], ['down', 'Verbindung abgelehnt']);
    assert.equal((await svc.probe('gibtsnicht', {})).state, 'down');

    // Jellyfin: ohne Schlüssel nur online und Version, mit Schlüssel Zahlen; wer was schaut nur mit „details“
    keys.length = 0;
    let jf = await svc.probe('jellyfin', { url: base + '/jf/' });
    assert.deepEqual({ ...jf.info }, { version: '10.10.3', server: 'Kino' });
    assert.deepEqual(keys, [null], 'ohne Schlüssel nur die öffentliche Abfrage');
    jf = await svc.probe('jellyfin', { url: base + '/jf', key: 'k1' });
    assert.equal(jf.info.watching, 1);
    assert.equal(jf.info.streams, undefined);
    assert.equal(jf.info.counts.movies, 120);
    jf = await svc.probe('jellyfin', { url: base + '/jf', key: 'k1', details: true });
    assert.deepEqual(jf.info.streams, [{ user: 'anna', title: 'Dark – Folge 1' }]);
    jf = await svc.probe('jellyfin', { url: base + '/jfbad', key: 'falsch' });
    assert.equal(jf.state, 'up', 'falscher Schlüssel: trotzdem online');
    assert.match(jf.info.keyError, /Zugriff verweigert/);

    const im = await svc.probe('immich', { url: base + '/im', key: 'k2', storage: true });
    assert.equal(im.state, 'up');
    assert.deepEqual([im.info.version, im.info.photos, im.info.disk.used, im.info.disk.total], ['1.120.2', 5000, 250, 1000]);
    assert.equal((await svc.probe('immich', { url: base + '/nope' })).state, 'down');
    const nc = await svc.probe('nextcloud', { url: base + '/nc' });
    assert.deepEqual([nc.state, nc.info.maintenance, nc.info.version], ['warn', true, '30.0.1']);
    assert.match((await svc.probe('nextcloud', { url: base + '/html' })).error, /kein JSON/);
  } finally { srv.close(); }
});

test('Formular: Adresse prüfen, host:port, Schlüssel bleibt beim Speichern ohne Eingabe stehen', () => {
  assert.match(svc.save(0, { kind: 'http', url: 'javascript:alert(1)' }).error, /http/);
  assert.match(svc.save(0, { kind: 'tcp', host: '' }).error, /Rechner/);
  assert.match(svc.save(0, { kind: 'tcp', host: 'x', port: '70000' }).error, /Port/);
  assert.match(svc.save(0, { kind: 'http', url: 'http://x', public_url: 'javascript:1' }).error, /Link/);
  const mc = svc.save(0, { kind: 'minecraft', host: 'mc://192.168.1.5:25570/' , show: ['home', 'quatsch'], every: '5' });
  let s = svc.get(mc.id);
  assert.deepEqual(s.config, { host: '192.168.1.5', port: 25570 });
  assert.deepEqual(s.show, ['home']);
  assert.equal(s.every, 30, 'nicht öfter als alle 30 Sekunden');
  assert.equal(s.name, 'Minecraft');
  assert.equal(s.visibility, 'members');
  assert.equal(svc.get(svc.save(0, { kind: 'minecraft', host: '10.0.0.1' }).id).config.port, 25565, 'Standardport');

  const jf = svc.save(0, { kind: 'jellyfin', url: 'http://10.0.0.2:8096', key: 'geheim', details: '1' });
  db.prepare("UPDATE services SET state = 'up', info = '{\"version\":\"1\"}' WHERE id = ?").run(jf.id);
  svc.save(jf.id, { kind: 'jellyfin', url: 'http://10.0.0.2:8096', key: '', name: 'Kino' });
  s = svc.get(jf.id);
  assert.equal(s.config.key, 'geheim');
  assert.equal(s.config.details, false);
  assert.equal(s.state, 'up', 'nur Name und Schalter geändert: Zustand bleibt');
  svc.save(jf.id, { kind: 'jellyfin', url: 'http://10.0.0.3:8096', key: '' });
  assert.equal(svc.get(jf.id).state, 'unknown', 'andere Adresse: neu prüfen');
  svc.save(jf.id, { kind: 'jellyfin', url: 'http://10.0.0.3:8096', key_clear: '1', key: 'egal' });
  assert.equal(svc.get(jf.id).config.key, '');
  for (const r of svc.all()) svc.remove(r.id);
});

test('Besucher sehen nur Name, Zustand und Kurzinfo, je nach Sichtbarkeit', () => {
  const anna = user(), boss = user('admin');
  const pub = row({ name: 'Öffentlich', config: { url: 'http://10.0.0.9', key: 'geheim' }, state: 'up', show_on: 'home,tray' });
  const mem = row({ name: 'Mitglieder', visibility: 'members', state: 'down' });
  const adm = row({ name: 'Admin', visibility: 'admin', state: 'up' });
  row({ name: 'Pausiert', enabled: 0 });
  assert.deepEqual(svc.forViewer(null).map(s => s.name), ['Öffentlich']);
  assert.deepEqual(svc.forViewer(anna).map(s => s.name), ['Öffentlich', 'Mitglieder']);
  assert.deepEqual(svc.forViewer(boss).map(s => s.name), ['Öffentlich', 'Mitglieder', 'Admin']);
  assert.deepEqual(svc.forViewer(anna, 'tray').map(s => s.name), ['Öffentlich']);
  const out = JSON.stringify(svc.forViewer(boss));
  assert.doesNotMatch(out, /geheim|10\.0\.0\.9|config/);
  assert.equal(svc.watch(anna, adm, true), false, 'nicht sichtbar');
  assert.equal(svc.watch(null, pub, true), false);
  assert.equal(svc.watch(anna, mem, true), true);
  assert.equal(svc.forViewer(anna).find(s => s.id === mem).watching, true);
  assert.equal(svc.downCount(), 1);
  for (const r of svc.all()) svc.remove(r.id);
});

test('Offline erst nach zwei Fehlschlägen, Rückkehr benachrichtigt die Wartenden einmal', () => {
  const anna = user(), boss = user('admin');
  const id = row({ kind: 'steam', name: 'Valheim', visibility: 'members', notify_down: 1 });
  const rec = (state, error) => svc.record(svc.get(id), { state, ms: 5, error, info: state === 'down' ? {} : { players: 2, max: 10 } });
  rec('down', 'keine Antwort');
  assert.equal(svc.get(id).state, 'down', 'noch nie geprüft: sofort offline');
  rec('up');
  assert.equal(svc.get(id).state, 'up');
  rec('down', 'Aussetzer');
  assert.equal(svc.get(id).state, 'up', 'ein Aussetzer ist kein Ausfall');
  assert.equal(svc.get(id).fails, 1);
  svc.watch(anna, id, true);
  rec('down', 'Verbindung abgelehnt');
  let s = svc.get(id);
  assert.equal(s.state, 'down');
  assert.equal(s.info.error, 'Verbindung abgelehnt');
  assert.match(svc.summary(s, true), /^offline seit .* · Verbindung abgelehnt$/);
  assert.match(svc.summary(s, false), /^offline seit \S+( \S+)?$/, 'Besucher sehen den Fehler nicht');
  const notes = uid => db.prepare('SELECT title FROM notifications WHERE user_id = ? ORDER BY id').all(uid).map(r => r.title);
  assert.deepEqual(notes(boss.id), ['🔴 Valheim ist offline']);
  rec('up');
  s = svc.get(id);
  assert.equal(s.state, 'up');
  assert.equal(s.info.error, undefined);
  assert.equal(svc.summary(s, false), '2 / 10 Spieler');
  assert.deepEqual(notes(anna.id), ['🟢 Valheim ist wieder online']);
  assert.deepEqual(notes(boss.id), ['🟢 Valheim ist wieder online'], 'die Meldung an den Admin wird ersetzt, nicht gestapelt');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM service_watch').get().n, 0, 'Liste ist danach leer');
  const ev = db.prepare("SELECT message FROM events WHERE source = 'Dienste' ORDER BY id").all().map(r => r.message);
  assert.ok(ev.includes('„Valheim“ ist wieder erreichbar'));
  assert.ok(ev.some(m => /„Valheim“ antwortet nicht: Verbindung abgelehnt/.test(m)));
  // Verlauf: Balken je Stunde und Verfügbarkeit
  const b = svc.bars(id, 24);
  assert.equal(b.length, 24);
  assert.equal(b[23], 'down', 'schlechtester Zustand der Stunde');
  assert.equal(svc.uptime(id), 40, 'drei von fünf Abfragen ohne Antwort');
  for (const r of svc.all()) svc.remove(r.id);
});

test('Belegter Speicher: Platten, Beschriftung, für wen', () => {
  const anna = user();
  const d = svc.disks();
  assert.ok(d.length >= 1);
  assert.ok(d[0].total > 0 && d[0].used >= 0);
  assert.ok(d[0].dirs.includes('Server'));
  setSetting('svc_disks', JSON.stringify({ [d[0].key]: { label: 'Array', on: true } }));
  setSetting('svc_storage', '1');
  setSetting('svc_storage_for', 'members');
  assert.equal(svc.storage(null), null);
  const st = svc.storage(anna);
  assert.equal(st[0].label, 'Array');
  assert.ok(st[0].pct >= 0 && st[0].pct <= 100);
  // Immich mit Speicher-Schalter kommt dazu, Nextcloud nur mit freiem Platz
  row({ kind: 'immich', name: 'Fotos', visibility: 'members', config: { storage: true }, state: 'up' });
  db.prepare("UPDATE services SET info = '{\"disk\":{\"used\":250,\"total\":1000}}' WHERE name = 'Fotos'").run();
  row({ kind: 'nextcloud', name: 'Cloud', visibility: 'admin', config: { storage: true }, state: 'up' });
  db.prepare("UPDATE services SET info = '{\"free\":5368709120}' WHERE name = 'Cloud'").run();
  const more = svc.storage(anna);
  assert.deepEqual(more.slice(1).map(x => [x.label, x.pct]), [['Fotos', 25]]);
  assert.deepEqual(svc.storage(null, { all: true }).slice(1).map(x => [x.label, x.freeText]), [['Fotos', '750 B'], ['Cloud', '5,0 GB']]);
  setSetting('svc_storage', '0');
  assert.equal(svc.storage(anna), null);
  assert.equal(svc.fmtBytes(1536), '1,5 KB');
  for (const r of svc.all()) svc.remove(r.id);
});
