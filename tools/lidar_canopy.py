"""Individual tree crowns from USGS 3DEP lidar (GA_Statewide_B5_2018, public domain), coloured from the 2023 NAIP
aerial photo.  Output: data/lidar_canopy.json  {meta, c: [[x, z, top m, base m, radius m, r, g, b], ...]}

Method (every number is measured; crowns the lidar cannot resolve are not invented):
1. Canopy height model: vegetation points (classes 3-5) on a 1 m grid, 95th percentile elevation minus the lidar
   ground (lidar_common), smoothed with a 1.5 m Gaussian.
2. Tree tops: local maxima of at least 4 m, with a search window that grows with height (r = 2 + 0.12 h m,
   capped at 7 m), so a big live oak is one tree and a row of small ones stays several.
3. Crown footprint: canopy cells (>= 2.5 m) go to the nearest top within 12 m. Radius = sqrt(area / pi).
4. Crown base: 10th percentile of the vegetation points in that footprint, minus ground (at least 1.5 m).
5. Colour: median NAIP RGB over the inner half of the crown.
6. Dropped: crowns centred on a building footprint, and crowns whose 2023 photo colour is not green (excess-green
   index 2G-R-B < 15): misclassified points, or trees gone since the 2018 flight.
Only crowns on tiles that have buildings (the map area that has aerial photos) are kept.
Run: python3 tools/lidar_canopy.py   (needs the lidar from tools/lidar_fetch.py and data/naip/aerial_1m.png)
"""
import json, math
import numpy as np
from scipy import ndimage
from PIL import Image
from lidar_common import *   # x, z, e, c, rn, ground_at, gx0, gz0

veg = (c >= 3) & (c <= 5)
vx, vz, ve = x[veg], z[veg], e[veg]
G = 1.0
cx0, cz0 = float(vx.min()), float(vz.min())
nx, nz = int((vx.max() - cx0) / G) + 1, int((vz.max() - cz0) / G) + 1
ci = ((vx - cx0) / G).astype(np.int32); cj = ((vz - cz0) / G).astype(np.int32)
cell = cj.astype(np.int64) * nx + ci
order = np.lexsort((ve, cell)); cs, es = cell[order], ve[order]
st = np.r_[0, np.flatnonzero(np.diff(cs)) + 1]; en = np.r_[st[1:], len(cs)]
chm = np.zeros(nx * nz, np.float32)
cellx = (cs[st] % nx) * G + cx0 + G / 2; cellz = (cs[st] // nx) * G + cz0 + G / 2
chm[cs[st]] = es[st + ((en - st - 1) * 0.95).astype(int)] - ground_at(cellx.astype(np.float32), cellz.astype(np.float32))
chm = np.clip(chm.reshape(nz, nx), 0, 45)
chm = ndimage.gaussian_filter(chm, 1.5)
print('chm grid', nx, 'x', nz, 'canopy cells >=2.5 m', int((chm >= 2.5).sum()))

# keep the building tiles only (same 400 m grid as the game)
aer = json.load(open('web/public/aerial/index.json'))
keep_tiles = {(ix, iz) for ix, iz in aer['tiles']}
X = cx0 + (np.arange(nx) + .5) * G; Z = cz0 + (np.arange(nz) + .5) * G
TX = np.floor((X + 4000) / 400).astype(int); TZ = np.floor((Z + 4000) / 400).astype(int)
in_map = np.zeros((nz, nx), bool)
for (ix, iz) in keep_tiles: in_map |= np.outer(TZ == iz, TX == ix)

# tree tops with a height-dependent window: test a few window sizes and pick per pixel
peaks = np.zeros_like(chm, bool)
for r in (2, 3, 4, 5, 6, 7):
    fp = np.hypot(*np.mgrid[-r:r + 1, -r:r + 1]) <= r
    mx = ndimage.maximum_filter(chm, footprint=fp)
    want = np.clip(np.round(2 + 0.12 * chm), 2, 7) == r
    peaks |= want & (chm == mx) & (chm >= 4)
peaks &= in_map
pj, pi = np.nonzero(peaks)
print('tree tops', len(pi))

# crown footprints: nearest top within 12 m among canopy cells
canopy = (chm >= 2.5) & in_map
markers = np.zeros(chm.shape, bool); markers[pj, pi] = True
dist, (nj, ni) = ndimage.distance_transform_edt(~markers, return_indices=True)
own = canopy & (dist <= 12 / G)
lab = np.full(chm.shape, -1, np.int64); id_of = np.full(chm.shape, -1, np.int64); id_of[pj, pi] = np.arange(len(pi))
lab[own] = id_of[nj[own], ni[own]]
area = np.bincount(lab[own], minlength=len(pi)) * G * G

# crown base from the vegetation points' low end in each footprint
pcell_j = ((vz - cz0) / G).astype(np.int64); pcell_i = ((vx - cx0) / G).astype(np.int64)
plab = lab[np.clip(pcell_j, 0, nz - 1), np.clip(pcell_i, 0, nx - 1)]
okp = plab >= 0
pg = ground_at(vx[okp], vz[okp]); ph = ve[okp] - pg; pl = plab[okp]
o2 = np.lexsort((ph, pl)); pl2, ph2 = pl[o2], ph[o2]
s2 = np.r_[0, np.flatnonzero(np.diff(pl2)) + 1]; e2 = np.r_[s2[1:], len(pl2)]
base = np.full(len(pi), np.nan); base[pl2[s2]] = ph2[s2 + ((e2 - s2 - 1) * 0.10).astype(int)]

# colour from the NAIP mosaic
M = json.load(open('data/naip/aerial_1m.json')); img = np.asarray(Image.open('data/naip/aerial_1m.png').convert('RGB'))
# building footprints (a "crown" centred on a roof is the roof, or a branch over it: the building is drawn already)
bmask = np.zeros(chm.shape, bool)
for f in json.load(open('data/footprints.json')):
    if not f['ok']: continue
    o = np.asarray(f['o']); i0, i1 = int((o[:, 0].min() - cx0) / G), int((o[:, 0].max() - cx0) / G) + 1
    j0, j1 = int((o[:, 1].min() - cz0) / G), int((o[:, 1].max() - cz0) / G) + 1
    if i1 < 0 or j1 < 0 or i0 >= nx or j0 >= nz: continue
    i0, j0 = max(i0, 0), max(j0, 0); i1, j1 = min(i1, nx), min(j1, nz)
    gx_, gz_ = np.meshgrid(X[i0:i1], Z[j0:j1])
    bmask[j0:j1, i0:i1] |= pip(gx_.ravel().astype(np.float32), gz_.ravel().astype(np.float32), f['o']).reshape(gx_.shape)
out, dropped = [], {'small': 0, 'on_building': 0, 'not_green': 0}
for k in range(len(pi)):
    h = float(chm[pj[k], pi[k]]); rad = math.sqrt(area[k] / math.pi)
    if rad < 1.2 or not np.isfinite(base[k]): dropped['small'] += 1; continue
    if bmask[pj[k], pi[k]]: dropped['on_building'] += 1; continue
    b = float(min(max(1.5, base[k]), h * 0.7))
    tx, tz = float(X[pi[k]]), float(Z[pj[k]])
    u, v = int(round(tx - M['x0'])), int(round(tz - M['z0'])); rr = max(1, int(rad / 2))
    patch = img[max(0, v - rr):v + rr + 1, max(0, u - rr):u + rr + 1].reshape(-1, 3)
    col = np.median(patch, 0) if len(patch) else np.array([80, 100, 60])
    if 2 * col[1] - col[0] - col[2] < 15: dropped['not_green'] += 1; continue   # excess-green index: not vegetation in 2023
    out.append([round(tx, 1), round(tz, 1), round(h, 1), round(b, 1), round(rad, 1), *[int(q) for q in col]])
print('dropped', dropped, 'crowns kept', len(out), 'median top', np.median([o[2] for o in out]), 'median radius', np.median([o[4] for o in out]))
json.dump({'meta': {'source': 'USGS 3DEP lidar GA_Statewide_B5_2018 (public domain); colour: USDA NAIP 2023 (public domain)',
                    'method': 'see tools/lidar_canopy.py'}, 'c': out}, open('data/lidar_canopy.json', 'w'), separators=(',', ':'))
