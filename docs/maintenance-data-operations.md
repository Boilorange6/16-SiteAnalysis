# 정비사업 데이터 운영 절차

## 개발 화면 검사 도구

- 기본 개발 서버는 `npm run dev`로 실행하며 React Grab/Scan을 로드하지 않는다.
- 화면 검사 도구가 필요할 때만 `npm run dev:inspect`를 사용한다. 이 모드는 고정 HTTPS 버전의 React Grab/Scan과 필요한 개발 전용 CSP 허용 목록을 함께 활성화한다.
- 프로덕션 빌드에는 검사 스크립트와 외부 검사 도구 CSP 출처가 포함되지 않는다.

## 입력물과 비밀값

- 공공데이터포털 키는 로컬 또는 배포 환경의 `DATA_GO_KR_API_KEY`에만 설정한다. 서울 열린데이터광장 키는 `SEOUL_OPEN_API_KEY`에 설정한다. `.env.example`에는 이름만 보관하며 실제 키는 절대 Git에 추가하지 않는다.
- 사용 권한을 확인한 SHP ZIP만 `data/maintenance/raw/`에 배치한다. 원본 ZIP과 처리 결과는 라이선스 입력물이므로 Git에 추가하지 않는다.
- 키 회전(key rotation) 시에는 제공자 콘솔에서 기존 키를 폐기한 뒤 환경 변수 값을 갱신하고, 배포 환경을 재시작한다. 키가 없거나 호출이 실패하면 해당 데이터 소스는 `failed` 상태를 보고하며 샘플을 생성하거나 반환하지 않는다. 특히 `SEOUL_OPEN_API_KEY`가 없으면 `maintenance_seoul`은 `failed`여야 한다.

## 경계 빌드

각 ZIP 옆에는 취득 시점과 원천을 기록한 `<ZIP 파일명>.metadata.json`을 함께 둔다. 예를 들어 `UD602.zip`의 sidecar는 `UD602.zip.metadata.json`이다. ZIP을 복사하거나 이동할 때 sidecar도 함께 복사하며, 파일 수정 시각은 출처 메타데이터로 사용하지 않는다.

```json
{
  "schema_version": 1,
  "retrieved_at": "2026-07-20T10:30:00+09:00",
  "source_updated_at": "2026-07-18",
  "source_url": "https://www.data.go.kr/data/15146864/fileData.do",
  "source_dataset_id": "30335",
  "source_layer": "UD602"
}
```

- `retrieved_at`, `source_url`, `source_dataset_id`, `source_layer`는 필수다.
- `30335`는 `UD602`, `30336`은 `UD501`과만 조합한다.
- 원천 갱신일을 공식 페이지나 취득 기록으로 확인한 경우에만 `source_updated_at`을 적는다. 확인할 수 없으면 필드를 생략하며 ZIP의 생성·수정 시각으로 대신하지 않는다.
- sidecar에는 API 키, 다운로드 토큰, 개인 정보 또는 연락처를 적지 않는다.

```powershell
npm run build:maintenance-boundaries -- --input data/maintenance/raw --output data/maintenance/processed
```

빌드는 아래 산출물을 `data/maintenance/processed/`에 생성한다.

- `boundaries.geojson`: 서버가 읽는 정비사업 경계 GeoJSON
- `boundaries.meta.json`: 입력, 출력, 검역 수를 포함한 메타데이터
- `boundaries.quarantine.json`: 유효하지 않거나 처리하지 못한 feature의 검역 보고서

직전 승인 산출물과 비교해 건수 변화가 20%를 넘으면 원본, 라이선스, 필터 조건을 검토한다. 변경이 확인되고 승인된 경우에만 `--accept-large-change`를 붙여 다시 실행한다.

## 배포와 표시

- 서버에는 검증된 처리 산출물만 artifact로 배포한다. 원본 ZIP, API 키, 검역 입력물은 배포 artifact에 포함하지 않는다.
- `public/`에는 원본 또는 처리 GeoJSON을 배치하지 않는다. 경계는 서버 전용 경로에서 읽어 필요한 응답으로만 제공한다.
- 서비스와 보고서에는 출처별 요구되는 저작자 표시(attribution)를 유지하고, 정비사업 정보가 `법적 효력 없는 참고자료`임을 명시한다.

## 릴리스 검증

일반 회귀 테스트는 라이선스 원본 없이 합성 구조 fixture를 사용한다. 이 fixture는 validator의 실패 분기와 파일 계약만 검증하며 공식 경계나 실데이터 증거가 아니다.

```powershell
npm run test:maintenance
```

실제 배포 artifact는 서버 전용 기본 경로 `data/maintenance/processed/`에 배치한 뒤 별도 gate를 실행한다. 실제 파일이 없거나 손상됐거나 건수·좌표·출처가 맞지 않으면 성공으로 우회하지 않고 실패한다.

```powershell
npm run qa:maintenance:release
```

검증기는 metadata schema version, 입력·출력·검역 건수 대사, 전체 좌표와 bbox의 대한민국 WGS84 범위, feature별 원천 메타데이터, Git ignore/tracked 상태, `public/` 공개 여부, 클라이언트 키 참조를 검사한다.

## 공식 경계 취득 상태와 최신 운영값

2026-07-22 QA에서 VWorld `30335`·`30336` 페이지와 지역별 파일 목록은 비로그인으로 조회됐지만, 다운로드 함수는 로그인을 요구했고 `downloadResourceFile.do`의 서울·부산·대전 요청은 HTTP 200과 빈 body를 반환했다. 따라서 승인 여부와 별개로 인증된 다운로드 세션 또는 사용자가 직접 내려받은 ZIP이 필요하다. 비로그인 응답을 원본 ZIP으로 간주하거나 빈 파일로 빌드하지 않는다.

| 항목 | 2026-07-22 확인값 |
|---|---|
| 실제 artifact 생성일 | 미생성 |
| 실제 feature 수 | 미확인 |
| 실제 bbox | 미확인 |
| 검증 대상 dataset ID | `30335` (`UD602`), `30336` (`UD501`) |
| 실제 artifact에 포함된 dataset ID | 미확인 |
| QA 일자 | 2026-07-22 |
| release gate | `MISSING_ARTIFACT` (예상된 차단) |

실제 ZIP을 확보하면 sidecar를 작성하고 경계 빌드와 `qa:maintenance:release`를 통과시킨 뒤에만 생성일·feature 수·bbox·실제 포함 dataset ID를 위 표에 갱신한다. 권한 승인 메일, 로그인 세션, 쿠키, 다운로드 토큰은 Git 밖에서 보관한다.

## 키 사고 대응

- provider 오류 객체, 로그, 스크린샷, QA 문서에 요청 URL이나 `serviceKey`를 남기지 않는다. 서울·부산 transport 오류는 안전한 source 식별자만 가진 오류로 변환된다.
- 키가 URL이나 로그에 노출된 경우 즉시 추가 실호출을 중단하고 제공자 콘솔에서 키를 회전한다. 회전 전 키로 release QA를 재개하지 않는다.
- 회전 뒤 `DATA_GO_KR_API_KEY`를 로컬·배포 secret에만 다시 설정하고 `npm run test:maintenance`, `npm run qa:maintenance:release`, 브라우저 네트워크·번들 검사를 다시 수행한다.

## 서울 정보몽땅 단계 데이터 수집 (2026-07-30 추가)

서울 한정으로 정비사업 정보몽땅(cleanup.seoul.go.kr) 사업장검색을 수집해 세분 진행단계(정비계획 수립~준공인가·조합해산·조합청산·이전고시)를 확보한다. 공식 오픈API가 없어(OA-2253/2254는 서비스 종료) HTML 목록을 주기 수집한다.

```powershell
npm run build:seoul-cleanup            # 수집 + NCP 지오코딩 + 검증
npm run build:seoul-cleanup -- --accept-large-change   # 20% 초과 변동 승인 시
```

- 산출물: `data/maintenance/processed/seoul-cleanup.json` (+ `.meta.json`). 원본과 마찬가지로 Git에 커밋하지 않고 배포 artifact로만 전달한다.
- 검증 게이트: 최소 500건, 진행단계 누락 0건, 대표지번 보유율 90% 이상, 직전 산출물 대비 건수 변동 20% 이하. 실패 시 기존 산출물을 유지한다.
- 지오코딩: `NCP_CLIENT_ID`/`NCP_CLIENT_SECRET`이 설정된 환경에서만 좌표가 부여되며, 직전 산출물의 좌표를 캐시로 재사용한다. 키가 없으면 좌표 없이 저장되고 서버의 공간조인 결합이 비활성화된다.
- 서버 동작: 검색 시 산출물의 좌표를 경계 폴리곤에 공간조인(point-in-polygon)해 단계(`stage`)와 세분 단계(`stage_detail`)를 부여한다. 폴리곤 내부에 서로 다른 단계의 사업장이 여럿이면 이름 호환 후보가 1건일 때만 적용한다.
- 종료 필터: `준공` 단계(전 소스 공통) 또는 정보몽땅 종료 단계(준공인가·조합해산·조합청산·이전고시)인 사업은 지도·카탈로그에서 제외되고, 제외 건수는 응답 warnings에 표기된다.
- 갱신 주기: 분기 1회 권장. 운영 서버 cron 또는 GitHub Actions에서 위 명령을 실행하고, 검증 게이트 실패 로그가 나오면 사이트 개편 여부를 확인해 파서를 수정한다.
- 수집 예절: 페이지당 250ms 간격 순차 요청(약 114페이지). 병렬화하지 않는다.

## TODO — 서울 외 지역 확장 (미구현)

- **경기도**: 「경기도 일반 정비사업 추진 현황」(data.go.kr 15119846, 경기데이터드림, 일간 갱신, 주소·현추진상황·사업추진일정 포함)을 서울·부산과 같은 지역 원천으로 추가. openapi.gg.go.kr 서비스명은 실호출로 확인 필요. 분당 등 경기 지역 `단계: 미확인` 해소용 1순위.
- **서울 코드 조인 검증**: OA-20281 `DCSN_ANCMNT_MNG_CD`(결정고시관리코드)와 정보몽땅 `record_code`(예: `11000AGZ201211160062`)는 같은 UPIS 체계로 추정 — 실데이터로 매칭률을 검증하면 공간조인 없이 확정 결합 가능. SHP `MNUM`(33자, `...UDR...`)과는 형식이 달라 직접 조인 불가 확인(2026-07-30).
- **부산**: 기존 API의 `step` 필드 활용도 점검 및 종료 단계 판별 보강.
- **그 외 지자체**: 하남시(15150356) 등 개별 오픈API 존재 — 수요 지역 확정 후 추가.
- **리모델링·지역주택**: 도시정비법 밖 사업(주택법)은 현 원천에 없음. 정보몽땅 사업유형에는 포함되므로 서울은 커버되나 타 지역은 별도 원천 필요.
