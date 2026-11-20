import glob, xml.etree.ElementTree as ET, json, re
nodes={}; ways={}; rels={}
for f in glob.glob('data/tiles/*.osm'):
    r=ET.parse(f).getroot()
    for n in r.iter('node'): nodes[n.get('id')]=(float(n.get('lat')),float(n.get('lon')))
    for w in r.iter('way'):
        ways[w.get('id')]=([nd.get('ref') for nd in w.iter('nd')],{t.get('k'):t.get('v') for t in w.iter('tag')})
    for rl in r.iter('relation'):
        rels[rl.get('id')]=([(m.get('type'),m.get('ref'),m.get('role')) for m in rl.iter('member')],{t.get('k'):t.get('v') for t in rl.iter('tag')})
json.dump({'nodes':nodes,'ways':ways,'rels':rels},open('data/raw.json','w'))
print('nodes',len(nodes),'ways',len(ways),'rels',len(rels))
