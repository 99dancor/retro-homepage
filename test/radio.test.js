'use strict';
// Internetradio ohne Browser: Playlist-Dateien auflösen und Adressen im eigenen Netz erkennen (src/radio.js).
// Aufruf: node --test test/radio.test.js (läuft mit npm test)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'radio-test-'));
process.env.PUID = '0';
const radio = require('../src/radio');

test('Playlist-Dateien: erste Stream-Adresse aus .pls und .m3u', () => {
  assert.equal(radio.fromPlaylist('[playlist]\nNumberOfEntries=1\nFile1=http://stream.example.org:8000/live.mp3\nTitle1=X'), 'http://stream.example.org:8000/live.mp3');
  assert.equal(radio.fromPlaylist('#EXTM3U\n#EXTINF:-1,Sender\nhttps://a.example/b.aac\n'), 'https://a.example/b.aac');
  assert.equal(radio.fromPlaylist('nichts drin'), null);
});

test('Eigenes Netz: private, lokale und Sonderadressen', () => {
  for (const ip of ['192.168.178.30', '10.0.0.1', '172.16.5.4', '127.0.0.1', '169.254.1.1', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:192.168.0.1']) assert.ok(radio.privateIp(ip), ip);
  for (const ip of ['8.8.8.8', '172.32.0.1', '2a00:1450::1']) assert.ok(!radio.privateIp(ip), ip);
});
