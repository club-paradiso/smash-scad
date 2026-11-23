"""Aerial imagery for the map from USDA NAIP (public domain), 2023-10-17 Georgia flight, 0.6 m, via the
Microsoft Planetary Computer STAC API.  Output: data/naip/aerial_1m.png (git-ignored), a mosaic resampled to the
game's local metres (1 px = 1 m; x east, z south; same origin and scale as tools/build_buildings.py).
Run: python3 tools/naip_fetch.py   (needs rasterio, numpy, pillow)"""
import json, math, os, urllib.request
import numpy as np, rasterio
from rasterio.warp import reproject, Resampling
from rasterio.transform import from_origin
from PIL import Image

LAT0, LON0 = 32.0745, -81.0945
KX = math.cos(math.radians(LAT0)) * 111320; KZ = 110574
LAT_MIN, LAT_MAX, LON_MIN, LON_MAX = 32.044, 32.086, -81.112, -81.082   # tools/fetch_osm_tiles.sh box
ITEMS = ['ga_m_3208164_nw_17_060_20231017_20240103', 'ga_m_3208164_sw_17_060_20231017_20240103']
API = 'https://planetarycomputer.microsoft.com/api'
get = lambda u: json.loads(urllib.request.urlopen(u, timeout=60).read())

os.environ.setdefault('CURL_CA_BUNDLE', '/root/.ccr/ca-bundle.crt' if os.path.exists('/root/.ccr/ca-bundle.crt') else '')
token = get(f'{API}/sas/v1/token/naip')['token']
# destination grid: plain lon/lat (EPSG:4326) with pixel size 1/KX deg x 1/KZ deg, i.e. 1 m in local units
W = int(round((LON_MAX - LON_MIN) * KX)); H = int(round((LAT_MAX - LAT_MIN) * KZ))
dst_t = from_origin(LON_MIN, LAT_MAX, 1 / KX, 1 / KZ)
mosaic = np.zeros((3, H, W), np.uint8)
for item in ITEMS:
    href = get(f'{API}/stac/v1/collections/naip/items/{item}')['assets']['image']['href'] + '?' + token
    with rasterio.open('/vsicurl/' + href) as src:
        tmp = np.zeros((3, H, W), np.uint8)
        for b in range(3):
            reproject(rasterio.band(src, b + 1), tmp[b], dst_transform=dst_t, dst_crs='EPSG:4326', resampling=Resampling.bilinear, dst_nodata=0)
        fill = (mosaic.sum(0) == 0) & (tmp.sum(0) > 0)
        mosaic[:, fill] = tmp[:, fill]
        print(item, 'filled', int(fill.sum()), 'px')
x0 = (LON_MIN - LON0) * KX; z0 = -(LAT_MAX - LAT0) * KZ
Image.fromarray(mosaic.transpose(1, 2, 0)).save('data/naip/aerial_1m.png')
json.dump({'x0': x0, 'z0': z0, 'm_per_px': 1.0, 'w': W, 'h': H, 'items': ITEMS,
           'source': 'USDA NAIP 2023 (public domain) via Microsoft Planetary Computer'}, open('data/naip/aerial_1m.json', 'w'))
print('mosaic', W, 'x', H, 'origin', round(x0, 1), round(z0, 1), 'empty px', int((mosaic.sum(0) == 0).sum()))
