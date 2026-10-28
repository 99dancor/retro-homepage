'use strict';
// Farming Simulator Hub ohne Server: XML-Leser (auch kaputtes XML) und die Dateien aus dem FTP-Ordner.
// Aufruf: node --test test/fshub.test.js (läuft mit npm test)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-test-'));
process.env.PUID = '0';
const X = require('../src/fsxml');
const F = require('../src/fsfeeds');

test('XML: Entitäten, doppelt kodierte Zeichen, rohes & und Kommentare', () => {
  const s = X.parse('﻿<?xml version="1.0"?><!-- Kopf --><a><mod title="Kastor &amp;#91;D-S-Agrarservice&amp;#93;"/><mod title="Hof & Feld"/><t><![CDATA[x < y]]></t></b></a>');
  const mods = X.all(s, 'mod');
  assert.equal(mods[0].a.title, 'Kastor [D-S-Agrarservice]');
  assert.equal(mods[1].a.title, 'Hof & Feld');
  assert.equal(X.text(s, 't'), 'x < y');
  assert.equal(X.num('12.50'), 12.5);
  assert.equal(X.num('kaputt', 7), 7);
});

test('farms.xml: Geld, Kredit, Spieler und Finanzen je Hof', () => {
  const farms = F.readFarms(`<farms>
    <farm farmId="1" name="Hof Anna" color="3" loan="50000.000000" money="123456.780000">
      <players><player uniqueUserId="a" farmManager="true" lastNickname="Anna"/><player uniqueUserId="b" lastNickname=""/></players>
      <finances><stats day="173"><harvestIncome>1500.5</harvestIncome><newVehiclesCost>-0.000000</newVehiclesCost></stats>
        <stats day="174"><soldMilk>800</soldMilk></stats></finances>
    </farm>
    <farm farmId="2" name="Zweiter" color="5" loan="0" money="99"/>
    <farm name="ohne Nummer"/>
  </farms>`);
  assert.equal(farms.length, 2);
  assert.deepEqual(farms[0].players, [{ name: 'Anna', manager: true }]);
  assert.equal(farms[0].money, 123456.78);
  assert.equal(farms[0].loan, 50000);
  assert.deepEqual(farms[0].finances, [{ day: 173, v: { harvestIncome: 1500.5 } }, { day: 174, v: { soldMilk: 800 } }]);
  assert.equal(farms[1].loan, 0);
});

test('placeables.xml: Silos, Ställe mit Tieren und Futter, Produktionen', () => {
  const pl = F.readPlaceables(`<placeables>
    <placeable filename="$data/placeables/silo.xml" farmId="1" position="100 50 -200">
      <silo><storage index="1"><node fillType="WHEAT" fillLevel="123456.4"/><node fillType="UNKNOWN" fillLevel="5"/></storage></silo>
    </placeable>
    <placeable filename="$data/placeables/cowBarn.xml" farmId="1" position="10 0 20">
      <husbandryAnimals><clusters><animal subType="COW_HOLSTEIN" numAnimals="12"/></clusters></husbandryAnimals>
      <husbandryFood><fillLevel fillType="GRASS_WINDROW" fillLevel="2000"/></husbandryFood>
    </placeable>
    <placeable filename="mill.xml" farmId="2" position="0 0 0">
      <productionPoint><production id="flour" isEnabled="false"/><storage><node fillType="FLOUR" fillLevel="500"/></storage></productionPoint>
    </placeable>
    <placeable filename="fence.xml" farmId="1" position="1 1 1"/>
  </placeables>`);
  assert.equal(pl.length, 3, 'Zäune ohne Inhalt fallen weg');
  assert.equal(pl[0].kind, 'silo');
  assert.deepEqual(pl[0].fills, [['silo', 'WHEAT', 123456.4]]);
  assert.equal(pl[0].x, 100);
  assert.equal(pl[0].z, -200);
  assert.equal(pl[1].kind, 'husbandry');
  assert.deepEqual(pl[1].animals, [['COW_HOLSTEIN', 12]]);
  assert.deepEqual(pl[1].fills, [['husbandryFood', 'GRASS_WINDROW', 2000]]);
  assert.equal(pl[2].kind, 'production');
  assert.equal(pl[2].farmId, 2);
  assert.deepEqual(pl[2].productions, [{ id: 'flour', on: false }]);
});

test('items.xml: Ballen mit Hof und Lage, ohne Füllstand weg', () => {
  const it = F.readItems(`<items>
    <item className="Bale" filename="bale.xml" position="1 2 3" farmId="1" fillType="STRAW" fillLevel="4000.2"/>
    <item className="Bale" farmId="2" fillType="SILAGE" fillLevel="2500" posX="5" posZ="6"/>
    <item className="Pallet" farmId="1" fillType="EGG"/>
  </items>`);
  assert.deepEqual(it.map(i => [i.farmId, i.fill, i.level, i.kind, i.x, i.z]), [[1, 'STRAW', 4000.2, 'Bale', 1, 3], [2, 'SILAGE', 2500, 'Bale', 5, 6]]);
});

test('environment.xml: Spieltag, Uhrzeit, Wetter', () => {
  const env = F.readEnvironment(`<environment><dayTime>720.5</dayTime><currentDay>12</currentDay><currentMonotonicDay>174</currentMonotonicDay>
    <daysPerPeriod>1</daysPerPeriod><weather><forecast><instance typeName="SUN" startDay="174" startDayTime="0" duration="3600000"/>
    <instance typeName="RAIN" startDay="175"/></forecast></weather></environment>`);
  assert.equal(env.day, 174, 'fortlaufender Tag vor dem Tag im Jahr');
  assert.equal(env.daysPerPeriod, 1);
  assert.equal(env.dayTime, 720.5);
  assert.deepEqual(env.weather.map(w => [w.type, w.day]), [['SUN', 174], ['RAIN', 175]]);
  assert.equal(F.readEnvironment('<environment><currentDay>9</currentDay></environment>').day, 9);
});

test('Beispiel-Feeds: Stats, Fahrzeuge, Preise', () => {
  const dir = path.join(__dirname, 'fixtures', 'fs');
  const st = F.readStats(fs.readFileSync(path.join(dir, 'stats.xml'), 'utf8'));
  assert.equal(st.name, 'Chaosfarm');
  assert.ok(st.mods.length > 50);
  const veh = F.readVehicles(fs.readFileSync(path.join(dir, 'vehicles.xml'), 'utf8'));
  assert.equal(veh.length, 141);
  const eco = F.readEconomy(fs.readFileSync(path.join(dir, 'economy.xml'), 'utf8'));
  assert.ok(Object.keys(eco.prices).includes('WHEAT'));
});

test('fields.xml: Frucht, Wachstum, Boden und Pflege je Feld', () => {
  const list = F.readFields(fs.readFileSync(path.join(__dirname, 'fixtures', 'fs', 'fields.xml'), 'utf8'));
  assert.equal(list.length, 70);
  assert.deepEqual(list.find(f => f.id === 7), { id: 7, fruit: 'WHEAT', growth: 8, ground: 'HARVEST_READY', planned: 'FALLOW', spray: 0, lime: 0, plow: 0, roller: 0, stubble: 0, weed: 0, stone: 0 });
  const plowed = list.find(f => f.id === 30);
  assert.equal(plowed.fruit, null, 'UNKNOWN heißt: nichts drauf');
  assert.equal(plowed.ground, 'PLOWED');
});

test('bankCredit.xml: laufende Kredite und Jahresberichte je Hof', () => {
  const bc = F.readBankCredit(fs.readFileSync(path.join(__dirname, 'fixtures', 'fs', 'bankCredit.xml'), 'utf8'));
  assert.equal(bc.rate, 3.5);
  assert.equal(bc.loans.length, 1);
  assert.deepEqual(bc.loans[0], { id: 1, farmId: 1, type: 1, amount: 1000000, rest: 1000000, rate: 3.5, months: 120, restMonths: 120, monthly: 9888.586914, risk: 1, day: 6, paidOff: false });
  assert.deepEqual(bc.years, [{ farmId: 1, year: 1, interest: 0, principal: 0, opened: 1, closed: 0 }]);
});

test('Hub: Felder und Kredite aus dem FTP-Ordner landen auf Karte, Hof und Vorschlägen', () => {
  const { db, now } = require('../src/db');
  const hub = require('../src/fshub');
  const dir = path.join(__dirname, 'fixtures', 'fs');
  const read = n => fs.readFileSync(path.join(dir, n), 'utf8');
  const put = db.prepare('INSERT INTO fs_cache(feed, data, ok_at, tried_at, error, info) VALUES (?, ?, ?, ?, NULL, NULL) ON CONFLICT(feed) DO UPDATE SET data = excluded.data');
  put.run('stats', JSON.stringify(F.readStats(read('stats.xml'))), now(), now());
  put.run('ftp', JSON.stringify({ files: { 'fields.xml': { at: now(), list: F.readFields(read('fields.xml')) }, 'bankCredit.xml': F.readBankCredit(read('bankCredit.xml')) }, at: now() }), now(), now());
  F.load();
  hub.invalidate();
  const st = hub.fieldStates();
  const f7 = st.find(f => f.id === 7);
  assert.equal(f7.source, 'auto');
  assert.equal(f7.crop, 'Weizen');
  assert.equal(f7.state, 'reif');
  assert.deepEqual(f7.care.map(c => c.key), ['kalk', 'pflug']);
  assert.equal(st.find(f => f.id === 3).state, 'gras');
  assert.equal(st.find(f => f.id === 4).crop, 'Zwiebeln', 'Früchte ohne Vorlage heißen wie im Spiel');
  assert.equal(st.find(f => f.id === 12).state, 'waechst');
  assert.equal(st.find(f => f.id === 30).state, 'gepfluegt');

  // Eine Meldung nach dem Autosave gilt, bis der nächste Autosave kommt
  const uid = Number(db.prepare("INSERT INTO users(username, password_hash, role, created_at) VALUES ('melder', 'x', 'user', ?)").run(now()).lastInsertRowid);
  db.prepare('INSERT INTO fs_fields(field, crop_id, state, user_id, game_day, updated_at) VALUES (7, NULL, ?, ?, NULL, ?)').run('geerntet', uid, now() + 5);
  assert.equal(hub.fieldStates().find(f => f.id === 7).state, 'geerntet');

  const farm = hub.model().farms.find(x => x.id === 1);
  assert.equal(farm.creditRest, 1000000);
  assert.equal(farm.credits[0].monthly, 9888.586914);
  const owner = st.find(f => f.id === 11).owner;
  const sug = hub.suggestions(owner).map(s => s.title);
  assert.ok(sug.some(t => /^Weizen ernten: Feld/.test(t)), sug.join(' | '));
});
