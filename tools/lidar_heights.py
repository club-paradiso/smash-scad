"""Measure building and tree heights from USGS 3DEP lidar (GA_Statewide_B5_2018, public domain).

Inputs : data/lidar/*.laz (tools/lidar_fetch.py), data/footprints.json (tools/build_buildings.py),
         data/ground.json (tools/build_ground.py, for OSM tree positions)
Output : data/lidar_heights.json  {meta, check, b: {osm key: height m}, t: {"x,z": [height m, crown radius m]}}

Method (all numbers come from the point cloud; nothing is filled in when the lidar does not support it):
- Ground: 2 m grid of the median elevation of ground-class points (class 2), holes filled from the nearest
  ground cell, so the ground under a roof is the ground next to it.
- Building: lidar points inside the OSM footprint (holes excluded). Roof height = median elevation of the
  building-class points (class 6) minus the median ground under the footprint. The median gives a flat-roof
  equivalent: a pitched roof drawn flat keeps about the same volume. A footprint is measured only if
  building-class points are at least 50% of its first returns and there are at least 6 of them; otherwise it is
  skipped (tree cover, a building newer than the 2018 flight, or a footprint the classifier missed).
- Tree: vegetation points (classes 3-5) within 4 m of the OSM tree node. Height = 95th percentile elevation minus
  ground (kept only between 2 and 35 m); crown radius = 90th percentile horizontal distance of the points in the upper half of that height.
- The building method is checked against OSM buildings whose height is tagged (see "check" in the output).
Run: python3 tools/lidar_heights.py
"""
import glob, json, math
import numpy as np
import laspy
from scipy import ndimage

LAT0, LON0 = 32.0745, -81.0945                       # same origin as build_buildings.py
KX = math.cos(math.radians(LAT0)) * 111320; KZ = 110574

def load():
    xs, ys, zs, cs, rn = [], [], [], [], []
    for f in sorted(glob.glob('data/lidar/*.laz')):
        las = laspy.read(f)
        xs.append(np.asarray(las.x)); ys.append(np.asarray(las.y)); zs.append(np.asarray(las.z, dtype=np.float32))
        cs.append(np.asarray(las.classification, dtype=np.uint8)); rn.append(np.asarray(las.return_number, dtype=np.uint8))
    X = np.concatenate(xs); Y = np.concatenate(ys)
    lon = X / 20037508.342789244 * 180
    lat = np.degrees(2 * np.arctan(np.exp(Y / 6378137)) - math.pi / 2)
    x = ((lon - LON0) * KX).astype(np.float32); z = (-(lat - LAT0) * KZ).astype(np.float32)
    return x, z, np.concatenate(zs), np.concatenate(cs), np.concatenate(rn)

print('loading lidar ...')
x, z, e, c, rn = load()
# crop to the map box of tools/fetch_osm_tiles.sh (+60 m); upper EPT nodes reach far beyond it
bx0, bx1 = (-81.112 - LON0) * KX - 60, (-81.082 - LON0) * KX + 60
bz0, bz1 = -(32.086 - LAT0) * KZ - 60, -(32.044 - LAT0) * KZ + 60
keep = (c != 7) & (c != 18) & (x >= bx0) & (x <= bx1) & (z >= bz0) & (z <= bz1)   # also drop low/high noise
x, z, e, c, rn = x[keep], z[keep], e[keep], c[keep], rn[keep]
print('points', len(x), 'classes', {int(k): int(v) for k, v in zip(*np.unique(c, return_counts=True))})

# ---- ground grid (2 m) ----
G = 2.0
gx0, gz0 = float(x.min()), float(z.min())
nx, nz = int((x.max() - gx0) / G) + 1, int((z.max() - gz0) / G) + 1
gi = ((x - gx0) / G).astype(np.int32); gj = ((z - gz0) / G).astype(np.int32)
gm = c == 2
cell = gj[gm].astype(np.int64) * nx + gi[gm]
order = np.lexsort((e[gm], cell)); cs_, es_ = cell[order], e[gm][order]
starts = np.r_[0, np.flatnonzero(np.diff(cs_)) + 1]; ends = np.r_[starts[1:], len(cs_)]
dtm = np.full(nx * nz, np.nan, np.float32)
dtm[cs_[starts]] = es_[(starts + ends) // 2]
dtm = dtm.reshape(nz, nx)
miss = np.isnan(dtm)
idx = ndimage.distance_transform_edt(miss, return_distances=False, return_indices=True)
dtm = dtm[tuple(idx)]
print('ground grid', nx, 'x', nz, 'cells, filled', int(miss.sum()))
ground_at = lambda px, pz: dtm[np.clip(((pz - gz0) / G).astype(np.int32), 0, nz - 1), np.clip(((px - gx0) / G).astype(np.int32), 0, nx - 1)]

# ---- spatial buckets (10 m) for footprint queries ----
B = 10.0
bi = ((x - gx0) / B).astype(np.int32); bj = ((z - gz0) / B).astype(np.int32); bnx = int(bi.max()) + 1
bkey = bj.astype(np.int64) * bnx + bi
border = np.argsort(bkey, kind='stable'); bsorted = bkey[border]
def points_in_box(x0, z0, x1, z1):
    i0, i1 = int((x0 - gx0) // B), int((x1 - gx0) // B); j0, j1 = int((z0 - gz0) // B), int((z1 - gz0) // B)
    out = []
    for j in range(j0, j1 + 1):
        a = np.searchsorted(bsorted, j * bnx + max(i0, 0)); b = np.searchsorted(bsorted, j * bnx + i1, side='right')
        out.append(border[a:b])
    return np.concatenate(out) if out else np.empty(0, np.int64)

def pip(px, pz, ring):
    r = np.asarray(ring, np.float64); inside = np.zeros(len(px), bool)
    x1, z1 = r[:, 0], r[:, 1]; x2, z2 = np.roll(x1, 1), np.roll(z1, 1)
    for a, b, c_, d in zip(x1, z1, x2, z2):
        cross = (b > pz) != (d > pz)
        with np.errstate(divide='ignore', invalid='ignore'):
            xi = (c_ - a) * (pz - b) / (d - b) + a
        inside ^= cross & (px < xi)
    return inside

def measure(f):
    o = np.asarray(f['o'])
    ids = points_in_box(o[:, 0].min(), o[:, 1].min(), o[:, 0].max(), o[:, 1].max())
    if not len(ids): return None
    px, pz = x[ids], z[ids]
    m = pip(px, pz, f['o'])
    for h in f['h']: m &= ~pip(px, pz, h)
    ids = ids[m]
    first = ids[rn[ids] == 1]
    bld = first[c[first] == 6]
    if len(bld) < 6 or len(bld) < 0.5 * len(first): return None
    g = float(np.median(ground_at(x[ids], z[ids])))
    return float(np.median(e[bld])) - g, float(np.percentile(e[bld], 98)) - g, len(bld)

fp = json.load(open('data/footprints.json'))
res = {}; ck_h, ck_l = [], []
for f in fp:
    if not f['ok']: continue
    r = measure(f)
    if r is None: continue
    med, top, n = r
    whole = not f['part'] and f['mh'] == 0
    if whole and f['H'] is not None and f['sh'] == 0: ck_h.append((f['H'], med))
    if whole and f['H'] is None and f['L'] is not None and f['sh'] == 0: ck_l.append((f['L'] * 3.2 + 0.8, med))  # game's levels formula
    if f['H'] is None and f['L'] is None and med >= 2.0:
        res[f['k']] = round(med, 1)
ok = [f for f in fp if f['ok']]
untagged = [f for f in ok if f['H'] is None and f['L'] is None]
print('footprints in map', len(ok), 'untagged', len(untagged), 'measured', len(res))
def summary(pairs):
    a = np.array(pairs)
    if not len(a): return {'n': 0}
    err = a[:, 1] - a[:, 0]
    return dict(n=int(len(a)), median_error_m=round(float(np.median(err)), 2), mean_abs_error_m=round(float(np.mean(np.abs(err))), 2),
                within_2m_pct=round(float(np.mean(np.abs(err) <= 2) * 100), 1), within_3m_pct=round(float(np.mean(np.abs(err) <= 3) * 100), 1))
stats = {'vs_height_tag_flat': summary(ck_h), 'vs_levels_tag_flat_x3.2+0.8': summary(ck_l)}
print('check (lidar minus OSM):', stats)

# ---- trees ----
gr = json.load(open('data/ground.json'))
veg = (c >= 3) & (c <= 5)
trees = {}
for tx, tz, _ in gr.get('t', []):
    ids = points_in_box(tx - 4, tz - 4, tx + 4, tz + 4)
    ids = ids[veg[ids]]
    if not len(ids): continue
    d = np.hypot(x[ids] - tx, z[ids] - tz); ids, d = ids[d <= 4], d[d <= 4]
    if len(ids) < 3: continue
    g = float(ground_at(np.array([tx], np.float32), np.array([tz], np.float32))[0])
    h = float(np.percentile(e[ids], 95)) - g
    if h < 2 or h > 35: continue   # >35 m: no tree here is that tall; points of a tall building next to it
    up = e[ids] - g >= h / 2
    rad = float(np.percentile(d[up], 90)) if up.sum() >= 3 else 1.5
    trees[f'{tx},{tz}'] = [round(h, 1), round(max(1.0, rad), 1)]
print('trees', len(gr.get('t', [])), 'measured', len(trees))

json.dump({'meta': {'source': 'USGS 3DEP lidar, GA_Statewide_B5_2018 (s3://usgs-lidar-public, EPT), public domain',
                    'flight_year': 2018, 'method': 'see tools/lidar_heights.py'},
           'check': stats, 'b': res, 't': trees}, open('data/lidar_heights.json', 'w'), separators=(',', ':'))
