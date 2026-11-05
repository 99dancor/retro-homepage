'use strict';
// Seitenverwaltung 2.0: Baum links (views/partials/admin-nav.ejs) mit sieben Bereichen statt zwanzig Reitern, dazu
// „Einstellung suchen“ (Strg+K, public/admin.js). Jeder Eintrag: [Symbol, Name, Adresse, weitere Adressen, die dazugehören].

const TREE = [
  { key: 'uebersicht', icon: '📊', label: 'Übersicht', url: '/admin' },
  { key: 'inhalte', icon: '📝', label: 'Inhalte', kids: [
    ['📝', 'Blog', '/admin/posts'], ['📄', 'Eigene Seiten', '/admin/pages'], ['🖼️', 'Bilder', '/admin/media'],
    ['📁', 'Downloads', '/admin/files', ['/admin/downloads']], ['🔗', 'Links', '/admin/links'], ['🧩', 'Modlisten', '/admin/mods'],
    ['🎞️', 'Mediathek', '/admin/musik'],
  ] },
  { key: 'mitglieder', icon: '👥', label: 'Mitglieder', badge: 'inbox', kids: [
    ['👤', 'Konten und Gruppen', '/admin/users', ['/admin/groups']], ['📥', 'Postfach', '/admin/postfach', ['/admin/messages', '/admin/guestbook', '/admin/freigaben'], 'inbox'],
    ['💽', 'Speicher und Freigaben', '/admin/speicher'],
  ] },
  { key: 'programme', icon: '🎮', label: 'Programme', url: '/admin/programme', kids: [
    ['🂡', 'Kartenspiele', '/admin/programme/kartenspiele'], ['❓', 'Quiz', '/admin/quiz'], ['🐺', 'Werwolf', '/admin/werwolf'],
    ['🧩', 'Rätsel', '/admin/programme/raetsel'], ['🚜', 'Farming Hub', '/admin/farming'], ['🎨', 'Paint und Galerie', '/admin/paint'],
    ['🎵', 'Mediaplayer', '/admin/programme/mediaplayer'], ['💬', 'Forum', '/admin/programme/forum'], ['📖', 'Besucherbuch', '/admin/programme/besucherbuch'],
    ['🕹️', 'Eigene Apps', '/admin/apps'],
  ] },
  { key: 'dienste', icon: '🗄️', label: 'Dienste', url: '/admin/dienste', badge: 'down' },
  { key: 'aussehen', icon: '🎨', label: 'Aussehen', kids: [
    ['🖌️', 'Design', '/admin/design'], ['🖥️', 'Desktop', '/admin/desktop'], ['🏠', 'Startseite', '/admin/startseite'],
    ['📢', 'Laufband', '/admin/laufband'], ['💬', 'Popup-Bilder', '/admin/popups', [], 'popups'],
  ] },
  { key: 'system', icon: '⚙️', label: 'System', kids: [
    ['🏠', 'Allgemein', '/admin/settings'], ['🔐', 'Anmelden', '/admin/anmelden'], ['✉️', 'E-Mail', '/admin/email'],
    ['📈', 'Statistik', '/admin/statistik'], ['📜', 'Ereignisanzeige', '/admin/ereignisse'], ['ℹ️', 'Info und Updates', '/admin/info'],
  ] },
].map(g => ({ ...g, kids: (g.kids || []).map(([icon, label, url, also = [], badge = null]) => ({ icon, label, url, also, badge })) }));

const under = (path, url) => path === url || path.startsWith(url + '/');
// Wo bin ich? Gruppe und Eintrag zur Adresse (der längste Treffer gewinnt, /admin selbst nur genau)
function current(path) {
  let best = null;
  for (const g of TREE) {
    if (g.url === '/admin' ? path === '/admin' || path === '/admin/' : g.url && under(path, g.url)) best = best || { group: g, item: null, len: g.url.length };
    for (const k of g.kids) {
      for (const u of [k.url, ...k.also]) {
        if (under(path, u) && (!best || u.length > best.len)) best = { group: g, item: k, len: u.length };
      }
    }
  }
  return best || { group: TREE[0], item: null };
}

// Einstellung suchen: [Name, Stichworte, Adresse]. Findet Seiten und einzelne Schalter darauf.
const SEARCH = [
  ...TREE.flatMap(g => [[g.label, '', g.url || (g.kids[0] && g.kids[0].url)], ...g.kids.map(k => [k.label, g.label, k.url])]),
  ['Name der Website', 'Titel Untertitel Statusleiste', '/admin/settings#allgemein'],
  ['Wartungsmodus', 'Wartung gesperrt offline Baustelle', '/admin/settings#wartung'],
  ['Registrieren erlauben', 'Anmeldung neue Mitglieder Konto anlegen', '/admin/anmelden'],
  ['Anmeldebildschirm', 'Willkommen Logon XP 98 Laden', '/admin/anmelden'],
  ['SMTP und Test-E-Mail', 'Mail Server Passwort Benachrichtigung', '/admin/email'],
  ['Statistik aufbewahren', 'Tage Besucher Aufrufe löschen', '/admin/statistik#aufbewahren'],
  ['Programme an und aus', 'Startmenü Desktop für wen Mitglieder Gäste ausschalten Menü', '/admin/programme'],
  ['Kasse und Buy-in', 'Startgeld Nachkaufen Geld Kartenspiele', '/admin/programme/kartenspiele#kasse'],
  ['Blackjack', 'Decks Soft 17 Bedenkzeit', '/admin/programme/kartenspiele#spiele'],
  ['Poker', 'Texas Holdem Bedenkzeit', '/admin/programme/kartenspiele#spiele'],
  ['Durak', 'Bedenkzeit', '/admin/programme/kartenspiele#spiele'],
  ['UNO, Flip 7, Pilli Pilli', 'Bedenkzeit Kartenspiel', '/admin/programme/kartenspiele#spiele'],
  ['Bestenlisten zurücksetzen', 'Highscore löschen Blackjack Poker Durak UNO Minesweeper Sudoku Kreuzworträtsel Statistik', '/admin/programme/kartenspiele#bestenlisten'],
  ['Eigene Wörter im Kreuzworträtsel', 'Hinweis Rätsel Wortliste', '/admin/programme/raetsel'],
  ['Minesweeper-Bestzeiten', 'zurücksetzen', '/admin/programme/raetsel#minesweeper'],
  ['Sudoku-Statistik', 'zurücksetzen', '/admin/programme/raetsel#sudoku'],
  ['Mediaplayer-Skin', 'Aussehen Winamp VLC Media Player klassisch', '/admin/programme/mediaplayer'],
  ['Musik hochladen', 'Upload Lieder Videos', '/admin/programme/mediaplayer'],
  ['YouTube und Musik-Lobbys', 'gemeinsam hören', '/admin/programme/mediaplayer'],
  ['Forum nur für Mitglieder', 'Board lesen schreiben', '/admin/programme'],
  ['Besucherbuch freischalten', 'Moderation Einträge Freigabe', '/admin/programme/besucherbuch'],
  ['Paint-Galerie und Freigabe', 'Malen Bilder Moderation Lobbys', '/admin/paint'],
  ['Neuer Dienst', 'Jellyfin Immich Nextcloud Minecraft Steam Valheim Gameserver Server Docker Container Status', '/admin/dienste/neu'],
  ['Widget Dienste', 'Desktop Speicher belegt Festplatte Platte', '/admin/dienste#widget'],
  ['Belegten Speicher zeigen', 'Festplatte Platte frei voll Speicherplatz', '/admin/dienste#widget'],
  ['Download-Kategorien', 'Downloads Kategorie Endungen Spielstände Mods Tools exe gesperrt nicht erlaubt', '/admin/files/kategorien'],
  ['Speicher pro Mitglied', 'Quota Platz MB Grenze', '/admin/speicher'],
  ['Freigegebene Ordner', 'öffentlich Desktop Mitglieder teilen', '/admin/speicher#freigaben'],
  ['readme.txt', 'Desktop Text Begrüßung', '/admin/desktop#readme'],
  ['Standardsymbole', 'Desktop Papierkorb Eigene Dateien', '/admin/desktop#symbole'],
  ['Widget Offene Lobbys', 'Desktop Lobby', '/admin/desktop#widgets'],
  ['Suche in der Taskleiste', 'Strg K suchen', '/admin/desktop#widgets'],
  ['Farben und Hintergrund', 'Design Theme Schrift XP 98 Bild CSS Besucherzähler', '/admin/design'],
  ['Text auf der Startseite', 'Willkommen Begrüßung Startseite', '/admin/startseite#text'],
  ['Bausteine der Startseite', 'Schnellstart Neuigkeiten Server-Status Reihenfolge', '/admin/startseite#bausteine'],
  ['Laufband-Meldung', 'Lauftext Marquee Ticker Meldung Eilmeldung LED', '/admin/laufband'],
  ['Popup-Bild hochladen', 'Werbung Fenster Spaß Pool Bild', '/admin/popups'],
  ['Postfach', 'Kontakt Nachrichten Besucherbuch Freigaben Vorschläge', '/admin/postfach'],
  ['Neues Konto', 'Nutzer anlegen Benutzer Passwort Admin Gruppe', '/admin/users'],
  ['Ereignisanzeige', 'Protokoll Log Fehler Warnungen', '/admin/ereignisse'],
  ['Changelog und Update', 'Version Updates Nummer Info', '/admin/info'],
].filter(e => e[2]).map(([label, words, url]) => ({ label, words, url }));

module.exports = { TREE, current, SEARCH };
