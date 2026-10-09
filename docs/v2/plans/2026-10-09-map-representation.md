# v2 지도 표현 통합 계획 — 범례·라벨·표식 (디자인 담당, 2026-10-09)

입력: 공용 셸 리뷰 1 + 타일 묶음 리뷰 7(transit·amenity·market·buildings·regulation·terrain·simulation).
기준 문서: `docs/design/v2-design-language.md` §1(지도를 가리지 않기·색에만 기대지 않기·호버 전용 금지), §3(색은 map-layers.ts 한 곳), §6(한 줄 범례), §8(호버·고정 라벨 `이름 · 값`), 결정 이력 113행(자동 라벨은 원천 이름만, '미상'은 값으로 붙이지 않음).
ui-ux-pro-max 점검 적용: 색만으로 의미 전달 금지(지도·히트맵 항목: 경계선·패턴·직접 라벨 병행), 글자 대비 4.5:1, 웹 누름 영역 24 px 이상 + 간격 8 px, 범례에 구간 경계값 표기, 팝오버 키보드·Esc·포커스 복귀.
이 문서의 줄번호는 리뷰가 적은 값이다. 구현 전에 다시 확인할 것.

**사용자 결정(2026-10-09):** 5장 2~13번은 추천안 그대로 확정했다(4번 D05는 실제 층수, 3번 A01은 2칸으로 하되 실화면을 보고 최종 확정). 1번 범례 배치는 시안(https://claude.ai/artifact/ERCAGNSfBTRNTYBmWozEfC)을 보고 **B 변형으로 확정**했다(같은 날): 범례를 지도 아래 띠로 내리되 **"+n" 팝오버 없이 모든 항목을 한 줄로 늘어놓고 가로 스크롤**한다. 이유: 범례 호버로 지도 요소를 강조하는 기능은 지도와 범례가 동시에 보여야 쓸 수 있는데, 팝오버는 열리는 순간 지도를 가린다. 1-1의 A안 채택은 이 결정으로 대체된다.
Judge 결정: 5장 아래 Judge 항목은 모두 권장안을 따른다(흡수 타일은 merge 유지 + judgment 'base', A07/A08은 PNU 조인, d21 삭제, 역 축 막대 보류, 요약 지도면 지물 보류). 엔진→ui import 허용 여부는 W0에서 확인해 정한다.

---

## 1. 공통 디자인 규칙

### 1-1. 범례 배치 — **대안 A(접이식 + 높이 상한) 채택**
| 대안 | 판정 |
|---|---|
| **A. `+n` 창에 max-height + 스크롤, 행 높이 축소** | **채택.** map-box.tsx 한 파일로 끝나고 디자인 언어 §6(왼쪽 아래 한 줄 알약 + `+n` 팝오버)을 그대로 지킨다. 닫힌 상태의 가림은 알약 한 줄뿐이고, 열린 창은 사용자가 연 것이라 Esc·바깥 클릭으로 닫힌다. |
| B. 지도 아래 띠 | 보류. 가림 0%지만 1칸 카드 지도가 ~196→~174 px로 줄고 §1·§6 개정이 필요하다. A 적용 후에도 불만이면 사용자 결정 항목 1로 다시 연다. |
| C. 칩 순환 강조 | 기각. 발견성이 낮고 항목 5개 이상에서 번거롭다(셸 리뷰 자체 평가). |

A의 세부 규칙:
- 전체 범례 창: `maxHeight = max(96, 지도높이 − legendBottom − 40)`, `overflow-y: auto`. 행 높이 28 px, `pointer: coarse`에서만 36 px(웹 최소 24 px 충족).
- 창은 role=dialog, Esc·바깥 클릭으로 닫힘, 닫히면 `+n` 버튼으로 포커스 복귀. 알약과 창의 범례 버튼 마크업·핸들러 중복(map-box.tsx:333/346)은 한 컴포넌트로.
- 알약 정렬: **highlight(최근접·대지 관련) 레이어 먼저**, 그다음 개수 내림차순(map-layers.ts:329 `compactLegendItems`). 지금은 'A01 버스 정류장 23'이 앞에 오고 '최근접'이 `+n` 뒤로 숨는다.
- `*_nearest` 레이어는 범례에서 뺀다(바탕 레이어와 같은 색, A01 7항목 중 2개 중복). 강조는 표식 굵기·지시선으로 이미 구분된다.
- 대지와 같은 객체(S02 `sun_face`)는 대지 항목에 합친다.
- 래스터 범례가 있어 `legendBottom=38`일 때 카드 라벨 회피 상자(tile-card.tsx:296, 하단 34 px)도 같이 올린다(셸 리뷰 confidence low → 화면 확인 후).
- **범례 항목 수 자체를 줄이는 것이 1순위 대책이다**: 같은 지물 이중 레이어 제거(A11 12→6, A02 11→5, D19 8→6, A09·A04·D02·D04 중복 제거), D13 도로 7→4묶음. 아래 표식 규칙과 타일표 참고.
- 범례 값: 상대 구간 범례(A07 5분위, D16 KDE)는 실제 경계값을 함께 쓴다(`~850만원/㎡`, `12~25동/㎢`). 히트맵·단계구분도는 수치 범례가 필수(ui-ux 점검).

### 1-2. LayerSelect 칩
- `.seg`를 `.mfMap` **안쪽 왼쪽 위**(top 8, left 8)로 옮긴다. 방위표(오른쪽 위, map-figure.tsx:846)와 겹치지 않고, 헤더 구성(지표줄 유무)에 따라 위치가 어긋나는 문제(top:64가 `.mf` 기준)가 사라진다. `max-width: calc(100% − 56px)`, 넘치면 가로 스크롤. 라벨 회피 상자(tile-card.tsx:296)에 칩 영역을 더한다.
- **바꿔도 화면이 같은 칩은 없앤다**: A01('철도·출입구'=기본), A07('가격 구간'=기본), A10('노선·계획역'=기본), A11('밀도 구간'=기본), A12('용도지역'=기본). 옵션이 1개 남으면 LayerSelect 자체를 그리지 않는다.
- 남기는 칩은 서로 배타적인 보기여야 한다(`baseExcludes`): A02(학구), A04(녹지·수면), A09, D05, D19(규모).

### 1-3. 라벨 규칙
**계약(2장)**: 이름은 `name`, 값은 `sublabel`(타일이 서식까지 끝낸 문자열), 자동 노출 등급은 `labelPriority`(0/1/2).
- 자동 라벨 = `name`만(값·범례명 없이). `labelPriority ≥ 1`이고 `name`이 있을 때만 후보.
- 호버/고정 라벨 = `[name ?? 범례명, sublabel].join(' · ')`. **범례명 꼬리 붙이기 금지**('지구단위계획구역 · 지구단위계획', '제2종일반주거지역 · 주거지역', '학구명 · 교육청 · 초등 통학구역' 같은 반복 제거). 값이 '미상'이면 붙이지 않는다(결정 이력 113행).
- 이름 없는 요소: 자동 라벨 없음, 호버는 범례명(+값). '이름 없음 미확인', '건물(대표점)', 'OSM 녹지 면' 같은 대체 문구 금지.
- 거리 표기: `직선 412m` / `직선 1.2 km`(formatDistanceM, §4). 문자열 직접 조립 금지(A01·A02·A03·A10·D13 버스·역 거리 '1234m' 문제).

레이어 유형별 형식(리뷰 제안 채택분):
| 유형 | 자동(name) | 호버·고정(name · sublabel) | priority |
|---|---|---|---|
| 철도역 | `강남역` | `강남역 · 2호선·신분당선` | 1, 최근접 2 |
| 역 출입구 | (배지 `3`) | `강남역 3번 출구 · 직선 312m`(최근접) | 0, 최근접 2 |
| 철도 노선(선) | `2호선` (노선당 최장 조각 하나) | `2호선` | 1 |
| 계획 철도(선) | `위례신사선` (사업당 최장 조각) | `위례신사선 · 공사 · 개략` | 1 |
| 버스 정류장 | 최근접만 `고덕역 정류장` | `고덕역 정류장 · 직선 480m` | 0, 최근접 2 |
| 도로(간선 이상·보조간선) | `테헤란로`/`국도 3` (이름당 최장 조각) | `테헤란로 · 간선` | 1, 국지·보행 0 |
| 학교·상가·공원 점 | 최근접만 이름 | `○○초등학교 · 직선 312m`, `GS25 고덕점 · 직선 85m` | 0, 최근접 2 |
| 건물 면(일반) | 건물명 | `건물명 · N층`(D05·D29·S01), `· 1994년`(D04), `· 주용도`(D03) | 1, 고층 보기 상위는 2 |
| 공동주택 점(A05) | 단지명 | `단지명 · 1,234세대`(오피스텔 `· n호`) | callout 경로 고유 |
| 공급 점(A06) | 단지명 | `단지명 · 2027년 3월 입주 · 512세대` | callout 경로 고유 |
| 실거래 점(A07·A08) | 단지명(상위 3곳만 1) | `단지명 · 850만원/㎡ · 12건`, `단지명 · 월세 60만원(보증금 1,000만원) · 8건` | 0, 상위 3곳 1 |
| 구역 면(용도지역·구역·정비·학구) | 세분명/구역명, 같은 이름은 최대 조각 하나 | `제2종일반주거지역 · 34%`, `상계5구역 · 조합`, `고덕지구단위계획구역 · 2019 고시` | 대지 관련 2, 그 외 1(학구는 대상 구역만) |
| 도시계획시설 | 시설 종류명 | `근린공원 · 1.2ha`, `소로2류 · 340m` | 1 |
| 필지 | — (대지만 `대지 123-4`) | `123-4 · 대지`(지목 전체 이름), 규모 보기 `123-4 · 248㎡` | 0, 대지 2 |
| 격자·밀도·가구·지형·경사 면 | 없음 | 범례명 + 값(`12,345명`, `1.34ha`) | 0 |
| 등고선 | 계곡선(25 m 배수)만 `표고 35m` | 같음 | 계곡선 1, 간곡선 0 |
| 마스크(D29 svf_building) | 없음 | `건물명 · N층` | 0 |

밀집 시 우선순위/생략(셸):
1. `labelPriority` 2 → 1 순으로 배치, 0은 자동 라벨에서 제외.
2. 같은 등급 안에서는 **엔진이 낸 순서**(엔진이 중요도로 정렬해서 낸다: D05 층수 내림차순, 구역은 교차 면적 내림차순, A11은 인구 내림차순). 지금의 key 사전순(map-figure.tsx:831-835)과 면적 상위 5(697-699)를 대체한다. 새 rank 필드는 만들지 않는다.
3. 같은 문구의 자동 라벨은 하나만(D12 '도로', D11 반복 제거).
4. 자리가 없으면 생략(현행 배치 규칙 §8 유지). 고정 라벨이 자동 라벨보다 우선(§8).

### 1-4. 표식 규칙
**공통**
- **면이 있으면 같은 지물의 대표점은 내지 않는다.** 대표점은 도형 실패 대체로만(tile-result.ts:169 주석 의도와 일치). 대상: D02, D04, D09(A04), D11, D12, A09, A12, A11.
- **선 위에 샘플 점을 찍지 않는다.** 선은 선으로(A01·A10 `sampleLine` 제거, D12 선형 시설을 `lineCandidate`로). "지하철이 점으로만 보임"의 직접 원인(A01 engine.ts:237-239).
- **같은 좌표에 레이어가 다른 점을 겹쳐 내지 않는다** — 타일이 하나로 합쳐 낸다(A08 전세/월세). 셸에 벌려 그리기 기능은 만들지 않는다(현재 사례 1건).
- 최근접 표식: highlight + 대지 연결 점선. 점선 조건을 레이어명 `_nearest` 접미 대신 `highlight && distanceM != null`로(A03 상가 점선 누락 해소).
- 추정·미상: 색이 아닌 모양으로도 구분(§1). 추정은 빗금(현행 `_est`), 미상은 테두리만 또는 빗금. D03 '기타'/'미상' 회색 2개, A05 '준공 미상' 속 빈 원(범례와 실제 표식 불일치) 정리.

**점**: 기본 원. 철도역은 **노선색 둥근 사각 배지(호선 번호, 환승역은 배지 여러 개, 최대 4) + 역명**, 출입구는 흰 테두리 작은 원 안에 출구 번호(v1 osm-subway-overlay.ts 방식). 배지 글자색은 배경 휘도로 흑/백 자동(v1 subwayStationBadgeTextColor) — 대비 4.5:1 확보. 계획역은 속 빈 원.

**선**: LayerStyle에 `strokeWidth`(면용 이미 존재, 선에도 적용)·`dash`·`casing`·`arrow` 추가.
- 운영 철도: 노선색 3.6 px + 흰 케이싱(v1 973-981, 경로선 케이싱 재사용). 범례는 '철도 노선' 한 항목, 견본은 다색 줄무늬.
- 계획 철도: 보라 점선, 개략은 더 옅은 점선(범례가 아니라 선 강도로 개략 표시).
- 도로 위계 굵기: 고속·간선 3 > 보조간선 2 > 집산 1.5 > 국지 1 > 보행 0.75 점선. 범례 4묶음(간선 이상 / 보조간선·집산 / 국지 / 보행·자전거).
- 보행망(D28 walk_net): 0.75 px 반투명.
- 등고선: 간곡선 가는 회색, 계곡선 굵게(MapLine `emphasis: 'major'|'minor'`).
- 바람 유입(S03): 화살표 선.
- 역 축 막대·출입구 연결선: **보류**(rail.ts가 축 좌표를 적재하지 않음, 약 300줄 이식).

**면**: 레이어 단색 채움 유지. D16 `dens_0`, D15 `block_open`은 채움 없음/약하게(지도 가림 감소). 래스터는 범주 견본(바람 입력 없음·건물 셀)을 범례에 함께(S04 회색 설명 누락).

### 1-5. 그리드·기본 크기
- **그리드 공식 유지**(열 2~6, 행 max(280, 폭×5/6)). 원인은 셀 크기가 아니라 범례 오버레이 크기(셸 판정에 동의). 전역 행 높이 증가는 12장 보드 스크롤과 요약 카드 여백만 키운다.
- 기본 크기: A05·A06 2 유지. **A01은 2 추천**(역명·호선 배지·출구 번호를 ~190 px 지도에 넣으면 대부분 탈락할 가능성, transit confidence low → 1-1 적용 후 실측해 확정, 사용자 결정 3). D05는 1 유지(라벨 우선순위로 해결 가능, 필요하면 실측 후 재론).
- 요약 카드 2x2 지도면: 대지+반경만 유지(YAGNI). 대신 stage에 한 줄 대체 텍스트 `대지·반경 {radius} 지도`.

---

## 2. 공용 계약 변경

### 2-1. sharedRequests 중복 병합(8개 리뷰 → 10개 변경)
| # | 변경 | 합친 요청(출처) | 판정 |
|---|---|---|---|
| C1 | **라벨 계약**: 3개 지물 스키마에 `name`·`sublabel`·`labelPriority` | 셸 라벨 계약 초안·라벨 경로 버그 / amenity 면 라벨 / market featureLabelValue 우선순위 / buildings MapPolygon 값 필드·자동 라벨 선정 / regulation MapPolygon·MapLine name+값·자동 라벨 우선순위 / terrain 자동 라벨 우선순위 / simulation MapPolygon name·floorsAbove | 충돌 판정 A·B·C 참고 |
| C2 | **candidate()가 hit.name 전달** + C1과 같은 커밋 | 셸 candidate / amenity 자동 라벨 대상 제한 | 둘이 따로 들어가면 정류장·상가 수십 개가 자동 라벨을 다툼(두 리뷰 모두 지적) |
| C3 | 선 스타일: LayerStyle `strokeWidth`·`dash`·`casing`·`arrow`, MapLine `color`·`emphasis` | 셸 MapLine 스타일 / transit 선 스타일 / terrain MapLine emphasis / simulation 화살표 | |
| C4 | MapFeature `badges: {text≤4자, color}[] ≤4` | 셸 / transit | 노선색은 사용자 결정 2 |
| C5 | 최근접 표식: 점선 조건 = highlight+distanceM, `*_nearest` 범례 제외, `unnamedLabel` 중복 명사 방지, 선 상한 주석 '경로 표시'→'선 표시' | 셸 / transit 4건 / amenity | |
| C6 | 범례: map-box A안 + highlight 우선 정렬 + 범례 엔트리 min/max·표시 문구를 타일이 채움(makeTile common.ts:228-233) | 셸 범례 배치 / market 범례 값 / buildings 범례 값 | |
| C7 | merge.ts: totals 계산, `MergeOptions.judgment: 'base'|'concat'`, `dropMetricIds`, capByLayer 기본 보기 우선 | transit totals / market totals / amenity 문장 / buildings 병합 / regulation MergeOptions / terrain 문장 | 충돌 판정 D·E |
| C8 | 대표점 계약: "면이 있으면 대표점 금지"를 브리프·스키마 주석에 명시, makeTile이 같은 fid의 점+면을 받으면 경고 | amenity / buildings / regulation | 충돌 판정 F |
| C9 | 래스터 범례: null 범위 범주 견본 표시, sun_hours 16색을 map-layers에 직접(raster-image 특례 삭제), wind_ratio 계단(0.5/0.8/1.2/1.5), utci 범주 어휘 통일, S02 제목 하드코딩 삭제 | simulation 4건 | |
| C10 | 기타 셸: LayerSelect 위치(1-2), tile-view `지물 없음` 노트에 `&& !basemap`, map-layers 행 일괄 수정(아래 목록), tile-layers 타일 고유 매처 정리, cut-utils isRecord·rasterRefs 통일 | 셸 칩 / terrain / transit·amenity·regulation·terrain·simulation map-layers / regulation·terrain tile-layers / simulation cut | |

map-layers.ts 행 일괄 수정(C10, 한 사람이 한 커밋): `planned_rail_line` '계획 철도 선형', `road:*` 4묶음 스타일, `facility:방재` 추가(지금 회색 '기타'로 그려지고 범례 누락), `jimok:*` 6색(사용자 결정 7), `maint_zone` 정리(A09 레이어 제거와 같이), `block_open`·`dens_0` 채움 약화/없음, `relief_*` '중심 대비 −20m 미만' 형식, `slope_*` '경사 0~5°', `pop_grid_q*` 삭제(A11 점 제거와 같이), `svf_building` '건물(계산 제외)', `sun_face` 대지 계열, 연대 범례 '1970년대 이전'/'2020년 이후', `tall_lt35` 옅은 회색(use:업무와 색 충돌), `use:미상` 빗금/테두리, OSM 녹지 cls별(D10, 우선순위 낮음).

### 2-2. 충돌 판정
- **A. 이름 필드: `label` vs `name`.** 셸은 기존 `label`을 이름으로 쓰자고 했고, amenity·regulation은 `name`을 제안했다. → **`name` 채택.** MapFeature에 이미 `name`이 있고 원천 FeatureHit.name과 같은 말이다. 기존 `label`은 읽기 전용 하위 호환으로만 남긴다(새 필드가 없으면 현재 동작 그대로 → 저장 결과·보고서 재계산 불필요, 셸 판단 유지).
- **B. 값 필드: 정형 필드(floorsAbove·heightM, buildings·simulation) vs 문자열 `sublabel`(셸).** → **`sublabel` 문자열 채택.** 정형 필드는 타일마다 스키마에 필드가 쌓이고 셸이 다시 서식을 추측한다(셸 근거). 3000 폴리곤 기준 크기 증가도 작다. 엔진이 formatDistanceM·formatMetricValue를 써야 하므로, 엔진→ui 모듈 import가 계층상 허용되는지 먼저 확인한다(terrain openQuestion). 안 되면 두 함수를 중립 모듈로 옮기는 것까지 C1에 포함.
- **C. market의 "label을 자동값보다 먼저"** 요청은 C1로 흡수된다(값은 `sublabel`, featureLabelValue 추측은 `sublabel`이 있으면 건너뜀). A01 리뷰의 "label 대신 name + distanceM(셸이 서식)" 안도 `sublabel` 하나로 통일한다(경로 둘을 두지 않음). `distanceM`은 지시선 판정용으로 계속 싣는다.
- **D. merge 중복 제거 키에서 layer 빼기(amenity)** → **기각, 원천에서 중복을 없앤다.** A04+D09(D09 park 점 제거), A07+D25(D25 map 비움), A09+D23(maint_zone 제거), D19+D20(baseExcludes)로 각 타일이 해결한다. 키를 바꾸면 layer가 다른 별개 지물(D26 `featureId*1000+part` 등)이 합쳐질 위험이 있다.
- **E. totals 공식**: transit '(각 total − 표시 수) 합 + dedupe 후 표시 수' vs market '고유 개수 또는 max'. → **transit 공식.** 잘림과 중복을 둘 다 반영한다(양쪽이 모두 잘린 경우 숨은 중복이 두 번 세지는 상한은 남음, 주석으로 표시).
- **F. 대표점 처리: 셸에서 건너뛰기(regulation `polygonFallback`) vs 엔진에서 삭제(amenity openQuestion).** → **엔진에서 삭제.** 디자인 언어 §1 "화면=보고서, 같은 MapFigure"라 면을 못 그리는 화면이 있을 근거가 리뷰에 없다. 단 W0에서 대표점 소비처를 grep으로 확인하고, 있으면 F를 셸 건너뛰기로 바꾼다.
- **G. 자동 라벨 선정: 면적 상위(현행) / 값 내림차순(buildings) / 면적·가중치(regulation) / weight(terrain) / labelPriority(셸).** → `labelPriority` + 엔진 출력 순서 + 같은 문구 하나(1-3). 새 rank 필드 없음.
- **H. A05·A06 callout 파일**: market은 A05+A06 소유로 봤다 → 동의(소비처가 두 타일). **D22 wind-rose-figure**도 D22 소유(소비처 D22·내보내기뿐, simulation 리뷰).
- **I. 요약 카드 지도면에 최근접 지물**: 보류(셸 YAGNI 판단 유지).

### 2-3. 파일 단위 변경안과 순서
| 순서 | 파일 | 변경 | 크기 |
|---|---|---|---|
| 0 | (확인만) | 대표점 소비처, 엔진→ui import 허용, no_data 의미(엔진별), 결과 캐시 hash 영향 | S |
| 1 | `engine/summary.ts`, `ui/tile-view.ts` | 용도지역을 A12 지도 label 대신 metric/명시 필드로(**라벨 계약 전에 먼저**, 셸 지적: label 형식이 바뀌면 요약 칩이 조용히 깨짐) | S |
| 2 | `tile-result.ts` | C1 `name`·`sublabel`·`labelPriority`(3 스키마), C3 MapLine `color`(#RRGGBB regex)·`emphasis`, C4 `badges` — 모두 optional | S |
| 3 | `map-figure.tsx` | mapLabelText·screenLabels 3곳·automatic 필터(832) 계약 반영, 자동 라벨 정렬(1-3), 선 렌더 스타일·색·배지·화살표, 최근접 점선 조건, unnamedLabel, '선 표시', relevantRasterLegend null 견본, S02 제목 하드코딩 삭제 | L |
| 4 | `engine/tiles/common.ts` | candidate에 `name: h.name ?? null`(C2), polygonCandidate·lineCandidate에 extra 인자, makeTile 범례 엔트리 값, 점+면 같은 fid 경고 | M |
| 5 | `ui/map-layers.ts` | LayerStyle 선 필드 + 2-1 행 목록, highlight 우선 정렬, `*_nearest` 범례 제외 | M |
| 6 | `components/v2/map-box.tsx`, `board.module.css`, `tile-card.tsx` | 범례 A안, LayerSelect 위치, 라벨 회피 상자 | M |
| 7 | `engine/tiles/merge.ts` | C7 | M |
| 8 | `ui/tile-view.ts`, `ui/raster-image.ts`, `tile/cut-utils.ts` | basemap 노트, sun_hours 특례 삭제, isRecord·rasterRefs 통일 | S |
| 9 | `docs/design/v2-design-language.md`, `docs/v2/tile-agent-brief.md` | §3 노선색 예외(승인 시), §6 범례 A안·정렬, §8 라벨 계약·유형표, 새 절 '표식 규칙'(1-4), 대표점 계약 | S |

2·3·4는 한 커밋(C1+C2 동시 원칙). 5는 3과 같은 웨이브.

---

## 3. 타일별 작업표
의존: **W1** = 공용 계약(2-3의 2~7) 선행 필요, **—** = 지금 바로 가능. 크기 S(반나절 이하)/M(하루)/L(이틀 이상).

| id | 핵심 문제 | 제안 라벨 | 작업 항목 | 의존 | 크기 |
|---|---|---|---|---|---|
| site-summary | '확인 세대 0세대'(미확인을 0), 철도 무시, 용도지역을 지도 label에서 긁음 | 칩 `용도지역: …` | hh null→'세대 미확인', A01 `nearest_rail_m` 우선(3줄 상한), 용도지역 metric으로(**순서 1**), 거리 formatDistanceM, 중복 slice 제거, 지도면 대체 텍스트. 불완전 집계 재정의는 W0 no_data 확인 후 | — | S |
| A01 | 역·정류장 이름 없음, 최근접 라벨이 '직선 312m'뿐, 노선 위 샘플 점, 노선 단색 1.5 px, 의미 없는 칩, 범례 7 | 역 `강남역 · 2호선·신분당선`, 출구 `강남역 3번 출구 · 직선 312m`, 노선 `2호선` | sampleLine 삭제(—), 역·정류장 name, 최근접 sublabel+priority 2, 노선 label=subwayLineLabelText·color, 역 badges·출구 배지, 역-출입구 연결 키 정규화, 요약에 역명·호선, 칩 '전체/철도/버스'(id 'transit' 유지), walkSentence 죽은 분기, railLineHits 재사용 | sampleLine·요약은 —, 나머지 W1 | L |
| A10 | 선 위 샘플 점, '[개략]' 라벨 반복, 단계 분류 두 벌, totals 2배 주석, 문장 2중, 같은 칩 | 선 `위례신사선`/`· 공사 · 개략`, 역 `○○역 · 직선 420m` | sampleLine 삭제, 단계 분류 하나(D24 PLANNED_STAGES), 판단 문장 하나, 선 name(사업당 최장 조각), 계획역 name, 칩 삭제, 점선 스타일 | 삭제·칩 —, 라벨·점선 W1, totals는 C7 | M |
| D13 | 위계 7색 동일 굵기, 이름 미사용, 방법 설명 문장, 보행로가 '도로' 분모에 | `테헤란로 · 간선` | 간선·보조간선 name(이름별 최장 조각), 요약에 구성비 상위 2 + 최근접 간선 이름·거리, 굵기 4묶음, 보행 분리(사용자 결정 8), 최근접 간선 질의 좁히기(필터 없으면 보류) | 요약 —, 나머지 W1 | M |
| D28 | walk_net 녹색 1.5 px가 띠 경계를 묻음 | 면 라벨 없음 | 누적 면적 왕복 계산 삭제, sentenceFor 중복 확인, walk_net 0.75 px 반투명, km² 소수(사용자 결정 9) | 정리 —, 스타일 W1 | S |
| A02 | 학교명 없음, 모든 학구 면에 3단 라벨, 기본 보기에 학구 6종(범례 11) | `○○초등학교 · 직선 312m`, 대상 학구만 `고덕초 통학구역` | 학교 name, 학교급별 최근접 highlight+sublabel, 비대상 학구 label 없음, `baseExcludes:['school_zone']`, 문장 중복은 C7 judgment | baseExcludes —, 나머지 W1 | M |
| A03 | 최근접 '식료품 · 식료품 85m', 상호명 없음, 점선 누락 | `GS25 고덕점 · 직선 85m` | 상가 name, 최근접 sublabel, nearest 중복 계산 제거, 요약에 4군 최근접 거리 | 정리·요약 —, 라벨 W1 | S |
| A04 | A04·D09 같은 공원 점 2벌, 이름 소실, 지번 라벨 범람, 면+대표점, 같은 칩 | `○○근린공원 · 직선 312m`, 보행선 `○○근린공원까지 도보 420m · 5분` | D09 park 점 삭제, 지목 면 label 없음, 녹지지역 세분명, 면 대표점 삭제(W0 확인), 파트별 id, `baseExcludes:['green_space']`, 중복·죽은 지표 정리, '운영 공원'→'공원' | 대부분 —, 라벨 W1 | M |
| D10 | OSM 면 cls 미사용·'OSM 녹지 면', 다필지 대지 첫 필지만 | OSM 면 `name ?? cls 한글` | canopyCellStats 1회, 다필지 합, 죽은 분기·formulaVersion, OSM label, 요약에 대지 수관률. cls별 레이어는 후순위 | — (cls 레이어만 W1) | S |
| A05 | 범례 '미상' 속 빈 원 ≠ 실제 채운 원, mapNote 뜻 충돌, 기타 공동주택 범례 없음, 단지 수 두 가지 | `단지명 · 1,234세대` | 번호 원 준공 미상 hollow, mapNote 수정, STOCK_LEGEND 기타 추가, 아파트/오피스텔 수 분리, '확인 세대' 표기, MapFigure 경로 sublabel | callout은 —, sublabel W1 | M |
| A06 | mapNote '원천별 표시' 거짓, 경로별 색 의미 다름, 죽은 headline id | `단지명 · 2027년 3월 입주 · 512세대` | mapNote 수정(사용자 결정 10), headline id 수정, 죽은 metricFilter·label 삭제, linked 쿼리 정리(제거 또는 500개 청크) | — (sublabel W1) | S |
| A07 | 점 이름 없음, 상위 3곳만 라벨, 같은 칩, D25 중복 지도, 분위 경계 없음 | `단지명 · 850만원/㎡ · 12건` | PNU→단지명 조회 헬퍼(500개 청크), 모든 점 name+sublabel, D25 map 비움, 칩 삭제(D25→trade_location 저장값 확인), 범례 경계값 | 헬퍼·D25·칩 —, 라벨·범례 W1 | M |
| A08 | 월세 라벨 없음, 전세·월세 같은 좌표 겹침, q3 라벨 오류, 빈 문장 | `단지명 · 전세 650만원/㎡ · 12건` | A07 헬퍼 재사용, PNU당 점 하나(크기=전체 건수, 전세/월세는 2색 표식), '상위 25% 경계', 빈 경우·갱신 조건 문장, parcelPoints 재사용, quantile import | A07 헬퍼 선행, 라벨 W1 | M |
| D02 | 높이 없으면 이름 삭제, '테두리만' mapNote 거짓, 면+점 이중 | 건물명 | label=이름(높이 조건 제거), 점은 도형 실패분만, mapNote·카탈로그 문구(사용자 결정 5), back_buildings 중복 확인 | — | S |
| D03 | 범례 10항목, 미상이 헤더 1위가 될 수 있음, status 고정 | `건물명 · 공동주택` | headlineFor(미상 제외), status에 retirement·invalidGeometry, 문장에 최다 용도, 미상 빗금 | 헤더·status —, 빗금 W1 | S |
| D04 | 연도 미전달, 면+점 이중 | `건물명 · 1994년` | sublabel 연도, 점 도형 실패분만, 중복 열 검사 삭제, 헤더 '2000년 이전 준공' + count 합 재계산 | 점·정리 —, 라벨 W1 | S |
| D05 | '건물명 · N층' 경로 없음, 3벌 병합으로 3000 상한 초과·저층 누락, 문장 3개, 넓은 건물에 라벨 | `건물명 · 18층`(층수 없으면 `· 48m`) | 건물당 면 1개로 병합 구조 변경, 문장 하나, headline(미상·1층 가정 제외 또는 '35m 이상 a동'), name+sublabel 층수, 층수 내림차순 출력·상위 priority 2, tall_lt35 회색, d06/d07 threshold 함수 하나 | W1 (C1·C7) | L |
| D16 | 상대 5분위 범례, 입력 동수 과다, 무관한 1층 가정 한계 | 범례 `12~25동/㎢` | rows.length→points.length, assumed_one_floor 제거, KDE_BANDWIDTH_M 사용·결과 수치 문장, dens_0 채움 없음·'건물 없음', 범례 경계값 | 엔진 —, 범례 W1 | S |
| A09 | 면 2장+점 2개 겹침, 단계 2벌, 이름 없음 '이름 없음 미확인', 원천 id 불일치 | `상계5구역 · 조합` | 기본 보기 d23 단계 면 하나(사용자 결정 11), a09 points/polys 제거, SOURCES에 mzone_*, name 구역명(폴백 typeLabel), 교차 면적순 라벨, rosterOnly zone_area missing, 단계 지표 하나, 문장 하나, 죽은 분기 | 구조 —, 라벨 W1 | M |
| A12 | 0% 분류가 문장에, 같은 칩, 라벨 '세분명 · 분류' 반복 | `제2종일반주거지역 · 34%`, 대지 `대지 · 제2종일반주거지역` | presentClasses, 칩 삭제, D08 judgment·중복 지표 빼기, 최대 조각에만 name, zone_center 점 삭제, 죽은 headline id. **site-summary 순서 1 이후** | 정리 —, 라벨은 순서 1 + W1 | M |
| D11 | 종류명 라벨 반복, 면+점, 면적 쉼표 없음 | `고덕지구단위계획구역 · 2019 고시` | 대표점 삭제, remark A8/A9에서 구역명(실데이터 확인 필요, confidence low), 면적 fmt/ha, 건수=교차분, fill_code_pct 0건 missing, D12와 공통 헬퍼 | 삭제·서식 —, 라벨 W1 | M |
| D12 | 선형 시설을 점 사슬로(3000 예산 소진), 방재 범례 누락, 라벨 꼬리 | `근린공원 · 1.2ha`, `소로2류 · 340m` | lineCandidate로 선, 대표점 삭제, 라벨 name+sublabel, headline 'back_area_', 문장 서식·건수, 방재 스타일(C10) | 선 전환 —, 라벨·방재 W1 | M |
| D15 | 블록 면적이 지도에 없음, 구간 이름 불일치, 빈 문장 | 호버 `1.34ha` | sublabel 면적(priority 0), 구간 라벨 '0.5ha 미만' 통일, 문장 수치화, status 단순화 | 문구 —, 라벨 W1 | S |
| D19 | parcel+lot_* 이중 면, '지목 기본'인데 지목 색 없음, 라벨 없음 | `123-4 · 대지` / `123-4 · 248㎡` | `baseExcludes:['parcel_size']`, 지목 그룹 레이어(사용자 결정 7), 지번 name·지목 sublabel, 중복 지표, ROAD_WATER_JIMOK 한 글자 기준, 상위 지목 문장, 측정 루프 공유 | baseExcludes·정리 —, 레이어·라벨 W1 | M |
| A11 | 같은 셀이 점(상대 5분위)+면(절대 구간), 같은 색 다른 뜻, 범례 12, 같은 칩 | 호버 `12,345명` | pop_grid_q* 점 제거(사용자 결정 6), 면 sublabel 인구, 칩 삭제, D27 문장 생략, 한계 문구 하나, share_dens 라벨 구간 문구·0% 숨김, 연도 하드코딩, 셀 수집 공유 | 대부분 —, 라벨·범례 행 W1 | M |
| D01 | 항공사진 위 '지물 없음', '촬영시기 미확인' 6번 | 없음 | 문장 축약, 최대 줌 배지 제거 검토, headline id 정리, 노트는 C10 | — | S |
| D17 | 지표 라벨에 내부 id, 모든 등고선 라벨, 상대고·절대고 혼동 | 계곡선 `표고 35m` | 지표 라벨 범례 문구, 25 m 배수만 label(raster-grid 호출처 확인), 문장에 중심 표고, median·percent 공유, emphasis 굵기 | 라벨 문구 —, 굵기 W1 | M |
| D18 | 지표 라벨 내부 id, 전문어 문장 | 범례 `경사 0~5°` | 지표 라벨, 문장 '15° 이상 x%', 죽은 import, fill obs 통일 | — | S |
| S01 | 문장에서 1층 가정이 확인분에 섞여 읽힘, 범례 aria-hidden | (후속) hover `건물명 · N층` | 문장 분리 표기, spreadPct 화면/보고서 차이 확인, live 루트 role=img+aria-label, (후속) SceneBuilding name | — | S |
| S02 | 일조 구간 3벌, '수광면' 중복 범례, d21 죽은 코드 | 범례 `동지 일조시간(시간)` | 16칸 하나, sun_face 대지 계열, 날짜 상수 한 곳, d21 삭제 확인, '확보 지면 %' | 엔진 —, 팔레트 C9 | S |
| S03 | 'annual 주풍향' 영문, 1.5 이상 누락, 유입 방향 안 그림, 색 1.2 포화 | 선 `주풍향 북서(NW) 유입` | 문장 한글·합산·단위, 유입 MapLine, 범례 측정 구간, headline id, cut 정리 | 문장 —, 화살표·팔레트 W1 | M |
| S04 | 회색 셀 설명 없음, 범주 어휘 2벌, 영문 계절 | 범례 견본 `바람 입력 없음`·`건물` | limitation 한글, 문장에 범주·그늘, 어휘 통일(C9), RasterMap import | 문장 —, 범례 W1 | S |
| D22 | 눈금 '21%·15%' 겹침, 비정수 눈금, 정온 원 넘침, 영문 계절 | 눈금 nice 간격 | windRoseLayout이 눈금 박스 충돌 검사, nice 간격·compact 2개, 정온 원 축소, 계절 한글, headline '최빈 풍향 북북동(NNE) 14%', 죽은 import·쿼리 중복, 회귀 테스트 | — (D22 소유) | M |
| D29 | limitation '100m' 오기, 대지 SVF 미사용, '건물 마스크' 라벨 | hover `건물명 · N층` | 반경 50 m, 문장·headline 대지 vs 반경, 범례명(C10), quantile 공유, 건물 name+sublabel | 문장 —, 라벨 W1 | S |

---

## 4. 구현 웨이브
| 웨이브 | 내용 | 병렬 |
|---|---|---|
| **W0 확인** | 2-3 순서 0의 4개 확인(코드 변경 없음). 대표점 소비처 결과로 판정 F 확정 | 1명 |
| **W1a 선행 단건** | site-summary 용도지역 metric화(2-3 순서 1) | 1명 |
| **W1 공용 계약** | 2-3 순서 2~8. 한 담당이 순서대로(공용 파일 충돌 방지). 2·3·4 한 커밋. 하위 호환이라 기존 타일은 바뀌지 않음 → 회귀 테스트로 확인 | 1명 |
| **W1과 병렬: W2a 계약 무관 정리** | 표의 '—' 항목 전부. 공용 파일을 건드리지 않는다(타일 폴더·엔진 파일만). 묶음: ① transit(A01 sampleLine·요약, A10 삭제·단계·칩, D13 요약, D28) ② amenity(A02 baseExcludes, A03, A04 중복 제거, D10) ③ market(A05·A06 callout, A07 헬퍼·D25·칩, A08 정리) ④ buildings(D02, D03, D04, D16 엔진) ⑤ regulation(A09 구조, A12 정리, D11·D12 삭제·선 전환, D15, D19 정리) ⑥ terrain(A11, D01, D17·D18 라벨) ⑦ simulation(S01~S04 문장, S02, D22 전부) | 7묶음 병렬 |
| **W2b 계약 적용** | W1 완료 후 각 타일의 name·sublabel·labelPriority·스타일·배지·범례 값. 같은 7묶음 병렬. D05는 C7 merge 변경 필요라 buildings 묶음 마지막 | 7묶음 병렬 |
| **W3 마무리** | tile-layers 타일 고유 매처 삭제(칩 삭제가 끝난 뒤), 디자인 언어·브리프 개정(2-3 순서 9), 1칸·2칸 카드 실캡처 검수(A01 크기 확정, D22 정온 원, 래스터 라벨 회피 상자) | 1명 |
| **W4 데이터(별도 승인)** | 건물 이름 적재(juso 'X X' 중복·'.' 정리 → 대장 이름 보충은 표본 측정 후), rtms apt_name(PNU 조인 실패가 많을 때만) | 승인 후 |

묶음 간 공유 파일 주의: map-layers.ts·tile-layers.ts·merge.ts·common.ts는 W1/W3 담당만 수정. A07 헬퍼는 market 묶음 안에서 A08보다 먼저.

---

## 5. 사용자 결정 필요 항목
| # | 질문 | 선택지 | 추천 |
|---|---|---|---|
| 1 | 범례 배치 | A 접이식+높이 상한 / B 지도 아래 띠 / C 칩 순환 | **A** (파일 1개, §6 유지, 항목 수 감축과 함께면 1칸 카드에서 충분. 부족하면 B로 재론) |
| 2 | 지하철 공식 노선색(원천 rail_line.color·lineColors)을 '색은 map-layers.ts 한 곳에서만'(§3)의 예외로 허용 | 허용 / 레이어 단색 유지 | **허용** — 원천 데이터 고유값만 예외, 범례는 '철도 노선' 한 항목(다색 견본). 단색이면 호선 구분이 불가능해 문제 2가 남음 |
| 3 | A01 기본 크기 | 1칸 유지 / 2 | **2** (범례 수정 후 1칸 실캡처로 최종 확인) |
| 4 | D05 기본 보기 라벨 | 실제 층수 `건물명 · 18층` / 구간 `· 15~25층` | **실제 층수** (사용자 원칙 '건물명 · 층수') |
| 5 | D02 '높이 미상은 테두리만' | 실제 구현(테두리 레이어 추가) / 문구 삭제 | **문구 삭제** (지금 효과는 이름 삭제뿐) |
| 6 | A11 점(상대 5분위) 레이어 | 삭제 / '밀도 구간' 보기에만 | **삭제** (셀 4~9개라 상대 등급이 무의미, 칩도 사라짐) |
| 7 | D19 지목 그룹 수 | 대지·도로·전답·임야·하천구거·기타 6개 / 더 적게 | **6개** (카드 알약은 상위 3 + `+n`) |
| 8 | D13 '도로 중심선 총길이'에서 보행·자전거 분리(지표 값·id 변경, 기존 결과와 달라짐) | 분리 / 유지 | **분리** (지표 이름과 의미가 다름) |
| 9 | 면적 1 km² 이상 정수 반올림(§4) | 유지 / km² 소수 1자리로 개정 | **km² 소수 1자리** (D28 5·10·15분 차이가 '1 km²'로 사라짐) |
| 10 | A06 원천 구분 | 점 모양으로 구분 / mapNote만 실제에 맞게 | **mapNote만** (YAGNI) |
| 11 | A09 기본 보기 | 반경으로 자른 단계 면(d23) / 전체 구역 경계(a09) | **자른 단계 면** (중복 제거, 단계 색 의미 있음) |
| 12 | D22 카드 방위 글자 | 영문 8방위 유지 + 요약 한글 병기 / 한글 | **영문 유지 + 한글 병기** |
| 13 | 건물 이름 재적재(W4) | juso 중복 정리만 / + 대장 이름 보충 | **juso 정리 먼저**, 대장 보충은 채움률 표본 측정 후 |

Judge(오케스트레이터) 결정으로 넘기는 항목(사용자 질문 아님): D24·D23·D20·D08·D27 흡수 방식(merge 유지 + judgment 'base' 권장), A07/A08 단지명 PNU 조인(권장) vs 재적재, S01 spreadPct 차이, d21 삭제, 역 축 막대(보류 권장), 요약 카드 지도면 지물(보류 권장), 엔진→ui import 허용.
