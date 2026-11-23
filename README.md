# SMASH SCAD

SCAD 사바나 캠퍼스를 OpenStreetMap 실제 건물 데이터로 3D화해서 부수는 웹 게임. [SMASH 대학교](https://smash-univ.app)에서 영감을 받은 비공식 팬게임이며, Savannah College of Art and Design과 무관하고 로고를 쓰지 않는다.

An unofficial fan game: wreck a 3D model of SCAD's Savannah campus built from OpenStreetMap. Not affiliated with or endorsed by SCAD.

## 실행

```bash
npm install
npm run dev          # 개발 서버 http://localhost:8765
npm test             # 지오메트리·데이터 테스트 (node)
npm run build        # dist/ 에 정적 파일 생성
npm run preview      # dist/ 를 http://localhost:8765 로 확인
npm run e2e          # preview 를 띄운 상태에서 브라우저 스모크 테스트 (Playwright)
npm run perf         # preview 를 띄운 상태에서 성능 측정 (docs/perf.md 참고)
```

Vite 프로젝트다. 루트는 `web/`이고 three.js는 npm 패키지(정확한 버전 고정)로 번들한다. `npm run build` 결과는 `dist/`의 정적 파일(`index.html`, `assets/*.js`, `scad-savannah.json`)뿐이고 서버 코드는 없다.

| 파일 | 내용 |
|---|---|
| `web/index.html` | HUD 마크업과 CSS |
| `web/src/main.js` | 게임 전체(three.js 씬, 무기, 점수, 파티클, 사운드) |
| `web/geom.js` | 순수 지오메트리 ES 모듈. 게임과 node 테스트가 같이 쓴다 |
| `web/public/scad-savannah.json` | 건물·도로·공원·물 데이터 |

주소 뒤에 `?perf`를 붙이면 측정용 훅(`window.__smash`)이 켜진다. 붙이지 않으면 게임 동작은 같다.

## 배포 (GitHub Pages)

`main`에 push되면 GitHub Actions(`.github/workflows/pages.yml`)가 테스트와 빌드를 거쳐 `dist/`를 GitHub Pages에 올린다. 처음 한 번은 리포 Settings → Pages → Source를 "GitHub Actions"로 바꿔야 한다. 비공개 리포는 유료 요금제에서만 Pages를 쓸 수 있다.

## 데이터 다시 만들기

```bash
npm run data                               # OSM 다시 받기 + 지면 + 건물
pip install -r tools/requirements.txt      # 라이다 단계에만 필요 (numpy, scipy, laspy, triangle)
npm run data:lidar                         # 라이다 받기(약 360MB) + 높이 측정 + 건물 다시 빌드
```

| 단계 | 스크립트 | 결과물 |
|---|---|---|
| OSM 타일 49개 다운로드 (API 0.6) | `tools/fetch_osm_tiles.sh` | `data/tiles/*.osm` (약 40MB, git 제외) |
| 노드(태그 포함)·웨이·릴레이 병합 | `tools/parse_osm.py` | `data/raw.json` (git 제외) |
| 도로·공원·물·강 + 주변 요소(나무, 보도, 철도, 부두, 가로수 줄, 주차장·경기장·수영장·놀이터·묘지·화단) | `tools/build_ground.py` | `data/ground.json` (git 제외) |
| 건물 + 3D 태그 (+ 라이다 높이가 있으면 반영) | `tools/build_buildings.py` | `web/public/scad-savannah.json`, `data/footprints.json` (git 제외) |
| USGS 3DEP 라이다 다운로드 | `tools/lidar_fetch.py` | `data/lidar/*.laz` (약 360MB, git 제외) |
| 라이다로 건물·나무 높이 측정 | `tools/lidar_heights.py` | `data/lidar_heights.json` (커밋됨, 66KB) |
| 라이다로 SCAD 건물 형태 측정 | `tools/lidar_roofs.py` | `data/lidar_roofs.json` (커밋됨, 약 730KB) |

`data/lidar_heights.json`이 커밋돼 있으므로 라이다를 다시 받지 않아도 `npm run data`만으로 같은 결과가 나온다.

범위는 위도 32.044~32.086, 경도 -81.112~-81.082이다. SCAD 건물에서 320m 이내 건물만 남긴다.

## 3D 모델 규칙 (OSM Simple 3D Buildings)

- 높이: `height` → `building:levels` × 3.2m → 라이다 실측(`est=2`, 지붕 태그가 없는 평지붕 건물만) → 그래도 없으면 건물 유형별 추정값 (`est=1`)
- 지붕: `roof:shape` 중 flat, gabled, hipped, pyramidal, skillion, dome. gambrel과 saltbox는 gabled로, mansard는 hipped로 단순화. `roof:height`, `roof:levels`, `roof:orientation`, `roof:direction` 반영
- `building:part`와 `min_height`, `building:min_level` 반영. 부속 건물이 본체 면적의 70% 이상을 덮으면 본체 윤곽은 숨김
- 멀티폴리곤 중정(inner ring)은 구멍으로 처리
- `building:colour`, `roof:colour` 반영 (SCAD 건물은 게임용 노란색 유지)

지붕 면은 "평면들의 최솟값"으로 정의하고, 각 평면이 최소인 영역으로 윤곽을 잘라 삼각분할한다. 벽은 평면이 바뀌는 지점에 점을 끼워 넣어 박공 끝이 지붕선까지 올라간다. 자세한 내용은 `web/geom.js`에 있다.

## 라이다 높이 (USGS 3DEP)

- 출처: USGS 3DEP 라이다 `GA_Statewide_B5_2018`(2018년 비행, 미국 정부 공개 데이터). AWS의 Entwine Point Tile 사본(`s3://usgs-lidar-public`)에서 지도 범위에 닿는 노드만 받는다(점 약 4,800만 개)
- 지면: 지면 분류(2) 점의 2m 격자 중앙값. 건물 아래처럼 빈 칸은 가장 가까운 지면 값으로 채운다
- 건물: OSM 윤곽 안(중정 제외)의 건물 분류(6) 점 고도 중앙값 − 그 아래 지면. 중앙값이라 경사 지붕도 부피가 비슷한 평지붕 높이가 된다. 윤곽 안 첫 반사 중 건물 점이 50% 미만이거나 6개 미만이면 재지 않는다(나무에 가림, 2018년 이후 신축 등)
- 나무: OSM 나무 노드 4m 안 식생 분류(3~5) 점의 95백분위 고도 − 지면, 수관 반경은 윗부분 점의 90백분위 거리. 2~35m 범위만 쓴다
- 검증: 층수 태그가 있는 평지붕 건물 187개와 비교하면(층수×3.2+0.8m), 라이다 − OSM 중앙 오차 +0.43m, 평균 절대 오차 2.61m, 74%가 ±3m 이내. 높이 태그 건물은 재지는 조건에 맞는 게 5개뿐이라 판단 근거로 쓰지 않는다
- 한계: 2018년 이후 생기거나 바뀐 건물은 틀릴 수 있다

### SCAD 건물 실측 형태 (`tools/lidar_roofs.py`)

SCAD 건물 71개 중 67개, 그리고 지붕이 평평하지 않은 그 밖의 건물 1,102개는 상자 대신 라이다로 잰 형태 그대로 그린다(`est=3`). 지붕 모양을 추측하는 게 아니라 측정한 표면이다.

1. 윤곽 안 건물 분류 점을 1m 격자로 모아 셀마다 75백분위 고도, 빈 셀은 가장 가까운 값, 3×3 중앙값 필터 두 번(안테나·옥상 설비 같은 잡음 제거), 지면을 빼서 높이로
2. OSM 윤곽(2.5m 간격)을 경계로 고정한 제약 Delaunay 삼각망에 격자점을 오차가 큰 순서로 넣어, 모든 격자점이 0.75m 안에 들 때까지 단순화. 평평한 지붕은 삼각형 몇 개, 탑·경사는 촘촘하게
3. 벽은 OSM 윤곽을 따라 올리고, 윗선 높이는 윤곽에서 1m 안쪽에서 잰다(벽·처마·지면 반사가 섞이는 가장자리를 피함)
4. 건물 점이 첫 반사의 50% 미만이거나 30개 미만이면 만들지 않고 상자를 유지
5. SCAD가 아닌 건물은 무게를 줄이려고 거칠게 맞춘다: 윤곽은 OSM 꼭짓점만, 오차 1.5m, 추가 점 12개 이하. 지붕이 1m 안에서 평평하면(격자점 95%) 상자 + 라이다 높이를 그대로 쓰고(1,618개), 12점으로 2m 안에 맞지 않으면 넓은 지붕이 한 점으로 끌려 올라간 텐트 모양이 생기므로 역시 상자를 쓴다(1,073개)

결과: SCAD 67개 + 그 밖의 1,102개, 지붕 삼각형 56,846개(SCAD 32,034). 벽 색은 측정값이 아니다(모든 건물 같은 중립색). SCAD는 노란 지붕과 이름표로 구분한다.

## 현재 데이터 현황 (2026-11-21 OSM 기준)

- 건물 4,497개, 이 중 SCAD 71개
- 지붕 모양이 매핑된 건물 278개, 높이·층수가 매핑된 건물 489개
- 태그 없는 건물 4,008개 중 3,408개는 라이다 실측 높이, 600개는 추정값
- SCAD 71개 중 지붕 모양이 있는 건물 2개(Eichberg Hall, Arnold Hall). 높이 태그 없는 SCAD 37개 중 34개는 라이다 실측, 3개는 추정값
- 나무 420그루(OSM), 이 중 400그루는 라이다로 높이·수관 반경 측정. 보도 2,530개, 철도 75개, 부두 32개, 가로수 줄 29개, 면 326개(주차장 216, 수영장 59, 놀이터 16, 경기장 12, 화단 10, 묘지 9, 부두 데크 4)

SCAD 판정 기준: 이름이나 operator에 SCAD 또는 Savannah College of Art가 들어간 건물, `building=college`인 건물, 이름으로 확인된 기숙사(The Hive 동, Sail, Sand, Oglethorpe House, Montgomery House, Turner House).

## 라이선스와 출처

지도 데이터 © OpenStreetMap contributors, [ODbL](https://opendatacommons.org/licenses/odbl/). `web/public/scad-savannah.json`은 OSM 파생 데이터베이스이므로 ODbL을 따른다.

높이 측정에 쓴 라이다는 USGS 3D Elevation Program(3DEP) 데이터로 미국 정부 공개 자료(public domain)다. 게임 화면에도 출처를 표기한다.

## 항공사진 (USDA NAIP)

- 출처: USDA NAIP 2023-10-17 조지아 촬영(0.6m, 미국 정부 공개 데이터), Microsoft Planetary Computer에서 받는다(`tools/naip_fetch.py`). 게임 좌표(1px = 1m)로 다시 맞췄고 OSM 윤곽과 1~2m 안에서 맞는다
- `tools/naip_tiles.py`가 건물이 있는 400m 타일 56장으로 자른다(`web/public/aerial/`, 겹침 60m, JPEG 3.0MB)
- 게임: 땅에 사진을 깔고, 같은 사진을 지붕에 위에서 투영한다. 실제 지붕 색과 옥상 설비가 보인다. 키 큰 건물은 정사영 보정이 지면 기준이라 지붕 사진이 몇 m 밀려 있을 수 있다. 벽면은 사진에 없어 중립색 그대로다
- 나무는 아래 "라이다 수관"으로 3D가 된다

## 라이다 수관 (`tools/lidar_canopy.py`)

1. 식생 점(분류 3~5)을 1m 격자로, 95백분위 고도 − 지면 = 수관 높이 지도, 1.5m 가우시안
2. 나무 꼭대기: 4m 이상인 국소 최고점, 찾는 창은 높이에 따라 2~7m(큰 참나무는 한 그루, 작은 가로수 줄은 여러 그루로)
3. 수관 넓이: 2.5m 이상 캐노피 칸을 12m 안에서 가장 가까운 꼭대기에 배정, 반경 = √(넓이/π)
4. 수관 아래 높이: 그 영역 식생 점의 10백분위 − 지면
5. 색: 2023 항공사진의 수관 안쪽 중앙값
6. 뺀 것: 중심이 건물 윤곽 안인 것(2,295), 2023 사진에서 초록이 아닌 것(초과녹색 2G−R−B < 15, 1,892. 잘못 분류된 점이거나 2018 이후 사라진 나무)

결과 15,810그루(높이 중앙값 10.9m, 반경 중앙값 6.3m). OSM 나무 중 수관 안에 있는 207그루는 같은 나무라 빼고 213그루만 따로 그린다.

## 내 위치(GPS)

과녁 버튼을 누르면 브라우저 위치 권한을 요청한다. 위치는 기기 안에서 지도 표시에만 쓰고 어디로도 보내지 않는다. 지도 범위 안이면 파란 표시와 정확도 원을 그리고 그쪽으로 카메라가 이동한다. 범위 밖이면 거리만 알려 준다. https 페이지(또는 localhost)에서만 동작한다.
