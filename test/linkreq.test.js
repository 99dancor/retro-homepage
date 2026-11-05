'use strict';
// Link-Vorschläge mit nachgebautem JDownloader (test/fixtures/jd-mock.js): Prüfen wählt genau eine Variante pro Video
// nach den Regeln, Genehmigen schiebt nur die gewählten Links in die Downloadliste, fertige Dateien landen im Mediaplayer
// (Playlist in Reihenfolge, Besitzer = Vorschlagender), Privat bleibt abgetrennt, Unpassendes kommt in Quarantäne.
// Aufruf: node --test test/linkreq.test.js (läuft mit npm test)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'linkreq-test-'));
process.env.DATA_DIR = path.join(TMP, 'data');
process.env.JD_DIR = path.join(TMP, 'jd');
process.env.PUID = '0';
process.env.LINKREQ_NO_DNS = '1';
process.env.JD_POLL_MS = '60';
fs.mkdirSync(process.env.JD_DIR, { recursive: true });
const { db, now, setSetting, MUSIC_DIR, UPLOAD_DIR } = require('../src/db');
const lr = require('../src/linkreq');
const auth = require('../src/auth');
const { createJd } = require('./fixtures/jd-mock');

let n = 0;
function user(role = 'user', extra = {}) {
  const id = Number(db.prepare("INSERT INTO users(username, password_hash, role, created_at) VALUES (?, 'x', ?, ?)").run('lr' + ++n, role, now()).lastInsertRowid);
  for (const [k, v] of Object.entries(extra)) db.prepare(`UPDATE users SET ${k} = ? WHERE id = ?`).run(v, id);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  return { ...u, isAdmin: role === 'admin', canUpload: role === 'admin', canPrivate: role === 'admin' || !!u.can_private, name: u.username, groups: [] };
}
const until = async (fn, ms = 5000) => {
  const t = Date.now();
  for (;;) { const v = fn(); if (v) return v; if (Date.now() - t > ms) throw new Error('Zeit abgelaufen'); await new Promise(r => setTimeout(r, 30)); }
};
const status = id => lr.get(id).status;

let jd;
const admin = user('admin');
test.before(async () => {
  jd = createJd({ outDir: process.env.JD_DIR });
  setSetting('jd_url', await jd.listen());
  setSetting('jd_rules', JSON.stringify({ minFreeGb: 0 }));
});
test.after(() => jd.close());

test('Links prüfen: nur http(s) ins Internet', async () => {
  await assert.rejects(lr.checkUrl('ftp://example.com/x'), /http/);
  await assert.rejects(lr.checkUrl('http://localhost:3128/jd/version'), /Interne/);
  await assert.rejects(lr.checkUrl('http://192.168.1.10/x.mp3'), /Interne/);
  await assert.rejects(lr.checkUrl('http://jdownloader2:3128/'), /Interne/);
  await assert.rejects(lr.checkUrl('http://[::1]/'), /Interne/);
  await assert.rejects(lr.checkUrl('https://user:pw@example.com/'), /Kennwort/);
  assert.equal(await lr.checkUrl(' https://www.youtube.com/watch?v=dQw4w9WgXcQ '), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(lr.guessKind('https://www.youtube.com/playlist?list=PL123'), 'playlist');
  assert.equal(lr.guessKind('https://youtu.be/dQw4w9WgXcQ'), 'musik');
  assert.equal(lr.guessKind('https://example.com/save.zip'), 'datei');
  assert.equal(lr.youtubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3'), 'dQw4w9WgXcQ');
});

test('Variante nach Regeln: Musik nur Ton, Video bis zur Höchstauflösung', () => {
  const list = require('./fixtures/jd-mock').VARIANTS;
  const r = lr.rules();
  assert.equal(lr.pickVariant(list, r.musik, true).format, 'm4a');
  assert.equal(lr.pickVariant(list, { ...r.musik, order: ['opus', 'm4a'] }, true).format, 'opus');
  const v = lr.pickVariant(list, r.video, false);
  assert.equal(v.res, 1080); assert.equal(v.format, 'mp4');
  assert.equal(lr.pickVariant(list, { ...r.video, maxRes: 720 }, false).format, 'webm');
  assert.equal(lr.pickVariant(list, { order: ['mp3'] }, true), null);
});

test('Wer vorschlagen darf, offene Grenze, Privat nur mit Recht', async () => {
  const m = user();
  assert.ok(lr.canSuggest(m));
  assert.ok(!lr.canSuggest(null));
  assert.deepEqual(lr.allowedKinds(m).includes('privat'), false);
  setSetting('jd_rules', JSON.stringify({ minFreeGb: 0, maxOpen: 2, autoCheck: false }));
  const ids = await lr.suggest(m, { urls: 'https://example.com/a.zip\nhttps://example.com/b.zip', kind: 'privat' });
  assert.equal(lr.get(ids[0]).kind, 'datei', 'Privat ohne Recht wird zur erkannten Art');
  await assert.rejects(lr.suggest(m, { urls: 'https://example.com/c.zip' }), /offene Vorschläge/);
  await lr.withdraw(ids[0], m);
  assert.equal(status(ids[0]), 'withdrawn');
  setSetting('jd_rules', JSON.stringify({ minFreeGb: 0, who: 'off' }));
  assert.ok(!lr.canSuggest(m));
  assert.ok(lr.canSuggest(admin));
  setSetting('jd_rules', JSON.stringify({ minFreeGb: 0 }));
  // Admin bekommt eine Benachrichtigung
  assert.ok(db.prepare("SELECT 1 FROM notifications WHERE user_id = ? AND key = 'linkreq-new'").get(admin.id));
});

test('YouTube-Playlist: prüfen, genehmigen, laden, als Playlist einsortieren', async () => {
  const m = user();
  // Ein Video gibt es schon: wird nicht geladen, kommt aber in die Playlist
  const had = Number(db.prepare(`INSERT INTO tracks(title, original_name, stored_name, size, visibility, uploader_id, created_at, kind, source_id, source_url)
                                 VALUES ('Lofi', 'x.m4a', 'x.m4a', 1, 'members', ?, ?, 'audio', 'youtube:aaaaaaaaaa2', 'https://www.youtube.com/watch?v=aaaaaaaaaa2')`).run(admin.id, now()).lastInsertRowid);
  const [id] = await lr.suggest(m, { urls: 'https://www.youtube.com/playlist?list=PLchill', kind: 'playlist', mode: 'audio', visibility: 'members', note: 'für Freitag' });
  await until(() => status(id) === 'checked');
  const d = lr.detail(id);
  assert.equal(d.title, 'Chill Mix 2026', 'Name der Playlist aus JDownloader');
  const chosen = d.items.filter(i => i.chosen);
  assert.equal(chosen.length, 2);
  assert.ok(chosen.every(i => i.name.endsWith('.m4a')), 'nur Ton als M4A');
  assert.ok(d.items.some(i => i.existing_track === had && i.note === 'schon im Mediaplayer'));
  assert.ok(d.items.filter(i => i.name.endsWith('.srt')).every(i => !i.chosen && /Beiwerk/.test(i.note)));
  assert.equal(jd.downloads.links.length, 0, 'vor der Freigabe wird nichts geladen');

  await lr.approve(id, admin.id, {});
  assert.equal(jd.crawled.links.length, 0, 'Rest aus dem Linksammler entfernt');
  assert.equal(jd.downloads.links.length, 2, 'nur die zwei gewählten Links laden');
  await lr.tick();
  await until(() => status(id) === 'done');
  const res = JSON.parse(lr.get(id).result);
  assert.equal(res.tracks.length, 2);
  const tracks = res.tracks.map(t => db.prepare('SELECT * FROM tracks WHERE id = ?').get(t));
  assert.ok(tracks.every(t => t.uploader_id === admin.id && t.requested_by === m.id && t.source_id.startsWith('youtube:') && t.kind === 'audio'));
  assert.ok(tracks.every(t => fs.existsSync(path.join(MUSIC_DIR, t.stored_name))));
  assert.ok(tracks.some(t => t.stored_name === path.join('ChillNation', 'Sunset Drive.m4a')), 'Ablage nach Interpret/Titel');
  const pl = db.prepare('SELECT * FROM playlists WHERE id = ?').get(res.playlist);
  assert.equal(pl.user_id, m.id); assert.equal(pl.title, 'Chill Mix 2026');
  const order = db.prepare('SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position').all(pl.id).map(r => r.track_id);
  assert.deepEqual(order, [res.tracks[0], had, res.tracks[1]], 'Reihenfolge wie bei YouTube, vorhandener Titel dabei');
  assert.equal(jd.downloads.packages.length, 0, 'fertiges Paket aus JDownloader entfernt');
  assert.ok(!fs.existsSync(path.join(process.env.JD_DIR, 'hp-' + id)), 'Ordner aufgeräumt');
  assert.ok(db.prepare("SELECT 1 FROM notifications WHERE user_id = ? AND kind = 'vorschlag'").get(m.id), 'Mitglied bekommt Bescheid');
  // Zählt nicht auf den Speicher
  assert.equal(require('../src/quota').usedBytes(admin.id), 0);
});

test('Video mit Auto-Start (Admin): beste erlaubte Qualität, ohne Freigabe', async () => {
  const [id] = await lr.suggest(admin, { urls: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', kind: 'video', start: '1' });
  await until(() => ['queued', 'loading', 'done'].includes(status(id)));
  const d = lr.detail(id);
  assert.equal(d.items.find(i => i.chosen).variant, '1080p MP4 H.264 AAC 128kbit/s');
  await lr.tick();
  await until(() => status(id) === 'done');
  const t = db.prepare('SELECT * FROM tracks WHERE id = ?').get(JSON.parse(lr.get(id).result).tracks[0]);
  assert.equal(t.kind, 'video'); assert.ok(t.stored_name.startsWith('videos' + path.sep));
});

test('Vertrauenswürdiges Konto: lädt ohne Freigabe, aber nur unter der Grenze', async () => {
  const t = user('user', { jd_trusted: 1 });
  const [small] = await lr.suggest(t, { urls: 'https://youtu.be/ccccccccccc', kind: 'musik' });
  await until(() => ['queued', 'loading', 'sorting', 'done'].includes(status(small)));
  setSetting('jd_rules', JSON.stringify({ minFreeGb: 0, trustedMaxGb: 0.01 }));
  const [big] = await lr.suggest(t, { urls: 'https://www.youtube.com/watch?v=bbbbbbbbbbb', kind: 'video' });
  await until(() => status(big) === 'checked');
  await new Promise(r => setTimeout(r, 100));
  assert.equal(status(big), 'checked', '80 MB über der Grenze: wartet auf Freigabe');
  setSetting('jd_rules', JSON.stringify({ minFreeGb: 0 }));
  await lr.tick();
});

test('Privat: eigener Bereich, nur mit Recht sichtbar, nicht in Lobby-Listen', async () => {
  const p = user('user', { can_private: 1 }), other = user();
  assert.ok(lr.allowedKinds(p).includes('privat'));
  const [id] = await lr.suggest(p, { urls: 'https://cdn.example.com/clip.mp4', kind: 'privat', visibility: 'private' });
  await until(() => status(id) === 'checked');
  await lr.approve(id, admin.id, {});
  await lr.tick();
  await until(() => status(id) === 'done');
  const t = db.prepare('SELECT * FROM tracks WHERE id = ?').get(JSON.parse(lr.get(id).result).tracks[0]);
  assert.equal(t.privat, 1); assert.equal(t.visibility, 'members');
  assert.ok(t.stored_name.startsWith('privat' + path.sep));
  assert.ok(auth.canSee(p, 'track', t));
  assert.ok(!auth.canSee(other, 'track', t), 'ohne Recht unsichtbar');
  assert.ok(!auth.canSee(null, 'track', t));
  const v = auth.visibilitySql(p, 'track', 't', { noPrivat: true });
  assert.ok(!db.prepare(`SELECT 1 FROM tracks t WHERE t.id = ? AND ${v.sql}`).get(t.id, ...v.params), 'noPrivat lässt es weg');
  const fv = require('../src/filesview');
  assert.ok(fv.build(p, 'privat').rows.some(r => r.ref === 'titel:' + t.id));
  assert.ok(!fv.build(p, 'neu').rows.some(r => r.ref === 'titel:' + t.id), 'nicht in Neu hinzugefügt');
  assert.equal(fv.build(other, 'privat').node, 'alle');
});

test('Datei: Quarantäne bei falschem Inhalt, Ablehnen mit Grund', async () => {
  const m = user();
  const [id] = await lr.suggest(m, { urls: 'https://example.com/fake-save.zip', kind: 'datei' });
  await until(() => status(id) === 'checked');
  await lr.approve(id, admin.id, {});
  await lr.tick();
  await until(() => status(id) === 'failed');
  const r = lr.detail(id);
  assert.match(r.skipped[0].why, /ausführbares Programm/);
  assert.ok(fs.existsSync(path.join(process.env.JD_DIR, 'quarantaene', 'hp-' + id, 'fake-save.zip')));
  assert.ok(!db.prepare('SELECT 1 FROM files WHERE source_url = ?').get('https://example.com/fake-save.zip'));

  const [ok] = await lr.suggest(m, { urls: 'https://example.com/Savegame%201.zip', kind: 'datei' });
  await until(() => status(ok) === 'checked');
  await lr.approve(ok, admin.id, {});
  await lr.tick();
  await until(() => status(ok) === 'done');
  const f = db.prepare('SELECT * FROM files WHERE id = ?').get(JSON.parse(lr.get(ok).result).files[0]);
  assert.equal(f.original_name, 'Savegame 1.zip'); assert.ok(fs.existsSync(path.join(UPLOAD_DIR, f.stored_name)));

  const [bad] = await lr.suggest(m, { urls: 'https://example.com/tool.exe', kind: 'datei' });
  await until(() => status(bad) === 'checked');
  assert.match(lr.detail(bad).items[0].note, /nie erlaubt/);
  await assert.rejects(lr.approve(bad, admin.id, {}), /Nichts ausgewählt/);
  await lr.reject(bad, admin.id, 'Keine Programme');
  assert.equal(status(bad), 'rejected');
  assert.equal(lr.get(bad).reason, 'Keine Programme');
  await assert.rejects(lr.withdraw(bad, m), /nicht mehr/);
});

test('Nicht genug Platz: Genehmigen wird verweigert', async () => {
  setSetting('jd_rules', JSON.stringify({ minFreeGb: 1e6 }));
  const [id] = await lr.suggest(admin, { urls: 'https://example.com/big.zip', kind: 'datei' });
  await until(() => status(id) === 'checked');
  await assert.rejects(lr.approve(id, admin.id, {}), /Zu wenig Platz/);
  assert.equal(status(id), 'checked');
  setSetting('jd_rules', JSON.stringify({ minFreeGb: 0 }));
});
