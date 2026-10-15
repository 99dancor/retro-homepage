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
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, ADMIN_USER: 'admin', ADMIN_PASSWORD: PASSWORD, PUID: '0' },
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
      for (const p of ['/', '/blog', '/files', '/mods', '/links', '/guestbook', '/contact', '/apps', '/forum', '/changelog', '/datenschutz', '/login', '/theme.css', '/static/retro.css', '/static/editor.js']) {
        const r = await guest.req(p);
        assert.equal(r.status, 200, p);
      }
      assert.equal((await guest.req('/gibtsnicht')).status, 404);
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
        '/admin/apps/new', '/admin/design', '/admin/settings']) {
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

    await step('Freundebuch-Eintrag als Gast', async () => {
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

    await step('Forum: anonym schreiben, nur Verfasser und Admin sehen den Namen', async () => {
      const anna = browser(), bernd = browser();
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
      assert.match(after, /👤 bernd/);
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
      assert.match(home, /id="displaypanel"[\s\S]*name="size" value="gross"[\s\S]*name="scheme" value="nacht"[\s\S]*name="still"/);
      for (const [url, opts] of [['/', { top: true }], ['/blog', {}], ['/admin', null]]) {
        const page = (await (opts ? guest.req(url, opts) : admin.req(url))).text_;
        assert.match(page, /<head>[\s\S]*<script src="\/static\/display\.js\?v=\w+"><\/script>[\s\S]*<\/head>/, url);
      }
      assert.match((await admin.req('/admin')).text_, /id="displaybtn"/, 'auch in der Systemsteuerung');
      const js = await guest.req('/static/display.js');
      assert.equal(js.status, 200);
      assert.match(js.text_, /'darstellung'/);
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
