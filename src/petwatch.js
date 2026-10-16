'use strict';
// Schaut alle 15 Minuten in die Spielstände von „Mein Haustier“ und erinnert, wenn ein Tier etwas braucht
// oder die Besuchsserie heute noch nicht verlängert ist. Gerechnet wird mit den Regeln des Spiels selbst.
const { db } = require('./db');
const notify = require('./notify');

let game = null;
function rules() {
  game ||= { state: require('../games/haustier/src/js/state.js'), pets: require('../games/haustier/src/js/pets.js') };
  return game;
}
const NEED_LOW = 25;          // ab hier zeigt das Spiel ein trauriges Tier
const DAILY_HOUR = 17;        // Erinnerung an den Tagesbesuch frühestens um 17 Uhr

function check(userId, data, t = Date.now()) {
  const { state, pets } = rules();
  let s;
  try { s = state.migrate(JSON.parse(data)); } catch { return; }
  if (!s || !s.pets.length) return;
  pets.tickAll(s, t);
  const today = state.dayKey(t);
  for (const pet of s.pets) {
    const m = pets.mood(pet);
    if (m.face !== 'sad' || pet.stats[m.key] >= NEED_LOW) continue;
    // Höchstens eine Erinnerung je Tier, Bedürfnis und Tag
    notify.send(userId, 'pet', { key: `pet:${pet.id}:${m.key}:${today}`, once: true, title: '🐾 ' + m.text, body: 'Schau mal bei Mein Haustier vorbei.', url: '/haustier/' });
  }
  if (s.visits.lastDay !== today && new Date(t).getHours() >= DAILY_HOUR) {
    const keep = s.visits.streak >= 2 && state.daysBetween(s.visits.lastDay, today) === 1;
    notify.send(userId, 'daily', {
      key: 'daily:' + today, once: true,
      title: keep ? `📅 Deine Besuchsserie von ${s.visits.streak} Tagen endet um Mitternacht` : '📅 Deine Tiere warten auf deinen Besuch',
      body: s.checkinDay !== today ? 'Die Tagesfrage „Wie war dein Tag?“ ist auch noch offen.' : 'Schau heute noch bei Mein Haustier vorbei.',
      url: '/haustier/',
    });
  }
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

module.exports = { start, run, check };
