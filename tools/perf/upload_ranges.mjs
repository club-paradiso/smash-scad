// How many vertex ranges a blast dirties, with the OSM vertex order vs the spatial (tile) order.
// Mirrors rangeTracker() in web/src/main.js. Run: node tools/perf/upload_ranges.mjs
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { building } from '../../web/geom.js';
const D = JSON.parse(readFileSync(new URL('../../web/public/scad-savannah.json', import.meta.url)));
const B = D.b, n = B.length, cnt = [], X = [], Z = [], R = [];
for (let k = 0; k < n; k++) { const f = B[k][2]; let cx = 0, cz = 0; for (let i = 0; i < f.length; i += 2) { cx += f[i]; cz += f[i + 1] } cx /= f.length / 2; cz /= f.length / 2; X[k] = cx; Z[k] = cz;
  let r = 0; for (let i = 0; i < f.length; i += 2) r = Math.max(r, Math.hypot(f[i] - cx, f[i + 1] - cz)); R[k] = r; cnt[k] = building(THREE, B[k]).pos.length / 3 }
const nv = cnt.reduce((a, b) => a + b);
const zone = ['Poetter Hall', 'Jen Library', 'Student Center'].map(nm => B.findIndex(b => b[1] === nm)).filter(k => k >= 0);
const tx = zone.reduce((a, k) => a + X[k], 0) / zone.length, tz = zone.reduce((a, k) => a + Z[k], 0) / zone.length;
function layout(order) { const vs = new Array(n); let p = 0; for (const k of order) { vs[k] = p; p += cnt[k] } return vs }
const osm = layout([...Array(n).keys()]);
const TILE = 400, OFF = 4000, tile = k => Math.floor((Z[k] + OFF) / TILE) * 1000 + Math.floor((X[k] + OFF) / TILE);
const sp = layout([...Array(n).keys()].sort((a, b) => tile(a) - tile(b) || R[b] - R[a] || a - b));
function ranges(ks, vs, GAP = 512, MAXR = 96, FULL = .5) {
  const l = [...ks].sort((a, b) => vs[a] - vs[b]); const Rr = []; let s = -1, e = -1, cov = 0;
  for (const k of l) { const a = vs[k], b = a + cnt[k]; if (s < 0) { s = a; e = b } else if (a - e <= GAP) e = Math.max(e, b); else { Rr.push([s, e]); cov += e - s; s = a; e = b } }
  Rr.push([s, e]); cov += e - s; const full = Rr.length > MAXR || cov >= nv * FULL;
  return full ? `FULL upload (${Rr.length} ranges would be needed)` : `${Rr.length} ranges, ${(cov * 12 / 1024).toFixed(0)} KB per attribute`;
}
for (const [name, r] of [['bomb', 30], ['meteor', 85], ['nuke', 320], ['quake', 480]]) {
  const ks = []; for (let k = 0; k < n; k++) { const d = Math.hypot(X[k] - tx, Z[k] - tz) - (name === 'quake' ? 0 : R[k] * .6); if (d < r) ks.push(k) }
  console.log(`${name.padEnd(6)} r=${r}m buildings=${String(ks.length).padStart(4)} | OSM order: ${ranges(ks, osm)} | spatial: ${ranges(ks, sp)}`);
}
console.log('full upload per attribute:', (nv * 12 / 1024).toFixed(0), 'KB');
