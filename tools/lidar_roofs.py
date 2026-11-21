"""Measured 3D shape of the buildings on the map from USGS 3DEP lidar (GA_Statewide_B5_2018, public domain).

Input : data/lidar/*.laz, data/footprints.json   Output: data/lidar_roofs.json  {meta, b: {osm key: shape}}
shape : v [x, z, h, ...] (h metres above the ground beside the building), t [i, j, k, ...] roof triangles,
        r [[outer ring vertex indices], [hole ring indices], ...] in footprint order, n building points used.

Method
1. Roof surface: building-class (6) points inside the OSM footprint (holes excluded), binned to a 1 m grid;
   each cell takes the 75th percentile elevation, empty cells take the nearest filled cell, and a 3x3 median
   applied twice removes small spikes (antennas, rooftop units, stray returns). Height = that minus the median ground under the
   footprint (2 m ground grid from lidar_common).
2. Simplification: the footprint outline (densified to `edge` m) is the fixed boundary of a constrained Delaunay
   triangulation; interior grid points are added greedily where the surface is off by more than `tol` metres,
   until every grid point is within it (SCAD: tol 0.75 m, edge 2.5 m; other buildings: 1.5 m, OSM vertices only, at most 12
   added points; the outline is not densified).
   Non-SCAD buildings whose roof is flat within 1 m (95% of grid points) keep the box with the lidar height
   (tools/lidar_heights.py): same look, far fewer triangles. Non-SCAD buildings whose 12-point fit still misses the
   surface by more than 2 m also keep the box (a wide roof pulled up to one tall point would be a false shape). Flat roofs end up as a few triangles, towers and slopes stay detailed.
3. Walls (built in web/geom.js) follow the OSM outline up to the roof height measured 1 m inside the outline.
A footprint is skipped when building points are under 50% of its first returns or fewer than 30: the lidar
then shows something else there (trees, a building newer than the 2018 flight). The box model stays then.
Run: python3 tools/lidar_roofs.py   (needs: numpy, scipy, laspy[lazrs], triangle)
"""
import json, math
import numpy as np
import triangle
from scipy import ndimage
from lidar_common import *   # x, z, e, c, rn, ground_at, points_in_box, pip

G = 1.0
# SCAD buildings (the targets, seen up close) get a finer fit than the rest of the city
PARAMS = {True: dict(tol=0.75, edge=2.5, maxpts=1500), False: dict(tol=1.5, edge=1e9, maxpts=12)}
FLAT_OK = 1.0   # non-SCAD: if a flat roof at the median height is within this everywhere, keep the box
FIT_MAX = 2.0   # non-SCAD: if 12 points can't fit the roof within this, keep the box (avoids false tent shapes)

def densify(ring, step):
    out = []
    for i in range(len(ring)):
        a, b = np.asarray(ring[i]), np.asarray(ring[(i + 1) % len(ring)])
        n = max(1, int(math.ceil(np.hypot(*(b - a)) / step)))
        for k in range(n): out.append(a + (b - a) * k / n)
    return np.asarray(out)

def surface(f):
    o = np.asarray(f['o'], float)
    x0, z0 = o[:, 0].min() - 1, o[:, 1].min() - 1; x1, z1 = o[:, 0].max() + 1, o[:, 1].max() + 1
    ids = points_in_box(x0, z0, x1, z1)
    if not len(ids): return None
    px, pz = x[ids], z[ids]
    m = pip(px, pz, f['o'])
    for h in f['h']: m &= ~pip(px, pz, h)
    ids = ids[m]
    first = ids[rn[ids] == 1]; bld = ids[c[ids] == 6]
    nfirst_b = int((c[first] == 6).sum())
    if len(bld) < 30 or nfirst_b < 0.5 * max(1, len(first)): return None
    g = float(np.median(ground_at(x[ids], z[ids])))
    nx, nz = int((x1 - x0) / G) + 1, int((z1 - z0) / G) + 1
    ci = np.clip(((x[bld] - x0) / G).round().astype(int), 0, nx - 1); cj = np.clip(((z[bld] - z0) / G).round().astype(int), 0, nz - 1)
    cell = cj * nx + ci; order = np.lexsort((e[bld], cell)); cs, es = cell[order], e[bld][order]
    st = np.r_[0, np.flatnonzero(np.diff(cs)) + 1]; en = np.r_[st[1:], len(cs)]
    grid = np.full(nx * nz, np.nan, np.float32)
    grid[cs[st]] = es[st + ((en - st - 1) * 0.75).astype(int)]
    grid = grid.reshape(nz, nx); miss = np.isnan(grid)
    grid = grid[tuple(ndimage.distance_transform_edt(miss, return_distances=False, return_indices=True))]
    grid = ndimage.median_filter(ndimage.median_filter(grid, size=3, mode='nearest'), size=3, mode='nearest') - g
    def height(qx, qz):  # bilinear on the node grid
        fx = np.clip((qx - x0) / G, 0, nx - 1.001); fz = np.clip((qz - z0) / G, 0, nz - 1.001)
        i, j = fx.astype(int), fz.astype(int); u, v = fx - i, fz - j
        return (grid[j, i] * (1 - u) * (1 - v) + grid[j, i + 1] * u * (1 - v) + grid[j + 1, i] * (1 - u) * v + grid[j + 1, i + 1] * u * v)
    gx, gz = np.meshgrid(x0 + np.arange(nx) * G, z0 + np.arange(nz) * G)
    gx, gz = gx.ravel(), gz.ravel()
    inside = pip(gx, gz, f['o'])
    for h in f['h']: inside &= ~pip(gx, gz, h)
    gx, gz = gx[inside], gz[inside]
    # drop grid points within 0.4 m of the outline: Triangle can crash on points lying on (or almost on) a segment
    far = np.ones(len(gx), bool)
    for ring in [f['o']] + f['h']:
        r = np.asarray(ring, float); a, b = r, np.roll(r, -1, axis=0)
        for (ax, az), (bx, bz) in zip(a, b):
            dx, dz = bx - ax, bz - az; L2 = dx * dx + dz * dz or 1e-9
            t = np.clip(((gx - ax) * dx + (gz - az) * dz) / L2, 0, 1)
            far &= np.hypot(gx - (ax + t * dx), gz - (az + t * dz)) >= 0.4
    return dict(height=height, cand=np.c_[gx[far], gz[far]], n=len(bld), g=g)

def build(f, S, tol, edge, maxpts):
    rings = [densify(f['o'], edge)] + [densify(h, edge) for h in f['h']]
    bverts = np.vstack(rings); segs = []; off = 0; ring_idx = []
    for r in rings:
        k = len(r); segs += [[off + i, off + (i + 1) % k] for i in range(k)]; ring_idx.append(list(range(off, off + k))); off += k
    holes = []
    for h in f['h']:  # a point inside each hole (centroid of a triangle of its own triangulation)
        hv = np.asarray(h, float); ht = triangle.triangulate(dict(vertices=hv, segments=[[i, (i + 1) % len(hv)] for i in range(len(hv))]), 'p')
        holes.append(hv[ht['triangles'][0]].mean(0))
    cand = S['cand']; ch = S['height'](cand[:, 0], cand[:, 1]); used = np.zeros(len(cand), bool)
    inner = []
    for r in rings:  # inward normal per outline vertex (average of the two edge normals, flipped to point inside)
        k = len(r)
        for i in range(k):
            a, b, d = r[i - 1], r[i], r[(i + 1) % k]
            n1 = np.array([-(b - a)[1], (b - a)[0]]); n2 = np.array([-(d - b)[1], (d - b)[0]])
            n = n1 / (np.hypot(*n1) or 1) + n2 / (np.hypot(*n2) or 1); n = n / (np.hypot(*n) or 1)
            q = b + n * 1.0
            inside = pip(np.array([q[0]]), np.array([q[1]]), f['o'])[0]
            inner.append(q if inside else b - n * 1.0)
    inner = np.asarray(inner); bh = S['height'](inner[:, 0], inner[:, 1])
    while True:
        verts = np.vstack([bverts, cand[used]])
        A = dict(vertices=verts, segments=np.asarray(segs))
        if holes: A['holes'] = np.asarray(holes)
        T = triangle.triangulate(A, 'pQ')
        tv, tt = T['vertices'], T['triangles']
        th = S['height'](tv[:, 0], tv[:, 1])
        th[:len(bverts)] = bh  # outline vertices: height measured 1 m inside the wall (edge returns mix wall/eave/ground)
        err = np.zeros(len(cand))
        for tri in tt:  # barycentric interpolation of the TIN at every grid point inside each triangle
            a, b, d = tv[tri]; mnx, mxx = min(a[0], b[0], d[0]), max(a[0], b[0], d[0]); mnz, mxz = min(a[1], b[1], d[1]), max(a[1], b[1], d[1])
            sel = np.flatnonzero((cand[:, 0] >= mnx - 1e-6) & (cand[:, 0] <= mxx + 1e-6) & (cand[:, 1] >= mnz - 1e-6) & (cand[:, 1] <= mxz + 1e-6))
            if not len(sel): continue
            det = (b[1] - d[1]) * (a[0] - d[0]) + (d[0] - b[0]) * (a[1] - d[1])
            if abs(det) < 1e-9: continue
            p = cand[sel]
            l1 = ((b[1] - d[1]) * (p[:, 0] - d[0]) + (d[0] - b[0]) * (p[:, 1] - d[1])) / det
            l2 = ((d[1] - a[1]) * (p[:, 0] - d[0]) + (a[0] - d[0]) * (p[:, 1] - d[1])) / det
            l3 = 1 - l1 - l2; ins = (l1 >= -1e-6) & (l2 >= -1e-6) & (l3 >= -1e-6)
            hz = l1 * th[tri[0]] + l2 * th[tri[1]] + l3 * th[tri[2]]
            err[sel[ins]] = np.abs(hz[ins] - ch[sel[ins]])
        err[used] = 0
        bad = np.flatnonzero(err > tol)
        if not len(bad) or used.sum() >= maxpts: break
        used[bad[np.argsort(-err[bad])[:max(1, min(max(8, len(bad) // 6), maxpts - int(used.sum())))]]] = True
    # boundary vertices keep their order 0..len(bverts)-1 in triangle's output (it appends new points after)
    assert np.allclose(tv[:len(bverts)], bverts)
    return dict(v=[round(float(q), 1) for p, hh in zip(tv, th) for q in (p[0], p[1], max(0.5, hh))],
                t=[int(i) for tri in tt for i in tri], r=ring_idx, n=S['n'], err=round(float(err.max()), 2))

fp = json.load(open('data/footprints.json'))
out, skipped, flat, poor = {}, [], [], []
for f in fp:
    if not f['ok'] or f['part']: continue   # building:part pieces keep their OSM model
    S = surface(f)
    if S is None: skipped.append(f['k']); continue
    if not f['scad']:
        hh = S['height'](S['cand'][:, 0], S['cand'][:, 1]) if len(S['cand']) else np.zeros(0)
        if not len(hh) or np.percentile(np.abs(hh - np.median(hh)), 95) < FLAT_OK: flat.append(f['k']); continue
    shape = build(f, S, **PARAMS[bool(f['scad'])])
    if not f['scad'] and shape['err'] > FIT_MAX: poor.append(f['k']); continue
    out[f['k']] = shape
tri = sum(len(b['t']) // 3 for b in out.values())
scad = {f['k'] for f in fp if f['ok'] and f['scad']}
print('footprints', sum(1 for f in fp if f['ok'] and not f['part']), 'modelled', len(out), 'skipped', len(skipped), 'flat kept as box', len(flat), 'poor fit kept as box', len(poor),
      '| SCAD modelled', len(scad & set(out)), 'of', len(scad), '| roof triangles', tri,
      'SCAD', sum(len(out[k]['t']) // 3 for k in scad & set(out)))
json.dump({'meta': {'source': 'USGS 3DEP lidar, GA_Statewide_B5_2018 (s3://usgs-lidar-public, EPT), public domain',
                    'flight_year': 2018, 'grid_m': G, 'params': {'scad': PARAMS[True], 'other': PARAMS[False]}, 'method': 'see tools/lidar_roofs.py'},
           'skipped': skipped, 'b': out}, open('data/lidar_roofs.json', 'w'), separators=(',', ':'))
