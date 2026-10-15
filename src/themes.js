'use strict';
// Farbvorlagen und Schriften: einmal hier, genutzt vom Design im Admin (/theme.css) und vom
// Darstellungsfenster der Besucher (public/display.js bekommt sie als JSON im <head>).
const PRESETS = {
  'Windows 98': { theme_bg_color: '#008080', theme_window_color: '#c0c0c0', theme_title_from: '#000080', theme_title_to: '#1084d0', theme_text_color: '#000000', theme_link_color: '#0000ee' },
  'Nachtschwarz': { theme_bg_color: '#000000', theme_window_color: '#2b2b2b', theme_title_from: '#400040', theme_title_to: '#a000a0', theme_text_color: '#e0e0e0', theme_link_color: '#00ffff' },
  'Bubblegum': { theme_bg_color: '#ff99cc', theme_window_color: '#ffe6f2', theme_title_from: '#cc0066', theme_title_to: '#ff66b3', theme_text_color: '#330019', theme_link_color: '#6600cc' },
  'Matrix': { theme_bg_color: '#001100', theme_window_color: '#0a1f0a', theme_title_from: '#003300', theme_title_to: '#00aa00', theme_text_color: '#33ff33', theme_link_color: '#ccff66' },
  'Windows 2000': { theme_bg_color: '#3a6ea5', theme_window_color: '#d4d0c8', theme_title_from: '#0a246a', theme_title_to: '#a6caf0', theme_text_color: '#000000', theme_link_color: '#0000ee' },
};

// Schlüssel: [Name in der Auswahl, CSS-Schriftliste]
const FONTS = {
  tahoma: ['Tahoma (Windows 2000)', 'Tahoma, Verdana, "Segoe UI", sans-serif'],
  ms_sans: ['MS Sans Serif (Windows 98)', '"MS Sans Serif", "Microsoft Sans Serif", Tahoma, sans-serif'],
  verdana: ['Verdana', 'Verdana, Geneva, sans-serif'],
  times: ['Times New Roman', '"Times New Roman", Times, serif'],
  comic: ['Comic Sans MS 🤡', '"Comic Sans MS", "Comic Neue", cursive'],
  courier: ['Courier New', '"Courier New", Courier, monospace'],
};

// Für das Darstellungsfenster: Vorlagen in den Namen der CSS-Variablen, Schriften als Liste
const clientData = JSON.stringify({
  presets: Object.fromEntries(Object.entries(PRESETS).map(([name, p]) => [name, {
    desktop: p.theme_bg_color, win: p.theme_window_color, titleFrom: p.theme_title_from, titleTo: p.theme_title_to,
    text: p.theme_text_color, link: p.theme_link_color,
  }])),
  fonts: Object.fromEntries(Object.entries(FONTS).map(([k, [label, stack]]) => [k, { label, stack }])),
}).replace(/</g, '\\u003c');

module.exports = { PRESETS, FONTS, clientData };
