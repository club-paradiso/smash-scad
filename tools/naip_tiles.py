"""Cut data/naip/aerial_1m.png into the game's 400 m tiles (same grid as the building/ground tiles in
web/src/main.js: ix = floor((x+4000)/400), iz = floor((z+4000)/400)), each with PAD m of overlap so roofs of
buildings that cross a tile edge still find their pixels.  Output: web/public/aerial/t_<ix>_<iz>.jpg and
web/public/aerial/index.json.  Imagery: USDA NAIP 2023, public domain.
Run: python3 tools/naip_tiles.py"""
import json, math, os
from PIL import Image
TILE, OFF, PAD, PX = 400, 4000, 60, 1.0          # m, m, m, m per pixel
M = json.load(open('data/naip/aerial_1m.json')); im = Image.open('data/naip/aerial_1m.png').convert('RGB')
os.makedirs('web/public/aerial', exist_ok=True)
for f in os.listdir('web/public/aerial'): os.remove(os.path.join('web/public/aerial', f))
x0, z0, W, H = M['x0'], M['z0'], M['w'], M['h']
# only tiles that hold buildings (the game's 54 building tiles)
D = json.load(open('web/public/scad-savannah.json')); used = set()
def mark(flat):
    for i in range(0, len(flat) - 1, 2): used.add((math.floor((flat[i] + OFF) / TILE), math.floor((flat[i + 1] + OFF) / TILE)))
for b in D['b']: mark(b[2])   # tiles with buildings; elsewhere the vector ground layers stay
tiles = []
for iz in range(math.floor((z0 + OFF) / TILE), math.floor((z0 + H + OFF) / TILE) + 1):
    for ix in range(math.floor((x0 + OFF) / TILE), math.floor((x0 + W + OFF) / TILE) + 1):
        tx0, tz0 = ix * TILE - OFF - PAD, iz * TILE - OFF - PAD; size = TILE + 2 * PAD
        box = (round(tx0 - x0), round(tz0 - z0), round(tx0 - x0 + size), round(tz0 - z0 + size))
        if (ix, iz) not in used or box[2] <= 0 or box[3] <= 0 or box[0] >= W or box[1] >= H: continue
        crop = im.crop(box)  # outside the mosaic PIL fills black; those parts are off the map anyway
        crop.save(f'web/public/aerial/t_{ix}_{iz}.jpg', quality=72, optimize=True, progressive=True)
        tiles.append([ix, iz])
json.dump({'tile': TILE, 'off': OFF, 'pad': PAD, 'px': int(TILE + 2 * PAD), 'tiles': tiles,
           'credit': 'Imagery: USDA NAIP 2023 (public domain)'}, open('web/public/aerial/index.json', 'w'))
total = sum(os.path.getsize(os.path.join('web/public/aerial', f)) for f in os.listdir('web/public/aerial'))
print('tiles', len(tiles), 'total', round(total / 1e6, 2), 'MB')
