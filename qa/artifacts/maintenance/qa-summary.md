# 전국 정비사업 Task 9 QA 요약

QA 일자: 2026-07-22 (Asia/Seoul)

결론: 전국 통합 속성 원천과 릴리스/장애 회귀 gate는 검증됐다. 그러나 인증된 VWorld 경계 ZIP이 없어 서울·부산·대전의 **실 폴리곤 브라우저·PPT QA는 완료되지 않았다**. 기존 PNG/PPT는 합성 구조 fixture이며 실데이터 증거로 사용하지 않는다.

## 실원천 확인

- 전국 통합 API 실호출: 2026-07-22T08:11:16.522Z 시작, 08:11:17.267Z 완료. 통합 1,566건, 표준 API 0건을 반환했다.
- 공식 통합 CSV 재확인: 2026-07-22T08:12:23.720Z, 123,933 bytes, 1,566 data rows, SHA-256 `0fa3fbd498fbb45502e0d47190a6b9800ca56055639b0c76e10ca9f224815eb6`.
- CSV header: `시도,시군구,구역명칭,현 사업추진단계,사업유형,사업시행자,공급 예정 세대수`.
- 지역 건수: 서울 644, 부산 227, 대전 72. API와 CSV가 일치했다.
- VWorld `30336` 페이지 실값: 서울 fileNo 2, 부산 3, 대전 7 모두 데이터 기준일 `2026-07`, 갱신일 `2026-07-19`. 페이지 자체가 로그인 후 다운로드를 요구하며, 비로그인 직접 요청은 세 파일 모두 HTTP 200 / 0 bytes였다.
- `30335`와 `30336` 모두 로그인 guard가 확인됐다. 비로그인 빈 응답은 저장·변환하지 않았다.

공식 원천:

- 통합 목록: <https://www.data.go.kr/data/15160169/fileData.do>
- 표준 API: <https://www.data.go.kr/data/15155703/standard.do>
- 정비구역: <https://www.data.go.kr/data/15146864/fileData.do>
- 재개발구역: <https://www.data.go.kr/data/15146866/fileData.do>
- VWorld `30336`: <https://www.vworld.kr/dtmk/dtmk_ntads_s002.do?dsId=30336&svcCde=MK>

## 네 원천 상태

| 위치 | attributes | boundaries | 서울 상세 | 부산 상세 |
|---|---|---|---|---|
| 서울 종로구 | 실 API 성공, 2026-07-22T08:11:17.267Z | 실패, `fetchedAt=null`, artifact 없음 | 실패, `fetchedAt=null`, `SEOUL_OPEN_API_KEY` 없음 | 지역 외 빈 결과는 구조 테스트만 통과 |
| 부산 수영구 | 실 API 성공, 2026-07-22T08:11:17.267Z | 실패, `fetchedAt=null`, artifact 없음 | 지역 외 빈 결과는 구조 테스트만 통과 | 실패, `fetchedAt=null`, HTTP 403 |
| 대전 중구 | 실 API 성공, 2026-07-22T08:11:17.267Z | 실패, `fetchedAt=null`, artifact 없음 | 지역 외 빈 결과는 구조 테스트만 통과 | 지역 외 빈 결과는 구조 테스트만 통과 |

## 위치별 비교

세 위치 모두 중심 반경은 기존 브라우저 구조 QA와 같은 3 km를 기준으로 했다. 전국 통합 목록에는 좌표가 없으므로 지역 총 catalog 건수는 확인할 수 있지만 반경 내 project/confirmed/unmatched/unavailable 수는 실 경계 없이 계산하지 않았다.

### 서울 종로구 — 37.5866, 126.9748 / 3 km

- 지역 catalog: 서울특별시 644건. 실 반경 project 및 confirmed/unmatched/unavailable: 미검증.
- 공식 CSV 대상구 표본: `신영제1` / 재개발(주택정비) / 관리처분인가 / 조합 / 예정 199세대 / 면적 미제공 / 경계 shape 미확보.
- 실 screenshot/PPT: 없음.
- 합성 구조 증거(실데이터 아님): `seoul-1440x1000-analysis.png`, `seoul-1440x1000-popup-settled.png`, `seoul-390x844-analysis.png`, `task8-canvas-maintenance-map.png`, `task8-ppt-maintenance-map.png`, `task8-maintenance-report.pptx`.
- 남은 불일치: 공식 서울 경계 ZIP, 서울 상세 키, 실 반경 결과·popup·sidebar·PPT가 모두 미검증.

### 부산 수영구 — 35.1568, 129.1187 / 3 km

- 지역 catalog: 부산광역시 227건. 실 반경 project 및 confirmed/unmatched/unavailable: 미검증.
- 공식 CSV 대상구 표본: `광안2` / 재개발(주택정비) / 착공 / 조합 / 예정 1,233세대 / 면적 미제공 / 경계 shape 미확보.
- 실 screenshot/PPT: 없음.
- 합성 구조 증거(실데이터 아님): `busan-1440x1000-analysis.png`, `busan-1440x1000-popup-settled.png`, `busan-390x844-analysis.png`, `task8-canvas-maintenance-table.png`, `task8-ppt-maintenance-table.png`, `task8-maintenance-report.pptx`.
- 남은 불일치: 공식 부산 경계 ZIP, 부산 상세 403 해소, 실 반경 결과·popup·sidebar·PPT가 모두 미검증.

### 대전 중구 — 36.3250, 127.4210 / 3 km

- 지역 catalog: 대전광역시 72건. 실 반경 project 및 confirmed/unmatched/unavailable: 미검증.
- 공식 CSV 대상구 표본: `대사동1` / 재개발(주택정비) / 사업시행인가 / 조합 / 예정 1,080세대 / 면적 미제공 / 경계 shape 미확보.
- 실 screenshot/PPT: 없음.
- 합성 구조 증거(실데이터 아님): `daejeon-1440x1000-analysis.png`, `daejeon-1440x1000-popup-settled.png`, `daejeon-390x844-analysis.png`, `task8-canvas-maintenance-sources.png`, `task8-ppt-maintenance-sources.png`, `task8-maintenance-report.pptx`.
- 남은 불일치: 공식 대전 경계 ZIP과 실 NCP-비의존 폴리곤 검색·popup·sidebar·PPT가 모두 미검증.

## 장애 모드

| 시나리오 | 증거 | 결과 |
|---|---|---|
| data.go.kr 키 누락 | `qa/test-maintenance-failure-modes.mjs` | attributes가 오류를 내며 샘플을 반환하지 않음 |
| artifact 누락 | failure-mode + orchestration test | boundary 실패; region resolution 성공 시 admin catalog 유지 |
| artifact JSON 손상 | failure-mode test | `MALFORMED`, 프로세스 crash 없음 |
| 만료 attribute cache + 합성 403 | failure-mode test | `cached`, 기존 `fetchedAt` 보존 |
| 서울 키 누락 | orchestration test | `maintenance_seoul=failed`, sample ID 없음 |
| 20% 초과 건수 변화 | boundary build test | override 없이는 교체 차단 |
| 서울·부산 transport 403 | orchestration sentinel test | 오류 message/stack에 key·host 없음 |

## 비밀값·배포 경계

- `git ls-files data/maintenance`: 출력 없음.
- `data/maintenance/raw/`와 `processed/`는 Git ignore됨.
- `public/` 아래 정비사업 원본/처리 artifact 없음.
- client source에는 `DATA_GO_KR_API_KEY`, `SEOUL_OPEN_API_KEY`, keyed data.go.kr 직접 호출이 없음.
- 실 부산 상세 확인 중 외부 HTTP 예외가 요청 URL을 포함하는 문제를 발견했다. 파일·Git artifact에는 기록되지 않았지만 해당 키는 회전이 필요하며, 노출 발견 뒤 실호출을 중단했다. 회전 전에는 live gate를 재실행하지 않는다.
- 서울·부산 provider transport 오류는 이후 안전한 typed error로 감싸고 합성 sentinel 회귀 테스트를 추가했다.

## 자동 gate와 범위

- `npm run test:maintenance`: PASS (공식 경계가 아닌 합성 구조 fixture 사용).
- `npm run lint`: PASS (`tsc --noEmit`).
- `npm run build`: PASS. `npm test`와 동시에 실행한 첫 시도는 `/_document`를 찾지 못하는 일시적 생성 상태 오류가 있었으나, 소스 변경 없이 단독 재실행해 20/20 static page 생성과 production build를 완료했다. 최종 release gate에서는 build를 단독 실행한다.
- `npm test`: exit 1. 정비사업과 무관한 기존 `qa/validate-cheongwadae-deliverable.mjs`가 `overallStatus=CONDITIONAL_HOLD`를 반환해 이후 명령은 실행되지 않았다.
- `npm run qa:maintenance:release`: `MISSING_ARTIFACT`로 실패하는 것이 현재의 올바른 결과.
- `browser-qa-summary.json`과 Task 8 프레젠테이션 증거는 합성 구조·접근성·렌더러 parity만 증명한다.
- 실제 3개 위치의 공식 폴리곤 증거 완료 조건: 키 회전, 인증된 ZIP 확보, sidecar 작성, build, strict release gate, 실제 브라우저 desktop/mobile/popup/sidebar, 실제 PPT preview/export 재생성.

모든 화면과 보고서의 정비사업 경계는 `법적 효력 없는 참고자료`다.
