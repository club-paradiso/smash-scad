// Simple 3D Buildings geometry for SMASH SCAD.
// Roof surface = min of planes over the footprint (flat, gabled, hipped, pyramidal, skillion);
// dome = half-ellipsoid over the oriented bounding box. Walls follow the roof line, so gable ends close.
// ES module, shared by the game (Vite) and the node tests. THREE is passed in so this file has no imports.
// plane: z = a + bx*x + bz*z  (height above wall top)
function planesFor(shape, H, ob) {
  const [cx, cz, ang, hl, hw] = ob, c = Math.cos(ang), s = Math.sin(ang);
  // u = (x-cx)c + (z-cz)s ; v = -(x-cx)s + (z-cz)c
  const U = (k, m) => ({ a: k + m * (-cx * c - cz * s), bx: m * c, bz: m * s }); // k + m*u
  const V = (k, m) => ({ a: k + m * (cx * s - cz * c), bx: -m * s, bz: m * c }); // k + m*v
  const fix = p => ({ a: p.a, bx: p.bx, bz: p.bz });
  const w = Math.max(hw, 0.5), l = Math.max(hl, 0.5);
  if (shape === 1) return [V(H, -H / w), V(H, H / w)].map(fix);
  if (shape === 2) return [V(H, -H / w), V(H, H / w), U(H * l / w, -H / w), U(H * l / w, H / w)].map(fix);
  if (shape === 3) return [V(H, -H / w), V(H, H / w), U(H, -H / l), U(H, H / l)].map(fix);
  if (shape === 4) return [V(H / 2, -H / (2 * w))].map(fix);
  return [{ a: 0, bx: 0, bz: 0 }];
}
const ev = (p, x, z) => p.a + p.bx * x + p.bz * z;
const roofZ = (pl, x, z) => { let m = Infinity; for (const p of pl) m = Math.min(m, ev(p, x, z)); return Math.max(0, m) };
// keep points where f(x,z) <= 0, f linear
function clip(ring, f) {
  const out = [], n = ring.length;
  for (let i = 0; i < n; i++) {
    const A = ring[i], B = ring[(i + 1) % n], fa = f(A[0], A[1]), fb = f(B[0], B[1]);
    if (fa <= 0) out.push(A);
    if ((fa < 0 && fb > 0) || (fa > 0 && fb < 0)) { const t = fa / (fa - fb); out.push([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t]) }
  }
  return out;
}
const area = r => { let s = 0; for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; s += a[0] * b[1] - b[0] * a[1] } return s / 2 };
function toPts(flat) { const r = []; for (let i = 0; i < flat.length; i += 2) r.push([flat[i], flat[i + 1]]); return r }
// insert points where the active roof plane changes along each edge
function augment(ring, pl) {
  if (pl.length < 2) return ring;
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const A = ring[i], B = ring[(i + 1) % ring.length]; out.push(A);
    const ts = [];
    for (let p = 0; p < pl.length; p++) for (let q = p + 1; q < pl.length; q++) {
      const da = ev(pl[p], A[0], A[1]) - ev(pl[q], A[0], A[1]), db = ev(pl[p], B[0], B[1]) - ev(pl[q], B[0], B[1]);
      if ((da < 0 && db > 0) || (da > 0 && db < 0)) { const t = da / (da - db); if (t > 1e-4 && t < 1 - 1e-4) ts.push(t) }
    }
    ts.sort((x, y) => x - y);
    for (const t of ts) out.push([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t]);
  }
  return out;
}
function tri(THREE, outer, holes) {
  if (outer.length < 3 || Math.abs(area(outer)) < 0.05) return [];
  const V = r => r.map(p => new THREE.Vector2(p[0], p[1]));
  const o = V(outer), hs = holes.filter(h => h.length >= 3 && Math.abs(area(h)) > 0.05).map(V);
  let t; try { t = THREE.ShapeUtils.triangulateShape(o, hs) } catch (e) { return [] }
  const all = o.concat(...hs); return t.map(f => f.map(j => all[j]));
}
// returns {pos:[x,y,z...], shade:[...]} ; shade >0 = wall (bottom .78, top 1), <0 = roof
function building(THREE, rec) {
  const [, , oflat, hflat, minH, wallTop, roofH0, shape0, ob] = rec;
  let shape = roofH0 > 0.05 ? shape0 : 0, roofH = shape ? roofH0 : 0;
  const outer = toPts(oflat), holes = hflat.map(toPts);
  const pl = shape === 5 || shape === 0 ? [{ a: 0, bx: 0, bz: 0 }] : planesFor(shape, roofH, ob);
  const pos = [], shade = [];
  const top = (x, z) => wallTop + (pl.length > 1 || shape === 4 ? roofZ(pl, x, z) : 0);
  // walls
  for (const ring of [outer, ...holes]) {
    const r = augment(ring, pl);
    for (let i = 0; i < r.length; i++) {
      const A = r[i], B = r[(i + 1) % r.length], ta = top(A[0], A[1]), tb = top(B[0], B[1]);
      pos.push(A[0], minH, A[1], B[0], minH, B[1], B[0], tb, B[1], A[0], minH, A[1], B[0], tb, B[1], A[0], ta, A[1]);
      shade.push(.78, .78, 1, .78, 1, 1);
    }
  }
  // roof
  if (shape === 0 || shape === 5 || pl.length === 1) {
    const p0 = pl[0];
    for (const t of tri(THREE, outer, holes)) for (const v of t) { pos.push(v.x, wallTop + (shape === 4 ? Math.max(0, ev(p0, v.x, v.y)) : 0), v.y); shade.push(-1.06) }
  } else {
    for (let i = 0; i < pl.length; i++) {
      const fs = pl.filter((_, j) => j !== i).map(q => (x, z) => ev(pl[i], x, z) - ev(q, x, z) - 1e-6);
      const cl = r => fs.reduce((acc, f) => acc.length ? clip(acc, f) : acc, r);
      const o = cl(outer); if (o.length < 3) continue;
      const hs = holes.map(cl).filter(h => h.length >= 3);
      for (const t of tri(THREE, o, hs)) for (const v of t) { pos.push(v.x, wallTop + Math.max(0, ev(pl[i], v.x, v.y)), v.y); shade.push(-1.06) }
    }
  }
  if (shape === 5) { // dome
    const [cx, cz, ang, hl, hw] = ob, c = Math.cos(ang), s = Math.sin(ang), SEG = 20, RING = 7;
    const P = (i, j) => { const th = i / SEG * Math.PI * 2, ph = j / RING * Math.PI / 2; const u = Math.cos(th) * Math.cos(ph) * hl, v = Math.sin(th) * Math.cos(ph) * hw;
      return [cx + u * c - v * s, wallTop + Math.sin(ph) * roofH, cz + u * s + v * c] };
    for (let i = 0; i < SEG; i++) for (let j = 0; j < RING; j++) {
      const a = P(i, j), b = P(i + 1, j), d = P(i + 1, j + 1), e = P(i, j + 1);
      pos.push(...a, ...b, ...d, ...a, ...d, ...e); shade.push(-1.06, -1.06, -1.06, -1.06, -1.06, -1.06);
    }
  }
  return { pos, shade, top: wallTop + roofH };
}
export { building, planesFor, roofZ };
export default { building, planesFor, roofZ };
