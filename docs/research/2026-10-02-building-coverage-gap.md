# 고덕동 800 m 건물 데이터 공백 조사

조사일: 2026-10-02
대상: 아리수로 250 · 중심 37.56253, 127.15592 · 반경 800 m
게시 데이터: manifest 2026-10-01d · buildings versions/2026-10-01d/buildings.sqlite
건물 원천 release: building@2026-09-09 · 국토교통부 VWorld GIS건물통합정보(AL_D010)

비교 입력: C:/Users/da/AppData/Local/Temp/claude/D--V-coding-16-SiteAnalysis/afa71a56-ea0e-4d38-b7d3-3843d21b9e14/scratchpad/sitedia4/03-sitedia_건축물용도_800m.csv

## 결론

이 공백은 반경 선택식보다 **최근 건물 보강 행 138건의 별도 계층**에서 생긴다.

- 우리 엔진의 자체 반경 선택은 GIS 건물 **1,014동**이다.
- 같은 선택 결과에서 건물 중심점이 800 m 안에 있는 것은 **1,005동**, 폴리곤이 원과 교차하지만 중심점은 800 m 밖인 것은 **9동**이다.
- 제공된 건축물용도 CSV는 **1,143행**이다. 그중 PNU가 있는 1,005행(고유 PNU 775개)은 모두 우리 엔진 결과의 PNU와 연결된다.
- 나머지 **138행(12.1%)**은 주소·PNU가 모두 비어 있고 비고=최근 지은 건물 보강(도로명주소 건물)이다. 이 138행이 북동쪽 고층을 포함한 순증 공백의 주된 원인이다.
- 138행은 현재 AL_D010 폴리곤에 PNU로 직접 조인할 수 없다. 대표 이름을 core의 표제부/집계 레코드에 대조하면 일부는 확인되지만, 그 레코드는 건물 외곽선이 아니라 대표점·집계 정보다.

따라서 **AL_D010 갱신만 기다리지 말고, 도로명주소 건물 폴리곤을 geometry 보강원으로 추가하고 title_202608.csv 표제부를 속성·조인 보조원으로 사용**하는 것이 맞다. 현 계층에서 확인 가능한 138행을 목표로 보강하면 상세 목록은 1,143행 규모까지 회복할 가능성이 높지만, 중복 제거와 실제 주소·건물관리번호 검증을 거쳐야 하므로 보장값은 아니다.

## 1. 행 수 분해

| 비교 집합 | 행/동 수 | PNU 상태 | 해석 |
|---|---:|---|---|
| CSV 전체 | 1,143 | 1,005행 non-empty, 138행 blank | sitedia 상세 건물 목록 |
| CSV의 PNU 행 | 1,005행 / 고유 PNU 775개 | 전부 non-empty | 우리 결과의 PNU 집합에 포함 |
| CSV의 보강 행 | 138행 | 주소·PNU 모두 blank | 최근 지은 건물 보강(도로명주소 건물) |
| 우리 엔진: 폴리곤 교차 | 1,014동 | 모두 PNU non-empty | 게시 buildings의 실제 엔진 선택 |
| 우리 엔진: 중심점 800 m | 1,005동 | 모두 PNU non-empty | 교차 결과에서 경계 밖 9동 제거 |

PNU를 기준으로는 CSV의 식별 가능한 1,005행 중 **PNU 누락 0행**이다. 우리 쪽에서 CSV PNU 집합에 없는 것은 2개 PNU이며 각각 1동이다. 나머지 7동은 두 PNU에서 우리 쪽 feature 수가 CSV보다 많다.

| 우리 쪽 추가/수량 차이 | CSV | 우리 엔진 | 차이 |
|---|---:|---:|---:|
| 1174010200102170000 | 37 | 43 | +6 |
| 1174010200103130000 | 1 | 2 | +1 |
| 1174010200102280002 | 0 | 1 | +1 |
| 1174010200102250006 | 0 | 1 | +1 |
| 합계 | — | — | **+9** |

따라서 단순한 순수 행 차이는 1,143 - 1,014 = 129지만, PNU로 맞는 1,005행을 기준으로 양쪽의 비대칭을 펼치면 138개 보강 행 + 우리 쪽 추가 9동 = 147개의 gross 차이가 있다. 반경 선택식이 설명하는 것은 이 중 **9/147 = 6.1%**이고, 보강 행이 차지하는 것은 **138/147 = 93.9%**다. 순부족 129행의 11.3%에 해당하는 수치가 아니라, 138행이 9동의 우리 쪽 추가분과 상쇄된 결과라는 점에 유의한다.

### 보강 행의 내용

138행은 모두 주소, PNU, 주용도, 높이·면적 일부가 비어 있고 비고가 동일하다. 사용 용도 분포는 주거 78, 미상 43, 교육복지 8, 근린생활 4, 문화집회 3, 업무 2이다. 사용승인 연도는 미상 43, 2016년 35, 2019년 21, 2022년 19건이 큰 묶음이다. 이름이 있는 대표 묶음은 래미안힐스테이트 고덕 35행, 고덕그라시움 21행이며 나머지는 소규모 시설·업무·근린생활 이름들이다.

CSV의 D16 메모인 **층수 없는 143동**은 이 138행과 같은 현상이 아니다. 지상층이 빈 143행은 모두 PNU가 있는 행이고, 138개의 PNU 없는 보강 행에는 층수가 채워져 있다. 따라서 층수 보강과 geometry 보강을 한 결함으로 합치면 안 된다.

## 2. 우리 엔진의 선택 규칙

구현 위치는 src/lib/v2/data/features.ts의 queryFeaturesInRadius()다.

1. EPSG:5179 중심점에서 R-tree bounding box 후보를 조회한다.
2. 반경 원을 외접하는 64각형으로 만들어 polygon에 대해 booleanIntersects(circle, geometry)를 적용한다.
3. Point/MultiPoint는 중심점과의 실제 거리로 판정한다.

즉 현재 buildings 상세 선택은 **centroid-in이 아니라 geometry intersects**다. 같은 1,014개 feature에 대해 실제 EPSG:5179 중심점을 계산한 결과는 다음과 같다.

| 판정 | 동 수 | 비고 |
|---|---:|---|
| 폴리곤이 800 m 원과 교차 | 1,014 | 현재 엔진 결과 |
| 중심점이 800 m 안 | 1,005 | CSV의 PNU 행 수와 count-level 일치 |
| 교차만 되고 중심점은 밖 | 9 | 중심점 거리 802.51~836.73 m |

교차만 통과한 9동의 중심점 거리는 800~805 m 3동, 805~810 m 2동, 810~820 m 3동, 820~850 m 1동이다. 따라서 선택 규칙을 centroid-in으로 바꾸면 우리 쪽 추가 9동은 없어지지만, CSV의 주소/PNU 없는 138행은 복원되지 않는다. CSV의 PNU 행 수가 1,005로 중심점 결과와 맞는 것은 sitedia가 그 부분에서 중심점 계열 선택을 사용했을 가능성과 일관되지만, sitedia 내부 구현을 볼 수 없으므로 구현 동일성으로 단정하지 않는다.

## 3. PNU·parcel·ledger·GIS raw 대조

### 게시 core의 조인 가능성

식별 가능한 CSV PNU 775개를 게시 core의 인덱스 조회로 대조했다.

| 조사 | 고유 PNU 수 | 결과 |
|---|---:|---|
| 우리 building hit에 존재 | 775/775 | PNU 기준 누락 없음 |
| core parcel_point에 존재 | 767/775 | 8개는 게시 parcel 대표점 없음 |
| core ledger feature에 존재 | 132/775 | ledger_title:housing_complex 129, ledger_recap:housing_complex 3 |
| CSV 보강 행 | 138 | PNU가 없어 PNU·parcel·ledger 직접 조인 불가 |

보강 행 이름 중 core에서 대응되는 대표 레코드는 다음과 같다. 이 좌표는 건물 외곽선이 아니라 집계/표제부 대표점이며, 행 수와 집계 buildingCount도 일치한다고 가정하지 않는다.

| 이름 | core 대표 PNU | 대표점 거리 | 주의 |
|---|---|---:|---|
| 고덕그라시움 | 1174010200106930000 | 749 m | 집계 레코드, AL_D010 대표 PNU 미존재 |
| 이케아하우스 | 1174010200105080003 | 169 m | 대표점 |
| 아카이브시티 | 1174010200102800007 | 527 m | 대표점 |
| 샤론빌 | 1174010200102550001 | 627 m | 대표점 |
| 드림빌 | 1174010200102800002 | 470 m | 대표점 |
| YOUNG STAY | 1174010200106460006 | 472 m | 대표점 |
| 래미안힐스테이트 고덕 | 1174010200106880000 | 887 m | 대표점 자체는 800 m 밖; 실제 보강 건물 위치의 증거가 아님 |

### AL_D010 raw 존재 여부

읽기 전용으로 다음 raw를 직접 스캔했다.

D:/V-coding/16-SiteAnalysis/.cache/v2/raw/gis_building/2026-09-09/서울특별시/AL_D010_11_20260909.shp 및 같은 이름의 DBF

- CSV의 식별 가능한 PNU 775개는 **775/775가 raw AL_D010에 존재**하고, geometry도 조사 반경 안에서 확인된다.
- 따라서 PNU가 있는 1,005행은 “현재 GIS raw에 아예 없는 건물”이 아니다.
- 반대로 대표적인 최근/대단지 보강 PNU인 1174010200106880000(래미안힐스테이트 고덕), 1174010200106930000(고덕그라시움), 1174010200106460006(YOUNG STAY), 1174010200105080003(이케아하우스), 1174010200102800007(아카이브시티), 1174010200102550001(샤론빌), 1174010200102800002(드림빌)는 현재 DBF에서 발견되지 않았다.

이 두 결과는 모순되지 않는다. 앞의 775개는 CSV에 PNU가 기록된 기존 GIS 행이고, 뒤의 대표 PNU들은 CSV에서는 PNU가 비어 있는 138개 보강 행을 core의 이름/집계 레코드로 역추적한 것이다. 즉 **현재 AL_D010 snapshot은 일부 기존 건물은 갖고 있지만, 보강 대상인 최근·대단지 geometry를 보장하지 않는다.**

## 4. 지도·시각 증거

![고덕동 건물 coverage gap 조사 지도](C:/Users/da/AppData/Local/Temp/claude/D--V-coding-16-SiteAnalysis/afa71a56-ea0e-4d38-b7d3-3843d21b9e14/scratchpad/p4-bldgap/building-coverage-gap-map.png)

렌더 파일:

- PNG: C:/Users/da/AppData/Local/Temp/claude/D--V-coding-16-SiteAnalysis/afa71a56-ea0e-4d38-b7d3-3843d21b9e14/scratchpad/p4-bldgap/building-coverage-gap-map.png
- SVG 원본: C:/Users/da/AppData/Local/Temp/claude/D--V-coding-16-SiteAnalysis/afa71a56-ea0e-4d38-b7d3-3843d21b9e14/scratchpad/p4-bldgap/building-coverage-gap-map.svg

지도는 게시 buildings 1,014개 footprint를 파란 외곽선으로 그리고, CSV의 138개 PNU 없는 보강군 중 core 이름·표제부 대표점으로 확인 가능한 묶음을 빨간 십자 표식으로 표시했다. 대표점이 800 m 밖인 래미안 묶음은 황색 점선으로 따로 표시했다. **138행 전체의 좌표가 아니며, 대표점 표식은 missing footprint 자체가 아니다.** 138행에는 주소도 PNU도 없으므로 이것이 현재 가능한 정직한 공간 증거의 한계다.

제공된 시각 비교 캡처도 확인했다.

C:/Users/da/AppData/Local/Temp/claude/D--V-coding-16-SiteAnalysis/afa71a56-ea0e-4d38-b7d3-3843d21b9e14/scratchpad/p4-t17/s02-real-raster-v2-final-vs-sitedia-1200px.png

캡처에서는 우리 v2 쪽 북동부에 고층 mass/shadow가 거의 보이지 않는 반면, 비교 쪽에는 고덕비즈밸리·최근 고층으로 보이는 북동부 mass가 보인다. 이는 이번 CSV·raw 대조와 방향이 일치하지만, 캡처 자체는 좌표·PNU가 없는 138행의 개별 footprint를 증명하는 자료는 아니다.

지도 시각 품질은 ui-ux-pro-max의 지도·차트 체크를 적용해 검토했다. 밝은 바탕 위 어두운 본문/경계로 대비를 확보하고, 보강군은 색상만이 아니라 십자 표식·직접 라벨·범례로 구분했으며, 800 m 원·북쪽 화살표·200 m 축척을 함께 넣었다. 렌더 재검토에서 라벨을 서로 다른 방향으로 배치해 주요 라벨 겹침을 제거했다. 우리 지도에는 비교 서비스의 이름·로고·헤더를 넣지 않았다.

## 5. 보강 권고

### 권고 1 — geometry는 도로명주소 건물 polygon을 보조 원천으로 채택

AL_D010을 기본 geometry 원천으로 유지하되, 현재 release에 없는 최근·대단지 건물을 채우는 **도로명주소 건물 polygon**을 별도 source release로 적재한다. 표제부 CSV만으로는 geometry가 없으므로 지도 footprint를 만들 수 없다.

조인 우선순위는 다음처럼 두는 것이 안전하다.

1. 도로명주소 건물의 건물관리번호와 표제부 관리_건축물대장_PK를 정규화해 exact join.
2. 도로명주소 기본구역·도로명·건물본번/부번과 표제부 도로명주소를 보조 join.
3. PNU는 parcel/ledger 연결과 중복 검사에 사용하되, parcel centroid를 building footprint로 대체하지 않는다.
4. 건물관리번호가 없는 경우에만 정규화된 주소 + geometry overlap/근접 검사를 사용하고, 불확실한 행은 missing 또는 검토 대상으로 남긴다.

### 권고 2 — title_202608.csv는 속성·조인 보조원으로 사용

D:/V-coding/16-SiteAnalysis/.cache/v2/raw/ledger_title/title_202608.csv의 표제부에는 사용승인일, 층수, 용도, 연면적, 도로명주소를 만들 수 있는 주소 구성요소와 관리_건축물대장_PK가 있다. 19자리 PNU 열은 직접 들어 있지 않고 시군구·법정동·번·지로 파생된다. 그러나 raw title 자체에는 건물 polygon이 없다. 따라서 다음을 분리한다.

- title: 사용승인일·층수·용도·연면적·주소·관리번호 속성
- 도로명주소 건물: 지도 geometry
- AL_D010: 전국 GIS 기본 footprint와 height/use 보조 속성

현재 src/lib/v2/ingest/sources/ledger.ts는 recap PNU가 있으면 해당 housing title을 별도 housing feature로 만들지 않는 경로가 있다. 대단지의 개별 동 상세를 목표로 한다면 recap 집계와 title 개별 동을 동시에 보존하되, 최종 화면에서 집계와 개별 동을 이중 집계하지 않도록 관리_건축물대장_PK/PNU/geometry overlap으로 dedupe해야 한다.

### 권고 3 — GIS update cadence에 의존하지 않기

현재 게시 GIS release는 2026-09-09인데, 이번 raw 대조에서 대표적인 보강 대상 PNU가 발견되지 않았다. 이것만으로 “다음 GIS release에 반드시 들어온다”고 말할 수 없다. AL_D010은 게시 release마다 갱신하되, 도로명주소 polygon 보강을 매 cycle 함께 실행하고 source/date/coverage를 별도로 기록하는 편이 안전하다.

### 기대 coverage

최소 목표는 이번 CSV에서 확인된 PNU 없는 보강 **138행**이다. 도로명주소 polygon과 title 속성을 올바르게 조인하고 중복을 제거하면, 이 반경의 상세 목록은 현재 1,014동에서 **약 1,143행 규모**로 회복될 것으로 기대한다. 다만 다음은 별도 검수 대상이다.

- 대표점만 있고 실제 polygon이 확인되지 않는 대단지 묶음
- title recap과 개별 동의 중복
- 주소 표기 변화·건물본번/부번 정규화 실패
- 800 m 원 경계에서 intersects와 centroid-in의 차이
- PNU가 없는 보강 행의 이름·주소가 불완전한 경우

## 6. 성능·검증 경계

이번 작업은 앱 코드나 runtime 경로를 바꾸지 않는 **읽기 전용 조사**이므로 P4 무거운 타일의 실행 성능 예산을 새로 적용할 대상은 없다. 실측 참고값은 다음과 같다.

- 같은 게시 DB에 대한 queryFeaturesInRadius(..., 800, ["building"]) 재현: 1,014개 hit, 이 세션의 TSX 실행 wall 약 5.5초(모듈 startup 포함; production budget으로 해석하지 않음).
- raw AL_D010 전체 PNU/geometry 검증: shapefile/DBF 순차 읽기라 수 분이 걸렸으며, 결과 판정은 775/775 exact PNU match로 남겼다. 조사 스캔 시간은 앱 응답 시간에 포함하지 않는다.
- focused 재현 결과: intersects=1,014, centroid-in=1,005, intersects-only=9.

시각 인수는 제공된 북동부 비교 캡처와 새로 렌더한 위 지도에 대해 확인했다. 앱 UI를 변경하지 않았으므로 새 Playwright 앱 캡처를 docs/design/p4/에 만들지는 않았다. 새로 만든 지도는 참고 이미지로 외부 scratchpad에 보관하고, 이번 커밋에는 조사 문서만 넣는다.

## 7. 한계

- sitedia CSV의 138행은 주소·PNU가 없어서 이 조사에서 모두를 정확한 좌표·polygon으로 재구성할 수 없다.
- core의 housing complex point는 실제 동 polygon이 아니다. 특히 래미안 대표점 887 m는 800 m 밖이므로 해당 35행의 실제 위치를 증명하지 않는다.
- AL_D010 raw에 PNU가 없다는 결과는 현재 2026-09-09 snapshot에 대한 판정이다. 이후 release의 포함 여부는 새 manifest와 release를 확인해야 한다.
- 제공된 좌우 캡처의 북동부 mass 차이는 시각 증거이지, 개별 missing row의 geometry join 결과가 아니다.
- 다음 구현에서 intersects를 centroid-in으로 바꾸면 경계 9동의 포함 여부가 바뀐다. 보강원 선택과 별도로 제품 요구사항으로 결정해야 한다.
