import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newState, parse, serialize, registerVisit, migrate, daysBetween } from '../src/js/state.js';
import { createStore, decide, KEYS } from '../src/js/storage.js';

function memLocal() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}

// Nachbau der Spielstand-Schnittstelle der Homepage
function fakeServer({ user = null, online = true } = {}) {
  const saves = new Map();
  const srv = { user, online, saves, puts: 0 };
  srv.fetch = async (url, opts = {}) => {
    if (!srv.online) throw new TypeError('offline');
    const res = (status, body) => ({ status, ok: status < 300, json: async () => body });
    if (!srv.user) return res(401, { error: 'login' });
    const slot = url.split('/')[4];
    if (!slot) return res(200, { user: srv.user, slots: [] });
    if (opts.method === 'PUT') { srv.puts++; saves.set(slot, JSON.parse(opts.body).data); return res(200, { ok: true }); }
    return saves.has(slot) ? res(200, { data: saves.get(slot) }) : res(404, { error: 'empty' });
  };
  return srv;
}

const withProgress = (coins, t) => { const s = newState(t); s.coins = coins; return s; };

test('Besuche: Serie zählt nur aufeinanderfolgende Tage', () => {
  const s = newState();
  const day = (d, h = 12) => new Date(2026, 9, d, h).getTime();
  assert.equal(registerVisit(s, day(1)), true);
  assert.equal(registerVisit(s, day(1, 20)), false);
  registerVisit(s, day(2));
  registerVisit(s, day(3));
  assert.deepEqual([s.visits.streak, s.visits.best, s.visits.total], [3, 3, 3]);
  registerVisit(s, day(5));
  assert.deepEqual([s.visits.streak, s.visits.best, s.visits.total], [1, 3, 4]);
  assert.equal(daysBetween('2026-03-28', '2026-03-30'), 2); // über die Zeitumstellung hinweg
});

test('Spielstand: kaputte oder fremde Daten werden abgelehnt, alte ergänzt', () => {
  assert.equal(parse('kein json'), null);
  assert.equal(parse(JSON.stringify({ foo: 1 })), null);
  assert.equal(parse(JSON.stringify({ version: 99 })), null);
  const s = migrate({ version: 1, coins: 5 });
  assert.equal(s.coins, 5);
  assert.deepEqual(s.pets, []);
  assert.equal(s.visits.streak, 0);
});

test('decide: leeres Konto übernimmt Gast-Fortschritt', () => {
  const guest = withProgress(10, 1000);
  const d = decide({ remote: null, userCache: null, guest });
  assert.equal(d.state, guest);
  assert.equal(d.imported, true);
  assert.equal(d.push, true);
});

test('decide: Konto und Gast mit Fortschritt ergibt Nachfrage', () => {
  const d = decide({ remote: withProgress(3, 1000), userCache: null, guest: withProgress(10, 2000) });
  assert.equal(d.conflict, true);
  assert.equal(d.state.coins, 3);
});

test('decide: leerer Gast-Stand wird ohne Nachfrage verworfen', () => {
  const d = decide({ remote: withProgress(3, 1000), userCache: null, guest: newState(2000) });
  assert.equal(d.conflict, false);
  assert.equal(d.dropGuest, true);
  assert.equal(d.state.coins, 3);
});

test('decide: neuere lokale Kopie wird nachträglich hochgeladen', () => {
  const d = decide({ remote: withProgress(3, 1000), userCache: withProgress(4, 2000), guest: null });
  assert.equal(d.state.coins, 4);
  assert.equal(d.push, true);
});

test('Gast speichert nur im Browser', async () => {
  const ls = memLocal(), srv = fakeServer();
  const store = createStore({ ls, fetchFn: srv.fetch });
  const r = await store.load();
  assert.equal(r.mode, 'guest');
  r.state.coins = 7;
  store.save(r.state);
  assert.equal(parse(ls.getItem(KEYS.guest)).coins, 7);
  assert.equal(srv.puts, 0);
});

test('Anmelden übernimmt Gast-Stand ins Konto und räumt den Gastplatz', async () => {
  const ls = memLocal(), srv = fakeServer();
  ls.setItem(KEYS.guest, serialize(withProgress(12, 1000)));
  srv.user = 'anna';
  const store = createStore({ ls, fetchFn: srv.fetch });
  const r = await store.load();
  assert.equal(r.imported, true);
  assert.equal(parse(srv.saves.get('main')).coins, 12);
  assert.equal(ls.getItem(KEYS.guest), null);
});

test('Konflikt: Gast-Wahl überschreibt das Konto', async () => {
  const ls = memLocal(), srv = fakeServer({ user: 'anna' });
  srv.saves.set('main', serialize(withProgress(3, 1000)));
  ls.setItem(KEYS.guest, serialize(withProgress(12, 2000)));
  const store = createStore({ ls, fetchFn: srv.fetch });
  const r = await store.load();
  assert.ok(r.conflict);
  const s = await store.resolveConflict('guest');
  assert.equal(s.coins, 12);
  assert.equal(parse(srv.saves.get('main')).coins, 12);
  assert.equal(ls.getItem(KEYS.guest), null);
});

test('Speichern im Konto wird gebündelt und per flush hochgeladen', async () => {
  const ls = memLocal(), srv = fakeServer({ user: 'anna' });
  const store = createStore({ ls, fetchFn: srv.fetch, debounceMs: 10000 });
  const { state } = await store.load();
  const before = srv.puts;
  state.coins = 1; store.save(state);
  state.coins = 2; store.save(state);
  assert.equal(srv.puts, before);
  await store.flush();
  assert.equal(srv.puts, before + 1);
  assert.equal(parse(srv.saves.get('main')).coins, 2);
});

test('Offline-Start überschreibt nie einen neueren Konto-Stand', async () => {
  const ls = memLocal(), srv = fakeServer({ user: 'anna' });
  ls.setItem(KEYS.lastUser, 'anna');
  srv.saves.set('main', serialize(withProgress(50, Date.now() - 1000)));
  srv.online = false;
  let replaced = null;
  const store = createStore({ ls, fetchFn: srv.fetch, debounceMs: 10000, onReplace: (s) => { replaced = s; } });
  const r = await store.load();
  assert.equal(r.mode, 'account');
  assert.equal(r.state.coins, 0);
  r.state.coins = 1; store.save(r.state);
  srv.online = true;
  await store.flush();
  assert.equal(parse(srv.saves.get('main')).coins, 50);
  assert.equal(replaced.coins, 50);
});

test('Offline mit lokaler Kopie lädt die Kopie später hoch', async () => {
  const ls = memLocal(), srv = fakeServer({ user: 'anna' });
  const t = Date.now() - 5000;
  srv.saves.set('main', serialize(withProgress(5, t)));
  ls.setItem(KEYS.lastUser, 'anna');
  ls.setItem(KEYS.user('anna'), serialize(withProgress(5, t)));
  srv.online = false;
  const store = createStore({ ls, fetchFn: srv.fetch, debounceMs: 10000 });
  const r = await store.load();
  r.state.coins = 6; store.save(r.state);
  srv.online = true;
  await store.flush();
  assert.equal(parse(srv.saves.get('main')).coins, 6);
});

test('Abgelaufene Anmeldung meldet loggedout', async () => {
  const ls = memLocal(), srv = fakeServer({ user: 'anna' });
  const seen = [];
  const store = createStore({ ls, fetchFn: srv.fetch, debounceMs: 10000, onStatus: (s) => seen.push(s.status) });
  const { state } = await store.load();
  srv.user = null;
  state.coins = 3; store.save(state);
  assert.equal(await store.flush(), false);
  assert.equal(seen.at(-1), 'loggedout');
  assert.equal(parse(ls.getItem(KEYS.user('anna'))).coins, 3); // lokal bleibt alles erhalten
});
