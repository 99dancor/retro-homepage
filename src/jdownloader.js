'use strict';
// JDownloader 2 über seine lokale Schnittstelle („Deprecated API“, Erweiterte Einstellungen → RemoteAPI, Port 3128).
// Aufbau wie die MyJDownloader-API ohne Cloud: GET /<bereich>/<methode>?<param1>&<param2>, jeder Parameter ein
// URL-kodierter JSON-Wert; die Antwort ist {"data": …} oder der Wert selbst. Die Schnittstelle hat keine Anmeldung:
// Nur der Server spricht mit ihr, die Adresse sieht kein Browser. Am besten liegt sie in einem eigenen Docker-Netz.
const { getSetting } = require('./db');

const TIMEOUT_MS = Number(process.env.JD_TIMEOUT_MS) || 15000;

function baseUrl() { return String(getSetting('jd_url', '') || '').trim().replace(/\/+$/, ''); }
function configured() { return !!baseUrl(); }

async function call(endpoint, ...params) {
  const base = baseUrl();
  if (!base) throw new Error('JDownloader ist nicht eingerichtet (Seitenverwaltung → Downloads → Regeln → Verbindung).');
  const q = params.map(p => encodeURIComponent(JSON.stringify(p))).join('&');
  const url = base + '/' + endpoint.replace(/^\//, '') + (q ? '?' + q : '');
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' });
  } catch (e) {
    throw new Error('JDownloader antwortet nicht (' + (e.name === 'TimeoutError' ? 'Zeitüberschreitung' : e.cause && e.cause.code || e.message) + ').');
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`JDownloader: HTTP ${res.status} bei ${endpoint}: ${text.split('\n')[0].slice(0, 160)}`);
  if (!text.trim()) return null;
  let body;
  try { body = JSON.parse(text); } catch { throw new Error('JDownloader: keine gültige Antwort bei ' + endpoint); }
  return body && typeof body === 'object' && !Array.isArray(body) && 'data' in body ? body.data : body;
}

const ALL = { maxResults: -1, startAt: 0 };
const api = {
  version: () => call('jd/version'),
  // Linksammler: nichts startet von selbst; der Paketname ordnet die Links einem Vorschlag zu
  addLinks: (links, packageName, destinationFolder) => call('linkgrabberv2/addLinks', {
    links, packageName, destinationFolder, autostart: false, overwritePackagizerRules: true, deepDecrypt: false,
  }),
  isCollecting: () => call('linkgrabberv2/isCollecting'),
  crawledPackages: () => call('linkgrabberv2/queryPackages', { ...ALL, childCount: true, bytesTotal: true, saveTo: true }),
  crawledLinks: packageUUIDs => call('linkgrabberv2/queryLinks', { ...ALL, packageUUIDs: packageUUIDs || [], bytesTotal: true, availability: true,
    url: true, host: true, variants: true }),
  getVariants: linkId => call('linkgrabberv2/getVariants', linkId),
  setVariant: (linkId, variantId) => call('linkgrabberv2/setVariant', linkId, variantId),
  removeCrawled: (linkIds, packageIds) => call('linkgrabberv2/removeLinks', linkIds || [], packageIds || []),
  moveToDownloads: (linkIds, packageIds) => call('linkgrabberv2/moveToDownloadlist', linkIds || [], packageIds || []),
  // Downloadliste
  packages: () => call('downloadsV2/queryPackages', { ...ALL, bytesLoaded: true, bytesTotal: true, speed: true, eta: true, finished: true,
    running: true, enabled: true, status: true, saveTo: true, childCount: true }),
  links: packageUUIDs => call('downloadsV2/queryLinks', { ...ALL, packageUUIDs: packageUUIDs || [], bytesLoaded: true, bytesTotal: true,
    finished: true, running: true, status: true, enabled: true, speed: true, eta: true, url: true }),
  removeDownloads: (linkIds, packageIds) => call('downloadsV2/removeLinks', linkIds || [], packageIds || []),
  setEnabled: (enabled, linkIds, packageIds) => call('downloadsV2/setEnabled', enabled, linkIds || [], packageIds || []),
  start: () => call('downloadcontroller/start'),
  pause: on => call('downloadcontroller/pause', !!on),
  state: () => call('downloadcontroller/getCurrentState'),
};

module.exports = { call, configured, baseUrl, ...api };
