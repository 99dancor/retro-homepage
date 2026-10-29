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

test('Dichtekarten: GDM und GRLE lesen, zwei Felder als echte Form, Boden-Ebene als PNG', () => {
  const M = require('../src/fsmap');
  // 256 Pixel für eine Karte von 128 m: zwei Rechtecke mit Lücke
  const inA = (x, y) => x >= 20 && x < 100 && y >= 20 && y < 100, inB = (x, y) => x >= 140 && x < 240 && y >= 40 && y < 120;
  const g = M.readGdm(gdm(256, (x, y) => inA(x, y) || inB(x, y)));
  assert.equal(g.size, 256);
  assert.equal(g.data[30 * 256 + 30], 5);
  assert.equal(g.data[10 * 256 + 10], 0);
  assert.throws(() => M.readGdm(Buffer.from('kaputt, keine Datei')), /Keine GDM/);

  const fields = [{ id: 1, x: -34, z: -34, area: 0.16 }, { id: 2, x: 31, z: -24, area: 0.2 }, { id: 3, x: 50, z: 50, area: 1 }];
  const r = M.buildShapes(gdm(256, (x, y) => inA(x, y) || inB(x, y)), fields, 128);
  assert.ok(r.shapes[1] && r.shapes[2], 'beide Rechtecke gefunden');
  assert.ok(!r.shapes[3], 'ohne Feldboden bleibt das Feld ein Kreis');
  assert.match(r.shapes[1].d, /^M[\d.]+ [\d.]+/);
  assert.ok(Math.abs(r.shapes[1].ha - 0.16) < 0.03, 'Fläche A ' + r.shapes[1].ha);
  assert.ok(Math.abs(r.shapes[2].ha - 0.2) < 0.03, 'Fläche B ' + r.shapes[2].ha);
  assert.ok(Math.abs(r.shapes[1].cx - 234) < 10 && Math.abs(r.shapes[1].cy - 234) < 10, `Mitte A ${r.shapes[1].cx},${r.shapes[1].cy}`);

  const lime = M.readGrle(grle(256, 256, (x, y) => (x < 128 ? 0 : 3)));
  assert.equal(lime.w, 256);
  assert.equal(lime.data[5], 0);
  assert.equal(lime.data[200], 3);
  const pngBuf = M.layerPng('kalk', grle(256, 256, (x, y) => (x < 128 ? 0 : 3)), r.lab, r.size);
  assert.equal(pngBuf.subarray(0, 4).toString('hex'), '89504e47');
  assert.equal(pngBuf.readUInt32BE(16), r.size, 'Ebene so groß wie die Feldmaske');
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

// ---------- Feldumrisse aus der Karte (src/fsfields.js) ----------
const I3D = `<?xml version="1.0" encoding="iso-8859-1"?>
<i3D name="map"><Files><File fileId="1" filename="x.png"/></Files>
<Scene>
  <TransformGroup name="gameplay" translation="100 0 0" nodeId="1">
    <TransformGroup name="fields" translation="0 5 -50" nodeId="2">
      <!-- Feld 1: liegt gerade -->
      <TransformGroup name="field1" translation="10 0 10" nodeId="3">
        <TransformGroup name="polygonPoints" nodeId="4">
          <TransformGroup name="point1" translation="0 0 0" nodeId="5"/>
          <TransformGroup name="point2" translation="40 0 0" nodeId="6"/>
          <TransformGroup name="point3" translation="40 0 40" nodeId="7"/>
          <TransformGroup name="point4" translation="0 0 40" nodeId="8"/>
        </TransformGroup>
        <TransformGroup name="nameIndicator" translation="20 0 20" nodeId="9"><Note name="Note" text="1" nodeId="10"/></TransformGroup>
        <TransformGroup name="teleportIndicator" nodeId="11"/>
      </TransformGroup>
      <!-- Feld 2: um 90 Grad gedreht -->
      <TransformGroup name="field2" translation="-200 0 100" rotation="0 90 0" nodeId="12">
        <TransformGroup name="polygonPoints" nodeId="13">
          <TransformGroup name="point1" translation="0 0 0" nodeId="14"/>
          <TransformGroup name="point2" translation="10 0 0" nodeId="15"/>
          <TransformGroup name="point3" translation="10 0 20" nodeId="16"/>
        </TransformGroup>
      </TransformGroup>
    </TransformGroup>
  </TransformGroup>
  <Shape name="baum" translation="1 2 3" nodeId="20"/>
</Scene>
<UserAttributes><UserAttribute nodeId="2"><Attribute name="onCreate" type="scriptCallback" value="x"/></UserAttribute></UserAttributes>
</i3D>`;

test('Feldumrisse: map.i3d mit verschachtelten und gedrehten Knoten, aus einem ZIP gelesen, Feldern zugeordnet', () => {
  const FF = require('../src/fsfields');
  const polys = FF.i3dFields(I3D);
  assert.equal(polys.length, 2);
  assert.equal(polys[0].name, 'field1');
  assert.deepEqual(polys[0].pts, [[110, -40], [150, -40], [150, 0], [110, 0]]);
  // Drehung um Y: x → (cos·x, −sin·x), z → (sin·z, cos·z)
  assert.deepEqual(polys[1].pts.map(p => p.map(v => Math.round(v))), [[-100, 50], [-100, 40], [-80, 40]]);
  assert.throws(() => FF.i3dFields('<i3D/>'), /Keine i3d/);

  // ZIP wie im mods-Ordner: Inhaltsverzeichnis am Ende, dann nur der eine Eintrag
  const AdmZip = require('adm-zip');
  const z = new AdmZip();
  z.addFile('modDesc.xml', Buffer.from('<modDesc/>'));
  z.addFile('placeables/shed/shed.i3d', Buffer.from('<i3D><Scene/></i3D>'));
  z.addFile('maps/map.i3d', Buffer.from(I3D + ' '.repeat(5000)));
  const zip = z.toBuffer();
  const tailStart = Math.max(0, zip.length - 200);
  const dirAt = FF.zipDirectory(zip.subarray(tailStart), tailStart);
  const entries = FF.zipEntries(zip.subarray(dirAt.offset, dirAt.offset + dirAt.size));
  assert.deepEqual(entries.map(e => e.name).sort(), ['maps/map.i3d', 'modDesc.xml', 'placeables/shed/shed.i3d']);
  const best = FF.mapCandidates(entries)[0];
  assert.equal(best.name, 'maps/map.i3d');
  const data = FF.zipData(zip.subarray(best.offset), best).toString('utf8');
  assert.equal(FF.i3dFields(data).length, 2);

  // Mitte im Vieleck → genau dieses, sonst das nächste in 40 m; Karte 2048 m → Maß 0–1000
  const shapes = FF.matchFields(polys, [{ id: 7, x: 130, z: -20 }, { id: 8, x: -95, z: 60 }, { id: 9, x: 900, z: 900 }], 2048);
  assert.ok(shapes[7].exact);
  assert.equal(shapes[7].ha, 0.16);
  assert.match(shapes[7].d, /^M553\.7 480\.5L/);
  assert.ok(shapes[8], 'nahe genug am gedrehten Feld');
  assert.ok(!shapes[9], 'weit weg: bleibt Kreis');
});

test('Feldumrisse ohne Feldboden: auch noch nicht bestellte Felder bekommen ihre Form', () => {
  const M = require('../src/fsmap');
  M.forget();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-shp-'));
  const polys = require('../src/fsfields').i3dFields(I3D);
  const r = M.load(dir, {}, [{ id: 1, x: 130, z: -20, area: 0.2 }, { id: 2, x: 0, z: 0, area: 1 }], 2048, { sig: 'a', polys });
  assert.equal(r.exact, 1);
  assert.ok(r.shapes[1] && !r.shapes[2]);
  assert.equal(M.load(dir, {}, [{ id: 1, x: 130, z: -20 }], 2048, null), null, 'ohne Boden und Umrisse nichts');
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
