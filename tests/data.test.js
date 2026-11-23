// Map data checks for the v3 schema: height sources, trees, surroundings layers.
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const D = JSON.parse(readFileSync(new URL('../web/public/scad-savannah.json', import.meta.url)));
const L = JSON.parse(readFileSync(new URL('../data/lidar_heights.json', import.meta.url)));

test('schema v3 has every layer', () => {
  assert.strictEqual(D.v, 3);
  for (const k of ['b', 'r', 'p', 'w', 'river', 't', 'tr', 'f', 'rl', 'pl', 'a', 'pn', 'cc']) assert.ok(Array.isArray(D[k]), k);
});

test('height source flags are 0 tagged, 1 estimated, 2 lidar height, 3 lidar shape; lidar heights only on untagged flat roofs', () => {
  for (const b of D.b) {
    assert.ok([0, 1, 2, 3].includes(b[11]), String(b[11]));
    assert.strictEqual(b.length === 13, b[11] === 3, `${b[1]}: shape field iff est=3`);
    if (b[11] === 2) { assert.strictEqual(b[7], 0, `${b[1]} lidar height on a non-flat roof`); assert.ok(b[5] - b[4] >= 2 && b[5] < 120, `${b[1]} ${b[5]}`) }
  }
  // counts at the time of the 2026-11-21 rebuild; change them with the data, with a reason
  assert.strictEqual(D.b.filter(b => b[11] === 2).length, 2410);   // box + lidar height (flat roofs, and roofs 12 points can't fit within 2 m)
  assert.strictEqual(D.b.filter(b => b[11] === 3).length, 1169);   // measured shape: 67 SCAD + 1,102 other non-flat roofs
  assert.strictEqual(D.b.filter(b => b[0] && b[11] === 3).length, 67);
  assert.strictEqual(D.b.filter(b => b[0] && b[11] === 1).length, 3);
});

test('lidar check against OSM levels stays within the recorded error', () => {
  const c = L.check['vs_levels_tag_flat_x3.2+0.8'];
  assert.ok(c.n >= 150, `n ${c.n}`);
  assert.ok(Math.abs(c.median_error_m) < 1.5 && c.within_3m_pct >= 65, JSON.stringify(c));
});

test('trees are OSM nodes with lidar height/crown or 0 when not measured', () => {
  for (const [x, z, needle, h, r] of D.t) {
    assert.ok(Number.isFinite(x) && Number.isFinite(z) && (needle === 0 || needle === 1));
    assert.ok(h === 0 ? r === 0 : h >= 2 && h <= 35 && r >= 1, `${h} ${r}`);
  }
});

test('surface areas use known kinds and closed rings', () => {
  for (const [k, f] of D.a) { assert.ok(k >= 0 && k <= 6, String(k)); assert.ok(f.length >= 6 && f.length % 2 === 0) }
});

test('named squares and parks come from OSM names', () => {
  const names = D.pn.map(p => p[2]);
  for (const n of ['Forsyth Park', 'Chippewa Square', 'Madison Square', 'Johnson Square']) assert.ok(names.includes(n), n);
  for (const [x, z, n, a] of D.pn) assert.ok(Number.isFinite(x) && Number.isFinite(z) && n && a > 0);
});

test('measured shapes: valid indices, outline rings match the footprint, roof covers it', () => {
  const area = f => { let a = 0; for (let i = 0; i < f.length; i += 2) { const j = (i + 2) % f.length; a += f[i] * f[j + 1] - f[j] * f[i + 1] } return Math.abs(a) / 2 };
  for (const b of D.b.filter(b => b[11] === 3)) {
    const { v, t, r } = b[12], n = v.length / 3;
    assert.ok(t.length % 3 === 0 && t.every(i => i >= 0 && i < n), b[1]);
    assert.strictEqual(r.length, 1 + b[3].length, `${b[1]} rings`);
    for (const ring of r) assert.ok(ring.length >= 3 && ring.every(i => i < n));
    for (let i = 2; i < v.length; i += 3) assert.ok(v[i] >= 0.5 && v[i] <= 80, `${b[1]} height ${v[i]}`);
    let roof = 0;
    for (let i = 0; i < t.length; i += 3) { const [a, c, d] = [t[i], t[i + 1], t[i + 2]].map(q => q * 3);
      roof += Math.abs((v[c] - v[a]) * (v[d + 1] - v[a + 1]) - (v[d] - v[a]) * (v[c + 1] - v[a + 1])) / 2 }
    const want = area(b[2]) - b[3].reduce((s, h) => s + area(h), 0);
    assert.ok(Math.abs(roof / want - 1) < 0.03, `${b[1]} roof ${roof.toFixed(0)} vs footprint ${want.toFixed(0)}`);
  }
});

test('lidar tree crowns: measured sizes, green photo colour, not on buildings', () => {
  assert.strictEqual(D.cc.length, 15810);   // 2026-11-23 build: 19,997 tops - 2,295 on buildings - 1,892 not green in 2023
  for (const [x, z, top, base, r, R, G, B] of D.cc) {
    assert.ok(Number.isFinite(x) && Number.isFinite(z));
    assert.ok(top >= 4 && top <= 45 && base >= 1.5 && base < top && r >= 1.2 && r <= 20, `${top} ${base} ${r}`);
    assert.ok(2 * G - R - B >= 15, `colour ${R},${G},${B}`);
  }
});
