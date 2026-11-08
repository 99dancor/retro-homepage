'use strict';
// Nachgebauter Jellyfin-Server für test/jellyfin.test.js (und zum Ausprobieren: node test/fixtures/jf-mock.js 8096 [video.mp4] [segment.ts]).
// Kann genau das, was src/jellyfin.js braucht: Konten, Bibliotheken, Filme, eine Serie mit zwei Staffeln, Fortschritt,
// Merkliste, PlaybackInfo (direkt oder HLS), Wiedergabelisten mit api_key darin, Bilder als SVG. Jede Anfrage landet in log.
const http = require('node:http');
const fs = require('node:fs');

const KEY = 'a'.repeat(32);
const hex = n => n.toString(16).padStart(32, '0');

function createJf({ video = null, ts = null } = {}) {
  const log = [];
  const users = [{ Id: hex(1), Name: 'admin', Policy: { IsAdministrator: true, IsHidden: false } }];
  const folders = [{ Id: hex(0xf1), Name: 'Filme', CollectionType: 'movies' }, { Id: hex(0xf2), Name: 'Serien', CollectionType: 'tvshows' }];
  const day = 86400e3, t0 = Date.now();
  const items = [];
  const add = x => { items.push({ ImageTags: { Primary: 'p' }, Genres: [], ...x }); return x; };
  const MOVIES = [
    ['Der Leuchtturm', 2019, 'Drama', 6600, 'Zwei Wärter auf einer einsamen Insel verlieren langsam den Verstand.'],
    ['Nordlicht', 2022, 'Abenteuer', 5800, 'Eine Expedition in den hohen Norden.'], ['Stadt aus Glas', 2021, 'Thriller', 7000, 'Ein Architekt verschwindet.'],
    ['Wüstenwind', 2018, 'Abenteuer', 6100, 'Quer durch die Sahara.'], ['Kleine Fische', 2023, 'Komödie', 5200, 'Ein Angelverein vor dem Aus.'],
    ['Mondsee', 2020, 'Drama', 6300, 'Ein Sommer am See.'], ['Funkstille', 2017, 'Thriller', 5900, 'Ein Radiosender sendet nur noch Rauschen.'],
    ['Herbstzeit', 2024, 'Drama', 6900, 'Eine Familie findet zusammen.'],
  ];
  MOVIES.forEach((m, i) => add({ Id: hex(0x100 + i), Type: 'Movie', Name: m[0], ProductionYear: m[1], Genres: [m[2]], RunTimeTicks: m[3] * 1e7, Overview: m[4],
    OfficialRating: 'FSK-12', CommunityRating: 6 + i / 3, DateCreated: new Date(t0 - i * 3 * day).toISOString(), ParentId: folders[0].Id, ImageTags: i === 7 ? {} : { Primary: 'p' } }));
  const show = add({ Id: hex(0x200), Type: 'Series', Name: 'Hafenkante', ProductionYear: 2020, EndDate: '2022-01-01', Status: 'Ended', Genres: ['Krimi'], Overview: 'Ermittlungen im Hamburger Hafen.',
    OfficialRating: 'FSK-12', CommunityRating: 7.4, ChildCount: 2, DateCreated: new Date(t0 - 2 * day).toISOString(), ParentId: folders[1].Id });
  const seasons = [1, 2].map(n => add({ Id: hex(0x210 + n), Type: 'Season', Name: 'Staffel ' + n, IndexNumber: n, SeriesId: show.Id, ChildCount: 3, ParentId: show.Id }));
  seasons.forEach((s, si) => [1, 2, 3].forEach(e => add({ Id: hex(0x300 + si * 16 + e), Type: 'Episode', Name: ['Ebbe', 'Flut', 'Sturm'][e - 1], IndexNumber: e, ParentIndexNumber: si + 1,
    SeriesId: show.Id, SeriesName: show.Name, SeasonId: s.Id, SeriesPrimaryImageTag: 'p', RunTimeTicks: 2700 * 1e7, Overview: 'Folge ' + e + ' der Staffel ' + (si + 1) + '.',
    DateCreated: new Date(t0 - (6 - si * 3 - e) * day).toISOString(), ParentId: s.Id })));
  // Fortschritt je Konto: data[userId][itemId] = { pos, played, fav }
  const data = {};
  const ud = (uid, id) => ((data[uid] = data[uid] || {})[id] = data[uid][id] || { pos: 0, played: false, fav: false });
  const withUd = (x, uid) => {
    if (!uid) return { ...x };
    const d = ud(uid, x.Id), out = { ...x, UserData: { PlaybackPositionTicks: d.pos, Played: d.played, IsFavorite: d.fav } };
    if (x.Type === 'Series') out.UserData.UnplayedItemCount = items.filter(e => e.Type === 'Episode' && e.SeriesId === x.Id && !ud(uid, e.Id).played).length;
    return out;
  };
  const allowed = (uid, x) => {
    const u = users.find(z => z.Id === uid);
    if (!u || !u.Policy || u.Policy.EnableAllFolders !== false || u.Policy.IsAdministrator) return true;
    let p = x;
    while (p && !folders.some(f => f.Id === p.ParentId)) p = items.find(z => z.Id === p.ParentId);
    return !p || (u.Policy.EnabledFolders || []).includes(p.ParentId);
  };
  const MEDIA = x => [{ Type: 'Video', Index: 0, Codec: x.Name === 'Nordlicht' ? 'hevc' : 'h264', Height: 1080, Width: 1920, VideoRange: 'SDR' },
    { Type: 'Audio', Index: 1, DisplayTitle: 'Deutsch - AAC - Stereo', Language: 'ger', IsDefault: true }, { Type: 'Audio', Index: 2, DisplayTitle: 'English - AC3 - 5.1', Language: 'eng' },
    { Type: 'Subtitle', Index: 3, DisplayTitle: 'Deutsch - SUBRIP', IsTextSubtitleStream: true }, { Type: 'Subtitle', Index: 4, DisplayTitle: 'English - PGSSUB', IsTextSubtitleStream: false }];

  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'), p = u.pathname, q = Object.fromEntries(u.searchParams);
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      const entry = { method: req.method, path: p, query: q, body: body ? JSON.parse(body) : null, auth: req.headers['x-emby-token'], range: req.headers.range };
      log.push(entry);
      const json = (o, st = 200) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(o === null ? '' : JSON.stringify(o)); };
      if (req.headers['x-emby-token'] !== KEY) return json({ error: 'nope' }, 401);
      let m;
      const uid = q.userId || ((m = p.match(/^\/Users\/([0-9a-f]{32})\//)) ? m[1] : null);
      if (p === '/Users' && req.method === 'GET') return json(users);
      if (p === '/Users/New') { const n = { Id: hex(0x9000 + users.length), Name: entry.body.Name, Policy: { IsAdministrator: false, EnableAllFolders: true } }; users.push(n); return json(n); }
      if ((m = p.match(/^\/Users\/([0-9a-f]{32})$/))) {
        const i = users.findIndex(z => z.Id === m[1]);
        if (i < 0) return json(null, 404);
        if (req.method === 'DELETE') { users.splice(i, 1); return json(null, 204); }
        return json(users[i]);
      }
      if ((m = p.match(/^\/Users\/([0-9a-f]{32})\/Policy$/))) { const x = users.find(z => z.Id === m[1]); x.Policy = entry.body; return json(null, 204); }
      if ((m = p.match(/^\/Users\/([0-9a-f]{32})\/Password$/))) return json(null, 204);
      if (p === '/Library/MediaFolders') return json({ Items: folders });
      if (p === '/Genres') return json({ Items: [...new Set(items.filter(x => x.Type === q.IncludeItemTypes).flatMap(x => x.Genres))].sort().map(Name => ({ Name })) });
      if (p === '/Items' || /^\/Users\/[0-9a-f]{32}\/Items$/.test(p)) {
        const types = String(q.IncludeItemTypes || 'Movie').split(',');
        let list = items.filter(x => types.includes(x.Type) && allowed(uid, x));
        if (q.SearchTerm) list = list.filter(x => x.Name.toLowerCase().includes(q.SearchTerm.toLowerCase()));
        if (q.Genres) list = list.filter(x => x.Genres.includes(q.Genres));
        if (q.ParentId) list = list.filter(x => x.ParentId === q.ParentId);
        const f = String(q.Filters || '');
        if (uid && f.includes('IsFavorite')) list = list.filter(x => ud(uid, x.Id).fav);
        if (uid && f.includes('IsUnplayed')) list = list.filter(x => !ud(uid, x.Id).played);
        if (uid && f.includes('IsResumable')) list = list.filter(x => ud(uid, x.Id).pos > 0);
        if (/DateCreated/.test(q.SortBy || '')) list.sort((a, b) => b.DateCreated.localeCompare(a.DateCreated));
        else if (/SortName/.test(q.SortBy || '')) list.sort((a, b) => a.Name.localeCompare(b.Name));
        const s = Number(q.StartIndex) || 0, l = Number(q.Limit) || 100;
        return json({ Items: list.slice(s, s + l).map(x => withUd(x, uid)), TotalRecordCount: list.length });
      }
      if ((m = p.match(/^\/Items\/([0-9a-f]{32})$/)) || (m = p.match(/^\/Users\/[0-9a-f]{32}\/Items\/([0-9a-f]{32})$/))) {
        const x = items.find(z => z.Id === m[1]);
        if (!x || !allowed(uid, x)) return json(null, 404);
        const out = withUd(x, uid);
        if (x.Type === 'Movie' || x.Type === 'Episode') out.MediaSources = [{ Id: hex(0xa000 + parseInt(x.Id, 16)), MediaStreams: MEDIA(x) }];
        return json(out);
      }
      if ((m = p.match(/^\/Shows\/([0-9a-f]{32})\/Seasons$/))) return json({ Items: seasons.filter(s => s.SeriesId === m[1]).map(s => withUd(s, uid)) });
      if ((m = p.match(/^\/Shows\/([0-9a-f]{32})\/Episodes$/))) return json({ Items: items.filter(x => x.Type === 'Episode' && x.SeriesId === m[1] && (!q.SeasonId || x.SeasonId === q.SeasonId)).map(x => withUd(x, uid)) });
      if (p === '/Shows/NextUp') { const e = items.find(x => x.Type === 'Episode' && x.SeriesId === q.SeriesId && !ud(uid, x.Id).played); return json({ Items: e ? [withUd(e, uid)] : [] }); }
      if ((m = p.match(/^\/UserFavoriteItems\/([0-9a-f]{32})$/))) { ud(uid, m[1]).fav = req.method === 'POST'; return json({}); }
      if ((m = p.match(/^\/UserItems\/([0-9a-f]{32})\/UserData$/))) {
        const d = ud(uid, m[1]), b = entry.body;
        if (b.Played !== undefined) d.played = b.Played;
        if (b.PlaybackPositionTicks !== undefined) d.pos = b.PlaybackPositionTicks;
        return json({});
      }
      if ((m = p.match(/^\/Items\/([0-9a-f]{32})\/PlaybackInfo$/))) {
        const x = items.find(z => z.Id === m[1]);
        const msId = hex(0xa000 + parseInt(x.Id, 16)), b = entry.body;
        const direct = MEDIA(x)[0].Codec !== 'hevc' || (b.DeviceProfile.DirectPlayProfiles[0].VideoCodec || '').includes('hevc');
        return json({ PlaySessionId: 'sess' + log.length, MediaSources: [{ Id: msId, RunTimeTicks: x.RunTimeTicks, SupportsDirectPlay: direct, DefaultAudioStreamIndex: 1, MediaStreams: MEDIA(x),
          TranscodingUrl: `/videos/${x.Id}/master.m3u8?DeviceId=d&MediaSourceId=${msId}&VideoCodec=h264&AudioCodec=aac&api_key=${KEY}&PlaySessionId=s1`, TranscodingSubProtocol: 'hls' }] });
      }
      if ((m = p.match(/^\/Items\/([0-9a-f]{32})\/Images\/Primary$/))) {
        const x = items.find(z => z.Id === m[1]);
        if (!x || !x.ImageTags.Primary) return json(null, 404);
        const h = parseInt(x.Id, 16) * 47 % 360;
        res.writeHead(200, { 'content-type': 'image/svg+xml' });
        return res.end(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${h},60%,55%)"/><stop offset="1" stop-color="hsl(${h + 40},50%,15%)"/></linearGradient></defs><rect width="200" height="300" fill="url(#g)"/><circle cx="100" cy="110" r="46" fill="hsl(${h + 60},90%,80%)" opacity=".8"/><path d="M0 230 Q60 170 120 210 T200 200 V300 H0z" fill="rgba(0,0,0,.45)"/><text x="12" y="282" font-family="Georgia" font-weight="bold" font-size="22" fill="#fff">${x.Name}</text></svg>`);
      }
      if ((m = p.match(/^\/Videos\/([0-9a-f]{32})\/master\.m3u8$/))) {
        res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' });
        return res.end(`#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=4000000\nmain.m3u8?MediaSourceId=${q.MediaSourceId}&api_key=${KEY}&PlaySessionId=s1\n`);
      }
      if ((m = p.match(/^\/Videos\/([0-9a-f]{32})\/main\.m3u8$/))) {
        res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' });
        return res.end(`#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:12\n${ts ? '' : `#EXT-X-MAP:URI="hls1/main/-1.mp4?api_key=${KEY}"\n`}#EXTINF:12.0,\nhls1/main/0.ts?api_key=${KEY}&runtimeTicks=0\n#EXT-X-ENDLIST\n`);
      }
      if ((m = p.match(/^\/Videos\/([0-9a-f]{32})\/[0-9a-f]{32}\/Subtitles\/(\d+)\/0\/Stream\.vtt$/))) {
        res.writeHead(200, { 'content-type': 'text/vtt' });
        return res.end('WEBVTT\n\n00:00:01.000 --> 00:00:05.000\nDas Licht geht wieder an.\n');
      }
      if ((m = p.match(/^\/Videos\/([0-9a-f]{32})\/(stream|hls1\/main\/.+)$/))) {
        const file = m[2] === 'stream' ? video : ts;
        const buf = file && fs.existsSync(file) ? fs.readFileSync(file) : Buffer.from('VIDEO-' + m[1]);
        const type = m[2] === 'stream' ? 'video/mp4' : 'video/mp2t';
        const r = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
        if (r) {
          const a = Number(r[1]), b = r[2] ? Math.min(Number(r[2]), buf.length - 1) : buf.length - 1;
          res.writeHead(206, { 'content-type': type, 'content-range': `bytes ${a}-${b}/${buf.length}`, 'accept-ranges': 'bytes', 'content-length': b - a + 1 });
          return res.end(buf.subarray(a, b + 1));
        }
        res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': buf.length });
        return res.end(buf);
      }
      if (p === '/Videos/ActiveEncodings') return json(null, 204);
      json(null, 404);
    });
  });
  return {
    KEY, log, users, items, data, folders, show, seasons,
    listen: (port = 0) => new Promise(r => server.listen(port, '127.0.0.1', () => r('http://127.0.0.1:' + server.address().port))),
    close: () => new Promise(r => { server.closeAllConnections(); server.close(r); }),
  };
}
module.exports = { createJf, KEY };

if (require.main === module) {
  const jf = createJf({ video: process.argv[3], ts: process.argv[4] });
  jf.listen(Number(process.argv[2]) || 8096).then(u => console.log('Test-Jellyfin auf ' + u + ', Schlüssel ' + jf.KEY));
}
