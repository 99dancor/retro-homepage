'use strict';
// YouTube-Videos im Mediaplayer und in Lobbys. Abgespielt wird im Browser über den eingebetteten Player von
// youtube-nocookie.com. Der Server holt nur die Titel über die öffentliche oEmbed-Schnittstelle,
// dabei geht keine Angabe über den Besucher an YouTube.
const VIDEO_ID = /^[\w-]{11}$/;
const OEMBED = process.env.YOUTUBE_OEMBED_URL || 'https://www.youtube.com/oembed';

async function oembed(id) {
  try {
    const url = `${OEMBED}?format=json&url=${encodeURIComponent('https://www.youtube.com/watch?v=' + id)}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(4000), headers: { 'accept-language': 'de' } });
    if (!r.ok) return null;
    const j = await r.json();
    return { title: String(j.title || '').slice(0, 200), artist: String(j.author_name || '').slice(0, 200) };
  } catch { return null; }
}

// Titel für mehrere Videos, höchstens fünf Anfragen gleichzeitig
async function items(ids) {
  ids = [...new Set(ids.map(String).filter(id => VIDEO_ID.test(id)))].slice(0, 200);
  const out = new Array(ids.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(5, ids.length) }, async () => {
    while (next < ids.length) {
      const i = next++;
      const meta = await oembed(ids[i]);
      out[i] = { type: 'yt', videoId: ids[i], title: (meta && meta.title) || 'YouTube-Video ' + ids[i], artist: (meta && meta.artist) || '', duration: 0, guessed: !meta };
    }
  }));
  return out;
}

module.exports = { items, VIDEO_ID };
