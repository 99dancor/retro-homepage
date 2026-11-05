'use strict';
// Nachgebauter JDownloader (lokale „Deprecated API“) für Tests und Screenshots. Kann genug, um den Weg der Seite
// durchzuspielen: Links auflösen (YouTube-Video, YouTube-Playlist, direkte Datei), Varianten, Downloadliste.
// Geladen wird nicht wirklich: beim Verschieben in die Downloadliste schreibt der Nachbau kleine Dateien mit dem
// richtigen Dateianfang in <outDir>/hp-<id>/ (outDir = JD_DIR der Seite) und meldet sie nach `loadMs` als fertig.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');

const VARIANTS = [
  { id: '{"id":"MP4_1080"}', name: '1080p MP4 H.264 AAC 128kbit/s', ext: 'mp4', size: 80e6 },
  { id: '{"id":"WEBM_720"}', name: '720p WebM VP9 Opus', ext: 'webm', size: 40e6 },
  { id: '{"id":"MP4_2160"}', name: '2160p MP4 H.264', ext: 'mp4', size: 300e6 },
  { id: '{"id":"M4A_128"}', name: 'M4A 128kbit/s AAC Audio', ext: 'm4a', size: 4e6 },
  { id: '{"id":"OPUS_160"}', name: 'Opus 160kbit/s Audio', ext: 'opus', size: 5e6 },
];
const MAGIC = {
  mp4: Buffer.from('000000186674797069736f6d0000020069736f6d69736f32', 'hex'), m4a: Buffer.from('00000018667479704d344120000000004d34412069736f6d', 'hex'),
  webm: Buffer.from('1a45dfa39f4286810142f7810142f2', 'hex'), opus: Buffer.from('OggS\0\x02'), mp3: Buffer.from('ID3\x03\0\0\0\0\0\0'),
  zip: Buffer.from('PK\x03\x04'), pdf: Buffer.from('%PDF-1.4\n'), exe: Buffer.from('MZ\x90\0'), jpg: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
};

function createJd({ outDir, loadMs = 0, playlist = null } = {}) {
  let next = 1000;
  const crawled = { packages: [], links: [] }, downloads = { packages: [], links: [] };
  const log = [];
  let state = 'IDLE', collectingUntil = 0;
  // Titel einer Playlist im Nachbau (Name, Videos)
  const pl = playlist || { name: 'Chill Mix 2026', videos: [['aaaaaaaaaa1', 'ChillNation - Sunset Drive'], ['aaaaaaaaaa2', 'Lofi Girl - Rainy Day'], ['aaaaaaaaaa3', 'Nightcall (Live)']] };

  function addLink(pkg, { name, url, size, variants = false, variant = null }) {
    crawled.links.push({ uuid: next++, packageUUID: pkg.uuid, name, url, host: new URL(url).hostname, bytesTotal: size, availability: 'ONLINE', variants, variant });
  }
  function addLinks(o) {
    collectingUntil = Date.now() + 150;
    const newPkg = name => { const p = { uuid: next++, name, saveTo: o.destinationFolder || '/output' }; crawled.packages.push(p); return p; };
    for (const url of String(o.links || '').split(/\s+/).filter(Boolean)) {
      const u = new URL(url);
      if (/youtube\.com$/.test(u.hostname) && u.searchParams.get('list')) {
        const lofi = /lofi/i.test(url);
        const p = newPkg(o.packageName || (lofi ? 'Lo-Fi Beats' : pl.name));
        const videos = lofi ? [['bbbbbbbbbb1', 'Lofi Girl - Snowy Night'], ['bbbbbbbbbb2', 'Chillhop - Coffee Break'], ['bbbbbbbbbb3', 'Kupla - Owls of the Night']] : pl.videos;
        for (const [id, title] of videos) {
          addLink(p, { name: title + '.mp4', url: 'https://www.youtube.com/watch?v=' + id, size: VARIANTS[0].size, variants: true, variant: VARIANTS[0] });
          addLink(p, { name: title + '.srt', url: 'https://www.youtube.com/watch?v=' + id + '#sub', size: 2000 });
        }
      } else if (/youtube\.com$|youtu\.be$/.test(u.hostname)) {
        const p = newPkg(o.packageName || 'YouTube');
        addLink(p, { name: 'Daft Punk - Something About Us.mp4', url, size: VARIANTS[0].size, variants: true, variant: VARIANTS[0] });
      } else {
        const p = newPkg(o.packageName || u.hostname);
        const name = decodeURIComponent(path.basename(u.pathname)) || 'download.bin';
        addLink(p, { name, url, size: /offline/.test(url) ? 0 : 12345678 });
        if (/offline/.test(url)) crawled.links[crawled.links.length - 1].availability = 'OFFLINE';
      }
    }
    return true;
  }
  const pick = (list, ids, pkgs) => list.filter(l => ids.includes(l.uuid) || pkgs.includes(l.packageUUID));
  function finishLink(l) {
    const pkg = downloads.packages.find(p => p.uuid === l.packageUUID);
    const dir = path.join(outDir, path.basename(pkg.saveTo));
    fs.mkdirSync(dir, { recursive: true });
    const ext = path.extname(l.name).slice(1);
    fs.writeFileSync(path.join(dir, l.name), Buffer.concat([/fake/.test(l.name) ? MAGIC.exe : MAGIC[ext] || Buffer.from('data'), Buffer.alloc(64)]));
    l.finished = true; l.bytesLoaded = l.bytesTotal; l.running = false; l.status = 'Fertig';
  }
  function move(ids, pkgs) {
    const links = pick(crawled.links, ids, pkgs);
    for (const l of links) {
      let p = crawled.packages.find(x => x.uuid === l.packageUUID);
      if (!downloads.packages.some(x => x.uuid === p.uuid)) downloads.packages.push({ ...p, finished: false, running: false, speed: 0, eta: 0 });
      downloads.links.push({ ...l, bytesLoaded: 0, finished: false, running: false, status: 'Wartet', enabled: true });
    }
    crawled.links = crawled.links.filter(l => !links.includes(l));
    crawled.packages = crawled.packages.filter(p => crawled.links.some(l => l.packageUUID === p.uuid));
  }
  function start() {
    state = 'RUNNING';
    const go = () => { for (const l of downloads.links) if (!l.finished && !/broken/.test(l.url)) finishLink(l); for (const l of downloads.links) if (/broken/.test(l.url)) l.status = 'Datei nicht gefunden'; state = 'IDLE'; };
    if (loadMs) {
      for (const l of downloads.links) if (!l.finished) { l.running = true; l.bytesLoaded = Math.round(l.bytesTotal * 0.45); }
      for (const p of downloads.packages) { p.speed = 2.5e6; p.eta = 60; }
      setTimeout(go, loadMs);
    } else go();
    return true;
  }
  const routes = {
    'jd/version': () => 38000,
    'linkgrabberv2/addLinks': o => addLinks(o),
    'linkgrabberv2/isCollecting': () => Date.now() < collectingUntil,
    'linkgrabberv2/queryPackages': () => crawled.packages.map(p => ({ ...p, childCount: crawled.links.filter(l => l.packageUUID === p.uuid).length })),
    'linkgrabberv2/queryLinks': o => crawled.links.filter(l => !o.packageUUIDs.length || o.packageUUIDs.includes(l.packageUUID))
      .map(l => ({ ...l, variant: l.variant ? { id: l.variant.id, name: l.variant.name } : undefined })),
    'linkgrabberv2/getVariants': id => (crawled.links.find(l => l.uuid === id) || {}).variants ? VARIANTS.map(v => ({ id: v.id, name: v.name })) : [],
    'linkgrabberv2/setVariant': (id, vid) => {
      const l = crawled.links.find(x => x.uuid === id), v = VARIANTS.find(x => x.id === vid);
      l.variant = v; l.name = l.name.replace(/\.[a-z0-9]+$/, '.' + v.ext); l.bytesTotal = v.size;
      return true;
    },
    'linkgrabberv2/removeLinks': (ids, pkgs) => {
      crawled.links = crawled.links.filter(l => !ids.includes(l.uuid) && !pkgs.includes(l.packageUUID));
      crawled.packages = crawled.packages.filter(p => !pkgs.includes(p.uuid) && crawled.links.some(l => l.packageUUID === p.uuid));
      return true;
    },
    'linkgrabberv2/moveToDownloadlist': (ids, pkgs) => { move(ids, pkgs); return true; },
    'downloadsV2/queryPackages': () => downloads.packages.map(p => {
      const ls = downloads.links.filter(l => l.packageUUID === p.uuid);
      return { ...p, bytesTotal: ls.reduce((n, l) => n + l.bytesTotal, 0), bytesLoaded: ls.reduce((n, l) => n + l.bytesLoaded, 0), finished: ls.every(l => l.finished), running: ls.some(l => l.running) };
    }),
    'downloadsV2/queryLinks': o => downloads.links.filter(l => !o.packageUUIDs.length || o.packageUUIDs.includes(l.packageUUID)),
    'downloadsV2/removeLinks': (ids, pkgs) => {
      downloads.links = downloads.links.filter(l => !ids.includes(l.uuid) && !pkgs.includes(l.packageUUID));
      downloads.packages = downloads.packages.filter(p => !pkgs.includes(p.uuid));
      return true;
    },
    'downloadsV2/setEnabled': () => true,
    'downloadcontroller/start': () => start(),
    'downloadcontroller/pause': on => { state = on ? 'PAUSE' : 'IDLE'; return true; },
    'downloadcontroller/getCurrentState': () => state,
  };
  const server = http.createServer((req, res) => {
    const [p, q] = req.url.split('?');
    const key = p.replace(/^\//, '');
    const params = q ? q.split('&').map(x => JSON.parse(decodeURIComponent(x))) : [];
    log.push(key);
    if (!routes[key]) { res.writeHead(404); return res.end('no such method'); }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: routes[key](...params) }));
  });
  return {
    server, log, crawled, downloads,
    async listen(port = 0) { server.listen(port, '127.0.0.1'); await once(server, 'listening'); return 'http://127.0.0.1:' + server.address().port; },
    close() { return new Promise(r => server.close(r)); },
  };
}

module.exports = { createJd, VARIANTS };

// Allein gestartet (für Screenshots): node test/fixtures/jd-mock.js <port> <outDir> [loadMs]
if (require.main === module) {
  const jd = createJd({ outDir: process.argv[3] || '/tmp/jd', loadMs: Number(process.argv[4]) || 0 });
  jd.listen(Number(process.argv[2]) || 3128).then(u => console.log('JDownloader-Nachbau läuft auf', u));
}
