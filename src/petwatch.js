'use strict';
// Schaut alle 15 Minuten in die Spielstände von „Pixelpfoten“ und erinnert, wenn Tiere etwas brauchen
// oder die Besuchsserie heute noch nicht verlängert ist. Gerechnet wird mit den Regeln des Spiels selbst
// (auch die Näpfe: Wer sich dort selbst versorgt, wird nicht gemeldet).
//
// Ruhig gehalten:
//   - Eine Benachrichtigung für alle Tiere („Mimi hat Hunger, Bello ist müde“). Solange sie ungelesen ist,
//     wird nur ihr Text still angepasst, ohne neuen Push.
//   - Ein neuer Push erst, wenn sie gelesen oder Pixelpfoten geöffnet wurde. Nach dem Lesen nur, wenn
//     etwas anderes fehlt, sonst frühestens nach REMIND_H Stunden.
//   - Nachts (22 bis 8 Uhr) nichts. Dafür morgens einmal ein „Guten Morgen“ mit dem Stand der Nacht.
const { db } = require('./db');
const notify = require('./notify');

let game = null;
function rules() {
  game ||= { state: require('../games/haustier/src/js/state.js'), pets: require('../games/haustier/src/js/pets.js') };
  return game;
}
const NEED_LOW = 25;          // ab hier zeigt das Spiel ein trauriges Tier
const DAILY_HOUR = 17;        // Erinnerung an den Tagesbesuch frühestens um 17 Uhr
const NIGHT_FROM = 22, NIGHT_TO = 8;
const MORNING_TO = 11;        // bis dahin kommt der Morgengruß
const REMIND_H = 6;
const ACTIVE_DAYS = 7;        // Morgengruß nur für alle, die in der letzten Woche gespielt haben
const URL = '/haustier/';
const H = 3600e3;

const names = (list) => (list.length < 2 ? list.join('') : list.slice(0, -1).join(', ') + ' und ' + list[list.length - 1]);

// Was den Tieren gerade fehlt, als ein Satz (leer, wenn alle versorgt sind oder schlafen)
function needsText(s) {
  const { pets } = rules();
  return s.pets.filter((p) => !p.sleeping).map((p) => [p, pets.lowNeeds(p, NEED_LOW)]).filter(([, k]) => k.length)
    .map(([p, k]) => pets.needsSentence(p, k)).join(', ');
}
const bowlTip = (s) => (s.place && (s.place.furn_bowl_food || s.place.furn_bowl_water)
  ? 'Schau mal bei Pixelpfoten vorbei.' : 'Schau mal bei Pixelpfoten vorbei. Tipp: Mit vollen Näpfen versorgen sie sich selbst.');

function morning(userId, s, savedAt, t) {
  const { state } = rules();
  const today = state.dayKey(t);
  const start = new Date(t); start.setHours(5, 0, 0, 0);
  if (savedAt >= start.getTime() || t - savedAt > ACTIVE_DAYS * 24 * H) return false;
  const asleep = s.pets.filter((p) => p.sleeping).map((p) => p.name), awake = s.pets.filter((p) => !p.sleeping).map((p) => p.name);
  const title = '☀️ Guten Morgen! ' + (awake.length ? `${names(awake)} ${awake.length > 1 ? 'sind' : 'ist'} schon wach` : `${names(asleep)} ${asleep.length > 1 ? 'schlafen' : 'schläft'} noch`)
    + (awake.length && asleep.length ? `, ${names(asleep)} ${asleep.length > 1 ? 'schlafen' : 'schläft'} noch` : '') + '.';
  const need = needsText(s);
  const v = s.visits;
  const streak = v.lastDay && state.daysBetween(v.lastDay, today) === 1 && v.streak >= 1 ? ` Heute wird es Tag ${v.streak + 1} deiner Besuchsserie.` : '';
  const body = (need ? need + '.' : 'Alle sind gut versorgt durch die Nacht gekommen.') + streak;
  return notify.send(userId, 'pet', { key: 'pet:morgen:' + today, once: true, title, body, url: URL, at: Math.floor(t / 1000) });
}

function check(userId, data, t = Date.now()) {
  const { state, pets } = rules();
  let s;
  try { s = state.migrate(JSON.parse(data)); } catch { return; }
  if (!s || !s.pets.length) return;
  const savedAt = s.updatedAt;
  pets.tickAll(s, t);
  const today = state.dayKey(t), hour = new Date(t).getHours();
  const night = hour >= NIGHT_FROM || hour < NIGHT_TO;
  if (night) return;

  const last = db.prepare("SELECT id, key, title, created_at, read_at FROM notifications WHERE user_id = ? AND kind = 'pet' ORDER BY id DESC LIMIT 1").get(userId);
  const lastAt = last ? last.created_at * 1000 : 0;
  // Wer seit der letzten Meldung gespielt hat, hat seine Tiere gesehen
  if (last && !last.read_at && savedAt > lastAt) {
    db.prepare('UPDATE notifications SET read_at = ? WHERE id = ?').run(Math.floor(t / 1000), last.id);
    last.read_at = Math.floor(t / 1000);
  }

  if (hour < MORNING_TO && morning(userId, s, savedAt, t)) return;

  const need = needsText(s);
  if (need) {
    const title = '🐾 ' + need;
    if (last && !last.read_at) {
      // Noch ungelesen: nur den Text anpassen, kein neuer Push
      if (last.key === 'pet:status' && last.title !== title) db.prepare('UPDATE notifications SET title = ?, body = ? WHERE id = ?').run(title, bowlTip(s), last.id);
    } else {
      const opened = !last || savedAt > lastAt;
      const changed = !!last && last.title !== title;
      if (opened || changed || t - lastAt >= REMIND_H * H) {
        notify.send(userId, 'pet', { key: 'pet:status', title, body: bowlTip(s), url: URL, at: Math.floor(t / 1000) });
      }
    }
  }

  if (s.visits.lastDay !== today && hour >= DAILY_HOUR) {
    const keep = s.visits.streak >= 2 && state.daysBetween(s.visits.lastDay, today) === 1;
    notify.send(userId, 'daily', {
      key: 'daily:' + today, once: true,
      title: keep ? `📅 Deine Besuchsserie von ${s.visits.streak} Tagen endet um Mitternacht` : '📅 Deine Tiere warten auf deinen Besuch',
      body: s.checkinDay !== today ? 'Die Tagesfrage „Wie war dein Tag?“ ist auch noch offen.' : 'Schau heute noch bei Pixelpfoten vorbei.',
      url: URL, at: Math.floor(t / 1000),
    });
  }
}

// Pixelpfoten wurde geöffnet: Die Meldungen über die Tiere sind damit erledigt
function seen(userId) {
  if (userId) db.prepare("UPDATE notifications SET read_at = ? WHERE user_id = ? AND kind = 'pet' AND read_at IS NULL").run(Math.floor(Date.now() / 1000), userId);
}

function run() {
  // Wer gerade spielt (Stand vor weniger als 20 Minuten gespeichert), wird nicht gestört
  const rows = db.prepare("SELECT user_id, data FROM game_saves WHERE app_slug = 'haustier' AND slot = 'main' AND updated_at < ?").all(Math.floor(Date.now() / 1000) - 20 * 60);
  for (const r of rows) {
    try { check(r.user_id, r.data); } catch (e) { console.error('Haustier-Erinnerung:', e.message); }
  }
}
function start() {
  setTimeout(run, 60e3).unref();
  setInterval(run, 15 * 60e3).unref();
}

module.exports = { start, run, check, seen };
