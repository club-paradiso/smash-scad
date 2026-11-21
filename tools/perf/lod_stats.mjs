// Share of vertices held by small buildings (by footprint radius), to size the distance LOD.
// Run: node tools/perf/lod_stats.mjs
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { building } from '../../web/geom.js';
const D = JSON.parse(readFileSync(new URL('../../web/public/scad-savannah.json', import.meta.url)));
const rows = D.b.map(b => { const f = b[2]; let cx = 0, cz = 0; for (let i = 0; i < f.length; i += 2) { cx += f[i]; cz += f[i + 1] } cx /= f.length / 2; cz /= f.length / 2;
  let r = 0; for (let i = 0; i < f.length; i += 2) r = Math.max(r, Math.hypot(f[i] - cx, f[i + 1] - cz)); return { r, v: building(THREE, b).pos.length / 3, scad: !!b[0] } });
const nv = rows.reduce((a, x) => a + x.v, 0);
for (const t of [4, 6, 8, 10, 12, 15, 20]) { const s = rows.filter(x => x.r < t); console.log(`radius < ${String(t).padStart(2)} m: ${String(s.length).padStart(4)} buildings (${s.filter(x => x.scad).length} SCAD), ${(s.reduce((a, x) => a + x.v, 0) / nv * 100).toFixed(1)}% of vertices`) }
