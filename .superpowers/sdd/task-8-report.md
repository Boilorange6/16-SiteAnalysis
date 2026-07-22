# Task 8 구현 보고서

## 결과

- 구현 커밋: `0977fe2` (`feat: 정비사업 분석과 PPT 출처 정보 확장`)
- 정비사업 개발점수 산식은 변경하지 않고, 사실 요약·PPT·캔버스 표현만 확장했다.
- 실제 `boundary`만 지도에 그리며 `confirmed`는 실선, `unmatched`는 점선, `unavailable`은 미표시한다.
- Polygon 내부 링과 MultiPolygon의 모든 파트를 보존한다.
- 정비사업 상세 표는 동일한 7열 모델을 PPT와 캔버스가 공유하고 최대 6건을 표시한다.
- 5개 원천 출처와 4개 런타임 상태, 공공누리·좌표변환·참고용 고지를 표시한다.

## TDD 증빙

### RED

| 테스트 | 최초 실패 |
| --- | --- |
| `test-fact-summary.mjs` | 경계 상태 집계 필드가 없어 `undefined !== 1` |
| `test-maintenance-presentation.mjs` | `maintenance-presentation.ts` 모듈 부재 |
| 출처 상태 헬퍼 테스트 | 공유 formatter export 부재 |
| 경계 투영 테스트 | `projectMaintenanceBoundaries` 부재 |

### GREEN

| 명령 | 결과 |
| --- | --- |
| `npx tsx src/scripts/test-fact-summary.mjs` | `fact-summary: all tests passed` |
| `npx tsx src/scripts/test-maintenance-presentation.mjs` | `maintenance presentation: all tests passed` |
| `npm run test:maintenance` | 모든 정비사업 계약·provider·cache·boundary·merge·orchestration·UI·fact·presentation 테스트 통과 |
| `npm run lint` | `tsc --noEmit`, exit 0 |
| `npm run build` | Next.js 15.5.15 최적화 컴파일, 타입 검사, 정적 페이지 20/20 생성 성공 |

빌드의 유일한 경고는 상위 저장소와 worktree에 lockfile이 함께 있어 workspace root를 추론했다는 기존 환경 경고다.

## 산식 불변 확인

- 개발점수 계산 코드는 수정하지 않았다.
- 3개 경계 상태와 예정세대수 1,500세대가 포함된 테스트에서도 개발점수는 기존 기대값 `6`을 유지한다.
- 행정 카탈로그 건수는 점수에 포함하지 않고 설명문에서만 구분한다.

## 표현 계약

- 표 헤더: `구역명 | 유형·단계 | 시행자 | 예정세대수 | 면적·거리 | 경계 | 출처·기준일`
- 정렬: 거리 오름차순, 경계 확정 우선, 한글 구역명 순서
- 범례: `정비사업 공식 경계(참고용)`
- 요약 카드: 사업 수, 예정세대수, 면적, 경계 확정 수
- 출처 카드: 국토부 통합심의, 국토부 표준데이터, 국토부 SHP, 서울시, 부산시
- 상태 행: 전국 기본, SHP 경계, 서울 보강, 부산 보강을 독립 표시

## 수동 QA

7개 사업 fixture로 앱의 캔버스 PPT 미리보기와 다운로드된 PPTX를 검증했다.

- Polygon 1개: 외곽 링과 홀 링 2개 모두 표시
- MultiPolygon 1개: 2개 파트 모두 표시
- 경계 미제공 사업 2개: 합성 경계 없이 지도에서 제외
- PPT 경계 도형 7개: 실선 링 4개, 점선 링 3개, 미제공 도형 0개
- 정비사업 표: 정확히 7열, 최대 6행, 7번째 사업 미표시
- 출처: 5개 카드와 4개 런타임 상태 표시
- 검사한 PPT 10·11·15번 슬라이드: 도형 overflow 0건

번들 `render_slides.py`와 `slides_test.py`는 환경에 `pdf2image`가 없어 실행되지 않았다. 대신 Microsoft PowerPoint COM으로 1920×1080 렌더링하고, 도형 bounds·텍스트·object name·dash style을 함께 감사했다. 기능 검증을 막는 요소는 아니다.

## QA 산출물

| 파일 | SHA-256 |
| --- | --- |
| `task8-canvas-maintenance-map.png` | `f550bf6a9d092d4643e77be9bb4264569b2ed4519eb7a07fc60c718f10dcfa25` |
| `task8-canvas-maintenance-table.png` | `ffd0f70250b19bf4ee539181ac869d4287119ac09b95be95bdc953f506678eda` |
| `task8-canvas-maintenance-sources.png` | `96f55a38e947579ccfc6d618a438c6f3144d798ead3bc7d87c1ee9f7174b8d9c` |
| `task8-maintenance-report.pptx` | `59a47202f14dbc9c4666e6c7e3ad2a472d09b96ddfd92d658b229ce4f32ec664` |
| `task8-ppt-maintenance-map.png` | `55d1a0469fcaf66d6a92a29d8c2f91b793cd43f04a8bd4d3848a3690a6ef321b` |
| `task8-ppt-maintenance-table.png` | `5b9dbcdbc25517f5d5bc5983560380049cbfad5e5be39a0540b8f32c79dabbd7` |
| `task8-ppt-maintenance-sources.png` | `bd6126503311321fb889bdb7edcadc9062b4aeb32258600946639d6da38e77e9` |

구조화된 검사 결과는 `qa/artifacts/maintenance/task8-presentation-qa-summary.json`에 기록했다.

## 변경 파일 규모

| 파일 | 전체 LOC |
| --- | ---: |
| `src/lib/analysis-engine.ts` | 293 |
| `src/lib/fact-summary.ts` | 295 |
| `src/lib/maintenance-presentation.ts` | 194 |
| `src/lib/ppt-generator.ts` | 2,547 |
| `src/lib/ppt-canvas-renderer.ts` | 2,351 |
| `src/lib/source-status-text.ts` | 25 |
| `src/scripts/test-fact-summary.mjs` | 177 |
| `src/scripts/test-maintenance-presentation.mjs` | 143 |

새 순수 표현 모듈 `maintenance-presentation.ts`는 250 LOC 제한 이하다.

## 작업 경계

기존 dirty 파일인 아래 3개는 Task 8 커밋에서 제외했다.

- `output/cheongwadae-analysis.json`
- `qa/results/cheongwadae-qa-report.json`
- `qa/results/cheongwadae-qa-report.md`

임시 브라우저 QA 스크립트 `qa/.task8-presentation-qa.mjs`는 삭제했고 커밋에 포함되지 않았다. 남은 구현 blocker는 없다.
