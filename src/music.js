'use strict';
// Mediaplayer: Hochladen von Musik und Videos, Rechte und Titelangaben aus den Dateien (ID3-Tags bei MP3).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');
const { db, getSetting, MUSIC_DIR } = require('./db');

const AUDIO_EXT = ['.mp3', '.ogg', '.oga', '.opus', '.wav', '.flac', '.m4a', '.aac', '.webm', '.weba'];
const VIDEO_EXT = ['.mp4', '.m4v', '.webm', '.ogv', '.mov'];
const ext = file => path.extname(file.originalname).toLowerCase();
const isAudio = file => file.mimetype.startsWith('audio/') || AUDIO_EXT.includes(ext(file));
const isVideo = file => file.mimetype.startsWith('video/') || (VIDEO_EXT.includes(ext(file)) && !file.mimetype.startsWith('audio/'));
// .webm kann beides sein: der Browser sagt es mit dem Dateityp
const kindOf = file => (isVideo(file) && !(ext(file) === '.webm' && file.mimetype.startsWith('audio/')) ? 'video' : 'audio');

function fixName(name) {
  const fixed = Buffer.from(name, 'latin1').toString('utf8');
  return fixed.includes('�') ? name : fixed;
}
const storage = multer.diskStorage({
  destination: MUSIC_DIR,
  filename: (req, file, cb) => {
    file.originalname = fixName(file.originalname);
    const e = ext(file);
    cb(null, crypto.randomBytes(16).toString('hex') + (AUDIO_EXT.includes(e) || VIDEO_EXT.includes(e) ? e : ''));
  },
});
const fileFilter = (req, file, cb) => cb(null, isAudio(file) || isVideo(file));
// Admin: große Dateien (lange Mixe, Filme), Mitglieder: eine Datei bis 200 MB (für kurze Videos), insgesamt bis zur Speichergrenze
const MEMBER_FILE_MB = 200;
const adminUpload = multer({ storage, fileFilter, limits: { fileSize: 4 * 1024 * 1024 * 1024, files: 50 } });
const memberUpload = multer({ storage, fileFilter, limits: { fileSize: MEMBER_FILE_MB * 1024 * 1024, files: 1 } });

// Wer darf Musik hochladen? Einstellung unter Admin → Einstellungen
function canUpload(user) {
  if (!user) return false;
  if (user.isAdmin) return true;
  const mode = getSetting('music_upload', 'members');
  return mode === 'members' || (mode === 'upload' && user.canUpload);
}
function quotaBytes() { return Math.max(0, Number(getSetting('music_quota_mb', '500')) || 0) * 1024 * 1024; }
function usedBytes(userId) { return db.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM tracks WHERE uploader_id = ?').get(userId).n; }

// ---------- Titelangaben ----------
// ID3v2 (2.2 bis 2.4) am Anfang einer MP3, sonst ID3v1 am Ende. Andere Formate: nichts.
function decodeText(buf) {
  if (!buf.length) return '';
  const enc = buf[0];
  let body = buf.subarray(1), s;
  if (enc === 1 || enc === 2) {
    let le = enc === 1;
    if (body[0] === 0xff && body[1] === 0xfe) { le = true; body = body.subarray(2); }
    else if (body[0] === 0xfe && body[1] === 0xff) { le = false; body = body.subarray(2); }
    body = body.subarray(0, body.length - (body.length % 2));
    if (!le) { body = Buffer.from(body); body.swap16(); }
    s = body.toString('utf16le');
  } else s = body.toString(enc === 3 ? 'utf8' : 'latin1');
  return s.split('\0')[0].trim();
}
const syncsafe = (b, i) => ((b[i] & 0x7f) << 21) | ((b[i + 1] & 0x7f) << 14) | ((b[i + 2] & 0x7f) << 7) | (b[i + 3] & 0x7f);

function readTags(file) {
  const tags = {};
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(10);
    if (fs.readSync(fd, head, 0, 10, 0) === 10 && head.toString('latin1', 0, 3) === 'ID3') {
      const ver = head[3], size = Math.min(syncsafe(head, 6), 2 * 1024 * 1024);
      const tag = Buffer.alloc(size);
      fs.readSync(fd, tag, 0, size, 10);
      let i = 0;
      if (head[5] & 0x40) i = ver === 4 ? syncsafe(tag, 0) : tag.readUInt32BE(0) + 4; // erweiterter Kopf
      const idLen = ver === 2 ? 3 : 4, hdrLen = ver === 2 ? 6 : 10;
      const names = ver === 2 ? { TT2: 'title', TP1: 'artist', TAL: 'album' } : { TIT2: 'title', TPE1: 'artist', TALB: 'album' };
      while (i + hdrLen <= tag.length) {
        const id = tag.toString('latin1', i, i + idLen);
        if (!/^[A-Z0-9]+$/.test(id)) break;
        const len = ver === 2 ? tag.readUIntBE(i + 3, 3) : ver === 4 ? syncsafe(tag, i + 4) : tag.readUInt32BE(i + 4);
        if (names[id]) tags[names[id]] = decodeText(tag.subarray(i + hdrLen, i + hdrLen + len));
        i += hdrLen + len;
      }
    }
    if (!tags.title) {
      const st = fs.fstatSync(fd);
      const v1 = Buffer.alloc(128);
      if (st.size > 128 && fs.readSync(fd, v1, 0, 128, st.size - 128) === 128 && v1.toString('latin1', 0, 3) === 'TAG') {
        const field = (a, b) => v1.toString('latin1', a, b).split('\0')[0].trim();
        tags.title = field(3, 33); tags.artist ||= field(33, 63); tags.album ||= field(63, 93);
      }
    }
  } catch { /* ohne Angaben */ }
  finally { if (fd !== undefined) fs.closeSync(fd); }
  for (const k of Object.keys(tags)) { tags[k] = tags[k].slice(0, 200); if (!tags[k]) delete tags[k]; }
  return tags;
}

// "Interpret - Titel.mp3" -> { artist, title }
function fromFilename(name) {
  // vorangestellte Titelnummer ("03 - …", "03. …") weglassen
  const base = path.basename(name, path.extname(name)).replace(/_/g, ' ').trim().replace(/^\d{1,3}(?:\s*[-.]\s*|\s+)(?=\S)/, '');
  const m = base.match(/^(.+?)\s+[-–]\s+(.+)$/);
  return m ? { artist: m[1].trim(), title: m[2].trim() } : { title: base };
}

module.exports = { adminUpload, memberUpload, canUpload, quotaBytes, usedBytes, readTags, fromFilename, kindOf, MEMBER_FILE_MB, MUSIC_DIR, AUDIO_EXT, VIDEO_EXT };
