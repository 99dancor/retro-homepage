'use strict';
// Desktop 2.0: eigene Ordner, Textdokumente, Verknüpfungen und Internetlinks (desk_items) und wohin die eigenen Dateien
// aus den Bibliotheken einsortiert sind (folder_items). Die Datenbank ist die Wahrheit: Ordner gibt es nur hier,
// die Dateien bleiben, wo sie immer lagen (data/uploads, data/musik, data/paint …). Kein Name eines Mitglieds
// erreicht je das Dateisystem.
const crypto = require('node:crypto');
const path = require('node:path');
const { db, now, getSetting, tx, UPLOAD_DIR, MEDIA_DIR } = require('./db');
const auth = require('./auth');
const paint = require('./paint');

const KINDS = ['folder', 'text', 'shortcut', 'link'];
const VIS = ['private', 'friends', 'members', 'public'];
const VIS_LABEL = { private: 'Nur ich', friends: 'Nur Freunde', members: 'Angemeldete', public: 'Öffentlich', groups: 'Gruppen (Admin)' };
const SHARE = ['friends', 'members', 'public'];
const DESKTOP = 0, LOOSE = -1, MAX_DEPTH = 5, GRID = 200;
const ICON = { folder: '📁', text: '📄', shortcut: '🔗', link: '🌐' };

// Bibliotheken: eigene Dateien, die es schon vor den Ordnern gab. Ein Ordner sortiert sie nur, die Zeile bleibt in ihrer Tabelle.
const LIB = {
  datei: { table: 'files', owner: 'uploader_id', name: 'title', date: 'created_at', label: 'Downloads', icon: '📁', type: 'file' },
  medien: { table: 'media', owner: 'uploader_id', name: 'original_name', date: 'created_at', label: 'Bilder in Beiträgen', icon: '🖼️' },
  titel: { table: 'tracks', owner: 'uploader_id', name: 'title', date: 'created_at', label: 'Mediaplayer', icon: '🎵', type: 'track' },
  playlist: { table: 'playlists', owner: 'user_id', name: 'title', date: 'updated_at', label: 'Playlists', icon: '📃', type: 'playlist' },
  bild: { table: 'artworks', owner: 'owner_id', name: 'title', date: 'updated_at', label: 'Paint-Bilder', icon: '🎨' },
  quiz: { table: 'quizzes', owner: 'user_id', name: 'title', date: 'updated_at', label: 'Quizze', icon: '❓' },
};

function limits() {
  const n = (k, d, min) => Math.max(min, Number(getSetting(k, d)) || 0);
  return { chars: n('desk_text_chars', '10000', 1), texts: n('desk_text_max', '100', 0), folders: n('desk_folders_max', '200', 0),
    links: n('desk_links_max', '100', 0), trashDays: n('desk_trash_days', '30', 1) };
}

// ---------- Prüfen, was hereinkommt ----------
// Namen: wie bei Windows ohne \ / : * ? " < > |, damit ein späterer Spiegel fürs NAS sie unverändert übernehmen kann
const BAD_NAME = /[\\/:*?"<>|\u0000-\u001f\u007f]/;
function checkName(v) {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return { error: 'Gib einen Namen ein.' };
  if (BAD_NAME.test(s)) return { error: 'Ein Name darf keines dieser Zeichen enthalten: \\ / : * ? " < > |' };
  if (s.length > 60) return { error: 'Ein Name darf höchstens 60 Zeichen lang sein.' };
  if (/^\.+$/.test(s) || /[. ]$/.test(s)) return { error: 'Ein Name darf nicht mit einem Punkt enden.' };
  return { name: s };
}
// Internetlinks: nur http(s), ohne Benutzername und Passwort in der Adresse
function cleanUrl(v) {
  const s = String(v ?? '').trim();
  if (!s || s.length > 2000) return null;
  let u;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : 'https://' + s); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password || !u.hostname) return null;
  return u.href.length <= 2000 ? u.href : null;
}
// Domain in Klarschrift: Die URL-Klasse liefert internationale Namen als Punycode (xn--…), so fallen Fälschungen auf
const hostOf = href => { try { return new URL(href).hostname; } catch { return ''; } };
// Verknüpfungen: eine Adresse auf dieser Seite (auch als volle Adresse eingefügt)
function cleanTarget(v, origin) {
  const s = String(v ?? '').trim();
  if (!s || s.length > 500) return null;
  let u;
  try { u = new URL(s, 'http://intern'); } catch { return null; }
  if (u.origin !== 'http://intern' && !(origin && u.origin === origin)) return null;
  if (u.pathname.startsWith('//') || /^\/(api|static|uploads|logout)(\/|$)/.test(u.pathname)) return null;
  u.searchParams.delete('embed');
  const out = u.pathname + u.search + u.hash;
  return out.length <= 500 ? out : null;
}
// Symbole sind Emojis oder kurze Zeichen, nie HTML
function cleanIcon(v) {
  const s = String(v ?? '').trim();
  return s && s.length <= 16 && !/[<>&"'\u0000-\u001f]/.test(s) && !/[A-Za-z0-9]{3}/.test(s) ? s : null;
}
const cleanVis = (v, d = 'private') => (VIS.includes(v) ? v : d);
const pos = v => (Number.isInteger(v) && v >= 0 && v < GRID ? v : null);

// ---------- Lesen ----------
function getItem(id) {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? db.prepare('SELECT * FROM desk_items WHERE id = ?').get(n) : null;
}
function own(user, id) {
  const it = getItem(id);
  return it && user && it.user_id === user.id ? it : null;
}
// Ordnerkette von innen nach außen (ohne den Desktop)
function ancestors(item) {
  const out = [];
  let p = item && item.parent_id;
  while (p && out.length < 50) {
    const f = getItem(p);
    if (!f) break;
    out.push(f);
    p = f.parent_id;
  }
  return out;
}
// Liegt der Eintrag im Papierkorb, selbst oder weil ein Ordner darüber drin liegt?
const trashed = item => !!item && (!!item.deleted_at || ancestors(item).some(a => a.deleted_at));
function folderTrashed(folderId) {
  if (!folderId || folderId < 0) return folderId < 0;
  const f = getItem(folderId);
  return !f || trashed(f);
}
// Tiefe eines Ordners: direkt auf dem Desktop = 1
const depth = folder => (folder ? ancestors(folder).length + 1 : 0);
// Alle Ordner unterhalb (mit dem Ordner selbst), auch die im Papierkorb
function subtree(folderId) {
  const ids = [folderId];
  for (let i = 0; i < ids.length && ids.length < 5000; i++) {
    for (const r of db.prepare("SELECT id FROM desk_items WHERE parent_id = ? AND kind = 'folder'").all(ids[i])) ids.push(r.id);
  }
  return ids;
}
function height(folderId) {
  let h = 0;
  (function walk(id, d) {
    h = Math.max(h, d);
    if (d < 20) for (const r of db.prepare("SELECT id FROM desk_items WHERE parent_id = ? AND kind = 'folder'").all(id)) walk(r.id, d + 1);
  })(folderId, 1);
  return h;
}

// Wer darf einen Desktop-Eintrag eines anderen sehen? Auch der Admin nicht, wenn er privat ist.
function canSeeDesk(viewer, item) {
  if (!item) return false;
  if (viewer && viewer.id === item.user_id) return true;
  if (item.kind === 'folder' || trashed(item)) return false;
  switch (item.visibility) {
    case 'public': return true;
    case 'members': return !!viewer;
    case 'friends': return !!viewer && auth.isFriend(viewer.id, item.user_id);
    default: return false;
  }
}

// Bibliothekseintrag mit Besitzer prüfen
function libRow(kind, id) {
  const L = LIB[kind], n = Number(id);
  return L && Number.isInteger(n) && n > 0 ? db.prepare(`SELECT * FROM ${L.table} WHERE id = ?`).get(n) : null;
}
function ownLib(user, kind, id) {
  const r = libRow(kind, id);
  return r && user && r[LIB[kind].owner] === user.id ? r : null;
}
// Darf viewer den Bibliothekseintrag sehen, egal in welchem Ordner er liegt?
function canSeeLib(viewer, kind, row) {
  if (!row) return false;
  const L = LIB[kind];
  if (viewer && row[L.owner] === viewer.id) return true;
  if (kind === 'bild') return paint.canSee(viewer, row);
  if (kind === 'quiz') return !!viewer && !!row.shared;
  if (kind === 'medien') return true;  // Bilder in Beiträgen sieht jeder, der die Adresse kennt
  return auth.canSee(viewer, L.type, row);
}

// Verknüpfung: Gibt es das Ziel noch, und darf viewer es öffnen? Unbekannte Adressen gelten als gültig.
function targetOk(viewer, target) {
  let u;
  try { u = new URL(target, 'http://intern'); } catch { return false; }
  const p = u.pathname.split('/').map(s => { try { return decodeURIComponent(s); } catch { return s; } });
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  switch (p[1]) {
    case 'forum':
      if (getSetting('board_enabled') !== '1' || (getSetting('board_members_only') === '1' && !viewer)) return false;
      return p[2] !== 't' || !!one('SELECT 1 FROM board_topics WHERE id = ?', Number(p[3]));
    case 'mods': return !p[2] || p[2] === 'neu' || auth.canSee(viewer, 'modlist', one('SELECT * FROM modlists WHERE slug = ?', p[2]));
    case 'nutzer': return !p[2] || require('./profiles').canViewProfile(viewer, one('SELECT * FROM users WHERE username = ?', p[2]));
    case 'files': return p[2] !== 'dl' || auth.canSee(viewer, 'file', libRow('datei', p[3]));
    case 'ansehen': return LIB[p[2]] ? canSeeLib(viewer, p[2], libRow(p[2], p[3])) : true;
    case 'blog': {
      if (!p[2]) return true;
      const b = one('SELECT * FROM posts WHERE slug = ?', p[2]);
      return !!b && !!b.published && auth.canSee(viewer, 'post', b);
    }
    case 'p': return auth.canSee(viewer, 'page', one('SELECT * FROM pages WHERE slug = ?', p[2]));
    case 'galerie': return !p[2] || paint.canSee(viewer, libRow('bild', p[2]));
    case 'apps': return !p[2] || auth.canSee(viewer, 'app', one('SELECT * FROM apps WHERE slug = ?', p[2]));
    case 'notizblock': case 'text': return !/^\d+$/.test(p[2] || '') || canSeeDesk(viewer, getItem(p[2]));
    case 'ordner': return !!shared(p[2], viewer);
    default: return true;
  }
}

function fileIcon(mime, name) {
  const m = String(mime || ''), e = path.extname(String(name || '')).toLowerCase();
  if (m.startsWith('image/')) return '🖼️';
  if (m.startsWith('video/')) return '🎬';
  if (m.startsWith('audio/')) return '🎵';
  if (/^\.(zip|rar|7z|gz|tar|bz2|xz)$/.test(e)) return '📦';
  if (/^\.(txt|md|log|ini|cfg|json)$/.test(e)) return '📄';
  if (/^\.(exe|msi|jar|apk|bat|sh)$/.test(e)) return '⚙️';
  return '💾';
}
// Kann der Browser die Datei selbst zeigen? Nur harmlose Arten, nie HTML oder SVG.
const VIEWABLE = /^(image\/(png|jpeg|gif|webp|avif|bmp)|video\/(mp4|webm|ogg)|audio\/(mpeg|ogg|wav|webm|mp4|aac|flac|x-wav|x-flac))$/;
const viewable = mime => VIEWABLE.test(String(mime || ''));

// Ein Eintrag, wie Desktop und Explorer ihn brauchen
function deskEntry(it, viewer) {
  const e = {
    ref: 'd:' + it.id, id: it.id, kind: it.kind, name: it.name, icon: it.icon || ICON[it.kind],
    vis: it.visibility, parent: it.parent_id || 0, x: it.pos_x, y: it.pos_y, date: it.updated_at,
  };
  if (it.kind === 'folder') { e.url = '/eigene-dateien?ordner=' + it.id; e.share = it.share ? { token: it.share, vis: it.share_vis } : null; }
  else if (it.kind === 'text') { e.url = '/notizblock/' + it.id; e.size = Buffer.byteLength(it.body || ''); }
  else if (it.kind === 'link') { e.url = it.target; e.host = hostOf(it.target); e.external = true; }
  else { e.url = it.target; e.broken = !targetOk(viewer, it.target); }
  if (it.deleted_at) e.deleted = it.deleted_at;
  return e;
}
function libUrl(kind, r) {
  switch (kind) {
    case 'datei': return '/ansehen/datei/' + r.id;
    case 'medien': return '/ansehen/medien/' + r.id;
    case 'titel': return '/musik?titel=' + r.id;
    case 'playlist': return '/musik?playlist=' + r.id;
    case 'bild': return '/paint?bild=' + r.id;
    default: return '/quiz';
  }
}
function libEntry(kind, r, fi) {
  const L = LIB[kind];
  return {
    ref: kind + ':' + r.id, id: r.id, kind, lib: true, name: r[L.name], url: libUrl(kind, r),
    icon: kind === 'datei' || kind === 'medien' ? fileIcon(r.mime, r.original_name) : kind === 'titel' && r.kind === 'video' ? '🎬' : kind === 'titel' && r.kind === 'youtube' ? '▶️' : L.icon,
    size: r.size || 0, date: r[L.date], vis: kind === 'quiz' ? (r.shared ? 'members' : 'private') : kind === 'medien' ? 'link' : r.visibility,
    folder: fi ? fi.folder_id : null, x: fi ? fi.pos_x : null, y: fi ? fi.pos_y : null,
    thumb: kind === 'bild' ? `/paint/bild/${r.id}/vorschau.png?v=${r.updated_at}` : kind === 'medien' ? '/media/' + r.stored_name : null,
    ...(fi && fi.trashed_at ? { deleted: fi.trashed_at } : {}),
  };
}
// Bibliothekseinträge zu folder_items-Zeilen (verwaiste Zeilen, deren Datei anderswo gelöscht wurde, fallen weg)
function libEntries(rows) {
  const out = [];
  for (const fi of rows) {
    const r = libRow(fi.kind, fi.item_id);
    if (r && r[LIB[fi.kind].owner] === fi.user_id) out.push(libEntry(fi.kind, r, fi));
  }
  return out;
}

// Inhalt eines Ordners (0 = Desktop) ohne Papierkorb
function children(userId, folderId, viewer) {
  const fid = Number(folderId) || 0;
  const desk = db.prepare(`SELECT * FROM desk_items WHERE user_id = ? AND ${fid ? 'parent_id = ?' : 'parent_id IS NULL'} AND deleted_at IS NULL
                           ORDER BY kind != 'folder', name COLLATE NOCASE`).all(...(fid ? [userId, fid] : [userId]));
  const lib = db.prepare('SELECT * FROM folder_items WHERE user_id = ? AND folder_id = ? AND trashed_at IS NULL').all(userId, fid);
  return [...desk.map(it => deskEntry(it, viewer)), ...libEntries(lib)];
}
// Eine Bibliothek: alles einer Art, egal in welchem Ordner (ohne Papierkorb)
function library(userId, kind) {
  if (kind === 'text') {
    return db.prepare("SELECT * FROM desk_items WHERE user_id = ? AND kind = 'text' ORDER BY updated_at DESC").all(userId)
      .filter(it => !trashed(it)).map(it => ({ ...deskEntry(it, null), folder: it.parent_id || 0 }));
  }
  const L = LIB[kind];
  if (!L) return [];
  const fis = new Map(db.prepare('SELECT * FROM folder_items WHERE user_id = ? AND kind = ?').all(userId, kind).map(f => [f.item_id, f]));
  return db.prepare(`SELECT * FROM ${L.table} WHERE ${L.owner} = ? ORDER BY ${L.date} DESC`).all(userId)
    .filter(r => { const f = fis.get(r.id); return !f || (!f.trashed_at && !folderTrashed(f.folder_id)); })
    .map(r => libEntry(kind, r, fis.get(r.id)));
}
function counts(userId) {
  const out = {};
  for (const [k, L] of Object.entries(LIB)) out[k] = db.prepare(`SELECT COUNT(*) AS n FROM ${L.table} WHERE ${L.owner} = ?`).get(userId).n;
  out.text = db.prepare("SELECT COUNT(*) AS n FROM desk_items WHERE user_id = ? AND kind = 'text'").get(userId).n;
  return out;
}
// Ordnerbaum für den Explorer: alle eigenen Ordner, die nicht im Papierkorb liegen
function tree(userId) {
  const all = db.prepare("SELECT id, parent_id, name, share, deleted_at FROM desk_items WHERE user_id = ? AND kind = 'folder' ORDER BY name COLLATE NOCASE").all(userId);
  const byParent = new Map();
  for (const f of all) { const k = f.parent_id || 0; if (!byParent.has(k)) byParent.set(k, []); byParent.get(k).push(f); }
  const walk = pid => (byParent.get(pid) || []).filter(f => !f.deleted_at).map(f => ({ id: f.id, name: f.name, shared: !!f.share, children: walk(f.id) }));
  return walk(0);
}
// Adresszeile: Desktop › Ordner › Unterordner
function crumbs(folder) {
  return folder ? [...ancestors(folder).reverse(), folder].map(f => ({ id: f.id, name: f.name })) : [];
}

// ---------- Anlegen und Ändern ----------
const count = (userId, kinds) => db.prepare(`SELECT COUNT(*) AS n FROM desk_items WHERE user_id = ? AND kind IN (${kinds.map(() => '?').join(',')})`).get(userId, ...kinds).n;
function nameTaken(userId, parentId, name, exceptId = 0) {
  return !!db.prepare(`SELECT 1 FROM desk_items WHERE user_id = ? AND ${parentId ? 'parent_id = ?' : 'parent_id IS NULL'} AND deleted_at IS NULL
                       AND name = ? COLLATE NOCASE AND id != ?`).get(...(parentId ? [userId, parentId] : [userId]), name, exceptId);
}
// „Neuer Ordner (2)“ wie bei Windows; bei Textdokumenten bleibt die Endung hinten
function uniqueName(userId, parentId, name, exceptId = 0) {
  if (!nameTaken(userId, parentId, name, exceptId)) return name;
  const m = /^(.*?)(\.[a-z0-9]{1,5})?$/i.exec(name), base = m[1].replace(/ \(\d+\)$/, '').slice(0, 52), ext = m[2] || '';
  for (let i = 2; i < 1000; i++) {
    const n = `${base} (${i})${ext}`;
    if (!nameTaken(userId, parentId, n, exceptId)) return n;
  }
  return name;
}
// Zielordner prüfen: 0 = Desktop, sonst ein eigener Ordner, der nicht im Papierkorb liegt
function targetFolder(user, folderId) {
  const fid = Number(folderId) || 0;
  if (!fid) return { id: 0, folder: null };
  const f = own(user, fid);
  if (!f || f.kind !== 'folder') return { error: 'Diesen Ordner gibt es nicht.' };
  if (trashed(f)) return { error: 'Der Ordner liegt im Papierkorb.' };
  return { id: f.id, folder: f };
}

const DEFAULT_NAME = { folder: 'Neuer Ordner', text: 'Neues Textdokument.txt' };
function create(user, b, origin) {
  const kind = b.kind, L = limits();
  if (!KINDS.includes(kind)) return { error: 'Unbekannte Art.' };
  const where = targetFolder(user, b.parent);
  if (where.error) return where;
  if (kind === 'folder') {
    if (count(user.id, ['folder']) >= L.folders) return { error: `Du hast schon ${L.folders} Ordner. Lösche alte, um neue anzulegen.` };
    if (depth(where.folder) >= MAX_DEPTH) return { error: `Ordner gehen höchstens ${MAX_DEPTH} Ebenen tief.` };
  } else if (kind === 'text') {
    if (count(user.id, ['text']) >= L.texts) return { error: `Du hast schon ${L.texts} Textdokumente. Lösche alte, um neue anzulegen.` };
  } else if (count(user.id, ['shortcut', 'link']) >= L.links) {
    return { error: `Du hast schon ${L.links} Verknüpfungen und Links. Lösche alte, um neue anzulegen.` };
  }
  let target = null, body = null;
  if (kind === 'link') {
    target = cleanUrl(b.target);
    if (!target) return { error: 'Das ist keine gültige Internetadresse. Sie muss mit http:// oder https:// beginnen.' };
  } else if (kind === 'shortcut') {
    target = cleanTarget(b.target, origin);
    if (!target) return { error: 'Eine Verknüpfung zeigt auf eine Seite hier. Für fremde Websites nimm eine Internetverknüpfung.' };
  } else if (kind === 'text') {
    body = String(b.body ?? '').replace(/\r\n?/g, '\n');
    if (body.length > L.chars) return { error: `Ein Textdokument darf höchstens ${L.chars.toLocaleString('de-DE')} Zeichen haben.` };
    if (!require('./quota').fits(user, Buffer.byteLength(body))) return { error: require('./quota').fullMessage(user) };
  }
  let name = b.name == null || String(b.name).trim() === '' ? DEFAULT_NAME[kind] || (kind === 'link' ? hostOf(target) : '') : b.name;
  if (!name && kind === 'shortcut') name = 'Verknüpfung';
  // Namen von Links und Verknüpfungen kommen oft aus Seitentiteln: unerlaubte Zeichen werden still ersetzt
  if (kind === 'link' || kind === 'shortcut') name = String(name).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').slice(0, 60).replace(/[. -]+$/, '') || 'Verknüpfung';
  const n = checkName(name);
  if (n.error) return n;
  const t = now();
  const id = Number(db.prepare(`INSERT INTO desk_items(user_id, kind, parent_id, name, target, icon, body, visibility, pos_x, pos_y, created_at, updated_at)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(user.id, kind, where.id || null, uniqueName(user.id, where.id, n.name), target, cleanIcon(b.icon), body,
      kind === 'folder' ? 'private' : cleanVis(b.visibility), where.id ? null : pos(b.x), where.id ? null : pos(b.y), t, t).lastInsertRowid);
  return { item: deskEntry(getItem(id), user) };
}

// Umbenennen, Symbol, Ziel und Sichtbarkeit (Eigenschaften)
function update(user, id, b, origin) {
  const it = own(user, id);
  if (!it) return { error: 'Diesen Eintrag gibt es nicht.' };
  const set = {};
  if (b.name !== undefined) {
    const n = checkName(b.name);
    if (n.error) return n;
    if (nameTaken(user.id, it.parent_id, n.name, it.id)) return { error: `Hier gibt es schon etwas mit dem Namen „${n.name}“.` };
    set.name = n.name;
  }
  if (b.icon !== undefined) set.icon = cleanIcon(b.icon);
  if (b.target !== undefined && it.kind === 'link') {
    set.target = cleanUrl(b.target);
    if (!set.target) return { error: 'Das ist keine gültige Internetadresse. Sie muss mit http:// oder https:// beginnen.' };
  }
  if (b.target !== undefined && it.kind === 'shortcut') {
    set.target = cleanTarget(b.target, origin);
    if (!set.target) return { error: 'Eine Verknüpfung zeigt auf eine Seite hier. Für fremde Websites nimm eine Internetverknüpfung.' };
  }
  if (b.visibility !== undefined && it.kind !== 'folder') set.visibility = cleanVis(b.visibility, it.visibility);
  if (!Object.keys(set).length) return { item: deskEntry(it, user) };
  set.updated_at = now();
  db.prepare(`UPDATE desk_items SET ${Object.keys(set).map(k => k + ' = ?').join(', ')} WHERE id = ?`).run(...Object.values(set), it.id);
  return { item: deskEntry(getItem(it.id), user) };
}

// Text speichern (Notizblock). Länge prüft der Server, nicht nur der Browser.
function saveText(user, id, body) {
  const it = own(user, id);
  if (!it || it.kind !== 'text') return { error: 'Dieses Textdokument gibt es nicht.' };
  const L = limits(), text = String(body ?? '').replace(/\r\n?/g, '\n');
  if (text.length > L.chars) return { error: `Das Dokument hat ${text.length.toLocaleString('de-DE')} Zeichen, erlaubt sind ${L.chars.toLocaleString('de-DE')}. Teile es auf mehrere Dateien auf.` };
  const quota = require('./quota');
  if (!quota.fits(user, Buffer.byteLength(text), Buffer.byteLength(it.body || ''))) return { error: quota.fullMessage(user) };
  db.prepare('UPDATE desk_items SET body = ?, updated_at = ? WHERE id = ?').run(text, now(), it.id);
  return { item: deskEntry(getItem(it.id), user) };
}

// Referenzen: "d:12" (Desktop-Eintrag), "datei:5", "bild:3" … (Bibliothek)
function parseRef(ref) {
  const m = /^([a-z]+):(\d+)$/.exec(String(ref || ''));
  if (!m) return null;
  if (m[1] === 'd') return { desk: true, id: Number(m[2]) };
  return LIB[m[1]] ? { kind: m[1], id: Number(m[2]) } : null;
}

// Verschieben in einen Ordner (0 = Desktop) oder mit folderId 'lib' zurück nur in die Bibliothek
function move(user, refs, folderId) {
  const toLib = folderId === 'lib';
  const where = toLib ? { id: null } : targetFolder(user, folderId);
  if (where.error) return where;
  const moved = [];
  const errors = [];
  tx(() => {
    for (const ref of [].concat(refs || []).slice(0, 500)) {
      const r = parseRef(ref);
      if (!r) continue;
      if (r.desk) {
        const it = own(user, r.id);
        if (!it || it.deleted_at || toLib) continue;
        if ((it.parent_id || 0) === where.id) continue;
        if (it.kind === 'folder') {
          if (where.id && subtree(it.id).includes(where.id)) { errors.push(`„${it.name}“ kann nicht in sich selbst liegen.`); continue; }
          if (depth(where.folder) + height(it.id) > MAX_DEPTH) { errors.push(`„${it.name}“ wäre dort tiefer als ${MAX_DEPTH} Ebenen.`); continue; }
        }
        db.prepare('UPDATE desk_items SET parent_id = ?, name = ?, pos_x = NULL, pos_y = NULL, updated_at = ? WHERE id = ?')
          .run(where.id || null, uniqueName(user.id, where.id, it.name, it.id), now(), it.id);
        moved.push(ref);
      } else {
        if (!ownLib(user, r.kind, r.id)) continue;
        const fi = db.prepare('SELECT * FROM folder_items WHERE kind = ? AND item_id = ?').get(r.kind, r.id);
        if (fi && fi.trashed_at) continue;
        if (toLib) db.prepare('DELETE FROM folder_items WHERE kind = ? AND item_id = ?').run(r.kind, r.id);
        else {
          db.prepare(`INSERT INTO folder_items(kind, item_id, user_id, folder_id) VALUES (?, ?, ?, ?)
                      ON CONFLICT(kind, item_id) DO UPDATE SET folder_id = excluded.folder_id, user_id = excluded.user_id, pos_x = NULL, pos_y = NULL`)
            .run(r.kind, r.id, user.id, where.id);
        }
        moved.push(ref);
      }
    }
  });
  return { moved, error: errors[0] || null };
}

// Platz auf dem Desktop-Raster; Standardsymbole (Schlüssel ohne Doppelpunkt) landen in den Desktop-Einstellungen
function place(user, list) {
  const sys = {};
  tx(() => {
    for (const p of [].concat(list || []).slice(0, 300)) {
      const x = pos(p && p.x), y = pos(p && p.y);
      if (x === null || y === null) continue;
      const r = parseRef(p.ref);
      if (r && r.desk) db.prepare('UPDATE desk_items SET pos_x = ?, pos_y = ? WHERE id = ? AND user_id = ? AND parent_id IS NULL').run(x, y, r.id, user.id);
      else if (r) db.prepare('UPDATE folder_items SET pos_x = ?, pos_y = ? WHERE kind = ? AND item_id = ? AND user_id = ? AND folder_id = 0').run(x, y, r.kind, r.id, user.id);
      else if (/^[\w-]{1,40}$/.test(String(p.ref))) sys[p.ref] = [x, y];
    }
  });
  // Wer Symbole zieht, ordnet sie ab jetzt selbst an
  const us = require('./usersettings'), d = us.get(user.id, 'desk');
  if (Object.keys(sys).length || d.arrange !== 'frei') us.set(user.id, 'desk', { ...d, arrange: 'frei', pos: { ...d.pos, ...sys } });
}

// ---------- Papierkorb ----------
// Was im Papierkorb liegt, sehen andere nicht mehr: Die bisherige Sichtbarkeit merkt sich prev, bis es zurückkommt.
function hideLib(kind, id) {
  const r = libRow(kind, id);
  if (!r || kind === 'medien') return null;
  if (kind === 'quiz') { db.prepare('UPDATE quizzes SET shared = 0 WHERE id = ?').run(id); return String(r.shared); }
  db.prepare(`UPDATE ${LIB[kind].table} SET visibility = 'private' WHERE id = ?`).run(id);
  return r.visibility;
}
function unhideLib(kind, id, prev) {
  if (prev == null || kind === 'medien') return;
  if (kind === 'quiz') db.prepare('UPDATE quizzes SET shared = ? WHERE id = ?').run(prev === '1' ? 1 : 0, id);
  else if ([...VIS, 'groups'].includes(prev)) db.prepare(`UPDATE ${LIB[kind].table} SET visibility = ? WHERE id = ?`).run(prev, id);
}
// Bibliothekseinträge in einem Ordnerbaum, die nicht schon selbst im Papierkorb liegen
const libIn = (userId, folderIds) => db.prepare(`SELECT * FROM folder_items WHERE user_id = ? AND trashed_at IS NULL
                                                 AND folder_id IN (${folderIds.map(() => '?').join(',')})`).all(userId, ...folderIds);

// keep: Bei Ordnern kommt der Inhalt eine Ebene höher, nur der leere Ordner geht in den Papierkorb
function trash(user, refs, keep) {
  let n = 0;
  if (keep) {
    for (const ref of [].concat(refs || []).slice(0, 500)) {
      const r = parseRef(ref), f = r && r.desk && own(user, r.id);
      if (!f || f.kind !== 'folder' || f.deleted_at) continue;
      const inside = [...db.prepare('SELECT id FROM desk_items WHERE parent_id = ? AND deleted_at IS NULL').all(f.id).map(c => 'd:' + c.id),
        ...db.prepare('SELECT kind, item_id FROM folder_items WHERE folder_id = ? AND trashed_at IS NULL').all(f.id).map(c => c.kind + ':' + c.item_id)];
      if (inside.length) move(user, inside, f.parent_id || 0);
    }
  }
  tx(() => {
    for (const ref of [].concat(refs || []).slice(0, 500)) {
      const r = parseRef(ref);
      if (!r) continue;
      if (r.desk) {
        const it = own(user, r.id);
        if (!it || it.deleted_at) continue;
        db.prepare('UPDATE desk_items SET deleted_at = ? WHERE id = ?').run(now(), it.id);
        if (it.kind === 'folder' && !ancestors(it).some(a => a.deleted_at)) {
          for (const fi of libIn(user.id, subtree(it.id))) {
            if (fi.prev == null) db.prepare('UPDATE folder_items SET prev = ? WHERE kind = ? AND item_id = ?').run(hideLib(fi.kind, fi.item_id), fi.kind, fi.item_id);
          }
        }
        n++;
      } else {
        if (!ownLib(user, r.kind, r.id)) continue;
        const fi = db.prepare('SELECT * FROM folder_items WHERE kind = ? AND item_id = ?').get(r.kind, r.id);
        if (fi && fi.trashed_at) continue;
        const prev = fi && fi.prev != null ? fi.prev : hideLib(r.kind, r.id);
        db.prepare(`INSERT INTO folder_items(kind, item_id, user_id, folder_id, trashed_at, prev) VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT(kind, item_id) DO UPDATE SET trashed_at = excluded.trashed_at, prev = excluded.prev`)
          .run(r.kind, r.id, user.id, LOOSE, now(), prev);
        n++;
      }
    }
  });
  return { trashed: n };
}

function restore(user, refs) {
  let n = 0;
  tx(() => {
    for (const ref of [].concat(refs || []).slice(0, 500)) {
      const r = parseRef(ref);
      if (!r) continue;
      if (r.desk) {
        const it = own(user, r.id);
        if (!it || !it.deleted_at) continue;
        // Liegt der Ordner darüber selbst im Papierkorb, kommt der Eintrag auf den Desktop
        const parentGone = ancestors(it).some(a => a.deleted_at);
        const parent = parentGone ? null : it.parent_id;
        db.prepare('UPDATE desk_items SET deleted_at = NULL, parent_id = ?, name = ?, updated_at = ? WHERE id = ?')
          .run(parent, uniqueName(user.id, parent, it.name, it.id), now(), it.id);
        if (it.kind === 'folder') {
          for (const fi of libIn(user.id, subtree(it.id))) {
            if (fi.prev == null || folderTrashed(fi.folder_id)) continue;
            unhideLib(fi.kind, fi.item_id, fi.prev);
            db.prepare('UPDATE folder_items SET prev = NULL WHERE kind = ? AND item_id = ?').run(fi.kind, fi.item_id);
          }
        }
        n++;
      } else {
        const fi = db.prepare('SELECT * FROM folder_items WHERE kind = ? AND item_id = ? AND user_id = ?').get(r.kind, r.id, user.id);
        if (!fi || !fi.trashed_at) continue;
        if (fi.folder_id === LOOSE) db.prepare('DELETE FROM folder_items WHERE kind = ? AND item_id = ?').run(r.kind, r.id);
        else {
          const gone = folderTrashed(fi.folder_id);
          db.prepare('UPDATE folder_items SET trashed_at = NULL, prev = NULL, folder_id = ? WHERE kind = ? AND item_id = ?')
            .run(gone ? DESKTOP : fi.folder_id, r.kind, r.id);
        }
        unhideLib(r.kind, r.id, fi.prev);
        n++;
      }
    }
  });
  return { restored: n };
}

// Endgültig löschen: die Datei selbst und ihre Zeile
function purgeLib(kind, id) {
  const r = libRow(kind, id);
  db.prepare('DELETE FROM folder_items WHERE kind = ? AND item_id = ?').run(kind, id);
  if (!r) return;
  const up = require('./uploads');
  switch (kind) {
    case 'datei':
      up.removeQuietly(path.join(UPLOAD_DIR, r.stored_name));
      db.prepare('DELETE FROM files WHERE id = ?').run(r.id);
      db.prepare("DELETE FROM acl WHERE item_type = 'file' AND item_id = ?").run(r.id);
      break;
    case 'medien':
      up.removeQuietly(path.join(MEDIA_DIR, r.stored_name));
      db.prepare('DELETE FROM media WHERE id = ?').run(r.id);
      break;
    case 'titel': require('./music').deleteTrack(r); break;
    case 'playlist': db.prepare('DELETE FROM playlists WHERE id = ?').run(r.id); break;
    case 'bild':
      db.prepare('DELETE FROM artworks WHERE id = ?').run(r.id);
      paint.removeFiles(r.stored_name);
      break;
    case 'quiz': require('./quiz').deleteQuiz({ id: r.user_id, isAdmin: false }, r.id); break;
  }
}
function purgeDesk(it) {
  if (it.kind === 'folder') for (const fi of db.prepare(`SELECT * FROM folder_items WHERE folder_id IN (${subtree(it.id).join(',')})`).all()) purgeLib(fi.kind, fi.item_id);
  db.prepare('DELETE FROM desk_items WHERE id = ?').run(it.id);  // Unterordner und ihr Inhalt gehen per ON DELETE CASCADE mit
}
// Nur was im Papierkorb liegt, lässt sich endgültig löschen
function purge(user, refs) {
  let n = 0;
  for (const ref of [].concat(refs || []).slice(0, 500)) {
    const r = parseRef(ref);
    if (!r) continue;
    if (r.desk) {
      const it = own(user, r.id);
      if (it && it.deleted_at) { purgeDesk(it); n++; }
    } else {
      const fi = db.prepare('SELECT * FROM folder_items WHERE kind = ? AND item_id = ? AND user_id = ?').get(r.kind, r.id, user.id);
      if (fi && fi.trashed_at && ownLib(user, r.kind, r.id)) { purgeLib(r.kind, r.id); n++; }
    }
  }
  return { purged: n };
}

// Papierkorb: was selbst gelöscht wurde und nicht in einem gelöschten Ordner steckt (das kommt mit dem Ordner zurück)
function trashList(userId) {
  const desk = db.prepare('SELECT * FROM desk_items WHERE user_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC').all(userId)
    .filter(it => !ancestors(it).some(a => a.deleted_at));
  const lib = db.prepare('SELECT * FROM folder_items WHERE user_id = ? AND trashed_at IS NOT NULL ORDER BY trashed_at DESC').all(userId)
    .filter(fi => fi.folder_id === LOOSE || !folderTrashed(fi.folder_id));
  return [...desk.map(it => deskEntry(it, null)), ...libEntries(lib)].sort((a, b) => b.deleted - a.deleted);
}
function emptyTrash(user) {
  return purge(user, trashList(user.id).map(e => e.ref));
}
// Alle paar Stunden: was länger als desk_trash_days im Papierkorb liegt, ist weg; verwaiste Zuordnungen ebenso
function purgeOld() {
  const cut = now() - limits().trashDays * 86400;
  for (const it of db.prepare('SELECT * FROM desk_items WHERE deleted_at IS NOT NULL AND deleted_at < ?').all(cut)) if (getItem(it.id)) purgeDesk(it);
  for (const fi of db.prepare('SELECT * FROM folder_items WHERE trashed_at IS NOT NULL AND trashed_at < ?').all(cut)) purgeLib(fi.kind, fi.item_id);
  for (const fi of db.prepare('SELECT kind, item_id, user_id FROM folder_items').all()) {
    const r = libRow(fi.kind, fi.item_id);
    if (!r || r[LIB[fi.kind].owner] !== fi.user_id) db.prepare('DELETE FROM folder_items WHERE kind = ? AND item_id = ?').run(fi.kind, fi.item_id);
  }
  db.prepare('DELETE FROM folder_items WHERE folder_id > 0 AND folder_id NOT IN (SELECT id FROM desk_items)').run();
}

// ---------- Freigabe von Ordnern ----------
// Der Link macht nichts sichtbarer: Wer ihn öffnet, sieht nur, was er ohnehin sehen dürfte.
function share(user, id, vis) {
  const it = own(user, id);
  if (!it || it.kind !== 'folder') return { error: 'Diesen Ordner gibt es nicht.' };
  if (!SHARE.includes(vis)) {
    db.prepare('UPDATE desk_items SET share = NULL, share_vis = NULL WHERE id = ?').run(it.id);
  } else {
    db.prepare('UPDATE desk_items SET share = ?, share_vis = ? WHERE id = ?').run(it.share || crypto.randomBytes(12).toString('base64url'), vis, it.id);
  }
  return { item: deskEntry(getItem(it.id), user) };
}
function shareAllows(viewer, f) {
  if (viewer && viewer.id === f.user_id) return true;
  if (f.share_vis === 'public') return true;
  if (f.share_vis === 'members') return !!viewer;
  return f.share_vis === 'friends' && !!viewer && auth.isFriend(viewer.id, f.user_id);
}
// Freigegebener Ordner, wie viewer ihn sieht, oder null
function shared(token, viewer) {
  if (!/^[\w-]{8,40}$/.test(String(token || ''))) return null;
  const f = db.prepare("SELECT * FROM desk_items WHERE share = ? AND kind = 'folder'").get(token);
  if (!f || trashed(f) || !shareAllows(viewer, f)) return null;
  const owner = db.prepare('SELECT id, username, display_name, disabled FROM users WHERE id = ?').get(f.user_id);
  if (!owner || owner.disabled) return null;
  const desk = db.prepare("SELECT * FROM desk_items WHERE parent_id = ? AND deleted_at IS NULL ORDER BY kind != 'folder', name COLLATE NOCASE").all(f.id);
  const items = [];
  for (const it of desk) {
    // Unterordner nur, wenn sie selbst freigegeben sind; Verknüpfungen sind persönliche Wegweiser und bleiben privat
    if (it.kind === 'folder') { if (it.share && shareAllows(viewer, it)) items.push({ ...deskEntry(it, viewer), url: '/ordner/' + it.share }); }
    else if (it.kind !== 'shortcut' && canSeeDesk(viewer, it)) items.push(deskEntry(it, viewer));
  }
  for (const e of libEntries(db.prepare('SELECT * FROM folder_items WHERE folder_id = ? AND trashed_at IS NULL').all(f.id))) {
    if (canSeeLib(viewer, e.kind, libRow(e.kind, e.id))) items.push(e);
  }
  return { folder: f, owner, items };
}

// ---------- Seitenverwaltung → Desktop ----------
// Was andere sehen können: freigegebene Ordner, nicht private Textdokumente und Internetlinks
function publicList() {
  return db.prepare(`SELECT d.id, d.kind, d.name, d.target, d.visibility, d.share, d.share_vis, d.updated_at, u.username, u.display_name
    FROM desk_items d JOIN users u ON u.id = d.user_id
    WHERE d.deleted_at IS NULL AND ((d.kind = 'folder' AND d.share IS NOT NULL) OR (d.kind IN ('text', 'link') AND d.visibility != 'private'))
    ORDER BY d.updated_at DESC LIMIT 300`).all();
}
// Der Admin nimmt etwas aus der Öffentlichkeit (Ordner verlieren die Freigabe, alles andere wird privat), auf Wunsch auch in den Papierkorb
function moderate(id, remove) {
  const it = getItem(Number(id));
  if (!it) return;
  if (it.kind === 'folder') db.prepare('UPDATE desk_items SET share = NULL, share_vis = NULL WHERE id = ?').run(it.id);
  else db.prepare("UPDATE desk_items SET visibility = 'private' WHERE id = ?").run(it.id);
  if (remove) db.prepare('UPDATE desk_items SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(now(), it.id);
}

module.exports = {
  KINDS, VIS, VIS_LABEL, SHARE, LIB, ICON, DESKTOP, LOOSE, MAX_DEPTH, GRID,
  limits, checkName, cleanUrl, cleanTarget, cleanIcon, hostOf, fileIcon, viewable,
  getItem, own, ancestors, trashed, depth, canSeeDesk, canSeeLib, libRow, ownLib, targetOk,
  deskEntry, libEntry, children, library, counts, tree, crumbs, parseRef,
  create, update, saveText, move, place, trash, restore, purge, trashList, emptyTrash, purgeOld, share, shared, publicList, moderate,
};
