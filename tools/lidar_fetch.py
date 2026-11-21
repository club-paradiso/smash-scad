"""Download USGS 3DEP lidar (GA_Statewide_B5_2018, public domain) for the map area from the
Entwine Point Tile copy on AWS (s3://usgs-lidar-public) -> data/lidar/*.laz (git-ignored).
Only nodes whose XY box touches the area are fetched. Run: python3 tools/lidar_fetch.py [--plan]"""
import json, math, os, sys, urllib.request, concurrent.futures as cf
BASE = 'https://usgs-lidar-public.s3.amazonaws.com/GA_Statewide_B5_2018/'
LAT0, LAT1, LON0, LON1 = 32.044, 32.086, -81.112, -81.082   # same box as fetch_osm_tiles.sh
def merc(lon, lat): return lon * 20037508.342789244 / 180, math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * 6378137
X0, Y0 = merc(LON0, LAT0); X1, Y1 = merc(LON1, LAT1)
get = lambda u: urllib.request.urlopen(u, timeout=120).read()
ept = json.loads(get(BASE + 'ept.json')); B = ept['bounds']
def box(key):
    d, x, y, z = map(int, key.split('-')); s = (B[3] - B[0]) / 2 ** d
    return B[0] + x * s, B[1] + y * s, B[0] + (x + 1) * s, B[1] + (y + 1) * s
def hits(key):
    a, b, c, e = box(key); return a < X1 and c > X0 and b < Y1 and e > Y0
want = {}
def walk(hkey):
    h = json.loads(get(f'{BASE}ept-hierarchy/{hkey}.json'))
    for k, n in h.items():
        if not hits(k): continue
        if n == -1 and k != hkey: walk(k)
        elif n > 0: want[k] = n
walk('0-0-0-0')
print('nodes', len(want), 'points', sum(want.values()), 'max depth', max(int(k.split('-')[0]) for k in want))
if '--plan' in sys.argv: sys.exit()
os.makedirs('data/lidar', exist_ok=True)
def dl(k):
    p = f'data/lidar/{k}.laz'
    if not os.path.exists(p): open(p, 'wb').write(get(f'{BASE}ept-data/{k}.laz'))
    return os.path.getsize(p)
with cf.ThreadPoolExecutor(6) as ex: total = sum(ex.map(dl, want))
json.dump({'source': BASE, 'nodes': want}, open('data/lidar/index.json', 'w'))
print('downloaded', round(total / 1e6, 1), 'MB')
