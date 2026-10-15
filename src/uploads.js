'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');
const zlib = require('node:zlib');
const AdmZip = require('adm-zip');
const { db, now, UPLOAD_DIR, IMPORT_DIR, MEDIA_DIR, APPS_DIR, DATA_DIR } = require('./db');

// 0 = keine Grenze (Standard). Große Dateien landen beim Hochladen direkt im Download-Ordner, ohne Umweg.
const MAX_MB = Number(process.env.MAX_UPLOAD_MB || 0);
const TMP_DIR = path.join(DATA_DIR, 'tmp');
fs.mkdirSync(TMP_DIR, { recursive: true });

function fixName(name) {
  // Browser schicken UTF-8, busboy liest Latin-1 -> zurückwandeln
  const fixed = Buffer.from(name, 'latin1').toString('utf8');
  return fixed.includes('�') ? name : fixed;
}

function storageIn(dir) {
  return multer.diskStorage({
    destination: dir,
    filename: (req, file, cb) => {
      file.originalname = fixName(file.originalname);
      const ext = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 10);
      cb(null, crypto.randomBytes(16).toString('hex') + ext);
    },
  });
}

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp', 'image/x-icon', 'image/vnd.microsoft.icon'];

const fileUpload = multer({ storage: storageIn(UPLOAD_DIR), limits: { fileSize: MAX_MB > 0 ? MAX_MB * 1024 * 1024 : Infinity, files: 50 } });
const mediaUpload = multer({
  storage: storageIn(MEDIA_DIR),
  limits: { fileSize: 25 * 1024 * 1024, files: 20 },
  fileFilter: (req, file, cb) => cb(null, IMAGE_TYPES.includes(file.mimetype)),
});
const zipUpload = multer({ storage: storageIn(TMP_DIR), limits: { fileSize: 1024 * 1024 * 1024, files: 1 } });

function saveMedia(files) {
  const ins = db.prepare('INSERT INTO media(stored_name, original_name, mime, size, created_at) VALUES (?, ?, ?, ?, ?)');
  return (files || []).map(f => {
    ins.run(f.filename, f.originalname, f.mimetype, f.size, now());
    return { url: '/media/' + f.filename, name: f.originalname };
  });
}

// Entpackt ein HTML5-Spiel/App-ZIP nach data/apps/<slug>. Schützt vor "Zip Slip".
// Liegt alles in einem einzigen Unterordner, wird dieser als Wurzel verwendet.
function extractApp(zipPath, slug) {
  const target = path.join(APPS_DIR, slug);
  const staging = target + '.new-' + crypto.randomBytes(4).toString('hex');
  fs.mkdirSync(staging, { recursive: true });
  try {
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries().filter(e => !e.isDirectory && !e.entryName.startsWith('__MACOSX/'));
    if (!entries.length) throw new Error('Das ZIP ist leer.');
    const tops = new Set(entries.map(e => e.entryName.split('/')[0]));
    const strip = tops.size === 1 && entries.every(e => e.entryName.includes('/')) ? [...tops][0] + '/' : '';
    for (const e of entries) {
      const rel = e.entryName.slice(strip.length);
      const dest = path.resolve(staging, rel);
      if (!dest.startsWith(staging + path.sep)) throw new Error('Ungültiger Pfad im ZIP: ' + e.entryName);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, e.getData());
    }
    fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(staging, target);
    compressApp(target);
  } catch (err) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw err;
  } finally {
    fs.rmSync(zipPath, { force: true });
  }
  return target;
}

// Große Spieldateien (z. B. Godot: 38 MB .wasm) werden einmal im Hintergrund als .br und .gz abgelegt
// und dann komprimiert ausgeliefert (siehe /apps/:slug/play). Das spart rund drei Viertel der Ladezeit.
const COMPRESSIBLE = /\.(wasm|pck|data|js|mjs|json|html|css|svg|txt)$/i;
const MIN_COMPRESS_BYTES = 4096;
const compressing = new Set();

function compressFile(file) {
  if (compressing.has(file) || !COMPRESSIBLE.test(file)) return;
  if (fs.existsSync(file + '.br') || fs.existsSync(file + '.gz')) return;
  let buf;
  try { buf = fs.readFileSync(file); } catch { return; }
  if (buf.length < MIN_COMPRESS_BYTES) return;
  compressing.add(file);
  const write = (suffix, done) => (err, out) => {
    if (err) return done();
    const tmp = file + suffix + '.tmp-' + crypto.randomBytes(4).toString('hex');
    fs.writeFile(tmp, out, e => (e ? done() : fs.rename(tmp, file + suffix, () => { removeQuietly(tmp); done(); })));
  };
  let left = 2;
  const done = () => { if (--left === 0) compressing.delete(file); };
  zlib.brotliCompress(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } }, write('.br', done));
  zlib.gzip(buf, { level: 9 }, write('.gz', done));
}

function compressApp(dir) {
  let files = [];
  try { files = fs.readdirSync(dir, { recursive: true }); } catch { return; }
  for (const f of files) compressFile(path.join(dir, f));
}

function findEntry(dir) {
  if (fs.existsSync(path.join(dir, 'index.html'))) return 'index.html';
  const html = fs.readdirSync(dir).find(f => f.toLowerCase().endsWith('.html'));
  return html || 'index.html';
}

// Dateien im Eingangsordner, die fertig kopiert sind (seit 30 s unverändert)
function listImports() {
  let names = [];
  try { names = fs.readdirSync(IMPORT_DIR); } catch { return []; }
  const out = [];
  for (const name of names) {
    if (name.startsWith('.')) continue;
    let st;
    try { st = fs.statSync(path.join(IMPORT_DIR, name)); } catch { continue; }
    if (!st.isFile()) continue;
    out.push({ name, size: st.size, ready: Date.now() - st.mtimeMs > 30000 });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

// Verschiebt eine Datei aus dem Eingangsordner in den Download-Speicher (gleiche Platte: sofort).
function importFile(name) {
  const base = path.basename(name);
  const src = path.join(IMPORT_DIR, base);
  if (base !== name || base.startsWith('.') || !fs.statSync(src).isFile()) throw new Error('Ungültige Datei: ' + name);
  const ext = path.extname(base).toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 10);
  const stored = crypto.randomBytes(16).toString('hex') + ext;
  const dest = path.join(UPLOAD_DIR, stored);
  try {
    fs.renameSync(src, dest);
  } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    fs.copyFileSync(src, dest);
    fs.rmSync(src);
  }
  return { stored, original: base, size: fs.statSync(dest).size };
}

// Freier und gesamter Platz auf der Platte des Download-Ordners
function diskSpace() {
  try {
    const s = fs.statfsSync(UPLOAD_DIR);
    return { free: s.bavail * s.bsize, total: s.blocks * s.bsize };
  } catch { return null; }
}

function removeQuietly(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* egal */ } }

module.exports = { listImports, importFile, diskSpace, fileUpload, mediaUpload, zipUpload, saveMedia, extractApp, findEntry, removeQuietly, MAX_MB, COMPRESSIBLE, compressFile };
