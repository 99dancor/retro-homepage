'use strict';
// Fest eingebaute Spiele: Dateien unter games/<slug>/src, Adresse /<slug>/. Sie speichern über
// /api/saves/<slug> im Konto, ohne dass es dafür einen Eintrag unter Spiele & Apps braucht.
// stats(data) liest aus dem Spielstand (Platz „main“) Zahlen für das Nutzerprofil.

// Stufen des Haustiers stehen im Spiel selbst (ES-Modul, das Node 22 auch per require lädt)
let levelXp = null;
function petLevel(xp) {
  levelXp ||= require('../games/haustier/src/js/pets.js').LEVEL_XP;
  let l = 1;
  while (l < levelXp.length && xp >= levelXp[l]) l++;
  return l;
}

module.exports = {
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
