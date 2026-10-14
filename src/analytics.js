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

function record(req, path, isDownload = false) {
  const ua = req.get('user-agent') || '';
  if (!ua || BOT_RE.test(ua)) return;
  if (req.get('dnt') === '1' && process.env.RESPECT_DNT === 'true') return;
  let ref = null;
  try {
    const r = req.get('referer');
    if (r) { const h = new URL(r).host; if (h && h !== req.get('host')) ref = h; }
  } catch { /* ungültiger Referer */ }
  const hash = crypto.createHash('sha256').update(dailySalt() + '|' + req.ip + '|' + ua).digest('hex').slice(0, 24);
  const day = today();
  // Besucherzähler: zählt jeden Besucher einmal pro Tag
  if (!isDownload && !db.prepare('SELECT 1 FROM pageviews WHERE day = ? AND visitor_hash = ? LIMIT 1').get(day, hash)) {
    db.prepare("INSERT INTO settings(key, value) VALUES ('hit_counter', '1') ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1").run();
  }
  insert.run(now(), day, path.slice(0, 300), ref, hash, req.user ? req.user.id : null, device(ua), isDownload ? 1 : 0);
}

// Middleware: zählt erfolgreiche HTML-Seitenaufrufe außerhalb des Admin-Bereichs.
function middleware(req, res, next) {
  if (req.method !== 'GET' || req.path.startsWith('/admin') || req.path.startsWith('/static') || req.path.startsWith('/files/dl/')) return next();
  res.on('finish', () => {
    if (res.statusCode === 200 && String(res.get('content-type') || '').startsWith('text/html')) {
      try { record(req, req.path); } catch (e) { console.error('analytics', e.message); }
    }
  });
  next();
}

function cleanup() {
  const days = Number(getSetting('analytics_retention_days', '365')) || 365;
  db.prepare('DELETE FROM pageviews WHERE ts < ?').run(now() - days * 86400);
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

module.exports = { middleware, record, stats };
