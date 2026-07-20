# 전국 정비사업 목록·경계 연동 설계

작성일: 2026-07-20

상태: 사용자 승인 완료 (2026-07-20)

관련 조사: `.omo/ulw-research/20260720-110058/SYNTHESIS.md`

공식 원천:

- 전국 통합 데이터: https://www.data.go.kr/data/15160169/fileData.do
- 전국 표준 API: https://www.data.go.kr/data/15155703/standard.do
- 정비구역 SHP: https://www.data.go.kr/data/15146864/fileData.do
- 재개발구역 SHP: https://www.data.go.kr/data/15146866/fileData.do
- VWorld WMS/WFS 안내: https://www.vworld.kr/dev/v4dv_wmsguide2_s001.do

## 1. 목표

현재 서울·부산에 한정된 정비사업 검색을 전국으로 확장한다. 분석 대상지 주변의 공식 정비구역을 지도 폴리곤으로 표시하고, 사업명·유형·추진단계·시행자·세대수·면적 등 공식 속성을 사이드바·팝업·분석·PPT에 일관되게 제공한다.

사용자는 공공데이터포털 API 키를 발급받았고, 국토교통부 공간파일의 비상업적 이용, 서버 저장, SHP→GeoJSON 변환, 좌표계 변환 및 웹 지도 표시를 허락받았다. 허락 증빙과 원문 데이터는 저장소에 커밋하지 않는다.

## 2. 범위

### 포함

- 국토교통부 전국 도시정비사업 통합 데이터 `15160169`를 전국 기본 목록으로 사용
- 전국재개발재건축정비사업표준데이터 `15155703`을 제공 지역의 상세 보강원으로 사용
- VWorld/국토교통부 `30335` 정비구역(`UD602`) 및 `30336` 재개발구역(`UD501`) SHP를 공식 경계 원천으로 사용
- SHP를 서버 배치에서 EPSG:4326 GeoJSON Polygon/MultiPolygon으로 변환
- 분석 중심점·반경과 폴리곤의 실제 공간 교차로 주변 사업 검색
- 기존 서울 `upisRebuild`와 부산 정비사업 API를 상세 보강원으로 유지
- 데이터 출처·기준일·경계 확인 상태를 UI와 PPT에 표시

### 제외

- VWorld 로그인·다운로드 절차 자동화
- 지자체 고시 PDF·이미지의 자동 벡터화
- 이름 유사도만으로 사업과 경계를 확정하는 결합
- 공간파일이 법적 효력을 가진다고 표현하는 기능
- 사용자 마이페이지에서 공공데이터 키를 입력·저장하는 기능

## 3. 데이터 원천과 우선순위

| 우선순위 | 원천 | 역할 | 주요 필드 | 갱신 |
| --- | --- | --- | --- | --- |
| 1 | 국토부 `15160169` | 전국 기본 목록 | 시도, 시군구, 구역명, 추진단계, 유형, 시행자, 예정세대수 | 연간 |
| 2 | 국토부/VWorld `30335`, `30336` | 공식 경계 | Polygon/MultiPolygon, 공간 분류, 원본 식별자 | 변경 시·지역별 파일 |
| 3 | 표준 API `15155703` | 제공 지역 상세 보강 | 총면적, 용도지역, 건폐율, 단계, 세대수, 지정일, 관리기관 | 기관 등록·월 병합 |
| 4 | 서울 `upisRebuild` | 서울 상세 보강 | 사업 코드, 단계, 주소, 면적, 고시 링크 | 서울 원천 기준 |
| 5 | 부산 정비사업 API | 부산 상세 보강 | 주소, 면적, 세대수, 용적률, 건폐율, 시공·설계 정보 | 부산 원천 기준 |

동일 사업이 여러 원천에 있을 때 경계는 공식 공간파일을 우선하고, 속성은 지역 상세 원천 → 표준 API → 전국 기본 목록 순으로 채운다. 각 필드의 원천과 기준일은 병합 후에도 보존한다.

## 4. 시스템 구조

### 4.1 공간파일 배치 파이프라인

원본 ZIP은 `data/maintenance/raw/`에 두고 Git에서 제외한다. 빌드 스크립트는 다음 순서로 처리한다.

1. ZIP 내부 SHP·SHX·DBF·PRJ 구성 확인
2. PRJ의 실제 좌표계를 읽고 허용 목록(EPSG:5186, EPSG:2097 및 공식 WKT로 식별되는 동일 계열)과 대조
3. Polygon/MultiPolygon을 EPSG:4326으로 재투영
4. 링 폐합, 유한 좌표, 위·경도 범위, 빈 geometry, self-intersection을 검증
5. 원본 feature ID, 분류코드, 명칭, 행정구역, 면적, 원본 CRS, 원천 URL, 기준일, 변환시각을 보존
6. 전체 원본을 공개하지 않고 서버 전용 `data/maintenance/processed/boundaries.geojson`과 메타데이터를 생성
7. 오류 feature는 별도 quarantine 보고서에 기록하고 운영 artifact에서는 제외

원본 PRJ가 없거나 좌표계를 확정할 수 없으면 추측하지 않고 전체 변환을 실패시킨다. 홀과 멀티폴리곤은 보존하며 단일 외곽선으로 평탄화하지 않는다.

원본과 처리 artifact는 모두 Git에서 제외한다. 배포 절차는 원본 ZIP으로 처리 artifact를 생성한 뒤, 해당 artifact만 애플리케이션의 서버 데이터 디렉터리에 업로드한다. Next.js 정적 공개 디렉터리에는 두지 않으며 전체 파일을 내려받는 라우트도 만들지 않는다.

### 4.2 전국 속성 공급자

서버 공급자는 `DATA_GO_KR_API_KEY`를 사용해 `15160169`과 `15155703`을 호출한다. 키는 서버 환경변수에만 두며 API 응답이나 브라우저 번들에 포함하지 않는다.

- `15160169`: 전국 기본 레코드를 페이지 단위로 수집하고 기존 POI 캐시를 사용
- `15155703`: 시도·시군구 필터를 적용해 상세 속성을 보강
- 키 누락·만료·한도 초과는 빈 성공으로 숨기지 않고 source status `failed`와 사용자 경고로 전달
- 운영 중 원천 장애가 발생하면 유효한 stale cache를 사용하되 기준시각을 표시

현재 개발 프로세스에는 `DATA_GO_KR_API_KEY`와 `SEOUL_OPEN_API_KEY`가 등록되어 있지 않다. 구현·운영 QA 전에 로컬 `.env.local`과 배포 서버 secret에 사용자가 직접 등록한다.

### 4.3 공간 검색

서버는 처리된 경계 artifact를 프로세스 내에서 한 번 읽고 mtime이 바뀔 때만 다시 로드한다. 검색은 다음 단계로 수행한다.

1. 폴리곤 bbox와 분석 반경 bbox로 후보 축소
2. 분석 반경 원과 Polygon/MultiPolygon의 실제 교차 판정
3. 중심점이 경계 내부면 거리 `0m`
4. 외부면 중심점에서 경계까지의 최단 거리를 계산
5. 반경 밖 feature 제외

폴리곤 기반 검색은 NCP 지오코딩 키에 의존하지 않는다. 주소만 있는 서울·부산 레코드의 점 검색에는 기존 NCP 지오코딩을 유지한다.

## 5. 사업·경계 결합 규칙

결합은 신뢰도 순서로 수행한다.

1. 공식 공통 식별자가 양쪽에 존재하면 exact match
2. 서울은 `NTFC_SN`·`WTNNC_SN` 같은 결정고시 식별자 exact match
3. 공통 ID가 없으면 정확히 정규화된 `(시도, 시군구, 구역명)`이 양쪽에서 각각 유일할 때만 후보 생성
4. 면적이 양쪽에 있으면 차이가 5% 이내여야 확정
5. 지정일·기준일이 있으면 시간상 모순이 없어야 확정
6. 하나라도 복수 후보·행정구역 불일치·면적 불일치가 있으면 결합하지 않음

fuzzy name match는 검색 보조나 진단 보고서에만 사용하고 `boundary_status="confirmed"`의 근거로 사용하지 않는다. 결합되지 않은 공식 폴리곤은 별도 경계 feature로 검색할 수 있지만 사업 단계·세대수와 합치지 않는다.

서버 내부에는 `MaintenanceBoundaryFeature`를 별도로 둔다. 안전하게 결합된 feature만 기존 사업 레코드에 붙인다. 미결합 feature에 공식 명칭이 있으면 `source="molit_spatial"`, `type="other"`, `stage="unknown"`, `boundary_status="unmatched"`인 경계 전용 결과로 투영한다. 공식 명칭조차 없는 feature는 사용자 결과에서 제외하고 quarantine 보고서에 남긴다.

## 6. 도메인 계약

`MaintenanceSource`에 다음 값을 추가한다.

- `molit_integrated`
- `public_standard`
- `molit_spatial`

경계는 표준 GeoJSON 좌표 순서 `[lng, lat]`를 사용하는 별도 타입으로 변경한다.

```ts
type MaintenanceBoundary =
  | { type: "Polygon"; coordinates: readonly (readonly (readonly [number, number])[])[] }
  | { type: "MultiPolygon"; coordinates: readonly (readonly (readonly (readonly [number, number])[])[])[] };
```

`MaintenanceProject`에는 다음 메타데이터를 추가한다.

- `boundary?: MaintenanceBoundary`
- `boundary_status: "confirmed" | "unmatched" | "unavailable"`
- `source_updated_at?: string`
- `boundary_source_url?: string`
- `boundary_source_id?: string`
- `boundary_retrieved_at?: string`
- `boundary_original_crs?: string`
- `implementer?: string`
- `designation_date?: string`
- `land_use_zone?: string`
- `management_agency?: string`

원천별 필드 provenance는 서버 내부 병합 레코드에 유지하고, 사용자 표면에는 대표 출처와 기준일을 표시한다.

`PoiSourceId`에는 `maintenance_attributes`, `maintenance_boundaries`, `maintenance_seoul`, `maintenance_busan`을 추가한다. API 라우트는 네 원천을 독립적으로 resolve/cache한 뒤 병합하여, 한 원천의 장애가 다른 원천의 성공 상태를 가리지 않게 한다.

## 7. 사용자 화면

### 지도

- 공식 경계를 분홍색 반투명 Polygon/MultiPolygon으로 표시
- 홀을 비워서 표시하고 여러 조각을 하나의 사업으로 선택 가능하게 처리
- 경계만 있고 속성이 결합되지 않은 경우 `공식 경계 · 사업정보 미결합`으로 표시
- popup에 사업명, 유형, 단계, 시행자, 예정세대수, 면적, 지정일, 출처, 기준일, `참고용` 문구 표시

### 사이드바·분석

- 주변 정비사업 수, 총 예정세대수, 유형·단계별 수, 공식 경계 확인 수 표시
- 상세 목록에는 구역명, 유형, 단계, 시행자, 예정세대수, 면적, 거리, 경계 상태 표시
- 단계 점수 가중치는 이번 범위에서 변경하지 않음
- `confirmed`만 경계 확인 수에 포함하고 `unmatched`·`unavailable`은 제외

### PPT

- 구역명, 유형, 단계, 시행자, 예정세대수, 면적, 거리, 경계 상태, 출처·기준일을 표에 포함
- 지도에 공식 경계를 표시하고 범례에 `정비사업 공식 경계(참고용)` 표기
- 경계가 없는 사업을 임의 원형이나 필지 경계로 대체하지 않음

## 8. 오류 처리와 운영 가시성

- 전국 API 실패와 공간 artifact 실패를 독립 source status로 보고
- 공간 artifact가 없거나 손상돼도 전국 목록은 행정구역 수준으로 제공하고 경계는 `unavailable`
- 전국 API가 실패해도 공간 경계는 표시하되 속성 미결합 상태를 명시
- 변환 보고서에 입력 파일 해시, feature 수, 성공·제외 수, CRS, bbox, 기준일 기록
- 이전 artifact 대비 feature 수가 20% 이상 변하면 자동 교체를 중단하고 검토 요구
- 데이터 페이지와 PPT에 출처, 기준일, `법적 효력 없는 참고자료` 문구 표시

## 9. 검증

### 자동 검증

- 전국 API 필드 정규화·페이지네이션·키 오류·stale cache 테스트
- SHP Polygon/MultiPolygon·홀·좌표계 변환·잘못된 PRJ·깨진 geometry 테스트
- exact ID 결합, 유일 이름 결합, 면적 5% 경계, 복수 후보 거부 테스트
- 반경 내부·교차·외부·폴리곤 내부 중심점 거리 테스트
- 기존 서울·부산 병합 우선순위와 동명 사업 회귀 테스트
- UI/PPT의 `confirmed/unmatched/unavailable` 집계 테스트
- `tsc --noEmit`, 관련 스크립트 테스트, production build 실행

### 수동 QA

- 서울·부산·비수도권 각 1개 위치에서 실제 API 응답과 지도 경계를 공식 원본과 대조
- 데스크톱과 모바일 화면에서 멀티폴리곤·홀·popup·사이드바 확인
- PPT 미리보기와 내보낸 파일에서 경계·범례·출처·기준일 확인
- API 키가 브라우저 네트워크·응답·번들에 노출되지 않는지 확인
- 키 누락, API 장애, 공간 artifact 누락 시 사용자 경고와 fallback 확인

## 10. 완료 기준

- 전국 어느 시도에서도 공식 기본 목록을 조회할 수 있다.
- 처리된 경계가 있는 위치에서는 NCP 키 없이 반경 내 공식 폴리곤이 표시된다.
- 확정 근거가 없는 사업·경계는 결합되지 않고 `미결합` 또는 `경계 미확인`으로 표시된다.
- 기존 서울·부산 상세정보가 소실되지 않는다.
- 지도·사이드바·분석·PPT가 동일한 사업 수와 경계 상태를 사용한다.
- 모든 자동 검증과 production build가 통과하고, 실제 브라우저·PPT QA 증빙이 남는다.

## 11. 배포 전 사용자 준비사항

1. `DATA_GO_KR_API_KEY`를 로컬과 배포 서버 secret에 등록
2. 서울 상세 보강까지 운영 검증하려면 `SEOUL_OPEN_API_KEY`도 서버 secret에 등록
3. 허락받은 VWorld/국토부 원본 SHP ZIP을 `data/maintenance/raw/`에 배치
4. 이용허락 회신은 저장소 밖에서 보관
