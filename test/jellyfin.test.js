'use strict';
// Jellyfin im Mediaplayer mit nachgebautem Jellyfin (test/fixtures/jf-mock.js): wer stöbern und abspielen darf, Anfrage und
// Freigabe (neues Konto mit eingeschränkten Rechten), der Schlüssel kommt nie beim Browser an (auch nicht in m3u8),
// Fortschritt landet im Konto des Mitglieds, der Proxy lässt nur Pfade eines erlaubten Titels durch.
// Aufruf: node --test test/jellyfin.test.js (läuft mit npm test)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jellyfin-test-'));
process.env.DATA_DIR = path.join(TMP, 'data');
process.env.PUID = '0';
const { db, now } = require('../src/db');
const services = require('../src/services');
const jf = require('../src/jellyfin');
const express = require('express');
const { createJf, KEY } = require('./fixtures/jf-mock');

let n = 0;
function user(role = 'user') {
  const id = Number(db.prepare("INSERT INTO users(username, password_hash, role, created_at) VALUES (?, 'x', ?, ?)").run('jf' + ++n, role, now()).lastInsertRowid);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  return { ...u, isAdmin: role === 'admin', name: u.username, groups: [] };
}
const admin = user('admin'), mia = user(), tom = user();
let mock, site, sid, srv, as = null;
const MOVIE = '0'.repeat(29) + '100', HEVC = '0'.repeat(29) + '101', SHOW = '0'.repeat(29) + '200', EP = '0'.repeat(29) + '311';

function setConf(extra = {}) {
  const r = services.save(sid, { kind: 'jellyfin', name: 'Kino', url: mock.url, key: KEY, player: '1', player_sent: '1', app: '1', view: 'members', public_url: 'https://kino.example.org', libs_sent: '1', libs: [mock.folders[0].Id], ...extra }, admin.id);
  assert.ok(!r.error, r.error);
}
function get(p, opts = {}) {
  return new Promise((resolve, reject) => {
    http.get(site + p, { headers: opts.headers || {} }, res => {
      const ch = [];
      res.on('data', c => ch.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(ch).toString('utf8') }));
    }).on('error', reject);
  });
}

test.before(async () => {
  mock = createJf();
  mock.url = await mock.listen();
  const r = services.save(null, { kind: 'jellyfin', name: 'Kino', url: mock.url, key: KEY, every: 60 }, admin.id);
  sid = r.id || db.prepare("SELECT id FROM services WHERE kind = 'jellyfin'").get().id;
  setConf();
  const app = express();
  app.use((req, res, next) => { req.user = as; next(); });
  app.use('/jellyfin', require('../src/routes/jellyfin'));
  await new Promise(ok => { srv = app.listen(0, '127.0.0.1', () => { site = 'http://127.0.0.1:' + srv.address().port; ok(); }); });
});
test.after(() => { srv.closeAllConnections(); srv.close(); return mock.close(); });

test('Einstellungen: nur mit Haken, Schlüssel und Adresse', () => {
  const c = jf.conf();
  assert.equal(c.name, 'Kino');
  assert.equal(c.publicUrl, 'https://kino.example.org');
  assert.deepEqual(c.libs, [mock.folders[0].Id]);
  setConf({ player: '' });
  assert.equal(jf.conf(), null);
  assert.deepEqual(jf.status(mia), { on: false });
  setConf();
});

test('Wer darf was: Gäste nicht, Mitglieder stöbern, Abspielen nur mit Freigabe', async () => {
  assert.equal(jf.status(null).browse, false);
  const st = jf.status(mia);
  assert.equal(st.browse, true);
  assert.equal(st.play, false);
  assert.equal(st.canRequest, true);
  setConf({ view: 'approved' });
  assert.equal(jf.status(mia).browse, false);
  assert.equal(jf.status(admin).browse, true);
  setConf({ view: 'public' });
  assert.equal(jf.status(null).browse, true);
  assert.equal(jf.status(null).canRequest, false);
  setConf();
  await assert.rejects(jf.play(mia, MOVIE), e => e.status === 403);
  // Ohne Freigabe: keine persönlichen Angaben, kein Link in die Jellyfin-Oberfläche
  const d = await jf.details(mia, MOVIE);
  assert.equal(d.name, 'Der Leuchtturm');
  assert.equal(d.app, null);
  assert.equal(d.audio.length, 2);
});

test('Zugang anfragen, Admin bekommt Bescheid, doppelt geht nicht', () => {
  const r = jf.request(mia, { message: 'Hallo, darf ich?', app: true });
  assert.deepEqual(r, { ok: true });
  assert.equal(jf.status(mia).state, 'pending');
  assert.equal(jf.status(mia).canRequest, false);
  assert.match(jf.request(mia, {}).error, /liegt schon/);
  assert.equal(jf.pendingCount(), 1);
  const note = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC').get(admin.id);
  assert.ok(note, 'Admin hat eine Benachrichtigung');
  assert.match(note.title, /Jellyfin/);
});

test('Freigeben legt ein eingeschränktes Konto an, App-Passwort genau einmal', async () => {
  const acc = await jf.approve(admin, mia.id, {});
  const u = mock.users.find(x => x.Id === acc.id);
  assert.ok(u, 'Konto in Jellyfin angelegt');
  assert.equal(u.Policy.IsAdministrator, false);
  assert.equal(u.Policy.IsHidden, true);
  assert.equal(u.Policy.EnableAllFolders, false);
  assert.deepEqual(u.Policy.EnabledFolders, [mock.folders[0].Id]);
  assert.equal(u.Policy.EnableContentDeletion, false);
  const st = jf.status(mia);
  assert.equal(st.play, true);
  assert.equal(st.app.url, 'https://kino.example.org');
  const pw = jf.takeAppPassword(mia);
  assert.match(pw, /^[A-Za-z0-9]{8,}$/);
  assert.equal(jf.takeAppPassword(mia), null);
  assert.ok(db.prepare("SELECT 1 FROM notifications WHERE user_id = ? AND title LIKE '%freigeschaltet%'").get(mia.id));
});

test('Stöbern mit eigenem Konto: Jellyfin filtert die Bibliotheken', async () => {
  const movies = await jf.browse(mia, { type: 'Movie' });
  assert.equal(movies.total, 8);
  // Serien liegen in einer Bibliothek, die das Konto nicht sehen darf
  const series = await jf.browse(mia, { type: 'Series' });
  assert.equal(series.total, 0);
  const last = mock.log.filter(x => x.path === '/Items').pop();
  assert.equal(last.query.userId, jf.status(mia).jfUser);
  const g = await jf.genres(mia, 'Movie');
  assert.ok(g.includes('Drama'));
});

test('Abspielen direkt und als HLS: der Schlüssel bleibt draußen', async () => {
  as = mia;
  const p = await jf.play(mia, MOVIE, { codecs: [] });
  assert.equal(p.mode, 'direct');
  assert.ok(!p.url.includes(KEY));
  assert.match(p.url, new RegExp('^/jellyfin/s/' + MOVIE + '/stream\\?static=true'));
  assert.equal(p.audio.length, 2);
  assert.equal(p.subs.find(s => s.index === 3).url, `/jellyfin/s/${MOVIE}/${'0'.repeat(28)}a100/Subtitles/3/0/Stream.vtt`);
  const v = await get(p.url, { headers: { range: 'bytes=0-4' } });
  assert.equal(v.status, 206);
  assert.equal(v.text, 'VIDEO');
  const h = await jf.play(mia, HEVC, { codecs: [] });
  assert.equal(h.mode, 'hls');
  assert.ok(!h.url.includes(KEY) && !/api_key/i.test(h.url), h.url);
  assert.match(h.url, new RegExp('^/jellyfin/s/' + HEVC + '/master\\.m3u8\\?'));
  const master = await get(h.url);
  assert.equal(master.status, 200);
  assert.ok(!master.text.includes(KEY), master.text);
  assert.match(master.text, /^main\.m3u8\?MediaSourceId=/m);
  const main = await get('/jellyfin/s/' + HEVC + '/main.m3u8');
  assert.ok(!main.text.includes(KEY), main.text);
  assert.match(main.text, /URI="hls1\/main\/-1\.mp4"/);
  assert.match(main.text, /^hls1\/main\/0\.ts\?runtimeTicks=0$/m);
  // Der Browser kann HEVC: dann direkt
  assert.equal((await jf.play(mia, HEVC, { codecs: ['hevc'] })).mode, 'direct');
  const vtt = await get(p.subs.find(s => s.index === 3).url);
  assert.match(vtt.text, /^WEBVTT/);
});

test('Proxy: nur gültige Pfade, nur erlaubte Titel, nur mit Freigabe', async () => {
  as = mia;
  assert.equal((await get('/jellyfin/s/' + MOVIE + '/..%2F..%2FUsers')).status, 404);
  assert.equal((await get('/jellyfin/s/' + MOVIE + '/a/../../Users')).status, 404);
  assert.equal((await get('/jellyfin/s/nicht-hex/stream')).status, 404);
  // Folge einer Serie aus der gesperrten Bibliothek
  assert.equal((await get('/jellyfin/s/' + EP + '/stream')).status, 404);
  const before = mock.log.length;
  await get('/jellyfin/s/' + MOVIE + '/stream?api_key=xyz&static=true');
  const up = mock.log.slice(before).find(x => x.path.endsWith('/stream'));
  assert.equal(up.query.api_key, undefined);
  assert.equal(up.query.static, 'true');
  as = tom;
  assert.equal((await get('/jellyfin/s/' + MOVIE + '/stream')).status, 404);
  const img = await get('/jellyfin/bild/' + MOVIE + '?w=200');
  assert.equal(img.status, 200);
  assert.match(img.headers['content-type'], /svg/);
  as = null;
  assert.equal((await get('/jellyfin/bild/' + MOVIE)).status, 404);
  const st = JSON.parse((await get('/jellyfin/status')).text);
  assert.equal(st.on, true);
  assert.equal(st.browse, false);
  assert.ok(!JSON.stringify(st).includes(KEY));
});

test('Fortschritt, gesehen und Merkliste im eigenen Konto', async () => {
  const uid = jf.status(mia).jfUser;
  await jf.progress(mia, MOVIE, { pos: 125 });
  assert.equal(mock.data[uid][MOVIE].pos, 125 * 1e7);
  await jf.progress(mia, MOVIE, { done: true, stop: true, session: 'sess1' });
  assert.equal(mock.data[uid][MOVIE].played, true);
  assert.ok(mock.log.some(x => x.method === 'DELETE' && x.path === '/Videos/ActiveEncodings' && x.query.playSessionId === 'sess1'));
  await jf.favorite(mia, MOVIE, true);
  const list = await jf.browse(mia, { type: 'all', filter: 'liste' });
  assert.deepEqual(list.items.map(x => x.id), [MOVIE]);
  await assert.rejects(jf.progress(tom, MOVIE, { pos: 1 }), e => e.status === 403);
});

test('Serien: Staffeln, nächste Folge, Folgen der Staffel', async () => {
  setConf({ libs: [] });
  // Ein neues Konto ohne Bibliotheksauswahl sieht alles
  jf.request(tom, {});
  await jf.approve(admin, tom.id, {});
  const d = await jf.details(tom, SHOW);
  assert.equal(d.seasons.length, 2);
  assert.equal(d.next.name, 'Ebbe');
  const eps = await jf.episodes(tom, SHOW, d.seasons[1].id);
  assert.deepEqual(eps.map(e => e.episode), [1, 2, 3]);
  assert.equal(eps[0].season, 2);
  const home = await jf.home(tom);
  assert.equal(home.counts.series, 1);
  assert.ok(home.episodes.length > 0);
  setConf();
});

test('Ablehnen und Entziehen: angelegtes Konto verschwindet aus Jellyfin', async () => {
  const eve = user();
  jf.request(eve, {});
  jf.deny(admin, eve.id);
  assert.equal(jf.status(eve).state, 'denied');
  assert.equal(jf.status(eve).canRequest, false);
  const id = jf.status(mia).jfUser;
  await jf.revoke(admin, mia.id);
  assert.equal(jf.status(mia).play, false);
  assert.ok(!mock.users.some(u => u.Id === id));
  // Verknüpfen mit einem vorhandenen Konto: Entziehen löscht es nicht
  await jf.approve(admin, mia.id, { link: mock.users[0].Id });
  await jf.revoke(admin, mia.id);
  assert.ok(mock.users.some(u => u.Id === mock.users[0].Id));
});

test('stripKey nimmt nur den Schlüssel heraus', () => {
  const { stripKey } = jf._;
  assert.equal(stripKey('/a/master.m3u8?x=1&api_key=abc&y=2'), '/a/master.m3u8?x=1&y=2');
  assert.equal(stripKey('seg.ts?ApiKey=abc'), 'seg.ts');
  assert.equal(stripKey('seg.ts'), 'seg.ts');
  assert.equal(stripKey('seg.ts?my_api_key=1'), 'seg.ts?my_api_key=1');
});
