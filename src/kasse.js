'use strict';
// Kasse der Kartenspiele: ein Geldbeutel pro Mitglied für alle Spiele mit Geld (Blackjack, Poker). Wer sich an einen
// Geldtisch setzt, nimmt seinen ganzen Kontostand als Chips mit; nach jeder Hand und beim Aufstehen wandern die Chips
// zurück in die Kasse. Wechselt der Spieltisch das Spiel, bleibt das Geld also beim Spieler.
//
// Bilanz = Kontostand − insgesamt eingekauft (+ im Shop ausgegeben, siehe unten). Jeder startet mit einem Buy-in (Standard 1.000 €), Nachkaufen geht ohne
// Limit, aber erst unter einem Mindeststand (Standard 200 €). Beispiel: Start, drei Nachkäufe, 500 € übrig → −3.500 €.
//
// Shop: Mit dem Spielgeld kauft man Getränke und Snacks (stehen in der Ablage am Platz), Glücksbringer (liegen neben dem
// Namen, das Körbchen holt das Pixelpfoten-Tier an den Tisch) und Tischränder. Gekauftes bleibt; was im Shop ausgegeben
// wurde (spent), zählt nicht als Verlust: Bilanz = Kontostand + ausgegeben − eingekauft.
const { db, now, getSetting } = require('./db');

const int = (v, d, min, max) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= min && n <= max ? n : d; };
function config() {
  return { buyin: int(getSetting('ks_buyin'), 1000, 1, 1e9), rebuyBelow: int(getSetting('ks_rebuy_below'), 200, 0, 1e9) };
}

// Kontostand holen; wer noch keinen hat, bekommt jetzt sein Startgeld
function wallet(userId) {
  let w = db.prepare('SELECT * FROM ks_wallets WHERE user_id = ?').get(userId);
  if (!w) {
    const { buyin } = config(), ts = now();
    db.prepare("INSERT INTO ks_wallets(user_id, balance, bought, buyins, drink, created_at, updated_at) VALUES (?, ?, ?, 1, 'kaffee', ?, ?)").run(userId, buyin, buyin, ts, ts);
    w = db.prepare('SELECT * FROM ks_wallets WHERE user_id = ?').get(userId);
  }
  return w;
}
// Nur nachsehen, ohne ein Konto anzulegen (Profil, Systemsteuerung)
function peek(userId) {
  return db.prepare('SELECT * FROM ks_wallets WHERE user_id = ?').get(userId) || null;
}
const view = w => ({ balance: w.balance, bought: w.bought, buyins: w.buyins, spent: w.spent || 0, net: w.balance + (w.spent || 0) - w.bought });

// Stand nach einer Hand oder beim Aufstehen
function save(userId, chips) {
  wallet(userId);
  db.prepare('UPDATE ks_wallets SET balance = ?, updated_at = ? WHERE user_id = ?').run(Math.max(0, Math.floor(chips)), now(), userId);
}
// Nachkaufen: gibt einen Fehlertext zurück oder null. chips = was gerade vor dem Spieler liegt (am Tisch) bzw. der Kontostand.
function canRebuy(chips) {
  const { rebuyBelow } = config();
  return chips >= rebuyBelow ? `Nachkaufen geht erst, wenn du weniger als ${euro(rebuyBelow)} hast.` : null;
}
function rebuy(userId, chips) {
  const w = wallet(userId);
  if (chips === undefined) chips = w.balance;
  const err = canRebuy(chips);
  if (err) return err;
  const { buyin } = config();
  db.prepare('UPDATE ks_wallets SET balance = ?, bought = bought + ?, buyins = buyins + 1, updated_at = ? WHERE user_id = ?').run(chips + buyin, buyin, now(), userId);
  return null;
}
function reset(userId) {
  if (userId) { db.prepare('DELETE FROM ks_wallets WHERE user_id = ?').run(userId); db.prepare('DELETE FROM ks_items WHERE user_id = ?').run(userId); }
  else { db.prepare('DELETE FROM ks_wallets').run(); db.prepare('DELETE FROM ks_items').run(); }
}

// ---------- Shop ----------
// kind: drink (Ablage am Platz), charm (neben dem Namen), wood (Tischrand für eigene Spieltische). Preis 0 = hat jeder.
const SHOP = {
  kaffee: { kind: 'drink', title: 'Kaffee', icon: '☕', price: 0 },
  saft: { kind: 'drink', title: 'Saft', icon: '🧃', price: 50 },
  brezel: { kind: 'drink', title: 'Brezel', icon: '🥨', price: 80 },
  popcorn: { kind: 'drink', title: 'Popcorn', icon: '🍿', price: 100 },
  bier: { kind: 'drink', title: 'Bier', icon: '🍺', price: 150 },
  pizza: { kind: 'drink', title: 'Pizzastück', icon: '🍕', price: 200 },
  whisky: { kind: 'drink', title: 'Whisky on the rocks', icon: '🥃', price: 400 },
  champagner: { kind: 'drink', title: 'Champagner', icon: '🍾', price: 1500 },
  ente: { kind: 'charm', title: 'Badeente', icon: '🦆', price: 250 },
  kleeblatt: { kind: 'charm', title: 'Kleeblatt', icon: '🍀', price: 300 },
  korb: { kind: 'charm', title: 'Körbchen für dein Pixelpfoten-Tier', icon: '🧺', price: 500, pet: true },
  zigarre: { kind: 'charm', title: 'Zigarre', icon: '🚬', price: 600 },
  frosch: { kind: 'charm', title: 'Glücksfrosch', icon: '🐸', price: 800 },
  wuerfel: { kind: 'charm', title: 'Goldene Würfel', icon: '🎲', price: 1200 },
  brille: { kind: 'charm', title: 'Pokerbrille', icon: '🕶️', price: 2000 },
  katze: { kind: 'charm', title: 'Schwarze Katze', icon: '🐈‍⬛', price: 2500 },
  krone: { kind: 'charm', title: 'Krone', icon: '👑', price: 10000 },
  eiche: { kind: 'wood', title: 'Eiche', icon: '🪵', price: 0 },
  walnuss: { kind: 'wood', title: 'Walnuss mit Silber', icon: '🪵', price: 2000 },
  mahagoni: { kind: 'wood', title: 'Mahagoni mit Messing', icon: '🪵', price: 3000 },
  ebenholz: { kind: 'wood', title: 'Ebenholz mit Gold', icon: '🪵', price: 6000 },
};
function owned(userId) {
  const set = new Set(Object.keys(SHOP).filter(id => !SHOP[id].price));
  for (const r of db.prepare('SELECT item FROM ks_items WHERE user_id = ?').all(userId)) if (SHOP[r.item]) set.add(r.item);
  return set;
}
const owns = (userId, item) => !!SHOP[item] && (!SHOP[item].price || owned(userId).has(item));
// Kaufen. chips: Stand am Geldtisch, falls das Geld gerade dort liegt (der Aufrufer zieht den Preis dort ab).
// Gibt einen Fehlertext zurück oder null.
function buy(userId, item, chips) {
  const it = SHOP[item];
  if (!it) return 'Diesen Artikel gibt es nicht.';
  if (owns(userId, item)) return 'Das hast du schon.';
  const w = wallet(userId);
  const have = chips === undefined ? w.balance : chips;
  if (have < it.price) return `Dafür reicht dein Geld nicht (${euro(it.price)}, du hast ${euro(have)}).`;
  db.prepare('INSERT INTO ks_items(user_id, item, price, bought_at) VALUES (?, ?, ?, ?)').run(userId, item, it.price, now());
  db.prepare('UPDATE ks_wallets SET balance = ?, spent = spent + ?, updated_at = ? WHERE user_id = ?').run(have - it.price, it.price, now(), userId);
  // Getränke und Glücksbringer gleich hinstellen
  if (it.kind !== 'wood') equip(userId, item);
  return null;
}
// Hinstellen oder wegräumen: item = Artikel oder '' für „nichts“ (kind sagt dann, welcher Platz frei wird)
function equip(userId, item, kind) {
  if (item) {
    const it = SHOP[item];
    if (!it || it.kind === 'wood') return 'Das lässt sich nicht an den Platz stellen.';
    if (!owns(userId, item)) return 'Das musst du erst kaufen.';
    kind = it.kind;
  } else if (kind !== 'drink' && kind !== 'charm') return 'Unbekannter Platz.';
  wallet(userId);
  db.prepare(`UPDATE ks_wallets SET ${kind} = ?, updated_at = ? WHERE user_id = ?`).run(item || null, now(), userId);
  return null;
}
// Was am Platz eines Mitglieds steht (ohne ein Konto anzulegen)
function loadout(userId) {
  const w = peek(userId);
  if (!w) return { drink: 'kaffee', charm: null };
  return { drink: SHOP[w.drink] ? w.drink : null, charm: SHOP[w.charm] ? w.charm : null };
}
function leaderboard() {
  return db.prepare(`SELECT u.id, u.username, u.display_name, u.avatar, u.role, u.disabled, u.profile_visibility, w.balance, w.bought, w.buyins, w.spent, w.balance + w.spent - w.bought AS net
                     FROM ks_wallets w JOIN users u ON u.id = w.user_id WHERE u.disabled = 0 ORDER BY net DESC, w.balance DESC`).all();
}
function euro(n) { return Math.abs(n).toLocaleString('de-DE') + ' €'; }

// Haken für die Geldspiele (src/blackjack.js, src/poker.js): t.bank = bank, sobald ein Tisch zu einem Spieltisch gehört
const bank = {
  take: userId => wallet(userId).balance,
  save,
  rebuy: (userId, chips) => rebuy(userId, chips),
};

module.exports = { config, wallet, peek, view, save, rebuy, canRebuy, reset, leaderboard, bank, SHOP, owned, owns, buy, equip, loadout };
