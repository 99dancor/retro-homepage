'use strict';
// Paint-Lobbys ohne Browser: zwei Maler schicken gleichzeitig Änderungen, alle Teilnehmer kommen auf dasselbe Bild,
// Rückgängig nur für eigene Änderungen, Entwürfe und Speichern mit Mitmalern. Dazu PNG lesen und schreiben.
// Aufruf: node --test test/paintlobby.test.js (läuft mit npm test)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'paintlobby-test-'));
process.env.PUID = '0';
const P = require('../public/paint-core');
const png = require('../src/png');
const { db } = require('../src/db');
const paint = require('../src/paint');
const L = require('../src/paintlobby');

const WHITE = 0xffffff, RED = 0xff0000, BLUE = 0x0000ff;
for (const [id, name] of [[1, 'anna'], [2, 'ben'], [3, 'cem']]) {
  db.prepare("INSERT INTO users(id, username, password_hash, role, created_at) VALUES (?, ?, 'x', 'user', 0)").run(id, name);
}
const user = (id, name) => ({ id, username: name, name, isAdmin: false, canUpload: false });
const anna = user(1, 'anna'), ben = user(2, 'ben'), cem = user(3, 'cem');

// Ein Teilnehmer, wie ihn der Browser darstellt: liest den Strom mit und malt jede Änderung nach
function client(l, u) {
  const c = { sid: null, events: [], img: null, pending: new Map() };
  const res = {
    write(chunk) {
      const m = /^event: (\w+)\ndata: (.*)\n\n$/s.exec(chunk);
      if (!m) return;
      const ev = m[1], data = JSON.parse(m[2]);
      c.events.push([ev, data]);
      if (ev === 'hello') c.sid = data.sid;
      if (ev === 'op') apply(c, data);
      if (ev === 'ack') {
        const p = c.pending.get(data.cid);
        c.pending.delete(data.cid);
        if (p.cmd) c.img = P.run(c.img, p.cmd, 2000, 2000); else P.blit(c.img, p.patch, p.x, p.y);
      }
    },
    end() {},
  };
  c.img = png.decode(L.snapshot(l).buf);
  c.leave = L.join(l, u, res);
  return c;
}
function apply(c, m) {
  if (m.kind === 'patch') P.blit(c.img, png.decode(Buffer.from(m.data, 'base64')), m.x, m.y);
  else if (m.kind === 'put') c.img = png.decode(Buffer.from(m.data, 'base64'));
  else c.img = P.run(c.img, m.cmd, 2000, 2000);
}
// Änderung wie im Browser: nur die geänderten Pixel, alles andere durchsichtig
function patchOf(before, after) {
  const p = P.clone(after);
  for (let i = 0; i < p.d.length; i += 4) if (p.d[i] === before.d[i] && p.d[i + 1] === before.d[i + 1] && p.d[i + 2] === before.d[i + 2]) p.d[i + 3] = 0;
  return p;
}
let cids = 0;
// Malen und erst später abschicken (so wie zwei Browser, die gleichzeitig malen)
function prepare(l, c, u, fn) {
  const before = P.clone(c.img), after = P.clone(c.img);
  fn(after);
  const patch = patchOf(before, after), cid = 'c' + (++cids);
  return () => {
    c.pending.set(cid, { patch, x: 0, y: 0 });
    return L.op(l, u, { cid, x: 0, y: 0, data: png.encode(patch).toString('base64') }, c.sid);
  };
}
const draw = (l, c, u, fn) => prepare(l, c, u, fn)();

test('PNG: lesen, was geschrieben wurde, auch mit Durchsichtigem', () => {
  const b = P.create(33, 17, 0x123456);
  P.line(b, 0, 0, 32, 16, RED, 3);
  assert.equal(P.hash(png.decode(png.encode(b))), P.hash(b));
  const t = { w: 4, h: 2, d: new Uint8ClampedArray(32) };
  t.d.set([10, 20, 30, 255], 4);
  const back = png.decode(png.encode(t));
  assert.deepEqual([...back.d.subarray(4, 8)], [10, 20, 30, 255]);
  assert.equal(back.d[3], 0);
  assert.equal(png.decode(Buffer.from('kein png')), null);
  assert.equal(png.decode(png.encode(P.create(100, 100)), 50 * 50), null, 'zu viele Pixel');
  assert.deepEqual([png.thumb(P.create(1000, 500)).w, png.thumb(P.create(1000, 500)).h], [240, 120]);
});

test('zwei malen gleichzeitig: alle haben danach dasselbe Bild wie der Server', () => {
  const l = L.create(anna, { name: 'Test' }, P.create(60, 40, WHITE));
  const a = client(l, anna), b = client(l, ben), watcher = client(l, cem);
  // Beide malen auf ihrem Stand, bevor sie die Änderung des anderen kennen
  const sa = prepare(l, a, anna, x => P.line(x, 0, 0, 59, 39, RED, 3));
  const sb = prepare(l, b, ben, x => P.shape(x, 'rect', 10, 5, 50, 35, { stroke: BLUE, fill: null, width: 2 }));
  const ra = sa(), rb = sb();
  assert.ok(ra.seq && rb.seq);
  const server = png.decode(L.snapshot(l).buf);
  for (const c of [a, b, watcher]) assert.equal(P.hash(c.img), P.hash(server));
  assert.ok(watcher.events.some(([e]) => e === 'op'));
  assert.ok(!a.events.some(([e, d]) => e === 'op' && d.by === anna.id), 'eigene Änderung kommt nur als Bestätigung');
  // Befehl für das ganze Bild: Gemaltes dreht sich mit
  a.pending.set('r', { cmd: { t: 'rotate', deg: 90 } });
  assert.ok(L.op(l, anna, { cid: 'r', cmd: { t: 'rotate', deg: 90 } }, a.sid).seq);
  assert.deepEqual([l.img.w, l.img.h], [40, 60]);
  for (const c of [a, b, watcher]) assert.equal(P.hash(c.img), P.hash(l.img));
  for (const c of [a, b, watcher]) c.leave();
  L.remove(l);
});

test('Rückgängig: nur eigene Änderungen und nur, wenn niemand darübergemalt hat', () => {
  const l = L.create(anna, {}, P.create(30, 30, WHITE));
  const a = client(l, anna), b = client(l, ben);
  draw(l, a, anna, x => P.fillRect(x, 0, 0, 10, 10, RED));
  draw(l, b, ben, x => P.fillRect(x, 20, 20, 5, 5, BLUE));
  assert.equal(L.undo(l, cem, 'x', 'u').error !== undefined, true, 'wer nichts gemalt hat, kann nichts zurücknehmen');
  // Bens Änderung liegt woanders: Anna kann zurücknehmen
  assert.ok(L.undo(l, anna, a.sid, 'u1').seq);
  assert.equal(P.get(l.img, 5, 5), WHITE);
  assert.equal(P.get(l.img, 22, 22), BLUE, 'Bens Kästchen bleibt');
  assert.equal(P.hash(a.img), P.hash(l.img));
  assert.equal(P.hash(b.img), P.hash(l.img));
  // Wiederholen bringt es zurück
  assert.ok(L.redo(l, anna, a.sid, 'r1').seq);
  assert.equal(P.get(l.img, 5, 5), RED);
  // Ben malt über Annas Fläche: jetzt geht Annas Rückgängig nicht mehr
  draw(l, b, ben, x => P.fillRect(x, 5, 5, 3, 3, BLUE));
  assert.match(L.undo(l, anna, a.sid, 'u2').error, /darüber gemalt/);
  assert.equal(P.get(l.img, 6, 6), BLUE);
  a.leave(); b.leave();
  L.remove(l);
});

test('Malrechte, Unterhaltung und Gastgeberwechsel', () => {
  const l = L.create(anna, { everyone: false }, P.create(20, 20, WHITE));
  const a = client(l, anna), b = client(l, ben);
  assert.match(draw(l, b, ben, x => P.set(x, 1, 1, RED)).error, /zusehen/);
  assert.match(L.control(l, ben, { action: 'rights', user: ben.id, allow: true }), /Gastgeber/);
  assert.equal(L.control(l, anna, { action: 'rights', user: ben.id, allow: true }), null);
  assert.ok(draw(l, b, ben, x => P.set(x, 1, 1, RED)).seq);
  assert.equal(L.chat(l, ben, '  Hallo  '), null);
  assert.ok(a.events.some(([e, d]) => e === 'chat' && d.text === 'Hallo' && d.user === 'ben'));
  L.control(l, anna, { action: 'settings', chat: false });
  assert.match(L.chat(l, ben, 'x'), /ausgeschaltet/);
  a.leave();
  assert.equal(l.hostId, ben.id, 'wer noch da ist, wird Gastgeber');
  b.leave();
  L.remove(l);
});

test('Entwurf beim Ersteller, Speichern mit Mitmalern', () => {
  const l = L.create(anna, { name: 'Bunt' }, P.create(20, 20, WHITE));
  const a = client(l, anna), b = client(l, ben), c = client(l, cem);
  draw(l, a, anna, x => P.set(x, 1, 1, RED));
  draw(l, b, ben, x => P.set(x, 2, 2, BLUE));
  L.saveDraft(l);
  const d = db.prepare('SELECT * FROM artworks WHERE id = ?').get(l.draftId);
  assert.equal(d.draft, 1);
  assert.equal(d.owner_id, anna.id);
  assert.equal(d.visibility, 'private');
  assert.deepEqual(paint.painters(d.id).map(p => p.user), ['ben'], 'nur wer gemalt hat');
  assert.ok(paint.canSee(ben, paint.get(d.id)), 'Mitmaler sehen den Entwurf');
  assert.ok(!paint.canSee(cem, paint.get(d.id)));
  assert.ok(fs.existsSync(paint.file(d.stored_name)));
  // Ben speichert eine eigene Kopie und nimmt Cem (hat nur zugesehen) bewusst mit auf
  const r = L.save(l, ben, { title: 'Bens Bild', visibility: 'private', painters: [anna.id, cem.id] });
  assert.ok(r.id);
  assert.deepEqual(paint.painters(r.id).map(p => p.user).sort(), ['anna', 'cem']);
  assert.equal(paint.get(r.id).owner_id, ben.id);
  assert.deepEqual(paint.shared(anna.id).map(x => x.id), [r.id], 'Anna findet Bens Bild unter „Gemeinsam gemalt“');
  // Anna speichert: ihr Entwurf ist überholt und verschwindet
  const draftFile = paint.file(d.stored_name);
  const own = L.save(l, anna, { title: 'Annas Bild', visibility: 'members' });
  assert.equal(paint.get(own.id).draft, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM artworks WHERE id = ?').get(d.id).n, 0);
  setTimeout(() => assert.ok(!fs.existsSync(draftFile)), 50);
  // Konto weg: Einträge als Mitmaler verschwinden mit
  db.prepare('DELETE FROM users WHERE id = ?').run(cem.id);
  assert.deepEqual(paint.painters(r.id).map(p => p.user), ['anna']);
  for (const x of [a, b, c]) x.leave();
  L.remove(l);
});
