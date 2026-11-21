"""Shared lidar loading for tools/lidar_heights.py and tools/lidar_roofs.py: reads data/lidar/*.laz, crops to the
map box, converts to the game's local metres, builds the 2 m ground grid and 10 m point buckets.
Importing this module does the work once (about 30 s and 1-2 GB of RAM for ~48M points)."""
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
