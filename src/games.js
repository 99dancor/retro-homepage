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

const euro = n => (n < 0 ? '−' : n > 0 ? '+' : '±') + Math.abs(n).toLocaleString('de-DE') + ' €';

module.exports = {
  blackjack: {
    title: 'Blackjack',
    url: '/blackjack',
    userStats(userId) {
      const t = require('./blackjack').userTotals(userId);
      if (!t.sessions) return null;
      const out = [
        { key: 'Bilanz', value: t.balance, text: euro(t.balance), cls: t.balance < 0 ? 'neg' : t.balance > 0 ? 'pos' : '' },
        { key: 'Buy-ins', value: t.buyins, text: `${t.buyins.toLocaleString('de-DE')} (${t.bought.toLocaleString('de-DE')} €)` },
        { key: 'Hände', value: t.hands },
        { key: 'Gewonnen', value: t.wins, text: t.hands ? `${t.wins.toLocaleString('de-DE')} (${Math.round(t.wins / t.hands * 100)} %)` : '0' },
        { key: 'Blackjacks', value: t.blackjacks },
        { key: 'Größter Gewinn', value: t.best_win, text: euro(t.best_win) },
        { key: 'Längste Siegesserie', value: t.best_streak },
      ];
      return { stats: out, last: t.last };
    },
  },
  haustier: {
    title: 'Mein Haustier',
    stats(data) {
      const s = JSON.parse(data);
      const pets = Array.isArray(s.pets) ? s.pets.filter(p => p && typeof p === 'object') : [];
      const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
      const out = [{ key: 'Tiere', value: pets.length }];
      if (pets.length) out.push({ key: 'Höchste Stufe', value: Math.max(...pets.map(p => petLevel(num(p.xp)))) });
      out.push({ key: 'Münzen verdient', value: num(s.earned) });
      if (s.visits) out.push({ key: 'Besuche', value: num(s.visits.total) }, { key: 'Längste Besuchsserie', value: num(s.visits.best) });
      return out;
    },
  },
};
