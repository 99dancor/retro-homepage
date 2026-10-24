'use strict';
// Die Programme des Startmenüs an einem Ort: Das Startmenü (views/partials/startmenu.ejs) zeichnet sie,
// die Suche in der Taskleiste findet sie, und der Desktop legt aus ihnen Verknüpfungen an.
// Einträge: [Schlüssel, Adresse, Beschriftung] oder [Gruppe, Beschriftung, [Einträge]] → Untermenü wie bei Windows 98

function menu(user) {
  return [['blog', '/blog', '📝 Blog'],
    ['dokumente', '📂 Dokumente', [...(user ? [['eigene-dateien', '/eigene-dateien', '🗂️ Eigene Dateien'], ['notizblock', '/notizblock', '🗒️ Notizblock']] : []), ...(user && user.canUpload ? [['upload', '/files/upload', '📤 Datei hochladen']] : []), ['files', '/files', '📁 Downloads'], ['mods', '/mods', '🧩 Modlisten'], ['links', '/links', '🔗 Links'], ['galerie', '/galerie', '🖼️ Galerie']]],
    ['spiele', '🎮 Spiele und Apps', [['kartenspiele', '/kartenspiele', '🂡 Kartenspiele'], ['quiz', '/quiz', '❓ Quiz'], ['werwolf', '/werwolf', '🐺 Werwolf'], ['minesweeper', '/minesweeper', '💣 Minesweeper'], ['kreuzwortraetsel', '/kreuzwortraetsel', '📰 Kreuzworträtsel'], ['sudoku', '/sudoku', '🔢 Sudoku'], ['paint', '/paint', '🎨 Paint'], ['zufall', '/zufall', '🎲 Zufallsgenerator'], ['musik', '/musik', '🎵 Mediaplayer'], ['apps', '/apps', '🕹️ Andere Games']]],
    ['haustier', '/haustier/', '🐾 Pixelpfoten'], ['board', '/forum', '💬 Forum'], ['nutzer', '/messenger', '🌼 Messenger'], ['guestbook', '/guestbook', '📖 Besucherbuch'], ['contact', '/contact', '✉️ Kontakt']];
}

// Symbole, die als Bild gezeichnet werden (retro.css .sym-…): Der Messenger zeigt je nach Design die ICU-Blume oder die
// DSN-Männchen, die Kartenspiele eine richtige Spielkarte. Das Zeichen bleibt im Text (z. B. beim Ziehen auf den Desktop) und
// dient als Ersatz, wo kein Bild hinkommt. Gegenstück im Browser: WinUI.ico (public/winui.js).
const IMG = { '🌼': 'msgr', '🂡': 'karten' };
const escHtml = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function ico(icon) {
  return IMG[icon] ? `<i class="sym sym-${IMG[icon]}" aria-hidden="true">${icon}</i>` : escHtml(icon);
}
// Beschriftung „🌼 Messenger“ als HTML, mit Bild-Symbol wo es eins gibt
function labelHtml(label) {
  const sp = label.indexOf(' ');
  return sp > 0 ? ico(label.slice(0, sp)) + escHtml(label.slice(sp)) : escHtml(label);
}

// Abgeschaltete Bereiche (Seitenverwaltung) verschwinden aus Startmenü, Suche und Desktop
function off(l) {
  return {
    guestbook: !l.guestbookEnabled, board: !l.boardEnabled, kartenspiele: !l.cardsEnabled, paint: !l.paintEnabled,
    quiz: !l.quizEnabled, werwolf: !l.werwolfEnabled, galerie: !l.galleryEnabled, contact: !l.contactEnabled,
  };
}

// Alle Programme flach und ungefiltert: { key, url, icon, name, group }
function flat(user) {
  const out = [];
  (function walk(entries, group) {
    for (const e of entries) {
      if (Array.isArray(e[2])) { walk(e[2], e[1].replace(/^\S+\s/, '')); continue; }
      const [key, url, label] = e, sp = label.indexOf(' ');
      out.push({ key, url, icon: label.slice(0, sp), name: label.slice(sp + 1), group: group || '' });
    }
  })(menu(user), '');
  return out;
}
// Nur die sichtbaren. l sind die res.locals einer Seite.
function list(l) {
  const hidden = l.navHidden || [], offs = off(l);
  const out = flat(l.user).filter(p => !(hidden.includes(p.key) || offs[p.key]));
  out.push({ key: 'einstellungen', url: '/einstellungen', icon: '🛠️', name: 'Systemsteuerung', group: '' });
  if (l.user && l.user.isAdmin) out.push({ key: 'admin', url: '/admin', icon: '⚙️', name: 'Seitenverwaltung', group: '' });
  return out;
}

module.exports = { menu, off, flat, list, ico, labelHtml };
