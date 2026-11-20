# CLAUDE.md — SMASH SCAD

## 프로젝트
SCAD 사바나 캠퍼스를 OSM 데이터로 3D화해서 부수는 비공식 팬게임. 원작은 https://smash-univ.app (한국 대학 337곳). 소유자는 club-paradiso(Luca). 바이브 코딩 위주이며, 구현→테스트→검증까지 한 흐름으로 끝낸다.

## 구조
- `web/index.html`: 게임 전체(UI, three.js 씬, 무기, 점수, 파티클, 사운드). 스크립트 하나에 블록 스코프 `{ }`
- `web/geom.js`: 순수 지오메트리 모듈 `SG.building(THREE, rec)`. 브라우저와 node 공용
- `web/scad-savannah.json`: `{v:2, b:[건물], r:[도로], p:[공원], w:[연못], river:[강 폴리곤]}`
- `tools/`: OSM 타일 다운로드 → 파싱 → 지면 레이어 → 건물 빌드
- `tests/geom.test.js`: `npm test`

### 건물 레코드 `b[i]`
`[scad, name, outer(flat x,z), holes[[flat]], minH, wallTop, roofH, shape, obb[cx,cz,ang,hl,hw], wallCol, roofCol, est]`
- 좌표: 미터 단위 로컬 좌표, 원점은 위도 32.0745, 경도 -81.0945. x는 동쪽, z는 남쪽(z = -북쪽)
- shape: 0 flat, 1 gabled, 2 hipped, 3 pyramidal, 4 skillion, 5 dome
- obb의 u축(ang)은 용마루 방향. skillion은 +v가 내리막
- est=1: 높이·층수 태그 없음(추정값)

## 렌더링 핵심
- 모든 건물을 non-indexed BufferGeometry 하나로 병합. 건물 k의 정점 범위는 `vStart[k]`, `vCount[k]`. 삼각형→건물 매핑은 `faceB`
- 붕괴는 `aL` 정점 속성(y 스케일, x/z 기울기)을 `onBeforeCompile`로 셰이더에 주입. 피해 색은 vertex color
- `logarithmicDepthBuffer` 사용(지면 레이어의 z-fighting 방지)
- 파티클은 InstancedMesh 2개(debris 700, puffs 360)

## 원칙
- 데이터 날조 금지. 태그 없는 건물에 지붕 모양을 추측해서 넣지 않는다. 추정값은 `est`로 구분
- SCAD 로고·마스코트·브랜드 그래픽 사용 금지. "비공식, 무관" 고지 유지
- OSM 출처 표기(ODbL) 유지
- 실행하지 않은 테스트, 측정하지 않은 성능은 주장하지 않는다. 구현됨 / 검증됨 / 미검증 / 막힘을 구분해 보고
- 데이터를 다시 만들 때는 `npm test`로 지붕 면적 일치(±3%)와 SCAD 71개 유지를 확인. 건물 수가 바뀌면 테스트 기대값을 근거와 함께 갱신

## 검증 상태 (v0.2.0)
- 검증됨: `npm test` 8/8 통과. 헤드리스 Chrome(SwiftShader)에서 1280px·390px 로드, 무기 6종, 랭크, 건물 목록, 복구 버튼 동작, 콘솔 에러 없음
- 미검증: 실제 GPU·모바일 기기의 FPS(SwiftShader에서는 약 6fps라 의미 없음), iOS Safari 터치 조작, 사운드

## 다음 작업 후보 (우선순위 순)
1. 실기기 성능 측정과 최적화: 손상 시 `aL`·color 전체 업로드를 범위 업데이트로 바꾸기, 거리별 LOD, 피킹용 BVH(three-mesh-bvh)
2. Vite와 ES 모듈로 전환, three 최신 버전(r160+) 마이그레이션. 그 다음 Vercel 배포
3. 공유 랭킹: 원작처럼 일간·전체 점수(Supabase 등), 1인당 기여 상한, 학교 코드와 점수만 전송
4. 캠퍼스 확장: SCAD Atlanta, Lacoste. `tools/`의 bbox와 SCAD 판정 규칙을 캠퍼스 설정 파일로 분리
5. 지형: Savannah는 평지라 생략했지만, 확장 캠퍼스에는 AWS Terrain Tiles(SRTM 30m)가 필요할 수 있음
6. 한국어 UI 토글
7. OSM 기여: 태그 없는 SCAD 건물 37개의 층수·지붕 태그 목록을 뽑아 실제 OSM 편집을 돕기(직접 OSM 편집은 사용자만)
