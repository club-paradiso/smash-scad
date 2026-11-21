"""Roads, parks, ponds and the Savannah River for the ground layer -> data/ground.json.
Buildings are only used here to decide which ground features are near SCAD."""
import json, math, re
d=json.load(open('data/raw.json')); N=d['nodes']; W=d['ways']; R=d['rels']; NT=d.get('ntags',{})
def is_scad(t):
    s=(t.get('name','')+' '+t.get('operator','')).lower()
    if 'scad' in s or 'savannah college of art' in s or 'savanna college of art' in s: return True
    if t.get('building') in ('college','university'): return True
    return False
EXTRA_DORM_NAMES=re.compile(r'at The Hive|^Sail$|^Sand$|Oglethorpe House|Mongomery House|Turner House')
blds=[]
def ring(refs):
    pts=[N[r] for r in refs if r in N]
    return pts if len(pts)>=4 and len(pts)==len(refs) else None
for i,(refs,t) in W.items():
    if 'building' not in t or t.get('building') in ('roof',): continue
    p=ring(refs)
    if p: blds.append((i,t,p))
for i,(mem,t) in R.items():
    if 'building' in t:
        for ty,ref,role in mem:
            if ty=='way' and role=='outer' and ref in W:
                p=ring(W[ref][0])
                if p: blds.append(('r'+i,t,p))
scadset=[b for b in blds if is_scad(b[1]) or EXTRA_DORM_NAMES.search(b[1].get('name',''))
         or (b[1].get('building')=='dormitory' and b[1].get('operator','').startswith('Savannah'))]
# dormitory 847381891 near Victory: unnamed, no operator -> include since inside Victory Village area? keep out (unverified)
ids={b[0] for b in scadset}
lat0=sum(sum(q[0] for q in b[2])/len(b[2]) for b in scadset)/len(scadset)
lon0=sum(sum(q[1] for q in b[2])/len(b[2]) for b in scadset)/len(scadset)
# center at Poetter Hall-ish downtown instead
lat0,lon0=32.0745,-81.0945
kx=math.cos(math.radians(lat0))*111320; kz=110574
def P(q): return (round((q[1]-lon0)*kx,1), round(-(q[0]-lat0)*kz,1))
sc=[ [sum(P(q)[0] for q in b[2])/len(b[2]), sum(P(q)[1] for q in b[2])/len(b[2])] for b in scadset]
def near(c,r=320):
    return any((c[0]-s[0])**2+(c[1]-s[1])**2<r*r for s in sc)
def height(t,i):
    for k in ('height','building:height'):
        v=t.get(k)
        if v:
            try: return max(3,float(re.sub('[^0-9.]','',v)))
            except: pass
    lv=t.get('building:levels')
    if lv:
        try: return max(1,float(lv))*3.6+1
        except: pass
    h=hash(str(i))%5
    b=t.get('building')
    if b in ('garage','shed','roof','kiosk'): return 3.5
    if b in ('house','detached','residential','terrace','semidetached_house'): return 8+h
    if b in ('church','cathedral'): return 18+h
    if b in ('college',): return 12+h
    return 7+h*1.5
out=[]
for i,t,p in blds:
    pts=[P(q) for q in p]
    if pts[0]==pts[-1]: pts=pts[:-1]
    clean=[]
    for q in pts:
        if not clean or abs(q[0]-clean[-1][0])+abs(q[1]-clean[-1][1])>0.4: clean.append(q)
    if len(clean)<3: continue
    c=[sum(q[0] for q in clean)/len(clean), sum(q[1] for q in clean)/len(clean)]
    s=i in ids
    if not s and not near(c): continue
    area=0.5*abs(sum(clean[k][0]*clean[(k+1)%len(clean)][1]-clean[(k+1)%len(clean)][0]*clean[k][1] for k in range(len(clean))))
    if area<6: continue
    nm=t.get('name','').split(';')[0]
    nm=nm.replace('SCAD - ','').replace('SCAD ','').replace(', Savannah College of Art and Design','')
    nm={'Eckburg Hall':'Eichberg Hall','Mongomery House':'Montgomery House','Museum of Art':'SCAD Museum of Art','Lucas Theatre':'Lucas Theatre for the Arts'}.get(nm,nm)
    out.append([1 if s else 0, round(height(t,i),1), nm if (s and nm) else '', [v for q in clean for v in q]])
# roads
roads=[]
keep={'primary','secondary','tertiary','residential','unclassified','trunk','primary_link','secondary_link','service','living_street','motorway','motorway_link'}
for i,(refs,t) in W.items():
    if t.get('highway') in keep and t.get('service') not in ('parking_aisle','driveway'):
        pts=[P(N[r]) for r in refs if r in N]
        if len(pts)>=2 and any(near(list(q),400) for q in pts[::max(1,len(pts)//3)]):
            w={'primary':1,'trunk':1,'secondary':1,'tertiary':1,'motorway':2,'motorway_link':1}.get(t['highway'],0)
            roads.append([w,[v for q in pts for v in q]])
parks=[]
for i,(refs,t) in W.items():
    if t.get('leisure') in ('park','garden') or t.get('landuse') in ('grass',):
        p=ring(refs)
        if p:
            pts=[P(q) for q in p][:-1]
            c=[sum(q[0] for q in pts)/len(pts), sum(q[1] for q in pts)/len(pts)]
            if near(c,500) and len(pts)>=3: parks.append([v for q in pts for v in q])
water=[]
for i,(refs,t) in W.items():
    if t.get('natural')=='water' or t.get('waterway')=='riverbank':
        p=ring(refs)
        if p: water.append([v for q in [P(q) for q in p][:-1] for v in q])
for i,(mem,t) in R.items():
    if t.get('natural')=='water' or t.get('water')=='river':
        print('water rel',i,t.get('name'))

print('buildings',len(out),'scad',sum(o[0] for o in out),'named',sum(1 for o in out if o[2]),'roads',len(roads),'parks',len(parks),'water',len(water))
xs=[o[3][0] for o in out]; zs=[o[3][1] for o in out]; print(min(xs),max(xs),min(zs),max(zs))
bank=[P(N[x]) for x in W['39876771'][0] if N[x][1]>=-81.104]
isl=[P(N[x]) for x in W['39876940'][0]]
river=[v for q in bank+isl for v in q]
# ---- surroundings (v3). Everything below is drawn only where OSM maps it; nothing is placed by guess.
def line_near(pts,r=400): return any(near(list(q),r) for q in pts[::max(1,len(pts)//4)])
def flat(pts): return [v for q in pts for v in q]
# single trees: [x, z, leaf] leaf 1 = needleleaved, 0 = broadleaved or not tagged
trees=[]
for i,t in NT.items():
    if t.get('natural')=='tree' and i in N:
        q=P(N[i])
        if near(list(q),500): trees.append([q[0],q[1],1 if t.get('leaf_type')=='needleleaved' else 0])
# tree rows stay lines (OSM does not say where each tree stands)
rows=[]; paths=[]; rail=[]; piers=[]
for i,(refs,t) in W.items():
    pts=[P(N[r]) for r in refs if r in N]
    if len(pts)<2 or len(pts)!=len(refs): continue
    if t.get('natural')=='tree_row' and line_near(pts,500): rows.append(flat(pts))
    elif t.get('highway') in ('footway','path','pedestrian','cycleway','steps') and t.get('area')!='yes' and line_near(pts): paths.append(flat(pts))
    elif t.get('railway')=='rail' and line_near(pts,600): rail.append(flat(pts))
    elif t.get('man_made')=='pier' and refs[0]!=refs[-1] and line_near(pts,600): piers.append(flat(pts))
# areas: [kind, flat ring]. kind: 0 parking, 1 pitch, 2 swimming pool, 3 playground, 4 cemetery, 5 pier deck, 6 flowerbed
areas=[]
def area_kind(t):
    if t.get('amenity')=='parking' and t.get('parking') not in ('underground','multi-storey'): return 0
    if t.get('leisure')=='pitch': return 1
    if t.get('leisure')=='swimming_pool' and t.get('location') not in ('indoor','roof'): return 2
    if t.get('leisure')=='playground': return 3
    if t.get('landuse')=='cemetery' or t.get('amenity')=='grave_yard': return 4
    if t.get('man_made')=='pier': return 5
    if t.get('landuse')=='flowerbed': return 6
    return -1
for i,(refs,t) in W.items():
    k=area_kind(t)
    if k<0 or refs[0]!=refs[-1]: continue
    p=ring(refs)
    if not p: continue
    pts=[P(q) for q in p][:-1]
    c=[sum(q[0] for q in pts)/len(pts), sum(q[1] for q in pts)/len(pts)]
    if len(pts)>=3 and near(c,500): areas.append([k,flat(pts)])
# named parks and squares (Savannah's squares are leisure=park): [x, z, name, area m2] at the ring centroid
names=[]
def ring_area(pts): return abs(sum(pts[k][0]*pts[(k+1)%len(pts)][1]-pts[(k+1)%len(pts)][0]*pts[k][1] for k in range(len(pts))))/2
for i,(refs,t) in W.items():
    if t.get('name') and t.get('leisure') in ('park','garden') and refs[0]==refs[-1]:
        p=ring(refs)
        if not p: continue
        pts=[P(q) for q in p][:-1]
        c=[sum(q[0] for q in pts)/len(pts), sum(q[1] for q in pts)/len(pts)]
        if len(pts)>=3 and near(c,500): names.append([round(c[0],1),round(c[1],1),t['name'],round(ring_area(pts))])
print('named parks',len(names))
print('trees',len(trees),'tree rows',len(rows),'paths',len(paths),'rail',len(rail),'pier lines',len(piers),'areas',len(areas),
      {k:sum(1 for a in areas if a[0]==k) for k in range(7)})
json.dump({'r':roads,'p':parks,'w':water,'river':river,'t':trees,'tr':rows,'f':paths,'rl':rail,'pl':piers,'a':areas,'pn':names},open('data/ground.json','w'),separators=(',',':'))
print('river pts',len(river)//2, bank[0],bank[-1],isl[0],isl[-1])
