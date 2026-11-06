'use strict';
// Galerie: eigene Fotos in Alben, dazu die Paint-Bilder als eigener Bereich. Die Dateien liegen in uploads/galerie,
// also dort, wo auch die Downloads liegen (in Unraid die große Platte, siehe README → Download-Dateien).
// Beim Hochladen fliegen versteckte Angaben (GPS, Kamera, Seriennummer) aus der Datei; das Aufnahmedatum steht auf Wunsch
// nur in der Datenbank. HEIC vom iPhone wird mit ImageMagick zu JPG, sonst braucht der Server kein Zusatzpaket:
// Vorschau und mittlere Größe malt der Browser beim Hochladen (public/gallery.js).
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { execFile } = require('node:child_process');
const { db, now, getSetting, GAL_DIR } = require('./db');
const auth = require('./auth');
const profiles = require('./profiles');

const VIS = ['public', 'members', 'friends', 'private'];
const VIS_LABEL = { public: 'Öffentlich', members: 'Mitglieder', friends: 'Nur Freunde', private: 'Nur ich' };
const VIS_ICON = { public: '🌐', members: '👥', friends: '🤝', private: '🔒' };
const EXTS = ['jpg', 'png', 'gif', 'webp'];
const MIME = { jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
const MAX_THUMB = 400 * 1024, MAX_MEDIUM = 4 * 1024 * 1024;
const MAX_ALBUMS = 500, MAX_COMMENT = 1000;

const on = () => getSetting('paint_gallery', '1') === '1';
const maxBytes = () => Math.max(1, Number(getSetting('gallery_max_mb', '60')) || 60) * 1024 * 1024;
const canUpload = user => !!user && !user.disabled;
const nameOf = u => (u && (u.display_name || u.username)) || 'Gelöschtes Konto';

// ---------- Sichtbarkeit ----------
// Bilder in einem Album sind so sichtbar wie das Album (bei Freunden: Freunde des Albumbesitzers), Bilder ohne Album nach ihrer eigenen Einstellung.
// Besitzer des Bildes, Besitzer des Albums und der Admin sehen immer alles.
function canSeeAlbum(user, al) {
  if (!al) return false;
  if (user && (user.isAdmin || user.id === al.owner_id)) return true;
  if (al.owner_disabled) return false;
  return visOk(user, al.visibility, al.owner_id);
}
function visOk(user, vis, ownerId) {
  if (vis === 'public') return true;
  if (vis === 'members') return !!user;
  if (vis === 'friends') return !!user && auth.isFriend(user.id, ownerId);
  return false;
}
function canSeePhoto(user, p) {
  if (!p) return false;
  if (user && (user.isAdmin || user.id === p.owner_id || (p.album_id && user.id === p.al_owner))) return true;
  if (p.owner_disabled) return false;
  return p.album_id ? visOk(user, p.al_visibility, p.al_owner) : visOk(user, p.visibility, p.owner_id);
}
// Dasselbe als SQL (Aliase p für das Bild, al für das Album, u für den Besitzer)
function friendSql(me, col) {
  return `EXISTS (SELECT 1 FROM friends fr WHERE fr.accepted = 1 AND ((fr.user_id = ${me} AND fr.friend_id = ${col}) OR (fr.friend_id = ${me} AND fr.user_id = ${col})))`;
}
function photoSql(user) {
  if (user && user.isAdmin) return '1=1';
  const vis = "COALESCE(al.visibility, p.visibility)", owner = 'COALESCE(al.owner_id, p.owner_id)';
  if (!user) return `(u.disabled = 0 AND ${vis} = 'public')`;
  const me = Number(user.id);
  return `(p.owner_id = ${me} OR al.owner_id = ${me} OR (u.disabled = 0 AND (${vis} IN ('public','members') OR (${vis} = 'friends' AND ${friendSql(me, owner)}))))`;
}
function albumSql(user) {
  if (user && user.isAdmin) return '1=1';
  if (!user) return "(au.disabled = 0 AND al.visibility = 'public')";
  const me = Number(user.id);
  return `(al.owner_id = ${me} OR (au.disabled = 0 AND (al.visibility IN ('public','members') OR (al.visibility = 'friends' AND ${friendSql(me, 'al.owner_id')}))))`;
}
// Darf user Bilder in dieses Album legen? Besitzer immer, bei gemeinsamen Alben alle, die es sehen (angemeldet).
const canAddTo = (user, al) => !!user && !!al && (user.isAdmin || user.id === al.owner_id || (!!al.shared && al.visibility !== 'private' && canSeeAlbum(user, al)));
const canEditAlbum = (user, al) => !!user && !!al && (user.isAdmin || user.id === al.owner_id);
const canEditPhoto = (user, p) => !!user && !!p && (user.isAdmin || user.id === p.owner_id);
// Der Albumbesitzer darf fremde Bilder aus seinem Album nehmen (nicht löschen)
const canRemoveFromAlbum = (user, p) => canEditPhoto(user, p) || (!!user && !!p && !!p.album_id && user.id === p.al_owner);
const canComment = (user, p) => !!user && !!p && (!p.album_id || !!p.al_comments) && canSeePhoto(user, p);

// ---------- Lesen ----------
const PHOTO_COLS = `p.*, u.username, u.display_name, u.disabled AS owner_disabled, al.title AS al_title, al.owner_id AS al_owner,
  al.visibility AS al_visibility, al.comments AS al_comments, al.shared AS al_shared,
  (SELECT COUNT(*) FROM gal_comments c WHERE c.photo_id = p.id) AS n_comments`;
const PHOTO_FROM = 'gal_photos p JOIN users u ON u.id = p.owner_id LEFT JOIN gal_albums al ON al.id = p.album_id';
function getPhoto(id) {
  return db.prepare(`SELECT ${PHOTO_COLS} FROM ${PHOTO_FROM} WHERE p.id = ?`).get(Number(id)) || null;
}
function photos(user, where = '1=1', params = [], { order = 'p.created_at DESC, p.id DESC', limit = 2000 } = {}) {
  return db.prepare(`SELECT ${PHOTO_COLS} FROM ${PHOTO_FROM} WHERE ${photoSql(user)} AND ${where} ORDER BY ${order} LIMIT ?`).all(...params, limit);
}
const ALBUM_COLS = `al.*, au.username, au.display_name, au.disabled AS owner_disabled,
  (SELECT COUNT(*) FROM gal_photos x WHERE x.album_id = al.id) AS n_photos,
  (SELECT MAX(created_at) FROM gal_photos x WHERE x.album_id = al.id) AS last_photo`;
function getAlbum(id) {
  return db.prepare(`SELECT ${ALBUM_COLS} FROM gal_albums al JOIN users au ON au.id = al.owner_id WHERE al.id = ?`).get(Number(id)) || null;
}
function albums(user, where = '1=1', params = []) {
  return db.prepare(`SELECT ${ALBUM_COLS} FROM gal_albums al JOIN users au ON au.id = al.owner_id WHERE ${albumSql(user)} AND ${where}
                     ORDER BY COALESCE((SELECT MAX(created_at) FROM gal_photos x WHERE x.album_id = al.id), al.created_at) DESC, al.id DESC`).all(...params);
}
// Alben, in die user Bilder legen darf (eigene zuerst)
function addableAlbums(user) {
  if (!user) return [];
  return albums(user).filter(al => canAddTo(user, al)).sort((a, b) => (b.owner_id === user.id) - (a.owner_id === user.id));
}
// Bis zu drei Vorschaubilder für den Album-Stapel, das Titelbild oben
function covers(user, al) {
  const list = photos(user, 'p.album_id = ?', [al.id], { order: 'p.id = ' + (Number(al.cover_id) || 0) + ' DESC, p.created_at DESC', limit: 3 });
  return list.map(p => thumbUrl(p));
}
function contributors(albumId) {
  return db.prepare(`SELECT DISTINCT u.username, u.display_name FROM gal_photos p JOIN users u ON u.id = p.owner_id JOIN gal_albums al ON al.id = p.album_id
                     WHERE p.album_id = ? AND p.owner_id != al.owner_id ORDER BY u.username LIMIT 20`).all(albumId).map(nameOf);
}

const ver = p => p.rot + '-' + p.created_at;
const thumbUrl = p => `/galerie/datei/${p.id}/klein.jpg?v=${ver(p)}`;
function photoRow(p, user) {
  const full = `/galerie/datei/${p.id}.${p.ext}`;
  return {
    k: 'f', ref: 'f' + p.id, id: p.id, title: p.title, name: p.title + '.' + p.ext, ext: p.ext,
    thumb: p.has_thumb ? thumbUrl(p) : full, src: p.has_medium ? `/galerie/datei/${p.id}/mittel.jpg?v=${ver(p)}` : full, full, dl: full + '?download=1',
    w: p.width, h: p.height, rot: p.rot, size: p.size, date: p.created_at, taken: p.taken_at,
    by: nameOf(p), byUser: p.username, mine: !!user && user.id === p.owner_id,
    album: p.album_id ? { id: p.album_id, title: p.al_title } : null,
    vis: p.album_id ? p.al_visibility : p.visibility, comments: p.n_comments || 0,
    canEdit: canEditPhoto(user, p), canUnalbum: !!p.album_id && canRemoveFromAlbum(user, p), canComment: canComment(user, p),
    commentsOff: !!p.album_id && !p.al_comments,
  };
}
function paintRow(a, user) {
  return {
    k: 'p', ref: 'p' + a.id, id: a.id, title: a.title, name: a.title + '.png', ext: 'png',
    thumb: `/paint/bild/${a.id}/vorschau.png?v=${a.updated_at}`, src: `/paint/bild/${a.id}.png?v=${a.updated_at}`, full: `/paint/bild/${a.id}.png`,
    dl: `/paint/bild/${a.id}.png?download=1`, w: a.width, h: a.height, rot: 0, size: a.size, date: a.updated_at, taken: null,
    by: nameOf(a), byUser: a.username, mine: !!user && user.id === a.owner_id, album: null, vis: a.visibility,
    with: a.with_names || '', paint: '/paint?bild=' + a.id, page: '/galerie/' + a.id, pending: a.visibility === 'public' && !a.approved,
    comments: 0, canEdit: false, canComment: false,
  };
}
function albumRow(al, user) {
  return {
    id: al.id, title: al.title, description: al.description, vis: al.visibility, shared: !!al.shared, comments: !!al.comments,
    count: al.n_photos, by: nameOf(al), byUser: al.username, mine: !!user && user.id === al.owner_id, coverId: al.cover_id,
    date: al.last_photo || al.created_at, canEdit: canEditAlbum(user, al), canAdd: canAddTo(user, al),
  };
}

// ---------- Dateien ----------
const SAFE = /^[a-f0-9]{32}$/;
function file(p, variant) {
  if (!SAFE.test(p.stored_name)) throw new Error('name');
  return path.join(GAL_DIR, p.stored_name + (variant === 'v' ? '-v.jpg' : variant === 'm' ? '-m.jpg' : '.' + p.ext));
}
function removeFiles(list) {
  for (const p of [].concat(list || [])) {
    if (!p || !SAFE.test(p.stored_name)) continue;
    for (const v of [null, 'v', 'm']) fs.rm(file(p, v), { force: true }, () => {});
  }
}
const filesOf = userId => db.prepare('SELECT stored_name, ext FROM gal_photos WHERE owner_id = ?').all(userId);

// Bildart am Dateikopf (HEIC/HEIF am ftyp-Kasten)
function imageType(b) {
  if (b.length > 8 && b.readUInt32BE(0) === 0x89504e47) return 'png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length > 6 && b.toString('latin1', 0, 4) === 'GIF8') return 'gif';
  if (b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (b.length > 12 && b.toString('latin1', 4, 8) === 'ftyp' && /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(b.toString('latin1', 8, 12))) return 'heic';
  return null;
}

// Aufnahmedatum (DateTimeOriginal, sonst DateTime) aus dem EXIF-Block einer JPEG-Datei, als Unix-Zeit oder null.
// Die Kamera speichert Ortszeit ohne Zone; sie wird als Zeit des Servers gelesen.
function exifDate(b) {
  try {
    let i = 2;
    while (i + 4 <= b.length && b[i] === 0xff) {
      const m = b[i + 1];
      if (m === 0xda || m === 0xd9) break;
      const len = b.readUInt16BE(i + 2);
      if (m === 0xe1 && b.toString('latin1', i + 4, i + 10) === 'Exif\0\0') return tiffDate(b.subarray(i + 10, i + 2 + len));
      i += 2 + len;
    }
  } catch { /* kaputter Kopf: kein Datum */ }
  return null;
}
function tiffDate(t) {
  const le = t.toString('latin1', 0, 2) === 'II';
  const u16 = o => (le ? t.readUInt16LE(o) : t.readUInt16BE(o)), u32 = o => (le ? t.readUInt32LE(o) : t.readUInt32BE(o));
  const tags = ifd => {
    const out = {};
    if (ifd + 2 > t.length) return out;
    for (let k = 0, n = u16(ifd); k < n; k++) {
      const e = ifd + 2 + k * 12;
      if (e + 12 > t.length) break;
      out[u16(e)] = { type: u16(e + 2), count: u32(e + 4), at: e + 8 };
    }
    return out;
  };
  const ascii = tag => (tag && tag.type === 2 && tag.count >= 19 ? t.toString('latin1', u32(tag.at), u32(tag.at) + 19) : null);
  const ifd0 = tags(u32(4));
  const sub = ifd0[0x8769] ? tags(u32(ifd0[0x8769].at)) : {};
  return parseExifTime(ascii(sub[0x9003]) || ascii(sub[0x9004]) || ascii(ifd0[0x0132]));
}
function parseExifTime(s) {
  const m = /^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/.exec(String(s || ''));
  if (!m || m[1] === '0000') return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  const t = Math.floor(d.getTime() / 1000);
  return Number.isFinite(t) && t > 0 && t < now() + 86400 ? t : null;
}
// Drehung aus EXIF (5–8 heißt: Breite und Höhe sind vertauscht)
function jpegOrientation(b) {
  try {
    let i = 2;
    while (i + 4 <= b.length && b[i] === 0xff) {
      const m = b[i + 1];
      if (m === 0xda) break;
      const len = b.readUInt16BE(i + 2);
      if (m === 0xe1) return profiles.exifOrientation(b.subarray(i + 4, i + 2 + len));
      i += 2 + len;
    }
  } catch { /* egal */ }
  return 0;
}

// ImageMagick: IM7 heißt magick, IM6 convert. Einmal nachsehen, was da ist.
let tool;
function magick() {
  if (tool !== undefined) return Promise.resolve(tool);
  const tryCmd = (cmd, args) => new Promise(res => execFile(cmd, args, { timeout: 5000 }, err => res(!err)));
  return tryCmd('magick', ['-version']).then(ok => (ok ? 'magick' : tryCmd('convert', ['-version']).then(ok2 => (ok2 ? 'convert' : null))))
    .then(t => (tool = t));
}
function run(cmd, args) {
  return new Promise((res, rej) => execFile(cmd, args, { timeout: 120000, maxBuffer: 1024 * 1024 }, (err, out) => (err ? rej(err) : res(String(out)))));
}
// HEIC → JPG (gedreht wie aufgenommen, ohne Metadaten) und das Aufnahmedatum vorher auslesen
async function fromHeic(buf, keepDate) {
  const t = await magick();
  if (!t) throw new Error('HEIC-Bilder kann der Server noch nicht umwandeln (ImageMagick fehlt). Lade sie als JPG hoch.');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gal-'));
  try {
    const src = path.join(dir, 'in.heic'), out = path.join(dir, 'out.jpg');
    fs.writeFileSync(src, buf);
    let taken = null;
    if (keepDate) {
      const id = t === 'magick' ? ['magick', ['identify']] : ['identify', []];
      taken = parseExifTime(await run(id[0], [...id[1], '-format', '%[EXIF:DateTimeOriginal]', src + '[0]']).catch(() => ''));
    }
    await run(t, [src + '[0]', '-auto-orient', '-strip', '-quality', '90', out]);
    return { data: fs.readFileSync(out), taken };
  } catch (e) {
    if (e.message && e.message.startsWith('HEIC')) throw e;
    throw new Error('Das HEIC-Bild ließ sich nicht umwandeln.');
  } finally { fs.rm(dir, { recursive: true, force: true }, () => {}); }
}
// Vorschau (360 px) und mittlere Größe (1600 px) mit ImageMagick, wenn der Browser keine geschickt hat
async function makeSizes(data, ext, needMedium) {
  const t = await magick();
  if (!t) return {};
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gal-'));
  try {
    const src = path.join(dir, 'in.' + ext), v = path.join(dir, 'v.jpg'), m = path.join(dir, 'm.jpg');
    fs.writeFileSync(src, data);
    const first = src + '[0]';
    await run(t, [first, '-auto-orient', '-thumbnail', '360x360>', '-background', 'white', '-flatten', '-quality', '82', v]);
    if (needMedium) await run(t, [first, '-auto-orient', '-resize', '1600x1600>', '-background', 'white', '-flatten', '-quality', '85', m]);
    return { thumb: fs.readFileSync(v), medium: needMedium ? fs.readFileSync(m) : null };
  } catch { return {}; } finally { fs.rm(dir, { recursive: true, force: true }, () => {}); }
}
const isJpeg = b => Buffer.isBuffer(b) && imageType(b) === 'jpg';
const needsMedium = (w, h, size, ext) => ext !== 'gif' && (Math.max(w, h) > 2000 || size > 2.5 * 1024 * 1024);

// Prüft und säubert ein hochgeladenes Bild. Ergebnis: { ext, data, w, h, taken, thumb, medium, hash }; wirft mit verständlicher Meldung.
async function prepare(buf, { thumb = null, medium = null, keepDate = true } = {}) {
  let type = imageType(buf), data = buf, taken = null;
  if (!type) throw new Error('Das ist kein Bild (JPG, PNG, GIF, WebP oder HEIC).');
  if (type === 'heic') {
    ({ data, taken } = await fromHeic(buf, keepDate));
    type = 'jpg';
    thumb = medium = null;              // der Browser konnte das HEIC nicht malen, also auch keine Vorschau
  } else {
    if (type === 'jpg' && keepDate) taken = exifDate(buf);
    try { data = { jpg: profiles.stripJpeg, png: profiles.stripPng, webp: profiles.stripWebp, gif: b => b }[type](buf); } catch { throw new Error('Das Bild ist beschädigt.'); }
  }
  let d = profiles.imageSize(data, type) || { w: 0, h: 0 };
  if (type === 'jpg' && jpegOrientation(data) >= 5) d = { w: d.h, h: d.w };
  if (thumb && (!isJpeg(thumb) || thumb.length > MAX_THUMB)) thumb = null;
  if (medium && (!isJpeg(medium) || medium.length > MAX_MEDIUM)) medium = null;
  const wantMedium = needsMedium(d.w, d.h, data.length, type);
  if (!wantMedium) medium = null;
  if (!thumb || (wantMedium && !medium)) {
    const s = await makeSizes(data, type, wantMedium && !medium);
    thumb = thumb || s.thumb || null;
    medium = medium || s.medium || null;
  }
  return { ext: type, data, w: d.w, h: d.h, taken, thumb, medium, hash: crypto.createHash('sha256').update(data).digest('hex') };
}
function store(f) {
  const name = crypto.randomBytes(16).toString('hex'), p = { stored_name: name, ext: f.ext };
  fs.writeFileSync(file(p), f.data);
  if (f.thumb) fs.writeFileSync(file(p, 'v'), f.thumb);
  if (f.medium) fs.writeFileSync(file(p, 'm'), f.medium);
  return name;
}
const totalSize = f => f.data.length + (f.thumb ? f.thumb.length : 0) + (f.medium ? f.medium.length : 0);
const cleanTitle = (s, fallback = 'Bild') => String(s ?? '').replace(/[\p{C}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || fallback;
const baseName = n => cleanTitle(String(n || '').replace(/^.*[\\/]/, '').replace(/\.[a-z0-9]{2,5}$/i, ''));

// ---------- Kommentare ----------
function comments(photoId) {
  return db.prepare(`SELECT c.id, c.body, c.created_at, c.user_id, u.username, u.display_name, u.avatar FROM gal_comments c JOIN users u ON u.id = c.user_id
                     WHERE c.photo_id = ? ORDER BY c.created_at, c.id LIMIT 500`).all(photoId);
}
function addComment(user, p, body) {
  const text = String(body ?? '').replace(/\r\n?/g, '\n').replace(/[^\P{C}\n]/gu, '').trim().slice(0, MAX_COMMENT);
  if (!text) throw new Error('Schreib etwas.');
  const recent = db.prepare('SELECT COUNT(*) AS n FROM gal_comments WHERE user_id = ? AND created_at > ?').get(user.id, now() - 60).n;
  if (recent >= 10 && !user.isAdmin) throw new Error('Langsam, bitte. Warte eine Minute.');
  const id = Number(db.prepare('INSERT INTO gal_comments(photo_id, user_id, body, created_at) VALUES (?, ?, ?, ?)').run(p.id, user.id, text, now()).lastInsertRowid);
  if (p.owner_id !== user.id) {
    require('./notify').send(p.owner_id, 'galerie', {
      key: 'gal-c-' + p.id, title: `💬 ${nameOf(user)} hat dein Bild „${p.title}“ kommentiert`, body: text.slice(0, 140), url: '/galerie?bild=' + p.id,
    });
  }
  return id;
}

// ---------- Album als ZIP ----------
// Ohne Packen (Fotos sind schon gepackt), gestreamt mit Datenbeschreibung nach jeder Datei, Zip64 ab 4 GB.
function zipTo(res, list, zipName) {
  const enc = s => Buffer.from(s, 'utf8');
  const dos = t => {
    const d = new Date(t * 1000);
    return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
  };
  const used = new Set();
  const unique = n => {
    let name = n.replace(/[\\/:*?"<>|]+/g, '_'), i = 1;
    while (used.has(name.toLowerCase())) name = n.replace(/(\.[^.]+)?$/, ` (${++i})$1`);
    used.add(name.toLowerCase());
    return name;
  };
  res.set({ 'Content-Type': 'application/zip', 'Cache-Control': 'no-store' });
  res.attachment(zipName);
  let offset = 0;
  const central = [];
  const write = b => { offset += b.length; return res.write(b); };
  let i = 0, aborted = false;
  res.on('close', () => { aborted = true; });
  function next() {
    if (aborted) return;
    if (i >= list.length) return finish();
    const item = list[i++];
    if (!fs.existsSync(item.path)) return next();
    const name = enc(unique(item.name)), d = dos(item.time || now()), start = offset;
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(45, 4); h.writeUInt16LE(0x0808, 6); h.writeUInt16LE(0, 8);
    h.writeUInt16LE(d.time, 10); h.writeUInt16LE(d.date, 12); h.writeUInt16LE(name.length, 26);
    write(h); write(name);
    let crc = 0, size = 0;
    const rs = fs.createReadStream(item.path);
    rs.on('data', c => { crc = zlib.crc32(c, crc); size += c.length; if (!write(c)) { rs.pause(); res.once('drain', () => rs.resume()); } });
    rs.on('error', () => res.destroy());
    rs.on('end', () => {
      const dd = Buffer.alloc(16);
      dd.writeUInt32LE(0x08074b50, 0); dd.writeUInt32LE(crc >>> 0, 4); dd.writeUInt32LE(size, 8); dd.writeUInt32LE(size, 12);
      write(dd);
      central.push({ name, crc, size, start, d });
      next();
    });
  }
  function finish() {
    const cdStart = offset;
    for (const c of central) {
      const big = c.start >= 0xffffffff;
      const extra = big ? Buffer.alloc(12) : Buffer.alloc(0);
      if (big) { extra.writeUInt16LE(1, 0); extra.writeUInt16LE(8, 2); extra.writeBigUInt64LE(BigInt(c.start), 4); }
      const h = Buffer.alloc(46);
      h.writeUInt32LE(0x02014b50, 0); h.writeUInt16LE(45, 4); h.writeUInt16LE(45, 6); h.writeUInt16LE(0x0808, 8); h.writeUInt16LE(0, 10);
      h.writeUInt16LE(c.d.time, 12); h.writeUInt16LE(c.d.date, 14); h.writeUInt32LE(c.crc >>> 0, 16); h.writeUInt32LE(c.size, 20); h.writeUInt32LE(c.size, 24);
      h.writeUInt16LE(c.name.length, 28); h.writeUInt16LE(extra.length, 30); h.writeUInt32LE(big ? 0xffffffff : c.start, 42);
      write(h); write(c.name); write(extra);
    }
    const cdSize = offset - cdStart, n = central.length;
    if (cdStart >= 0xffffffff || n >= 0xffff) {
      const z = Buffer.alloc(56), zOff = offset;
      z.writeUInt32LE(0x06064b50, 0); z.writeBigUInt64LE(44n, 4); z.writeUInt16LE(45, 12); z.writeUInt16LE(45, 14);
      z.writeBigUInt64LE(BigInt(n), 24); z.writeBigUInt64LE(BigInt(n), 32); z.writeBigUInt64LE(BigInt(cdSize), 40); z.writeBigUInt64LE(BigInt(cdStart), 48);
      write(z);
      const l = Buffer.alloc(20);
      l.writeUInt32LE(0x07064b50, 0); l.writeBigUInt64LE(BigInt(zOff), 8); l.writeUInt32LE(1, 16);
      write(l);
    }
    const e = Buffer.alloc(22);
    e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(Math.min(n, 0xffff), 8); e.writeUInt16LE(Math.min(n, 0xffff), 10);
    e.writeUInt32LE(Math.min(cdSize, 0xffffffff), 12); e.writeUInt32LE(Math.min(cdStart, 0xffffffff), 16);
    res.end(e);
  }
  next();
}

module.exports = {
  VIS, VIS_LABEL, VIS_ICON, EXTS, MIME, MAX_ALBUMS, on, maxBytes, canUpload, nameOf,
  canSeeAlbum, canSeePhoto, canAddTo, canEditAlbum, canEditPhoto, canRemoveFromAlbum, canComment, photoSql, albumSql,
  getPhoto, photos, getAlbum, albums, addableAlbums, covers, contributors, photoRow, paintRow, albumRow, thumbUrl,
  file, removeFiles, filesOf, imageType, exifDate, parseExifTime, magick, prepare, store, totalSize, cleanTitle, baseName,
  comments, addComment, zipTo,
};
