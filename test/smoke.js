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
      for (const p of ['/admin', '/admin/posts', '/admin/posts/new', '/admin/media', '/admin/files', '/admin/mods', '/admin/mods/new',
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

      const acc = await admin.req('/account');
      assert.match(acc.text_, /Testspiel/);
      const t2 = acc.text_.match(/name="_csrf" value="([a-f0-9]+)"/)[1];
      assert.equal((await admin.form('/account/saves/delete', { _csrf: t2, app: 'testspiel', slot: 'slot_1' })).status, 200);
      assert.equal((await admin.req('/api/saves/testspiel/slot_1')).status, 404, 'gelöscht');
    });

    await step('Mein Haustier läuft unter /haustier/ und speichert im Konto', async () => {
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
      for (const [file, type] of [['js/main.js', /javascript/], ['js/pets.js', /javascript/], ['css/game.css', /css/], ['changelog.md', /markdown/]]) {
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
      assert.match((await admin.req('/account')).text_, /<a href="\/haustier\/">Mein Haustier<\/a>/);

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
      assert.equal((await api(bernd, `/musik/lobby/${id}`, { action: 'close' })).status, 403);
      assert.equal((await api(anna, `/musik/lobby/${id}`, { action: 'close' })).status, 200);
      ctrl.abort();
      assert.equal((await api(anna, `/musik/lobby/${id}`, { action: 'play' })).status, 404);
    });

    await step('Profile: Anzeigename, Sichtbarkeit, Suche und Links', async () => {
      const { anna, bernd } = members;
      let tk = await anna.csrf('/account');
      const save = (b, data) => b.form('/account/profil', { _csrf: tk, profile_visibility: 'members', pm_from: 'all', ...data });
      assert.match((await save(anna, { display_name: 'BERND' })).headers.get('location'), /err=taken/, 'fremder Benutzername');
      assert.match((await save(anna, { display_name: '<b>x</b>' })).headers.get('location'), /err=name/);
      assert.match((await save(anna, { display_name: '  Anna   B. ', about: 'Ich mag Katzen.' })).headers.get('location'), /ok=profil/);
      const acc = (await anna.req('/account?ok=profil')).text_;
      assert.match(acc, /Profil gespeichert/);
      assert.match(acc, /name="display_name" maxlength="32" value="Anna B\."/);

      // Nur Mitglieder sehen das Profil (Standard); Gäste finden es nicht in der Liste
      const asGuest = (await guest.req('/nutzer/anna')).text_;
      assert.match(asGuest, /nur angemeldete Mitglieder/);
      assert.doesNotMatch(asGuest, /Katzen/);
      assert.doesNotMatch((await guest.req('/nutzer')).text_, /\/nutzer\/anna"/);
      const asBernd = (await bernd.req('/nutzer/anna')).text_;
      assert.match(asBernd, /<h1>Anna B\.<\/h1>/);
      assert.match(asBernd, /Ich mag Katzen\./);
      assert.match((await bernd.req('/nutzer?q=anna')).text_, /href="\/nutzer\/anna"><b>Anna B\.<\/b>/);
      assert.equal((await bernd.req('/nutzer/gibtsnicht')).status, 404);

      // Öffentlich: auch Gäste sehen es
      assert.match((await save(anna, { display_name: 'Anna B.', about: 'Ich mag Katzen.', profile_visibility: 'public' })).headers.get('location'), /ok=profil/);
      assert.match((await guest.req('/nutzer/anna')).text_, /Ich mag Katzen\./);
      assert.match((await guest.req('/nutzer')).text_, /\/nutzer\/anna"/);

      // Anzeigename im Besucherbuch, Startmenü und als Link
      tk = await anna.csrf('/guestbook');
      await anna.form('/guestbook', { _csrf: tk, message: 'Hallo von Anna' });
      assert.match((await guest.req('/guestbook')).text_, /href="\/nutzer\/anna" class="userlink">[\s\S]*?Anna B\.<\/a>/);
      const desk = (await anna.req('/', { top: true })).text_;
      assert.match(desk, /<div class="startmenu"[\s\S]*href="\/nutzer"[\s\S]*href="\/nutzer\/anna">👤 Mein Profil[\s\S]*href="\/nachrichten"/);
      assert.match(desk, /Anna B\. abmelden/);
      assert.doesNotMatch((await guest.req('/', { top: true })).text_, /id="pmtray"/);
    });

    await step('Freunde: anfragen, annehmen, nur für Freunde sichtbar', async () => {
      const { anna, bernd } = members;
      let tk = await anna.csrf('/account');
      await anna.form('/account/profil', { _csrf: tk, display_name: 'Anna B.', about: 'Ich mag Katzen.', profile_visibility: 'friends', pm_from: 'friends' });
      assert.match((await bernd.req('/nutzer/anna')).text_, /sehen nur Freunde von Anna B\./);
      const friend = async (b, who, action) => { const t = await b.csrf('/nutzer/' + who); return b.form(`/nutzer/${who}/freund`, { _csrf: t, action, back: '/nutzer/' + who }); };
      assert.match((await friend(bernd, 'anna', 'add')).headers.get('location'), /\/nutzer\/anna\?ok=gesendet/);
      assert.match((await bernd.req('/nutzer/anna')).text_, /Anfrage zurückziehen/);
      const list = (await anna.req('/nutzer')).text_;
      assert.match(list, /Freundschaftsanfragen[\s\S]*\/nutzer\/bernd/);
      assert.match((await friend(anna, 'bernd', 'accept')).headers.get('location'), /ok=freunde/);
      const p = (await bernd.req('/nutzer/anna')).text_;
      assert.match(p, /Ich mag Katzen/, 'Freunde sehen das Profil');
      assert.match(p, /⭐ Freund/);
      assert.match((await anna.req('/nutzer')).text_, /Meine Freunde \(1\)[\s\S]*\/nutzer\/bernd/);
      // Gegenseitige Anfrage nimmt an, statt doppelt anzulegen
      assert.match((await friend(anna, 'bernd', 'remove')).headers.get('location'), /ok=entfernt/);
      await friend(anna, 'bernd', 'add');
      assert.match((await friend(bernd, 'anna', 'add')).headers.get('location'), /ok=freunde/);
    });

    await step('Privatnachrichten: schreiben, gelesen, nur von Freunden, löschen', async () => {
      const { anna, bernd } = members;
      const { DatabaseSync } = require('node:sqlite');
      const sql = new DatabaseSync(path.join(DATA, 'site.db'));
      const send = async (b, to, body) => { const t = await b.csrf('/account'); return b.form('/nachrichten/' + to, { _csrf: t, body }); };
      assert.equal((await send(bernd, 'anna', 'Hallo Anna!\nWie geht es dir?')).status, 302, 'Freunde dürfen schreiben');
      assert.equal(JSON.parse((await anna.req('/api/nachrichten')).text_).unread, 1);
      assert.equal(JSON.parse((await anna.req('/api/nachrichten?von=bernd')).text_).from, 1);
      const desk = (await anna.req('/', { top: true })).text_;
      assert.match(desk, /id="pmtray"[^>]*>💌<span class="pm-count">1</);
      assert.match(desk, /💌 Nachrichten \(1\)/);
      assert.match((await anna.req('/nachrichten')).text_, /<tr class="unread">[\s\S]*1 neu[\s\S]*Hallo Anna!/);
      const conv = (await anna.req('/nachrichten/bernd')).text_;
      assert.match(conv, /Hallo Anna!\nWie geht es dir\?/);
      assert.equal(JSON.parse((await anna.req('/api/nachrichten')).text_).unread, 0, 'beim Öffnen gelesen');
      assert.match((await bernd.req('/nachrichten/bernd')).text_, /gibt es nicht/, 'nicht an sich selbst');
      assert.match((await bernd.req('/nachrichten/anna')).text_, /✔✔ gelesen/);
      assert.equal((await guest.req('/nachrichten')).status, 302, 'Gäste müssen sich anmelden');

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
      t = await anna.csrf('/nachrichten/bernd');
      await anna.form('/nachrichten/bernd/loeschen', { _csrf: t });
      assert.match((await anna.req('/nachrichten')).text_, /Noch keine Nachrichten/);
      assert.match((await bernd.req('/nachrichten')).text_, /Klar!/);
      t = await bernd.csrf('/nachrichten/anna');
      await bernd.form('/nachrichten/anna/loeschen', { _csrf: t });
      assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM private_messages').get().n, 0);
      sql.close();
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
      fd.append('_csrf', await anna.csrf('/account'));
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
      bad.append('_csrf', await anna.csrf('/account'));
      bad.append('avatar', new Blob(['<svg onload=alert(1)>'], { type: 'image/png' }), 'x.png');
      assert.match((await anna.req('/account/avatar', { method: 'POST', body: bad })).headers.get('location'), /err=bild/);

      // JPEG: EXIF fällt weg, nur die Drehung bleibt (src/profiles.js nicht direkt laden: db.js gäbe sonst die Root-Rechte des Tests ab)
      const exif = Buffer.from('Exif\0\0MM\0*\0\0\0\x08\0\x02\x01\x12\0\x03\0\0\0\x01\0\x06\0\0\x88\x25\0\x04\0\0\0\x01\0\0\0\0\0\0\0\0GPS-GEHEIM', 'latin1');
      const seg = (m, data) => { const h = Buffer.from([0xff, m, 0, 0]); h.writeUInt16BE(data.length + 2, 2); return Buffer.concat([h, data]); };
      const jpg = Buffer.concat([Buffer.from([0xff, 0xd8]), seg(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1')), seg(0xe1, exif),
        seg(0xfe, Buffer.from('Kommentar')), seg(0xda, Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0])), Buffer.from([1, 2, 3, 0xff, 0xd9])]);
      const jfd = new FormData();
      jfd.append('_csrf', await anna.csrf('/account'));
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
      const t = await anna.csrf('/account');
      await anna.form('/account/profil', { _csrf: t, display_name: 'Anna B.', about: 'Ich mag Katzen.', profile_visibility: 'members', pm_from: 'all' });
      const prof = (await bernd.req('/nutzer/anna')).text_;
      const card = prof.slice(prof.indexOf('Spielstatistik'));
      assert.match(card, /Mein Haustier[\s\S]*Gestartet<\/td><td class="num">1<[\s\S]*Rekord<\/td><td class="num">10<[\s\S]*Siege<\/td><td class="num">3</);
      assert.match(card, /Höchste Stufe<\/td><td class="num">4<[\s\S]*Münzen verdient<\/td><td class="num">42</);
      assert.match(prof, /Forenbeiträge<\/td><td class="num">0</, 'anonyme Beiträge zählen nicht');
    });

    await step('Freundebuch im Profil: eintragen, Rechte, löschen', async () => {
      const { anna, bernd } = members;
      let t = await bernd.csrf('/account');
      assert.equal((await bernd.form('/nutzer/anna/freundebuch', { _csrf: t, body: 'Schönes Profil!\nGruß, Bernd' })).status, 302);
      let prof = (await anna.req('/nutzer/anna')).text_;
      assert.match(prof, /📖 Freundebuch \(1\)[\s\S]*href="\/nutzer\/bernd" class="userlink">[\s\S]*Schönes Profil!\nGruß, Bernd/);
      const id = prof.match(/id="g(\d+)"/)[1];
      assert.doesNotMatch((await guest.req('/nutzer/anna')).text_, /Schönes Profil/, 'nur wer das Profil sieht');
      // Nur Freunde dürfen schreiben: Bernd ist gerade kein Freund
      t = await anna.csrf('/account');
      await anna.form('/account/profil', { _csrf: t, display_name: 'Anna B.', about: 'Ich mag Katzen.', profile_visibility: 'members', pm_from: 'all', gb_from: 'friends' });
      assert.match((await bernd.req('/nutzer/anna')).text_, /nur Freunde von Anna B\. schreiben/);
      t = await bernd.csrf('/account');
      await bernd.form('/nutzer/anna/freundebuch', { _csrf: t, body: 'Darf ich nicht' });
      assert.doesNotMatch((await anna.req('/nutzer/anna')).text_, /Darf ich nicht/);
      // Fremde dürfen nicht löschen, die Profilinhaberin schon
      t = await bernd.csrf('/account');
      await bernd.form(`/nutzer/bernd/freundebuch/${id}/loeschen`, { _csrf: t });
      assert.match((await anna.req('/nutzer/anna')).text_, /Schönes Profil/);
      t = await anna.csrf('/account');
      await anna.form(`/nutzer/anna/freundebuch/${id}/loeschen`, { _csrf: t });
      prof = (await anna.req('/nutzer/anna')).text_;
      assert.doesNotMatch(prof, /Schönes Profil/);
      assert.match(prof, /Noch keine Einträge/);
      t = await anna.csrf('/account');
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

    await step('Blackjack: Tisch, Live-Verbindung, Runde, Bilanz im Profil', async () => {
      const { anna, bernd } = members;
      const home = (await guest.req('/', { top: true })).text_;
      assert.match(home, /<div class="startmenu"[\s\S]*href="\/blackjack">🃏 Blackjack/);
      assert.match(home, /href="\/guestbook">📖 Besucherbuch/);
      const page = (await guest.req('/blackjack')).text_;
      assert.match(page, /Anmelden/);
      assert.doesNotMatch(page, /blackjack\.js/, 'Gäste bekommen kein Spiel');
      assert.match((await anna.req('/blackjack')).text_, /usermenu\.js[\s\S]*blackjack\.js/);
      assert.equal((await api(guest, '/blackjack/tische', undefined, 'GET')).status, 401);
      // Zahlen zählt der Server selbst: Browser dürfen für Blackjack nichts melden
      assert.equal((await api(anna, '/api/stats/blackjack', { add: { Bilanz: 1e6 } }, 'PATCH')).status, 404);

      const made = await api(anna, '/blackjack/tische', { name: 'Freitagsrunde', minBet: 10, maxBet: 500, seats: 3 });
      assert.equal(made.status, 200);
      const id = made.json.id;
      const list = await api(bernd, '/blackjack/tische', undefined, 'GET');
      assert.deepEqual(list.json.tables.map(t => [t.name, t.seats]), [['Freitagsrunde', 3]]);
      assert.equal(list.json.me.balance, 0);

      const ctrl = new AbortController();
      const res = await fetch(`${BASE}/blackjack/tisch/${id}/events`, { headers: { cookie: [...anna.jar].map(([k, v]) => `${k}=${v}`).join('; '), 'user-agent': UA }, signal: ctrl.signal });
      assert.match(res.headers.get('content-type'), /text\/event-stream/);
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
      assert.equal(st.seatCount, 3);
      assert.equal((await api(anna, `/blackjack/tisch/${id}`, { action: 'sit' })).status, 200);
      st = await nextState();
      assert.equal(st.seats[0].user, 'anna');
      assert.deepEqual([st.seats[0].chips, st.seats[0].buyins, st.seats[0].balance], [1000, 1, 0]);
      const rebuy = await api(anna, `/blackjack/tisch/${id}`, { action: 'rebuy' });
      assert.equal(rebuy.status, 400);
      assert.match(rebuy.json.error, /weniger als 200 €/);
      assert.equal((await api(bernd, `/blackjack/tisch/${id}`, { action: 'kick', user: st.seats[0].id })).status, 400, 'nur der Gastgeber');

      // Eine Runde: setzen, beim eigenen Zug halten, Ergebnis abwarten
      assert.equal((await api(anna, `/blackjack/tisch/${id}`, { action: 'bet', amount: 100 })).status, 200);
      for (;;) {
        st = await nextState();
        if (st.phase === 'playing') assert.ok(st.dealer[1] === null, 'Lochkarte verdeckt');
        if (st.phase === 'playing' && st.turn && st.turn.seat === 0) await api(anna, `/blackjack/tisch/${id}`, { action: 'stand' });
        if (st.phase === 'result') break;
      }
      const balance = st.seats[0].balance;
      assert.equal(balance, st.seats[0].chips - 1000);
      assert.ok(['win', 'blackjack', 'push', 'lose', 'bust'].includes(st.seats[0].hands[0].result));
      ctrl.abort();

      const stats = await api(anna, '/blackjack/statistik', undefined, 'GET');
      assert.equal(stats.json.me.hands, 1);
      assert.equal(stats.json.me.balance, balance);
      assert.equal(stats.json.sessions[0].table, 'Freitagsrunde');
      assert.equal(stats.json.board[0].user, 'anna');
      const prof = (await bernd.req('/nutzer/anna')).text_;
      assert.match(prof, /href="\/blackjack"><b>Blackjack<\/b>[\s\S]*Bilanz<\/td><td class="num[^"]*">[−+±][\d.]+ €/);
      assert.match(prof, /Hände<\/td><td class="num">1</);

      // Aufstehen schließt die Sitzung ab, Gastgeber schließt den Tisch
      assert.equal((await api(anna, `/blackjack/tisch/${id}`, { action: 'close' })).status, 200);
      assert.equal((await api(anna, `/blackjack/tisch/${id}`, { action: 'sit' })).status, 404);
      const sql = new (require('node:sqlite').DatabaseSync)(path.join(DATA, 'site.db'));
      assert.ok(sql.prepare("SELECT s.ended_at FROM bj_sessions s JOIN users u ON u.id = s.user_id WHERE u.username = 'anna'").get().ended_at);
    });

    await step('Changelog im Startmenü', async () => {
      const home = (await guest.req('/', { top: true })).text_;
      assert.match(home, /<div class="startmenu"[\s\S]*href="\/changelog"/);
      assert.doesNotMatch(home.split('<div class="startmenu"')[0], /\/changelog/);
      const r = await guest.req('/changelog');
      assert.equal(r.status, 200);
      assert.match(r.text_, /Eröffnung/);
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
        /data-preset="Matrix"/, /name="titleFrom"/, /<option value="comic">/, /<option value="sehr-gross">/, /name="marquee" value="aus"/,
        /name="widgets"/, /name="css"/, /data-act="apply"/]) assert.match(panel, re);
      const data = JSON.parse(home.match(/<script type="application\/json" id="darstellung-daten">([^<]*)<\/script>/)[1]);
      assert.equal(data.presets.Matrix.desktop, '#001100');
      assert.match(data.fonts.comic.stack, /Comic Sans/);
      for (const [url, opts] of [['/', { top: true }], ['/blog', {}], ['/admin', null]]) {
        const page = (await (opts ? guest.req(url, opts) : admin.req(url))).text_;
        assert.match(page, /<head>[\s\S]*<script src="\/static\/display\.js\?v=\w+"><\/script>[\s\S]*<\/head>/, url);
      }
      assert.match((await admin.req('/admin')).text_, /id="displaybtn"/, 'auch in der Systemsteuerung');
      const js = await guest.req('/static/display.js');
      assert.equal(js.status, 200);
      assert.match(js.text_, /'darstellung'/);
      assert.doesNotMatch(js.text_, /fetch\(|XMLHttpRequest|sendBeacon|WebSocket/, 'Darstellung bleibt im Browser');
    });

    await step('Paint: malen ohne Konto, speichern mit Konto, Sichtbarkeit und Galerie', async () => {
      const { png } = require('./png');
      const desk = (await guest.req('/', { top: true })).text_;
      assert.match(desk, /<div class="startmenu"[\s\S]*href="\/paint"[\s\S]*href="\/galerie"/);
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
      assert.equal((await admin.form('/admin/paint', { _csrf: t, paint_enabled: '1', paint_guests: '1', paint_gallery: '1', paint_save: 'members', paint_quota_mb: '50', paint_max_w: '2000', paint_max_h: '2000' })).status, 302);
    });

    await step('Gelöschtes Konto verliert seine Statistik-Einträge', async () => {
      const { DatabaseSync } = require('node:sqlite');
      const sql = new DatabaseSync(path.join(DATA, 'site.db'));
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
