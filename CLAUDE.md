# CLAUDE.md — SMASH SCAD

## 프로젝트
SCAD 사바나 캠퍼스를 OSM 데이터로 3D화해서 부수는 비공식 팬게임. 원작은 https://smash-univ.app (한국 대학 337곳). 소유자는 club-paradiso(Luca). 바이브 코딩 위주이며, 구현→테스트→검증까지 한 흐름으로 끝낸다.

## 구조
- Vite 프로젝트. 루트는 `web/`, 빌드 결과는 `dist/`(정적 파일만, git 제외). three `0.187.0`, three-mesh-bvh `0.9.18`, vite `8.3.8`은 정확한 버전으로 고정
- `web/index.html`: HUD 마크업과 CSS. `<script type="module" src="./src/main.js">`
- `web/src/main.js`: 게임 전체(three.js 씬, 무기, 점수, 파티클, 사운드). ES 모듈. OrbitControls는 `three/addons/controls/OrbitControls.js`
- `web/geom.js`: 순수 지오메트리 ES 모듈 `building(THREE, rec)`(default export `SG`도 있음). 게임과 node 테스트 공용
- `web/public/scad-savannah.json`(v3): `{v:3, b:[건물], r:[도로 [w,flat]], p:[공원], w:[물], river, t:[나무 [x,z,침엽1,높이,수관반경]], tr:[가로수 줄], f:[보도], rl:[철도], pl:[부두 선], a:[[종류,면]], pn:[[x,z,이름,면적]]}`. a 종류: 0 주차장, 1 경기장, 2 수영장, 3 놀이터, 4 묘지, 5 부두 데크, 6 화단. 나무 높이 0 = 라이다 측정 없음. `tools/build_buildings.py`가 여기에 쓴다
- 라이다: `tools/lidar_fetch.py`(USGS 3DEP `GA_Statewide_B5_2018`, S3 EPT) → `tools/lidar_heights.py` → `data/lidar_heights.json`, `tools/lidar_roofs.py` → `data/lidar_roofs.json`(실측 형태, 둘 다 커밋됨). 공용 로더는 `tools/lidar_common.py`. 파이썬 의존성은 `tools/requirements.txt`. 방법과 검증은 README "라이다 높이"
- `tools/`: OSM 타일 다운로드 → 파싱 → 지면 레이어 → 건물 빌드
- `tools/perf/`: `measure.mjs`(성능 측정), `shots.mjs`(비교 캡처), `upload_ranges.mjs`, `lod_stats.mjs`. 결과와 방법은 `docs/perf.md`, 원자료는 `docs/perf-data/`
- `tests/*.test.js`: `npm test`(node: 지붕, 데이터 v3, BVH 피킹). `npm run e2e`(Playwright, `npm run preview`를 띄운 상태에서): `tests/e2e/smoke.mjs`(1280·390px)와 `tests/e2e/mobile.mjs`(iPhone 13 세로·가로, Pixel 7 에뮬레이션: 터치, 바텀시트, GPS 안·밖·거부, 컨텍스트 손실 복구, 해상도 자동 조절)
- 주소에 `?perf`를 붙이면 측정 훅 `window.__smash`가 켜진다(로드 시점 `PT`, 프레임 로그 `rec/FR`, `pick`, `fireAt`, `bench`, `dmg`, `alive`, `me`, `dpr`, `layer`, `loseContext/restoreContext`, `probe`). 없으면 게임 동작은 같다. 스모크 테스트도 이 훅으로 게임 상태를 읽는다

### 건물 레코드 `b[i]`
`[scad, name, outer(flat x,z), holes[[flat]], minH, wallTop, roofH, shape, obb[cx,cz,ang,hl,hw], wallCol, roofCol, est]`
- 좌표: 미터 단위 로컬 좌표, 원점은 위도 32.0745, 경도 -81.0945. x는 동쪽, z는 남쪽(z = -북쪽)
- shape: 0 flat, 1 gabled, 2 hipped, 3 pyramidal, 4 skillion, 5 dome
- obb의 u축(ang)은 용마루 방향. skillion은 +v가 내리막
- est: 0 OSM 높이·층수 태그, 1 태그도 라이다 측정도 없음(건물 유형별 추정값), 2 태그 없음 → 라이다 실측 높이(평지붕 레코드만), 3 형태 전체를 라이다로 실측(13번째 필드 `{v,t,r}`: 지붕 삼각망과 윤곽 링, `web/geom.js`의 `measured()`가 그림). SCAD 67개(정밀: 오차 0.75m)와 지붕이 평평하지 않은 그 밖의 건물 1,102개(거칠게: 오차 1.5m, 점 12개 이하, 맞지 않으면 상자 유지). 3은 OSM 지붕 태그보다 우선

## 렌더링 핵심
- 모든 건물을 non-indexed BufferGeometry 하나(`geo`)로 병합. 건물 k의 정점 범위는 `vStart[k]`, `vCount[k]`. 삼각형→건물 매핑은 `faceB`
- 정점은 400m 타일 순서로 놓인다(타일 안은 OSM 순서, 건물 번호 k는 OSM 순서 그대로). 타일 54개가 각각 Mesh이고 `geo`의 속성 버퍼를 공유하며 drawRange와 바운딩 구만 다르다(절두체 컬링). `city` 메시는 그리지 않고 피킹에만 쓴다
- 붕괴는 `aL` 정점 속성(y 스케일, x/z 기울기)을 `onBeforeCompile`로 셰이더에 주입. 피해 색은 vertex color
- `aL`·color는 `rangeTracker()`가 바뀐 건물 범위만 `addUpdateRange`로 올린다(가까운 범위 병합, 96개 초과나 50% 이상이면 전체 업로드). 속성을 직접 고칠 때는 `setL()`/`paintB()`를 거쳐야 업로드된다
- 탭 판정은 three-mesh-bvh(`MeshBVH`, `indirect:true`, `acceleratedRaycast`). 지오메트리가 non-indexed 그대로라 faceIndex→`faceB`가 유지된다. BVH는 무너지기 전 위치 기준(이전 레이캐스트와 같음)
- r147 화면을 유지하려고 `ColorManagement.enabled=false`, `outputColorSpace=LinearSRGBColorSpace`, 조명 세기 ×π(r155에서 레거시 조명 제거). 이 셋을 바꾸면 색과 밝기가 달라진다
- `logarithmicDepthBuffer` 사용(지면 레이어의 z-fighting 방지)
- 해 그림자: 방향광 그림자 맵(데스크톱 2048, 휴대폰 1024)이 카메라 목표를 따라다닌다(`updateSun`). 지면 색은 그대로 두고 `ShadowMaterial` 평면(y=0.32)이 어둡게만 한다. 붕괴 셰이더를 넣은 `customDepthMaterial`로 무너지는 건물 그림자도 줄어든다. 휴대폰(터치·짧은 변 700px 미만)은 기본 끔, 픽셀 비율 1에서도 프레임 평균 34ms를 넘으면 자동으로 끔. `?shadows=0/1`로 강제
- 지면 레이어(물, 공원, 도로, 면, 보도, 철도, 부두, 가로수 줄)는 정점 색 지오메트리 하나를 건물과 같은 400m 타일로 나눠 컬링한다. 레이어 순서는 y 오프셋(0.04~0.3)
- SCAD 건물 색: 벽은 다른 건물과 같은 중립 석재·스투코 범위(실제 외벽 색 데이터 없음), 지붕만 노란색으로 표적 표시
- 나무는 InstancedMesh 3개(활엽 수관, 침엽 원뿔, 줄기). 폭발(페인트 제외)에 쓰러지고 복구 버튼으로 선다
- 파티클은 InstancedMesh 2개(debris 700, puffs 360)
- 지도 이름표: SCAD 건물 이름(노란 태그, 부서지면 취소선), 이름 있는 광장·공원 44개(`pn`, OSM `leisure=park/garden`의 name), Savannah River. HTML 태그를 2프레임마다 배치하고, 겹치거나 HUD(상단 바, 구역 칩, 무기 도크, 열린 목록) 위에 오는 것은 숨긴다(`placeLabels`). 최대 28개, 휴대폰 14개

## 모바일
- 해상도 자동 조절: 픽셀 비율 min(기기,2)에서 시작, 프레임 평균 24ms 초과면 0.25씩 내리고(최저 1) 13ms 미만이 이어지면 올린다(`adaptResolution`). 픽셀 비율 2 이상이면 MSAA 끔
- WebGL 컨텍스트 손실: three가 복구, 2.5초 안에 복구 안 되면 새로고침 토스트. 페이지가 숨겨지면 오디오 정지
- 휴대폰 세로: 건물 목록은 바텀시트(끌어내려 닫기), 가로(높이 500px 이하): 무기 도크가 오른쪽 세로. 인트로는 스크롤되고 시작 버튼은 하단 고정
- GPS: `watchPosition`. 위치는 기기 밖으로 보내지 않는다. 지도 범위(위도 32.044~32.086, 경도 -81.112~-81.082) 안이면 표시·이동, 밖이면 거리 안내. 보안 컨텍스트(https, localhost)에서만

## 원칙
- 데이터 날조 금지. 태그 없는 건물에 지붕 모양을 추측해서 넣지 않는다. 추정값은 `est`로 구분
- SCAD 로고·마스코트·브랜드 그래픽 사용 금지. "비공식, 무관" 고지 유지
- OSM 출처 표기(ODbL) 유지
- 실행하지 않은 테스트, 측정하지 않은 성능은 주장하지 않는다. 구현됨 / 검증됨 / 미검증 / 막힘을 구분해 보고
- 데이터를 다시 만들 때는 `npm test`로 지붕 면적 일치(±3%)와 SCAD 71개 유지를 확인. 건물 수가 바뀌면 테스트 기대값을 근거와 함께 갱신

## 검증 상태 (v0.4.0, 2026-11-21)
- 검증됨: `npm test` 15/15(지붕·데이터·BVH 피킹). `npm run build` 성공. 헤드리스 Chromium 157(SwiftShader)에서 `npm run e2e` 통과: 1280px·390px 스모크, iPhone 13 세로·가로와 Pixel 7 에뮬레이션(시작·고지 스크롤, 무기, 바텀시트, GPS 지도 안·밖·권한 거부, WebGL 컨텍스트 손실 후 같은 화면으로 복구, 해상도 자동 조절 2→1), 콘솔 에러 없음
- 검증됨: OSM 파이프라인 재실행 결과가 v0.3.0 데이터와 바이트 단위로 동일(주변 레이어 추가 전 기준). 라이다 높이는 층수 태그 건물 187개 대비 중앙 오차 +0.43m, 74%가 ±3m 이내
- 측정됨(SwiftShader 기준, `docs/perf.md`): 주변 요소 추가로 기본 시점 삼각형 47,783 → 58,457, FPS 12.0 → 8.7(1280×800), 26.9 → 19.9(390×844). 실기기 성능이 아니다
- 미검증: 실제 iPhone Safari(WebKit은 이 환경에 없음)·Android·GPU 데스크톱의 FPS, 터치 감, 진동, 실제 GPS 정확도, 실기기 컨텍스트 손실, 사운드
- 막힘: 항공사진(USGS 영상, NAIP)과 OSM 외 지도 서비스는 이 환경 네트워크에서 막혀 있어 시도하지 않았다. 라이다(AWS S3)와 OSM API는 `smash-scad` 환경에서 열려 있다

## 다음 작업 후보 (우선순위 순)
1. 실기기 측정: iPhone Safari·Android Chrome에서 `?perf` 훅으로 FPS·로드 시간·해상도 자동 조절 결과를 재서 `docs/perf.md`에 추가. 나무·지면 비용(SwiftShader에서 FPS −25%)이 실기기에서도 문제면 나무를 타일별로 나누거나 먼 거리에서 숨기기
2. 라이다 이상치 점검: 높이 태그와 크게 다른 건물(예: 20m 태그인데 라이다 3.8m)을 목록으로 뽑아 2018년 이후 신축인지 확인, OSM 편집 후보로 정리(직접 편집은 사용자만)
3. 항공사진 바닥 텍스처: NAIP(공개 데이터)를 받을 수 있는 호스트가 열리면 지면에 입히기. 라이선스가 불분명한 상용 지도 타일은 쓰지 않는다
4. 공유 랭킹: 원작처럼 일간·전체 점수(Supabase 등), 1인당 기여 상한, 학교 코드와 점수만 전송
5. 캠퍼스 확장: SCAD Atlanta, Lacoste. `tools/`의 bbox와 SCAD 판정 규칙, 라이다 데이터셋 이름을 캠퍼스 설정 파일로 분리
6. 지형: Savannah는 평지라 생략. 확장 캠퍼스에는 라이다 지면 격자를 그대로 지형으로 쓸 수 있음
7. 한국어 UI 토글
8. 번들 크기: JS 한 파일 약 850KB(gzip 약 220KB). three 트리 셰이킹 확인

## 배포
- 라이브 사이트는 GitHub Pages(소유자 결정, 2026-11-21). `.github/workflows/pages.yml`이 `main`에 push될 때 `npm ci` → `npm test` → `npm run build` 후 `dist/`를 Pages에 올린다. 수동 실행(workflow_dispatch)도 된다
- 한 번만 하는 설정: 리포 Settings → Pages → Source를 "GitHub Actions"로. 리포가 비공개면 Pages는 유료 요금제(Pro/Team/Enterprise)에서만 된다. Pages 사이트는 리포가 비공개여도 공개다(Enterprise 제외)
- 빌드는 `base: './'`라 `/smash-scad/` 같은 하위 경로에서 그대로 동작한다(스모크·모바일 테스트를 하위 경로로 확인). GPS는 https가 필요한데 Pages는 https다

## 하지 않는 것
- Vercel 배포 금지(소유자 결정). Vercel 프로젝트 생성·연결·배포 설정 파일(vercel.json 등)을 만들지 않는다. GitHub Pages 외 다른 호스팅에 배포하는 것도 소유자 지시가 있을 때만
