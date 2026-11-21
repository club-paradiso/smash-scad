#!/usr/bin/env bash
# Download OSM map tiles (API 0.6) covering SCAD Savannah into data/tiles/.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/tiles
python3 - <<'PY' > data/tiles/list.txt
lat0,lat1,lon0,lon1=32.044,32.086,-81.112,-81.082
dl,dn=0.006,0.005
la=lat0
while la<lat1:
  lo=lon0
  while lo<lon1:
    print(f"{lo:.4f},{la:.4f},{min(lo+dn,lon1):.4f},{min(la+dl,lat1):.4f}"); lo+=dn
  la+=dl
PY
xargs -P 2 -I{} sh -c 'curl -sS -m 100 -o "data/tiles/$(echo {} | tr , _).osm" "https://api.openstreetmap.org/api/0.6/map?bbox={}"' < data/tiles/list.txt
echo "tiles: $(ls data/tiles/*.osm | wc -l)"
