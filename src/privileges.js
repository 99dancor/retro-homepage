'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Startet der Container als root (Standard), bekommt der Datenordner den Besitzer PUID:PGID
// (Unraid-Standard 99:100 = nobody:users) und der Server läuft danach ohne Root-Rechte weiter.
// So lassen sich die Dateien in appdata auch über die Unraid-Freigabe bearbeiten.
function chownTree(dir, uid, gid) {
  fs.chownSync(dir, uid, gid);
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) chownTree(p, uid, gid);
    else fs.lchownSync(p, uid, gid);
  }
}

function dropPrivileges(dataDir, extraDirs = []) {
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) return;
  if (process.env.PUID === '0') return; // ausdrücklich als root laufen lassen
  const uid = Number(process.env.PUID || 99);
  const gid = Number(process.env.PGID || 100);
  fs.mkdirSync(dataDir, { recursive: true });
  const st = fs.statSync(dataDir);
  if (st.uid !== uid || st.gid !== gid) chownTree(dataDir, uid, gid);
  // Eigene Mounts (z. B. Download-Ordner auf einer anderen Platte): nur den Ordner selbst übernehmen,
  // vorhandene Dateien darin bleiben unangetastet.
  for (const dir of extraDirs) {
    fs.mkdirSync(dir, { recursive: true });
    const s = fs.statSync(dir);
    if (s.uid !== uid || s.gid !== gid) fs.chownSync(dir, uid, gid);
  }
  process.setgroups([gid]);
  process.setgid(gid);
  process.setuid(uid);
}

module.exports = { dropPrivileges };
