'use strict';
// Fest eingebaute Spiele: Dateien unter games/<slug>/src, Adresse /<slug>/. Sie speichern über
// /api/saves/<slug> im Konto, ohne dass es dafür einen Eintrag unter Spiele & Apps braucht.
// stats(data) liest aus dem Spielstand (Platz „main“) Zahlen für das Nutzerprofil.
// Spiele mit url statt eigenem Ordner laufen als normale Seite der Homepage; userStats(userId) liefert ihre Zahlen
// selbst aus der Datenbank, deshalb dürfen Browser für sie nichts über /api/stats melden.

// Stufen des Haustiers stehen im Spiel selbst (ES-Modul, das Node 22 auch per require lädt)
let levelXp = null;
function petLevel(xp) {
  levelXp ||= require('../games/haustier/src/js/pets.js').LEVEL_XP;
  let l = 1;
  while (l < levelXp.length && xp >= levelXp[l]) l++;
  return l;
}

const pct = (n, of) => `${n.toLocaleString('de-DE')} (${Math.round(n / of * 100)} %)`;
const euro = n => (n < 0 ? '−' : n > 0 ? '+' : '±') + Math.abs(n).toLocaleString('de-DE') + ' €';

module.exports = {
  // Gemeinsame Kasse aller Kartenspiele mit Geld (src/kasse.js); die einzelnen Spiele zeigen, was dort gewonnen oder verloren wurde
  kartenspiele: {
    title: 'Kartenspiele',
    url: '/kartenspiele',
    userStats(userId) {
      const w = require('./kasse').peek(userId);
      if (!w) return null;
      const net = w.balance - w.bought;
      return {
        stats: [
          { key: 'Kontostand', value: w.balance, text: w.balance.toLocaleString('de-DE') + ' €' },
          { key: 'Bilanz', value: net, text: euro(net), cls: net < 0 ? 'neg' : net > 0 ? 'pos' : '' },
          { key: 'Buy-ins', value: w.buyins, text: `${w.buyins.toLocaleString('de-DE')} (${w.bought.toLocaleString('de-DE')} €)` },
        ],
        last: w.updated_at,
      };
    },
  },
  blackjack: {
    title: 'Blackjack',
    url: '/kartenspiele',
    userStats(userId) {
      const t = require('./blackjack').userTotals(userId);
      if (!t.sessions) return null;
      const out = [
        { key: 'Gewonnen/verloren', value: t.balance, text: euro(t.balance), cls: t.balance < 0 ? 'neg' : t.balance > 0 ? 'pos' : '' },
        { key: 'Hände', value: t.hands },
        { key: 'Gewonnen', value: t.wins, text: t.hands ? `${t.wins.toLocaleString('de-DE')} (${Math.round(t.wins / t.hands * 100)} %)` : '0' },
        { key: 'Blackjacks', value: t.blackjacks },
        { key: 'Größter Gewinn', value: t.best_win, text: euro(t.best_win) },
        { key: 'Längste Siegesserie', value: t.best_streak },
      ];
      return { stats: out, last: t.last };
    },
  },
  poker: {
    title: 'Poker',
    url: '/kartenspiele',
    userStats(userId) {
      const pk = require('./poker');
      const t = pk.userTotals(userId);
      if (!t.sessions) return null;
      const out = [
        { key: 'Gewonnen/verloren', value: t.balance, text: euro(t.balance), cls: t.balance < 0 ? 'neg' : t.balance > 0 ? 'pos' : '' },
        { key: 'Hände', value: t.hands },
        { key: 'Gewonnen', value: t.wins, text: t.hands ? `${t.wins.toLocaleString('de-DE')} (${Math.round(t.wins / t.hands * 100)} %)` : '0' },
        { key: 'Showdowns', value: t.showdowns },
        { key: 'Größter Gewinn', value: t.best_win, text: euro(t.best_win) },
      ];
      if (t.best_hand >= 0) out.push({ key: 'Bestes Blatt', value: t.best_hand, text: pk.HANDS[t.best_hand] });
      return { stats: out, last: t.last };
    },
  },
  durak: {
    title: 'Durak',
    url: '/kartenspiele',
    userStats(userId) {
      const t = require('./durak').userTotals(userId);
      if (!t.games) return null;
      const pct = n => `${n.toLocaleString('de-DE')} (${Math.round(n / t.games * 100)} %)`;
      return {
        stats: [
          { key: 'Gespielt', value: t.games },
          { key: 'Als Erster raus', value: t.wins, text: pct(t.wins) },
          { key: 'Durak geworden', value: t.duraks, text: pct(t.duraks) },
          { key: 'Nicht Durak', value: t.games - t.duraks, text: pct(t.games - t.duraks) },
        ],
        last: t.last,
      };
    },
  },
  uno: {
    title: 'UNO',
    url: '/kartenspiele',
    userStats(userId) {
      const t = require('./uno').userTotals(userId);
      if (!t.games) return null;
      return {
        stats: [
          { key: 'Gespielt', value: t.games },
          { key: 'Gewonnen', value: t.wins, text: pct(t.wins, t.games) },
          { key: 'Runden gewonnen', value: t.bonus, text: `${t.bonus.toLocaleString('de-DE')} von ${t.rounds.toLocaleString('de-DE')}` },
          { key: 'Beste Runde', value: t.best, text: `${t.best.toLocaleString('de-DE')} Punkte` },
        ],
        last: t.last,
      };
    },
  },
  flip7: {
    title: 'Flip 7',
    url: '/kartenspiele',
    userStats(userId) {
      const t = require('./flip7').userTotals(userId);
      if (!t.games) return null;
      return {
        stats: [
          { key: 'Gespielt', value: t.games },
          { key: 'Gewonnen', value: t.wins, text: pct(t.wins, t.games) },
          { key: 'Flip 7 geschafft', value: t.bonus, text: `${t.bonus.toLocaleString('de-DE')}×` },
          { key: 'Beste Runde', value: t.best, text: `${t.best.toLocaleString('de-DE')} Punkte` },
        ],
        last: t.last,
      };
    },
  },
  pilli: {
    title: 'Pilli Pilli',
    url: '/kartenspiele',
    userStats(userId) {
      const t = require('./pilli').userTotals(userId);
      if (!t.games) return null;
      return {
        stats: [
          { key: 'Gespielt', value: t.games },
          { key: 'Gewonnen', value: t.wins, text: pct(t.wins, t.games) },
          { key: 'Genau getroffen', value: t.bonus, text: `${t.bonus.toLocaleString('de-DE')} von ${t.rounds.toLocaleString('de-DE')} Runden` },
        ],
        last: t.last,
      };
    },
  },
  quiz: {
    title: 'Quiz',
    url: '/quiz',
    userStats(userId) {
      const t = require('./quiz').userTotals(userId);
      if (!t.games && !t.hosted && !t.made) return null;
      const out = [
        { key: 'Gespielt', value: t.games },
        { key: 'Siege', value: t.wins, text: t.games ? `${t.wins.toLocaleString('de-DE')} (${Math.round(t.wins / t.games * 100)} %)` : '0' },
      ];
      if (t.best) out.push({ key: 'Beste Platzierung', value: t.best, text: t.best + '.' });
      if (t.asked) out.push({ key: 'Richtig beantwortet', value: t.correct, text: `${t.correct.toLocaleString('de-DE')} von ${t.asked.toLocaleString('de-DE')} Fragen` });
      out.push({ key: 'Punkte gesamt', value: t.points }, { key: 'Als Spielleiter', value: t.hosted }, { key: 'Quizze erstellt', value: t.made });
      return { stats: out, last: t.last };
    },
  },
  werwolf: {
    title: 'Werwolf',
    url: '/werwolf',
    userStats(userId) {
      const t = require('./werwolf').userTotals(userId);
      if (!t.games) return null;
      const pct = (n, of) => `${n.toLocaleString('de-DE')} (${Math.round(n / of * 100)} %)`;
      const out = [
        { key: 'Gespielt', value: t.games },
        { key: 'Gewonnen', value: t.wins, text: pct(t.wins, t.games) },
        { key: 'Überlebt', value: t.survived, text: pct(t.survived, t.games) },
      ];
      if (t.wolf) out.push({ key: 'Als Werwolf', value: t.wolf, text: `${t.wolf.toLocaleString('de-DE')}, davon ${t.wolfWins.toLocaleString('de-DE')} gewonnen` });
      return { stats: out, last: t.last };
    },
  },
  minesweeper: {
    title: 'Minesweeper',
    url: '/minesweeper',
    userStats(userId) {
      const ms = require('./minesweeper');
      const t = ms.userTotals(userId);
      if (!t.games) return null;
      const out = [
        { key: 'Gespielt', value: t.games },
        { key: 'Gewonnen', value: t.wins, text: `${t.wins.toLocaleString('de-DE')} (${Math.round(t.wins / t.games * 100)} %)` },
      ];
      for (const [k, l] of Object.entries(ms.LEVELS)) if (t.best[k] != null) out.push({ key: 'Bestzeit ' + l.name, value: t.best[k], text: t.best[k] + ' s' });
      out.push({ key: 'Längste Siegesserie', value: t.best_streak });
      return { stats: out, last: t.last };
    },
  },
  kreuzwortraetsel: {
    title: 'Kreuzworträtsel',
    url: '/kreuzwortraetsel',
    userStats(userId) {
      const t = require('./crossword').userTotals(userId);
      if (!t.solved) return null;
      const clock = s => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
      const out = [
        { key: 'Gelöst', value: t.solved },
        { key: 'Ohne Hilfe', value: t.clean, text: `${t.clean.toLocaleString('de-DE')} (${Math.round(t.clean / t.solved * 100)} %)` },
        { key: 'Aktuelle Serie', value: t.streak, text: t.streak === 1 ? '1 Tag' : `${t.streak} Tage` },
        { key: 'Längste Serie', value: t.best_streak, text: t.best_streak === 1 ? '1 Tag' : `${t.best_streak} Tage` },
      ];
      if (t.best != null) out.push({ key: 'Bestzeit ohne Hilfe', value: t.best, text: clock(t.best) });
      out.push({ key: 'Durchschnittliche Zeit', value: t.avg, text: clock(t.avg) });
      return { stats: out, last: t.last };
    },
  },
  sudoku: {
    title: 'Sudoku',
    url: '/sudoku',
    userStats(userId) {
      const sd = require('./sudoku'), t = sd.userTotals(userId);
      if (!t.solved) return null;
      const clock = s => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
      const out = [
        { key: 'Gelöst', value: t.solved },
        { key: 'Ohne Hilfe', value: t.clean, text: `${t.clean.toLocaleString('de-DE')} (${Math.round(t.clean / t.solved * 100)} %)` },
        { key: 'Aktuelle Serie', value: t.streak, text: t.streak === 1 ? '1 Tag' : `${t.streak} Tage` },
        { key: 'Längste Serie', value: t.best_streak, text: t.best_streak === 1 ? '1 Tag' : `${t.best_streak} Tage` },
      ];
      for (const [k, l] of Object.entries(sd.LEVELS)) if (t.levels[k].best != null) out.push({ key: 'Bestzeit ' + l.name, value: t.levels[k].best, text: clock(t.levels[k].best) });
      return { stats: out, last: t.last };
    },
  },
  haustier: {
    title: 'Pixelpfoten',
    stats(data) {
      const s = JSON.parse(data);
      const pets = Array.isArray(s.pets) ? s.pets.filter(p => p && typeof p === 'object') : [];
      const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
      const out = [{ key: 'Tiere', value: pets.length }];
      if (pets.length) out.push({ key: 'Höchste Stufe', value: Math.max(...pets.map(p => petLevel(num(p.xp)))) });
      out.push({ key: 'Münzen verdient', value: num(s.earned) });
      if (Array.isArray(s.trophies) && s.trophies.length) out.push({ key: 'Pokale', value: s.trophies.length });
      if (s.visits) out.push({ key: 'Besuche', value: num(s.visits.total) }, { key: 'Längste Besuchsserie', value: num(s.visits.best) });
      return out;
    },
  },
};
