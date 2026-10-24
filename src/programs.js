'use strict';
// Die Programme des Startmenüs an einem Ort: Das Startmenü (views/partials/startmenu.ejs) zeichnet sie,
// die Suche in der Taskleiste findet sie, und der Desktop legt aus ihnen Verknüpfungen an.
// Einträge: [Schlüssel, Adresse, Beschriftung] oder [Gruppe, Beschriftung, [Einträge]] → Untermenü wie bei Windows 98

function menu(user) {
  return [['blog', '/blog', '📝 Blog'],
    ['dokumente', '📂 Dokumente', [...(user ? [['eigene-dateien', '/eigene-dateien', '🗂️ Eigene Dateien'], ['notizblock', '/notizblock', '🗒️ Notizblock']] : []), ...(user && user.canUpload ? [['upload', '/files/upload', '📤 Datei hochladen']] : []), ['files', '/files', '📁 Downloads'], ['mods', '/mods', '🧩 Modlisten'], ['links', '/links', '🔗 Links'], ['galerie', '/galerie', '🖼️ Galerie']]],
    ['spiele', '🎮 Spiele und Apps', [['kartenspiele', '/kartenspiele', '🂡 Kartenspiele'], ['quiz', '/quiz', '❓ Quiz'], ['werwolf', '/werwolf', '🐺 Werwolf'], ['minesweeper', '/minesweeper', '💣 Minesweeper'], ['kreuzwortraetsel', '/kreuzwortraetsel', '📰 Kreuzworträtsel'], ['sudoku', '/sudoku', '🔢 Sudoku'], ['paint', '/paint', '🎨 Paint'], ['zufall', '/zufall', '🎲 Zufallsgenerator'], ['musik', '/musik', '🎵 Mediaplayer'], ['apps', '/apps', '🕹️ Andere Games']]],
    ['haustier', '/haustier/', '🐾 Pixelpfoten'], ['board', '/forum', '💬 Forum'], ['nutzer', '/nutzer', '👥 Mitglieder'], ['guestbook', '/guestbook', '📖 Besucherbuch'], ['contact', '/contact', '✉️ Kontakt']];
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

module.exports = { menu, off, flat, list };
