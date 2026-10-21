'use strict';
// Kasse der Kartenspiele: ein Geldbeutel pro Mitglied für alle Spiele mit Geld (Blackjack, Poker). Wer sich an einen
// Geldtisch setzt, nimmt seinen ganzen Kontostand als Chips mit; nach jeder Hand und beim Aufstehen wandern die Chips
// zurück in die Kasse. Wechselt der Spieltisch das Spiel, bleibt das Geld also beim Spieler.
//
// Bilanz = Kontostand − insgesamt eingekauft (+ im Shop ausgegeben, siehe unten). Jeder startet mit einem Buy-in (Standard 1.000 €), Nachkaufen geht ohne
// Limit, aber erst unter einem Mindeststand (Standard 200 €). Beispiel: Start, drei Nachkäufe, 500 € übrig → −3.500 €.
//
// Shop: Mit dem Spielgeld kauft man Getränke und Snacks, Untersetzer und Glücksbringer (stehen am Platz auf dem Holz,
// Kissen, Körbchen und Thron holen das Pixelpfoten-Tier an den Tisch), dazu Holzränder, Filz und Kartenrücken für eigene
// Spieltische. Gekauftes bleibt; was im Shop oder für eine Runde am Tisch ausgegeben wurde (spent), zählt nicht als
// Verlust: Bilanz = Kontostand + ausgegeben − eingekauft.
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
// kind: drink (links vom Platz auf dem Holz), charm (rechts davon; pet = Platz fürs Pixelpfoten-Tier), coaster (unter dem
// Getränk), wood/felt/back (Holzrand, Filz und Kartenrücken für eigene Spieltische). Preis 0 = hat jeder.
// rarity: 1 = selten (★), 2 = legendär (★★).
const SHOP = {
  kaffee: { kind: 'drink', title: 'Kaffee', icon: '☕', price: 0 },
  saft: { kind: 'drink', title: 'Saft', icon: '🧃', price: 50 },
  brezel: { kind: 'drink', title: 'Brezel', icon: '🥨', price: 80 },
  popcorn: { kind: 'drink', title: 'Popcorn', icon: '🍿', price: 100 },
  bier: { kind: 'drink', title: 'Bier', icon: '🍺', price: 150 },
  pizza: { kind: 'drink', title: 'Pizzastück', icon: '🍕', price: 200 },
  whisky: { kind: 'drink', title: 'Whisky on the rocks', icon: '🥃', price: 400 },
  cocktail: { kind: 'drink', title: 'Cocktail', icon: '🍹', price: 700 },
  champagner: { kind: 'drink', title: 'Champagner', icon: '🍾', price: 1500, rarity: 1 },
  ente: { kind: 'charm', title: 'Badeente', icon: '🦆', price: 250 },
  kleeblatt: { kind: 'charm', title: 'Kleeblatt', icon: '🍀', price: 300 },
  kissen: { kind: 'charm', title: 'Kissen für dein Pixelpfoten-Tier', icon: '🛏️', price: 300, pet: true },
  korb: { kind: 'charm', title: 'Körbchen für dein Pixelpfoten-Tier', icon: '🧺', price: 500, pet: true },
  zigarre: { kind: 'charm', title: 'Zigarre', icon: '🚬', price: 600 },
  frosch: { kind: 'charm', title: 'Glücksfrosch', icon: '🐸', price: 800 },
  wuerfel: { kind: 'charm', title: 'Goldene Würfel', icon: '🎲', price: 1200 },
  brille: { kind: 'charm', title: 'Pokerbrille', icon: '🕶️', price: 2000, rarity: 1 },
  katze: { kind: 'charm', title: 'Schwarze Katze', icon: '🐈‍⬛', price: 2500, rarity: 1 },
  thron: { kind: 'charm', title: 'Thron für dein Pixelpfoten-Tier', icon: '🪑', price: 6000, pet: true, rarity: 2 },
  krone: { kind: 'charm', title: 'Krone', icon: '👑', price: 10000, rarity: 2 },
  bierdeckel: { kind: 'coaster', title: 'Bierdeckel', icon: '⚪', price: 40 },
  kork: { kind: 'coaster', title: 'Kork\u00aduntersetzer', icon: '🟤', price: 120 },
  marmor: { kind: 'coaster', title: 'Marmor\u00aduntersetzer', icon: '⚪', price: 600 },
  goldrand: { kind: 'coaster', title: 'Untersetzer mit Goldrand', icon: '🟡', price: 2500, rarity: 1 },
  eiche: { kind: 'wood', title: 'Eiche', icon: '🪵', price: 0 },
  walnuss: { kind: 'wood', title: 'Walnuss mit Silber', icon: '🪵', price: 2000 },
  mahagoni: { kind: 'wood', title: 'Mahagoni mit Messing', icon: '🪵', price: 3000 },
  ebenholz: { kind: 'wood', title: 'Ebenholz mit Gold', icon: '🪵', price: 6000, rarity: 1 },
  gruen: { kind: 'felt', title: 'Grün', icon: '🟩', price: 0 },
  blau: { kind: 'felt', title: 'Blau', icon: '🟦', price: 0 },
  rot: { kind: 'felt', title: 'Rot', icon: '🟥', price: 0 },
  lila: { kind: 'felt', title: 'Lila', icon: '🟪', price: 0 },
  schwarz: { kind: 'felt', title: 'Schwarz', icon: '⬛', price: 0 },
  petrol: { kind: 'felt', title: 'Petrol mit Chromrand', icon: '🟩', price: 0 },
  bordeaux: { kind: 'felt', title: 'Bordeaux-Samt', icon: '🟥', price: 1500 },
  sternfilz: { kind: 'felt', title: 'Mitternacht mit Sternen', icon: '🌌', price: 4000, rarity: 1 },
  klassisch: { kind: 'back', title: 'Klassisch (Fensterfarben)', icon: '🂠', price: 0 },
  streifen: { kind: 'back', title: 'Rot gestreift', icon: '🂠', price: 0 },
  blaustreifen: { kind: 'back', title: 'Blau gestreift', icon: '🂠', price: 0 },
  gruenstreifen: { kind: 'back', title: 'Grün gestreift', icon: '🂠', price: 0 },
  gold: { kind: 'back', title: 'Schwarz-Gold', icon: '🂠', price: 0 },
  karo: { kind: 'back', title: 'Rot-weiß kariert', icon: '🂠', price: 0 },
  retro: { kind: 'back', title: 'Retro (Punkte)', icon: '🂠', price: 0 },
  sterne: { kind: 'back', title: 'Sternenhimmel', icon: '🂠', price: 1000 },
  regenbogen: { kind: 'back', title: 'Regenbogen', icon: '🂠', price: 5000, rarity: 2 },
};
// An den Platz stellen lässt sich nur das hier; Holz, Filz und Kartenrücken wählt der Gastgeber für seinen Tisch
const PLACE = ['drink', 'charm', 'coaster'];
// Angebot der Woche: jeden Montag ein anderer Artikel 25 % billiger (für alle gleich, ohne Datenbank)
function offer(t = Date.now()) {
  const list = Object.keys(SHOP).filter(id => SHOP[id].price >= 100);
  const week = Math.floor((t / 864e5 + 3) / 7);
  return list[(week * 7 + 3) % list.length];
}
function price(item, t) {
  const it = SHOP[item];
  if (!it) return 0;
  return item === offer(t) ? Math.round(it.price * 0.75 / 10) * 10 : it.price;
}
function owned(userId) {
  const set = new Set(Object.keys(SHOP).filter(id => !SHOP[id].price));
  for (const r of db.prepare('SELECT item FROM ks_items WHERE user_id = ?').all(userId)) if (SHOP[r.item]) set.add(r.item);
  return set;
}
const owns = (userId, item) => !!SHOP[item] && (!SHOP[item].price || owned(userId).has(item));
// Spielgeld ausgeben (Shop, Runde am Tisch). chips: Stand am Geldtisch, falls das Geld gerade dort liegt (der Aufrufer
// zieht den Betrag dort ab). Was im Shop ausgegeben wird, zählt nicht als Verlust. Gibt einen Fehlertext zurück oder null.
function spend(userId, amount, chips) {
  const w = wallet(userId);
  const have = chips === undefined ? w.balance : chips;
  if (have < amount) return `Dafür reicht dein Geld nicht (${euro(amount)}, du hast ${euro(have)}).`;
  db.prepare('UPDATE ks_wallets SET balance = ?, spent = spent + ?, updated_at = ? WHERE user_id = ?').run(have - amount, amount, now(), userId);
  return null;
}
// Kaufen. Getränke, Glücksbringer und Untersetzer kommen gleich an den Platz.
function buy(userId, item, chips) {
  const it = SHOP[item];
  if (!it) return 'Diesen Artikel gibt es nicht.';
  if (owns(userId, item)) return 'Das hast du schon.';
  const cost = price(item);
  const err = spend(userId, cost, chips);
  if (err) return err;
  db.prepare('INSERT INTO ks_items(user_id, item, price, bought_at) VALUES (?, ?, ?, ?)').run(userId, item, cost, now());
  if (PLACE.includes(it.kind)) equip(userId, item);
  return null;
}
// Hinstellen oder wegräumen: item = Artikel oder '' für „nichts“ (kind sagt dann, welcher Platz frei wird)
function equip(userId, item, kind) {
  if (item) {
    const it = SHOP[item];
    if (!it || !PLACE.includes(it.kind)) return 'Das lässt sich nicht an den Platz stellen.';
    if (!owns(userId, item)) return 'Das musst du erst kaufen.';
    kind = it.kind;
  } else if (!PLACE.includes(kind)) return 'Unbekannter Platz.';
  wallet(userId);
  db.prepare(`UPDATE ks_wallets SET ${kind} = ?, updated_at = ? WHERE user_id = ?`).run(item || null, now(), userId);
  return null;
}
// Was am Platz eines Mitglieds steht (ohne ein Konto anzulegen)
function loadout(userId) {
  const w = peek(userId);
  if (!w) return { drink: 'kaffee', charm: null, coaster: null };
  const ok = (id, kind) => (SHOP[id] && SHOP[id].kind === kind ? id : null);
  return { drink: ok(w.drink, 'drink'), charm: ok(w.charm, 'charm'), coaster: ok(w.coaster, 'coaster') };
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

module.exports = { config, wallet, peek, view, save, rebuy, canRebuy, reset, leaderboard, bank, SHOP, PLACE, offer, price, owned, owns, spend, buy, equip, loadout };
