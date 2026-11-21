// Map data checks for the v3 schema: height sources, trees, surroundings layers.
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const D = JSON.parse(readFileSync(new URL('../web/public/scad-savannah.json', import.meta.url)));
const L = JSON.parse(readFileSync(new URL('../data/lidar_heights.json', import.meta.url)));

test('schema v3 has every layer', () => {
  assert.strictEqual(D.v, 3);
  for (const k of ['b', 'r', 'p', 'w', 'river', 't', 'tr', 'f', 'rl', 'pl', 'a']) assert.ok(Array.isArray(D[k]), k);
});

test('height source flags are 0 tagged, 1 estimated, 2 lidar, and lidar heights are only on untagged flat roofs', () => {
  for (const b of D.b) {
    assert.ok([0, 1, 2].includes(b[11]), String(b[11]));
    if (b[11] === 2) { assert.strictEqual(b[7], 0, `${b[1]} lidar height on a non-flat roof`); assert.ok(b[5] - b[4] >= 2 && b[5] < 120, `${b[1]} ${b[5]}`) }
  }
  // counts at the time of the 2026-11-21 rebuild; change them with the data, with a reason
  assert.strictEqual(D.b.filter(b => b[11] === 2).length, 3408);
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
