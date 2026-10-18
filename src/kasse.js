'use strict';
// Kasse der Kartenspiele: ein Geldbeutel pro Mitglied für alle Spiele mit Geld (Blackjack, Poker). Wer sich an einen
// Geldtisch setzt, nimmt seinen ganzen Kontostand als Chips mit; nach jeder Hand und beim Aufstehen wandern die Chips
// zurück in die Kasse. Wechselt der Spieltisch das Spiel, bleibt das Geld also beim Spieler.
//
// Bilanz = Kontostand − insgesamt eingekauft. Jeder startet mit einem Buy-in (Standard 1.000 €), Nachkaufen geht ohne
// Limit, aber erst unter einem Mindeststand (Standard 200 €). Beispiel: Start, drei Nachkäufe, 500 € übrig → −3.500 €.
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
    db.prepare('INSERT INTO ks_wallets(user_id, balance, bought, buyins, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)').run(userId, buyin, buyin, ts, ts);
    w = db.prepare('SELECT * FROM ks_wallets WHERE user_id = ?').get(userId);
  }
  return w;
}
// Nur nachsehen, ohne ein Konto anzulegen (Profil, Systemsteuerung)
function peek(userId) {
  return db.prepare('SELECT * FROM ks_wallets WHERE user_id = ?').get(userId) || null;
}
const view = w => ({ balance: w.balance, bought: w.bought, buyins: w.buyins, net: w.balance - w.bought });

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
  if (userId) db.prepare('DELETE FROM ks_wallets WHERE user_id = ?').run(userId);
  else db.prepare('DELETE FROM ks_wallets').run();
}
function leaderboard() {
  return db.prepare(`SELECT u.id, u.username, u.display_name, u.avatar, u.role, u.disabled, u.profile_visibility, w.balance, w.bought, w.buyins, w.balance - w.bought AS net
                     FROM ks_wallets w JOIN users u ON u.id = w.user_id WHERE u.disabled = 0 ORDER BY net DESC, w.balance DESC`).all();
}
function euro(n) { return Math.abs(n).toLocaleString('de-DE') + ' €'; }

// Haken für die Geldspiele (src/blackjack.js, src/poker.js): t.bank = bank, sobald ein Tisch zu einem Spieltisch gehört
const bank = {
  take: userId => wallet(userId).balance,
  save,
  rebuy: (userId, chips) => rebuy(userId, chips),
};

module.exports = { config, wallet, peek, view, save, rebuy, canRebuy, reset, leaderboard, bank };
