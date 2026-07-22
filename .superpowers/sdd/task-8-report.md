# Task 8 구현 보고서

## 결과

- 최초 구현: `0977fe2` (`feat: 정비사업 분석과 PPT 출처 정보 확장`)
- 리뷰 수정: `69db9ae` (`fix: 정비사업 PPT 출처와 가독성 보강`)
- 정비사업 개발점수 산식은 변경하지 않고 사실 요약·PPT·캔버스 표현만 확장했다.
- 렌더러는 입력된 `boundary` GeoJSON만 사용한다. `confirmed`는 실선, `unmatched`는 점선, `unavailable`은 미표시하며 Polygon 내부 링과 MultiPolygon 파트를 보존한다.
- 정비사업 상세 표는 PPT와 캔버스가 같은 7열 모델을 공유하고 최대 6건을 표시한다.
- 기존 일반 출처 6개와 일반 수집 상태를 보존하고, 정비사업 출처 5개·런타임 상태 4개는 별도 슬라이드로 추가했다.
- 화면에 표시하는 법적 고지는 `법적 효력 없는 참고자료`이며, 공공누리·좌표변환 문구는 렌더링하지 않는다.

## TDD 증빙

### 최초 RED

| 테스트 | 실패 |
| --- | --- |
| `test-fact-summary.mjs` | 경계 상태 집계 필드 부재 |
| `test-maintenance-presentation.mjs` | 표현 모듈·경계 투영·출처 formatter 부재 |

### 리뷰 RED

| 테스트 | 실패 |
| --- | --- |
| 일반 출처 회귀 | `GENERAL_PRESENTATION_SOURCES` export 부재 |
| 일반 상태 회귀 | 정비사업 상태만 표시해 `park failed`가 사라짐 |
| 가독성 계약 | 지도·표·출처 본문 최소 글자 크기 계약 부재 |
| 의미 단위 줄바꿈 | `가로주택정비`, `4.20만㎡`, `3.10만㎡` 보호 계약 부재 |

### 최종 GREEN

| 명령 | 결과 |
| --- | --- |
| `npx tsx src/scripts/test-fact-summary.mjs` | 통과 |
| `npx tsx src/scripts/test-maintenance-presentation.mjs` | 통과 |
| `npm run test:maintenance` | 전체 정비사업 테스트 통과, exit 0 |
| `npm run lint` | `tsc --noEmit`, exit 0 |
| `npm run build` | Next.js 최적화 컴파일, 타입 검사, 정적 페이지 20/20 생성 성공 |

빌드에는 상위 저장소와 worktree의 다중 lockfile을 알리는 기존 환경 경고만 남았다. `.next/BUILD_ID`와 export 산출물이 최종 빌드 시각으로 갱신됐다.

## 표현 계약

- 표 헤더: `구역명 | 유형·단계 | 시행자 | 예정세대수 | 면적·거리 | 경계 | 출처·기준일`
- 정렬: 거리 오름차순, 경계 확정 우선, 한글 구역명 순서
- 범례: `정비사업 공식 경계(참고용)`
- 지도 본문: 14pt 이상, 핵심 인사이트: 13pt, 표 헤더·본문: 12pt, 출처·상태·주의: 11pt, 법적 참고 각주: 9.5pt
- 지도 사업 항목은 단계 설명을 덜어낸 간결한 이름·면적·거리 구성으로 표시한다.
- PowerPoint 렌더링에서 `가로주택정비`, `4.20만㎡`, `3.10만㎡`가 의미 단위 중간에서 끊기지 않음을 육안 확인했다.

## 출처 회귀 수정

- 일반 출처 슬라이드: 주소/지도, 교통/POI, 공원/녹지, 정비사업, 주거 공급, 보고서 산출 6개 카드
- 정비사업 출처 슬라이드: 국토부 전국 통합, 전국 표준 API, 국토부 SHP, 서울 열린데이터, 부산 API 5개 카드
- 전체 출처 카드: 11개
- 일반 상태 행에서 `공원: 수집 실패 — 본 보고서에 누락`이 유지됨을 테스트와 PowerPoint 텍스트 감사로 확인했다.
- 정비사업의 전국 기본·경계·서울·부산 상태 4개는 독립 표시한다.

## 수동 QA 범위

QA fixture는 허가받은 실데이터가 아닌 `synthetic-structural` 구조 검증 데이터다.

- `officialGeometryEvidence: false`
- `realSourceEvidence: task9`
- 서울 케이스: `서울 합성 Polygon 홀`
- 부산 케이스: `부산 합성 MultiPolygon`
- 합성 fixture는 임시 브라우저 스크립트에만 존재했고 제품 경로에는 넣지 않았다.
- 이 증빙은 렌더러가 공급된 GeoJSON을 임의 합성하지 않고 구조 그대로 소비하는지 검증한다. 서울·부산의 실제 공식 경계 확보 여부는 Task 9 실원천 QA에서 확인해야 한다.

Playwright로 실제 앱 미리보기 16장과 PPTX를 생성했고, Microsoft PowerPoint COM으로 다시 열어 1920×1080 PNG를 export했다.

- 편집 가능한 텍스트 도형: 320개
- 정비사업 지도 경계 도형: 7개, 실선 링 4개, 점선 링 3개, 미제공 도형 0개
- 전체 덱에서는 개요와 정비사업 지도 양쪽에 경계가 있어 총 14개 편집 가능 경계 도형
- 정비사업 표: 7열·6행
- PPT 10·11·15·16번 슬라이드 overflow: 0개
- 전체 덱 overflow: 기존 표지 장식 2개만 확인
- 관련 최소 글자 크기: 지도 14pt, 표 12pt, 출처 11pt

## QA 산출물

| 파일 | SHA-256 |
| --- | --- |
| `task8-canvas-maintenance-map.png` | `f2aeb659fe4fae2e6d0b37b727a269c9846411a0a7f878dd58d288a217627281` |
| `task8-canvas-maintenance-table.png` | `9661a6e0d399d109a3ccbbc37ee6c683ebbe305d0f01f4c4683c70c11f63781c` |
| `task8-canvas-general-sources.png` | `2bab7df832807785afe68770fe64ad7b6c33d33b91c6f8db8fbcc3f7791734e0` |
| `task8-canvas-maintenance-sources.png` | `8ca51bba2ceb5db075bf63b527e4bf59d70a34157881492a359061fe6365f20e` |
| `task8-maintenance-report.pptx` | `a229b320cb5c4c815a130fa8a0d5a3b745991a39c67ade192a24f06f31c3cddf` |
| `task8-ppt-maintenance-map.png` | `41833c7934a9497c3afaa60faf8d1db0f25f02bf16651ee337db756964e9d58f` |
| `task8-ppt-maintenance-table.png` | `c779c6c89fb9f3da12cec2adc65f2960a424d55b213a3e25409b676ffa9b217c` |
| `task8-ppt-general-sources.png` | `17b627061d28b95f9e1ce3045b6e53f10394ba4fad8286d442f98afc86259f65` |
| `task8-ppt-maintenance-sources.png` | `c1ecc478f1d0f76ab2bd782f62e679d8c9b13719cb304d71025eaf0d62da523f` |

구조화된 검사 결과는 `qa/artifacts/maintenance/task8-presentation-qa-summary.json`에 기록했다.

## 작업 경계

아래 기존 dirty 파일은 두 Task 8 커밋에서 제외했다.

- `output/cheongwadae-analysis.json`
- `qa/results/cheongwadae-qa-report.json`
- `qa/results/cheongwadae-qa-report.md`

임시 브라우저·PowerPoint 감사 스크립트와 임시 감사 JSON은 삭제했다. 남은 구현 blocker는 없다.
