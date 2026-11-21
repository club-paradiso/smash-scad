"""Build SMASH SCAD map data with OSM Simple 3D Buildings tags.

Output record per building:
 [scad, name, outer(flat xz), holes([flat]), minH, wallTop, roofH, shape, obb[cx,cz,ang,hl,hw], wallCol, roofCol, est]
shape: 0 flat, 1 gabled, 2 hipped, 3 pyramidal, 4 skillion, 5 dome
obb axes: u along ang (ridge direction for gabled/hipped), v across. skillion: slope down toward +v.
est: 0 = height from OSM height/levels tag, 1 = no tag and no lidar measurement (height estimated by building type),
     2 = no tag, height measured from USGS 3DEP lidar (data/lidar_heights.json, see tools/lidar_heights.py),
     3 = whole shape (roof surface + wall heights) measured from lidar (all SCAD buildings the lidar confirms, and other
         buildings whose roof is not flat): the record then has
         a 13th field {v, t, r} (data/lidar_roofs.json, tools/lidar_roofs.py) and web/geom.js draws that instead.
"""
import json, math, os, re, zlib

d = json.load(open('data/raw.json')); N = d['nodes']; W = d['ways']; R = d['rels']
lat0, lon0 = 32.0745, -81.0945
kx = math.cos(math.radians(lat0)) * 111320; kz = 110574
def P(q): return (round((q[1] - lon0) * kx, 2), round(-(q[0] - lat0) * kz, 2))

def num(v):
    if v is None: return None
    m = re.match(r'\s*([0-9]+(?:\.[0-9]+)?)', str(v).replace(',', '.'))
    if not m: return None
    x = float(m.group(1))
    if re.search(r"(ft|')", str(v)): x *= 0.3048
    return x

def ring_from_way(wid):
    refs = W[wid][0]
    if len(refs) < 4 or refs[0] != refs[-1] or not all(r in N for r in refs): return None
    return refs

def assemble(wids):
    """Join open ways into closed rings by shared endpoints."""
    segs = [list(W[w][0]) for w in wids if w in W and all(r in N for r in W[w][0])]
    if len(segs) != len([w for w in wids]): return []
    rings = []
    while segs:
        cur = segs.pop(0)
        while cur[0] != cur[-1]:
            for i, s in enumerate(segs):
                if s[0] == cur[-1]: cur += s[1:]; segs.pop(i); break
                if s[-1] == cur[-1]: cur += s[::-1][1:]; segs.pop(i); break
            else:
                return []
        rings.append(cur)
    return rings

def clean(pts):
    if pts[0] == pts[-1]: pts = pts[:-1]
    out = []
    for q in pts:
        if not out or abs(q[0] - out[-1][0]) + abs(q[1] - out[-1][1]) > 0.3: out.append(q)
    if len(out) > 2 and abs(out[0][0] - out[-1][0]) + abs(out[0][1] - out[-1][1]) <= 0.3: out.pop()
    return out

def area(p):
    return 0.5 * sum(p[i][0] * p[(i + 1) % len(p)][1] - p[(i + 1) % len(p)][0] * p[i][1] for i in range(len(p)))

def inside(pt, poly):
    x, y = pt; c = False
    for i in range(len(poly)):
        x1, y1 = poly[i]; x2, y2 = poly[i - 1]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1: c = not c
    return c

def hull(pts):
    pts = sorted(set(pts))
    if len(pts) < 3: return pts
    def cr(o, a, b): return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, up = [], []
    for p in pts:
        while len(lo) >= 2 and cr(lo[-2], lo[-1], p) <= 0: lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(up) >= 2 and cr(up[-2], up[-1], p) <= 0: up.pop()
        up.append(p)
    return lo[:-1] + up[:-1]

def obb(pts):
    h = hull(pts); best = None
    for i in range(len(h)):
        a, b = h[i], h[(i + 1) % len(h)]
        ang = math.atan2(b[1] - a[1], b[0] - a[0]); c, s = math.cos(ang), math.sin(ang)
        us = [p[0] * c + p[1] * s for p in h]; vs = [-p[0] * s + p[1] * c for p in h]
        ar = (max(us) - min(us)) * (max(vs) - min(vs))
        if best is None or ar < best[0]: best = (ar, ang, us, vs)
    _, ang, us, vs = best
    cu, cv = (max(us) + min(us)) / 2, (max(vs) + min(vs)) / 2
    hl, hw = (max(us) - min(us)) / 2, (max(vs) - min(vs)) / 2
    c, s = math.cos(ang), math.sin(ang)
    cx, cz = cu * c - cv * s, cu * s + cv * c
    if hw > hl: ang += math.pi / 2; hl, hw = hw, hl
    return [cx, cz, ang, hl, hw]

SHAPES = {'flat': 0, 'gabled': 1, 'saltbox': 1, 'gambrel': 1, 'hipped': 2, 'half-hipped': 2, 'mansard': 2,
          'quadruple_saltbox': 2, 'side_hipped': 2, 'pyramidal': 3, 'cone': 3, 'skillion': 4, 'lean_to': 4,
          'dome': 5, 'round': 5, 'onion': 5}

def is_scad(t):
    s = (t.get('name', '') + ' ' + t.get('operator', '')).lower()
    if 'scad' in s or 'savannah college of art' in s or 'savanna college of art' in s: return True
    if t.get('building') in ('college', 'university'): return True
    if re.search(r'at The Hive|^Sail$|^Sand$|Oglethorpe House|Mongomery House|Turner House', t.get('name', '')): return True
    return False

def est_wall(t, key):
    h = zlib.crc32(str(key).encode()) % 5
    b = t.get('building')
    if b in ('garage', 'shed', 'kiosk', 'carport'): return 3.5
    if b in ('house', 'detached', 'residential', 'terrace', 'semidetached_house'): return 8 + h
    if b in ('church', 'cathedral'): return 18 + h
    if b == 'college': return 12 + h
    return 7 + h * 1.5

# ---- collect footprints (ways + multipolygons) ----
items = []  # (key, tags, outer_pts, holes, is_part)
for wid, (refs, t) in W.items():
    if ('building' in t and t.get('building') != 'roof') or 'building:part' in t:
        r = ring_from_way(wid)
        if r: items.append((wid, t, [P(N[x]) for x in r], [], 'building:part' in t and 'building' not in t))
for rid, (mem, t) in R.items():
    if 'building' in t or 'building:part' in t:
        outer = assemble([m[1] for m in mem if m[0] == 'way' and m[2] == 'outer'])
        inner = assemble([m[1] for m in mem if m[0] == 'way' and m[2] == 'inner'])
        for o in outer:
            op = [P(N[x]) for x in o]
            holes = [[P(N[x]) for x in h] for h in inner if inside(P(N[h[0]]), op)]
            items.append(('r' + rid, t, op, holes, 'building:part' in t and 'building' not in t))
# ways that are only multipolygon outers keep their own tags (usually none) - drop duplicates
mp_ways = {m[1] for rid, (mem, t) in R.items() if 'building' in t for m in mem}
items = [it for it in items if it[0] not in mp_ways or 'building' in it[1]]

# ---- parent/part relation ----
foot = []
for key, t, op, holes, part in items:
    o = clean(op)
    if len(o) < 3 or abs(area(o)) < 6: continue
    if area(o) < 0: o = o[::-1]
    hs = []
    for h in holes:
        h = clean(h)
        if len(h) >= 3:
            if area(h) > 0: h = h[::-1]
            hs.append(h)
    c = (sum(p[0] for p in o) / len(o), sum(p[1] for p in o) / len(o))
    foot.append(dict(key=key, t=t, o=o, h=hs, part=part, c=c, a=abs(area(o)) - sum(abs(area(h)) for h in hs)))
parts = [f for f in foot if f['part']]
parent_of = {}
for p in parts:
    for f in foot:
        if not f['part'] and inside(p['c'], f['o']):
            parent_of[p['key']] = f; f.setdefault('parts', []).append(p); break
hidden = set()
for f in foot:
    if f.get('parts') and sum(p['a'] for p in f['parts']) >= 0.7 * f['a']: hidden.add(f['key'])

# ---- SCAD + context filter ----
for f in foot:
    par = parent_of.get(f['key'])
    f['scad'] = is_scad(f['t']) or (par is not None and is_scad(par['t']))
    f['name'] = (f['t'].get('name') or (par['t'].get('name') if par else '') or '').split(';')[0]
sc = [f['c'] for f in foot if f['scad']]
def near(c, r=320): return any((c[0] - s[0]) ** 2 + (c[1] - s[1]) ** 2 < r * r for s in sc)

LIDAR = json.load(open('data/lidar_heights.json'))['b'] if os.path.exists('data/lidar_heights.json') else {}
ROOFS = json.load(open('data/lidar_roofs.json'))['b'] if os.path.exists('data/lidar_roofs.json') else {}
RENAME = {'Eckburg Hall': 'Eichberg Hall', 'Mongomery House': 'Montgomery House', 'Museum of Art': 'SCAD Museum of Art',
          'Lucas Theatre': 'Lucas Theatre for the Arts'}
out = []; stats = dict(tagged_h=0, roofshape=0, parts=0, holes=0, hidden=len(hidden))
for f in foot:
    if f['key'] in hidden or not (f['scad'] or near(f['c'])): continue
    t = f['t']; par = parent_of.get(f['key'])
    H = num(t.get('height')); L = num(t.get('building:levels'))
    minH = num(t.get('min_height'))
    if minH is None and t.get('building:min_level'): minH = num(t['building:min_level']) * 3.2
    minH = minH or 0
    shape_s = t.get('roof:shape') or (par['t'].get('roof:shape') if par and f['key'] in hidden else None)
    shape = SHAPES.get(shape_s, 0)
    ob = obb(f['o'])
    if t.get('roof:orientation') == 'across' and shape in (1, 2):
        ob = [ob[0], ob[1], ob[2] + math.pi / 2, ob[4], ob[3]]  # ridge along short axis
    if shape == 4:  # skillion: v axis points downhill
        dr = t.get('roof:direction')
        deg = num(dr) if dr and num(dr) is not None else {'N': 0, 'NE': 45, 'E': 90, 'SE': 135, 'S': 180, 'SW': 225, 'W': 270, 'NW': 315}.get(str(dr).upper(), None)
        if deg is not None:
            dx, dz = math.sin(math.radians(deg)), -math.cos(math.radians(deg))
            ang = math.atan2(dz, dx) - math.pi / 2  # so that +v == (dx,dz)
            c, s = math.cos(ang), math.sin(ang)
            us = [(p[0] - ob[0]) * c + (p[1] - ob[1]) * s for p in f['o']]
            vs = [-(p[0] - ob[0]) * s + (p[1] - ob[1]) * c for p in f['o']]
            cu, cv = (max(us) + min(us)) / 2, (max(vs) + min(vs)) / 2
            ob = [ob[0] + cu * c - cv * s, ob[1] + cu * s + cv * c, ang, (max(us) - min(us)) / 2, (max(vs) - min(vs)) / 2]
    roofH = num(t.get('roof:height'))
    if roofH is None and shape and (num(t.get('roof:levels')) or 0) > 0: roofH = num(t['roof:levels']) * 3.0
    if roofH is not None and roofH < 0.3: roofH = None
    if roofH is None: roofH = 0 if shape == 0 else min(7.0, max(1.5, ob[4] * (1.0 if shape == 5 else 0.55)))
    if shape == 0: roofH = 0
    est = 0
    if H is not None:
        if roofH > 0.6 * (H - minH): roofH = 0.4 * (H - minH)
        wallTop = max(minH + 2, H - roofH)
    elif L is not None:
        wallTop = max(minH + 2, L * 3.2 + 0.8)
    elif f['key'] in LIDAR and shape == 0:
        # measured roof surface (median of lidar roof returns) above surrounding ground; flat roof stays flat
        wallTop = max(minH + 2, LIDAR[f['key']]); est = 2
    else:
        wallTop = max(minH + 2, est_wall(t, f['key'])); est = 1
    stats['tagged_h'] += 0 if est else 1; stats['roofshape'] += 1 if shape else 0
    stats['parts'] += 1 if f['part'] else 0; stats['holes'] += 1 if f['h'] else 0
    def col(v):
        if not v: return ''
        return v.strip() if re.match(r'^#?[0-9a-fA-F]{6}$|^[a-z]+$', v.strip()) else ''
    nm = f['name'] if f['scad'] else ''
    nm = nm.replace('SCAD - ', '').replace('SCAD ', '').replace(', Savannah College of Art and Design', '')
    nm = RENAME.get(nm, nm)
    r1 = lambda xs: [round(v, 1) for p in xs for v in p]
    out.append([1 if f['scad'] else 0, nm, r1(f['o']), [r1(h) for h in f['h']], round(minH, 1), round(wallTop, 1),
                round(roofH, 1), shape, [round(ob[0], 1), round(ob[1], 1), round(ob[2], 4), round(ob[3], 2), round(ob[4], 2)],
                col(t.get('building:colour')), col(t.get('roof:colour')), est])
    lr = ROOFS.get(f['key'])
    if lr and minH == 0 and not f['part']:
        hs = lr['v'][2::3]
        out[-1][5] = round(max(hs), 1); out[-1][6] = 0; out[-1][7] = 0; out[-1][11] = 3
        out[-1].append({'v': lr['v'], 't': lr['t'], 'r': lr['r']})

# footprints for tools/lidar_heights.py (key, outer, holes, tagged height, min height, roof shape, part)
json.dump([dict(k=f['key'], o=f['o'], h=f['h'], H=num(f['t'].get('height')), L=num(f['t'].get('building:levels')),
                mh=num(f['t'].get('min_height')) or 0, sh=SHAPES.get(f['t'].get('roof:shape'), 0), part=f['part'],
                lc=f['t'].get('layer'), scad=f['scad'], ok=f['key'] not in hidden and (f['scad'] or near(f['c'])))
           for f in foot], open('data/footprints.json', 'w'))
old = json.load(open('data/ground.json'))
# trees: [x, z, leaf(1 needle), height m, crown radius m]; height/radius 0 = lidar found no canopy there
LT = json.load(open('data/lidar_heights.json'))['t'] if os.path.exists('data/lidar_heights.json') else {}
trees = [t + LT.get(f'{t[0]},{t[1]}', [0, 0]) for t in old['t']]
D = {'v': 3, 'b': out, 't': trees, **{k: old[k] for k in ('r', 'p', 'w', 'river', 'tr', 'f', 'rl', 'pl', 'a', 'pn')}}
json.dump(D, open('web/public/scad-savannah.json', 'w'), separators=(',', ':'))
print('buildings', len(out), 'scad', sum(o[0] for o in out), stats)
import collections
print(collections.Counter(o[7] for o in out), 'scad shapes', collections.Counter(o[7] for o in out if o[0]),
      'scad est', sum(o[11] == 1 for o in out if o[0]), 'scad lidar', sum(o[11] == 2 for o in out if o[0]), 'scad lidar 3D', sum(o[11] == 3 for o in out if o[0]), 'all lidar 3D', sum(o[11] == 3 for o in out),
      'all est', sum(o[11] == 1 for o in out), 'all lidar', sum(o[11] == 2 for o in out))
