# CLAUDE.md — SMASH SCAD

## 프로젝트
SCAD 사바나 캠퍼스를 OSM 데이터로 3D화해서 부수는 비공식 팬게임. 원작은 https://smash-univ.app (한국 대학 337곳). 소유자는 club-paradiso(Luca). 바이브 코딩 위주이며, 구현→테스트→검증까지 한 흐름으로 끝낸다.

## 구조
- Vite 프로젝트. 루트는 `web/`, 빌드 결과는 `dist/`(정적 파일만, git 제외). three `0.187.0`, three-mesh-bvh `0.9.18`, vite `8.3.8`은 정확한 버전으로 고정
- `web/index.html`: HUD 마크업과 CSS. `<script type="module" src="./src/main.js">`
- `web/src/main.js`: 게임 전체(three.js 씬, 무기, 점수, 파티클, 사운드). ES 모듈. OrbitControls는 `three/addons/controls/OrbitControls.js`
- `web/geom.js`: 순수 지오메트리 ES 모듈 `building(THREE, rec)`(default export `SG`도 있음). 게임과 node 테스트 공용
- `web/public/scad-savannah.json`: `{v:2, b:[건물], r:[도로], p:[공원], w:[연못], river:[강 폴리곤]}`. `tools/build_buildings.py`가 여기에 쓴다
- `tools/`: OSM 타일 다운로드 → 파싱 → 지면 레이어 → 건물 빌드
- `tools/perf/`: `measure.mjs`(성능 측정), `shots.mjs`(비교 캡처), `upload_ranges.mjs`, `lod_stats.mjs`. 결과와 방법은 `docs/perf.md`, 원자료는 `docs/perf-data/`
- `tests/*.test.js`: `npm test`(node). `tests/e2e/smoke.mjs`: `npm run e2e`(Playwright, `npm run preview`를 띄운 상태에서)
- 주소에 `?perf`를 붙이면 측정 훅 `window.__smash`가 켜진다(로드 시점 `PT`, 프레임 로그 `rec/FR`, `pick`, `fireAt`, `bench`, `dmg`, `alive`). 없으면 게임 동작은 같다. 스모크 테스트도 이 훅으로 게임 상태를 읽는다

### 건물 레코드 `b[i]`
`[scad, name, outer(flat x,z), holes[[flat]], minH, wallTop, roofH, shape, obb[cx,cz,ang,hl,hw], wallCol, roofCol, est]`
- 좌표: 미터 단위 로컬 좌표, 원점은 위도 32.0745, 경도 -81.0945. x는 동쪽, z는 남쪽(z = -북쪽)
- shape: 0 flat, 1 gabled, 2 hipped, 3 pyramidal, 4 skillion, 5 dome
- obb의 u축(ang)은 용마루 방향. skillion은 +v가 내리막
- est=1: 높이·층수 태그 없음(추정값)

## 렌더링 핵심
- 모든 건물을 non-indexed BufferGeometry 하나(`geo`)로 병합. 건물 k의 정점 범위는 `vStart[k]`, `vCount[k]`. 삼각형→건물 매핑은 `faceB`
- 정점은 400m 타일 순서로 놓인다(타일 안은 OSM 순서, 건물 번호 k는 OSM 순서 그대로). 타일 54개가 각각 Mesh이고 `geo`의 속성 버퍼를 공유하며 drawRange와 바운딩 구만 다르다(절두체 컬링). `city` 메시는 그리지 않고 피킹에만 쓴다
- 붕괴는 `aL` 정점 속성(y 스케일, x/z 기울기)을 `onBeforeCompile`로 셰이더에 주입. 피해 색은 vertex color
- `aL`·color는 `rangeTracker()`가 바뀐 건물 범위만 `addUpdateRange`로 올린다(가까운 범위 병합, 96개 초과나 50% 이상이면 전체 업로드). 속성을 직접 고칠 때는 `setL()`/`paintB()`를 거쳐야 업로드된다
- 탭 판정은 three-mesh-bvh(`MeshBVH`, `indirect:true`, `acceleratedRaycast`). 지오메트리가 non-indexed 그대로라 faceIndex→`faceB`가 유지된다. BVH는 무너지기 전 위치 기준(이전 레이캐스트와 같음)
- r147 화면을 유지하려고 `ColorManagement.enabled=false`, `outputColorSpace=LinearSRGBColorSpace`, 조명 세기 ×π(r155에서 레거시 조명 제거). 이 셋을 바꾸면 색과 밝기가 달라진다
- `logarithmicDepthBuffer` 사용(지면 레이어의 z-fighting 방지)
- 파티클은 InstancedMesh 2개(debris 700, puffs 360)

## 원칙
- 데이터 날조 금지. 태그 없는 건물에 지붕 모양을 추측해서 넣지 않는다. 추정값은 `est`로 구분
- SCAD 로고·마스코트·브랜드 그래픽 사용 금지. "비공식, 무관" 고지 유지
- OSM 출처 표기(ODbL) 유지
- 실행하지 않은 테스트, 측정하지 않은 성능은 주장하지 않는다. 구현됨 / 검증됨 / 미검증 / 막힘을 구분해 보고
- 데이터를 다시 만들 때는 `npm test`로 지붕 면적 일치(±3%)와 SCAD 71개 유지를 확인. 건물 수가 바뀌면 테스트 기대값을 근거와 함께 갱신

## 검증 상태 (v0.3.0, 2026-11-20)
- 검증됨: `npm test` 10/10 통과(지붕·데이터 8개 + BVH 피킹이 기존 레이캐스트와 같은 삼각형을 돌려주는지 2개). `npm run build` 성공. 헤드리스 Chromium 157(SwiftShader)에서 `npm run e2e` 통과: 1280px·390px 로드, 무기 6종 모두 피해, 점수·랭크, 건물 목록·검색, 복구 버튼, 비공식 고지·OSM 표기, 콘솔 에러 없음
- 검증됨: r147 원본과 최종 빌드의 렌더가 HUD를 숨기면 1280px에서 픽셀 동일, 390px에서 1px(1/255) 차이. 피해·페인트 상태도 동일. InstancedMesh 색은 눈으로 비교해 같음
- 측정됨(SwiftShader 기준, `docs/perf.md`): 탭 레이캐스트 5.0 → 0.1ms 미만, 기본 시점 삼각형 134,513 → 47,783, 핵 기준 프레임당 업로드 4,053 → 181KB/속성. SwiftShader FPS(6~12)는 실기기 성능이 아니다
- 미검증: 실제 GPU·휴대폰의 FPS와 프레임 시간, iPhone Safari 로드·터치 조작, 저사양 기기의 BVH 생성 시간(SwiftShader 환경에서 53ms), 사운드
- 막힘: 이 개발 컨테이너에서는 jsDelivr가 막혀 있어 r147 원본은 측정 때 npm의 같은 파일로 대신 응답했다(`--cdn` 옵션). 지금 빌드는 CDN을 쓰지 않는다

## 다음 작업 후보 (우선순위 순)
1. 실기기 측정: iPhone Safari·Android Chrome·GPU 데스크톱에서 `?perf` 훅으로 FPS·로드 시간을 재서 `docs/perf.md`에 추가. 결과에 따라 타일 크기(400m)와 BVH 생성 비용을 다시 판단. 거리 LOD는 SwiftShader에서 효과가 없어 뺐으니 실기기에서 정점이 병목으로 나올 때만 다시 검토
2. 공유 랭킹: 원작처럼 일간·전체 점수(Supabase 등), 1인당 기여 상한, 학교 코드와 점수만 전송
3. 캠퍼스 확장: SCAD Atlanta, Lacoste. `tools/`의 bbox와 SCAD 판정 규칙을 캠퍼스 설정 파일로 분리
4. 지형: Savannah는 평지라 생략했지만, 확장 캠퍼스에는 AWS Terrain Tiles(SRTM 30m)가 필요할 수 있음
5. 한국어 UI 토글
6. OSM 기여: 태그 없는 SCAD 건물 37개의 층수·지붕 태그 목록을 뽑아 실제 OSM 편집을 돕기(직접 OSM 편집은 사용자만)
7. 번들 크기: 지금 JS 한 파일 838KB(gzip 218KB). three를 이름 import로 바꿔 트리 셰이킹이 되는지 확인

## 하지 않는 것
- Vercel 배포 금지(소유자 결정). Vercel 프로젝트 생성·연결·배포 설정 파일(vercel.json 등)을 만들지 않는다. 다른 호스팅에 배포하는 것도 소유자 지시가 있을 때만
