'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');
const AdmZip = require('adm-zip');
const { db, now, UPLOAD_DIR, MEDIA_DIR, APPS_DIR, DATA_DIR } = require('./db');

const MAX_MB = Number(process.env.MAX_UPLOAD_MB || 4096);
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

const fileUpload = multer({ storage: storageIn(UPLOAD_DIR), limits: { fileSize: MAX_MB * 1024 * 1024, files: 50 } });
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
  } catch (err) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw err;
  } finally {
    fs.rmSync(zipPath, { force: true });
  }
  return target;
}

function findEntry(dir) {
  if (fs.existsSync(path.join(dir, 'index.html'))) return 'index.html';
  const html = fs.readdirSync(dir).find(f => f.toLowerCase().endsWith('.html'));
  return html || 'index.html';
}

function removeQuietly(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* egal */ } }

module.exports = { fileUpload, mediaUpload, zipUpload, saveMedia, extractApp, findEntry, removeQuietly, MAX_MB };
