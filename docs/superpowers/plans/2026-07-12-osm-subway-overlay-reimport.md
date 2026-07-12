# OSM 지하철 오버레이 재이식 계획 (집GPT 표시 방식 → main)

## 배경

- 2026-05-27 codex 브랜치(d095d8e)에서 집GPT(13-jipgpt-main)의 지하철 표시 방식(역사도식선·노선·출입구 커넥터·라벨)을 이식했으나, 그 브랜치는 4/19 분기라 main과 발산 → 재이식 필요.
- main의 현 지하철 표시: 라이브 Overpass `subwayRoutes` 폴리라인 + "naver" 마커 스타일일 때 역 위치에 두꺼운 station bar 세그먼트(map-view.tsx 704-815행). 출입구·노선라벨·전국 정제 역축 데이터 없음.
- 소스 코드 위치(참조용, 이 저장소의 git에서 접근):
  - `git show codex/siteanalysis-subway-osm-coordinates:src/components/map-view.tsx` (오버레이 로직 원본, 1995행 중 약 45~1460행에 타입·상수·헬퍼·`addOsmSubwayOverlay`)
  - `git show codex/siteanalysis-subway-osm-coordinates:src/app/globals.css` (`.site-subway-*` 클래스, 4ec1b09 대비 +123행)
- 데이터: `public/data/osm-subway.json` — **이미 이 브랜치에 복사 완료** (4.7MB; keys: stations 686, entrances 4351, lines 727, station_axes 854).

## 목표

`layers.subway`가 켜져 있고 OSM 데이터가 로드되면 지도에 집GPT식 오버레이를 그린다:
1. 노선 폴리라인(line_ref 있는 노선 굵게 3.6/0.66, 없는 노선 얇게 1.8/0.22, 노선색)
2. 회전된 노선 라벨 칩(divIcon, `osmSubwayLineLabelPlacement`)
3. 역사도식선(흰 캐싱 13.5 + 노선색 9.0, station_axes 기반, 곡선 매칭 시 round cap)
4. 역명+노선 배지 마커(`subwayStationIconHtml`)
5. 출입구 마커 + 역축까지 커넥터 선(흰 3.2 + 노선색 1.2)

데이터 로드 실패 시(fetch 실패·JSON 파싱 실패) **기존 main 렌더링(naver station bar 등)을 그대로 폴백**으로 사용한다.

## 구현 태스크

### T1. 신규 모듈 `src/lib/osm-subway-overlay.ts`

codex 브랜치 map-view.tsx에서 오버레이 관련 코드를 **그대로 추출**해 독립 모듈로 만든다 (main map-view를 800줄 불리지 않기 위함):

- 타입: `SubwayMapResponse`, `SubwayMapStation/Entrance/Line/StationAxis` 등 (codex 원본의 타입 정의 추출)
- 상수: `SUBWAY_ENTRANCE_CONNECTOR_MAX_DISTANCE_M`, `SUBWAY_STATION_AXIS_*` 4종
- 순수 함수 전부: `normalizedSubwayStationName`, `isPublicSubwayLineRef`, `isPublicSubwayAxis`, `dedupeSubwayStationAxes`, `representativeSubwayLines`, `axisForStation`, `stationAxesForStation`, `axisLatLngs`, `axisTouchesBounds`, `subwayAxisShapeTouchesBounds`, `subwayStationAxisShape`, `subwayGeometryLines`, `subwayCoordToLatLng`, `subwayLineColor`, `subwayLineLabelText`, `osmSubwayLineLabelPlacement`, `displayableSubwayEntrances`, `subwayEntranceConnector`, `nearestPointOnAxis`, `entrancesForAxis`, HTML 빌더(`subwayStationIconHtml`, `subwayLineLabelHtml`, 출입구 아이콘 HTML)
- `export function addOsmSubwayOverlay(L, map, layerGroup, config: AnalysisConfig, data: SubwayMapResponse)` — codex 1219행 원본 로직 그대로
- haversineDistance는 main의 `src/lib/geo.ts` 것을 import (중복 정의 금지)
- Leaflet 타입은 codex 원본과 동일하게 `typeof import("leaflet")` 방식 유지

**원칙: 로직 개변 금지.** 집GPT와 동일한 look을 보존하는 것이 목적이므로 상수·스타일 값을 바꾸지 않는다. TypeScript strict 통과를 위한 최소 수정만 허용.

### T2. `src/components/map-view.tsx` 통합 (main 버전 수정)

1. state 추가: `const [subwayMapData, setSubwayMapData] = useState<SubwayMapResponse | null>(null);`
2. 마운트 시 1회 fetch (codex 1888-1912행 패턴). **경로는 반드시 basePath 반영**: `src/lib/data-provider.ts`의 `withBase()`와 동일 패턴 사용 — `const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "/site";` → `fetch(\`${BASE_PATH}/data/osm-subway.json\`, { cache: "force-cache" })`. (data-provider의 withBase가 export되어 있으면 import, 아니면 export 추가해 재사용)
3. `updateMarkers`(main 644행 부근 useCallback) 내 지하철 분기 수정:
   - `layers.subway && subwayMapData` → `routeLinesLayer.clearLayers()` 후 `addOsmSubwayOverlay(...)` 호출, **기존 naver station bar·subwayRoutes 폴리라인 경로는 건너뜀** (이중 표시 방지. stationBarsPane 레이어도 클리어)
   - `layers.subway && !subwayMapData` → 기존 코드 그대로 (폴백)
   - deps 배열에 `subwayMapData` 추가
4. 오버레이는 bounds 의존적이므로 지도 이동/줌 시 재호출 확인: main에 이미 moveend/zoomend에 updateMarkers를 다시 부르는 effect가 있는지 확인하고, 없으면 codex 1973행 패턴대로 추가.
5. 기존 `SubwayStationStyle` 컨트롤·상태는 삭제하지 않는다 (폴백에서 여전히 사용).

### T3. `src/app/globals.css`

codex diff의 `.site-subway-station-wrap`, `.site-subway-station`, `.site-subway-station-badge`, `.site-subway-station-name`, `.site-subway-line-label-wrap`, `.site-subway-line-label`, `.site-subway-entrance-wrap`, `.site-subway-entrance` 등 +123행을 그대로 추가. (`git diff 4ec1b09..codex/siteanalysis-subway-osm-coordinates -- src/app/globals.css`)

### T4. 검증

1. `npm run lint` (= tsc --noEmit) 통과
2. `npm run dev` 후 `http://localhost:3000/site` 에서 (basePath 주의):
   - 서울 시내 좌표(예: 기본값 또는 청와대)로 분석 실행 → 지도에 도식선·노선라벨·출입구 커넥터 렌더 확인
   - 네트워크 탭에서 `/site/data/osm-subway.json` 200 확인 (404면 basePath 처리 실패)
   - 줌인/줌아웃·지도 드래그 시 오버레이 갱신 확인
   - `public/data/osm-subway.json`을 임시로 리네임 → 새로고침 → 기존 naver 표시로 폴백하는지 확인 후 원복
3. PPT 미리보기 열어 지하철 슬라이드가 기존과 동일하게 나오는지 확인 (오버레이는 web map 전용; PPT 파이프라인 `routePositions`는 건드리지 않음)

## 금지 사항

- `src/lib/ppt-*`, `src/lib/server/*`, PPT 파이프라인 수정 금지
- 기존 subwayRoutes 라이브 파이프라인 제거 금지 (폴백 + PPT용으로 유지)
- osm-subway.json 데이터 수정 금지
- 오버레이 시각 상수(굵기·투명도·색) 개변 금지

## 커밋

작업 완료 후 이 브랜치(feature/osm-subway-overlay-reimport)에 논리 단위로 커밋 (데이터 파일 커밋 포함, push는 하지 않음).
