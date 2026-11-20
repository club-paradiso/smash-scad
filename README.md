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

## 데이터 다시 만들기

```bash
npm run data
```

| 단계 | 스크립트 | 결과물 |
|---|---|---|
| OSM 타일 49개 다운로드 (API 0.6) | `tools/fetch_osm_tiles.sh` | `data/tiles/*.osm` (약 40MB, git 제외) |
| 노드·웨이·릴레이 병합 | `tools/parse_osm.py` | `data/raw.json` (git 제외) |
| 도로·공원·연못·사바나강 | `tools/build_ground.py` | `data/ground.json` (git 제외) |
| 건물 + 3D 태그 | `tools/build_buildings.py` | `web/public/scad-savannah.json` |

범위는 위도 32.044~32.086, 경도 -81.112~-81.082이다. SCAD 건물에서 320m 이내 건물만 남긴다.

## 3D 모델 규칙 (OSM Simple 3D Buildings)

- 높이: `height` → `building:levels` × 3.2m → 없으면 건물 유형별 추정값 (`est=1`로 표시)
- 지붕: `roof:shape` 중 flat, gabled, hipped, pyramidal, skillion, dome. gambrel과 saltbox는 gabled로, mansard는 hipped로 단순화. `roof:height`, `roof:levels`, `roof:orientation`, `roof:direction` 반영
- `building:part`와 `min_height`, `building:min_level` 반영. 부속 건물이 본체 면적의 70% 이상을 덮으면 본체 윤곽은 숨김
- 멀티폴리곤 중정(inner ring)은 구멍으로 처리
- `building:colour`, `roof:colour` 반영 (SCAD 건물은 게임용 노란색 유지)

지붕 면은 "평면들의 최솟값"으로 정의하고, 각 평면이 최소인 영역으로 윤곽을 잘라 삼각분할한다. 벽은 평면이 바뀌는 지점에 점을 끼워 넣어 박공 끝이 지붕선까지 올라간다. 자세한 내용은 `web/geom.js`에 있다.

## 현재 데이터 현황 (2026-11-20 OSM 기준)

- 건물 4,497개, 이 중 SCAD 71개
- 지붕 모양이 매핑된 건물 278개, 높이·층수가 매핑된 건물 489개
- SCAD 71개 중 지붕 모양이 있는 건물 2개(Eichberg Hall, Arnold Hall), 높이를 추정한 건물 37개

SCAD 판정 기준: 이름이나 operator에 SCAD 또는 Savannah College of Art가 들어간 건물, `building=college`인 건물, 이름으로 확인된 기숙사(The Hive 동, Sail, Sand, Oglethorpe House, Montgomery House, Turner House).

## 라이선스와 출처

지도 데이터 © OpenStreetMap contributors, [ODbL](https://opendatacommons.org/licenses/odbl/). `web/public/scad-savannah.json`은 OSM 파생 데이터베이스이므로 ODbL을 따른다.
