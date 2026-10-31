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

  const farm = hub.model().farms.find(x => x.id === 1);
  assert.equal(farm.creditRest, 1000000);
  assert.equal(farm.credits[0].monthly, 9888.586914);
  const owner = st.find(f => f.id === 11).owner;
  const sug = hub.suggestions(owner).map(s => s.title);
  assert.ok(sug.some(t => /^Weizen ernten: Grundstück/.test(t)), sug.join(' | '));
});

// ---------- Dichtekarten (src/fsmap.js) ----------
// Kleine GDM-Datei von Hand: ein Bereich, 32er-Kacheln, je Kachel 1 Bit mit Palette [0, wert]
function gdm(size, value) {
  const cs = 32, n = size / cs, dimLog = Math.log2(n), head = Buffer.alloc(16);
  head.write('"MDF', 0, 'latin1');
  head[8] = dimLog; head[9] = 5; head[11] = 4; head[12] = 1;
  const parts = [head];
  for (let cy = 0; cy < n; cy++) for (let cx = 0; cx < n; cx++) {
    const bits = Buffer.alloc(cs * cs / 8);
    for (let i = 0; i < cs * cs; i++) if (value(cx * cs + (i & 31), cy * cs + (i >> 5))) bits[i >> 3] |= 1 << (i & 7);
    const pal = Buffer.alloc(4); pal.writeUInt16LE(0, 0); pal.writeUInt16LE(5, 2);
    parts.push(Buffer.from([1, 2]), pal, bits);
  }
  return Buffer.concat(parts);
}
// GRLE von Hand: Wert, bei Wiederholung noch einmal der Wert und die Zahl weiterer Kopien (0xFF = +255)
function grle(w, h, value) {
  const vals = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) vals.push(value(x, y));
  const out = [];
  for (let i = 0; i < vals.length;) {
    let j = i;
    while (j < vals.length && vals[j] === vals[i]) j++;
    const L = j - i;
    out.push(vals[i]);
    if (L > 1) { out.push(vals[i]); let c = L - 2; while (c >= 255) { out.push(255); c -= 255; } out.push(c); }
    i = j;
  }
  const head = Buffer.alloc(21);
  head.write('GRLE', 0, 'latin1');
  head.writeUInt16LE(w / 256, 6); head.writeUInt16LE(h / 256, 10); head.writeUInt32LE(out.length, 17);
  return Buffer.concat([head, Buffer.from(out)]);
}

// GDM mit mehreren Bereichen, je 4 Bit ohne Palette: fns[r](x, y) gibt den Wert des Bereichs r
function gdmR(size, fns) {
  const cs = 32, n = size / cs, regions = fns.length, head = Buffer.alloc(16 + regions - 1);
  head.write('"MDF', 0, 'latin1');
  head[8] = Math.log2(n); head[9] = 5; head[11] = 4 * regions; head[12] = regions;
  for (let r = 0; r < regions - 1; r++) head[13 + r] = 4 * (r + 1);
  const parts = [head];
  for (let cy = 0; cy < n; cy++) for (let cx = 0; cx < n; cx++) {
    for (const fn of fns) {
      const bits = Buffer.alloc(cs * cs / 2);
      for (let i = 0; i < cs * cs; i++) bits[i >> 1] |= (fn(cx * cs + (i & 31), cy * cs + (i >> 5)) & 15) << ((i & 1) * 4);
      parts.push(Buffer.from([4, 0]), bits);
    }
  }
  return Buffer.concat(parts);
}

test('Dichtekarten: GDM und GRLE lesen, Früchte, Zustand und Kalk je Fleck und je Grundstück', () => {
  const M = require('../src/fsmap');
  const g = M.readGdm(gdm(256, (x, y) => x >= 20 && x < 100 && y >= 20 && y < 100));
  assert.equal(g.size, 256);
  assert.equal(g.data[30 * 256 + 30], 5);
  assert.equal(g.data[10 * 256 + 10], 0);
  assert.throws(() => M.readGdm(Buffer.from('kaputt, keine Datei')), /Keine GDM/);
  const lime = M.readGrle(grle(256, 256, x => (x < 128 ? 0 : 3)));
  assert.equal(lime.w, 256);
  assert.equal(lime.data[5], 0);
  assert.equal(lime.data[200], 3);

  // Karte 128 m, 256 Pixel: Grundstück 1 links (nur Weizen), Grundstück 2 rechts (oben Gerste, unten Weizen).
  // Gekalkt ist alles außer einem Streifen links (x < 60).
  const inA = (x, y) => x >= 20 && x < 100 && y >= 20 && y < 100;
  const inB = (x, y) => x >= 140 && x < 240 && y >= 40 && y < 80, inC = (x, y) => x >= 140 && x < 240 && y >= 80 && y < 120;
  const fruit = (x, y) => (inA(x, y) || inC(x, y) ? 1 : inB(x, y) ? 2 : 0);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-ras-'));
  fs.writeFileSync(path.join(dir, 'sg-densityMap_fruits.gdm'), gdmR(256, [fruit, (x, y) => (fruit(x, y) ? 3 : 0)]));
  fs.writeFileSync(path.join(dir, 'sg-densityMap_ground.gdm'), gdmR(256, [(x, y) => (fruit(x, y) ? 7 : 0)]));
  fs.writeFileSync(path.join(dir, 'sg-infoLayer_limeLevel.grle'), grle(256, 256, x => (x < 60 ? 0 : 1)));
  const fruits = [{ name: 'WHEAT', density: 1, harvestMin: 3, harvestMax: 4, cut: 5 }, { name: 'BARLEY', density: 2, harvestMin: 5, harvestMax: 6 }];
  const r = M.build(dir, { mapSize: 128, fruits, grid: { size: 2, lab: [1, 2, 1, 2] }, colorOf: () => '#e2c044', stateColor: () => '#f2a51d' });
  assert.equal(r.size, 256);
  assert.equal(r.learned, false, 'Zahlen der Früchte kommen aus der Mod');
  assert.deepEqual(Object.keys(r.images.fruits).sort(), ['BARLEY', 'WHEAT']);
  assert.ok(fs.existsSync(path.join(dir, r.images.fruits.WHEAT)), 'Bild je Frucht');
  // Bilder nur so groß wie ihr Inhalt: Gerste liegt bei x 140–240, y 40–80 von 256
  assert.deepEqual(r.boxes[r.images.fruits.BARLEY].map(Math.round), [547, 156, 391, 156]);
  assert.equal(fs.readFileSync(path.join(dir, r.images.care.kalk)).subarray(0, 4).toString('hex'), '89504e47');
  assert.deepEqual(r.parcels[1].fruits, { WHEAT: 0.16 });
  assert.deepEqual(r.parcels[2].fruits, { WHEAT: 0.1, BARLEY: 0.1 }, 'zwei Früchte auf einem Grundstück');
  assert.deepEqual(r.parcels[2].states, { reif: 0.1, waechst: 0.1 }, 'Weizen reif, Gerste wächst noch');
  assert.deepEqual(r.parcels[1].care, { kalk: 0.08 }, 'nur der Streifen braucht Kalk');
  assert.deepEqual(r.parcels[2].care, {});

  // Ohne Zahlen aus der Mod: aus fields.xml gelernt (häufigste Zahl im Umriss des Felds)
  const poly = [[-54, -54], [-14, -54], [-14, -14], [-54, -14]];
  const learn = M.fruitValues(M.readGdm(gdmR(256, [fruit])).data, 256, 128, [{ name: 'WHEAT' }], [{ id: 1, fruit: 'WHEAT' }], { 1: poly });
  assert.equal(learn.learned, true);
  assert.equal(learn.map.get(1), 'WHEAT');
  assert.equal(learn.map.get(2), undefined, 'Gerste kennt fields.xml nicht');
  // Zahlen der Mod, die fields.xml überwiegend widerspricht, gelten nicht
  const wrong = M.fruitValues(M.readGdm(gdmR(256, [fruit])).data, 256, 128, [{ name: 'WHEAT', density: 7 }, { name: 'BARLEY', density: 1 }], [{ id: 1, fruit: 'WHEAT' }], { 1: poly });
  assert.deepEqual([wrong.learned, wrong.map.get(1)], [true, 'WHEAT']);
  const right = M.fruitValues(M.readGdm(gdmR(256, [fruit])).data, 256, 128, [{ name: 'WHEAT', density: 1 }, { name: 'BARLEY', density: 2 }], [{ id: 1, fruit: 'WHEAT' }], { 1: poly });
  assert.deepEqual([right.learned, right.map.get(2)], [false, 'BARLEY']);
  // Zahlen ohne bekannte Frucht (Bewuchs, Deko) tauchen nirgends auf
  const deko = M.build(dir, { mapSize: 128, fruits: [fruits[0]], grid: { size: 2, lab: [1, 2, 1, 2] } });
  assert.deepEqual(Object.keys(deko.images.fruits), ['WHEAT']);
  assert.deepEqual(deko.parcels[2].fruits, { WHEAT: 0.1 });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Grundstücksgrenzen: begradigt, Nachbarn teilen genau dieselbe Linie', () => {
  const E = require('../src/fsexport');
  // 64 × 64: links 1, rechts 2, dazwischen eine Treppe (schräge Grenze), unten ein Streifen 3
  const n = 64, rows = [];
  for (let y = 0; y < n; y++) {
    const runs = [];
    let prev = null, len = 0;
    for (let x = 0; x < n; x++) {
      const id = y >= 56 ? 3 : x < 20 + Math.floor(y / 2) ? 1 : 2;
      if (id === prev) len++; else { if (prev !== null) runs.push(prev + '*' + len); prev = id; len = 1; }
    }
    runs.push(prev + '*' + len);
    rows.push(runs.join(' '));
  }
  const p = E.parcels(rows, n, 64);
  assert.deepEqual(Object.keys(p), ['1', '2', '3']);
  assert.ok(p[1].length <= 6 && p[2].length <= 6, 'Treppe wird eine Linie: ' + p[1].length + ' / ' + p[2].length);
  const key = q => q.join(',');
  const shared = p[1].map(key).filter(k => p[2].map(key).includes(k));
  assert.ok(shared.length >= 2, 'Grenze 1/2 hat dieselben Endpunkte');
  // Kein Punkt von 1 liegt auf der Grenze zu 2, den 2 nicht auch hat (sonst zwei leicht versetzte Linien)
  const onDiag = q => q[1] > -32 && q[1] < 24 && q[0] > -32 + 20 - 0.5;
  assert.deepEqual(p[1].filter(onDiag).map(key).sort(), p[2].filter(onDiag).map(key).sort());
  // Ältere gespeicherte Exporte bekommen die neuen Umrisse aus der Grundstückskarte
  assert.deepEqual(E.outlines({ grid: { size: n, rows }, mapSize: 64, parcels: { 1: [[0, 0]] } }), p);
  assert.deepEqual(E.outlines({ parcels: { 1: [[0, 0]] } }), { 1: [[0, 0]] });
  // Platz für die Nummer liegt im Grundstück, auch bei einer L-Form (deren Schwerpunkt außerhalb läge)
  const L = [[0, 0], [10, 0], [10, 2], [2, 2], [2, 10], [0, 10]];
  const [lx, ly] = require('../src/fsmap').labelPoint(L);
  assert.ok((lx > 0 && lx < 10 && ly > 0 && ly < 2) || (lx > 0 && lx < 2 && ly > 0 && ly < 10), 'im L: ' + lx + ',' + ly);
});

test('Symbole: Kürzel, eigene Zeichnung, hochgeladenes Original', () => {
  const I = require('../src/fsicons');
  assert.equal(I.key('hud_fill_wheat.png'), 'wheat');
  assert.equal(I.key('SUGARBEET_CUT'), 'sugarbeetcut');
  assert.match(I.html('WHEAT', 'Weizen'), /<span class="fi fi-m" style="--c:#e3b34c" title="Weizen" aria-hidden="true"><svg><use href="#g-grain"\/><\/svg><\/span>/);
  assert.match(I.html('IRGENDWAS_OIL'), /#g-drop/, 'Flüssigkeiten ohne Vorlage als Tropfen');
  assert.match(I.html('IRGENDWAS'), /#g-box/);
  assert.match(I.html('X', '<b>'), /title="&lt;b&gt;"/);
  const pngBuf = require('./png').png(2, 2);
  assert.equal(I.save([{ originalname: 'hud_fill_wheat.png', buffer: pngBuf }, { originalname: 'boese.png', buffer: Buffer.from('kein png') }]), 1);
  assert.match(I.html('WHEAT', 'Weizen', 's'), /<img class="fi fi-s up" src="\/farming\/symbol\/wheat\.png\?v=\d+"/);
  assert.ok(I.file('wheat'));
  assert.equal(I.file('../wheat'), I.file('wheat'), 'nur Buchstaben und Ziffern');
  I.clear();
  assert.equal(I.file('wheat'), null);
});

test('Hofkalender: Januar bis Dezember mit Spieltagen, Januar und Februar vom Spieljahr davor', () => {
  const { db, now } = require('../src/db');
  const hub = require('../src/fshub');
  const dpp = hub.daysPerPeriod();
  const cal = hub.calendar(1, 2);
  assert.deepEqual(cal.cols.map(c => c.short), ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']);
  assert.equal(cal.cols[0].gy, 1, 'Januar von Kalenderjahr 2 gehört zu Spieljahr 1');
  assert.equal(cal.cols[0].days[0].gday, hub.dayOfMonth(10, 1, dpp));
  assert.equal(cal.cols[2].days[0].gday, hub.dayOfMonth(0, 2, dpp), 'März beginnt Spieljahr 2');
  assert.equal(cal.cols[1].days.at(-1).gday + 1, cal.cols[2].days[0].gday, 'Februar und März liegen nebeneinander');
  assert.ok(hub.calendar(1, 1).cols[0].days.every(d => d.gday === null), 'vor dem ersten Spieljahr gibt es keine Tage');
  const day = cal.cols[5].days[0].gday;
  const uid = Number(db.prepare("INSERT INTO users(username, password_hash, role, created_at) VALUES ('kalender', 'x', 'user', ?)").run(now()).lastInsertRowid);
  hub.addTask({ id: uid, isAdmin: true }, 1, { title: 'Säen', due: 'gday', due_day: String(day) });
  assert.deepEqual(hub.calendar(1, 2).byDay.get(day).map(t => t.title), ['Säen']);
  assert.equal(hub.calendarYear({ date: { year: 3, month: 10 } }), 4, 'Januar in Spieljahr 3 ist Kalenderjahr 4');
  assert.equal(hub.calendarYear({ date: { year: 3, month: 0 } }), 3);
  // Südhalbkugel: Periode 1 ist der September, der Kalender beginnt trotzdem mit Januar (Periode 5)
  const N = require('../src/fsnames');
  N.setHemisphere('south');
  try {
    assert.equal(N.MONTHS[0], 'September');
    assert.deepEqual(N.ORDER.slice(0, 2), [4, 5]);
    const south = hub.calendar(1, 2);
    assert.deepEqual(south.cols.map(c => c.short), ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']);
    assert.equal(south.cols[0].im, 4);
    assert.equal(south.cols[8].gy, 2, 'September beginnt Spieljahr 2');
    assert.equal(south.cols[7].days.at(-1).gday + 1, south.cols[8].days[0].gday, 'August und September liegen nebeneinander');
    assert.equal(hub.calendarYear({ date: { year: 3, month: 4 } }), 4, 'Januar in Spieljahr 3 ist Kalenderjahr 4');
    assert.equal(hub.dateOf(1, 1).monthName, 'September');
  } finally { N.setHemisphere('north'); }
});

test('Changelog: Updates des Hubs aus CHANGELOG.md, jedes nur einmal', () => {
  const hub = require('../src/fshub');
  const list = [{ date: '2026-10-29', title: 'Farming Hub: Neu', items: ['Eins', 'Zwei'] }, { date: '2026-10-28', title: 'Paint: anders', items: ['x'] }];
  assert.equal(hub.importUpdates(list), 1);
  assert.equal(hub.importUpdates(list), 0, 'kein zweites Mal');
  const e = hub.changelog(10).find(c => c.title === 'Farming Hub: Neu');
  assert.equal(e.kind, 'update');
  assert.equal(e.body, '• Eins\n• Zwei');
});

test('Spielstände: anderer Spielstand legt Höfe und Aufgaben beiseite, zurück holt sie wieder', () => {
  const { db, now, getSetting, setSetting } = require('../src/db');
  const saves = require('../src/fssaves');
  const hub = require('../src/fshub');
  const put = db.prepare('INSERT INTO fs_cache(feed, data, ok_at, tried_at, error, info) VALUES (?, ?, ?, ?, NULL, NULL) ON CONFLICT(feed) DO UPDATE SET data = excluded.data');
  const sg = (map, created) => { put.run('savegame', JSON.stringify({ title: 'My game save', mapTitle: map, mapId: 'FS25_' + map + '.' + map, created, money: 0 }), now(), now()); F.load(); };
  setSetting('fs_url_savegame', 'http://example.invalid/sg');
  for (const t of saves.TABLES) db.prepare(`DELETE FROM ${t}`).run();
  setSetting('fs_save', '');

  sg('Bilk', '2026-07-26');
  db.prepare("INSERT INTO fs_farms(id, name, color, updated_at) VALUES (1, 'Alter Hof', '#123456', ?)").run(now());
  const uid = Number(db.prepare("INSERT INTO users(username, password_hash, role, created_at) VALUES ('bauer', 'x', 'user', ?)").run(now()).lastInsertRowid);
  db.prepare('INSERT INTO fs_members(user_id, farm_id, joined_at) VALUES (?, 1, ?)').run(uid, now());
  db.prepare("INSERT INTO fs_tasks(farm_id, title, created_by, created_at) VALUES (1, 'Silo leeren', ?, ?)").run(uid, now());
  setSetting('fs_day', JSON.stringify({ day: 174 }));
  assert.equal(saves.check(), null, 'erster Lauf merkt sich nur den Spielstand');
  assert.equal(saves.unsure(), true, 'vorhandene Daten: Admin entscheidet');
  saves.keep();
  assert.equal(F.mapMod(), 'FS25_Bilk');

  sg('Flusstal', '2026-10-29');
  const sw = saves.check();
  assert.deepEqual(sw, { from: 'Bilk', to: 'Flusstal', restored: false });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM fs_farms').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM fs_tasks').get().n, 0);
  assert.equal(getSetting('fs_day', ''), '');
  hub.invalidate();
  assert.ok(!hub.model().farms.some(f => f.name === 'Alter Hof'), 'alter Hof ist weg');
  db.prepare("INSERT INTO fs_farms(id, name, updated_at) VALUES (1, 'Neuer Hof', ?)").run(now());
  const parked = saves.list().find(r => r.key === 'Bilk|2026-07-26');
  assert.equal(parked.counts.Aufgaben, 1);

  sg('Bilk', '2026-07-26');
  assert.equal(saves.check().restored, true);
  assert.equal(db.prepare('SELECT name FROM fs_farms WHERE id = 1').get().name, 'Alter Hof');
  assert.equal(db.prepare('SELECT farm_id FROM fs_members WHERE user_id = ?').get(uid).farm_id, 1);
  assert.equal(JSON.parse(getSetting('fs_day', 'null')).day, 174);
  assert.equal(saves.list().find(r => r.key === 'Flusstal|2026-10-29').counts.Höfe, 1, 'neuer Spielstand liegt jetzt beiseite');

  // Von Hand: beiseitelegen und leer beginnen, dann wieder hierher holen
  assert.equal(saves.restart(), true);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM fs_tasks').get().n, 0);
  const alt = saves.list().find(r => r.key.startsWith('alt-'));
  assert.equal(saves.adopt(alt.key), true);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM fs_tasks').get().n, 1);
  setSetting('fs_url_savegame', '');
});

test('Höfe: mit farms.xml zählen nur Höfe aus dem Spielstand', () => {
  const { db, now } = require('../src/db');
  const hub = require('../src/fshub');
  db.prepare("INSERT OR REPLACE INTO fs_farms(id, name, updated_at) VALUES (5, 'Nur hier angelegt', ?)").run(now());
  const prev = db.prepare("SELECT data FROM fs_cache WHERE feed = 'ftp'").get();
  const data = JSON.parse(prev.data);
  data.files['farms.xml'] = F.readFarms('<farms><farm farmId="2" name="Im Spiel" money="5"/></farms>');
  db.prepare("UPDATE fs_cache SET data = ? WHERE feed = 'ftp'").run(JSON.stringify(data));
  F.load();
  hub.invalidate();
  const ids = hub.model().farms.map(f => f.id);
  assert.ok(ids.includes(2) && !ids.includes(5), ids.join(','));
  db.prepare("UPDATE fs_cache SET data = ? WHERE feed = 'ftp'").run(prev.data);
  F.load();
  hub.invalidate();
  assert.ok(hub.model().farms.some(f => f.id === 5), 'ohne farms.xml wieder alle');
});

test('Felder ohne Eintrag im Stats-Feed kommen aus den Grundstücken', () => {
  const { db, now } = require('../src/db');
  const hub = require('../src/fshub');
  const prev = db.prepare("SELECT data FROM fs_cache WHERE feed = 'stats'").get().data;
  const st = JSON.parse(prev);
  const n = st.fields.length;
  st.fields = [];
  db.prepare("UPDATE fs_cache SET data = ?, ok_at = ? WHERE feed = 'stats'").run(JSON.stringify(st), now());
  F.load(); hub.invalidate();
  const m = hub.model();
  assert.ok(m.fields.length >= n, `${m.fields.length} Felder aus ${st.farmlands.length} Grundstücken`);
  assert.ok(m.fields.every(f => Number.isFinite(f.x) && f.area > 0));
  db.prepare("UPDATE fs_cache SET data = ? WHERE feed = 'stats'").run(prev);
  F.load(); hub.invalidate();
});

test('Grundstücke ohne Feld: auf der Karte als Grundstück, zählen nicht als Feld', () => {
  const hub = require('../src/fshub');
  hub.invalidate();
  const m = hub.model(), st = require('../src/fsfeeds').get('stats');
  const parcels = m.fields.filter(f => f.parcel);
  assert.equal(m.fields.length, st.farmlands.filter(l => l.area > 0 && l.id < 255).length, 'alle Grundstücke auf der Karte');
  assert.equal(parcels.length, m.fields.length - st.fields.length);
  assert.ok(parcels.length > 0);
  assert.ok(parcels.every(p => !st.fields.some(f => f.id === p.id)));
  for (const f of m.farms) assert.equal(f.land.fields, m.fields.filter(x => x.owner === f.id && !x.parcel).length);
  const s = hub.shapes();
  if (s) for (const p of parcels) assert.ok(!s.shapes[p.id] || ['hand', 'bild'].includes(s.shapes[p.id].src), 'keine Form aus dem Feldboden');
});

test('Produktionsplaner ohne Mod: Gebäude und Produktionen aus placeables.xml, Obstplantagen, Rechner', () => {
  const P = require('../src/fsprod');
  const plc = F.readPlaceables(`<placeables>
    <placeable isPreplaced="true" uniqueId="preplaced_bakery_9110d7de511c929e2cf101b72b5310af" price="150000.000000" farmId="0">
      <productionPoint><production id="bread" isEnabled="true"/><production id="bananaCake" isEnabled="false"/><storage farmId="0"/></productionPoint></placeable>
    <placeable filename="$pdlcdir$beansAndAlpacasPack/placeables/orchards/coffeeCherries/coffeeCherriesOrchard.xml" position="0 -151 0" farmId="0">
      <newFence><segment start="10 20 -200" end="10 21 -176" id="COFFEE_ORCHARD"/><segment start="12 20 -200" end="12 21 -176" id="COFFEE_ORCHARD"/></newFence></placeable>
  </placeables>`);
  const orch = plc.find(p => p.kind === 'orchard');
  assert.deepEqual(orch.rows[0], [10, -200, 10, -176]);
  assert.equal(orch.type, 'COFFEE');
  assert.equal(P.typeOf(plc[0]), 'bakery');
  const L = P.all(null, plc);
  assert.equal(L.eigene.length, 0);
  const b = L.karte[0];
  assert.deepEqual([b.key, b.name, b.section, b.price], ['preplaced_bakery_9110d7de511c929e2cf101b72b5310af', 'Bäckerei', 'karte', 150000]);
  assert.deepEqual(b.recipes.map(r => [r.name, r.active, r.complete]), [['Brot', true, false], ['Bananenkuchen', false, false]]);
  assert.equal(L.katalog[0].key, 'k:bakery', 'ohne Katalog der Mod: je Art eins aus der Karte');
  // Rechner: knappstes Input bestimmt die Zyklen; seriell mit zwei gleichzeitig: halbe Zyklen pro Monat
  const r = { inputs: [{ fill: 'FLOUR', amount: 300 }, { fill: 'SUGAR', amount: 50 }], outputs: [{ fill: 'BREAD', amount: 200 }], cycles: 20, cost: 1200.5 };
  const c = P.calc(r, { amounts: [1000, 500], shared: 2, dpp: 3 });
  assert.equal(c.cycles, 3);
  assert.equal(c.made[0].total, 600);
  assert.equal(c.used[0].left, 100);
  assert.equal(c.perMonth, 10);
  assert.equal(c.months, 0.3);
  assert.ok(Math.abs(c.days - 0.9) < 1e-9);
  assert.equal(P.calc(r, { cycles: 40 }).months, 2);
});

test('Bodenverteilung: von Hand je Feld, gehört zum Spielstand', () => {
  const hub = require('../src/fshub');
  const id = hub.model().fields[0].id;
  assert.equal(hub.saveSoil(id, { loamy_sand: '17', sandy_loam: '~53', loam: '28,5', silty_clay: '', yield: '101' }, null), true);
  assert.equal(hub.saveSoil(99999, { loam: '50' }, null), false);
  const s = hub.soils().get(id);
  assert.equal(s.top, 'sandy_loam');
  assert.deepEqual(s.parts.map(x => x.pct), [17, 53, 28.5]);
  assert.equal(hub.fieldStates().find(f => f.id === id).soil.yield, 101);
  assert.ok(require('../src/fssaves').TABLES.includes('fs_soil'));
  hub.saveSoil(id, {}, null);
  assert.equal(hub.soils().has(id), false, 'alles leer löscht');
});

test('Spieldaten aus farmingHubExport.xml: Grundstücke, Stationen, Produktionen mit Lager, Katalog, Waren und Früchte', () => {
  const E = require('../src/fsexport');
  const P = require('../src/fsprod');
  const ST = require('../src/fsstations');
  const C = require('../src/fscrops');
  const N = require('../src/fsnames');
  const e = E.read(fs.readFileSync(path.join(__dirname, 'fixtures', 'fs', 'farmingHubExport.xml'), 'utf8'));
  assert.deepEqual([e.version, e.mapTitle, e.dpp], [2, 'Riverbend Springs', 2]);
  assert.deepEqual(e.fields.map(f => [f.id, f.farmland, f.pts.length]), [[1, 1, 4], [2, 3, 4]]);
  assert.deepEqual(e.fields[1].pts[2], [250, 180]);
  // Grundstückskarte 64 × 64 auf 2048 m: eine Zelle 32 m
  const box = id => { const p = e.parcels[id], xs = p.map(q => q[0]), zs = p.map(q => q[1]); return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)]; };
  assert.deepEqual(box(1), [-512, -512, -256, -256]);
  assert.deepEqual(box(2), [-1024, -64, 1024, 0]);
  assert.deepEqual(Object.keys(e.parcels).sort(), ['1', '2', '3']);
  assert.equal(E.parcelAt(e, -400, -400), 1);
  assert.equal(E.parcelAt(e, 175, 140), 3);
  assert.equal(E.parcelAt(e, 900, 900), 0);
  const silo = e.placeables.find(p => p.hotspot === 'UNLOADING');
  assert.deepEqual([silo.x, silo.z, silo.sells], [310, -190, ['BARLEY', 'WHEAT']]);
  assert.deepEqual(e.placeables.find(p => p.hotspot === 'FUEL').buys, ['DIESEL']);
  const plc = [{ uid: silo.uid, x: null, z: null, productions: [] }, { uid: 'eigen', x: 1, z: 2, productions: [] }];
  const withPos = E.withPositions(plc, e);
  assert.deepEqual([withPos[0].x, withPos[0].z, withPos[1].x], [310, -190, 1]);

  // Stationen mit Position aus dem Spiel, Produktionen führen in den Planer
  const S = ST.list(e, []);
  assert.deepEqual(S.map(s => [s.cat, s.name, s.placed]).filter(x => x[0] !== 'produktion'), [['verkauf', 'Getreidesilo', true], ['tanken', 'Tankstelle', true]]);
  assert.equal(S.find(s => s.type === 'bakery').planner, 'preplaced_bakery_cccccccccccccccccccccccccccccccc');

  // Planer: Karte, eigene Gebäude mit Lager, Katalog aus dem Shop
  const L = P.all(e, [], () => 'Lage');
  assert.deepEqual(L.karte.map(b => b.name), ['Bäckerei']);
  assert.deepEqual(L.eigene.map(b => [b.name, b.farmId, b.mode]), [['Spinnerei am Hof', 1, '']]);
  assert.deepEqual(L.karte[0].storage.find(x => x.fill === 'FLOUR'), { fill: 'FLOUR', name: 'Mehl', level: 1200, cap: 10000 });
  assert.equal(L.karte[0].mode, 'seriell');
  assert.equal(L.karte[0].catalog, 'k:$data/placeables/bakery.xml');
  assert.deepEqual(L.katalog.map(b => [b.name, b.price, b.dlc]), [['Bäckerei', 250000, ''], ['Farbenfabrik', 420000, 'Beans and Alpacas']]);
  assert.deepEqual(L.katalog[1].recipes[0].inputs.map(x => x.fill), ['ALPACAFLEECE', 'WATER'], 'Farbenfabrik mit Rezept aus dem Spiel');
  const yarn = L.eigene[0].recipes[0];
  assert.deepEqual([yarn.name, yarn.active, yarn.complete, yarn.cycles], ['Garn', true, true, 200]);
  // Wo eine Ware vorkommt: Alpakavlies geht in Spinnerei und Farbenfabrik, Brot kommt aus der Bäckerei (Katalog zuerst, je Art einmal)
  const U = P.uses(L, 'ALPACAFLEECE');
  assert.deepEqual(U.input.map(u => [u.building.name, u.recipe.name, u.amount]), [['Farbenfabrik', 'Farbe', 5], ['Spinnerei am Hof', 'Garn', 10]]);
  assert.deepEqual(U.output, []);
  assert.deepEqual(P.uses(L, 'BREAD').output.map(u => u.building.key), ['k:$data/placeables/bakery.xml']);

  // Waren: eigenes Wörterbuch geht vor, sonst der Name aus dem Spiel (nur auf Deutsch), sonst lesbar gemacht
  N.setGameTitles(e.fillTypes, e.language);
  assert.equal(N.fill('ALPACAFLEECE'), 'Alpakavlies');
  assert.equal(N.fill('MODFILL'), 'Spezialware');
  N.setGameTitles(e.fillTypes, 'en');
  assert.equal(N.fill('MODFILL'), 'Modfill');
  N.setGameTitles([], '');

  // Früchte: Saat und Ernte aus dem Spiel (Monat 1 = März), sonst Vorlage; Kaffee ist Dauerkultur ohne Saat
  const crops = C.list(e);
  const w = crops.find(c => c.name === 'WHEAT'), k = crops.find(c => c.name === 'COFFEE');
  assert.deepEqual([w.label, w.sow, w.harvest, w.fromGame, w.kind, w.harvestMin], ['Weizen', [6, 7], [4, 5], true, 'field', 8]);
  assert.deepEqual([k.label, k.kind, k.sow, k.harvest, k.planned], ['Kaffee', 'perm', [], [6, 7], true]);
  assert.equal(C.list(null).find(c => c.name === 'BANANA').kind, 'perm', 'ohne Mod: Vorlage');

  // Die Mod zum Herunterladen: modDesc, Skript und Symbol als DDS
  const AdmZip = require('adm-zip');
  const zip = new AdmZip(E.modZip());
  assert.deepEqual(zip.getEntries().map(x => x.entryName).sort(), ['FarmingHubExport.lua', 'FarmingHubLive.lua', 'HubLinkEvents.lua', 'HubLinkHud.lua', 'icon_farmingHubExport.dds', 'modDesc.xml']);
  const dds = zip.getEntry('icon_farmingHubExport.dds').getData();
  assert.equal(dds.toString('latin1', 0, 4), 'DDS ');
  assert.equal(dds.length, 128 + 256 * 256 * 4);
  assert.match(zip.getEntry('modDesc.xml').getData().toString(), /<sourceFile filename="FarmingHubExport.lua"\/>/);
  assert.match(zip.getEntry('modDesc.xml').getData().toString(), /<sourceFile filename="FarmingHubLive.lua"\/>/);
  assert.match(zip.getEntry('modDesc.xml').getData().toString(), /<version>3\.3\.0\.0<\/version>/);
  assert.throws(() => E.read('<placeables/>'), /FS25 Hub Link/);
});

test('Export auf Englisch: deutsche Gebäude- und Rezeptnamen, Platzhalter weg, Katalog ohne Doppel', () => {
  const P = require('../src/fsprod');
  const rec = (id, name, inputs, out) => ({ id, name, cycles: 10, cost: 1, active: true, inputs: inputs.map(f => ({ fill: f, amount: 1 })), outputs: [{ fill: out, amount: 1 }] });
  const bakery = f => ({ file: f, name: 'Bakery', price: 150000, dlc: '', shared: false, category: 'PRODUCTIONPOINTS', capacity: null, storage: [],
    recipes: [rec('bread', 'Bread', ['FLOUR'], 'BREAD'), rec('breadRiceFlour', 'Bread', ['RICEFLOUR'], 'BREAD'), rec('cake', '%s (%s)', ['FLOUR', 'EGG'], 'CAKE')] });
  const ex = { language: 'en', placeables: [], catalog: [
    bakery('data/placeables/brandless/productionPointsGeneric/bakery/bakery.xml'), bakery('data/placeables/mapEU/bakery/bakery.xml'),
    { ...bakery('data/placeables/brandless/productionPointsSmall/bakery/bakery.xml'), price: 36000 },
    { file: 'data/placeables/dairy/dairy.xml', name: 'Dairy', price: 1, dlc: '', shared: true, storage: [], recipes: [
      rec('coffeeYogurt', 'Coffee Yogurt', ['MILK', 'COFFEEBAGS'], 'COFFEEYOGURT'), rec('coffeeYogurtSugar', 'Coffee Yogurt', ['MILK', 'COFFEEBAGS', 'SUGAR'], 'COFFEEYOGURT')] }] };
  const k = P.all(ex, []).katalog;
  assert.deepEqual(k.map(b => b.name), ['Bäckerei', 'Bäckerei (klein)', 'Molkerei']);
  assert.deepEqual(k[0].recipes.map(r => r.name), ['Brot aus Mehl', 'Brot aus Reismehl', 'Kuchen']);
  assert.deepEqual(k[2].recipes.map(r => r.name), ['Kaffeejoghurt', 'Kaffeejoghurt aus Zucker']);
  // Auf Deutsch gelten die Namen aus dem Spiel, Platzhalter nie
  const de = P.all({ ...ex, language: 'de' }, []).katalog;
  assert.deepEqual(de[0].recipes.map(r => r.name), ['Bread', 'Bread', 'Kuchen']);
});

test('Wiki: Tierdaten aus dem Export, wiki.xml, Tiere für den Planer, Stall, Anbaukalender', () => {
  const E = require('../src/fsexport');
  const W = require('../src/fswiki');
  const ST = require('../src/fsstations');
  const e = E.read(fs.readFileSync(path.join(__dirname, 'fixtures', 'fs', 'farmingHubExport.xml'), 'utf8'));
  assert.deepEqual(e.animals.types.map(t => [t.type, t.consumption, t.subs.length]), [['COW', 'SERIAL', 2], ['ALPACA', 'PARALLEL', 2]]);
  assert.deepEqual(e.animals.types[0].subs[0].curves.milk, { fill: 'MILK', pts: [[0, 0], [13, 0], [14, 600]] });
  assert.equal(e.animals.types[0].subs[0].curves.liquidManure.fill, 'LIQUIDMANURE');
  // Ställe sind keine Stationen, haben aber ihren Zustand aus dem Spiel
  const barn = e.placeables.find(p => p.uid === 'placeable_77');
  assert.deepEqual([barn.stall.type, barn.stall.animals, barn.stall.max, barn.stall.infos.length], ['COW', 12, 80, 6]);
  assert.ok(!ST.list(e, []).some(s => s.uid === 'placeable_77'));

  // wiki.xml: einmal aus dem Export, gleich bleibt gleich, gelesen wie geschrieben
  W.remove();
  assert.equal(W.sync(e), true);
  assert.equal(W.sync(e), false, 'nichts Neues');
  const st = W.stored();
  assert.equal(st.source, 'export');
  assert.deepEqual(JSON.stringify([st.ta, st.types, st.recipes, st.stalls]), JSON.stringify([e.animals.ta, e.animals.types, e.animals.recipes, e.animals.stalls]));
  assert.match(fs.readFileSync(W.file(), 'utf8'), /<farmingWiki version="1" source="export" mapTitle="Riverbend Springs"/);

  // Je Monat: Wert × timeAdjustment (0,5) × Tage pro Monat (2); ausgewachsen = volle Milch ab 14 Monaten
  const a = W.animals(2);
  const cow = a.types[0], holstein = cow.subs[0];
  assert.deepEqual([cow.label, holstein.label, holstein.adult], ['Kühe', 'Kühe (Holstein)', 14]);
  assert.deepEqual(holstein.makes.map(x => [x.fill, Math.round(x.perMonth)]), [['MILK', 600], ['LIQUIDMANURE', 250]]);
  assert.equal(Math.round(holstein.needs.food), 279, '30 → 350 bis 18 Monate, bei 14 Monaten');
  assert.deepEqual([holstein.buyYoung, holstein.buy], [250, 1500 - 300 * 2 / 48]);
  assert.deepEqual(cow.groups.map(g => [g.label, g.weight]), [['Totalmischration', 1], ['Heu', 0.8], ['Silage', 0.8], ['Weide', 0.4]]);
  assert.deepEqual(cow.recipes[0].parts.map(p => p.label), ['Heu', 'Silage', 'Mineralfutter']);
  assert.deepEqual(cow.stalls.map(s => [s.name, s.max]), [['Cow Barn (big)', 80]]);
  assert.equal(a.types[1].label, 'Alpakas');
  // Planer: 10 Alpakavlies je Zyklus × 200 Zyklen = 2 000 im Monat, ein Alpaka liefert 40 → 50 Alpakas (weiß und braun gleich)
  const herd = W.herd({ cycles: 200, inputs: [{ fill: 'ALPACAFLEECE', amount: 10, name: 'Alpakavlies' }, { fill: 'WATER', amount: 5 }] }, 2);
  assert.deepEqual(herd.map(h => [h.fill, h.need, h.options.map(o => [o.n, o.labels.length])]), [['ALPACAFLEECE', 2000, [[50, 2]]]]);
  assert.deepEqual(W.herd({ cycles: 0, inputs: [{ fill: 'MILK', amount: 1 }] }, 2), []);

  // Stall: aus dem Spiel mit deutschen Titeln; ohne Mod nur Füllstände, Futter nach den Gruppen des Wikis
  const s1 = W.stall(barn.stall, [], []);
  assert.deepEqual(s1.condition.map(r => r.title), ['Stroh', 'Wasser', 'Gülle']);
  assert.deepEqual(s1.food.map(r => [r.title, r.ratio]), [['Totalmischration (100%)', 0.025], ['Heu (80%)', 0], ['Weide (40%)', 0.883]]);
  const s2 = W.stall(null, [{ fill: 'GRASS_WINDROW', name: 'Gras', amount: 2000, food: true }, { fill: 'STRAW', name: 'Stroh', amount: 30, food: false }], ['COW_HOLSTEIN']);
  assert.deepEqual(s2.food.map(r => [r.title, r.value]), [['Totalmischration (100%)', 0], ['Heu (80%)', 0], ['Silage (80%)', 0], ['Weide (40%)', 2000]]);
  assert.deepEqual(s2.condition.map(r => [r.title, r.value]), [['Stroh', 30]]);

  // Hochladen: bleibt, auch wenn ein Export anderes bringt
  W.upload(Buffer.from(fs.readFileSync(W.file(), 'utf8').replace('price="60000"', 'price="61000"')));
  assert.equal(W.stored().source, 'upload');
  assert.equal(W.sync(e), false);
  assert.equal(W.stored().stalls[1].price, 61000);
  assert.throws(() => W.upload(Buffer.from('<farmingWiki><animals/></farmingWiki>')), /keine Tiere/);
  W.remove();
  assert.equal(W.animals(1), null);

  // Anbaukalender: Südhalbkugel beginnt mit September, Balken über den Jahreswechsel geteilt
  assert.equal(W.hemisphere({ mapId: 'pdlc_beansAndAlpacasPack.beansAndAlpacasMap' }, ''), 'south');
  assert.equal(W.hemisphere({ mapId: 'MapUS', hemisphere: 'south' }, ''), 'south');
  assert.equal(W.hemisphere({ mapId: 'pdlc_beansAndAlpacasPack.x' }, 'nord'), 'north');
  // Sprung in einer Kurve wie im Spiel: Milch erst ab 12 Monaten, dann voll; Erzeugnisse auch unter eigenem Namen (Mod 2.6)
  assert.deepEqual([W.at([[0, 0], [12, 0], [12, 150]], 11), W.at([[0, 0], [12, 0], [12, 150]], 12), W.at([[0, 0], [12, 0], [12, 150]], 30)], [0, 150, 150]);
  const zoo = E.read('<farmingHubExport version="2"><animals><animal type="COW"><subType name="C"><curve kind="milk" fillType="MILK" pts="0:0 12:0 12:150"/></subType></animal>'
    + '<animal type="ALPACA"><subType name="A"><curve kind="wool" fillType="ALPACA_WOOL" pts="0:0 8:20"/></subType>'
    + '<subType name="B" fleeceRegrowth="10"><curve kind="fleece" pts="0:0 8:20"/></subType></animal></animals></farmingHubExport>').animals;
  const [cowSub, alpaca] = zoo.types.map(t => t.subs[0]);
  assert.deepEqual(W.products(cowSub, W.adultAge(cowSub), 1).map(p => [p.fill, p.perMonth]), [['MILK', 150]]);
  assert.deepEqual(W.products(alpaca, W.adultAge(alpaca), 1).map(p => [p.fill, p.perMonth]), [['ALPACA_WOOL', 20]]);
  // Alpakas (Mod 2.7): Vlies je Schur × Nachwachsen pro Tag × Tage
  const sheared = zoo.types[1].subs[1];
  // fleeceRegrowth ist Prozent pro Tag: 10 % → 20 l volles Vlies liefern 2 l am Tag, 60 l in 30 Tagen
  assert.deepEqual(W.products(sheared, W.adultAge(sheared), 30).map(p => [p.fill, +p.perMonth.toFixed(3), p.perShear, p.days]), [['ALPACAFLEECE', 60, 20, 10]]);
  assert.match(W.toXml(zoo), /<subType name="B" fillType="B" fleeceRegrowth="10">/);
  // Kalender ab Januar: Periode 11 (Januar im Norden) steht vorn, Dezember→Januar wird geteilt
  assert.deepEqual([W.months()[0], W.months(true)[2]], ['Januar', 'Mär']);
  assert.deepEqual(W.runs([0, 1, 4, 10, 11]), [[0, 4], [6, 1]]);
  assert.deepEqual(W.runs([9, 10]), [[0, 1], [11, 1]]);
  // Mod bis 2.4: jede Frucht „2–12“ → Daten verwerfen, die Vorlage gilt
  const bad = E.read('<farmingHubExport version="2"><fruitTypes><fruitType name="WHEAT" plant="2 3 4 5 6 7 8 9 10 11 12" harvest="2 3 4 5 6 7 8 9 10 11 12"/>'
    + '<fruitType name="BARLEY" plant="2 3 4 5 6 7 8 9 10 11 12" harvest="2 3 4 5 6 7 8 9 10 11 12"/></fruitTypes></farmingHubExport>');
  assert.deepEqual(bad.fruitTypes.map(f => f.sow.length + f.harvest.length), [0, 0]);
  assert.equal(W.title('Total Mixed Ration (100 %)'), 'Totalmischration (100%)');
  assert.equal(W.title('Spezialfutter'), 'Spezialfutter');
});

test('Ordner: eingestellter Ordner kommt in die Liste, Wechseln stellt den FTP um', () => {
  const { db, now, getSetting, setSetting } = require('../src/db');
  const saves = require('../src/fssaves');
  setSetting('fs_slots', '');
  setSetting('fs_ftp_host', 'ftp.example.invalid');
  setSetting('fs_ftp_path', '/profile/savegame1');
  const put = db.prepare("INSERT INTO fs_cache(feed, data, ok_at, tried_at) VALUES ('ftp', ?, ?, ?) ON CONFLICT(feed) DO UPDATE SET data = excluded.data");
  put.run(JSON.stringify({ dir: '/profile/savegame1', at: now(), files: { 'careerSavegame.xml': { title: 'Catuaí mit Jan', mapTitle: 'Catuaí', created: '2026-10-29', saveDate: '2026-10-31' } } }), now(), now());
  F.load();
  saves.syncSlot();
  let l = saves.slots();
  assert.equal(l.length, 1);
  assert.equal(l[0].map, 'Catuaí');
  assert.equal(l[0].active, true);
  assert.equal(saves.cleanDir('profile\\savegame2/'), '/profile/savegame2');
  saves.addSlot('profile/savegame2', 'Zweiter');
  assert.equal(saves.removeSlot('/profile/savegame1'), false, 'eingestellter Ordner bleibt');
  assert.equal(saves.useSlot('/profile/savegame9'), false, 'unbekannter Ordner');
  assert.equal(saves.useSlot('/profile/savegame2'), true);
  assert.equal(getSetting('fs_ftp_path'), '/profile/savegame2');
  assert.equal(F.get('ftp'), null, 'alte FTP-Daten sind weg');
  l = saves.slots();
  assert.equal(l.find(s => s.dir === '/profile/savegame2').active, true);
  assert.equal(l.find(s => s.dir === '/profile/savegame2').name, 'Zweiter');
  // Webinterface zeigt anderen Spielstand als der Ordner: Hinweis mit passendem Ordner, folgen nur auf Wunsch
  setSetting('fs_url_savegame', 'http://example.invalid/sg');
  db.prepare("INSERT INTO fs_cache(feed, data, ok_at, tried_at) VALUES ('savegame', ?, ?, ?) ON CONFLICT(feed) DO UPDATE SET data = excluded.data")
    .run(JSON.stringify({ title: 'Catuaí mit Jan', mapTitle: 'Catuaí', created: '2026-10-29' }), now(), now());
  put.run(JSON.stringify({ dir: '/profile/savegame2', at: now(), files: { 'careerSavegame.xml': { title: 'Alt', mapTitle: 'Riverbend', created: '2025-01-01' } } }), now(), now());
  F.load();
  const mm = saves.mismatch();
  assert.equal(mm.server.map, 'Catuaí');
  assert.equal(mm.folder.map, 'Riverbend');
  assert.equal(mm.fit, '/profile/savegame1');
  assert.equal(saves.follow(), null, 'ohne Haken bleibt der Ordner');
  setSetting('fs_slots_follow', '1');
  assert.equal(saves.follow(), '/profile/savegame1');
  assert.equal(getSetting('fs_ftp_path'), '/profile/savegame1');
  setSetting('fs_slots_follow', '0');
  setSetting('fs_url_savegame', '');
  setSetting('fs_ftp_host', '');
  db.prepare("DELETE FROM fs_cache WHERE feed IN ('ftp', 'savegame')").run();
  F.load();
});

test('Backup: anlegen, ohne Zugangsdaten, wiederherstellen ersetzt die Hub-Daten', () => {
  const { db, now, getSetting, setSetting } = require('../src/db');
  const bk = require('../src/fsbackup');
  const AdmZip = require('adm-zip');
  for (const t of [...bk.TABLES].reverse()) if (t !== 'fs_cache') db.prepare(`DELETE FROM ${t}`).run();
  db.prepare("INSERT INTO fs_farms(id, name, updated_at) VALUES (1, 'Sonnenhof', ?)").run(now());
  db.prepare("INSERT INTO fs_tasks(farm_id, title, created_at) VALUES (1, 'Kalken', ?)").run(now());
  db.prepare("INSERT INTO fs_notes(body, created_at) VALUES ('Notiz', ?)").run(now());
  db.prepare("INSERT INTO fs_saves(key, map, first_at, last_at, data) VALUES ('Bilk|x', 'Bilk', 1, 1, ?)").run(JSON.stringify({ tables: { fs_farms: [{ id: 3 }] }, settings: {} }));
  setSetting('fs_ftp_pass', 'geheim123');
  setSetting('fs_url_stats', 'http://x.invalid/?code=geheimcode');
  setSetting('fs_map_fit', '{"s":1.1}');
  fs.writeFileSync(path.join(F.FS_DIR, 'map-custom.png'), Buffer.from('BILD-A'));
  fs.writeFileSync(path.join(F.FS_DIR, 'layer-x.png'), Buffer.from('abgeleitet'));
  const name = bk.create({ label: 'vor der Ernte' });
  const raw = fs.readFileSync(bk.file(name));
  assert.ok(!raw.includes('geheim123') && !new AdmZip(raw).getEntry('db.json').getData().toString().includes('geheim'), 'keine Zugangsdaten im Backup');
  const meta = bk.list().find(b => b.name === name);
  assert.equal(meta.label, 'vor der Ernte');
  assert.equal(meta.counts.Höfe, 1);
  assert.equal(meta.counts['weitere Spielstände'], 1);
  assert.deepEqual(meta.files, ['map-custom.png']);

  // Alles ändern, dann zurück
  db.prepare("UPDATE fs_farms SET name = 'Anders'").run();
  db.prepare('DELETE FROM fs_tasks').run();
  db.prepare("INSERT INTO fs_farms(id, name, updated_at) VALUES (2, 'Neu', ?)").run(now());
  setSetting('fs_map_fit', '');
  setSetting('fs_ftp_pass', 'neues-pass');
  fs.writeFileSync(path.join(F.FS_DIR, 'map-custom.png'), Buffer.from('BILD-B'));
  const r = bk.restore(name);
  assert.ok(bk.file(r.before), 'Stand vorher liegt als Backup da');
  assert.equal(bk.list().find(b => b.name === r.before).auto, true);
  assert.deepEqual(db.prepare('SELECT id, name FROM fs_farms ORDER BY id').all().map(x => ({ ...x })), [{ id: 1, name: 'Sonnenhof' }]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM fs_tasks').get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM fs_saves WHERE key = 'Bilk|x'").get().n, 1);
  assert.equal(getSetting('fs_map_fit'), '{"s":1.1}');
  assert.equal(getSetting('fs_ftp_pass'), 'neues-pass', 'Zugangsdaten bleiben unberührt');
  assert.equal(fs.readFileSync(path.join(F.FS_DIR, 'map-custom.png'), 'utf8'), 'BILD-A');

  // Hochladen: nur echte Backups, Namen ohne Pfad
  assert.throws(() => bk.upload(Buffer.from('kein zip')), /./);
  const up = bk.upload(raw, '../../boese.zip');
  assert.equal(up, 'boese.zip');
  assert.equal(bk.file('../boese.zip'), null);
  assert.equal(bk.remove(up), true);
  setSetting('fs_url_stats', '');
  setSetting('fs_ftp_pass', '');
  fs.rmSync(path.join(F.FS_DIR, 'map-custom.png'), { force: true });
});

test('Spielstände: hochgeladener Export wandert mit seinem Spielstand', () => {
  const { db, now, setSetting } = require('../src/db');
  const saves = require('../src/fssaves');
  const put = db.prepare('INSERT INTO fs_cache(feed, data, ok_at, tried_at, error, info) VALUES (?, ?, ?, ?, NULL, NULL) ON CONFLICT(feed) DO UPDATE SET data = excluded.data');
  const sg = (map, created) => { put.run('savegame', JSON.stringify({ title: 't', mapTitle: map, mapId: map, created, money: 0 }), now(), now()); F.load(); };
  setSetting('fs_url_savegame', 'http://example.invalid/sg');
  setSetting('fs_save', '');
  sg('Bilk', '2026-01-01');
  saves.check();
  saves.keep();
  const exp = path.join(F.FS_DIR, 'hub-export.json');
  fs.writeFileSync(exp, '{"mapTitle":"Bilk"}');
  sg('Bilk', '2026-11-11');
  assert.ok(saves.check(), 'gleiche Karte, neuer Spielstand');
  assert.ok(!fs.existsSync(exp), 'Export des alten Spielstands ist beiseitegelegt');
  sg('Bilk', '2026-01-01');
  saves.check();
  assert.equal(fs.readFileSync(exp, 'utf8'), '{"mapTitle":"Bilk"}', 'und wieder da');
  fs.rmSync(exp, { force: true });
  setSetting('fs_url_savegame', '');
});

test('Mod 3.0: Aufgaben aus dem Spiel, Inbox ohne Rückspiegelung, Einstellungen mit rev', () => {
  const { db, now, setSetting } = require('../src/db');
  const hub = require('../src/fshub');
  const L = require('../src/fslive');
  setSetting('fs_ftp_path', '/profile/savegame2');
  assert.equal(L.dir(), '/profile/modSettings/FS25_FarmingHubExport/savegame2');
  const live = L.read(`<?xml version="1.0"?><farmingHubLive version="1" mod="3.0.0.0" seq="4" ack="0" saveDir="savegame2" mapTitle="Catuaí">
    <settings rev="2" export="true" advisor="true"><farm id="1" outputPct="80.0" silo="false"/></settings>
    <tasks count="3">
      <task key="input:1:uid_dairy:MILK" kind="input" farm="1" uid="uid_dairy" name="Dairy" fill="MILK" fillTitle="Milk" sev="2" level="300" cap="10000" pct="3.0" hours="3.0"/>
      <task key="supply:2:uid_barn:Liquid Manure" kind="product" farm="2" uid="uid_barn" name="Sheep Pasture" fillTitle="Liquid Manure" sev="2" pct="95.0"/>
      <task key="blocked:1:uid_dairy:pallets" kind="blocked" farm="1" uid="uid_dairy" name="Dairy" fill="BUTTER" sev="3"/>
    </tasks></farmingHubLive>`);
  assert.equal(live.tasks.length, 3);
  assert.equal(live.settings.farms['1'].outputPct, 80);
  assert.equal(L.titleOf(live.tasks[0]), 'Molkerei: Milch reicht noch 3 Stunden');
  assert.equal(L.titleOf(live.tasks[1]), 'Schafweide: Gülle fast voll (95 %)');
  assert.equal(L.titleOf(live.tasks[2]), 'Molkerei: Paletten-Ausgang blockiert (Butter)');
  assert.equal(L.titleOf({ kind: 'food', farm: 1, name: 'Pigsty (large)', level: 0, cap: 85000, pct: 0 }), 'Schweinestall (groß): Futter leer');

  // Einstellungen: die höhere rev gewinnt
  setSetting('fs_live_settings', JSON.stringify({ rev: 1, export: true, advisor: true, farms: {} }));
  L.apply(live);
  assert.equal(L.settings().rev, 2);
  assert.equal(L.farmSettings(1).outputPct, 80);
  assert.equal(L.farmSettings(1).silo, false);
  assert.equal(L.farmSettings(1).inputHours, 6, 'Vorgabe bleibt');
  const game = () => db.prepare("SELECT * FROM fs_tasks WHERE source = 'game' ORDER BY id").all();
  assert.equal(game().length, 3);
  assert.ok(game().every(t => t.game_open === 1 && !t.done_at));

  // Gleiches Problem nochmal: keine zweite Aufgabe, Titel aktuell
  live.tasks[0].hours = 1.6;
  L.syncTasks(live.tasks);
  assert.equal(game().length, 3);
  assert.equal(game()[0].title, 'Molkerei: Milch reicht noch 2 Stunden');

  // Im Hub abgehakt, im Spiel noch offen: kommt nicht wieder
  const uid = Number(db.prepare("INSERT INTO users(username, password_hash, role, created_at) VALUES ('melker', 'x', 'user', ?)").run(now()).lastInsertRowid);
  const first = game()[0];
  db.prepare('UPDATE fs_tasks SET assignee_id = ? WHERE id = ?').run(uid, first.id);
  hub.completeTask(first.id, { id: uid });
  L.syncTasks(live.tasks);
  assert.equal(game().length, 3, 'abgehakt bleibt abgehakt');
  // Löschen eines offenen Problems = abhaken
  hub.removeTask(game()[2].id);
  assert.ok(game()[2].done_at);
  L.syncTasks(live.tasks);
  assert.equal(game().length, 3);

  // Hub-Aufgabe und Notiz gehen in die Inbox, Spiel-Aufgaben nie
  hub.addTask({ id: uid }, 1, { title: 'Kühe füttern & melken', note: 'Zeile 1\nZeile 2' });
  hub.addNote({ id: uid }, 'Bitte <Mist> fahren');
  const body = L.inboxBody();
  assert.match(body, /<settings rev="2" export="true" advisor="true">/);
  assert.match(body, /<farm id="1"[^>]*outputPct="80"[^>]*silo="false"/);
  assert.match(body, /title="Kühe füttern &amp; melken" note="Zeile 1&#10;Zeile 2"/);
  assert.match(body, /text="Bitte &lt;Mist&gt; fahren"/);
  assert.doesNotMatch(body, /Paletten-Ausgang|reicht noch|Gülle/, 'Aufgaben aus dem Spiel gehen nicht zurück');
  assert.match(body, /<game key="input:1:uid_dairy:MILK"\/>/, 'im Hub abgehakt, im Spiel offen');
  assert.match(L.inboxXml(7, body), /^<\?xml[^>]*\?>\n<farmingHubInbox version="1" seq="7"/);

  // Im Spiel behoben: offene werden abgehakt, beim nächsten Mal gibt es wieder eine Aufgabe mit dem alten Zuständigen
  L.syncTasks([live.tasks[1]]);
  assert.deepEqual(game().map(t => [!!t.done_at, t.game_open]), [[true, 0], [false, 1], [true, 0]], 'nur die Gülle bleibt offen');
  const again = L.syncTasks(live.tasks);
  assert.equal(again.length, 2);
  assert.equal(again.find(t => t.kind === 'input').assignee_id, uid);
  assert.doesNotMatch(L.inboxBody(), /<game key="input/);

  // Seitenverwaltung und Hof-Formular zählen rev über das hinaus, was die Mod zuletzt hatte
  L.saveGlobal({ export: '0', advisor: '1' });
  assert.equal(L.settings().export, false);
  assert.equal(L.settings().rev, 3);
  L.saveFarm(2, { input: '1', inputHours: '500', outputPct: 'x', stall: '1' });
  assert.deepEqual([L.farmSettings(2).inputHours, L.farmSettings(2).outputPct, L.farmSettings(2).output, L.settings().rev], [240, 85, false, 4]);
  setSetting('fs_ftp_path', '');
});

test('Mod 3.1: im Spiel abgehakt, jede Nummer einmal, Bestätigung in der Inbox', () => {
  const { db, now } = require('../src/db');
  const hub = require('../src/fshub');
  const L = require('../src/fslive');
  const uid = Number(db.prepare("INSERT INTO users(username, password_hash, role, created_at) VALUES ('spieler31', 'x', 'user', ?)").run(now()).lastInsertRowid);
  L.syncTasks([{ key: 'stopped:3:uid_spin:ALPACA', kind: 'stopped', farm: 3, uid: 'uid_spin', name: 'Spinnery', fill: 'ALPACAFLEECE', sev: 3 }]);
  const game = db.prepare("SELECT * FROM fs_tasks WHERE game_key = 'stopped:3:uid_spin:ALPACA'").get();
  hub.addTask({ id: uid }, 3, { title: 'Wolle holen', repeat: 'days', repeat_n: '1' });
  hub.addTask({ id: uid }, 4, { title: 'Anderer Hof' });
  const mine = db.prepare("SELECT * FROM fs_tasks WHERE title = 'Wolle holen'").get();
  const other = db.prepare("SELECT * FROM fs_tasks WHERE title = 'Anderer Hof'").get();
  const live = L.read(`<farmingHubLive version="1" mod="3.1.0.0" seq="9" ack="0"><tasks count="0"/><done>
    <item id="261031150000-1" game="stopped:3:uid_spin:ALPACA" by="Dancor" farm="3"/>
    <item id="261031150000-2" task="${mine.id}" by="Dancor" farm="3"/>
    <item id="261031150000-3" task="${other.id}" by="Dancor" farm="3"/>
    <item id="" task="1"/></done></farmingHubLive>`);
  assert.equal(live.done.length, 3, 'ohne Nummer zählt nicht');
  assert.equal(L.applyDone(live.done), 2, 'Aufgabe eines fremden Hofs bleibt offen');
  const t = id => db.prepare('SELECT * FROM fs_tasks WHERE id = ?').get(id);
  assert.ok(t(game.id).done_at);
  assert.equal(t(game.id).done_game_by, 'Dancor');
  assert.equal(t(game.id).game_open, 1, 'besteht im Spiel noch: gilt als gesehen');
  assert.ok(t(mine.id).done_at);
  assert.equal(t(mine.id).done_game_by, 'Dancor');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM fs_tasks WHERE title = 'Wolle holen' AND done_at IS NULL").get().n, 1, 'regelmäßige Aufgabe: nächste Runde');
  assert.ok(!t(other.id).done_at);
  // Dieselbe Datei nochmal: nichts doppelt
  assert.equal(L.applyDone(live.done), 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM fs_tasks WHERE title = 'Wolle holen'").get().n, 2);
  const body = L.inboxBody();
  assert.match(body, /<doneAck>[\s\S]*<d id="261031150000-1"\/>[\s\S]*<d id="261031150000-3"\/>[\s\S]*<\/doneAck>/);
  assert.match(body, /<game key="stopped:3:uid_spin:ALPACA"\/>/);
  assert.doesNotMatch(body, new RegExp(`<task id="${mine.id}"`));
});

test('Mod 3.3: Geld, Wetter, Felder und Aufträge live aus dem Spiel', () => {
  const { setSetting, now } = require('../src/db');
  const hub = require('../src/fshub');
  const L = require('../src/fslive');
  setSetting('fs_ftp_path', '/profile/savegame2');
  const live = L.read(`<farmingHubLive version="1" mod="3.3.0.0" seq="20" ack="0"><tasks count="0"/>
    <farms><farm id="1" money="123456" loan="50000"><stats day="0" harvestIncome="1200.5" purchaseFuel="-80"/><stats day="1" soldMilk="300"/></farm>
      <farm id="2" money="999" loan="0"/></farms>
    <environment day="40" dayTime="36000000" daysPerPeriod="3" temp="17.5"><weather>
      <instance typeName="SUN" startDay="40" startDayTime="0" duration="86400000"/><instance typeName="RAIN" startDay="41" startDayTime="0" duration="43200000"/></weather></environment>
    <fields><field id="7" fruitType="WHEAT" groundType="SOWN" growthState="3" limeLevel="1" weedState="2"/><field id="8" fruitType="UNKNOWN" groundType="PLOWED"/></fields>
    <missions><mission type="harvest" status="RUNNING" farm="1" reward="4500" completion="40" field="7" fruit="WHEAT"/>
      <mission type="baleWrap" status="CREATED" reward="1200"/><mission type="" status="CREATED"/></missions></farmingHubLive>`);
  const g = live.game;
  assert.deepEqual(g.farms[0], { id: 1, money: 123456, loan: 50000, finances: [{ day: 0, v: { harvestIncome: 1200.5, purchaseFuel: -80 } }, { day: 1, v: { soldMilk: 300 } }] });
  assert.equal(g.environment.temp, 17.5);
  assert.deepEqual(g.environment.weather.map(w => w.type), ['SUN', 'RAIN']);
  assert.equal(g.fields[1].fruit, null);
  assert.equal(g.fields[0].weed, 2);
  assert.equal(g.missions.length, 2, 'ohne Typ zählt nicht');
  // Ältere Mod: nichts davon
  const old = L.read('<farmingHubLive version="1" mod="3.2.0.0" seq="1"><tasks count="0"/></farmingHubLive>').game;
  assert.deepEqual(old, { farms: null, environment: null, fields: null, missions: null });

  L.apply(live);
  assert.ok(L.gameData());
  const farms = hub.ftpFile('farms.xml');
  assert.ok(farms.live);
  assert.equal(farms.find(f => f.id === 1).money, 123456);
  assert.equal(farms.find(f => f.id === 1).finances[0].v.harvestIncome, 1200.5);
  const env = hub.ftpFile('environment.xml');
  assert.deepEqual([env.day, env.daysPerPeriod, env.temp, env.live], [40, 3, 17.5, true]);
  assert.equal(hub.currentDay(), 40, 'Spieltag aus dem Spiel');
  assert.deepEqual(hub.ftpFile('fields.xml').list.map(f => f.id), [7, 8]);
  const m = hub.model();
  assert.equal(m.moneyLive, true);
  assert.equal(m.money, 123456 + 999);
  assert.deepEqual(m.missions.map(x => [x.label, x.statusLabel, x.running]), [['Ernten', 'läuft', true], ['Ballen wickeln', 'angeboten', false]]);
  const w = m.weather;
  assert.ok(w && w.temp === 17.5 && w.live);
  // Nach 10 Minuten ohne Mod wieder der Autosave
  setSetting('fs_live_game', JSON.stringify({ ...L.gameData(), at: now() - 700 }));
  L.forgetGame();
  assert.equal(L.gameData(), null);
  hub.invalidate();
  assert.ok(!(hub.ftpFile('farms.xml') || {}).live);
  assert.equal(hub.model().missions, null);
  setSetting('fs_ftp_path', '');
});

test('Anbau planen: Wachstumsdauer, Erntemonat aus Saatmonat und umgekehrt', () => {
  const C = require('../src/fscrops');
  // Monate ab März = 0: Mais säen April/Mai, ernten Oktober/November
  const mais = { sow: [1, 2], harvest: [7, 8] };
  assert.equal(C.growMonths(mais.sow, mais.harvest), 6);
  assert.equal(C.harvestFor(mais, 2), 8);
  assert.equal(C.sowFor(mais, 7), 1);
  // Weizen über den Jahreswechsel: säen September/Oktober, ernten Juli/August
  const weizen = { sow: [6, 7], harvest: [4, 5] };
  assert.equal(C.growMonths(weizen.sow, weizen.harvest), 10);
  assert.equal(C.harvestFor(weizen, 7), 5);
  assert.equal(C.sowFor(weizen, 4), 6);
  assert.equal(C.growMonths([], [1]), null);
  // Formular: nur Saatmonat gewählt, Ernte kommt aus der Dauer
  const hub = require('../src/fshub');
  const { db, now } = require('../src/db');
  const c = hub.crops().find(x => x.sowM.length && x.harvestM.length && x.kind !== 'perm');
  const uid = Number(db.prepare("INSERT INTO users(username, password_hash, role, created_at) VALUES ('planer', 'x', 'user', ?)").run(now()).lastInsertRowid);
  const s = c.sowM[c.sowM.length - 1];
  const id = hub.addPlan({ id: uid }, 1, { crop_id: String(c.id), sow_month: String(s), harvest_month: '' });
  const p = db.prepare('SELECT * FROM fs_plans WHERE id = ?').get(id);
  assert.equal(p.sow_month, s);
  assert.equal(p.harvest_month, C.harvestFor(c, s));
});
