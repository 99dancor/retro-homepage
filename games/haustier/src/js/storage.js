// Speichern und Laden.
//   Gäste:       nur im Browser (localStorage)
//   Angemeldet:  im Konto über die Spielstand-Schnittstelle der Homepage, dazu eine lokale Kopie,
//                damit nichts verloren geht, wenn die Verbindung kurz weg ist.
//
// Schnittstelle (retro-homepage, src/routes/saves.js):
//   GET  <savesUrl>          -> 200 { user, slots } | 401 ohne Login
//   GET  <savesUrl>/<slot>   -> 200 { data, updated_at } | 404 wenn leer
//   PUT  <savesUrl>/<slot>   <- { data: "<Text>" }
import { parse, serialize, isEmpty, newState } from './state.js';

const PREFIX = 'haustier:v1:';
export const KEYS = {
  guest: PREFIX + 'guest',
  user: (name) => PREFIX + 'user:' + name,
  lastUser: PREFIX + 'lastUser',
  prefs: PREFIX + 'prefs',
};

// localStorage kann fehlen oder werfen (privater Modus, gesperrte Website-Daten)
export function safeLocal(ls) {
  return {
    get(k) { try { return ls ? ls.getItem(k) : null; } catch { return null; } },
    set(k, v) { try { if (ls) ls.setItem(k, v); return true; } catch { return false; } },
    remove(k) { try { if (ls) ls.removeItem(k); } catch { /* egal */ } },
  };
}

const newer = (a, b) => (!a ? b : !b ? a : (b.updatedAt > a.updatedAt ? b : a));

// Entscheidet beim Start eines angemeldeten Besuchers, welcher Spielstand gilt.
//   remote:    Stand im Konto
//   userCache: lokale Kopie des Kontostands (kann neuer sein, wenn das letzte Hochladen scheiterte)
//   guest:     Gast-Spielstand aus diesem Browser
export function decide({ remote, userCache, guest }) {
  const base = newer(remote, userCache);
  const push = !!base && base === userCache && (!remote || userCache.updatedAt > remote.updatedAt);
  if (guest && !isEmpty(guest)) {
    if (!base || isEmpty(base)) return { state: guest, push: true, imported: true, dropGuest: true, conflict: false };
    return { state: base, push, imported: false, dropGuest: false, conflict: true };
  }
  return { state: base || newState(), push: push || !base, imported: false, dropGuest: !!guest, conflict: false };
}

export function createStore({ savesUrl = '/api/saves/haustier', slot = 'main', ls, fetchFn, debounceMs = 1500,
  onStatus = () => {}, onReplace = () => {} } = {}) {
  const local = safeLocal(ls);
  const doFetch = fetchFn || ((...a) => fetch(...a));
  let mode = 'guest';      // 'guest' | 'account'
  let user = null;
  let current = null;
  let timer = null;
  let dirty = false;
  let offlineBase = null;  // gesetzt, solange der Konto-Stand nach einem Offline-Start noch nicht abgeglichen ist

  const status = (s, extra) => onStatus({ status: s, mode, user, ...extra });
  const localKey = () => (mode === 'account' ? KEYS.user(user) : KEYS.guest);

  async function getRemote() {
    const r = await doFetch(`${savesUrl}/${slot}`, { credentials: 'same-origin', cache: 'no-store' });
    if (r.status === 404) return null;
    if (r.status === 401) throw Object.assign(new Error('login'), { code: 401 });
    if (!r.ok) throw new Error('http ' + r.status);
    const body = await r.json();
    return parse(body.data);
  }

  async function putRemote(state, keepalive = false) {
    const r = await doFetch(`${savesUrl}/${slot}`, {
      method: 'PUT', credentials: 'same-origin', keepalive,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: serialize(state) }),
    });
    if (r.status === 401) throw Object.assign(new Error('login'), { code: 401 });
    if (!r.ok) throw new Error('http ' + r.status);
  }

  // Wer spielt? Ohne Netz gilt der zuletzt bekannte Nutzer weiter, damit sein Stand nicht im Gastplatz landet.
  async function connect() {
    try {
      const r = await doFetch(savesUrl, { credentials: 'same-origin', cache: 'no-store' });
      if (r.ok) {
        const body = await r.json();
        mode = 'account'; user = body.user;
        local.set(KEYS.lastUser, user);
        return { mode, user, online: true };
      }
      if (r.status === 401) { local.remove(KEYS.lastUser); mode = 'guest'; user = null; return { mode, user, online: true }; }
    } catch { /* offline */ }
    const last = local.get(KEYS.lastUser);
    if (last) { mode = 'account'; user = last; } else { mode = 'guest'; user = null; }
    return { mode, user, online: false };
  }

  // Lädt den gültigen Stand. Gibt zusätzlich Hinweise zurück:
  //   imported: Gast-Stand wurde ins Konto übernommen
  //   conflict: { account, guest } – beide haben Fortschritt, der Spieler soll wählen
  async function load() {
    const info = await connect();
    const guest = parse(local.get(KEYS.guest));
    if (mode === 'guest') {
      current = guest || newState();
      if (!guest) local.set(KEYS.guest, serialize(current));
      status('local');
      return { state: current, ...info };
    }
    const userCache = parse(local.get(KEYS.user(user)));
    let remote = null, online = info.online;
    if (online) {
      try { remote = await getRemote(); } catch { online = false; }
    }
    if (!online) {
      // Ohne Konto-Stand nichts entscheiden: mit der lokalen Kopie weiterspielen, später hochladen
      current = userCache || newState();
      offlineBase = userCache ? userCache.updatedAt : 0;
      dirty = true;
      status('offline');
      return { state: current, ...info, online: false };
    }
    const d = decide({ remote, userCache, guest });
    current = d.state;
    local.set(KEYS.user(user), serialize(current));
    if (d.dropGuest) local.remove(KEYS.guest);
    if (d.push) { dirty = true; await flush(); } else status('saved');
    return { state: current, ...info, imported: d.imported, conflict: d.conflict ? { account: current, guest } : null };
  }

  // Antwort auf den Konflikt: 'account' behält den Kontostand, 'guest' überschreibt ihn mit dem Gast-Stand
  async function resolveConflict(choice) {
    const guest = parse(local.get(KEYS.guest));
    if (choice === 'guest' && guest) {
      guest.updatedAt = Date.now();
      current = guest;
      local.set(KEYS.user(user), serialize(current));
      dirty = true;
      await flush();
    }
    local.remove(KEYS.guest);
    return current;
  }

  function save(state) {
    state.updatedAt = Math.max(Date.now(), (current && current.updatedAt) || 0);
    current = state;
    const ok = local.set(localKey(), serialize(state));
    if (mode === 'guest') { status(ok ? 'local' : 'nostore'); return; }
    dirty = true;
    status('pending');
    clearTimeout(timer);
    timer = setTimeout(() => { flush(); }, debounceMs);
  }

  async function flush(keepalive = false) {
    clearTimeout(timer); timer = null;
    if (mode !== 'account' || !dirty || !current) return true;
    status('saving');
    try {
      if (offlineBase !== null && !keepalive) {
        // Nach einem Offline-Start: Hat sich der Konto-Stand seitdem geändert, gewinnt er,
        // damit ein leerer Offline-Stand nie echten Fortschritt überschreibt.
        const remote = await getRemote();
        const base = offlineBase;
        offlineBase = null;
        if (remote && remote.updatedAt > base) {
          current = remote; dirty = false;
          local.set(KEYS.user(user), serialize(current));
          status('saved');
          onReplace(remote);
          return true;
        }
      }
      if (offlineBase !== null) { status('offline'); return false; }
      const snapshot = current;
      await putRemote(snapshot, keepalive);
      if (current === snapshot) dirty = false;
      status(dirty ? 'pending' : 'saved');
      return true;
    } catch (e) {
      status(e.code === 401 ? 'loggedout' : 'error');
      return false;
    }
  }

  // Anderes Gerät oder anderer Tab hat inzwischen gespeichert? Dann den neueren Stand zurückgeben.
  async function refresh() {
    if (mode !== 'account' || dirty) return null;
    try {
      const remote = await getRemote();
      if (remote && current && remote.updatedAt > current.updatedAt) {
        current = remote;
        local.set(KEYS.user(user), serialize(current));
        status('saved');
        return remote;
      }
    } catch { /* später nochmal */ }
    return null;
  }

  function reset() {
    const s = newState();
    save(s);
    return s;
  }

  function prefs() {
    try { return JSON.parse(local.get(KEYS.prefs)) || {}; } catch { return {}; }
  }
  function setPrefs(p) { local.set(KEYS.prefs, JSON.stringify({ ...prefs(), ...p })); }

  return {
    load, save, flush, refresh, reset, resolveConflict, prefs, setPrefs,
    get mode() { return mode; }, get user() { return user; }, get dirty() { return dirty; },
  };
}
