// Tap picking: the BVH raycast (three-mesh-bvh, indirect mode) must return the same triangles as three's
// brute-force raycast on the merged, non-indexed city geometry, so faceIndex -> building stays valid.
// Compared the way the game uses hits: which building is hit at which distance, nearest first.
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import { building } from '../web/geom.js';

const D = JSON.parse(readFileSync(new URL('../web/public/scad-savannah.json', import.meta.url)));
const P = [], FB = [];
D.b.forEach((b, k) => { const g = building(THREE, b); for (const v of g.pos) P.push(v); for (let t = 0; t < g.pos.length / 9; t++) FB.push(k) });
const geo = new THREE.BufferGeometry();
geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
const plain = new THREE.Mesh(geo, mat);
const fast = new THREE.Mesh(geo, mat);
fast.raycast = acceleratedRaycast;

test('BVH build keeps the geometry non-indexed and untouched', () => {
  geo.boundsTree = new MeshBVH(geo, { indirect: true });
  assert.strictEqual(geo.index, null);
  assert.strictEqual(geo.attributes.position.count, P.length / 3);
});

test('BVH raycast hits the same triangles as brute force (400 camera rays)', () => {
  const bvh = new MeshBVH(geo, { indirect: true });
  const ray = new THREE.Raycaster(), pos = geo.attributes.position; let rnd = 1;
  const r = () => (rnd = (rnd * 16807) % 2147483647) / 2147483647;
  let hits = 0;
  for (let i = 0; i < 400; i++) {
    // even rays aim at a random building vertex, odd rays at a random spot on the map
    const v = (r() * pos.count) | 0;
    const t = i % 2 ? new THREE.Vector3(-1500 + r() * 2600, 0, -1200 + r() * 4300) : new THREE.Vector3(pos.getX(v), pos.getY(v) * .5, pos.getZ(v));
    const o = new THREE.Vector3(t.x + 250 + (r() - .5) * 300, 330, t.z + 400 + (r() - .5) * 300);
    ray.set(o, t.clone().sub(o).normalize());
    geo.boundsTree = null; const a = ray.intersectObject(plain, false);
    geo.boundsTree = bvh; const b = ray.intersectObject(fast, false);
    // A ray through a shared edge or vertex hits 2-3 triangles of one building at one distance, and the two
    // methods may report a different number of those duplicates. Compare unique (distance, building) pairs.
    const key = hs => [...new Set(hs.map(h => `${Math.round(h.distance * 1e3)}:${FB[h.faceIndex]}`))].sort();
    assert.deepStrictEqual(key(b), key(a), `ray ${i}`);
    if (a.length) assert.strictEqual(FB[b[0].faceIndex], FB[a[0].faceIndex], `ray ${i} first building`);
    hits += a.length > 0;
  }
  assert.ok(hits >= 200, `only ${hits} rays hit a building`);
});
