// Roof geometry checks: run with `npm test` (node >= 18).
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import SG from '../web/geom.js';
const D = JSON.parse(readFileSync(new URL('../web/public/scad-savannah.json', import.meta.url)));

const footArea = f => { let s = 0; for (let i = 0; i < f.length; i += 2) { const j = (i + 2) % f.length; s += f[i] * f[j + 1] - f[j] * f[i + 1] } return Math.abs(s) / 2 };
function roofStats(g) {
  let area = 0, lo = Infinity, hi = -Infinity;
  for (let i = 0; i < g.pos.length; i += 9) {
    if (g.shade[i / 3] >= 0) continue;
    const p = g.pos;
    area += Math.abs((p[i + 3] - p[i]) * (p[i + 8] - p[i + 2]) - (p[i + 6] - p[i]) * (p[i + 5] - p[i + 2])) / 2;
    for (const k of [1, 4, 7]) { lo = Math.min(lo, p[i + k]); hi = Math.max(hi, p[i + k]) }
  }
  return { area, lo, hi };
}
const RECT = [0, 0, 20, 0, 20, 10, 0, 10], OBB = [10, 5, 0, 10, 5];

for (const [shape, name] of [[1, 'gabled'], [2, 'hipped'], [3, 'pyramidal'], [4, 'skillion']]) {
  test(`${name} roof on a 20x10 box spans wall top to ridge and covers the footprint`, () => {
    const g = SG.building(THREE, [0, '', RECT, [], 0, 6, 4, shape, OBB, '', '', 0]);
    const s = roofStats(g);
    assert.ok(Math.abs(s.area - 200) < 0.01, `roof area ${s.area}`);
    assert.ok(Math.abs(s.lo - 6) < 1e-4 && Math.abs(s.hi - 10) < 1e-4, `roof y ${s.lo}..${s.hi}`);
  });
}

test('pitched shape with zero roof height falls back to flat', () => {
  const s = roofStats(SG.building(THREE, [0, '', RECT, [], 0, 6, 0, 1, OBB, '', '', 0]));
  assert.ok(Math.abs(s.area - 200) < 0.01 && s.hi === 6);
});

test('courtyard hole is left open', () => {
  const hole = [5, 3, 5, 7, 15, 7, 15, 3];
  const s = roofStats(SG.building(THREE, [0, '', RECT, [hole], 0, 6, 0, 0, OBB, '', '', 0]));
  assert.ok(Math.abs(s.area - 160) < 0.01, `roof area ${s.area}`);
});

test('every building in the dataset builds finite geometry with a roof matching its footprint', () => {
  const off = [];
  for (const b of D.b) {
    const g = SG.building(THREE, b);
    assert.ok(g.pos.every(Number.isFinite), `NaN in ${b[1] || 'building'}`);
    if (b[7] === 5) continue; // dome is drawn over the bounding box
    const want = footArea(b[2]) - b[3].reduce((a, h) => a + footArea(h), 0);
    const q = roofStats(g).area / want;
    if (q < 0.97 || q > 1.03) off.push([b[1], b[7], q]);
  }
  assert.deepStrictEqual(off, []);
});

test('dataset keeps 71 SCAD buildings and the named landmarks', () => {
  const scad = D.b.filter(b => b[0]);
  assert.strictEqual(scad.length, 71);
  for (const n of ['Poetter Hall', 'Jen Library', 'SCAD Museum of Art', 'Eichberg Hall', 'Montgomery Hall'])
    assert.ok(scad.some(b => b[1] === n), n);
});
