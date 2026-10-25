// Fotoalbum: Schnappschüsse der Tiere als Pixelbild. Gespeichert wird nicht das Bild, sondern nur, wer wo stand
// (state.album, höchstens ALBUM_MAX Fotos); gezeichnet wird es erst beim Anschauen.
//
//   shot  { w, h, floor, room?, pets, things, marks }   alles in Bildpunkten (unabhängig von der Bildschirmgröße)
//         floor: Höhe des Bodens (Desktop: Taskleiste, Zimmer: Wandkante) oder null
//         room:  Zimmer-id, dann ist das Zimmer der Hintergrund, sonst der Desktop
//         pets   [{ name, species, color, acc, face, pose, facing, x, y }]   x, y: Fußpunkt (Mitte unten)
//         things [{ id, x, y }]   links oben      marks [{ kind, x, y }]   Mitte unten
//   photoSvg(shot) -> <svg>        cleanShot(raw) -> shot oder null (beim Laden des Spielstands)
import { petSvg, roomSvg } from './art.js';
import { SPECIES } from './pets.js';
import { furnSvg, furnGrid, hasFurn } from './furniture.js';
import { MESS, messSvg, messSize } from './mess.js';
import { POSES } from './pixel.js';

const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : null);
const str = (v, n = 40) => (typeof v === 'string' ? v.slice(0, n) : '');

// Ein fremdes <svg> an eine Stelle im Foto setzen
const nest = (svg, x, y, w, h) => svg.replace('<svg ', `<svg x="${x}" y="${y}" width="${w}" height="${h}" `);

export function photoSvg(shot, { cls = 'photo', label = '' } = {}) {
  const { w, h } = shot;
  let out = '';
  if (shot.room) out += nest(roomSvg(shot.room), 0, 0, w, h);
  else {
    out += `<rect width="${w}" height="${h}" fill="#3a6ea5"/>`;
    if (shot.floor !== null && shot.floor !== undefined) out += `<rect y="${shot.floor}" width="${w}" height="${Math.max(0, h - shot.floor)}" fill="#c0c0c0"/><rect y="${shot.floor}" width="${w}" height="1" fill="#ffffff"/>`;
  }
  for (const t of shot.things || []) {
    const g = furnGrid(t.id);
    out += nest(furnSvg(t.id), t.x, t.y, g.w, g.h);
  }
  for (const m of shot.marks || []) {
    const s = messSize(m.kind);
    out += nest(messSvg(m.kind), Math.round(m.x - s.w / 2), m.y - s.h + 1, s.w, s.h);
  }
  for (const p of shot.pets || []) {
    const svg = nest(petSvg(p.species, p.color, p.face || 'ok', { acc: p.acc || {}, pose: p.pose || 'stand', shadow: true }), p.x - 24, p.y - 47, 48, 48);
    out += p.facing < 0 ? `<g transform="translate(${2 * p.x} 0) scale(-1 1)">${svg}</g>` : svg;
  }
  const names = (shot.pets || []).map((p) => p.name).filter(Boolean).join(', ');
  return `<svg class="${cls}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${(label || 'Foto von ' + names).replace(/[<>"&]/g, '')}" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">${out}</svg>`;
}

// Was aus dem Spielstand kommt, wird geprüft: nur bekannte Tiere, Möbel und Flecken, Zahlen in Grenzen
export function cleanShot(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.pets)) return null;
  const w = num(raw.w, 40, 2000), h = num(raw.h, 40, 1200);
  if (!w || !h) return null;
  const pets = raw.pets.filter((p) => p && SPECIES[p.species]).slice(0, 8).map((p) => ({
    name: str(p.name, 30), species: p.species, color: str(p.color, 20), face: ['ok', 'happy', 'sad', 'sleep'].includes(p.face) ? p.face : 'ok',
    acc: p.acc && typeof p.acc === 'object' ? Object.fromEntries(['head', 'neck', 'back'].filter((k) => typeof p.acc[k] === 'string').map((k) => [k, p.acc[k]])) : {},
    pose: p.pose === 'stand' || POSES.includes(p.pose) ? p.pose : 'stand', facing: p.facing < 0 ? -1 : 1, x: num(p.x, -50, w + 50) ?? 0, y: num(p.y, 0, h + 50) ?? h,
  }));
  if (!pets.length) return null;
  return {
    w, h, floor: num(raw.floor, 0, h), ...(typeof raw.room === 'string' ? { room: raw.room } : {}), pets,
    things: (Array.isArray(raw.things) ? raw.things : []).filter((t) => t && typeof t.id === 'string' && hasFurn(t.id)).slice(0, 20).map((t) => ({ id: t.id, x: num(t.x, -500, w) ?? 0, y: num(t.y, -500, h) ?? 0 })),
    marks: (Array.isArray(raw.marks) ? raw.marks : []).filter((m) => m && MESS[m.kind]).slice(0, 20).map((m) => ({ kind: m.kind, x: num(m.x, 0, w) ?? 0, y: num(m.y, 0, h) ?? 0 })),
  };
}
