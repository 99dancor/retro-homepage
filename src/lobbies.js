'use strict';
// Widget „Offene Lobbys“ auf dem Desktop: sammelt die Listen, die die Apps selbst schon zeigen (Kartentische, Paint,
// Mediaplayer, Werwolf, Quiz). Versteckte Tische sehen wie in den Apps nur Gastgeber und Mitspieler. Neue Daten entstehen keine.
const { db, getSetting } = require('./db');
const paint = require('./paint');

const on = k => getSetting(k, '1') === '1';
const cardsOn = () => ['bj', 'pk', 'dk', 'uno', 'f7', 'pp'].some(p => on(p + '_enabled'));

// Wer ist drin? Nur für die Sortierung „Freunde zuerst“, die Kennungen gehen nicht an den Browser
const clientsOf = l => (l && l.clients ? [...l.clients].map(c => c.user && c.user.id).filter(Boolean) : []);
const playersOf = r => (r && r.players ? [...r.players.values()].map(p => p.userId).filter(Boolean) : []);

function collect(user) {
  const out = [];
  const tryList = fn => { try { fn(); } catch (e) { console.error('Lobby-Widget:', e.message); } };
  if (cardsOn()) tryList(() => {
    for (const t of require('./kartenspiele').list(user)) {
      out.push({ app: 'kartenspiele', icon: t.icon || '🂡', what: t.title, name: t.name, host: t.host, players: t.players, max: t.seats,
        status: t.status, url: '/kartenspiele?tisch=' + encodeURIComponent(t.id), ids: t.faces.filter(Boolean).map(f => f.id) });
    }
  });
  if (paint.lobbiesOn()) tryList(() => {
    const pl = require('./paintlobby');
    for (const l of pl.list(user)) {
      out.push({ app: 'paint', icon: '🎨', what: 'Paint', name: l.name, host: l.host, players: l.people, max: pl.MAX_PEOPLE,
        status: `${l.w} × ${l.h}`, url: '/paint?lobby=' + encodeURIComponent(l.id), ids: clientsOf(pl.get(l.id)) });
    }
  });
  if (on('lobby_enabled')) tryList(() => {
    const ml = require('./lobby');
    for (const l of ml.list(user)) {
      out.push({ app: 'musik', icon: '🎵', what: 'Mediaplayer', name: l.name, host: l.host, players: l.listeners, max: null,
        status: l.now ? '▶ ' + l.now : 'Pause', url: '/musik?lobby=' + encodeURIComponent(l.id), ids: clientsOf(ml.get(l.id)) });
    }
  });
  if (on('ww_enabled')) tryList(() => {
    const ww = require('./werwolf');
    for (const r of ww.list()) {
      out.push({ app: 'werwolf', icon: '🐺', what: 'Werwolf', name: r.name, host: r.host, players: r.players, max: null,
        status: r.status, url: '/werwolf/' + encodeURIComponent(r.code), ids: playersOf(ww.get(r.code)) });
    }
  });
  if (on('quiz_enabled')) tryList(() => {
    const qz = require('./quiz');
    for (const r of qz.list()) {
      out.push({ app: 'quiz', icon: '❓', what: 'Quiz', name: r.name, host: r.host, players: r.players, max: null,
        status: r.status, url: '/quiz/' + encodeURIComponent(r.code), ids: playersOf(qz.get(r.code)) });
    }
  });
  return out;
}

// Für angemeldete Mitglieder: Freunde zuerst, danach nach Spielerzahl
function list(user) {
  if (!user) return [];
  const friends = new Map(db.prepare(`SELECT u.id, COALESCE(u.display_name, u.username) AS name FROM friends f
                                      JOIN users u ON u.id = CASE WHEN f.user_id = ? THEN f.friend_id ELSE f.user_id END
                                      WHERE f.accepted = 1 AND (f.user_id = ? OR f.friend_id = ?)`).all(user.id, user.id, user.id).map(r => [r.id, r.name]));
  return collect(user).map(({ ids, ...l }) => ({
    ...l, mine: ids.includes(user.id), friends: [...new Set(ids)].filter(id => friends.has(id)).map(id => friends.get(id)),
  })).sort((a, b) => b.friends.length - a.friends.length || b.players - a.players || a.name.localeCompare(b.name, 'de'));
}

// „➕ Neue Lobby“: wo man eine aufmacht
function apps(locals) {
  return [
    locals.cardsEnabled && ['kartenspiele', '🂡', 'Spieltisch', '/kartenspiele'],
    locals.paintEnabled && paint.lobbiesOn() && ['paint', '🎨', 'Paint-Lobby', '/paint?lobby=neu'],
    on('lobby_enabled') && ['musik', '🎵', 'Musik-Lobby', '/musik'],
    locals.werwolfEnabled && ['werwolf', '🐺', 'Werwolf', '/werwolf'],
    locals.quizEnabled && ['quiz', '❓', 'Quiz', '/quiz'],
  ].filter(a => a && !locals.navHidden.includes(a[0])).map(([app, icon, name, url]) => ({ app, icon, name, url }));
}

module.exports = { list, apps };
