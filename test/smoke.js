'use strict';
// Rauchtest: startet den Server mit leerem Datenordner und klickt die wichtigsten Wege durch.
// Aufruf: npm test
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'homepage-test-'));
const PASSWORD = 'smoke-test-pw';
const UA = 'Mozilla/5.0 (Smoke Test) Firefox/130';

function startServer() {
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(__dirname, '..', 'src', 'server.js')], {
    // YouTube ist im Test nicht erreichbar: Titel fallen auf „YouTube-Video <id>“ zurück
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, ADMIN_USER: 'admin', ADMIN_PASSWORD: PASSWORD, PUID: '0', YOUTUBE_OEMBED_URL: 'http://127.0.0.1:9/oembed' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', d => { log += d; });
  child.stderr.on('data', d => { log += d; });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server startet nicht:\n' + log)), 10000);
    const check = setInterval(() => {
      if (log.includes('Website läuft')) { clearInterval(check); clearTimeout(timer); resolve({ child, getLog: () => log }); }
    }, 50);
    child.on('exit', code => { clearInterval(check); clearTimeout(timer); reject(new Error(`Server beendet (${code}):\n${log}`)); });
  });
}

// Minimaler Browser: merkt sich Cookies
function browser() {
  const jar = new Map();
  async function req(url, opts = {}) {
    // Standard: wie ein Fenster auf dem Desktop (iframe); top: true lädt die Seite direkt wie ein Browser-Tab
    const headers = { 'user-agent': UA, ...(opts.top ? {} : { 'sec-fetch-dest': 'iframe' }), ...(opts.headers || {}) };
    if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(BASE + url, { ...opts, headers, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    res.text_ = await res.text();
    return res;
  }
  async function csrf(url = '/login') {
    const res = await req(url);
    const m = res.text_.match(/name="_csrf" value="([a-f0-9]+)"/);
    assert.ok(m, 'CSRF-Token auf ' + url);
    return m[1];
  }
  const form = (url, data) => req(url, { method: 'POST', body: new URLSearchParams(data), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  return { req, csrf, form, jar };
}

async function main() {
  const server = await startServer();
  let failed = false;
  const step = async (name, fn) => {
    try { await fn(); console.log('✔', name); }
    catch (e) { failed = true; console.error('✘', name, '\n ', e.message); }
  };
  try {
    const guest = browser();
    const admin = browser();

    await step('Öffentliche Seiten laden', async () => {
      for (const p of ['/', '/blog', '/files', '/mods', '/links', '/guestbook', '/contact', '/apps', '/forum', '/changelog', '/datenschutz', '/login', '/theme.css', '/static/retro.css', '/static/editor.js', '/musik', '/musik/bibliothek', '/static/sound.js', '/static/music.js', '/static/visualizer.js', '/paint', '/galerie', '/static/paint-core.js']) {
        const r = await guest.req(p);
        assert.equal(r.status, 200, p);
      }
      assert.equal((await guest.req('/gibtsnicht')).status, 404);
    });

    await step('Zufallsgenerator im Startmenü und als Fenster', async () => {
      const desk = await guest.req('/', { top: true });
      assert.match(desk.text_, /<div class="startmenu"[\s\S]*href="\/zufall"[\s\S]*Zufallsgenerator/);
      const r = await guest.req('/zufall');
      assert.equal(r.status, 200);
      for (const tab of ['teams', 'zahl', 'wort']) assert.match(r.text_, new RegExp(`data-tab="${tab}"`));
      const js = r.text_.match(/src="(\/static\/zufall\.js\?v=\w+)"/);
      assert.ok(js, 'zufall.js mit Versionsnummer eingebunden');
      assert.equal((await guest.req(js[1])).status, 200);
      assert.match((await guest.req('/static/sound.js')).text_, /wuerfel:[\s\S]*tusch:/);
    });

    await step('Direkt aufgerufen kommt der Desktop mit der Seite als Fenster', async () => {
      const r = await guest.req('/forum', { top: true });
      assert.equal(r.status, 200);
      assert.match(r.text_, /class="desktop"/);
      assert.match(r.text_, /<iframe src="\/forum"/);
      assert.match(r.headers.get('vary') || '', /Sec-Fetch-Dest/i);
      const inner = await guest.req('/forum');
      assert.match(inner.text_, /class="embed"/);
      assert.doesNotMatch(inner.text_, /id="startmenu"/);
      assert.equal((await guest.req('/gibtsnicht', { top: true })).status, 404);
      assert.match((await guest.req('/forum?embed', { top: true })).text_, /class="embed"/);
      // Nach Updates darf kein alter Stand aus dem Browser-Cache kommen: Dateien tragen eine Versionsnummer
      const css = r.text_.match(/href="(\/static\/retro\.css\?v=[a-f0-9]+)"/);
      assert.ok(css, 'retro.css mit Versionsnummer');
      assert.match(r.text_, /src="\/static\/retro\.js\?v=[a-f0-9]+"/);
      assert.match((await guest.req(css[1])).headers.get('cache-control'), /immutable/);
    });

    await step('Admin-Bereich ist ohne Login gesperrt', async () => {
      const r = await guest.req('/admin');
      assert.equal(r.status, 302);
      assert.match(r.headers.get('location'), /^\/login/);
    });

    await step('Formulare ohne CSRF-Token werden abgelehnt', async () => {
      const r = await guest.form('/guestbook', { message: 'spam' });
      assert.equal(r.status, 403);
    });

    await step('Admin kann sich anmelden', async () => {
      const t = await admin.csrf();
      const bad = await admin.form('/login', { _csrf: t, username: 'admin', password: 'falsch' });
      assert.equal(bad.status, 401);
      const r = await admin.form('/login', { _csrf: t, username: 'admin', password: PASSWORD });
      assert.equal(r.status, 302);
      assert.equal(r.headers.get('location'), '/admin');
      for (const p of ['/admin', '/admin/posts', '/admin/posts/new', '/admin/media', '/admin/files', '/admin/mods',
        '/admin/links', '/admin/guestbook', '/admin/messages', '/admin/users', '/admin/pages', '/admin/pages/new', '/admin/apps',
        '/admin/apps/new', '/admin/design', '/admin/settings', '/admin/musik']) {
        assert.equal((await admin.req(p)).status, 200, p);
      }
    });

    await step('Blog-Beitrag anlegen, HTML wird bereinigt', async () => {
      const t = await admin.csrf('/admin/posts/new');
      const r = await admin.form('/admin/posts/save', { _csrf: t, title: 'Hallo Welt', body_md: '**fett** <script>alert(1)</script>', published: '1', visibility: 'public' });
      assert.equal(r.status, 302);
      const page = await guest.req('/blog/hallo-welt');
      assert.equal(page.status, 200);
      assert.match(page.text_, /<strong>fett<\/strong>/);
      assert.doesNotMatch(page.text_, /<script>alert/);
    });

    await step('Datei hochladen und Sichtbarkeit beachten', async () => {
      const t = await admin.csrf('/admin/files');
      const fd = new FormData();
      fd.append('_csrf', t);
      fd.append('category', 'Spielstände');
      fd.append('visibility', 'private');
      fd.append('files', new Blob(['spielstand']), 'Speicherstand äöü.sav');
      const r = await admin.req('/admin/files/upload', { method: 'POST', body: fd });
      assert.equal(r.status, 302);
      const dl = await admin.req('/files/dl/1');
      assert.equal(dl.status, 200);
      assert.equal(dl.text_, 'spielstand');
      assert.match(dl.headers.get('content-disposition'), /Speicherstand%20%C3%A4%C3%B6%C3%BC\.sav/);
      assert.equal((await guest.req('/files/dl/1')).status, 404, 'Gast darf private Datei nicht laden');
      assert.doesNotMatch((await guest.req('/files')).text_, /Speicherstand/);
    });

    await step('Besucherbuch-Eintrag als Gast', async () => {
      const t = await guest.csrf('/guestbook');
      const r = await guest.form('/guestbook', { _csrf: t, name: 'Tester', message: 'Grüße <b>!</b>' });
      assert.equal(r.status, 302);
      const page = await guest.req('/guestbook');
      assert.match(page.text_, /Grüße &lt;b&gt;!&lt;\/b&gt;/);
    });

    await step('Kontaktformular landet im Postfach', async () => {
      const t = await guest.csrf('/contact');
      assert.equal((await guest.form('/contact', { _csrf: t, name: 'Tester', subject: 'Frage', body: 'Hallo!' })).status, 302);
      assert.match((await admin.req('/admin/messages')).text_, /Frage/);
    });

    await step('Spielstände im Konto speichern und laden', async () => {
      const AdmZip = require('adm-zip');
      const zip = new AdmZip();
      zip.addFile('spiel/index.html', Buffer.from('<!doctype html><title>Spiel</title>'));
      zip.addFile('spiel/index.wasm', Buffer.alloc(200000, 'pax machina '));
      const t = await admin.csrf('/admin/apps/new');
      const fd = new FormData();
      fd.append('_csrf', t);
      fd.append('title', 'Testspiel');
      fd.append('visibility', 'public');
      fd.append('zip', new Blob([zip.toBuffer()]), 'spiel.zip');
      assert.equal((await admin.req('/admin/apps/save', { method: 'POST', body: fd })).status, 302);
      const json = (b, data) => b.req('/api/saves/testspiel/slot_1', { method: 'PUT', body: JSON.stringify({ data }), headers: { 'content-type': 'application/json' } });

      assert.equal((await guest.req('/api/saves/testspiel')).status, 401, 'Gast ohne Login');
      assert.equal((await json(guest, 'x')).status, 401, 'Gast darf nicht speichern');
      assert.equal((await admin.req('/api/saves/gibtsnicht')).status, 404);
      assert.equal((await admin.req('/api/saves/testspiel/slot_1')).status, 404, 'leerer Platz');
      const plain = await admin.req('/api/saves/testspiel/slot_1', { method: 'PUT', body: '{"data":"x"}', headers: { 'content-type': 'text/plain' } });
      assert.equal(plain.status, 415, 'nur JSON');
      assert.equal((await admin.req('/api/saves/testspiel/..%2Fx', { method: 'PUT', body: '{"data":"x"}', headers: { 'content-type': 'application/json' } })).status, 400);

      const save = JSON.stringify({ version: 10, money: 9.79, name: 'Größe äöü' });
      assert.equal((await json(admin, save)).status, 200);
      const got = await admin.req('/api/saves/testspiel/slot_1');
      assert.equal(got.status, 200);
      assert.equal(JSON.parse(got.text_).data, save);
      const list = JSON.parse((await admin.req('/api/saves/testspiel')).text_);
      assert.equal(list.user, 'admin');
      assert.deepEqual(list.slots.map(x => x.slot), ['slot_1']);

      const acc = await admin.req('/konto');
      assert.match(acc.text_, /Testspiel/);
      const t2 = acc.text_.match(/name="_csrf" value="([a-f0-9]+)"/)[1];
      assert.match((await admin.form('/konto/spielstand/loeschen', { _csrf: t2, app: 'testspiel', slot: 'slot_1' })).headers.get('location'), /reiter=spielstaende&ok=spielstand/);
      assert.equal((await admin.req('/api/saves/testspiel/slot_1')).status, 404, 'gelöscht');
    });

    await step('Pixelpfoten läuft unter /haustier/ und speichert im Konto', async () => {
      const slash = await guest.req('/haustier', { top: true });
      assert.equal(slash.status, 301);
      assert.equal(slash.headers.get('location'), '/haustier/');
      const desk = await guest.req('/haustier/', { top: true });
      assert.match(desk.text_, /class="desktop"/);
      assert.match(desk.text_, /<iframe src="\/haustier\/"/);
      assert.match(desk.text_, /<div class="startmenu"[\s\S]*href="\/haustier\/"/);
      const game = await guest.req('/haustier/');
      assert.equal(game.status, 200);
      assert.match(game.text_, /<body class="embed" data-user="" data-login="\/login\?next=\/haustier\/"/);
      assert.match(game.text_, /data-forum="\/forum\/new"/);
      assert.match(game.headers.get('cache-control'), /no-cache/);
      for (const [file, type] of [['js/main.js', /javascript/], ['js/pets.js', /javascript/], ['js/scene.js', /javascript/], ['js/trip.js', /javascript/], ['js/run.js', /javascript/], ['css/game.css', /css/], ['changelog.md', /markdown/]]) {
        const r = await guest.req('/haustier/' + file);
        assert.equal(r.status, 200, file);
        assert.match(r.headers.get('content-type'), type, file);
      }
      assert.equal((await guest.req('/haustier/package.json')).status, 404);

      assert.equal((await guest.req('/api/saves/haustier/main')).status, 401, 'Gast speichert nur im Browser');
      assert.equal((await admin.req('/api/saves/haustier/main')).status, 404, 'noch leer');
      const data = JSON.stringify({ version: 1, coins: 42, pets: [{ name: 'Mimi' }] });
      const put = await admin.req('/api/saves/haustier/main', { method: 'PUT', body: JSON.stringify({ data }), headers: { 'content-type': 'application/json' } });
      assert.equal(put.status, 200);
      assert.equal(JSON.parse((await admin.req('/api/saves/haustier/main')).text_).data, data);
      assert.match((await admin.req('/konto')).text_, /<a href="\/haustier\/">Pixelpfoten<\/a>/);

      // Eine App namens „Haustier“ bekäme sonst dieselben Spielstände
      const t = await admin.csrf('/admin/apps/new');
      const fd = new FormData();
      fd.append('_csrf', t);
      fd.append('title', 'Haustier');
      fd.append('visibility', 'public');
      fd.append('external_url', 'https://example.org/spiel');
      assert.equal((await admin.req('/admin/apps/save', { method: 'POST', body: fd })).status, 302);
      assert.match((await guest.req('/apps')).text_, /href="\/apps\/haustier-2"/);
    });

    await step('Große Spieldateien werden komprimiert ausgeliefert', async () => {
      let r;
      for (let i = 0; i < 50; i++) {
        r = await guest.req('/apps/testspiel/play/index.wasm', { headers: { 'accept-encoding': 'br, gzip' } });
        // .gz ist oft vor .br fertig: auf beide Fassungen warten
        if (r.headers.get('content-encoding') === 'br') break;
        await new Promise(ok => setTimeout(ok, 100));
      }
      assert.equal(r.status, 200);
      assert.equal(r.headers.get('content-encoding'), 'br');
      assert.equal(r.headers.get('content-type'), 'application/wasm');
      assert.equal(r.text_.length, 200000);
      const gz = await guest.req('/apps/testspiel/play/index.wasm', { headers: { 'accept-encoding': 'gzip' } });
      assert.equal(gz.headers.get('content-encoding'), 'gzip');
      const raw = await guest.req('/apps/testspiel/play/index.wasm', { headers: { 'accept-encoding': 'identity' } });
      assert.equal(raw.headers.get('content-encoding'), null);
      assert.equal(raw.text_.length, 200000);
    });

    await step('Große Datei aus dem Eingangsordner übernehmen', async () => {
      const inbox = path.join(DATA, 'uploads', 'eingang');
      const big = path.join(inbox, 'Riesen Mod.zip');
      fs.writeFileSync(big, Buffer.alloc(300000, 7));
      const old = new Date(Date.now() - 60000);
      fs.utimesSync(big, old, old);
      fs.writeFileSync(path.join(inbox, 'noch-im-kopieren.bin'), 'x');
      const page = await admin.req('/admin/files');
      assert.match(page.text_, /Riesen Mod\.zip/);
      assert.match(page.text_, /wird noch kopiert/);
      const t = await admin.csrf('/admin/files');
      const r = await admin.form('/admin/files/import', { _csrf: t, names: 'Riesen Mod.zip', category: 'Mods', visibility: 'public' });
      assert.equal(r.status, 302);
      assert.match(decodeURIComponent(r.headers.get('location')), /1 Datei\(en\) übernommen/);
      assert.ok(!fs.existsSync(big), 'Datei wurde aus dem Eingang verschoben');
      const bad = await admin.form('/admin/files/import', { _csrf: t, names: '../site.db', visibility: 'public' });
      assert.match(decodeURIComponent(bad.headers.get('location')), /0 Datei\(en\)/);
      assert.ok(fs.existsSync(path.join(DATA, 'site.db')));
    });

    await step('Download-Statistik zählt Downloads, Abbrüche und Fortsetzungen', async () => {
      const list = await guest.req('/files');
      const id = list.text_.match(/\/files\/dl\/(\d+)"><b>Riesen Mod\.zip/)[1];
      const full = await guest.req('/files/dl/' + id);
      assert.equal(full.status, 200);
      assert.equal(full.text_.length, 300000);
      const part = await guest.req('/files/dl/' + id, { headers: { range: 'bytes=200000-' } });
      assert.equal(part.status, 206);
      assert.equal(part.text_.length, 100000);
      await new Promise(r => setTimeout(r, 200));
      const st = await admin.req('/admin/downloads?days=7');
      assert.equal(st.status, 200);
      assert.match(st.text_, /Downloads<b>[1-9]/);
      const file = await admin.req('/admin/downloads/' + id);
      assert.equal(file.status, 200);
      assert.match(file.text_, /Fortsetzung/);
      assert.match(file.text_, /Downloads<b>1</, 'Fortsetzung zählt nicht als neuer Download');
      assert.match(file.text_, /Übertragene Daten<b>39\d,\d KB|Übertragene Daten<b>39\d KB/);
      assert.match((await admin.req('/admin/files')).text_, /frei von/);
      const hour = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: process.env.TZ || 'Europe/Berlin' }).format(new Date());
      assert.match(file.text_, new RegExp('<title>' + String(hour).padStart(2, '0') + '–\\d\\d Uhr: [1-9]\\d* Downloads'), 'Uhrzeit-Diagramm hat Werte');
    });

    await step('Bilder im Text: Lage und Größe, Vorschau mit Blöcken', async () => {
      const t = await admin.csrf('/admin/pages/new');
      const body = 'Absatz eins\n\n![Katze](/media/0123456789abcdef0123456789abcdef.png "rechts 40%")\n\n<div class="mitte">\n\nMitte\n\n</div>\n\n<img src="x" style="position:fixed" class="bild-links boese" onerror="alert(1)">';
      assert.equal((await admin.form('/admin/pages/save', { _csrf: t, title: 'Bildtest', body_md: body, visibility: 'public' })).status, 302);
      const page = (await guest.req('/p/bildtest')).text_;
      assert.match(page, /<img src="\/media\/0123456789abcdef0123456789abcdef\.png" alt="Katze" loading="lazy" class="bild-rechts" style="width:40%"/);
      assert.match(page, /<div class="mitte"><p>Mitte<\/p>/);
      assert.doesNotMatch(page, /position:fixed|onerror|boese/);
      const pv = await admin.form('/admin/preview', { _csrf: t, md: body });
      assert.match(pv.text_, /<div class="md-block" data-from="0" data-to="11"><p>Absatz eins/);
      assert.match(pv.text_, /data-from="13" data-to="79"><p><img/);
      assert.equal((await guest.form('/forum/preview', { _csrf: t, md: 'x' })).status, 403, 'Gast ohne gültiges Token');
    });

    await step('Forum: Mitglieder schreiben, Fremde dürfen nicht bearbeiten', async () => {
      const t = await admin.csrf('/admin/users');
      for (const name of ['anna', 'bernd']) assert.equal((await admin.form('/admin/users/create', { _csrf: t, username: name, password: 'passwort123' })).status, 302);
      const anna = browser(), bernd = browser();
      for (const [b, name] of [[anna, 'anna'], [bernd, 'bernd']]) {
        const tk = await b.csrf();
        assert.equal((await b.form('/login', { _csrf: tk, username: name, password: 'passwort123' })).status, 302);
      }
      assert.equal((await guest.req('/forum')).status, 200);
      assert.equal((await guest.req('/forum/new')).status, 302, 'Gast muss sich anmelden');

      let tk = await anna.csrf('/forum/new');
      const r = await anna.form('/forum/new', { _csrf: tk, title: 'Hallo Forum', body_md: 'Erster **Beitrag** <script>x</script>' });
      assert.equal(r.status, 302);
      const topic = r.headers.get('location');
      assert.match(topic, /^\/forum\/t\/\d+$/);
      const view = (await guest.req(topic)).text_;
      assert.match(view, /Erster <strong>Beitrag<\/strong>/);
      assert.doesNotMatch(view, /<script>x/);
      assert.match((await guest.req('/forum')).text_, /Hallo Forum/);

      tk = await bernd.csrf(topic);
      assert.equal((await bernd.form(topic + '/reply', { _csrf: tk, body_md: 'Antwort von Bernd' })).status, 302);
      const page = (await bernd.req(topic)).text_;
      assert.match(page, /Antwort von Bernd/);
      const ids = [...page.matchAll(/id="b(\d+)"/g)].map(m => m[1]);
      assert.equal(ids.length, 2);
      assert.equal((await bernd.req(`/forum/p/${ids[0]}/edit`)).status, 404, 'Bernd darf Annas Beitrag nicht bearbeiten');
      assert.equal((await bernd.form(`/forum/p/${ids[0]}/delete`, { _csrf: tk })).status, 404);
      assert.equal((await bernd.form(topic + '/lock', { _csrf: tk })).status, 403, 'nur Admin sperrt');

      // Antworten abonniert das Thema, Abo lässt sich beenden; Suche, Sortierung und Zitieren
      assert.match(page, /Abo beenden/);
      assert.match(page, /data-quote="Erster \*\*Beitrag\*\*/);
      assert.match((await bernd.req('/forum?abos=1')).text_, /Hallo Forum/);
      assert.equal((await bernd.form(topic + '/sub', { _csrf: tk, on: '0' })).status, 302);
      assert.match((await bernd.req('/forum?abos=1')).text_, /noch keine Themen abonniert/);
      assert.match((await guest.req('/forum?q=Antwort+Bernd')).text_, /Hallo Forum/, 'Suche findet Text in Antworten');
      assert.match((await guest.req('/forum?q=gibtsnicht')).text_, /Nichts gefunden/);
      assert.match((await guest.req('/forum?q=100%25_')).text_, /Nichts gefunden/, 'Platzhalter werden nicht ausgewertet');
      assert.match((await guest.req('/forum?sort=views&dir=asc')).text_, /Aufrufe ▲/);

      tk = await anna.csrf(topic);
      const del = await anna.form(`/forum/p/${ids[0]}/delete`, { _csrf: tk });
      assert.match(decodeURIComponent(del.headers.get('location')), /schon geantwortet/, 'Thema mit Antworten bleibt');
      assert.equal((await anna.form(`/forum/p/${ids[0]}/edit`, { _csrf: tk, title: 'Hallo Forum!', body_md: 'Geändert' })).status, 302);
      const edited = (await guest.req(topic)).text_;
      for (const re of [/<h1>Hallo Forum!<\/h1>/, /<p>Geändert<\/p>/, / · bearbeitet/]) assert.match(edited, re);

      const at = await admin.csrf(topic);
      assert.equal((await admin.form(topic + '/lock', { _csrf: at })).status, 302);
      const bt = await bernd.csrf(topic);
      assert.match((await bernd.form(topic + '/reply', { _csrf: bt, body_md: 'zu spät' })).headers.get('location'), /err=/);
      assert.doesNotMatch((await guest.req(topic)).text_, /zu spät/);
      const fd = new FormData();
      fd.append('_csrf', tk);
      fd.append('images', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')], { type: 'image/png' }), 'punkt.png');
      const img = await anna.req('/forum/media', { method: 'POST', body: fd, headers: { accept: 'application/json' } });
      assert.equal(img.status, 200);
      assert.match(JSON.parse(img.text_)[0].url, /^\/media\/[a-f0-9]{32}\.png$/);
      assert.equal((await admin.form(topic + '/delete', { _csrf: at })).status, 302);
      assert.equal((await guest.req(topic)).status, 404);
    });

    // Angemeldete Mitglieder für spätere Schritte (das Anmelden ist pro IP begrenzt)
    const members = {};
    await step('Forum: anonym schreiben, nur Verfasser und Admin sehen den Namen', async () => {
      const anna = members.anna = browser(), bernd = members.bernd = browser();
      for (const [b, name] of [[anna, 'anna'], [bernd, 'bernd']]) {
        const tk = await b.csrf();
        assert.equal((await b.form('/login', { _csrf: tk, username: name, password: 'passwort123' })).status, 302);
      }
      const form = (await anna.req('/forum/new')).text_;
      assert.match(form, /name="anonymous"/);
      let tk = await anna.csrf('/forum/new');
      const r = await anna.form('/forum/new', { _csrf: tk, title: 'Mir geht es nicht gut', body_md: 'Heute war schwer.', anonymous: '1' });
      const topic = r.headers.get('location');
      const ANNA = /\banna\b/;
      for (const b of [guest, bernd]) {
        const page = (await b.req(topic)).text_;
        assert.match(page, /👻 Anonym</);
        assert.doesNotMatch(page, ANNA);
        const list = (await b.req('/forum')).text_;
        assert.match(list, /von Anonym ·/);
        assert.doesNotMatch(list, ANNA);
      }
      assert.match((await admin.req(topic)).text_, /Anonym \(anna\)/, 'Admin sieht den Namen');
      const own = (await anna.req(topic)).text_;
      assert.match(own, /Anonym \(anna\)/, 'Verfasserin sieht sich selbst');
      assert.match(own, /name="anonymous" value="1" checked/, 'Antwort im eigenen anonymen Thema ist vorausgewählt');

      tk = await bernd.csrf(topic);
      assert.equal((await bernd.form(topic + '/reply', { _csrf: tk, body_md: 'Ich hör dir zu.' })).status, 302);
      assert.doesNotMatch((await bernd.req(topic)).text_, /name="anonymous" value="1" checked/);
      tk = await anna.csrf(topic);
      assert.equal((await anna.form(topic + '/reply', { _csrf: tk, body_md: 'Danke dir.', anonymous: '1' })).status, 302);
      const after = (await guest.req(topic)).text_;
      assert.match(after, /href="\/nutzer\/bernd" class="userlink">[\s\S]*?bernd<\/a>/, 'Name führt zum Profil');
      assert.doesNotMatch(after, ANNA);
      assert.equal((after.match(/👻 Anonym</g) || []).length, 2);
      assert.doesNotMatch((await guest.req('/forum')).text_, ANNA, 'auch nicht als letzter Beitrag');
    });

    await step('Entwürfe: speichern, laden, nur eigene, beim Abschicken weg', async () => {
      const { anna, bernd } = members;
      const json = (b, url, body, tk) => b.req(url, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', 'x-csrf-token': tk } });
      let tk = await anna.csrf('/forum/new');
      const form = (await anna.req('/forum/new')).text_;
      assert.match(form, /data-drafts="forum" data-draft-place="new"/);
      assert.match(form, /name="draft_id"/);
      assert.equal((await json(guest, '/api/entwuerfe', { kind: 'forum', title: 'x' }, tk)).status, 403, 'ohne eigenes Token');
      assert.equal((await json(anna, '/api/entwuerfe', { kind: 'forum', place: 'new' }, tk)).status, 400, 'leer wird nicht gespeichert');
      let r = await json(anna, '/api/entwuerfe', { kind: 'forum', place: 'new', title: 'Halb fertig', body_md: 'Erster Gedanke', fields: { anonymous: '1' } }, tk);
      assert.equal(r.status, 200);
      const { id } = JSON.parse(r.text_);
      r = await json(anna, '/api/entwuerfe', { id, kind: 'forum', place: 'new', title: 'Halb fertig', body_md: 'Erster Gedanke, weiter', fields: { anonymous: '1' } }, tk);
      assert.equal(JSON.parse(r.text_).id, id, 'gleicher Entwurf wird überschrieben');
      const list = JSON.parse((await anna.req('/api/entwuerfe?art=forum')).text_);
      assert.equal(list.length, 1);
      assert.equal(list[0].where, 'Neues Thema');
      assert.equal(list[0].url, '/forum/new?entwurf=' + id);
      const one = JSON.parse((await anna.req('/api/entwuerfe/' + id)).text_);
      assert.equal(one.body_md, 'Erster Gedanke, weiter');
      assert.equal(one.fields.anonymous, '1');
      assert.equal((await bernd.req('/api/entwuerfe/' + id)).status, 404, 'fremde Entwürfe bleiben unsichtbar');
      assert.equal(JSON.parse((await bernd.req('/api/entwuerfe?art=forum')).text_).length, 0);
      assert.equal((await anna.req('/api/entwuerfe?art=blog')).status, 403, 'Blogentwürfe nur für den Admin');
      assert.equal((await guest.req('/api/entwuerfe?art=forum')).status, 401);
      assert.match((await anna.req('/forum')).text_, /Entwürfe \(1\)/);
      assert.match((await anna.req('/forum/entwuerfe')).text_, /Halb fertig/);

      // Antwort-Entwurf zeigt das Thema, Abschicken mit draft_id löscht ihn
      const topic = (await anna.form('/forum/new', { _csrf: tk, title: 'Fertig', body_md: 'Jetzt fertig', anonymous: '1', draft_id: id })).headers.get('location');
      assert.equal(JSON.parse((await anna.req('/api/entwuerfe?art=forum')).text_).length, 0, 'Entwurf nach dem Abschicken weg');
      const tid = topic.split('/').pop();
      assert.match((await anna.req(topic)).text_, new RegExp(`data-draft-place="reply:${tid}"`));
      r = await json(anna, '/api/entwuerfe', { kind: 'forum', place: 'reply:' + tid, body_md: 'Antwort später' }, tk);
      const rid = JSON.parse(r.text_).id;
      const [d] = JSON.parse((await anna.req('/api/entwuerfe?art=forum')).text_);
      assert.equal(d.where, 'Antwort in „Fertig“');
      assert.equal(d.url, `/forum/t/${tid}?page=last&entwurf=${rid}#antworten`);
      assert.equal((await bernd.form(`/api/entwuerfe/${rid}/delete`, { _csrf: await bernd.csrf('/forum/new'), back: '/forum' })).status, 302);
      assert.equal(JSON.parse((await anna.req('/api/entwuerfe?art=forum')).text_).length, 1, 'Bernd kann Annas Entwurf nicht löschen');
      assert.equal((await anna.form(`/api/entwuerfe/${rid}/delete`, { _csrf: tk, back: '//example.org' })).status, 200, 'keine fremde Rücksprungadresse');
      assert.equal(JSON.parse((await anna.req('/api/entwuerfe?art=forum')).text_).length, 0);

      // Blog: Admin speichert einen Entwurf zu einem Beitrag, Speichern des Beitrags räumt ihn weg
      const at = await admin.csrf('/admin/posts/new');
      assert.match((await admin.req('/admin/posts/new')).text_, /data-drafts="blog" data-draft-place="new"/);
      r = await json(admin, '/api/entwuerfe', { kind: 'blog', place: 'new', title: 'Blog-Idee', body_md: 'Noch roh', fields: { summary: 'kurz', tags: 'a, b' } }, at);
      const bid = JSON.parse(r.text_).id;
      assert.match((await admin.req('/admin/posts')).text_, /Blog-Idee[\s\S]*Neuer Blogbeitrag/);
      assert.equal((await admin.form('/admin/posts/save', { _csrf: at, title: 'Blog-Idee', body_md: 'Fertig', visibility: 'public', draft_id: bid })).status, 302);
      assert.equal(JSON.parse((await admin.req('/api/entwuerfe?art=blog')).text_).length, 0);
    });

    await step('Nach der Anmeldung geht es nur zu Seiten dieser Homepage', async () => {
      for (const [next, to] of [['/haustier/', '/haustier/'], ['//example.org', '/'], ['/\\example.org', '/']]) {
        const b = browser();
        const tk = await b.csrf();
        const r = await b.form('/login', { _csrf: tk, username: 'bernd', password: 'passwort123', next });
        assert.equal(r.headers.get('location'), to, next);
      }
    });

    // Kleine MP3 mit ID3v2.3-Angaben (Titel, Interpret); der Inhalt danach ist egal
    const mp3 = (title, artist) => {
      const frame = (id, text) => { const body = Buffer.concat([Buffer.from([3]), Buffer.from(text, 'utf8')]); const h = Buffer.alloc(10); h.write(id, 0, 'latin1'); h.writeUInt32BE(body.length, 4); return Buffer.concat([h, body]); };
      const frames = Buffer.concat([frame('TIT2', title), frame('TPE1', artist)]);
      const size = frames.length, head = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, (size >> 21) & 127, (size >> 14) & 127, (size >> 7) & 127, size & 127]);
      return Buffer.concat([head, frames, Buffer.alloc(4000, 0xff)]);
    };
    const api = async (b, url, body, method = 'POST') => {
      const tk = b.jar.get('csrf');
      const r = await b.req(url, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json', 'x-csrf-token': tk || '' } });
      return { status: r.status, json: r.text_ ? JSON.parse(r.text_) : null };
    };
    const lib = async b => JSON.parse((await b.req('/musik/bibliothek')).text_);

    await step('Musik: Admin lädt hoch, Angaben kommen aus der Datei, Sichtbarkeit gilt', async () => {
      const t = await admin.csrf('/admin/musik');
      const fd = new FormData();
      fd.append('_csrf', t);
      fd.append('visibility', 'public');
      fd.append('files', new Blob([mp3('Sommerlied', 'Die Ärzte-Probe')]), 'egal.mp3');
      fd.append('files', new Blob([mp3('Geheimtitel', 'Niemand')]), '02 - geheim.mp3');
      assert.equal((await admin.req('/admin/musik/upload', { method: 'POST', body: fd })).status, 302);
      const fd2 = new FormData();
      fd2.append('_csrf', t);
      fd2.append('files', new Blob(['kein audio']), 'notiz.txt');
      assert.equal((await admin.req('/admin/musik/upload', { method: 'POST', body: fd2 })).status, 302);
      const all = (await lib(admin)).tracks;
      assert.deepEqual(all.map(x => x.title).sort(), ['Geheimtitel', 'Sommerlied'], 'Textdatei wurde nicht übernommen');
      const song = all.find(x => x.title === 'Sommerlied'), secret = all.find(x => x.title === 'Geheimtitel');
      assert.equal(song.artist, 'Die Ärzte-Probe');
      assert.ok(song.byAdmin);
      const at = await admin.csrf('/admin/musik/' + secret.id);
      assert.equal((await admin.form('/admin/musik/' + secret.id, { _csrf: at, title: 'Geheimtitel', visibility: 'private' })).status, 302);
      assert.deepEqual((await lib(guest)).tracks.map(x => x.title), ['Sommerlied']);
      const range = await guest.req('/musik/stream/' + song.id, { headers: { range: 'bytes=0-99' } });
      assert.equal(range.status, 206, 'Spulen braucht Range-Anfragen');
      assert.match(range.headers.get('content-type'), /audio\/mpeg/);
      assert.equal((await guest.req('/musik/stream/' + secret.id)).status, 404, 'privater Titel');
      const page = await guest.req('/musik');
      assert.match(page.headers.get('content-security-policy'), /frame-src 'self' https:\/\/www\.youtube-nocookie\.com/);
      assert.match(page.headers.get('content-security-policy'), /media-src 'self' blob:/);
      assert.doesNotMatch((await guest.req('/blog')).headers.get('content-security-policy'), /youtube/, 'nur der Player darf YouTube einbetten');
      assert.match(page.text_, /<script src="\/static\/visualizer\.js\?v=\w+"><\/script>/);
      assert.match(page.text_, /<video id="mp-media" playsinline/, 'Musik und Videos laufen über ein Element');
      assert.match(page.text_, /data-act="mini"[\s\S]*data-act="mini-off"/);
      const desk = (await guest.req('/', { top: true })).text_;
      assert.match(desk, /<div class="startmenu"[\s\S]*href="\/musik"/);
      assert.match(desk, /id="displaybtn"[\s\S]*id="volumebtn"[\s\S]*id="clock"/, '🔊 neben der Uhr');
      assert.match(desk, /<script src="\/static\/sound\.js\?v=\w+"><\/script>/);
    });

    await step('Musik: Mitglieder laden hoch und bearbeiten nur ihre eigenen Titel', async () => {
      const { anna, bernd } = members;
      const fd = new FormData();
      fd.append('visibility', 'members');
      fd.append('duration', '183.4');
      fd.append('file', new Blob([mp3('Annas Lied', 'Anna')]), 'anna.mp3');
      const up = await anna.req('/musik/hochladen', { method: 'POST', body: fd, headers: { 'x-csrf-token': anna.jar.get('csrf') } });
      assert.equal(up.status, 200, up.text_);
      const track = JSON.parse(up.text_).track;
      assert.equal(track.duration, 183.4);
      assert.ok(track.mine && !track.byAdmin);
      const bad = new FormData();
      bad.append('file', new Blob(['x']), 'bild.png');
      assert.equal((await anna.req('/musik/hochladen', { method: 'POST', body: bad, headers: { 'x-csrf-token': anna.jar.get('csrf') } })).status, 400);
      const noToken = new FormData();
      noToken.append('file', new Blob([mp3('x', 'y')]), 'x.mp3');
      assert.equal((await anna.req('/musik/hochladen', { method: 'POST', body: noToken })).status, 403, 'ohne Formular-Token');
      assert.ok(!(await lib(guest)).tracks.some(x => x.title === 'Annas Lied'), 'nur für Mitglieder');
      const seen = (await lib(bernd)).tracks.find(x => x.title === 'Annas Lied');
      assert.equal(seen.by, 'anna');
      assert.ok(!seen.canEdit);
      assert.equal((await api(bernd, '/musik/titel/' + track.id, { title: 'Gehackt' })).status, 404);
      assert.equal((await api(bernd, '/musik/titel/' + track.id + '/loeschen', {})).status, 404);
      assert.equal((await api(anna, '/musik/titel/' + track.id, { title: 'Annas Lied (neu)', artist: 'Anna', visibility: 'public' })).status, 200);
      assert.ok((await lib(guest)).tracks.some(x => x.title === 'Annas Lied (neu)'));
      assert.match((await admin.req('/admin/musik')).text_, /Annas Lied \(neu\)[\s\S]*anna \(Mitglied\)/);
    });

    await step('Musik: Playlists sind privat, bis man sie freigibt', async () => {
      const { anna, bernd } = members;
      const ids = (await lib(anna)).tracks.map(x => x.id);
      const made = await api(anna, '/musik/playlists', { title: 'Lieblingslieder', tracks: ids });
      assert.equal(made.status, 200);
      const pl = (await lib(anna)).playlists.find(p => p.id === made.json.id);
      assert.equal(pl.visibility, 'private');
      assert.deepEqual(pl.tracks, ids);
      assert.ok(!(await lib(bernd)).playlists.length, 'Bernd sieht die private Playlist nicht');
      assert.equal((await api(bernd, '/musik/playlists/' + pl.id, { title: 'Meins' })).status, 404);
      assert.equal((await api(anna, '/musik/playlists/' + pl.id, { visibility: 'members', tracks: [...ids].reverse() })).status, 200);
      const other = (await lib(bernd)).playlists.find(p => p.id === pl.id);
      assert.equal(other.owner, 'anna');
      assert.deepEqual(other.tracks, [...ids].reverse());
      assert.equal((await api(guest, '/musik/playlists', { title: 'x' })).status, 401);
    });

    await step('Mediaplayer: Videos hochladen, YouTube-Links ohne Konto abspielen und mit Konto speichern', async () => {
      const { anna, bernd } = members;
      const fd = new FormData();
      fd.append('visibility', 'members');
      fd.append('duration', '61');
      fd.append('file', new Blob(['\0\0\0\x18ftypmp42'], { type: 'video/mp4' }), 'Urlaub 2025.mp4');
      const up = await anna.req('/musik/hochladen', { method: 'POST', body: fd, headers: { 'x-csrf-token': anna.jar.get('csrf') } });
      assert.equal(up.status, 200, up.text_);
      const video = JSON.parse(up.text_).track;
      assert.deepEqual([video.kind, video.title, video.duration], ['video', 'Urlaub 2025', 61]);
      const vs = await bernd.req('/musik/stream/' + video.id, { headers: { range: 'bytes=0-3' } });
      assert.equal(vs.status, 206);
      assert.match(vs.headers.get('content-type'), /video\/mp4/);
      // Ohne Konto kommen nur die Angaben zurück, gespeichert wird nichts
      const g = await api(guest, '/musik/youtube', { ids: ['dQw4w9WgXcQ', 'kaputt'] });
      assert.equal(g.status, 200);
      assert.deepEqual(g.json.items.map(i => [i.type, i.videoId]), [['yt', 'dQw4w9WgXcQ']]);
      assert.ok(!g.json.tracks);
      assert.equal((await api(guest, '/musik/youtube', { ids: ['kaputt'] })).status, 400);
      // Mit Konto als Link in der Bibliothek; ein schon gespeichertes Video bleibt ein Eintrag
      const s1 = await api(anna, '/musik/youtube', { ids: ['dQw4w9WgXcQ', 'jNQXAC9IVRw'], save: true, visibility: 'members' });
      assert.equal(s1.status, 200);
      assert.deepEqual(s1.json.tracks.map(t => [t.kind, t.videoId, t.mine]), [['youtube', 'dQw4w9WgXcQ', true], ['youtube', 'jNQXAC9IVRw', true]]);
      const s2 = await api(anna, '/musik/youtube', { ids: ['dQw4w9WgXcQ'], save: true });
      assert.equal(s2.json.tracks[0].id, s1.json.tracks[0].id, 'schon gespeichert');
      const seen = (await lib(bernd)).tracks.filter(t => t.kind === 'youtube');
      assert.equal(seen.length, 2);
      assert.equal(seen[0].by, 'anna');
      assert.ok(!(await lib(guest)).tracks.some(t => t.kind === 'youtube'), 'nur für Mitglieder');
      assert.equal((await bernd.req('/musik/stream/' + seen[0].id)).status, 404, 'ein Link hat keine Datei');
      assert.equal((await api(anna, '/musik/titel/' + seen[0].id + '/gespielt', { duration: 212.6 })).status, 200);
      assert.equal((await lib(anna)).tracks.find(t => t.id === seen[0].id).duration, 212.6, 'Länge kommt vom YouTube-Player');
    });

    await step('Musik-Lobby: gemeinsam hören, Live-Verbindung und YouTube', async () => {
      const { anna, bernd } = members;
      assert.equal((await api(guest, '/musik/lobbys', undefined, 'GET')).status, 401, 'nur für Mitglieder');
      const made = await api(anna, '/musik/lobbys', { name: 'Freitagabend', open: false });
      assert.equal(made.status, 200);
      const id = made.json.id;
      assert.deepEqual((await api(bernd, '/musik/lobbys', undefined, 'GET')).json.lobbies.map(l => l.name), ['Freitagabend']);

      // Live-Verbindung wie EventSource im Browser
      const ctrl = new AbortController();
      const res = await fetch(`${BASE}/musik/lobby/${id}/events`, { headers: { cookie: [...bernd.jar].map(([k, v]) => `${k}=${v}`).join('; '), 'user-agent': UA }, signal: ctrl.signal });
      assert.match(res.headers.get('content-type'), /text\/event-stream/);
      assert.equal(res.headers.get('x-accel-buffering'), 'no');
      const reader = res.body.getReader();
      let buf = '';
      const nextState = async () => {
        for (;;) {
          const i = buf.indexOf('\n\n');
          if (i >= 0) { const ev = buf.slice(0, i); buf = buf.slice(i + 2); const m = ev.match(/^event: state\ndata: (.*)$/m); if (m) return JSON.parse(m[1]); continue; }
          const { value, done } = await reader.read();
          if (done) throw new Error('Verbindung zu');
          buf += Buffer.from(value).toString();
        }
      };
      let st = await nextState();
      assert.deepEqual(st.listeners.map(u => [u.name, u.host, u.control]), [['bernd', false, false]]);
      const berndId = st.listeners[0].id;
      assert.equal(st.queue.length, 0);

      const tracks = (await lib(anna)).tracks;
      const pub = tracks.find(x => x.title === 'Sommerlied');
      const add = await api(anna, `/musik/lobby/${id}`, { action: 'add', tracks: [pub.id], youtube: ['dQw4w9WgXcQ', 'kaputt', 'dQw4w9WgXcQ'] });
      assert.equal(add.status, 200);
      assert.equal(add.json.added, 2, 'doppeltes und ungültiges YouTube-Video fallen weg');
      st = await nextState();
      assert.deepEqual(st.queue.map(q => q.type), ['track', 'yt']);
      assert.equal(st.queue[1].title, 'YouTube-Video dQw4w9WgXcQ');
      assert.equal(st.index, 0);
      assert.ok(st.playing, 'das erste Lied startet sofort');
      assert.ok(Math.abs(st.startedAt - st.now) < 2000);

      assert.equal((await api(bernd, `/musik/lobby/${id}`, { action: 'pause' })).status, 403, 'nur der Gastgeber steuert');
      assert.equal((await api(bernd, `/musik/lobby/${id}`, { action: 'add', tracks: [pub.id] })).status, 403);
      // Player-Rechte für einzelne Zuhörer: nur der Gastgeber vergibt sie
      assert.equal((await api(bernd, `/musik/lobby/${id}`, { action: 'rights', user: berndId, allow: true })).status, 403);
      assert.equal((await api(anna, `/musik/lobby/${id}`, { action: 'rights', user: berndId, allow: true })).status, 200);
      st = await nextState();
      assert.ok(st.listeners[0].control);
      assert.equal((await api(bernd, `/musik/lobby/${id}`, { action: 'pause' })).status, 200);
      st = await nextState();
      assert.ok(!st.playing);
      assert.equal((await api(bernd, `/musik/lobby/${id}`, { action: 'play' })).status, 200);
      st = await nextState();
      assert.ok(st.playing);
      assert.equal((await api(anna, `/musik/lobby/${id}`, { action: 'rights', user: berndId, allow: false })).status, 200);
      st = await nextState();
      assert.ok(!st.listeners[0].control);
      assert.equal((await api(bernd, `/musik/lobby/${id}`, { action: 'pause' })).status, 403, 'Rechte wieder entzogen');
      assert.equal((await api(anna, `/musik/lobby/${id}`, { action: 'settings', open: true })).status, 200);
      st = await nextState();
      assert.ok(st.open);
      assert.equal((await api(bernd, `/musik/lobby/${id}`, { action: 'pause' })).status, 200);
      st = await nextState();
      assert.ok(!st.playing);
      assert.equal((await api(bernd, `/musik/lobby/${id}`, { action: 'jump', key: st.queue[1].key })).status, 200);
      st = await nextState();
      assert.equal(st.index, 1);
      // Die Länge eines YouTube-Videos meldet der Player im Browser
      assert.equal((await api(bernd, `/musik/lobby/${id}`, { action: 'meta', key: st.queue[1].key, duration: 212.3, title: 'Echter Titel' })).status, 200);
      st = await nextState();
      assert.equal(st.queue[1].duration, 212);
      assert.equal(st.queue[1].title, 'Echter Titel');

      // Private Titel wären nicht für alle hörbar
      const secretId = (await lib(admin)).tracks.find(x => x.title === 'Geheimtitel').id;
      const skip = await api(admin, `/musik/lobby/${id}`, { action: 'add', tracks: [secretId] });
      assert.equal(skip.json.added, 0);
      assert.match(skip.json.msg, /nicht für alle hörbar/);

      // Videos spielen wie Musik über den eigenen Server, gespeicherte YouTube-Links wie eingefügte
      const media = (await lib(anna)).tracks;
      const vid = media.find(x => x.kind === 'video'), link = media.find(x => x.kind === 'youtube');
      const add2 = await api(anna, `/musik/lobby/${id}`, { action: 'add', tracks: [vid.id, link.id] });
      assert.equal(add2.json.added, 2);
      st = await nextState();
      assert.deepEqual(st.queue.slice(-2).map(q => [q.type, q.video || false, q.videoId || null]), [['track', true, null], ['yt', false, link.videoId]]);
      // Mischen: Bis zum laufenden Titel bleibt alles, danach kommt dasselbe in neuer Reihenfolge
      const before = st.queue.map(q => q.key), at = st.index;
      assert.equal((await api(anna, `/musik/lobby/${id}`, { action: 'shuffle' })).status, 200);
      st = await nextState();
      assert.deepEqual(st.queue.slice(0, at + 1).map(q => q.key), before.slice(0, at + 1));
      assert.deepEqual(st.queue.map(q => q.key).sort(), [...before].sort());
      assert.equal((await api(bernd, `/musik/lobby/${id}`, { action: 'close' })).status, 403);
      assert.equal((await api(anna, `/musik/lobby/${id}`, { action: 'close' })).status, 200);
      ctrl.abort();
      assert.equal((await api(anna, `/musik/lobby/${id}`, { action: 'play' })).status, 404);
    });

    await step('Profile: Anzeigename, Sichtbarkeit, Suche und Links', async () => {
      const { anna, bernd } = members;
      let tk = await anna.csrf('/konto');
      const save = (b, data) => b.form('/account/profil', { _csrf: tk, profile_visibility: 'members', pm_from: 'all', ...data });
      assert.match((await save(anna, { display_name: 'BERND' })).headers.get('location'), /err=taken/, 'fremder Benutzername');
      assert.match((await save(anna, { display_name: '<b>x</b>' })).headers.get('location'), /err=name/);
      assert.match((await save(anna, { display_name: '  Anna   B. ', about: 'Ich mag Katzen.' })).headers.get('location'), /ok=profil/);
      const acc = (await anna.req('/konto?ok=profil')).text_;
      assert.match(acc, /Profil gespeichert/);
      assert.match(acc, /name="display_name" maxlength="32" value="Anna B\."/);

      // Nur Mitglieder sehen das Profil (Standard); Gäste finden es nicht in der Liste
      const asGuest = (await guest.req('/nutzer/anna')).text_;
      assert.match(asGuest, /nur angemeldete Mitglieder/);
      assert.doesNotMatch(asGuest, /Katzen/);
      assert.equal((await guest.req('/nutzer')).headers.get('location'), '/messenger/finden', 'frühere Mitgliederliste');
      assert.doesNotMatch((await guest.req('/messenger/finden')).text_, /\/nutzer\/anna"/);
      const asBernd = (await bernd.req('/nutzer/anna')).text_;
      assert.match(asBernd, /<h1>Anna B\.<\/h1>/);
      assert.match(asBernd, /Ich mag Katzen\./);
      assert.match((await bernd.req('/messenger/finden?q=anna')).text_, /href="\/nutzer\/anna"><b>Anna B\.<\/b>/);
      // Suche nach der Nummer (ICU#/DSN): 10 000 + Mitgliedsnummer
      const nr = (await bernd.req('/nutzer/anna')).text_.match(/# (\d+ \d+)/)[1];
      assert.match((await bernd.req('/messenger/finden?q=' + encodeURIComponent(nr))).text_, /href="\/nutzer\/anna"><b>Anna B\.<\/b>/);
      assert.equal((await bernd.req('/nutzer/gibtsnicht')).status, 404);

      // Öffentlich: auch Gäste sehen es
      assert.match((await save(anna, { display_name: 'Anna B.', about: 'Ich mag Katzen.', profile_visibility: 'public' })).headers.get('location'), /ok=profil/);
      assert.match((await guest.req('/nutzer/anna')).text_, /Ich mag Katzen\./);
      assert.match((await guest.req('/messenger/finden')).text_, /\/nutzer\/anna"/);

      // Anzeigename im Besucherbuch, Startmenü und als Link
      tk = await anna.csrf('/guestbook');
      await anna.form('/guestbook', { _csrf: tk, message: 'Hallo von Anna' });
      assert.match((await guest.req('/guestbook')).text_, /href="\/nutzer\/anna" class="userlink">[\s\S]*?Anna B\.<\/a>/);
      const desk = (await anna.req('/', { top: true })).text_;
      assert.match(desk, /<div class="startmenu"[\s\S]*href="\/messenger"><i class="sym sym-msgr" aria-hidden="true">🌼<\/i> Messenger[\s\S]*href="\/nutzer\/anna">👤 Mein Profil<\/a>\s*<a href="\/konto">🔑 Konto und Passwort/);
      assert.match(desk, /id="msgrtray"/);
      assert.match(desk, /messenger-hub\.js/);
      assert.match(desk, /Anna B\. abmelden/);
      assert.doesNotMatch((await guest.req('/', { top: true })).text_, /id="msgrtray"|messenger-hub\.js/);
    });

    await step('Freunde: anfragen, annehmen, nur für Freunde sichtbar', async () => {
      const { anna, bernd } = members;
      let tk = await anna.csrf('/konto');
      await anna.form('/account/profil', { _csrf: tk, display_name: 'Anna B.', about: 'Ich mag Katzen.', profile_visibility: 'friends', pm_from: 'friends' });
      assert.match((await bernd.req('/nutzer/anna')).text_, /sehen nur Freunde von Anna B\./);
      const friend = async (b, who, action) => { const t = await b.csrf('/nutzer/' + who); return b.form(`/nutzer/${who}/freund`, { _csrf: t, action, back: '/nutzer/' + who }); };
      // Anfrage mit einem Satz dazu; Anna sieht sie im Messenger und auf der Anfrage-Seite
      const t0 = await bernd.csrf('/messenger/anfrage/anna');
      assert.match((await bernd.form('/nutzer/anna/freund', { _csrf: t0, action: 'add', note: 'Hi, wir saßen <gestern> am Durak-Tisch', back: '/messenger/anfrage/anna' })).headers.get('location'), /^\/messenger\/anfrage\/anna\?ok=gesendet/);
      assert.match((await bernd.req('/nutzer/anna')).text_, /Anfrage zurückziehen/);
      const kontakte = JSON.parse((await anna.req('/api/messenger/kontakte')).text_);
      assert.deepEqual(kontakte.requests.map(r => [r.user, r.note]), [['bernd', 'Hi, wir saßen <gestern> am Durak-Tisch']]);
      assert.deepEqual(JSON.parse((await bernd.req('/api/messenger/kontakte')).text_).sent.map(r => r.user), ['anna'], 'Warten auf Antwort');
      const anfrage = (await anna.req('/messenger/anfrage/bernd')).text_;
      assert.match(anfrage, /„Hi, wir saßen &lt;gestern&gt; am Durak-Tisch“/);
      assert.match(anfrage, /name="action" value="accept"/);
      assert.match((await friend(anna, 'bernd', 'accept')).headers.get('location'), /ok=freunde/);
      const p = (await bernd.req('/nutzer/anna')).text_;
      assert.match(p, /Ich mag Katzen/, 'Freunde sehen das Profil');
      assert.match(p, /⭐ Freund/);
      assert.deepEqual(JSON.parse((await anna.req('/api/messenger/kontakte')).text_).contacts.map(c => [c.user, c.status]), [['bernd', 'offline']], 'Kontaktliste, ohne Verbindung offline');
      // Gegenseitige Anfrage nimmt an, statt doppelt anzulegen
      assert.match((await friend(anna, 'bernd', 'remove')).headers.get('location'), /ok=entfernt/);
      await friend(anna, 'bernd', 'add');
      assert.match((await friend(bernd, 'anna', 'add')).headers.get('location'), /ok=freunde/);
    });

    await step('Messenger: schreiben, gelesen, nur von Freunden, löschen', async () => {
      const { anna, bernd } = members;
      const { DatabaseSync } = require('node:sqlite');
      const sql = new DatabaseSync(path.join(DATA, 'site.db'), { timeout: 5000 });
      const send = async (b, to, body) => { const t = await b.csrf('/konto'); return b.form('/messenger/mit/' + to, { _csrf: t, body }); };
      const sent = await send(bernd, 'anna', 'Hallo Anna!\nWie geht es dir?');
      assert.equal(sent.status, 302, 'Freunde dürfen schreiben');
      assert.match(sent.headers.get('location'), /^\/messenger\/mit\/anna#n\d+$/);
      assert.equal(JSON.parse((await anna.req('/api/nachrichten')).text_).unread, 1);
      assert.equal(JSON.parse((await anna.req('/api/messenger/kontakte')).text_).contacts.find(c => c.user === 'bernd').unread, 1);
      const desk = (await anna.req('/', { top: true })).text_;
      assert.match(desk, /id="msgrtray"[^>]*><i class="st st-offline"><\/i><span class="pm-count">1</);
      const conv = (await anna.req('/messenger/mit/bernd')).text_;
      assert.match(conv, /Hallo Anna!\nWie geht es dir\?/);
      assert.match(conv, /messenger\.js/);
      assert.equal(JSON.parse((await anna.req('/api/nachrichten')).text_).unread, 0, 'beim Öffnen gelesen');
      assert.match((await bernd.req('/messenger/mit/bernd')).text_, /gibt es nicht/, 'nicht an sich selbst');
      assert.match((await bernd.req('/messenger/mit/anna')).text_, /✔✔ gelesen/);
      // Frühere Adressen (den Nachrichtenverlauf gibt es nicht mehr, Gespräche öffnet die Kontaktliste)
      assert.equal((await anna.req('/messenger/verlauf')).headers.get('location'), '/messenger');
      assert.equal((await anna.req('/nachrichten')).headers.get('location'), '/messenger');
      assert.equal((await anna.req('/nachrichten/bernd')).headers.get('location'), '/messenger/mit/bernd');

      // Per fetch (wie das Gesprächsfenster): JSON zurück
      const tj = await anna.csrf('/konto');
      const js = await anna.req('/messenger/mit/bernd', { method: 'POST', body: new URLSearchParams({ body: 'Gut, danke!' }), headers: { accept: 'application/json', 'x-csrf-token': tj } });
      assert.equal(js.status, 200);
      const msg = JSON.parse(js.text_).message;
      assert.equal(msg.body, 'Gut, danke!');
      assert.equal(msg.from, 'anna');
      assert.equal(msg.kind, 'text');
      // Anstupsen: höchstens einmal pro Minute
      const nudge = () => anna.req('/messenger/mit/bernd/anstupsen', { method: 'POST', headers: { accept: 'application/json', 'x-csrf-token': tj } });
      assert.equal(JSON.parse((await nudge()).text_).message.kind, 'nudge');
      assert.equal((await nudge()).status, 429);
      assert.match((await bernd.req('/messenger/mit/anna')).text_, /📳 Anna B\. hat dich angestupst!/);
      // Einladen geht nur in eine Lobby, in der man selbst sitzt
      const inv = await anna.req('/messenger/mit/bernd/einladen', { method: 'POST', body: new URLSearchParams({ url: '/kartenspiele/tisch/gibtsnicht' }), headers: { accept: 'application/json', 'x-csrf-token': tj } });
      assert.equal(inv.status, 400);
      assert.deepEqual(JSON.parse((await anna.req('/api/messenger/einladen')).text_).lobbies, []);

      // Anna will nur Nachrichten von Freunden: nach dem Entfernen darf Bernd nicht mehr schreiben …
      let t = await anna.csrf('/nutzer/bernd');
      await anna.form('/nutzer/bernd/freund', { _csrf: t, action: 'remove' });
      sql.prepare('DELETE FROM private_messages').run();
      const blocked = await send(bernd, 'anna', 'Noch da?');
      assert.equal(blocked.status, 400);
      assert.match(blocked.text_, /bekommt nur Nachrichten von Freunden/);
      // … aber antworten, wenn Anna zuerst schreibt
      assert.equal((await send(anna, 'bernd', 'Kurze Frage')).status, 302);
      assert.equal((await send(bernd, 'anna', 'Klar!')).status, 302);
      assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM private_messages').get().n, 2);

      // Verlauf löschen: erst nur für Anna, nach Bernd ganz weg
      t = await anna.csrf('/messenger/mit/bernd');
      assert.equal((await anna.form('/messenger/mit/bernd/loeschen', { _csrf: t })).headers.get('location'), '/messenger/mit/bernd');
      assert.match((await anna.req('/messenger/mit/bernd')).text_, /Noch keine Nachrichten/);
      assert.match((await bernd.req('/messenger/mit/anna')).text_, /Klar!/);
      t = await bernd.csrf('/messenger/mit/anna');
      await bernd.form('/messenger/mit/anna/loeschen', { _csrf: t });
      assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM private_messages').get().n, 0);
      sql.close();
    });

    await step('Messenger: Live-Verbindung, Status, Privatsphäre, Ignorieren', async () => {
      const { anna, bernd } = members;
      const kontakte = async b => JSON.parse((await b.req('/api/messenger/kontakte')).text_);
      const tA = await anna.csrf('/konto'), tB = await bernd.csrf('/konto');
      const post = (b, tk, url, data) => b.req(url, { method: 'POST', body: new URLSearchParams(data), headers: { accept: 'application/json', 'x-csrf-token': tk } });
      // Wieder Freunde
      await post(anna, tA, '/nutzer/bernd/freund', { action: 'add' });
      await post(bernd, tB, '/nutzer/anna/freund', { action: 'add' });
      assert.equal((await kontakte(anna)).contacts.find(c => c.user === 'bernd').status, 'offline');

      // Bernd öffnet den Desktop: Live-Verbindung, Anna sieht ihn online
      const ctrl = new AbortController();
      const res = await fetch(`${BASE}/api/messenger/stream?c=test1`, { headers: { cookie: [...bernd.jar].map(([k, v]) => `${k}=${v}`).join('; '), 'user-agent': UA }, signal: ctrl.signal });
      assert.match(res.headers.get('content-type'), /text\/event-stream/);
      const reader = res.body.getReader();
      let buf = '';
      const next = async type => {
        for (;;) {
          const i = buf.indexOf('\n\n');
          if (i >= 0) { const ev = buf.slice(0, i); buf = buf.slice(i + 2); const m = ev.match(/^event: (\w+)\ndata: (.*)$/m); if (m && m[1] === type) return JSON.parse(m[2]); continue; }
          const { value, done } = await reader.read();
          if (done) throw new Error('Verbindung zu');
          buf += Buffer.from(value).toString();
        }
      };
      const hallo = await next('hallo');
      assert.equal(hallo.user, 'bernd');
      assert.equal(hallo.status, 'online');
      assert.equal(hallo.conn, 'test1');
      assert.equal(hallo.prefs.away, 10, 'Vorgaben der Messenger-Einstellungen');
      assert.equal((await kontakte(anna)).contacts.find(c => c.user === 'bernd').status, 'online');
      assert.equal((await kontakte(anna)).me.status, 'offline', 'Anna selbst hat keine Verbindung');

      // Nachricht kommt live an
      await post(anna, tA, '/messenger/mit/bernd', { body: 'Live?' });
      const live = await next('nachricht');
      assert.equal(live.body, 'Live?');
      assert.equal(live.partner, 'anna');
      assert.equal((await next('ungelesen')).n, 1);
      // Tippen und Gelesen
      await post(anna, tA, '/messenger/mit/bernd/tippt', {});
      assert.equal((await next('tippt')).partner, 'anna');

      // Status: Abwesend mit Statusnachricht; untätig → abwesend
      const st = JSON.parse((await post(bernd, tB, '/api/messenger/status', { status: 'away', msg: '  Bin  kurz weg  ' })).text_);
      assert.equal(st.status, 'away');
      assert.equal(st.msg, 'Bin kurz weg');
      let b = (await kontakte(anna)).contacts.find(c => c.user === 'bernd');
      assert.deepEqual([b.status, b.msg], ['away', 'Bin kurz weg']);
      await post(bernd, tB, '/api/messenger/status', { status: 'online' });
      await post(bernd, tB, '/api/messenger/aktiv', { c: 'test1', idle: '1' });
      assert.equal((await kontakte(anna)).contacts.find(c => c.user === 'bernd').status, 'away', 'automatisch abwesend');
      await post(bernd, tB, '/api/messenger/aktiv', { c: 'test1', idle: '0' });
      // Unsichtbar: für alle anderen offline
      await post(bernd, tB, '/api/messenger/status', { status: 'invisible' });
      b = (await kontakte(anna)).contacts.find(c => c.user === 'bernd');
      assert.deepEqual([b.status, b.msg], ['offline', '']);
      await post(bernd, tB, '/api/messenger/status', { status: 'online' });

      // Privatsphäre: Status nur für Freunde (Vorgabe); Fremde sehen offline
      const asAdmin = JSON.parse((await admin.req('/api/nutzer/bernd')).text_);
      assert.equal(asAdmin.status, 'offline', 'kein Freund → offline');
      assert.match(asAdmin.number + '', /^100\d\d$/);
      let tk = await bernd.csrf('/konto');
      assert.match((await bernd.form('/konto/privatsphaere', { _csrf: tk, presence_from: 'members', activity_from: 'nobody', invite_from: 'nobody', request_from: 'nobody', profile_visibility: 'members', pm_from: 'all', gb_from: 'all' })).headers.get('location'), /reiter=privatsphaere&ok=privat/);
      assert.equal(JSON.parse((await admin.req('/api/nutzer/bernd')).text_).status, 'online', 'jetzt für alle Mitglieder');
      assert.equal(JSON.parse((await admin.req('/api/nutzer/bernd')).text_).canRequest, false, 'keine Anfragen');
      const kp = (await bernd.req('/konto?reiter=privatsphaere')).text_;
      assert.match(kp, /name="presence_from"[\s\S]*?value="members" selected/);
      assert.match(kp, /id="privatsphaere" role="tabpanel"[^>]*>/);
      assert.doesNotMatch(kp, /id="privatsphaere" role="tabpanel"[^>]* hidden/, 'Reiter aus der Adresse');
      // Zurück auf die Vorgaben
      await bernd.form('/konto/privatsphaere', { _csrf: tk, presence_from: 'friends', activity_from: 'friends', invite_from: 'friends', request_from: 'all', show_last_seen: '1', profile_visibility: 'members', pm_from: 'all', gb_from: 'all' });

      // Ignorieren: Freundschaft endet, Schreiben und Anfragen gehen nicht mehr, Status offline
      tk = await anna.csrf('/konto');
      assert.match((await anna.form('/messenger/ignorieren', { _csrf: tk, user: 'bernd', on: '1', back: '/konto?reiter=privatsphaere&ok=ignore#privatsphaere' })).headers.get('location'), /ok=ignore/);
      assert.equal(JSON.parse((await anna.req('/api/nutzer/bernd')).text_).relation, 'none', 'Freundschaft endet');
      const no = await post(bernd, tB, '/messenger/mit/anna', { body: 'Hallo?' });
      assert.equal(no.status, 400);
      assert.equal(JSON.parse((await bernd.req('/api/nutzer/anna')).text_).canRequest, false);
      assert.match((await anna.req('/konto?reiter=privatsphaere')).text_, /Ignorierte Mitglieder \(1\)[\s\S]*@bernd/);
      await anna.form('/messenger/ignorieren', { _csrf: tk, user: 'bernd', on: '0' });
      assert.match((await anna.req('/konto?reiter=privatsphaere')).text_, /Ignorierte Mitglieder \(0\)/);
      // Wie vor diesem Schritt: keine Freunde, keine Nachrichten
      ctrl.abort();
      for (const [b, tk2, who] of [[anna, tA, 'bernd'], [bernd, tB, 'anna']]) await post(b, tk2, `/messenger/mit/${who}/loeschen`, {});
    });

    await step('Benachrichtigungen: Freunde, Nachrichten, Forum, Einstellungen, Push', async () => {
      const { anna, bernd } = members;
      const api = async b => JSON.parse((await b.req('/api/benachrichtigungen')).text_);
      let j = await api(anna);
      assert.ok(j.items.some(n => /bernd hat deine Freundschaftsanfrage angenommen/.test(n.title)), 'Annahme der Anfrage');
      const pm = j.items.find(n => n.title === '💬 Nachricht von bernd');
      assert.ok(pm && pm.body === 'Klar!' && pm.read, 'Nachricht, gelesen beim Öffnen des Gesprächs');
      assert.match((await anna.req('/', { top: true })).text_, /id="notifybtn"[\s\S]*?class="notify-count">\d+</);
      assert.doesNotMatch((await guest.req('/', { top: true })).text_, /id="notifybtn"/);
      assert.match((await anna.req('/benachrichtigungen')).text_, /Nachricht von bernd/);
      let tk = await anna.csrf('/benachrichtigungen');
      await anna.form('/benachrichtigungen/alle-gelesen', { _csrf: tk });
      assert.equal((await api(anna)).unread, 0);

      // Antwort in einem abonnierten Thema; Öffnen des Themas markiert sie als gelesen
      tk = await anna.csrf('/forum/new');
      const topic = (await anna.form('/forum/new', { _csrf: tk, title: 'Abo-Test', body_md: 'Wer macht mit?', anonymous: '1' })).headers.get('location');
      const reply = async text => { const t = await bernd.csrf(topic); await bernd.form(topic + '/reply', { _csrf: t, body_md: text, anonymous: '1' }); };
      await reply('Ich!');
      await reply('Ich auch nochmal');
      j = await api(anna);
      const b = j.items.find(n => n.kind === 'board');
      assert.equal(j.unread, 1, 'zwei Antworten, eine Benachrichtigung');
      assert.equal(b.count, 2);
      assert.equal(b.title, '💬 Neue Antwort in „Abo-Test“');
      assert.equal(b.body, 'Anonym: Ich auch nochmal', 'anonyme Antworten bleiben anonym');
      assert.ok(!(await api(bernd)).items.some(n => /Abo-Test/.test(n.title)), 'eigene Antworten melden nichts');
      await anna.req(topic);
      assert.equal((await api(anna)).unread, 0);
      // Startseite: rechts die eigenen Benachrichtigungen, für Gäste Anmelden; links Neues aus dem Forum
      const home = (await anna.req('/')).text_;
      assert.match(home, /🔔 Für dich[\s\S]*Neue Antwort in „Abo-Test“/);
      assert.match(home, /💬 Neu im Forum[\s\S]*Abo-Test/);
      assert.match((await guest.req('/')).text_, /👋 Mitmachen[\s\S]*href="\/login"/);

      // Einstellungen: Forum aus, dann kommt nichts mehr
      const acc = (await anna.req('/konto')).text_;
      assert.match(acc, /id="benachrichtigungen"[\s\S]*name="site_board" value="1"[^>]*checked/);
      assert.doesNotMatch(acc, /name="site_admin"/, 'Admin-Hinweise nur für Admins');
      tk = await anna.csrf('/konto');
      const off = { _csrf: tk, site_pm: '1', site_friend: '1', push_pm: '1' };
      assert.match((await anna.form('/account/benachrichtigungen', off)).headers.get('location'), /ok=notify/);
      await reply('Hallo?');
      assert.equal((await api(anna)).unread, 0);
      assert.doesNotMatch((await anna.req('/konto')).text_, /name="site_board" value="1"[^>]*checked/);

      // Push: Schlüssel, Service Worker, Manifest; kaputte Abos werden abgelehnt
      assert.match(JSON.parse((await guest.req('/api/push/key')).text_).key, /^[A-Za-z0-9_-]{87}$/);
      const sw = await guest.req('/sw.js');
      assert.equal(sw.headers.get('service-worker-allowed'), '/');
      assert.match(sw.text_, /showNotification/);
      assert.equal(JSON.parse((await guest.req('/manifest.webmanifest')).text_).display, 'standalone');
      tk = await anna.csrf('/konto');
      const bad = await anna.req('/api/push/abo', { method: 'POST', body: JSON.stringify({ subscription: { endpoint: 'http://evil', keys: {} } }), headers: { 'content-type': 'application/json', 'x-csrf-token': tk } });
      assert.equal(bad.status, 400);
      assert.equal((await guest.req('/api/push/abo', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } })).status, 403, 'ohne Token');
    });

    await step('Profilbild: versteckte Angaben werden entfernt', async () => {
      const { anna } = members;
      const zlib = require('node:zlib');
      const crc = buf => { let c, r = ~0; for (const b of buf) { c = (r ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; r = (r >>> 8) ^ c; } return ~r >>> 0; };
      const chunk = (type, data) => { const h = Buffer.alloc(8); h.writeUInt32BE(data.length); h.write(type, 4, 'latin1'); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([h.subarray(4), data]))); return Buffer.concat([h, data, c]); };
      const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
      const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr),
        chunk('tEXt', Buffer.from('Comment\0Aufgenommen in Berlin')), chunk('eXIf', Buffer.from('MM\0*GEHEIM-GPS')),
        chunk('IDAT', zlib.deflateSync(Buffer.from([0, 255, 0, 0]))), chunk('IEND', Buffer.alloc(0))]);
      const fd = new FormData();
      fd.append('_csrf', await anna.csrf('/konto'));
      fd.append('avatar', new Blob([png], { type: 'image/png' }), 'ich.png');
      assert.match((await anna.req('/account/avatar', { method: 'POST', body: fd })).headers.get('location'), /ok=bild/);
      const prof = (await anna.req('/nutzer/anna')).text_;
      let url = prof.match(/src="(\/avatar\/[a-f0-9]{32}\.png)"/)[1];
      const img = await guest.req(url);
      assert.equal(img.status, 200);
      assert.match(img.headers.get('content-type'), /image\/png/);
      const file = fs.readFileSync(path.join(DATA, 'avatare', url.split('/').pop()));
      assert.ok(!file.includes('Berlin') && !file.includes('GEHEIM'), 'Text und EXIF sind weg');
      assert.ok(file.includes('IDAT') && file.includes('IEND'), 'Bild bleibt ganz');

      // Kein Bild: abgelehnt
      const bad = new FormData();
      bad.append('_csrf', await anna.csrf('/konto'));
      bad.append('avatar', new Blob(['<svg onload=alert(1)>'], { type: 'image/png' }), 'x.png');
      assert.match((await anna.req('/account/avatar', { method: 'POST', body: bad })).headers.get('location'), /err=bild/);

      // JPEG: EXIF fällt weg, nur die Drehung bleibt (src/profiles.js nicht direkt laden: db.js gäbe sonst die Root-Rechte des Tests ab)
      const exif = Buffer.from('Exif\0\0MM\0*\0\0\0\x08\0\x02\x01\x12\0\x03\0\0\0\x01\0\x06\0\0\x88\x25\0\x04\0\0\0\x01\0\0\0\0\0\0\0\0GPS-GEHEIM', 'latin1');
      const seg = (m, data) => { const h = Buffer.from([0xff, m, 0, 0]); h.writeUInt16BE(data.length + 2, 2); return Buffer.concat([h, data]); };
      const jpg = Buffer.concat([Buffer.from([0xff, 0xd8]), seg(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1')), seg(0xe1, exif),
        seg(0xfe, Buffer.from('Kommentar')), seg(0xda, Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0])), Buffer.from([1, 2, 3, 0xff, 0xd9])]);
      const jfd = new FormData();
      jfd.append('_csrf', await anna.csrf('/konto'));
      jfd.append('avatar', new Blob([jpg], { type: 'image/jpeg' }), 'foto.jpg');
      assert.match((await anna.req('/account/avatar', { method: 'POST', body: jfd })).headers.get('location'), /ok=bild/);
      assert.equal((await guest.req(url)).status, 404, 'altes Bild ist weg');
      url = (await anna.req('/nutzer/anna')).text_.match(/src="(\/avatar\/[a-f0-9]{32}\.jpg)"/)[1];
      const out = fs.readFileSync(path.join(DATA, 'avatare', url.split('/').pop()));
      assert.ok(!out.includes('GPS-GEHEIM') && !out.includes('Kommentar'));
      assert.ok(out.includes('JFIF'));
      const i = out.indexOf(Buffer.from([0x01, 0x12]));
      assert.ok(i > 0 && out[i + 9] === 6, 'Drehung (6) bleibt erhalten');
      assert.ok(out.subarray(-5).equals(Buffer.from([1, 2, 3, 0xff, 0xd9])));

      // Admin setzt unpassende Angaben zurück
      const annaId = Number((await admin.req('/admin/users')).text_.match(/href="\/admin\/users\/(\d+)"><b>anna</)[1]);
      const page = (await admin.req('/admin/users/' + annaId)).text_;
      assert.match(page, /Anzeigename „Anna B\.“ entfernen/);
      const t = await admin.csrf('/admin/users/' + annaId);
      await admin.form('/admin/users/' + annaId, { _csrf: t, role: 'user', reset_avatar: '1' });
      assert.equal((await guest.req(url)).status, 404, 'Datei gelöscht');
      assert.match((await anna.req('/nutzer/anna')).text_, /<h1>Anna B\.<\/h1>/, 'Name bleibt, wenn nicht angekreuzt');
    });

    await step('Spielstatistik: Spiele melden Zahlen, das Profil zeigt sie', async () => {
      const { anna, bernd } = members;
      const patch = (b, app, body, type = 'application/json') => b.req('/api/stats/' + app, { method: 'PATCH', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': type } });
      assert.equal((await patch(guest, 'haustier', { add: { Siege: 1 } })).status, 401);
      assert.equal((await patch(anna, 'gibtsnicht', { add: { Siege: 1 } })).status, 404);
      assert.equal((await patch(anna, 'haustier', 'add=1', 'application/x-www-form-urlencoded')).status, 415);
      assert.equal((await patch(anna, 'haustier', { add: { Gestartet: 5 } })).status, 400, 'den Startzähler führt die Seite');
      assert.equal((await patch(anna, 'haustier', { add: { Siege: 'viele' } })).status, 400);
      assert.equal((await patch(anna, 'haustier', { hack: { Siege: 1 } })).status, 400);
      assert.equal((await patch(anna, 'haustier', { add: { Siege: 2 }, max: { Rekord: 10 } })).status, 200);
      const r = JSON.parse((await patch(anna, 'haustier', { add: { Siege: 1 }, max: { Rekord: 5 } })).text_);
      assert.deepEqual(r.stats, { Rekord: 10, Siege: 3 });
      // Starten mit Konto zählt mit, der Spielstand liefert eigene Werte
      await anna.req('/haustier/');
      await anna.req('/api/saves/haustier/main', { method: 'PUT', body: JSON.stringify({ data: JSON.stringify({ version: 1, pets: [{ xp: 160 }], earned: 42, visits: { total: 7, best: 4 } }) }), headers: { 'content-type': 'application/json' } });
      const p = (await bernd.req('/nutzer/anna')).text_;
      assert.match(p, /sehen nur Freunde/, 'Statistik nur, wenn man das Profil sehen darf');
      assert.doesNotMatch(p, /Rekord/);
      const t = await anna.csrf('/konto');
      await anna.form('/account/profil', { _csrf: t, display_name: 'Anna B.', about: 'Ich mag Katzen.', profile_visibility: 'members', pm_from: 'all' });
      const prof = (await bernd.req('/nutzer/anna')).text_;
      const card = prof.slice(prof.indexOf('id="spiele"'));
      assert.match(card, /Pixelpfoten[\s\S]*Gestartet<\/td><td class="num">1<[\s\S]*Rekord<\/td><td class="num">10<[\s\S]*Siege<\/td><td class="num">3</);
      assert.match(card, /Höchste Stufe<\/td><td class="num">4<[\s\S]*Münzen verdient<\/td><td class="num">42</);
      assert.match(prof, /Forenbeiträge<\/td><td class="num">0</, 'anonyme Beiträge zählen nicht');
    });

    await step('Freundebuch im Profil: eintragen, Rechte, löschen', async () => {
      const { anna, bernd } = members;
      let t = await bernd.csrf('/konto');
      assert.equal((await bernd.form('/nutzer/anna/freundebuch', { _csrf: t, body: 'Schönes Profil!\nGruß, Bernd' })).status, 302);
      let prof = (await anna.req('/nutzer/anna')).text_;
      assert.match(prof, /📖 Freundebuch \(1\)[\s\S]*href="\/nutzer\/bernd" class="userlink">[\s\S]*Schönes Profil!\nGruß, Bernd/);
      const id = prof.match(/id="g(\d+)"/)[1];
      assert.doesNotMatch((await guest.req('/nutzer/anna')).text_, /Schönes Profil/, 'nur wer das Profil sieht');
      // Nur Freunde dürfen schreiben: Bernd ist gerade kein Freund
      t = await anna.csrf('/konto');
      await anna.form('/account/profil', { _csrf: t, display_name: 'Anna B.', about: 'Ich mag Katzen.', profile_visibility: 'members', pm_from: 'all', gb_from: 'friends' });
      assert.match((await bernd.req('/nutzer/anna')).text_, /nur Freunde von Anna B\. schreiben/);
      t = await bernd.csrf('/konto');
      await bernd.form('/nutzer/anna/freundebuch', { _csrf: t, body: 'Darf ich nicht' });
      assert.doesNotMatch((await anna.req('/nutzer/anna')).text_, /Darf ich nicht/);
      // Fremde dürfen nicht löschen, die Profilinhaberin schon
      t = await bernd.csrf('/konto');
      await bernd.form(`/nutzer/bernd/freundebuch/${id}/loeschen`, { _csrf: t });
      assert.match((await anna.req('/nutzer/anna')).text_, /Schönes Profil/);
      t = await anna.csrf('/konto');
      await anna.form(`/nutzer/anna/freundebuch/${id}/loeschen`, { _csrf: t });
      prof = (await anna.req('/nutzer/anna')).text_;
      assert.doesNotMatch(prof, /Schönes Profil/);
      assert.match(prof, /Noch keine Einträge/);
      t = await anna.csrf('/konto');
      await anna.form('/account/profil', { _csrf: t, display_name: 'Anna B.', profile_visibility: 'members', pm_from: 'all', gb_from: 'off' });
      assert.doesNotMatch((await bernd.req('/nutzer/anna')).text_, /📖 Freundebuch/, 'ausgeschaltet');
    });

    await step('Lobby und Musik verlinken auf Profile, Namen öffnen das Nutzermenü', async () => {
      const { anna, bernd } = members;
      const js = (await guest.req('/static/music.js')).text_;
      assert.match(js, /RetroUserMenu\.open\(e, u\.user/);
      assert.match(js, /'\/nutzer\/' \+ encodeURIComponent/);
      assert.match((await guest.req('/static/usermenu.js')).text_, /Profil ansehen[\s\S]*Als Freund hinzufügen[\s\S]*Nachricht schreiben/);
      assert.match((await anna.req('/musik')).text_, /usermenu\.js[\s\S]*music\.js/);
      // Kurzinfo fürs Menü und Freundschaft per fetch
      const info = await api(bernd, '/api/nutzer/anna', undefined, 'GET');
      assert.equal(info.status, 200);
      assert.equal(info.json.user, 'anna');
      assert.equal(info.json.url, '/nutzer/anna');
      assert.equal(typeof info.json.canMessage, 'boolean');
      assert.equal((await api(bernd, '/api/nutzer/gibtsnicht', undefined, 'GET')).status, 404);
      const rel = info.json.relation;
      const fr = await bernd.req('/nutzer/anna/freund', { method: 'POST', body: new URLSearchParams({ action: rel === 'friends' ? 'remove' : 'add' }), headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', 'x-csrf-token': bernd.jar.get('csrf') } });
      assert.equal(fr.status, 200);
      const j = JSON.parse(fr.text_);
      assert.equal(j.ok, true);
      assert.notEqual(j.relation, rel);
      // wieder wie vorher
      await bernd.req('/nutzer/anna/freund', { method: 'POST', body: new URLSearchParams({ action: rel === 'friends' ? 'add' : 'cancel' }), headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', 'x-csrf-token': bernd.jar.get('csrf') } });
      if (rel === 'friends') await anna.req('/nutzer/bernd/freund', { method: 'POST', body: new URLSearchParams({ action: 'accept' }), headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', 'x-csrf-token': anna.jar.get('csrf') } });
      assert.equal((await api(bernd, '/api/nutzer/anna', undefined, 'GET')).json.relation, rel);
    });

    await step('Pixelpfoten-Besuche: Nachbarn, Besuchsbuch, Einstellung und Live-Zimmer', async () => {
      const { anna, bernd } = members;
      const { newState } = require('../games/haustier/src/js/state.js');
      const { adopt } = require('../games/haustier/src/js/pets.js');
      const saveFor = async (b, name, visitors) => {
        const s = newState();
        adopt(s, 'dog', null, name);
        if (visitors) s.visitors = visitors;
        const r = await b.req('/api/saves/haustier/main', { method: 'PUT', body: JSON.stringify({ data: JSON.stringify(s) }), headers: { 'content-type': 'application/json' } });
        assert.equal(r.status, 200);
        return s;
      };
      const annaSave = await saveFor(anna, 'Balu');
      await saveFor(bernd, 'Hoppel');
      assert.equal((await api(guest, '/api/pixelpfoten/nachbarn', undefined, 'GET')).status, 401);
      const nb = await api(bernd, '/api/pixelpfoten/nachbarn', undefined, 'GET');
      const a = nb.json.neighbours.find(n => n.user === 'anna');
      assert.ok(a, 'Anna steht bei Bernds Nachbarn');
      assert.deepEqual(a.pets.map(p => p.name), ['Balu']);
      assert.equal(a.coins, undefined);
      const room = await api(bernd, '/api/pixelpfoten/zimmer/anna', undefined, 'GET');
      assert.equal(room.status, 200);
      assert.equal(room.json.pets[0].name, 'Balu');
      assert.equal(room.json.pets[0].xp, undefined, 'nur die öffentliche Ansicht');
      assert.equal((await api(bernd, '/api/pixelpfoten/zimmer/bernd', undefined, 'GET')).status, 404, 'das eigene Zimmer ist kein Besuch');

      // Handlungen landen im Besuchsbuch, mit Tageslimit und Prüfung
      const pet = annaSave.pets[0].id;
      const act = body => api(bernd, '/api/pixelpfoten/zimmer/anna', body);
      assert.equal((await bernd.req('/api/pixelpfoten/zimmer/anna', { method: 'POST', body: '{"kind":"visit"}', headers: { 'content-type': 'application/json' } })).status, 403, 'ohne CSRF-Token');
      assert.deepEqual((await act({ kind: 'visit' })).json, { ok: true, counted: true });
      assert.deepEqual((await act({ kind: 'visit' })).json, { ok: true, counted: false }, 'einmal am Tag');
      assert.equal((await act({ kind: 'pet', pet })).json.counted, true);
      assert.equal((await act({ kind: 'pet', pet: 'fremd' })).status, 400);
      assert.equal((await act({ kind: 'gift', detail: 'food_dry' })).json.counted, true);
      assert.equal((await act({ kind: 'gift', detail: 'acc_crown' })).status, 400);
      assert.equal((await act({ kind: 'sticker', detail: '🌟' })).json.counted, true);
      assert.equal((await act({ kind: 'sticker', detail: '<b>' })).status, 400);
      assert.equal((await act({ kind: 'hack' })).status, 400);
      const box = await api(anna, '/api/pixelpfoten/post', undefined, 'GET');
      assert.deepEqual(box.json.entries.map(e => e.kind), ['visit', 'pet', 'gift', 'sticker']);
      assert.ok(box.json.entries.every(e => e.visitor === 'bernd'));
      assert.equal(box.json.book[0].stickers, '🌟');
      assert.equal((await api(anna, '/api/pixelpfoten/post', { upTo: box.json.entries.at(-1).id })).status, 200);
      assert.equal((await api(anna, '/api/pixelpfoten/post', undefined, 'GET')).json.entries.length, 0, 'abgeholt');
      assert.ok((await api(anna, '/api/benachrichtigungen', undefined, 'GET')).json.items.some(n => /bernd hat deine Pixelpfoten besucht/.test(n.title)), 'Anna erfährt vom Besuch');

      // Live-Zimmer: Anna ist zu Hause, Bernd kommt dazu und schickt den Stand seines Tieres
      const sse = (b, url) => {
        const ctl = new AbortController();
        const events = [];
        let waiters = [];
        const ready = fetch(BASE + url, { signal: ctl.signal, headers: { 'user-agent': UA, cookie: [...b.jar].map(([k, v]) => `${k}=${v}`).join('; ') } }).then(async res => {
          assert.equal(res.headers.get('content-type'), 'text/event-stream; charset=utf-8');
          const dec = new TextDecoder();
          let buf = '';
          (async () => {
            try {
              for await (const chunk of res.body) {
                buf += dec.decode(chunk, { stream: true });
                let i;
                while ((i = buf.indexOf('\n\n')) >= 0) {
                  const block = buf.slice(0, i); buf = buf.slice(i + 2);
                  const ev = block.match(/^event: (.+)$/m), data = block.match(/^data: (.+)$/m);
                  if (ev) { events.push({ event: ev[1], data: JSON.parse(data[1]) }); waiters.forEach(w => w()); }
                }
              }
            } catch {}
          })();
        });
        const next = async (name) => {
          for (let t = 0; t < 40; t++) {
            const i = events.findIndex(e => e.event === name);
            if (i >= 0) return events.splice(i, 1)[0].data;
            await new Promise(r => { waiters.push(r); setTimeout(r, 50); });
            waiters = [];
          }
          throw new Error('kein Ereignis ' + name);
        };
        return { ready, next, close: () => ctl.abort() };
      };
      const home = sse(anna, '/api/pixelpfoten/live/anna');
      await home.ready;
      assert.deepEqual((await home.next('hello')).members, []);
      // Das eigene Zimmer in einem zweiten Fenster: dort steht man nicht als eigener Besuch
      const home2 = sse(anna, '/api/pixelpfoten/live/anna');
      await home2.ready;
      assert.deepEqual((await home2.next('hello')).members, []);
      home2.close();
      const guestLive = sse(bernd, '/api/pixelpfoten/live/anna');
      await guestLive.ready;
      const hello = await guestLive.next('hello');
      assert.equal(hello.members[0].user, 'anna');
      assert.equal(hello.members[0].host, true);
      assert.equal((await home.next('join')).user, 'bernd');
      assert.equal((await api(bernd, '/api/pixelpfoten/nachbarn', undefined, 'GET')).json.neighbours.find(n => n.user === 'anna').live, true);
      const up = await api(bernd, '/api/pixelpfoten/live/anna', { sid: hello.sid, pets: [{ id: 'h1', name: 'Hoppel<script>', species: 'dog', x: 0.4, d: 0.5 }, { species: 'drache' }], toy: { id: 'toy_ball', x: 0.5, y: 0.5, d: 0.5 } });
      assert.equal(up.status, 200);
      const st = await home.next('state');
      assert.equal(st.pets.length, 1);
      assert.equal(st.pets[0].name, 'Hoppelscript');
      assert.equal(st.toy.id, 'toy_ball');
      assert.equal((await api(anna, '/api/pixelpfoten/live/anna', { sid: hello.sid, pets: [] })).status, 409, 'fremde Verbindung');
      // Streicheln, während Anna da ist: ihr Spiel holt es sofort ab
      await act({ kind: 'pet', pet });
      await home.next('post');
      guestLive.close();
      assert.equal((await home.next('leave')).sid, hello.sid);
      home.close();

      // Niemand darf besuchen: Zimmer und Nachbarliste sind zu
      await saveFor(anna, 'Balu', 'none');
      assert.equal((await api(bernd, '/api/pixelpfoten/zimmer/anna', undefined, 'GET')).status, 404);
      assert.equal((await act({ kind: 'pet', pet })).status, 400);
      assert.ok(!(await api(bernd, '/api/pixelpfoten/nachbarn', undefined, 'GET')).json.neighbours.some(n => n.user === 'anna'));
      const g = sse(bernd, '/api/pixelpfoten/live/anna');
      await assert.rejects(g.ready);
      g.close();
    });

    await step('Pixelpfoten-Tageswettbewerb: Bestenliste, beste Runde zählt, unmögliche Ergebnisse abgelehnt', async () => {
      const { anna, bernd } = members;
      const { contestCourse, maxScore, PLACES } = require('../games/haustier/src/js/trip.js');
      assert.equal((await api(guest, '/api/pixelpfoten/wettbewerb', undefined, 'GET')).status, 401);
      const c = await api(anna, '/api/pixelpfoten/wettbewerb', undefined, 'GET');
      assert.equal(c.status, 200);
      assert.ok(PLACES[c.json.place]);
      assert.equal(c.json.place, contestCourse(c.json.day).place);
      assert.deepEqual(c.json.top, []);
      assert.equal(c.json.mine, null);
      const max = maxScore(contestCourse(c.json.day));
      const send = (b, score, extra = {}) => api(b, '/api/pixelpfoten/wettbewerb', { day: c.json.day, score, pet: { name: 'Balu<b>', species: 'dog', color: 'golden' }, ...extra });
      assert.equal((await send(anna, max + 1)).status, 400, 'mehr als möglich');
      assert.equal((await send(anna, 12.5)).status, 400);
      assert.equal((await send(anna, 10, { day: '2000-01-01' })).status, 400, 'alter Wettbewerb');
      assert.equal((await send(anna, 10, { pet: { name: 'X', species: 'drache' } })).status, 400);
      assert.equal((await bernd.req('/api/pixelpfoten/wettbewerb', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } })).status, 403, 'ohne CSRF-Token');
      assert.deepEqual((await send(anna, 120)).json, { ok: true, place: 1, best: 120 });
      assert.deepEqual((await send(bernd, 150, { pet: { name: 'Hoppel', species: 'rabbit', color: 'lila' } })).json, { ok: true, place: 1, best: 150 });
      assert.deepEqual((await send(anna, 90)).json, { ok: true, place: 2, best: 120 }, 'schlechtere Runde ändert nichts');
      const board = (await api(anna, '/api/pixelpfoten/wettbewerb', undefined, 'GET')).json;
      assert.deepEqual(board.top.map(e => [e.place, e.user, e.pet.name, e.score, e.me]), [[1, 'bernd', 'Hoppel', 150, false], [2, 'anna', 'Balub', 120, true]]);
      assert.equal(board.top[0].pet.color, 'white', 'unbekannte Farbe wird ersetzt');
      assert.deepEqual(board.mine, { place: 2, score: 120, pet: 'Balub' });
      assert.deepEqual(board.yesterday.top, []);
    });

    // Live-Verbindung zum Spieltisch: liefert die Zustände des gerade gewählten Spiels und meldet einen Spielwechsel
    let cardTable = null;
    function cardStream(m) {
      const ctrl = new AbortController();
      const ready = fetch(`${BASE}/kartenspiele/tisch/${cardTable}/events`, { headers: { cookie: [...m.jar].map(([k, v]) => `${k}=${v}`).join('; '), 'user-agent': UA }, signal: ctrl.signal });
      let reader = null, buf = '';
      async function next(want) {
        if (!reader) { const res = await ready; assert.match(res.headers.get('content-type'), /text\/event-stream/); reader = res.body.getReader(); }
        for (;;) {
          const i = buf.indexOf('\n\n');
          if (i >= 0) {
            const ev = buf.slice(0, i); buf = buf.slice(i + 2);
            const m = ev.match(/^event: (\w+)\ndata: (.*)$/m);
            if (m && (m[1] === want || m[1] === 'switch')) return { event: m[1], data: JSON.parse(m[2]) };
            continue;
          }
          const { value, done } = await reader.read();
          if (done) throw new Error('Verbindung zu');
          buf += Buffer.from(value).toString();
        }
      }
      return {
        state: async () => { const e = await next('state'); assert.equal(e.event, 'state', 'kein Spielwechsel erwartet'); return e.data; },
        salon: async () => (await next('salon')).data,
        switched: async () => { for (;;) { const e = await next('switch'); if (e.event === 'switch') return e.data; } },
        close: () => ctrl.abort(),
      };
    }
    const at = (m, body) => api(m, `/kartenspiele/tisch/${cardTable}`, body);

    await step('Kartenspiele: Startmenü, Fenster, Spieltisch eröffnen, Kasse', async () => {
      const { anna, bernd } = members;
      const home = (await guest.req('/', { top: true })).text_;
      // Ein Eintrag für alle Kartenspiele in Spiele und Apps, die einzelnen Spiele führen dorthin
      assert.match(home, /🎮 Spiele und Apps<\/button><div class="submenu">\s*<a href="\/kartenspiele"><i class="sym sym-karten" aria-hidden="true">🂡<\/i> Kartenspiele<\/a>\s*<a href="\/quiz"/);
      assert.match(home, /href="\/guestbook">📖 Besucherbuch/);
      for (const g of ['blackjack', 'poker', 'durak', 'uno', 'flip7', 'pilli']) {
        assert.doesNotMatch(home, new RegExp(`href="/${g}"`));
        const r = await anna.req('/' + g);
        assert.equal(r.status, 302, g);
        assert.equal(r.headers.get('location'), '/kartenspiele');
        // Zahlen zählt der Server selbst: Browser dürfen für die Kartenspiele nichts melden
        assert.equal((await api(anna, `/api/stats/${g}`, { add: { Gespielt: 99 } }, 'PATCH')).status, 404, g);
      }
      const page = (await guest.req('/kartenspiele')).text_;
      assert.match(page, /Anmelden/);
      assert.doesNotMatch(page, /kartenspiele\.js/, 'Gäste bekommen kein Spiel');
      assert.match((await anna.req('/kartenspiele')).text_, /usermenu\.js[\s\S]*blackjack\.js[\s\S]*poker\.js[\s\S]*durak\.js[\s\S]*cardtable\.js[\s\S]*uno\.js[\s\S]*flip7\.js[\s\S]*pilli\.js[\s\S]*kartenspiele\.js/);
      assert.equal((await api(guest, '/kartenspiele/tische', undefined, 'GET')).status, 401);
      // Karten im Code: jeder Ausschnitt wird in seiner Datei gefunden
      const code = (await api(anna, '/kartenspiele/code', undefined, 'GET')).json.snippets;
      assert.ok(Object.keys(code).length >= 10);
      for (const [name, c] of Object.entries(code)) assert.ok(!c.missing && c.code, `Ausschnitt ${name} (${c.file}) fehlt`);
      assert.match(code.shuffle.code, /crypto\.randomInt/);

      const k = await api(anna, '/kartenspiele/kasse', undefined, 'GET');
      assert.deepEqual([k.json.kasse.balance, k.json.kasse.net, k.json.kasse.buyins], [1000, 0, 1]);
      assert.match((await api(anna, '/kartenspiele/kasse', { action: 'rebuy' })).json.error, /weniger als 200 €/);

      const made = await api(anna, '/kartenspiele/tische', { name: 'Freitagsrunde', game: 'blackjack', seats: 3, felt: 'blau', back: 'gold' });
      assert.equal(made.status, 200);
      cardTable = made.json.id;
      const list = await api(bernd, '/kartenspiele/tische', undefined, 'GET');
      assert.deepEqual(list.json.tables.map(t => [t.name, t.game, t.seats]), [['Freitagsrunde', 'blackjack', 3]]);
      const meta = await api(bernd, `/kartenspiele/tisch/${cardTable}`, undefined, 'GET');
      assert.deepEqual([meta.json.game, meta.json.felt, meta.json.back, meta.json.money, meta.json.next], ['blackjack', 'blau', 'gold', true, 'host']);
      // Eigene Ansicht: Hintergrund frei, Holz nur, wenn man es hat
      assert.match((await api(bernd, '/kartenspiele/ansicht', { floor: 'parkett', wood: 'ebenholz' })).json.error, /erst im Shop/);
      const v = await api(bernd, '/kartenspiele/ansicht', { floor: 'parkett', wood: 'eiche' });
      assert.deepEqual(v.json.view, { floor: 'parkett', wood: 'eiche' });
      assert.deepEqual((await api(bernd, '/kartenspiele/ansicht', { floor: '<b>', wood: '' })).json.view, { floor: 'lounge', wood: '' });
      assert.equal((await api(bernd, '/kartenspiele/tische', undefined, 'GET')).json.view.floor, 'lounge');
    });


    await step('Kartenspiele: Blackjack am Spieltisch, Geld aus der Kasse, Bilanz im Profil', async () => {
      const { anna, bernd } = members;
      const live = cardStream(anna);
      assert.equal((await live.salon()).felt, 'blau');
      let st = await live.state();
      assert.equal(st.seatCount, 3);
      assert.equal((await at(anna, { action: 'sit' })).status, 200);
      st = await live.state();
      assert.equal(st.seats[0].user, 'anna');
      assert.deepEqual([st.seats[0].chips, st.seats[0].balance], [1000, 0]);
      const rebuy = await at(anna, { action: 'rebuy' });
      assert.equal(rebuy.status, 400);
      assert.match(rebuy.json.error, /weniger als 200 €/);
      assert.equal((await at(bernd, { action: 'kick', user: st.seats[0].id })).status, 400, 'nur der Gastgeber');
      assert.equal((await at(bernd, { action: 'game', game: 'poker' })).status, 400, 'nur der Gastgeber wählt das Spiel');
      assert.equal((await at(bernd, { action: 'design', felt: 'rot' })).status, 400);

      // Eine Runde: setzen, bestätigen, beim eigenen Zug halten, Ergebnis abwarten
      assert.equal((await at(anna, { action: 'bet', amount: 100 })).status, 200);
      assert.equal((await at(anna, { action: 'confirm' })).status, 200);
      for (;;) {
        st = await live.state();
        if (st.phase === 'playing') assert.ok(st.dealer[1] === null, 'Lochkarte verdeckt');
        if (st.phase === 'playing' && st.turn && st.turn.seat === 0) await at(anna, { action: 'stand' });
        if (st.phase === 'result') break;
      }
      const balance = st.seats[0].balance;
      assert.equal(balance, st.seats[0].chips - 1000);
      assert.ok(['win', 'blackjack', 'push', 'lose', 'bust'].includes(st.seats[0].hands[0].result));
      live.close();

      // Die Kasse zieht nach der Hand mit; solange das Geld am Tisch liegt, kauft man dort nach
      const k = await api(anna, '/kartenspiele/kasse', undefined, 'GET');
      assert.deepEqual([k.json.kasse.balance, k.json.kasse.net, k.json.kasse.atTable], [1000 + balance, balance, 'Freitagsrunde']);
      assert.match((await api(anna, '/kartenspiele/kasse', { action: 'rebuy' })).json.error, /am Spieltisch „Freitagsrunde“/);
      assert.equal(k.json.board.find(u => u.user === 'anna').net, balance);

      const stats = await api(anna, '/blackjack/statistik', undefined, 'GET');
      assert.equal(stats.json.me.hands, 1);
      assert.equal(stats.json.me.balance, balance);
      assert.equal(stats.json.sessions[0].table, 'Freitagsrunde');
      const prof = (await bernd.req('/nutzer/anna')).text_;
      assert.match(prof, /href="\/kartenspiele"><b>Kartenspiele<\/b>[\s\S]*Kontostand<\/td><td class="num">[\d.]+ €[\s\S]*Bilanz<\/td><td class="num[^"]*">[−+±][\d.]+ €/);
      assert.match(prof, /href="\/kartenspiele"><b>Blackjack<\/b>[\s\S]*Gewonnen\/verloren<\/td><td class="num[^"]*">[−+±][\d.]+ €/);
      assert.match(prof, /Hände<\/td><td class="num">1</);
    });

    await step('Kartenspiele: Spiel wechseln zu Poker, alle bleiben sitzen, Geld kommt mit', async () => {
      const { anna, bernd } = members;
      assert.equal((await at(bernd, { action: 'sit' })).status, 200);
      const live = cardStream(anna);
      await live.state();
      assert.equal((await at(anna, { action: 'game', game: 'poker' })).status, 200);
      assert.equal((await live.switched()).game, 'poker');
      live.close();
      const list = await api(bernd, '/kartenspiele/tische', undefined, 'GET');
      assert.deepEqual(list.json.tables.map(t => [t.name, t.game]), [['Freitagsrunde', 'poker']]);
      const wallet = (await api(anna, '/kartenspiele/kasse', undefined, 'GET')).json.kasse.balance;

      const p = cardStream(anna);
      let st = await p.state();
      const mine = st.seats.find(x => x && x.user === 'anna'), his = st.seats.find(x => x && x.user === 'bernd');
      assert.equal(mine.chips, wallet, 'Chips aus der Kasse');
      assert.equal(his.chips, 1000);
      assert.match(st.log.join(' '), /hat Poker gewählt/);
      // Die nächste Hand gibt der Gastgeber
      assert.equal(st.manual, true);
      assert.equal((await at(bernd, { action: 'start' })).status, 400, 'nur der Gastgeber gibt');
      assert.equal((await at(anna, { action: 'start' })).status, 200);
      while (st.phase !== 'playing') st = await p.state();
      assert.ok(st.seats.find(x => x && x.user === 'anna').cards[0].r, 'eigene Karten sichtbar');
      assert.deepEqual(st.seats.find(x => x && x.user === 'bernd').cards, [null, null], 'fremde Karten nicht');
      assert.equal(st.pot, 15);
      // Mitten in der Hand fragt das Fenster erst nach (409), gewechselt wird nur mit abort
      const busy = await at(anna, { action: 'game', game: 'durak' });
      assert.deepEqual([busy.status, busy.json.busy], [409, true]);
      const who = st.seats[st.turn.seat].user === 'anna' ? anna : bernd;
      assert.equal((await at(who === anna ? bernd : anna, { action: 'fold' })).status, 400, 'nicht dran');
      assert.equal((await at(who, { action: 'fold' })).status, 200);
      while (st.phase !== 'showdown') st = await p.state();
      const net = st.seats.find(x => x && x.user === 'anna').balance;
      assert.equal(Math.abs(net), 5, 'Small Blind verloren oder gewonnen');
      p.close();
      assert.equal((await api(anna, '/kartenspiele/kasse', undefined, 'GET')).json.kasse.balance, wallet + net);
      const stats = await api(anna, '/poker/statistik', undefined, 'GET');
      assert.equal(stats.json.me.hands, 1);
      assert.equal(stats.json.sessions[0].table, 'Freitagsrunde');
    });

    await step('Kartenspiele: Durak, UNO, Flip 7, Pilli Pilli am selben Tisch, Statistik und Profil', async () => {
      const { anna, bernd } = members;
      for (const [game, title, hand] of [['durak', 'Durak', 6], ['uno', 'UNO', 7], ['flip7', 'Flip 7', null], ['pilli', 'Pilli Pilli', 5]]) {
        const before = cardStream(anna);
        await before.state();
        assert.equal((await at(anna, { action: 'game', game })).status, 200, game);
        await before.switched();
        before.close();
        const live = cardStream(anna);
        let st = await live.state();
        assert.deepEqual(st.seats.filter(Boolean).map(x => x.user).sort(), ['anna', 'bernd'], game + ': alle sitzen noch');
        if (game === 'uno') assert.equal((await at(anna, { action: 'settings', target: 100 })).status, 200);
        for (const m of [anna, bernd]) assert.equal((await at(m, { action: 'ready' })).status, 200);
        assert.equal((await at(anna, { action: 'start' })).status, 200, game + ': der Gastgeber startet');
        while (st.phase !== 'playing') st = await live.state();
        if (hand) {
          // UNO: Liegt zu Beginn „Zieh zwei“ offen, zieht der erste Spieler gleich zwei Karten dazu
          const ok = game === 'uno' ? [hand, hand + 2] : [hand];
          assert.ok(ok.includes(st.hand.length), `${game}: eigene Karten (${st.hand.length})`);
          assert.ok(!JSON.stringify(st.seats).includes('"hand"'), 'fremde Karten nicht');
        } else assert.ok(st.f7 && st.f7.deck < 94, 'Flip 7: es wird offen gegeben');
        assert.equal((await at(anna, { action: 'quatsch' })).status, 400);
        assert.equal((await at(anna, { action: 'leave' })).status, 200);
        while (st.phase !== 'result') st = await live.state();
        if (game === 'durak') assert.equal(st.result.durak, st.result.order.find(o => o.user === 'anna').name);
        else assert.deepEqual(st.result.order.filter(o => o.won).map(o => o.user), ['bernd'], 'wer sitzen bleibt, gewinnt');
        live.close();
        assert.equal((await at(anna, { action: 'sit' })).status, 200);

        const stats = await api(bernd, `/${game}/statistik`, undefined, 'GET');
        assert.deepEqual([stats.json.me.games, stats.json.me.wins], [1, 1], game);
        assert.equal(stats.json.games[0].table, 'Freitagsrunde');
        const prof = (await anna.req('/nutzer/bernd')).text_;
        assert.match(prof, new RegExp(`href="/kartenspiele"><b>${title}</b>`));
      }
      // Zurück in die Lobby, umgestalten, Tisch schließen
      assert.equal((await at(anna, { action: 'game', game: 'lobby' })).status, 200);
      assert.match((await at(anna, { action: 'ready' })).json.error, /wählt der Gastgeber/);
      assert.equal((await at(anna, { action: 'design', felt: 'rot', back: 'karo', name: 'Samstagsrunde' })).status, 200);
      assert.deepEqual((await api(bernd, '/kartenspiele/tische', undefined, 'GET')).json.tables.map(t => [t.name, t.game]), [['Samstagsrunde', 'lobby']]);
      // Plätze und wer die nächste Runde startet, auch nach dem Aufmachen
      assert.equal((await at(anna, { action: 'design', seats: 6, next: 'auto' })).status, 200);
      const re = await api(bernd, `/kartenspiele/tisch/${cardTable}`, undefined, 'GET');
      assert.deepEqual([re.json.seats, re.json.next], [6, 'auto']);
      assert.match((await at(anna, { action: 'design', seats: 1 })).json.error, /weniger Plätze gehen nicht/);
      // Shop: Bernd kauft einen Saft, der steht dann an seinem Platz; Holzränder nur, wenn gekauft
      const sh = await api(bernd, '/kartenspiele/shop', undefined, 'GET');
      assert.ok(sh.json.items.some(x => x.id === 'korb' && !x.owned));
      const bought = await api(bernd, '/kartenspiele/shop', { action: 'buy', item: 'saft' });
      assert.deepEqual([bought.json.drink, bought.json.kasse.spent], ['saft', 50]);
      assert.match((await api(bernd, '/kartenspiele/shop', { action: 'buy', item: 'saft' })).json.error, /schon/);
      const seen = await api(anna, `/kartenspiele/tisch/${cardTable}`, undefined, 'GET');
      assert.ok(Object.values(seen.json.deco).some(d => d.drink && d.drink.id === 'saft'));
      assert.match((await at(anna, { action: 'design', wood: 'ebenholz' })).json.error, /erst im Shop/);
      // Leben am Tisch: Reaktionen mit Pause, Runde schmeißen, Schnell spielen bringt einen an den eigenen Tisch zurück
      assert.equal((await at(anna, { action: 'emote', emoji: '👏' })).status, 200);
      assert.match((await at(anna, { action: 'emote', emoji: '👏' })).json.error, /schnell/);
      assert.equal((await at(guest, { action: 'emote', emoji: '👏' })).status, 401);
      const round = await api(anna, '/kartenspiele/shop', { action: 'round', item: 'saft' });
      assert.equal(round.status, 200);
      assert.ok(Object.values((await api(bernd, `/kartenspiele/tisch/${cardTable}`, undefined, 'GET')).json.deco).every(d => d.drink.id === 'saft' && d.drink.from));
      assert.equal((await api(anna, '/kartenspiele/schnell', { game: 'uno' })).json.id, cardTable);
      assert.equal((await at(bernd, { action: 'close' })).status, 403);
      assert.equal((await at(anna, { action: 'close' })).status, 200);
      assert.equal((await at(anna, { action: 'sit' })).status, 404);
      const sql = new (require('node:sqlite').DatabaseSync)(path.join(DATA, 'site.db'));
      assert.ok(sql.prepare("SELECT s.ended_at FROM bj_sessions s JOIN users u ON u.id = s.user_id WHERE u.username = 'anna'").get().ended_at);
    });

    await step('Minesweeper: Fenster, Start und Ende auf dem Server, Bestzeiten und Profil', async () => {
      const { anna, bernd } = members;
      const home = (await guest.req('/', { top: true })).text_;
      assert.match(home, /<div class="startmenu"[\s\S]*href="\/minesweeper">💣 Minesweeper/);
      const page = (await guest.req('/minesweeper')).text_;
      assert.match(page, /src="\/static\/minesweeper\.js\?v=\w+"/, 'auch Gäste spielen');
      assert.match(page, /data-levels="[^"]*Fortgeschrittene/);
      assert.match((await guest.req('/minesweeper', { top: true })).text_, /class="window dwin/, 'direkt aufgerufen kommt der Desktop');
      assert.equal((await api(guest, '/minesweeper/start', { w: 9, h: 9, m: 10 })).status, 401);
      // Ende ohne Start zählt nicht, kaputte Spielfelder auch nicht
      assert.equal((await api(anna, '/minesweeper/ergebnis', { won: true, seconds: 1 })).status, 409);
      assert.equal((await api(anna, '/minesweeper/start', { w: 9, h: 9, m: 81 })).status, 400);
      assert.equal((await api(bernd, '/minesweeper/start', { w: 9, h: 9, m: 10 })).status, 200);
      let r = await api(bernd, '/minesweeper/ergebnis', { won: true, seconds: 12 });
      assert.equal(r.status, 200);
      assert.deepEqual([r.json.level, r.json.seconds, r.json.personal, r.json.record], ['beginner', 12, true, true]);
      await api(anna, '/minesweeper/start', { w: 16, h: 16, m: 40 });
      assert.equal((await api(anna, '/minesweeper/ergebnis', { won: false, seconds: 3 })).json.personal, false);
      // Anna ist schneller: Rekord der Seite, Bernd bekommt Bescheid
      await api(anna, '/minesweeper/start', { w: 9, h: 9, m: 10 });
      r = await api(anna, '/minesweeper/ergebnis', { won: true, seconds: 7 });
      assert.equal(r.json.record, true);
      const note = JSON.parse((await bernd.req('/api/benachrichtigungen')).text_);
      assert.ok(JSON.stringify(note).includes('Rekord in Minesweeper'), 'Benachrichtigung über den geknackten Rekord');
      const best = await api(anna, '/minesweeper/bestzeiten', undefined, 'GET');
      assert.deepEqual(best.json.levels.beginner.map(e => e.seconds), [7, 12]);
      assert.equal(best.json.levels.beginner[0].me, true);
      assert.deepEqual([best.json.mine.games, best.json.mine.wins, best.json.mine.best.beginner], [2, 1, 7]);
      assert.equal((await api(guest, '/minesweeper/bestzeiten', undefined, 'GET')).json.mine, null);
      // Browser dürfen keine eigenen Zahlen melden, das Profil zeigt die vom Server
      assert.equal((await api(anna, '/api/stats/minesweeper', { add: { Gewonnen: 100 } }, 'PATCH')).status, 404);
      const prof = (await bernd.req('/nutzer/anna')).text_;
      assert.match(prof, /href="\/minesweeper"><b>Minesweeper<\/b>[\s\S]*?Gewonnen<\/td><td class="num">1 \(50 %\)[\s\S]*?Bestzeit Anfänger<\/td><td class="num">7 s/);
      assert.match((await guest.req('/static/retro.js')).text_, /fit: function \(win, width, height, opts\)/);
    });

    await step('Kreuzworträtsel: Rätsel des Tages, Prüfen, Lösen, Bestenliste und Profil', async () => {
      const { anna, bernd } = members;
      const sql = new (require('node:sqlite').DatabaseSync)(path.join(DATA, 'site.db'));
      const home = (await guest.req('/', { top: true })).text_;
      assert.match(home, /<div class="startmenu"[\s\S]*href="\/kreuzwortraetsel">📰 Kreuzworträtsel/);
      const page = (await guest.req('/kreuzwortraetsel')).text_;
      assert.match(page, /src="\/static\/crossword\.js\?v=\w+"/);
      const data = JSON.parse(page.match(/<script type="application\/json" id="cw-data">([\s\S]*?)<\/script>/)[1]);
      assert.ok(data.puzzle.words.length >= 10);
      assert.ok(data.puzzle.words.every(w => !('answer' in w)), 'keine Lösungen im Browser');
      assert.match((await guest.req('/kreuzwortraetsel', { top: true })).text_, /class="window dwin/);
      // Lösung direkt aus der Datenbank
      const p = JSON.parse(sql.prepare('SELECT data FROM cw_puzzles WHERE day = ?').get(data.day).data);
      const sol = new Array(p.w * p.h).fill('#');
      for (const w of p.words) for (let i = 0; i < w.answer.length; i++) sol[(w.y + (w.dir === 'd' ? i : 0)) * p.w + w.x + (w.dir === 'a' ? i : 0)] = w.answer[i];
      const full = sol.join(''), empty = full.replace(/[A-Z]/g, '-');
      // Gäste: Prüfen und „gelöst?“ gehen, gespeichert wird nichts
      const k = full.search(/[A-Z]/), typo = empty.slice(0, k) + (full[k] === 'Q' ? 'X' : 'Q') + empty.slice(k + 1);
      assert.deepEqual((await api(guest, '/kreuzwortraetsel/pruefen', { day: data.day, letters: typo, scope: 'all' })).json.wrong, [k]);
      assert.equal((await api(guest, '/kreuzwortraetsel/speichern', { day: data.day, letters: full, seconds: 10 })).json.solved, true);
      assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM cw_progress').get().n, 0);
      assert.equal((await api(guest, '/kreuzwortraetsel/pruefen', { day: '2020-01-01', letters: typo, scope: 'all' })).status, 404);
      assert.equal((await api(guest, '/kreuzwortraetsel/aufdecken', { day: data.day, scope: 'alles' })).status, 400);
      // Anna speichert zwischendurch, deckt ein Wort auf und löst; Bernd löst ohne Hilfe
      assert.equal((await api(anna, '/kreuzwortraetsel/speichern', { day: data.day, letters: typo, seconds: 20 })).json.solved, false);
      const w = p.words[0];
      const rev = await api(anna, '/kreuzwortraetsel/aufdecken', { day: data.day, scope: 'word', cell: w.y * p.w + w.x, dir: w.dir });
      assert.equal(rev.json.cells.map(c => c[1]).join(''), w.answer);
      const again = JSON.parse((await anna.req('/kreuzwortraetsel')).text_.match(/id="cw-data">([\s\S]*?)<\/script>/)[1]);
      assert.equal(again.progress.letters, typo, 'Stand kommt beim nächsten Öffnen zurück');
      assert.equal((await api(anna, '/kreuzwortraetsel/speichern', { day: data.day, letters: full, seconds: 90 })).json.help, true);
      const r = await api(bernd, '/kreuzwortraetsel/speichern', { day: data.day, letters: full, seconds: 300 });
      assert.deepEqual([r.json.solved, r.json.help, r.json.rank.place, r.json.rank.of], [true, false, 1, 2]);
      const best = await api(anna, '/kreuzwortraetsel/bestenliste', undefined, 'GET');
      assert.deepEqual(best.json.list.map(e => [e.help, e.me]), [[false, false], [true, true]]);
      assert.equal(best.json.mine.solved, 1);
      const arch = await api(anna, '/kreuzwortraetsel/archiv', undefined, 'GET');
      assert.deepEqual(arch.json.days[0], { day: data.day, state: 'solved' });
      // Browser dürfen keine eigenen Zahlen melden, das Profil zeigt die vom Server
      assert.equal((await api(anna, '/api/stats/kreuzwortraetsel', { add: { Gelöst: 100 } }, 'PATCH')).status, 404);
      const prof = (await anna.req('/nutzer/bernd')).text_;
      assert.match(prof, /href="\/kreuzwortraetsel"><b>Kreuzworträtsel<\/b>[\s\S]*?Gelöst<\/td><td class="num">1[\s\S]*?Aktuelle Serie<\/td><td class="num">1 Tag/);
      assert.match((await admin.req('/admin/settings')).text_, /name="cw_words"/);
    });

    await step('Sudoku: drei Stufen am Tag, Prüfen, Lösen, Bestenliste und Profil', async () => {
      const { anna, bernd } = members;
      const sql = new (require('node:sqlite').DatabaseSync)(path.join(DATA, 'site.db'));
      const home = (await guest.req('/', { top: true })).text_;
      assert.match(home, /<div class="startmenu"[\s\S]*href="\/sudoku">🔢 Sudoku/);
      const page = (await guest.req('/sudoku')).text_;
      assert.match(page, /src="\/static\/sudoku\.js\?v=\w+"/);
      const data = JSON.parse(page.match(/<script type="application\/json" id="sd-data">([\s\S]*?)<\/script>/)[1]);
      assert.deepEqual(Object.keys(data.levels), ['leicht', 'mittel', 'schwer']);
      assert.ok(!page.includes('solution'), 'keine Lösungen im Browser');
      assert.match((await guest.req('/sudoku', { top: true })).text_, /class="window dwin/);
      // Lösung direkt aus der Datenbank
      const sol = sql.prepare('SELECT solution FROM sd_puzzles WHERE day = ? AND level = ?').get(data.day, 'leicht').solution;
      const givens = data.levels.leicht.givens, k = givens.indexOf('-');
      const typo = givens.slice(0, k) + (sol[k] === '1' ? '2' : '1') + givens.slice(k + 1);
      // Gäste: Prüfen und „gelöst?“ gehen, gespeichert wird nichts
      assert.deepEqual((await api(guest, '/sudoku/pruefen', { day: data.day, level: 'leicht', digits: typo, scope: 'all' })).json.wrong, [k]);
      assert.equal((await api(guest, '/sudoku/speichern', { day: data.day, level: 'leicht', digits: sol, seconds: 10 })).json.solved, true);
      assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM sd_progress').get().n, 0);
      assert.equal((await api(guest, '/sudoku/pruefen', { day: '2020-01-01', level: 'leicht', digits: typo, scope: 'all' })).status, 404);
      assert.equal((await api(guest, '/sudoku/pruefen', { day: data.day, level: 'extrem', digits: typo, scope: 'all' })).status, 400);
      assert.equal((await api(guest, '/sudoku/aufdecken', { day: data.day, level: 'leicht', scope: 'alles' })).status, 400);
      // Anna speichert zwischendurch, deckt ein Feld auf und löst; Bernd löst ohne Hilfe
      assert.equal((await api(anna, '/sudoku/speichern', { day: data.day, level: 'leicht', digits: typo, seconds: 20 })).json.solved, false);
      assert.deepEqual((await api(anna, '/sudoku/aufdecken', { day: data.day, level: 'leicht', scope: 'cell', cell: k })).json.cells, [[k, sol[k]]]);
      const again = JSON.parse((await anna.req('/sudoku')).text_.match(/id="sd-data">([\s\S]*?)<\/script>/)[1]);
      assert.equal(again.levels.leicht.progress.digits, typo, 'Stand kommt beim nächsten Öffnen zurück');
      assert.equal(again.levels.mittel.progress, null);
      assert.equal((await api(anna, '/sudoku/speichern', { day: data.day, level: 'leicht', digits: sol, seconds: 90 })).json.help, true);
      const r = await api(bernd, '/sudoku/speichern', { day: data.day, level: 'leicht', digits: sol, seconds: 300 });
      assert.deepEqual([r.json.solved, r.json.help, r.json.rank.place, r.json.rank.of], [true, false, 1, 2]);
      const best = await api(anna, '/sudoku/bestenliste?level=leicht', undefined, 'GET');
      assert.deepEqual(best.json.list.map(e => [e.help, e.me]), [[false, false], [true, true]]);
      assert.equal(best.json.mine.solved, 1);
      const arch = await api(anna, '/sudoku/archiv', undefined, 'GET');
      assert.deepEqual(arch.json.days[0], { day: data.day, state: { leicht: 'solved' } });
      // Browser dürfen keine eigenen Zahlen melden, das Profil zeigt die vom Server
      assert.equal((await api(anna, '/api/stats/sudoku', { add: { Gelöst: 100 } }, 'PATCH')).status, 404);
      const prof = (await anna.req('/nutzer/bernd')).text_;
      assert.match(prof, /href="\/sudoku"><b>Sudoku<\/b>[\s\S]*?Gelöst<\/td><td class="num">1[\s\S]*?Bestzeit Leicht<\/td><td class="num">5:00/);
      assert.match((await admin.req('/admin/settings')).text_, /action="\/admin\/settings\/sudoku-reset"/);
    });

    await step('Quiz: Raum, Gast mit Namen, Live-Verbindung, Wertung, Profil und Admin', async () => {
      const { anna, bernd } = members;
      const home = (await guest.req('/', { top: true })).text_;
      assert.match(home, /<div class="startmenu"[\s\S]*href="\/quiz">❓ Quiz/);
      const oma = browser();
      assert.match((await oma.req('/quiz')).text_, /quiz\.js/, 'auch Gäste bekommen das Quiz');
      const made = await api(anna, '/quiz/raeume', { name: 'Freitagsquiz' });
      assert.equal(made.status, 200);
      const code = made.json.code;
      assert.match(code, /^[A-Z0-9]{4}$/);
      assert.deepEqual((await api(bernd, '/quiz/raeume', undefined, 'GET')).json.rooms.map(r => r.name), ['Freitagsquiz']);
      assert.match((await oma.req('/quiz/' + code)).text_, new RegExp('data-code="' + code + '"'), 'Einladungslink');
      assert.equal((await api(oma, `/quiz/${code}/info`, undefined, 'GET')).json.joined, false);
      assert.equal((await api(oma, `/quiz/${code}/beitreten`, { name: '' })).status, 400);
      assert.equal((await api(oma, `/quiz/${code}/beitreten`, { name: 'Oma Gerda', emoji: '🦉' })).status, 200);
      assert.ok(/^[a-f0-9]{32}$/.test(oma.jar.get('quiz')), 'Gast-Cookie');
      assert.equal((await api(oma, `/quiz/${code}/info`, undefined, 'GET')).json.joined, true);
      assert.equal((await api(bernd, `/quiz/${code}/beitreten`, {})).status, 200);
      assert.equal((await api(guest, `/quiz/${code}/beitreten`, { name: 'Oma gerda' })).status, 400, 'Name schon vergeben');
      assert.match((await oma.req(`/quiz/${code}/qr.svg`)).text_, /^<svg/);

      const listen = b => {
        const ctrl = new AbortController(), states = [];
        let buf = '', wake = null;
        fetch(`${BASE}/quiz/${code}/events`, { headers: { cookie: [...b.jar].map(([k, v]) => `${k}=${v}`).join('; '), 'user-agent': UA }, signal: ctrl.signal }).then(async res => {
          const reader = res.body.getReader();
          for (;;) {
            const { value, done } = await reader.read();
            if (done) return;
            buf += Buffer.from(value).toString();
            let i;
            while ((i = buf.indexOf('\n\n')) >= 0) {
              const ev = buf.slice(0, i); buf = buf.slice(i + 2);
              const m = ev.match(/^event: state\ndata: (.*)$/m);
              if (m) { states.push(JSON.parse(m[1])); if (wake) wake(); }
            }
          }
        }).catch(() => {});
        const until = (pred, ms = 3000) => new Promise((resolve, reject) => {
          const t = setTimeout(() => reject(new Error('Kein passender Stand: ' + JSON.stringify(states.at(-1)))), ms);
          const check = () => { const s = states.slice().reverse().find(pred); if (s) { clearTimeout(t); wake = null; resolve(s); } else wake = check; };
          check();
        });
        return { until, close: () => ctrl.abort() };
      };
      assert.equal((await fetch(`${BASE}/quiz/${code}/events`, { headers: { 'user-agent': UA } })).status, 403, 'nicht dabei');
      const host = listen(anna), player = listen(oma);
      let hs = await host.until(s => s.players.length === 2);
      assert.equal(hs.isHost, true);
      assert.ok(hs.players.some(p => p.name === 'Oma Gerda' && p.guest && p.emoji === '🦉'));
      assert.equal((await api(oma, `/quiz/${code}`, { action: 'start' })).status, 400, 'Spieler können nicht steuern');
      assert.equal((await api(anna, `/quiz/${code}`, { action: 'start' })).status, 200);
      assert.equal((await api(anna, `/quiz/${code}`, { action: 'edit', index: 0, q: { type: 'mc', text: 'Nevermind?', options: ['Pearl Jam', 'Nirvana', 'Blur', 'Oasis'], correct: 1 } })).status, 200);
      assert.equal((await api(anna, `/quiz/${code}`, { action: 'open' })).status, 200);
      const ps = await player.until(s => s.phase === 'open');
      assert.equal(ps.q.text, 'Nevermind?');
      assert.equal(JSON.stringify(ps).includes('"correct"'), false, 'Lösung bleibt auf dem Server');
      assert.equal(ps.questions, undefined);
      assert.equal((await api(oma, `/quiz/${code}`, { action: 'answer', value: 0 })).status, 200);
      assert.equal((await api(bernd, `/quiz/${code}`, { action: 'answer', value: 1 })).status, 200);
      hs = await host.until(s => s.inputs && Object.values(s.inputs).filter(v => v !== null).length === 2);
      assert.equal((await api(anna, `/quiz/${code}`, { action: 'reveal' })).status, 200);
      const rv = await player.until(s => s.phase === 'reveal');
      assert.equal(rv.result.correct.text, 'Nirvana');
      assert.deepEqual(rv.players.map(p => [p.guest, p.score]), [[false, 100], [true, -50]]);
      assert.equal((await api(anna, `/quiz/${code}`, { action: 'give', pid: 'all', points: 3 })).status, 200);
      assert.equal((await api(anna, `/quiz/${code}`, { action: 'end' })).status, 200);
      const end = await player.until(s => s.phase === 'end');
      assert.deepEqual(end.awards.places.map(p => p.place), [1, 2]);
      host.close(); player.close();
      const prof = (await anna.req('/nutzer/bernd')).text_;
      assert.match(prof, /href="\/quiz"><b>Quiz<\/b>[\s\S]*Gespielt<\/td><td class="num">1</);
      assert.match((await admin.req('/admin/quiz')).text_, /<td>Freitagsquiz<\/td>/);
      // Quiz im Konto speichern, teilen und aus der Liste laden
      assert.equal((await api(oma, '/quiz/sammlung', { code, title: 'Omas' })).status, 403, 'Gäste speichern nur als Datei');
      assert.equal((await api(bernd, '/quiz/sammlung', { code, title: 'Geklaut' })).status, 403, 'nur der Spielleiter');
      const saved = await api(anna, '/quiz/sammlung', { code, title: 'Freitagsquiz 90er' });
      assert.equal(saved.status, 200);
      assert.deepEqual((await api(bernd, '/quiz/sammlung', undefined, 'GET')).json.quizzes, [], 'privat');
      assert.equal((await api(anna, '/quiz/sammlung', { code, title: 'Freitagsquiz 90er', shared: true })).json.id, saved.json.id);
      const lib = (await api(bernd, '/quiz/sammlung', undefined, 'GET')).json.quizzes;
      assert.deepEqual(lib.map(q => [q.title, q.questions, q.owner, q.mine]), [['Freitagsquiz 90er', 1, 'anna', false]]);
      const room2 = (await api(bernd, '/quiz/raeume', { name: 'Berndraum' })).json.code;
      assert.equal((await api(bernd, `/quiz/sammlung/${saved.json.id}/laden`, { code: room2 })).status, 200);
      assert.equal((await api(bernd, `/quiz/sammlung/${saved.json.id}/loeschen`, {})).status, 403);
      assert.match((await anna.req('/nutzer/anna')).text_, /Quizze erstellt<\/td><td class="num">1</);
      assert.equal((await api(anna, `/quiz/sammlung/${saved.json.id}/loeschen`, {})).status, 200);
      assert.equal((await api(bernd, `/quiz/${room2}`, { action: 'close' })).status, 200);
      assert.equal((await api(anna, `/quiz/${code}`, { action: 'close' })).status, 200);
      assert.equal((await api(oma, `/quiz/${code}/info`, undefined, 'GET')).status, 404);
    });

    await step('Werwolf: Dorf mit Gästen, Rollen geheim, Nacht, Abstimmung, Profil und Admin', async () => {
      const { anna, bernd } = members;
      const home = (await guest.req('/', { top: true })).text_;
      assert.match(home, /<div class="startmenu"[\s\S]*href="\/werwolf">🐺 Werwolf/);
      const oma = browser(), opa = browser();
      assert.match((await oma.req('/werwolf')).text_, /werwolf\.js/, 'auch Gäste bekommen Werwolf');
      await opa.req('/werwolf/');
      const made = await api(anna, '/werwolf/raeume', { name: 'Wolfsbach', mode: 'lokal' });
      assert.equal(made.status, 200);
      const code = made.json.code;
      assert.deepEqual((await api(bernd, '/werwolf/raeume', undefined, 'GET')).json.rooms.map(r => [r.name, r.mode]), [['Wolfsbach', 'lokal']]);
      assert.match((await oma.req('/werwolf/' + code)).text_, new RegExp('data-code="' + code + '"'), 'Einladungslink');
      assert.equal((await api(oma, `/werwolf/${code}/beitreten`, { name: '' })).status, 400);
      assert.equal((await api(oma, `/werwolf/${code}/beitreten`, { name: 'Oma Gerda', emoji: '🦉' })).status, 200);
      assert.ok(/^[a-f0-9]{32}$/.test(oma.jar.get('werwolf')), 'Gast-Cookie');
      assert.equal((await api(opa, `/werwolf/${code}/beitreten`, { name: 'Opa Kurt' })).status, 200);
      assert.equal((await api(bernd, `/werwolf/${code}/beitreten`, {})).status, 200);
      assert.match((await oma.req(`/werwolf/${code}/qr.svg`)).text_, /^<svg/);
      assert.equal((await fetch(`${BASE}/werwolf/${code}/events`, { headers: { 'user-agent': UA } })).status, 403, 'nicht dabei');

      const listen = b => {
        const ctrl = new AbortController(), states = [];
        let buf = '', wake = null;
        fetch(`${BASE}/werwolf/${code}/events`, { headers: { cookie: [...b.jar].map(([k, v]) => `${k}=${v}`).join('; '), 'user-agent': UA }, signal: ctrl.signal }).then(async res => {
          const reader = res.body.getReader();
          for (;;) {
            const { value, done } = await reader.read();
            if (done) return;
            buf += Buffer.from(value).toString();
            let i;
            while ((i = buf.indexOf('\n\n')) >= 0) {
              const ev = buf.slice(0, i); buf = buf.slice(i + 2);
              const m = ev.match(/^event: state\ndata: (.*)$/m);
              if (m) { states.push(JSON.parse(m[1])); if (wake) wake(); }
            }
          }
        }).catch(() => {});
        const until = (pred, ms = 3000) => new Promise((resolve, reject) => {
          const t = setTimeout(() => reject(new Error('Kein passender Stand: ' + JSON.stringify(states.at(-1)))), ms);
          const check = () => { const s = states.slice().reverse().find(pred); if (s) { clearTimeout(t); wake = null; resolve(s); } else wake = check; };
          check();
        });
        return { until, close: () => ctrl.abort() };
      };
      const all = [anna, bernd, oma, opa];
      const ears = all.map(listen);
      await ears[0].until(s => s.players.length === 4);
      assert.equal((await api(oma, `/werwolf/${code}`, { action: 'start' })).status, 403, 'nur der Gastgeber startet');
      assert.equal((await api(anna, `/werwolf/${code}`, { action: 'start' })).status, 200);
      let st = await Promise.all(ears.map(e => e.until(s => s.phase === 'roles')));
      assert.deepEqual(st.map(s => s.players.filter(p => p.role).length), [1, 1, 1, 1], 'jeder sieht nur seine eigene Rolle');
      const role = st.map(s => s.mine.role);
      assert.deepEqual(role.slice().sort(), ['dorf', 'dorf', 'seherin', 'werwolf']);
      for (const b of all) assert.equal((await api(b, `/werwolf/${code}`, { action: 'seen' })).status, 200);
      st = await Promise.all(ears.map(e => e.until(s => s.phase === 'night')));
      const wolf = role.indexOf('werwolf');
      const pidOf = i => st[i].me;
      const victim = [0, 1, 2, 3].find(i => i !== wolf);
      for (let i = 0; i < 4; i++) {
        const target = i === wolf ? pidOf(victim) : pidOf([0, 1, 2, 3].find(j => j !== i));
        assert.equal((await api(all[i], `/werwolf/${code}`, { action: 'pick', target })).status, 200);
        assert.equal((await api(all[i], `/werwolf/${code}`, { action: 'done' })).status, 200);
      }
      const dayState = await ears[wolf].until(s => s.phase === 'day');
      assert.deepEqual(dayState.news, [{ pid: pidOf(victim), cause: 'wolf' }]);
      assert.equal(dayState.players.find(p => p.pid === pidOf(victim)).role, role[victim], 'Tote zeigen ihre Rolle');
      assert.equal((await api(anna, `/werwolf/${code}`, { action: 'chat', text: 'Hallo' })).status, 400, 'lokal wird am Tisch geredet');
      assert.equal((await api(anna, `/werwolf/${code}`, { action: 'skip' })).status, 200, 'Gastgeber startet die Abstimmung');
      await ears[wolf].until(s => s.phase === 'vote');
      for (let i = 0; i < 4; i++) {
        if (i === victim) continue;
        const target = i === wolf ? pidOf([0, 1, 2, 3].find(j => j !== wolf && j !== victim)) : pidOf(wolf);
        assert.equal((await api(all[i], `/werwolf/${code}`, { action: 'pick', target })).status, 200);
        assert.equal((await api(all[i], `/werwolf/${code}`, { action: 'done' })).status, 200);
      }
      const end = await ears[victim].until(s => s.phase === 'end');
      assert.equal(end.winner, 'dorf');
      assert.ok(end.players.every(p => p.role), 'am Ende sind alle Rollen offen');
      ears.forEach(e => e.close());
      const prof = (await anna.req('/nutzer/bernd')).text_;
      assert.match(prof, /href="\/werwolf"><b>Werwolf<\/b>[\s\S]*?Gespielt<\/td><td class="num">1</);
      assert.equal((await api(bernd, '/api/stats/werwolf', { add: { Gewonnen: 100 } }, 'PATCH')).status, 404, 'Browser melden keine eigenen Zahlen');
      assert.match((await admin.req('/admin/werwolf')).text_, /<b>Wolfsbach<\/b>/);
      assert.equal((await api(oma, `/werwolf/${code}`, { action: 'close' })).status, 403);
      assert.equal((await api(anna, `/werwolf/${code}`, { action: 'close' })).status, 200);
      assert.equal((await api(oma, `/werwolf/${code}/info`, undefined, 'GET')).status, 404);
    });

    await step('Changelog im Startmenü', async () => {
      const home = (await guest.req('/', { top: true })).text_;
      assert.match(home, /<div class="startmenu"[\s\S]*href="\/changelog"/);
      assert.doesNotMatch(home.split('<div class="startmenu"')[0], /\/changelog/);
      const r = await guest.req('/changelog');
      assert.equal(r.status, 200);
      assert.match(r.text_, /Eröffnung/);
    });

    await step('Startseite: Titel der Seite, Kurzfassung des letzten Updates, Schnellstart', async () => {
      const cl = require('../src/changelog');
      // Kurzfassung: oberster Eintrag, Markdown raus, „z. B.“ beendet keinen Satz, Punkte ohne Stichwort nehmen ihren Anfang
      const sample = cl.parse('# Changelog\n\n## 1.2.2027 – Neues *Spiel* und [mehr](/x)\n\n- **Erstens:** Das geht z. B. so. Danach mehr.\n'
        + '- **Zweitens**: Text\n  weiter\n* Ohne Stichwort einfach los. Rest.\n\n## 1.1.2027 – Alt\n\n- **Alt:** nicht dabei\n');
      assert.deepEqual(sample, { date: '1.2.2027', title: 'Neues Spiel und mehr', items: [
        { label: 'Erstens', text: 'Das geht z. B. so.' }, { label: 'Zweitens', text: 'Text weiter' },
        { label: 'Ohne Stichwort einfach los', text: 'Ohne Stichwort einfach los.' }] });
      assert.deepEqual(cl.parse('## Ohne Datum\n\n- **Punkt:** Text'), { date: '', title: 'Ohne Datum', items: [{ label: 'Punkt', text: 'Text' }] });
      assert.equal(cl.parse('Noch nichts'), null);

      // Auf der Startseite: der oberste Eintrag aus CHANGELOG.md, höchstens acht Stichworte, Link zum Changelog
      const u = cl.latest();
      assert.equal(u.date, fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8').match(/^## (\S+)/m)[1]);
      assert.ok(u.title && u.items.length, 'Titel und Punkte gelesen');
      const html = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&#34;').replace(/'/g, '&#39;');
      const home = (await guest.req('/')).text_;
      const box = home.slice(home.indexOf('🆕 Neu auf der Seite'), home.indexOf('</fieldset>', home.indexOf('🆕 Neu auf der Seite')));
      assert.ok(box.includes('Update vom ' + u.date), 'Datum');
      assert.ok(box.includes('<b>' + html(u.title) + '</b>'), 'Titel');
      assert.ok(box.includes('>' + html(u.items[0].label) + '</li>'), 'erstes Stichwort');
      assert.equal((box.match(/<li class="tag"/g) || []).length, Math.min(8, u.items.length));
      if (u.items.length > 8) assert.ok(box.includes(`und ${u.items.length - 8} weitere`));
      assert.match(box, /href="\/changelog">📋 Alles im Changelog/);
      // Kopf mit Titel der Seite, Statusleiste für den Fensterrand
      assert.match(home, /<header class="home-hero">[\s\S]*<h1>Meine Seite<\/h1>/);
      assert.match(home, /class="statusbar home-status"><span>👤 Du bist als Gast hier/);
      assert.match((await members.anna.req('/')).text_, /class="statusbar home-status"><span>👤 Angemeldet als /);

      // Schnellstart: die Programme aus dem Startmenü, Ausgeblendetes fehlt auch hier
      const apps = h => [...h.slice(h.indexOf('<nav class="home-apps'), h.indexOf('</nav>', h.indexOf('<nav class="home-apps'))).matchAll(/class="home-app" href="([^"]+)"/g)].map(m => m[1]);
      assert.deepEqual(apps(home), ['/kartenspiele', '/haustier/', '/paint', '/musik', '/minesweeper', '/kreuzwortraetsel', '/sudoku', '/quiz', '/werwolf', '/forum']);
      const sql = new (require('node:sqlite').DatabaseSync)(path.join(DATA, 'site.db'), { timeout: 5000 });
      const before = sql.prepare("SELECT value FROM settings WHERE key = 'nav_hidden'").get().value;
      sql.prepare("UPDATE settings SET value = 'paint,board' WHERE key = 'nav_hidden'").run();
      try {
        const hidden = (await guest.req('/')).text_;
        assert.deepEqual(apps(hidden), ['/kartenspiele', '/haustier/', '/musik', '/minesweeper', '/kreuzwortraetsel', '/sudoku', '/quiz', '/werwolf']);
        assert.doesNotMatch(hidden, /💬 Neu im Forum/);
      } finally {
        sql.prepare("UPDATE settings SET value = ? WHERE key = 'nav_hidden'").run(before);
        sql.close();
      }
    });

    await step('Datenschutzseite im Startmenü zeigt echten Code und Bilder', async () => {
      const home = (await guest.req('/', { top: true })).text_;
      assert.match(home, /<div class="startmenu"[\s\S]*href="\/changelog"[\s\S]*href="\/datenschutz"/);
      const r = await guest.req('/datenschutz');
      assert.equal(r.status, 200);
      assert.doesNotMatch(r.text_, /nicht gefunden/, 'jeder Code-Anker wird im Quelltext gefunden');
      const { snippets } = require('../src/privacy');
      const all = Object.values(snippets());
      assert.equal((r.text_.match(/<figure class="code-snippet">/g) || []).length, all.length, 'jeder Ausschnitt steht auf der Seite');
      assert.ok(all.every(c => !c.missing));
      assert.match(r.text_, /function visitorHash\(req\)/);
      assert.match(r.text_, /nach <b>365 Tagen<\/b>/);
      const shots = [...r.text_.matchAll(/src="(\/static\/datenschutz\/[\w-]+\.png\?v=\w+)"/g)].map(m => m[1].replace(/&amp;/g, '&'));
      assert.ok(shots.length >= 5, 'Screenshots eingebunden');
      for (const s of shots) assert.equal((await guest.req(s)).status, 200, s);
    });

    await step('Darstellung: Knopf neben der Uhr, Skript in jeder Seite', async () => {
      const home = (await guest.req('/', { top: true })).text_;
      assert.match(home, /<div class="tray">\s*<button[^>]*id="displaybtn"[\s\S]*id="clock"/);
      const panel = home.slice(home.indexOf('id="displaypanel"'));
      for (const re of [/data-tab="hintergrund"/, /name="bg" value="bild"/, /type="file" name="bild"/, /name="desktop"/, /data-scheme="nacht"/,
        /data-preset="Matrix"/, /name="titleFrom"/, /<option value="comic">/, /name="design"/, /<option value="xp">/, /data-schemes="xp"/, /data-xp="oliv"/,
        /type="range" name="scale" min="75" max="200" step="5"/, /name="scaleAll"/, /name="marquee" value="aus"/,
        /name="widgets"/, /name="css"/, /data-act="apply"/]) assert.match(panel, re);
      const data = JSON.parse(home.match(/<script type="application\/json" id="darstellung-daten">([^<]*)<\/script>/)[1]);
      assert.equal(data.presets.Matrix.desktop, '#001100');
      assert.match(data.fonts.comic.stack, /Comic Sans/);
      for (const [url, opts] of [['/', { top: true }], ['/blog', {}], ['/admin', null]]) {
        const page = (await (opts ? guest.req(url, opts) : admin.req(url))).text_;
        assert.match(page, /<head>[\s\S]*<script src="\/static\/display\.js\?v=\w+"><\/script>[\s\S]*<\/head>/, url);
      }
      // Gäste können die Darstellung nicht am Konto speichern
      assert.doesNotMatch(panel, /name="sync"/);
      // Die Seitenverwaltung ist ein Fenster auf dem Desktop, Taskleiste mit 🖥️ inklusive
      const shell = (await admin.req('/admin', { top: true })).text_;
      assert.match(shell, /id="displaybtn"/, 'auch in der Seitenverwaltung');
      assert.match(shell, /<title>Seitenverwaltung/);
      assert.match(shell.slice(shell.indexOf('id="displaypanel"')), /name="sync"/, 'mit Konto: auf allen Geräten');
      assert.match(shell, /<iframe src="\/admin"/);
      const js = await guest.req('/static/display.js');
      assert.equal(js.status, 200);
      assert.match(js.text_, /'darstellung'/);
      assert.doesNotMatch(js.text_, /fetch\(|XMLHttpRequest|sendBeacon|WebSocket/, 'Darstellung bleibt im Browser');
    });

    await step('Paint: malen ohne Konto, speichern mit Konto, Sichtbarkeit und Galerie', async () => {
      const { png } = require('./png');
      const desk = (await guest.req('/', { top: true })).text_;
      // Galerie steht unter Dokumente, Paint unter Spiele und Apps
      assert.match(desk, /<div class="startmenu"[\s\S]*📂 Dokumente<\/button><div class="submenu">[\s\S]*href="\/galerie"[\s\S]*🎮 Spiele und Apps[\s\S]*href="\/paint"/);
      const page = await guest.req('/paint');
      assert.equal(page.status, 200);
      assert.match(page.text_, /id="paint"/);
      assert.match(page.headers.get('content-security-policy'), /img-src [^;]*blob:/);
      for (const f of ['paint-core.js', 'paint.js']) {
        const m = page.text_.match(new RegExp(`src="(/static/${f.replace('.', '\\.')}\\?v=\\w+)"`));
        assert.ok(m, f + ' mit Versionsnummer');
        assert.equal((await guest.req(m[1])).status, 200);
      }
      assert.equal((await guest.req('/paint/bilder')).status, 401, 'Meine Bilder nur mit Konto');
      assert.equal((await guest.req('/paint/bilder?tab=gallery')).status, 200);

      let t = await admin.csrf('/admin/users');
      for (const name of ['paula', 'pit']) assert.equal((await admin.form('/admin/users/create', { _csrf: t, username: name, password: 'passwort123' })).status, 302);
      const paula = browser(), pit = browser();
      for (const [b, name] of [[paula, 'paula'], [pit, 'pit']]) {
        // Eigene Adresse: die vielen Anmeldungen im Test sollen nicht an die Sperre für zu viele Versuche stoßen
        const tk = await b.csrf();
        const r = await b.req('/login', { method: 'POST', body: new URLSearchParams({ _csrf: tk, username: name, password: 'passwort123' }), headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': '10.9.0.' + name.length } });
        assert.equal(r.status, 302);
      }
      const send = (b, url, image, fields = {}, token = true) => {
        const fd = new FormData();
        for (const [k, v] of Object.entries(fields)) fd.append(k, v);
        fd.append('image', new Blob([image], { type: 'image/png' }), 'bild.png');
        fd.append('thumb', new Blob([png(2, 2)], { type: 'image/png' }), 'vorschau.png');
        return b.req(url, { method: 'POST', body: fd, headers: token ? { 'x-csrf-token': b.jar.get('csrf'), accept: 'application/json' } : { accept: 'application/json' } });
      };
      const json = async (b, url, body) => { const r = await b.req(url, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', 'x-csrf-token': b.jar.get('csrf') } }); return { status: r.status, json: JSON.parse(r.text_ || 'null') }; };
      const files = () => fs.readdirSync(path.join(DATA, 'paint')).sort();

      assert.equal((await send(paula, '/paint/bilder', png(8, 6), { title: 'x' }, false)).status, 403, 'ohne Formular-Token');
      assert.equal((await send(paula, '/paint/bilder', Buffer.from('kein Bild'), { title: 'x' })).status, 400);
      const made = await send(paula, '/paint/bilder', png(8, 6, 'GPS\0Breite 52,5'), { title: 'Sonne <b>', visibility: 'private' });
      assert.equal(made.status, 200, made.text_);
      const art = JSON.parse(made.text_).artwork;
      assert.equal(art.title, 'Sonne <b>');
      assert.deepEqual([art.w, art.h, art.visibility, art.mine], [8, 6, 'private', true]);
      assert.equal(files().length, 2, 'Bild und Vorschau');
      const own = await paula.req(`/paint/bild/${art.id}.png`);
      assert.equal(own.status, 200);
      assert.equal(own.headers.get('content-type'), 'image/png');
      assert.doesNotMatch(own.text_, /GPS/, 'versteckte Angaben entfernt');
      assert.equal((await guest.req(`/paint/bild/${art.id}.png`)).status, 404, 'privat');
      assert.equal((await pit.req(`/paint/bild/${art.id}/vorschau.png`)).status, 404, 'privat');
      assert.equal((await pit.req(`/paint/bilder/${art.id}`)).status, 404);
      assert.equal((await json(pit, `/paint/bild/${art.id}`, { title: 'Meins' })).status, 404, 'Fremde dürfen nicht umbenennen');
      assert.equal((await json(pit, `/paint/bild/${art.id}/loeschen`, {})).status, 404);
      assert.equal((await send(pit, `/paint/bild/${art.id}/bild`, png(8, 6))).status, 404, 'Fremde dürfen nicht übermalen');
      const mine = JSON.parse((await paula.req('/paint/bilder')).text_);
      assert.equal(mine.artworks.length, 1);
      assert.ok(mine.quota.total > 0);

      assert.equal((await json(paula, `/paint/bild/${art.id}`, { visibility: 'members' })).status, 200);
      assert.equal((await pit.req(`/paint/bild/${art.id}.png`)).status, 200, 'für Mitglieder');
      assert.equal((await guest.req(`/paint/bild/${art.id}.png`)).status, 404);
      const pitGallery = (await pit.req('/galerie')).text_;
      assert.match(pitGallery, /Sonne &lt;b&gt;/);
      assert.doesNotMatch((await guest.req('/galerie')).text_, /Sonne/);

      // Freigabe eingeschaltet: öffentlich erst, wenn der Admin es freigibt
      t = await admin.csrf('/admin/paint');
      assert.equal((await admin.form('/admin/paint', { _csrf: t, paint_enabled: '1', paint_guests: '1', paint_gallery: '1', paint_moderation: '1', paint_save: 'members', paint_quota_mb: '50', paint_max_w: '2000', paint_max_h: '2000' })).status, 302);
      const pub = await json(paula, `/paint/bild/${art.id}`, { visibility: 'public' });
      assert.equal(pub.json.artwork.pending, true);
      assert.match(pub.json.note, /freigibt/);
      assert.equal((await guest.req(`/paint/bild/${art.id}.png`)).status, 404, 'wartet auf Freigabe');
      assert.match((await admin.req('/admin/paint')).text_, /wartet auf Freigabe[\s\S]*Freigeben/);
      assert.equal((await admin.form(`/admin/paint/${art.id}/freigeben`, { _csrf: t })).status, 302);
      assert.equal((await guest.req(`/paint/bild/${art.id}.png`)).status, 200);
      assert.match((await guest.req('/galerie')).text_, /Sonne &lt;b&gt;/);
      const item = await guest.req(`/galerie/${art.id}`);
      assert.match(item.text_, /href="\/paint\?bild=\d+"/);
      assert.match(item.text_, /href="\/nutzer\/paula"/);
      assert.match((await pit.req('/nutzer/paula')).text_, /id="bilder"[\s\S]*Sonne &lt;b&gt;/, 'Bilder im Profil');
      assert.match((await guest.req(`/paint/bild/${art.id}.png?download=1`)).headers.get('content-disposition'), /attachment/);

      // Neuer Stand: alte Datei weg, öffentlich muss neu freigegeben werden
      const before = files();
      const upd = await send(paula, `/paint/bild/${art.id}/bild`, png(12, 9));
      assert.equal(upd.status, 200, upd.text_);
      assert.equal(JSON.parse(upd.text_).artwork.w, 12);
      assert.equal(JSON.parse(upd.text_).artwork.pending, true);
      await new Promise(r => setTimeout(r, 100));
      assert.equal(files().length, 2);
      assert.notDeepEqual(files(), before);

      // Größte Leinwand gilt auch für den Server
      assert.equal((await admin.form('/admin/paint', { _csrf: t, paint_enabled: '1', paint_guests: '1', paint_gallery: '1', paint_save: 'members', paint_quota_mb: '50', paint_max_w: '16', paint_max_h: '16' })).status, 302);
      assert.equal((await send(pit, '/paint/bilder', png(20, 10), { title: 'Zu breit' })).status, 400);
      const second = await send(pit, '/paint/bilder', png(10, 10), { title: 'Pits Bild', visibility: 'public' });
      assert.equal(JSON.parse(second.text_).artwork.pending, false, 'ohne Freigabe sofort öffentlich');
      const pitId = JSON.parse(second.text_).artwork.id;
      assert.equal((await json(pit, `/paint/bild/${pitId}/loeschen`, {})).status, 200);
      assert.equal((await guest.req(`/paint/bild/${pitId}.png`)).status, 404);

      // Gäste ausgesperrt
      assert.equal((await admin.form('/admin/paint', { _csrf: t, paint_enabled: '1', paint_gallery: '1', paint_save: 'members', paint_quota_mb: '50', paint_max_w: '2000', paint_max_h: '2000' })).status, 302);
      assert.equal((await guest.req('/paint')).status, 302);
      assert.equal((await pit.req('/paint')).status, 200);

      // Konto weg: Bilder und Dateien weg
      const id = Number((await admin.req('/admin/users')).text_.match(/href="\/admin\/users\/(\d+)"><b>paula</)[1]);
      t = await admin.csrf('/admin/users');
      assert.equal((await admin.form(`/admin/users/${id}/delete`, { _csrf: t })).status, 302);
      await new Promise(r => setTimeout(r, 100));
      assert.equal(files().length, 0);
      assert.equal((await admin.req(`/paint/bild/${art.id}.png`)).status, 404);
      assert.equal((await admin.form('/admin/paint', { _csrf: t, paint_enabled: '1', paint_guests: '1', paint_gallery: '1', paint_lobbies: '1', paint_save: 'members', paint_quota_mb: '50', paint_max_w: '2000', paint_max_h: '2000' })).status, 302);
    });

    await step('Paint-Lobby: gemeinsam malen, Rückgängig, Unterhaltung, Speichern mit Mitmalern', async () => {
      const P = require('../public/paint-core');
      const pngio = require('../src/png');
      let t = await admin.csrf('/admin/users');
      for (const name of ['lena', 'tom']) assert.equal((await admin.form('/admin/users/create', { _csrf: t, username: name, password: 'passwort123' })).status, 302);
      const lena = browser(), tom = browser();
      for (const [b, name] of [[lena, 'lena'], [tom, 'tom']]) {
        const tk = await b.csrf();
        const r = await b.req('/login', { method: 'POST', body: new URLSearchParams({ _csrf: tk, username: name, password: 'passwort123' }), headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': '10.9.1.' + name.length } });
        assert.equal(r.status, 302);
      }
      const json = async (b, url, body, token = true) => {
        const r = await b.req(url, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...(token ? { 'x-csrf-token': b.jar.get('csrf') } : {}) } });
        let parsed = null;
        try { parsed = JSON.parse(r.text_ || 'null'); } catch { /* Fehlerseite in HTML, z. B. ohne Formular-Token */ }
        return { status: r.status, json: parsed };
      };
      // Live-Verbindung mitlesen wie ein Browser
      function listen(b, url) {
        const ctl = new AbortController(), events = [], waiters = [];
        const done = fetch(BASE + url, { headers: { cookie: [...b.jar].map(([k, v]) => `${k}=${v}`).join('; ') }, signal: ctl.signal }).then(async res => {
          assert.equal(res.status, 200);
          let buf = '';
          for await (const chunk of res.body) {
            buf += Buffer.from(chunk).toString();
            let i;
            while ((i = buf.indexOf('\n\n')) >= 0) {
              const block = buf.slice(0, i); buf = buf.slice(i + 2);
              const ev = /^event: (.+)$/m.exec(block), data = /^data: (.*)$/m.exec(block);
              if (ev && data) { events.push({ event: ev[1], data: JSON.parse(data[1]) }); waiters.slice().forEach(w => w()); }
            }
          }
        }).catch(e => { if (e.name !== 'AbortError') throw e; });
        const next = (pred, ms = 3000) => new Promise((resolve, reject) => {
          const check = () => { const e = events.find(pred); if (e) { waiters.splice(waiters.indexOf(check), 1); clearTimeout(tm); resolve(e); } };
          const tm = setTimeout(() => reject(new Error('Kein passendes Ereignis: ' + JSON.stringify(events.map(e => e.event)))), ms);
          waiters.push(check); check();
        });
        return { events, next, close: () => { ctl.abort(); return done; } };
      }
      const patch = (w, h, color) => { const b = { w, h, d: new Uint8ClampedArray(w * h * 4) }; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ((x + y) % 2 === 0) P.set(b, x, y, color); return pngio.encode(b).toString('base64'); };

      assert.equal((await guest.req('/paint/lobbys')).status, 401);
      assert.equal((await json(lena, '/paint/lobbys', { name: 'x' }, false)).status, 403, 'ohne Formular-Token');
      const made = await json(lena, '/paint/lobbys', { name: 'Gemeinsam', w: 50, h: 40 });
      assert.equal(made.status, 200);
      const id = made.json.id;
      assert.ok((await json(tom, '/paint/lobbys', {})).json.id, 'jeder darf eine Lobby aufmachen');
      const listed = JSON.parse((await tom.req('/paint/lobbys')).text_).lobbies;
      assert.ok(listed.some(l => l.id === id && l.name === 'Gemeinsam' && l.w === 50));

      const sl = listen(lena, `/paint/lobby/${id}/events`), st = listen(tom, `/paint/lobby/${id}/events`);
      const hl = (await sl.next(e => e.event === 'hello')).data, ht = (await st.next(e => e.event === 'hello')).data;
      assert.equal(hl.state.ownerId, hl.me);
      await sl.next(e => e.event === 'state' && e.data.people.length === 2);

      // Lena malt ein Stück: Tom bekommt es als PNG, Lena nur die Bestätigung
      const op = await json(lena, `/paint/lobby/${id}/op`, { sid: hl.sid, cid: 'a1', x: 2, y: 3, data: patch(6, 4, 0xff0000) });
      assert.equal(op.status, 200, JSON.stringify(op.json));
      const got = (await st.next(e => e.event === 'op' && e.data.seq === op.json.seq)).data;
      assert.deepEqual([got.kind, got.x, got.y, got.w, got.h], ['patch', 2, 3, 50, 40]);
      assert.equal(P.get(pngio.decode(Buffer.from(got.data, 'base64')), 0, 0), 0xff0000);
      await sl.next(e => e.event === 'ack' && e.data.cid === 'a1');
      const snap = await tom.req(`/paint/lobby/${id}/bild.png`);
      assert.equal(snap.headers.get('content-type'), 'image/png');
      assert.equal(snap.headers.get('x-seq'), String(op.json.seq));
      // Befehl für das ganze Bild
      const rot = await json(tom, `/paint/lobby/${id}/op`, { sid: ht.sid, cid: 'b1', cmd: { t: 'rotate', deg: 90 } });
      assert.equal(rot.status, 200);
      const rotated = (await sl.next(e => e.event === 'op' && e.data.kind === 'cmd')).data;
      assert.deepEqual([rotated.w, rotated.h], [40, 50]);
      assert.equal((await json(tom, `/paint/lobby/${id}/op`, { sid: ht.sid, cid: 'b2', data: 'kaputt' })).status, 400);

      // Rückgängig: Tom nimmt seine Drehung zurück, Lena kann ihr Stück danach nicht mehr zurücknehmen (Drehung lag darüber)
      const back = await json(tom, `/paint/lobby/${id}/undo`, { sid: ht.sid, cid: 'u1' });
      assert.equal(back.status, 200);
      assert.equal((await sl.next(e => e.event === 'op' && e.data.seq === back.json.seq)).data.w, 50);
      assert.equal((await json(lena, `/paint/lobby/${id}/undo`, { sid: hl.sid, cid: 'u2' })).status, 409);

      // Zeiger und Unterhaltung
      await json(tom, `/paint/lobby/${id}/zeiger`, { sid: ht.sid, x: 5, y: 6, pv: { k: 's', id: 1, pts: [[5, 6]], c: 0, sh: 'round', sz: 2 } });
      const cur = (await sl.next(e => e.event === 'cursor')).data;
      assert.deepEqual([cur.x, cur.y, cur.pv.k], [5, 6, 's']);
      assert.equal((await json(tom, `/paint/lobby/${id}/chat`, { text: 'Hallo <b>Lena</b>' })).status, 200);
      assert.equal((await sl.next(e => e.event === 'chat')).data.text, 'Hallo <b>Lena</b>', 'Text kommt roh, der Browser setzt ihn als Text ein');

      // Nur Freigegebene malen: Tom sieht zu, bis Lena ihm das Malrecht gibt
      assert.equal((await json(tom, `/paint/lobby/${id}`, { action: 'settings', everyone: false })).status, 403, 'nur der Gastgeber');
      assert.equal((await json(lena, `/paint/lobby/${id}`, { action: 'settings', everyone: false })).status, 200);
      assert.match((await json(tom, `/paint/lobby/${id}/op`, { sid: ht.sid, cid: 'b3', x: 0, y: 0, data: patch(2, 2, 0x0000ff) })).json.error, /zusehen/);
      await json(lena, `/paint/lobby/${id}`, { action: 'rights', user: ht.me, allow: true });
      assert.equal((await json(tom, `/paint/lobby/${id}/op`, { sid: ht.sid, cid: 'b4', x: 40, y: 30, data: patch(4, 4, 0x0000ff) })).status, 200);

      // Speichern mit Mitmaler: Tom findet das Bild unter „Gemeinsam gemalt“, Gäste sehen es nicht
      const saved = await json(lena, `/paint/lobby/${id}/speichern`, { title: 'Zu zweit', visibility: 'private', painters: [ht.me] });
      assert.equal(saved.status, 200, JSON.stringify(saved.json));
      const art = saved.json.artwork;
      assert.equal(art.with, 'tom');
      assert.deepEqual(JSON.parse((await tom.req('/paint/bilder?tab=shared')).text_).artworks.map(a => a.title), ['Zu zweit']);
      assert.equal((await tom.req(`/paint/bild/${art.id}.png`)).status, 200, 'Mitmaler sehen private Bilder');
      assert.equal((await guest.req(`/paint/bild/${art.id}.png`)).status, 404);
      await json(lena, `/paint/bild/${art.id}`, { visibility: 'public' });
      assert.match((await guest.req(`/galerie/${art.id}`)).text_, /mit <a href="\/nutzer\/tom">tom<\/a>/);
      assert.match((await lena.req('/nutzer/tom')).text_, /id="bilder"[\s\S]*Zu zweit/, 'mitgemalte Bilder im Profil');
      assert.equal((await json(tom, `/paint/bild/${art.id}/austragen`, {})).status, 200);
      assert.deepEqual(JSON.parse((await tom.req('/paint/bilder?tab=shared')).text_).artworks, []);

      // Entwurf: wer die Lobby aufgemacht hat, findet den letzten Stand unter „Meine Bilder“
      assert.equal((await json(tom, `/paint/lobby/${id}/op`, { sid: ht.sid, cid: 'b5', x: 10, y: 10, data: patch(4, 4, 0x00ff00) })).status, 200);
      const sse = await st.close();
      // Der Server merkt das Trennen erst einen Moment später: kurz warten, bis er Tom austrägt
      let gone;
      for (let i = 0; i < 40 && (gone = (await json(tom, `/paint/lobby/${id}/chat`, { text: 'weg' })).status) !== 409; i++) await new Promise(r => setTimeout(r, 50));
      assert.equal(gone, 409, 'ohne Verbindung keine Änderungen');
      assert.equal((await json(lena, `/paint/lobby/${id}`, { action: 'close' })).status, 200);
      await sl.next(e => e.event === 'closed');
      await sl.close();
      const mine = JSON.parse((await lena.req('/paint/bilder')).text_).artworks;
      const draft = mine.find(a => a.draft);
      assert.ok(draft, 'Entwurf gesichert');
      assert.equal(draft.visibility, 'private');
      assert.equal((await tom.req(`/paint/bild/${draft.id}.png`)).status, 200, 'Mitmaler sehen den Entwurf');
      assert.ok(!JSON.parse((await guest.req('/paint/bilder?tab=gallery')).text_).artworks.some(a => a.id === draft.id));
      assert.equal((await lena.req(`/paint/lobby/${id}`)).status, 404, 'geschlossen');

      // Admin: Lobbys ausschalten
      t = await admin.csrf('/admin/paint');
      assert.match((await admin.req('/admin/paint')).text_, /Offene Lobbys/);
      assert.equal((await admin.form('/admin/paint', { _csrf: t, paint_enabled: '1', paint_guests: '1', paint_gallery: '1', paint_save: 'members', paint_quota_mb: '50', paint_max_w: '2000', paint_max_h: '2000' })).status, 302);
      assert.equal((await lena.req('/paint/lobbys')).status, 404);
      assert.doesNotMatch((await lena.req('/paint')).text_, /paint-lobby\.js/);
      assert.equal((await admin.form('/admin/paint', { _csrf: t, paint_enabled: '1', paint_guests: '1', paint_gallery: '1', paint_lobbies: '1', paint_save: 'members', paint_quota_mb: '50', paint_max_w: '2000', paint_max_h: '2000' })).status, 302);
      assert.match((await lena.req('/paint')).text_, /paint-lobby\.js/);
      void sse;
    });

    await step('Eigene Dateien: Upload nur für Freunde, umbenennen, Sichtbarkeit, löschen', async () => {
      const { anna, bernd } = members;
      const { DatabaseSync } = require('node:sqlite');
      const sql = new DatabaseSync(path.join(DATA, 'site.db'), { timeout: 5000 });
      const id = name => sql.prepare('SELECT id FROM users WHERE username = ?').get(name).id;
      sql.prepare('DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)').run(id('admin'), id('anna'), id('anna'), id('admin'));
      sql.prepare('INSERT INTO friends(user_id, friend_id, accepted, created_at) VALUES (?, ?, 1, 0)').run(id('admin'), id('anna'));
      const t = await admin.csrf('/files/upload');
      assert.match((await admin.req('/files/upload')).text_, /<option value="friends">Nur meine Freunde<\/option>/);
      const fd = new FormData();
      fd.append('_csrf', t); fd.append('title', 'Nur für Freunde'); fd.append('visibility', 'friends');
      fd.append('files', new Blob(['geheim']), 'freunde.txt');
      assert.equal((await admin.req('/files/upload', { method: 'POST', body: fd })).status, 200);
      const f = sql.prepare("SELECT * FROM files WHERE title = 'Nur für Freunde'").get();
      assert.equal(f.visibility, 'friends');
      assert.match((await anna.req('/files')).text_, /Nur für Freunde/, 'Freundin sieht die Datei');
      assert.equal((await anna.req('/files/dl/' + f.id)).status, 200);
      assert.doesNotMatch((await bernd.req('/files')).text_, /Nur für Freunde/, 'kein Freund');
      assert.notEqual((await bernd.req('/files/dl/' + f.id)).status, 200);
      assert.doesNotMatch((await guest.req('/files')).text_, /Nur für Freunde/);
      // Startmenü: Eigene Dateien unter Dokumente, Info mit Changelog und Datenschutz
      const home = (await anna.req('/', { top: true })).text_;
      assert.match(home, /📂 Dokumente<\/button><div class="submenu">\s*<a href="\/eigene-dateien">/);
      assert.match(home, /ℹ️ Info<\/button><div class="submenu">[\s\S]*href="\/changelog"[\s\S]*href="\/datenschutz"/);
      // Explorer: Bibliothek Downloads mit Name und Sichtbarkeit
      assert.match((await admin.req('/eigene-dateien')).text_, /href="\/eigene-dateien\?bib=datei"/);
      const page = (await admin.req('/eigene-dateien?bib=datei')).text_;
      assert.match(page, new RegExp('data-ref="datei:' + f.id + '"[^>]*data-name="Nur für Freunde"[^]*?<option value="friends" selected>'));
      // Fremde Einträge gibt es in den eigenen Dateien nicht
      const t2 = bernd.jar.get('csrf');
      assert.equal((await bernd.form('/eigene-dateien/datei/' + f.id + '/loeschen', { _csrf: t2 })).status, 404);
      const t3 = await admin.csrf('/eigene-dateien?bib=datei');
      assert.equal((await admin.form('/eigene-dateien/datei/' + f.id, { _csrf: t3, title: 'Für alle', visibility: 'members' })).status, 302);
      assert.equal(sql.prepare('SELECT visibility FROM files WHERE id = ?').get(f.id).visibility, 'members');
      assert.match((await bernd.req('/files')).text_, /Für alle/);
      // Löschen legt in den Papierkorb: privat, zurückholbar, erst dort endgültig weg
      assert.equal((await admin.form('/eigene-dateien/datei/' + f.id + '/loeschen', { _csrf: t3 })).status, 302);
      assert.equal(sql.prepare('SELECT visibility FROM files WHERE id = ?').get(f.id).visibility, 'private');
      assert.doesNotMatch((await bernd.req('/files')).text_, /Für alle/, 'im Papierkorb sieht es niemand');
      assert.match((await admin.req('/eigene-dateien?ordner=papierkorb')).text_, /Für alle/);
      const api = (method, url, body) => admin.req(url, { method, headers: { 'Content-Type': 'application/json', 'x-csrf-token': admin.jar.get('csrf') }, body: JSON.stringify(body) });
      assert.equal((await api('POST', '/api/desktop/wiederherstellen', { refs: ['datei:' + f.id] })).status, 200);
      assert.equal(sql.prepare('SELECT visibility FROM files WHERE id = ?').get(f.id).visibility, 'members', 'Sichtbarkeit kommt zurück');
      assert.equal((await admin.form('/eigene-dateien/datei/' + f.id + '/loeschen', { _csrf: t3 })).status, 302);
      assert.equal((await api('POST', '/api/desktop/endgueltig', { refs: ['datei:' + f.id] })).status, 200);
      assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM files WHERE id = ?').get(f.id).n, 0);
      assert.equal((await guest.req('/eigene-dateien')).status, 302, 'nur mit Konto');
      sql.close();
    });

    await step('Desktop 2.0: Ordner, Textdokumente, Links, Papierkorb, Freigabe, Suche, Lobbys', async () => {
      const { anna, bernd } = members;
      const { DatabaseSync } = require('node:sqlite');
      const sql = new DatabaseSync(path.join(DATA, 'site.db'), { timeout: 5000 });
      const uid = name => sql.prepare('SELECT id FROM users WHERE username = ?').get(name).id;
      sql.prepare('DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)').run(uid('anna'), uid('bernd'), uid('bernd'), uid('anna'));
      const api = (b, url, data) => b.req(url, { method: 'POST', body: JSON.stringify(data), headers: { 'content-type': 'application/json', 'x-csrf-token': b.jar.get('csrf') } });
      const json = async r => ({ status: r.status, ...JSON.parse(r.text_) });

      // Gäste: nur Standardsymbole, readme.txt mit dem Absatz für Gäste
      const g = JSON.parse((await guest.req('/api/desktop')).text_);
      assert.equal(g.me, null);
      assert.ok(g.items.some(i => i.ref === 'readme') && g.items.every(i => i.sys), 'nur Standardsymbole');
      assert.ok(!g.items.some(i => i.ref === 'papierkorb'), 'Papierkorb nur mit Konto');
      assert.match((await guest.req('/notizblock/readme')).text_, /OHNE KONTO/);
      assert.ok([401, 403].includes((await api(guest, '/api/desktop/neu', { kind: 'folder' })).status), 'nur mit Konto');

      // Anlegen: Ordner, Textdokument, Internetlink (nur http/https), Verknüpfung (nur hier)
      const folder = (await json(await api(anna, '/api/desktop/neu', { kind: 'folder', name: 'Urlaub' }))).item;
      const text = (await json(await api(anna, '/api/desktop/neu', { kind: 'text', name: 'Einkaufsliste', body: 'Milch' }))).item;
      assert.equal(text.vis, 'private', 'neu ist privat');
      assert.equal((await api(anna, '/api/desktop/neu', { kind: 'link', target: 'javascript:alert(1)' })).status, 400);
      assert.equal((await api(anna, '/api/desktop/neu', { kind: 'shortcut', target: 'https://example.org/' })).status, 400, 'Verknüpfung nur auf diese Seite');
      const link = (await json(await api(anna, '/api/desktop/neu', { kind: 'link', target: 'https://example.org/', name: 'Beispiel', visibility: 'public' }))).item;
      assert.equal((await api(anna, '/api/desktop/neu', { kind: 'text', name: 'a/b' })).status, 400, 'keine Schrägstriche im Namen');
      const big = 'x'.repeat(Number(sql.prepare("SELECT value FROM settings WHERE key = 'desk_text_chars'").get().value) + 1);
      assert.equal((await api(anna, '/api/notizblock/' + text.id, { body: big })).status, 400, 'Zeichengrenze');
      assert.equal((await api(anna, '/api/notizblock/' + text.id, { body: 'Milch\nBrot' })).status, 200);

      // Privat: andere sehen das Textdokument nicht, auch nicht über die Suche
      assert.notEqual((await bernd.req('/notizblock/' + text.id)).status, 200);
      assert.match((await anna.req('/notizblock/' + text.id)).text_, /Milch\nBrot/);
      const find = async (b, q) => JSON.parse((await b.req('/api/suche?q=' + encodeURIComponent(q))).text_);
      assert.ok(JSON.stringify(await find(anna, 'Einkauf')).includes('Einkaufsliste'));
      assert.ok(!JSON.stringify(await find(bernd, 'Einkauf')).includes('Einkaufsliste'));
      assert.ok(!JSON.stringify(await find(guest, 'Einkauf')).includes('Einkaufsliste'));
      assert.ok(JSON.stringify(await find(guest, 'Systemst')).includes('/einstellungen'), 'Programme findet jeder');

      // Ins Ordner schieben, Ordner in den Papierkorb: Inhalt kommt mit und wieder zurück
      assert.equal((await api(anna, '/api/desktop/verschieben', { refs: [text.ref], folder: folder.id })).status, 200);
      assert.equal(sql.prepare('SELECT parent_id FROM desk_items WHERE id = ?').get(text.id).parent_id, folder.id);
      await api(anna, '/api/desktop/loeschen', { refs: [folder.ref] });
      let d = JSON.parse((await anna.req('/api/desktop')).text_);
      assert.ok(!d.items.some(i => i.ref === folder.ref) && d.trash === 1, 'Ordner im Papierkorb');
      assert.match((await anna.req('/notizblock/' + text.id)).text_, /Liegt im Papierkorb/, 'Inhalt ist mit weg');
      await api(anna, '/api/desktop/wiederherstellen', { refs: [folder.ref] });
      assert.doesNotMatch((await anna.req('/notizblock/' + text.id)).text_, /Liegt im Papierkorb/, 'und wieder da');

      // Freigabe: Der Link zeigt nur, was der Betrachter ohnehin sehen darf
      const share = (await json(await api(anna, '/api/desktop/freigabe/' + folder.id, { vis: 'public' }))).item.share;
      assert.ok(share && share.token.length >= 12);
      assert.match((await guest.req('/ordner/' + share.token)).text_, /Urlaub/);
      assert.doesNotMatch((await guest.req('/ordner/' + share.token)).text_, /Einkaufsliste/, 'privates Dokument bleibt privat');
      await api(anna, '/api/desktop/' + text.id, { visibility: 'members' });
      assert.match((await bernd.req('/ordner/' + share.token)).text_, /Einkaufsliste/);
      assert.doesNotMatch((await guest.req('/ordner/' + share.token)).text_, /Einkaufsliste/);
      await api(anna, '/api/desktop/freigabe/' + folder.id, { vis: '' });
      assert.equal((await guest.req('/ordner/' + share.token)).status, 404, 'Freigabe beendet');

      // Standardsymbole ausblenden und zurückholen, Plätze merken
      await api(anna, '/api/desktop/loeschen', { refs: ['readme'] });
      d = JSON.parse((await anna.req('/api/desktop')).text_);
      assert.ok(!d.items.some(i => i.ref === 'readme') && d.hidden.includes('readme'));
      await api(anna, '/api/desktop/einstellungen', { show: ['readme'] });
      await api(anna, '/api/desktop/platz', { list: [{ ref: link.ref, x: 3, y: 2 }, { ref: 'readme', x: 4, y: 0 }] });
      d = JSON.parse((await anna.req('/api/desktop')).text_);
      const at = ref => d.items.find(i => i.ref === ref);
      assert.deepEqual([at(link.ref).x, at(link.ref).y, at('readme').x, at('readme').y], [3, 2, 4, 0]);

      // Profil: öffentlicher Link steht drin, ohne Referrer; Vorschau als Gast nur für den Besitzer
      const prof = (await bernd.req('/nutzer/anna')).text_;
      assert.match(prof, /href="https:\/\/example\.org\/" target="_blank" rel="noopener noreferrer nofollow"/);
      assert.doesNotMatch((await bernd.req('/nutzer/anna?ansicht=guest')).text_, /So sieht/);
      assert.match((await anna.req('/nutzer/anna?ansicht=member')).text_, /So sieht <b>ein angemeldetes Mitglied<\/b>/);

      // Offene Lobbys nur mit Konto, Seitenverwaltung schaltet Widget und Suche ab
      assert.equal((await guest.req('/api/lobbys')).status, 401);
      assert.ok(Array.isArray(JSON.parse((await anna.req('/api/lobbys')).text_).lobbies));
      sql.prepare("UPDATE settings SET value = '0' WHERE key IN ('lobby_widget', 'search_enabled')").run();
      assert.equal((await anna.req('/api/suche?q=Einkauf')).status, 404);
      const shell = (await anna.req('/', { top: true })).text_;
      assert.doesNotMatch(shell, /id="lobbywidget"/);
      assert.doesNotMatch(shell, /id="tbsearch"/);
      sql.prepare("UPDATE settings SET value = '1' WHERE key IN ('lobby_widget', 'search_enabled')").run();
      assert.match((await anna.req('/', { top: true })).text_, /id="tbsearch"/);

      // Darstellung am Konto: nur mit Haken, ohne Größe der Oberfläche
      const r = await json(await api(anna, '/api/einstellungen/darstellung', { display: { design: 'xp', xp: 'oliv', scale: 150, t: 5 } }));
      assert.equal(r.display.design, 'xp');
      assert.equal(r.display.scale, undefined, 'Größe bleibt im Browser');
      assert.match((await anna.req('/', { top: true })).text_, /id="darstellung-konto">\{[^<]*"xp":"oliv"/);
      await api(anna, '/api/einstellungen/darstellung', { display: null });
      assert.doesNotMatch((await anna.req('/', { top: true })).text_, /"xp":"oliv"/);
      sql.close();
    });

    await step('Seitenverwaltung → Desktop: readme.txt, Symbole, Grenzen, Freigaben; Profilbild quadratisch', async () => {
      const { anna } = members;
      const { DatabaseSync } = require('node:sqlite');
      const sql = new DatabaseSync(path.join(DATA, 'site.db'), { timeout: 5000 });
      const setting = k => sql.prepare('SELECT value FROM settings WHERE key = ?').get(k).value;
      assert.equal((await anna.req('/admin/desktop')).status, 403);
      const page = (await admin.req('/admin/desktop')).text_;
      assert.match(page, /name="desk_readme"/);
      assert.match(page, /Beispiel/, 'öffentlicher Link von anna steht in der Liste');
      const t = await admin.csrf('/admin/desktop');
      const v = Number(setting('desk_readme_version'));
      const ICONS = ['eigene-dateien', 'papierkorb', 'readme', 'board', 'kartenspiele', 'musik', 'paint'].map(k => ['icons', k]);
      assert.equal((await admin.form('/admin/desktop', { _csrf: t, desk_readme: 'Hallo {zeichen} {tage}', readme_bump: '1', icons: 'readme',
        desk_text_chars: '500', desk_text_max: '10', desk_folders_max: '10', desk_links_max: '10', desk_trash_days: '7', user_quota_mb: '100', lobby_widget: '1', search_enabled: '1' })).status, 302);
      assert.equal(Number(setting('desk_readme_version')), v + 1);
      assert.equal(setting('desk_defaults'), 'readme');
      const d = JSON.parse((await anna.req('/api/desktop')).text_);
      assert.ok(d.items.find(i => i.ref === 'readme').isNew, 'neue Fassung: wieder NEU');
      assert.match((await anna.req('/notizblock/readme')).text_, /Hallo 500 7/);
      assert.ok(!d.items.some(i => i.ref === 'papierkorb'), 'nur noch readme.txt als Standardsymbol');
      // Grenzen werden geklemmt
      await admin.form('/admin/desktop', [['_csrf', t], ['desk_text_chars', '5'], ['desk_trash_days', '9999'], ['lobby_widget', '1'], ['search_enabled', '1'], ...ICONS]);
      assert.equal(setting('desk_text_chars'), '100');
      assert.equal(setting('desk_trash_days'), '365');
      await admin.form('/admin/desktop', [['_csrf', t], ['desk_text_chars', '10000'], ['desk_trash_days', '30'], ['user_quota_mb', '2048'],
        ['desk_readme', require('../src/readme').DEFAULT], ['lobby_widget', '1'], ['search_enabled', '1'], ...ICONS]);
      assert.equal(setting('desk_defaults'), 'eigene-dateien,papierkorb,readme,board,kartenspiele,musik,paint');
      // Freigabe zurücknehmen: der Link wird privat
      const id = sql.prepare("SELECT id FROM desk_items WHERE name = 'Beispiel'").get().id;
      assert.equal((await admin.form('/admin/desktop/freigabe/' + id, { _csrf: t })).status, 302);
      assert.equal(sql.prepare('SELECT visibility FROM desk_items WHERE id = ?').get(id).visibility, 'private');
      // Grunddesign der Seite
      await admin.form('/admin/design', { _csrf: t, theme_design: 'xp-silber' });
      assert.match((await guest.req('/', { top: true })).text_, /<html lang="de" data-design="xp-silber">/);
      await admin.form('/admin/design', { _csrf: t, theme_design: '98' });
      // Profilbild: Querformat lehnt der Server ab, quadratisch geht
      const zlib = require('node:zlib');
      const crc = buf => { let c, r = ~0; for (const b of buf) { c = (r ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; r = (r >>> 8) ^ c; } return ~r >>> 0; };
      const chunk = (type, data) => { const h = Buffer.alloc(8); h.writeUInt32BE(data.length); h.write(type, 4, 'latin1'); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([h.subarray(4), data]))); return Buffer.concat([h, data, c]); };
      const png = (w, h) => { const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
        return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.alloc((w * 3 + 1) * h))), chunk('IEND', Buffer.alloc(0))]); };
      const upload = async (w, h) => {
        const fd = new FormData();
        fd.append('_csrf', await anna.csrf('/konto'));
        fd.append('avatar', new Blob([png(w, h)], { type: 'image/png' }), 'bild.png');
        return (await anna.req('/account/avatar', { method: 'POST', body: fd })).headers.get('location');
      };
      assert.match(await upload(30, 20), /err=quadrat/);
      assert.match(await upload(20, 20), /ok=bild/);
      assert.match((await anna.req('/konto')).text_, /data-avatar-crop/);
      sql.close();
    });

    await step('Modlisten: Mitglieder legen an, Kategorien, Haken, Vorschläge mit Gästen, Übernehmen, Verlauf', async () => {
      const { anna, bernd } = members;
      const { DatabaseSync } = require('node:sqlite');
      const sql = new DatabaseSync(path.join(DATA, 'site.db'), { timeout: 5000 });
      sql.prepare("UPDATE users SET notify_prefs = NULL WHERE username = 'anna'").run();   // vorher abgeschaltet, hier Vorgaben
      assert.equal((await guest.req('/mods/neu')).status, 302, 'anlegen nur mit Konto');
      assert.equal((await admin.req('/admin/mods/new')).headers.get('location'), '/mods/neu');
      let t = anna.jar.get('csrf');
      assert.match((await anna.req('/mods/neu')).text_, /data-ml-form="list"/);
      const data = { categories: [
        { name: 'Grundlage', rows: [{ name: 'BepInEx', url: 'https://thunderstore.io/c/valheim/p/denikson/BepInExPack_Valheim/', notes: 'zuerst', on_server: true },
          { name: 'Böse', url: 'javascript:alert(1)', notes: '', on_server: false }, { name: '', url: 'https://leer.example', notes: 'ohne Namen' }] },
        { name: 'Gameplay', rows: [{ name: 'Plant Everything', url: 'https://www.nexusmods.com/valheim/mods/1042', notes: 'Beeren <b>pflanzen</b>', on_server: true }] },
        { name: 'Leer', rows: [] },
      ] };
      let r = await anna.form('/mods/neu', { _csrf: t, title: 'Nordwind', game: 'Valheim', description: 'Unser Server', visibility: 'public', suggestions: 'all', data: JSON.stringify(data) });
      assert.equal(r.status, 302);
      const url = r.headers.get('location').replace(/\?.*$/, '');
      assert.equal(url, '/mods/valheim-nordwind');
      const list = sql.prepare("SELECT * FROM modlists WHERE slug = 'valheim-nordwind'").get();
      assert.equal(list.owner_id, sql.prepare("SELECT id FROM users WHERE username = 'anna'").get().id);
      const items = sql.prepare('SELECT * FROM mod_items WHERE modlist_id = ? ORDER BY position').all(list.id);
      assert.deepEqual(items.map(i => [i.category, i.name, i.on_server]), [['Grundlage', 'BepInEx', 1], ['Grundlage', 'Böse', 0], ['Gameplay', 'Plant Everything', 1]]);
      assert.equal(items[1].url, null, 'javascript:-Links fallen weg');
      // Ansicht für Gäste: Name als Link mit Seite dahinter, Bemerkung, Haken, Kategorien zum Aufklappen
      let page = (await guest.req(url)).text_;
      assert.match(page, /<a href="https:\/\/thunderstore\.io\/c\/valheim\/p\/denikson\/BepInExPack_Valheim\/" target="_blank" rel="noopener noreferrer">BepInEx<\/a><small class="ml-dom">thunderstore\.io<\/small>/);
      assert.match(page, /<details class="ml-cat" open data-cat="Grundlage">/);
      assert.match(page, /Beeren &lt;b&gt;pflanzen&lt;\/b&gt;/);
      assert.match(page, /3 Mods · 2 laufen auf dem Server/);
      assert.doesNotMatch(page, /data-ml-form|✏️ Bearbeiten<\/a><\/nav>/);
      assert.match((await guest.req('/mods')).text_, /Nordwind[\s\S]*3 Mods/);
      // Nur Besitzerin und Admin bearbeiten
      assert.doesNotMatch((await bernd.req(url + '?bearbeiten')).text_, /data-ml-form="list"/);
      t = bernd.jar.get('csrf');
      assert.equal((await bernd.form(url + '/speichern', { _csrf: t, title: 'Gekapert', game: 'X', data: '{}' })).status, 403);
      assert.match((await admin.req(url + '?bearbeiten')).text_, /data-ml-form="list"[\s\S]*value="Plant Everything"/);
      assert.match((await anna.req(url + '?bearbeiten')).text_, /value="Grundlage"[\s\S]*data-f="on_server" checked/);
      // Vorschläge: Gast braucht einen Namen, Spam-Feld wird still verworfen
      t = guest.jar.get('csrf');
      r = await guest.form(url + '/vorschlaege', { _csrf: t, known: '', data: JSON.stringify({ rows: [{ name: 'Seasons', url: 'thunderstore.io/seasons', notes: 'Winter!' }] }) });
      assert.equal(r.status, 400);
      await guest.form(url + '/vorschlaege', { _csrf: t, known: '', website: 'spam', guest_name: 'Bot', data: JSON.stringify({ rows: [{ name: 'Spam' }] }) });
      r = await guest.form(url + '/vorschlaege', { _csrf: t, known: '', guest_name: 'Kai', data: JSON.stringify({ rows: [{ name: 'Seasons', url: 'https://thunderstore.io/seasons', notes: 'Winter!' }] }) });
      assert.equal(r.status, 302);
      let sugg = sql.prepare('SELECT * FROM mod_suggestions WHERE modlist_id = ? ORDER BY position').all(list.id);
      assert.deepEqual(sugg.map(s => [s.name, s.author_name, s.guest, s.author_id]), [['Seasons', 'Kai', 1, null]]);
      assert.ok(sql.prepare("SELECT 1 FROM notifications WHERE kind = 'modliste' AND user_id = ?").get(list.owner_id), 'Besitzerin bekommt Bescheid');
      // Bernd ändert Kais Vorschlag und trägt einen eigenen ein, gleichzeitig speichert ein Gast einen alten Stand ohne Kais Zeile
      t = bernd.jar.get('csrf');
      assert.match((await bernd.req(url + '?vorschlaege')).text_, new RegExp(`data-id="${sugg[0].id}"[\\s\\S]*value="Seasons"[\\s\\S]*Kai \\(Gast\\)`));
      await bernd.form(url + '/vorschlaege', { _csrf: t, known: String(sugg[0].id), data: JSON.stringify({ rows: [{ id: sugg[0].id, name: 'Seasons', url: 'https://thunderstore.io/seasons', notes: 'Winter für die Bergbasis' }, { name: 'Valheim Plus', url: 'https://www.nexusmods.com/valheim/mods/4' }] }) });
      t = guest.jar.get('csrf');
      await guest.form(url + '/vorschlaege', { _csrf: t, known: '', guest_name: 'Mia', data: JSON.stringify({ rows: [{ name: 'Epic Loot' }] }) });
      sugg = sql.prepare('SELECT * FROM mod_suggestions WHERE modlist_id = ? ORDER BY position').all(list.id);
      assert.deepEqual(sugg.map(s => [s.name, s.notes, s.author_name]), [['Seasons', 'Winter für die Bergbasis', 'Kai'], ['Valheim Plus', null, 'bernd'], ['Epic Loot', null, 'Mia']]);
      page = (await guest.req(url)).text_;
      assert.match(page, /<a href="\/nutzer\/bernd" class="userlink">bernd<\/a>/);
      assert.match(page, /<span class="ml-guest">Mia \(Gast\)<\/span>/);
      assert.doesNotMatch(page, /Übernehmen/, 'Übernehmen nur für die Besitzerin');
      // Übernehmen in eine Kategorie: landet hinten in „Gameplay“, mit Herkunft in der Bemerkung
      page = (await anna.req(url)).text_;
      assert.match(page, /⇧ Übernehmen/);
      t = anna.jar.get('csrf');
      assert.equal((await anna.form(`${url}/vorschlaege/${sugg[1].id}/uebernehmen`, { _csrf: t, category: 'Gameplay' })).status, 302);
      const after = sql.prepare('SELECT category, name, notes FROM mod_items WHERE modlist_id = ? ORDER BY position').all(list.id);
      assert.deepEqual(after.map(i => i.name), ['BepInEx', 'Böse', 'Plant Everything', 'Valheim Plus']);
      assert.equal(after[3].notes, 'Vorschlag von bernd');
      assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM mod_suggestions WHERE modlist_id = ?').get(list.id).n, 2);
      // Verlauf: jeder sieht ihn, zurückdrehen darf nur die Besitzerin
      page = (await guest.req(url + '/verlauf')).text_;
      assert.match(page, /Kai \(Gast\)[\s\S]*1 neu/);
      assert.doesNotMatch(page, /Davor zurück/);
      const first = sql.prepare('SELECT id FROM mod_suggestion_log WHERE modlist_id = ? ORDER BY id LIMIT 1').get(list.id).id;
      t = bernd.jar.get('csrf');
      assert.equal((await bernd.form(`${url}/verlauf/${first}/zurueck`, { _csrf: t })).status, 403);
      t = anna.jar.get('csrf');
      assert.equal((await anna.form(`${url}/verlauf/${first}/zurueck`, { _csrf: t })).status, 302);
      assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM mod_suggestions WHERE modlist_id = ?').get(list.id).n, 0, 'Stand vor Kais Vorschlag');
      assert.match((await anna.req(url + '/verlauf')).text_, /wiederhergestellt/);
      // Liste bearbeiten: nur Mitglieder dürfen vorschlagen, dann nur Freunde sehen
      t = anna.jar.get('csrf');
      r = await anna.form(url + '/speichern', { _csrf: t, title: 'Nordwind', game: 'Valheim', description: '', visibility: 'public', suggestions: 'members',
        data: JSON.stringify({ categories: [{ name: '', rows: [{ name: 'Nur eine', url: '', notes: '', on_server: false }] }] }) });
      assert.equal(r.status, 302);
      page = (await guest.req(url)).text_;
      assert.doesNotMatch(page, /class="ml-cat"/, 'eine Kategorie ohne Namen: keine Kopfzeile');
      t = guest.jar.get('csrf');
      assert.equal((await guest.form(url + '/vorschlaege', { _csrf: t, guest_name: 'Kai', data: '{"rows":[{"name":"X"}]}' })).status, 403);
      t = anna.jar.get('csrf');
      await anna.form(url + '/speichern', { _csrf: t, title: 'Nordwind', game: 'Valheim', visibility: 'private', suggestions: 'off', data: '{"categories":[]}' });
      assert.equal((await guest.req(url)).status, 404);
      assert.equal((await bernd.req(url)).status, 404);
      assert.equal((await anna.req(url)).status, 200);
      assert.match((await admin.req('/admin/mods')).text_, /Nordwind<\/b><\/a><\/td><td>anna/);
      // Löschen nur Besitzerin oder Admin
      t = bernd.jar.get('csrf');
      assert.notEqual((await bernd.form(url + '/loeschen', { _csrf: t })).status, 302);
      t = anna.jar.get('csrf');
      assert.equal((await anna.form(url + '/loeschen', { _csrf: t })).status, 302);
      assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM modlists WHERE id = ?').get(list.id).n, 0);
      assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM mod_suggestion_log WHERE modlist_id = ?').get(list.id).n, 0);
      assert.equal((await guest.req('/static/mods.js')).status, 200);
      sql.close();
    });

    await step('Farming Simulator Hub: Feeds abholen, Höfe, Notizen, Aufgaben, Kalender, Karte, Preise, Changelog, Vorschläge', async () => {
      const { anna, bernd } = members;
      const http = require('node:http');
      // Kleiner Spieleserver mit den echten Beispiel-Feeds (test/fixtures/fs). over: Inhalte zum Austauschen im Test.
      const FX = path.join(__dirname, 'fixtures', 'fs'), over = {};
      const fx = http.createServer((req, res) => {
        const name = req.url.split('?')[0].slice(1);
        if (!/^[a-z]+\.(xml|jpg)$/.test(name)) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'content-type': name.endsWith('.jpg') ? 'image/jpeg' : 'text/xml' });
        res.end(over[name] ?? fs.readFileSync(path.join(FX, name)));
      });
      await new Promise(r => fx.listen(0, '127.0.0.1', r));
      const FXU = `http://127.0.0.1:${fx.address().port}`;
      const SECRET = 'GeHeIm4711code';
      try {
        assert.equal((await guest.req('/farming')).status, 302, 'Gäste sehen den Hub nur, wenn der Admin es erlaubt');
        assert.doesNotMatch((await guest.req('/', { top: true })).text_, /🚜 Farming Simulator/);
        assert.match((await anna.req('/', { top: true })).text_, /href="\/farming">🚜 Farming Simulator/);
        assert.match((await anna.req('/farming')).text_, /Der Hub kennt den Server noch nicht/);
        // Seitenverwaltung: Adressen eintragen, sofort abfragen; der Code taucht nirgends auf
        let t = await admin.csrf('/admin/farming');
        const urls = Object.fromEntries(['stats', 'savegame', 'vehicles', 'economy'].map(k => ['url_' + k, `${FXU}/${k}.xml?code=${SECRET}`]));
        assert.equal((await admin.form('/admin/farming/server', { _csrf: t, ...urls, url_map: `${FXU}/map.jpg?code=${SECRET}`, int_stats: '30', ftp_host: '', ftp_port: '21' })).status, 302);
        assert.equal((await admin.form('/admin/farming/server', { _csrf: t, url_stats: 'ftp://falsch' })).headers.get('location').includes('err='), true);
        assert.equal((await admin.form('/admin/farming/testen', { _csrf: t })).status, 302);
        const adm = (await admin.req('/admin/farming')).text_;
        assert.match(adm, /Chaosfarm · Bilk · 0\/4 Spieler · 56 Mods/);
        assert.match(adm, /141 Einträge · Farm 1: 87, Farm 2: 54/);
        assert.match(adm, /Bild 512 × 512 Pixel/);
        assert.doesNotMatch(adm, new RegExp(SECRET), 'Code bleibt auf dem Server');
        let page = (await anna.req('/farming')).text_;
        assert.doesNotMatch(page, new RegExp(SECRET));
        assert.match(page, /<b>Chaosfarm<\/b>/);
        assert.match(page, /Version 1\.25\.0\.0 · Karte „Bilk“/);
        assert.match(page, /483\.362 €/);
        assert.match(page, /Große Nachfrage ab 1\. Juni J8, 7 Uhr: <a href="\/farming\/preise\?w=STONE"><b>Steine \+30 %/);
        assert.match(page, /Spieltag 174 · geschätzt/);
        assert.match(page, /Werkstatt: 4 Fahrzeuge über 50 % Verschleiß <span class="chip"/);
        assert.equal((await anna.req('/farming/karte.bild')).headers.get('content-type'), 'image/jpeg');

        // Hof beitreten, Namen geben; Fremde dürfen das nicht
        t = anna.jar.get('csrf');
        assert.equal((await anna.form('/farming/hof/1/beitreten', { _csrf: t })).headers.get('location'), '/farming/hof/1?ok=beigetreten');
        assert.equal((await anna.form('/farming/hof/1/name', { _csrf: t, name: 'Hof Anna', color: '#aa5500' })).status, 302);
        assert.equal((await bernd.form('/farming/hof/1/name', { _csrf: bernd.jar.get('csrf'), name: 'Meins' })).status, 403);
        assert.equal((await bernd.form('/farming/hof/2/beitreten', { _csrf: bernd.jar.get('csrf') })).status, 302);
        page = (await anna.req('/farming/hof/1')).text_;
        assert.match(page, /<b>Hof Anna<\/b>/);
        assert.match(page, /57,2 ha/);
        assert.match(page, /Wert des Landes 4,46 Mio €/);
        assert.match(page, /Felder: 18 · Grundstücke: 20/);
        assert.match(page, /Forelle<\/a><\/b>/);
        assert.match((await anna.req('/farming/hof/1?tab=fahrzeuge&sort=preis')).text_, /JAGUAR 990 TERRA TRAC/);
        assert.match((await anna.req('/farming/hof/1?tab=finanzen')).text_, /Fuhrpark \(59 Stück, Neupreis\)/);

        // Notizen: alle schreiben, nur eigene bearbeiten und löschen
        assert.equal((await anna.form('/farming/notizen', { _csrf: t, body: 'Ballen <b>nicht</b> verkaufen' })).status, 302);
        const sql = new (require('node:sqlite').DatabaseSync)(path.join(DATA, 'site.db'));
        const noteId = sql.prepare('SELECT id FROM fs_notes ORDER BY id DESC').get().id;
        assert.equal((await bernd.form(`/farming/notizen/${noteId}/loeschen`, { _csrf: bernd.jar.get('csrf') })).status, 403);
        assert.equal((await anna.form(`/farming/notizen/${noteId}`, { _csrf: t, body: 'Ballen nicht verkaufen!' })).status, 302);
        page = (await bernd.req('/farming')).text_;
        assert.match(page, /Ballen nicht verkaufen!/);
        assert.doesNotMatch(page, /<b>nicht<\/b>/);

        // Aufgaben: regelmäßig, heute fällig, abhaken legt die nächste Runde an; andere Höfe dürfen nicht
        assert.equal((await bernd.form('/farming/hof/1/aufgaben', { _csrf: bernd.jar.get('csrf'), title: 'Fremd' })).status, 403);
        assert.equal((await anna.form('/farming/hof/1/aufgaben', { _csrf: t, title: 'Ziegen füttern', due: 'today', repeat: 'days', repeat_n: '1' })).status, 302);
        page = (await anna.req('/farming')).text_;
        assert.match(page, /Ziegen füttern[\s\S]*?heute · 🔁 täglich/);
        const taskId = sql.prepare("SELECT id FROM fs_tasks WHERE title = 'Ziegen füttern'").get().id;
        assert.equal((await anna.form(`/farming/aufgaben/${taskId}/erledigt`, { _csrf: t })).status, 302);
        const next = sql.prepare("SELECT * FROM fs_tasks WHERE title = 'Ziegen füttern' AND done_at IS NULL").get();
        assert.ok(next && next.due_date > sql.prepare('SELECT due_date FROM fs_tasks WHERE id = ?').get(taskId).due_date, 'nächste Runde morgen');
        // Vorschläge vom Server übernehmen und ausblenden
        page = (await anna.req('/farming/hof/1?tab=aufgaben')).text_;
        assert.match(page, /Vorschläge vom Server/);
        assert.equal((await anna.form('/farming/hof/1/vorschlag', { _csrf: t, key: 'wear:1' })).status, 302);
        assert.ok(sql.prepare("SELECT 1 FROM fs_tasks WHERE auto_key = 'wear:1'").get());
        const dieselSig = page.match(/name="key" value="diesel:1"><input type="hidden" name="sig" value="([^"]*)"/)[1];
        assert.equal((await anna.form('/farming/hof/1/ausblenden', { _csrf: t, key: 'diesel:1', sig: dieselSig })).status, 302);
        page = (await anna.req('/farming/hof/1?tab=aufgaben')).text_;
        assert.doesNotMatch(page, /value="wear:1"|value="diesel:1"/);

        // Hofkalender, Feld melden, Karte
        const weizen = sql.prepare("SELECT id FROM fs_crops WHERE name = 'Weizen'").get().id;
        assert.equal((await anna.form('/farming/hof/1/plan', { _csrf: t, field: '7', crop_id: String(weizen), sow_month: '', harvest_month: '' })).status, 302);
        assert.match((await anna.req('/farming/hof/1?tab=kalender')).text_, /Feld 7 · Weizen[\s\S]*?säen/);
        assert.equal((await bernd.form('/farming/feld/7', { _csrf: bernd.jar.get('csrf'), crop_id: String(weizen), state: 'reif' })).status, 403);
        assert.equal((await anna.form('/farming/feld/7', { _csrf: t, crop_id: String(weizen), state: 'reif' })).status, 302);
        page = (await anna.req('/farming/karte?feld=7&ansicht=zustand')).text_;
        assert.match(page, /<legend>Feld 7<\/legend>/);
        assert.match(page, /Zustand: <b>Erntereif<\/b>/);
        assert.match(page, /gemeldet von anna/);
        // Ort aus einem Palettenhaufen
        const spot = (await anna.req('/farming/hof/1?tab=produktion')).text_.match(/name="x" value="(-?\d+)"><input type="hidden" name="z" value="(-?\d+)"/);
        assert.ok(spot, 'Palettenhaufen ohne Ort');
        assert.equal((await anna.form('/farming/hof/1/ort', { _csrf: t, name: 'Fischzucht', x: spot[1], z: spot[2], radius: '40' })).status, 302);
        assert.match((await anna.req('/farming/hof/1?tab=produktion')).text_, /📍 Fischzucht<\/b> <span class="hint">\d+ Paletten/);

        // Preise und Modliste
        page = (await anna.req('/farming/preise?w=WHEAT')).text_;
        assert.match(page, /<legend>Weizen – € je 1 000 l<\/legend>/);
        assert.match(page, /bester Monat <b>Dezember<\/b>/);
        page = (await anna.req('/farming/mods')).text_;
        assert.match(page, /Bunker Silo Set Modular/);
        assert.match(page, /Kastor \[D-S-Agrarservice\]/);

        // Mods ändern sich auf dem Server: Changelog von selbst, Benachrichtigung an die Höfe
        over['stats.xml'] = fs.readFileSync(path.join(FX, 'stats.xml'), 'utf8').replace(/\s*<Mod name="FS25_CutOpenBale"[^\n]*/, '').replace('version="1.0.2.0"', 'version="1.0.3.0"');
        await admin.form('/admin/farming/testen', { _csrf: admin.jar.get('csrf') });
        page = (await anna.req('/farming/changelog')).text_;
        assert.match(page, /Mods geändert: 1 aktualisiert, 1 entfernt/);
        assert.match(page, /Additional Field Info: 1\.0\.2\.0 → 1\.0\.3\.0/);
        assert.ok(sql.prepare("SELECT 1 FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.username = 'anna' AND n.kind = 'fshub'").get());
        assert.equal((await anna.form('/farming/changelog', { _csrf: t, title: 'Ich' })).status, 403);
        assert.equal((await admin.form('/farming/changelog', { _csrf: admin.jar.get('csrf'), title: 'Neue Regeln für den Hof', body: 'Bitte lesen' })).status, 302);
        assert.match((await anna.req('/farming/changelog')).text_, /Neue Regeln für den Hof/);

        // Vorschläge: schreiben, abstimmen, Admin setzt den Stand
        assert.equal((await anna.form('/farming/vorschlaege', { _csrf: t, title: 'Biogasanlage bauen', body: 'Gülle loswerden' })).status, 302);
        const idea = sql.prepare("SELECT id FROM fs_suggestions WHERE title = 'Biogasanlage bauen'").get().id;
        assert.equal((await bernd.form(`/farming/vorschlaege/${idea}/stimme`, { _csrf: bernd.jar.get('csrf') })).status, 302);
        assert.equal((await bernd.form(`/farming/vorschlaege/${idea}/antwort`, { _csrf: bernd.jar.get('csrf'), status: 'geplant' })).status, 403);
        assert.equal((await admin.form(`/farming/vorschlaege/${idea}/antwort`, { _csrf: admin.jar.get('csrf'), status: 'geplant', answer: 'Machen wir im Herbst' })).status, 302);
        page = (await anna.req('/farming/vorschlaege')).text_;
        assert.match(page, /▲ 1/);
        assert.match(page, /📅 Geplant/);
        assert.match(page, /Machen wir im Herbst/);

        // Datum korrigieren, Gäste zulassen
        assert.equal((await admin.form('/admin/farming/datum', { _csrf: admin.jar.get('csrf'), dom: '2', month: '3', year: '8' })).status, 302);
        assert.match((await anna.req('/farming')).text_, /<b>2\. Juni<\/b>[\s\S]*?Jahr 8 · Spieltag 176 · korrigiert/);
        assert.equal((await admin.form('/admin/farming/allgemein', { _csrf: admin.jar.get('csrf'), fs_enabled: '1', fs_view: 'public', fs_edit: 'farm', fs_auto_wear: '50', fs_auto_diesel: '50', fs_auto_pallets: '6', fs_map_border: '25' })).status, 302);
        page = (await guest.req('/farming')).text_;
        assert.match(page, /<b>Chaosfarm<\/b>/);
        assert.match(page, /Melde dich an/);
        assert.equal((await guest.form('/farming/notizen', { _csrf: await guest.csrf('/login'), body: 'Gast' })).status, 302);
        assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM fs_notes WHERE body = 'Gast'").get().n, 0);
        sql.close();
      } finally { fx.close(); }
    });

    await step('Gelöschtes Konto verliert seine Statistik-Einträge', async () => {
      const { DatabaseSync } = require('node:sqlite');
      const sql = new DatabaseSync(path.join(DATA, 'site.db'), { timeout: 5000 });
      let t = await admin.csrf('/admin/users');
      const created = await admin.form('/admin/users/create', { _csrf: t, username: 'carla', password: 'passwort123' });
      const id = Number(created.headers.get('location').split('/').pop());
      const carla = browser();
      const tk = await carla.csrf();
      await carla.form('/login', { _csrf: tk, username: 'carla', password: 'passwort123' });
      await carla.req('/blog');
      await new Promise(r => setTimeout(r, 100));
      const count = () => sql.prepare('SELECT COUNT(*) AS n FROM pageviews WHERE user_id = ?').get(id).n;
      assert.ok(count() > 0, 'Aufruf mit Konto gezählt');
      t = await admin.csrf('/admin/users');
      assert.equal((await admin.form(`/admin/users/${id}/delete`, { _csrf: t })).status, 302);
      assert.equal(count(), 0);
      sql.close();
    });

    await step('Besucherstatistik zählt Aufrufe', async () => {
      const r = await admin.req('/admin?days=7');
      assert.match(r.text_, /Seitenaufrufe<b>[1-9]/);
    });
  } finally {
    server.child.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
  }
  if (failed) { console.error('\nServer-Log:\n' + server.getLog()); process.exit(1); }
  console.log('\nAlle Tests bestanden.');
}

main().catch(e => { console.error(e); process.exit(1); });
