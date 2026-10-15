'use strict';
const crypto = require('node:crypto');
const { db, now, getSetting, setSetting } = require('./db');

// Datenschutzfreundliches Tracking: keine Cookies, keine gespeicherten IPs.
// Besucher werden über einen Hash aus (Tagessalz + IP + User-Agent) gezählt;
// das Salz wechselt täglich, dadurch lässt sich niemand über Tage verfolgen.
const BOT_RE = /bot|crawl|spider|slurp|curl|wget|python|httpclient|headless|monitor|uptime|preview|facebookexternalhit|feedfetcher/i;

const TZ = process.env.TZ || 'Europe/Berlin';
// Datum als YYYY-MM-DD in der eingestellten Zeitzone
function dayOf(ms) { return new Date(ms).toLocaleDateString('sv-SE', { timeZone: TZ }); }
function today() { return dayOf(Date.now()); }

function dailySalt() {
  const d = today();
  if (getSetting('salt_day') !== d) {
    setSetting('salt_day', d);
    setSetting('salt', crypto.randomBytes(16).toString('hex'));
  }
  return getSetting('salt');
}

function device(ua) {
  if (/mobile|android|iphone/i.test(ua)) return 'Mobil';
  if (/ipad|tablet/i.test(ua)) return 'Tablet';
  return 'Desktop';
}

const insert = db.prepare(`INSERT INTO pageviews(ts, day, path, referrer_host, visitor_hash, user_id, device, is_download)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);

function referrerHost(req) {
  try {
    const r = req.get('referer');
    if (r) { const h = new URL(r).host; if (h && h !== req.get('host')) return h; }
  } catch { /* ungültiger Referer */ }
  return null;
}
function visitorHash(req) {
  return crypto.createHash('sha256').update(dailySalt() + '|' + req.ip + '|' + (req.get('user-agent') || '')).digest('hex').slice(0, 24);
}
function isTracked(req) {
  const ua = req.get('user-agent') || '';
  if (!ua || BOT_RE.test(ua)) return false;
  return !(req.get('dnt') === '1' && process.env.RESPECT_DNT === 'true');
}

function record(req, path, isDownload = false) {
  if (!isTracked(req)) return;
  const ua = req.get('user-agent') || '';
  const ref = referrerHost(req);
  const hash = visitorHash(req);
  const day = today();
  // Besucherzähler: zählt jeden Besucher einmal pro Tag
  if (!isDownload && !db.prepare('SELECT 1 FROM pageviews WHERE day = ? AND visitor_hash = ? LIMIT 1').get(day, hash)) {
    db.prepare("INSERT INTO settings(key, value) VALUES ('hit_counter', '1') ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1").run();
  }
  insert.run(now(), day, path.slice(0, 300), ref, hash, req.user ? req.user.id : null, device(ua), isDownload ? 1 : 0);
}

function sameHostPath(req) {
  try { const r = new URL(req.get('referer')); return r.host === req.get('host') ? r.pathname : null; } catch { return null; }
}

// Middleware: zählt erfolgreiche HTML-Seitenaufrufe außerhalb des Admin-Bereichs.
function middleware(req, res, next) {
  if (req.method !== 'GET' || req.path.startsWith('/admin') || req.path.startsWith('/static') || req.path.startsWith('/files/dl/')) return next();
  // Erstes Laden eines Fensters zählt nicht doppelt: der Desktop drumherum wurde schon gezählt
  if (res.locals.embed && sameHostPath(req) === req.path) return next();
  res.on('finish', () => {
    if (res.statusCode === 200 && String(res.get('content-type') || '').startsWith('text/html')) {
      try { record(req, req.path); } catch (e) { console.error('analytics', e.message); }
    }
  });
  next();
}

// Beginn einer Range-Anfrage (Download-Manager, fortgesetzte Downloads); 0 = von vorn
function rangeStart(req) {
  const m = /^bytes=(\d*)-/.exec(req.get('range') || '');
  return m ? Number(m[1] || 0) : 0;
}

// Misst einen Download: übertragene Bytes, fertig oder abgebrochen. Ruft onCount auf,
// wenn der Vorgang als neuer Download zählt (keine Fortsetzung).
function trackDownload(req, res, fileId) {
  if (req.method === 'HEAD') return false;
  const resumed = rangeStart(req) > 0;
  if (!isTracked(req)) return !resumed;
  const sock = req.socket;
  const startBytes = sock ? sock.bytesWritten : 0;
  const ua = req.get('user-agent') || '';
  const row = [now(), today(), fileId, visitorHash(req), req.user ? req.user.id : null, device(ua), referrerHost(req)];
  let done = false;
  const finish = complete => {
    if (done) return;
    done = true;
    const bytes = sock ? Math.max(0, sock.bytesWritten - startBytes) : 0;
    try {
      db.prepare(`INSERT INTO downloads(ts, day, file_id, visitor_hash, user_id, device, referrer_host, bytes, complete, resumed)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(...row, bytes, complete ? 1 : 0, resumed ? 1 : 0);
    } catch (e) { console.error('download-stats', e.message); }
  };
  res.on('finish', () => finish(res.statusCode < 400));
  res.on('close', () => finish(res.writableFinished && res.statusCode < 400));
  return !resumed;
}

function cleanup() {
  const days = Number(getSetting('analytics_retention_days', '365')) || 365;
  db.prepare('DELETE FROM pageviews WHERE ts < ?').run(now() - days * 86400);
  db.prepare('DELETE FROM downloads WHERE ts < ?').run(now() - days * 86400);
}
setInterval(cleanup, 6 * 3600e3).unref();

function stats(days) {
  const since = dayOf(Date.now() - (days - 1) * 86400e3);
  const perDay = db.prepare(`SELECT day, COUNT(*) AS views, COUNT(DISTINCT visitor_hash) AS visitors
                             FROM pageviews WHERE day >= ? AND is_download = 0 GROUP BY day ORDER BY day`).all(since);
  const map = new Map(perDay.map(r => [r.day, r]));
  const series = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = dayOf(Date.now() - i * 86400e3);
    const r = map.get(d);
    series.push({ day: d, views: r ? r.views : 0, visitors: r ? r.visitors : 0 });
  }
  const q = (sql) => db.prepare(sql).all(since);
  return {
    days,
    series,
    totals: db.prepare(`SELECT COUNT(*) AS views, COUNT(DISTINCT day || visitor_hash) AS visitors,
                        SUM(is_download) AS downloads FROM pageviews WHERE day >= ?`).get(since),
    topPages: q(`SELECT path, COUNT(*) AS views, COUNT(DISTINCT day || visitor_hash) AS visitors FROM pageviews
                 WHERE day >= ? AND is_download = 0 GROUP BY path ORDER BY views DESC LIMIT 15`),
    referrers: q(`SELECT referrer_host AS host, COUNT(*) AS views FROM pageviews
                  WHERE day >= ? AND referrer_host IS NOT NULL GROUP BY referrer_host ORDER BY views DESC LIMIT 10`),
    devices: q(`SELECT device, COUNT(*) AS views FROM pageviews WHERE day >= ? GROUP BY device ORDER BY views DESC`),
    downloads: q(`SELECT path, COUNT(*) AS n FROM pageviews WHERE day >= ? AND is_download = 1 GROUP BY path ORDER BY n DESC LIMIT 10`),
    members: db.prepare(`SELECT u.username, COUNT(*) AS views, MAX(p.ts) AS last FROM pageviews p JOIN users u ON u.id = p.user_id
                         WHERE p.day >= ? GROUP BY u.id ORDER BY views DESC LIMIT 10`).all(since),
  };
}

function daySeries(days, rows, keys) {
  const map = new Map(rows.map(r => [r.day, r]));
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = dayOf(Date.now() - i * 86400e3);
    const r = map.get(d) || {};
    const o = { day: d };
    for (const k of keys) o[k] = r[k] || 0;
    out.push(o);
  }
  return out;
}

// Download-Statistik für alle Dateien oder eine einzelne (fileId)
function downloadStats(days, fileId = null) {
  const since = dayOf(Date.now() - (days - 1) * 86400e3);
  const f = fileId ? ' AND d.file_id = ' + Number(fileId) : '';
  const all = (sql, ...p) => db.prepare(sql).all(since, ...p);
  // "Downloads" zählt neue Vorgänge; Fortsetzungen abgebrochener Downloads zählen nur zur Datenmenge
  const totals = db.prepare(`SELECT
      SUM(resumed = 0) AS downloads,
      COUNT(DISTINCT CASE WHEN resumed = 0 THEN d.day || d.visitor_hash END) AS people,
      SUM(resumed = 0 AND complete = 1) AS complete,
      SUM(complete = 0) AS aborted,
      SUM(resumed = 1) AS resumes,
      COALESCE(SUM(bytes), 0) AS bytes
    FROM downloads d WHERE d.day >= ?${f}`).get(since);
  const perDay = all(`SELECT day, SUM(resumed = 0) AS downloads, COUNT(DISTINCT CASE WHEN resumed = 0 THEN visitor_hash END) AS people,
                      COALESCE(SUM(bytes), 0) AS bytes FROM downloads d WHERE d.day >= ?${f} GROUP BY day`);
  const res = {
    days, totals,
    series: daySeries(days, perDay, ['downloads', 'people', 'bytes']),
    devices: all(`SELECT device, SUM(resumed = 0) AS n FROM downloads d WHERE d.day >= ?${f} GROUP BY device ORDER BY n DESC`),
    referrers: all(`SELECT referrer_host AS host, SUM(resumed = 0) AS n FROM downloads d WHERE d.day >= ?${f} AND referrer_host IS NOT NULL
                    GROUP BY referrer_host ORDER BY n DESC LIMIT 10`),
    members: all(`SELECT u.username, SUM(d.resumed = 0) AS n, MAX(d.ts) AS last FROM downloads d JOIN users u ON u.id = d.user_id
                  WHERE d.day >= ?${f} GROUP BY u.id ORDER BY n DESC LIMIT 15`),
    hours: (() => {
      const rows = all(`SELECT ts FROM downloads d WHERE d.day >= ?${f} AND resumed = 0`);
      const h = Array(24).fill(0);
      const hourOf = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: TZ });
      for (const r of rows) h[Number(hourOf.format(new Date(r.ts * 1000))) % 24]++;
      return h;
    })(),
  };
  if (fileId) {
    res.recent = db.prepare(`SELECT d.*, u.username FROM downloads d LEFT JOIN users u ON u.id = d.user_id
                             WHERE d.file_id = ? ORDER BY d.ts DESC LIMIT 100`).all(Number(fileId));
  } else {
    res.files = all(`SELECT f.id, f.title, f.category, f.game, f.size, f.downloads AS total,
        COALESCE(x.n, 0) AS n, COALESCE(x.people, 0) AS people, COALESCE(x.complete, 0) AS complete,
        COALESCE(x.aborted, 0) AS aborted, COALESCE(x.bytes, 0) AS bytes, x.last
      FROM files f LEFT JOIN (
        SELECT file_id, SUM(resumed = 0) AS n, COUNT(DISTINCT CASE WHEN resumed = 0 THEN day || visitor_hash END) AS people,
               SUM(resumed = 0 AND complete = 1) AS complete, SUM(complete = 0) AS aborted, SUM(bytes) AS bytes, MAX(ts) AS last
        FROM downloads WHERE day >= ? GROUP BY file_id) x ON x.file_id = f.id
      ORDER BY n DESC, f.downloads DESC, f.title`);
    res.categories = all(`SELECT f.category, SUM(d.resumed = 0) AS n, COALESCE(SUM(d.bytes), 0) AS bytes
                          FROM downloads d JOIN files f ON f.id = d.file_id WHERE d.day >= ? GROUP BY f.category ORDER BY n DESC`);
  }
  return res;
}

module.exports = { middleware, record, stats, trackDownload, downloadStats };
