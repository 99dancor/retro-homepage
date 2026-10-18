// Verbindung zum Server für Besuche (Nachbarn, fremde Zimmer, Besuchsbuch, Live-Zimmer) und den Tageswettbewerb
// (src/routes/pixelpfoten.js).
const BASE = '/api/pixelpfoten';
const csrf = () => document.body.dataset.csrf || '';

async function call(path, body) {
  const opts = body === undefined ? { cache: 'no-store' }
    : { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf() }, body: JSON.stringify(body) };
  const r = await fetch(BASE + path, opts);
  let data = {};
  try { data = await r.json(); } catch { /* leer */ }
  if (!r.ok) throw Object.assign(new Error(data.error || 'Der Server antwortet gerade nicht.'), { status: r.status });
  return data;
}

export const api = {
  neighbours: () => call('/nachbarn'),
  room: (name) => call('/zimmer/' + encodeURIComponent(name)),
  act: (name, body) => call('/zimmer/' + encodeURIComponent(name), body),
  inbox: () => call('/post'),
  done: (upTo) => call('/post', { upTo }),
  contest: () => call('/wettbewerb'),
  submit: (body) => call('/wettbewerb', body),
};

// Live-Zimmer eines Gastgebers. Hält die anderen Anwesenden mit ihren Tieren in members (sid -> Mitglied).
//   on: { change(), post(), join(member), leave(member) }
export function createLive(on) {
  let es = null, name = null, sid = null, sending = false, lastSent = 0;
  const members = new Map();

  function open(host) {
    if (name === host && es) return;
    close();
    name = host;
    es = new EventSource(BASE + '/live/' + encodeURIComponent(host));
    es.addEventListener('hello', (e) => {
      const d = JSON.parse(e.data);
      sid = d.sid;
      members.clear();
      for (const m of d.members) members.set(m.sid, m);
      on.change();
    });
    es.addEventListener('join', (e) => { const m = JSON.parse(e.data); members.set(m.sid, m); on.join && on.join(m); on.change(); });
    es.addEventListener('leave', (e) => {
      const { sid: s } = JSON.parse(e.data);
      const m = members.get(s);
      members.delete(s);
      if (m && on.leave) on.leave(m);
      on.change();
    });
    es.addEventListener('state', (e) => {
      const d = JSON.parse(e.data);
      const m = members.get(d.sid);
      if (!m) return;
      const fresh = m.pets.map((p) => p.id).join() !== d.pets.map((p) => p.id).join();
      m.pets = d.pets; m.toy = d.toy;
      if (fresh) on.change();
    });
    es.addEventListener('post', () => on.post && on.post());
    es.onerror = () => { if (es && es.readyState === EventSource.CLOSED) { members.clear(); sid = null; on.change(); } };
  }

  function close() {
    if (es) es.close();
    es = null; name = null; sid = null;
    members.clear();
  }

  // Eigenen Stand schicken, höchstens fünfmal pro Sekunde und nur, wenn jemand zuschaut
  async function send(snap) {
    if (!sid || sending || !members.size || Date.now() - lastSent < 200) return;
    sending = true; lastSent = Date.now();
    try {
      await fetch(BASE + '/live/' + encodeURIComponent(name), {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf() }, body: JSON.stringify({ sid, ...snap }),
      });
    } catch { /* nächster Versuch beim nächsten Mal */ }
    sending = false;
  }

  return {
    open, close, send, members,
    get host() { return name; },
    get connected() { return !!sid; },
  };
}
