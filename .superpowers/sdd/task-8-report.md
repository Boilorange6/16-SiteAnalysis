# Task 8 최종 구현 보고서

## 최종 결과

- 구현 커밋: `8be938004f8c11337fcd4e97b439896ff6d747e9` (`fix: align presentation title and canvas divider`)
- PowerPoint COM: 16/16장, 1920×1080
- 편집 가능한 텍스트 도형: 그룹 내부까지 재귀 감사한 445개
- 선택 증거: Canvas 8/8 + PPT 8/8 = 16/16
- 직접 시각 점검: slide1 짧은 60pt 제목, slide8 failed park gating, slide12 주거 표 divider, slide15 일반 출처 Canvas/PPT parity
- 숨은 제어문자: COM 추출·PPT XML 모두 0건
- 의미 본문: 그룹 내부 포함 16장 전체 11pt 이상, null minimum 0건
- 경계 도형: slide10 총 7링, 실선 4, 점선 3
- Canvas 경계 픽셀: exact `#EC4899` 1,366개
- 입력 POI 17개 / 보고서 산출 POI 16개
- failed park 입력 1개 / 보고서 공원 POI 0개
- slide6 stale 공원 라벨 0, 핵심 포인트 카드 overlap 0
- slides 6/9/14: `공원 데이터 수집 실패 · 산출 제외`
- slide15 지하철 노선 상태 1줄, 상태/각주 간격 19.44pt

## 재현 명령

```powershell
npm run qa:maintenance-presentation
```

일반 `/site` 제품 경로에 Playwright route interception으로 합성 fixture를 주입하고 Canvas 증거와 PPTX를 생성한 뒤 PowerPoint COM 감사를 실행한다. QA 전용 제품 route는 없다.

## 검증 게이트

| gate | result |
|---|---|
| focused presentation | pass |
| preview parity static regression | pass |
| `npm run test:maintenance` | pass |
| `npm run lint` / `tsc --noEmit` | pass |
| `npm run qa:maintenance-presentation` | pass |
| `npm run build` | pass |
| general `npm test` | pre-existing `CONDITIONAL_HOLD` in cheongwadae deliverable validator |

## 현재 증거 해시

| artifact | bytes | SHA-256 |
|---|---:|---|
| `task8-maintenance-report.pptx` | 6,099,603 | `86f1744d346fde0a698dc61fa95188e3a887e0641be825a0d46ed7bc0e89fdcc` |
| `task8-com-audit.json` | 1,691 | `4eba307d8dcf5c118a9627d1443b9c714b4bd717b36f59abc17a9e8c76f259d2` |
| `task8-canvas-radius-failure.png` | 80,412 | `da5913562182b44d14bc8a409414a4a06243f299d9e51182a15ce4dd0fd878ab` |
| `task8-ppt-radius-failure.png` | 107,903 | `7b376c53d6ebf140711a6f1ee655ee5c4dbe137d770faff15ae27d4f6193a5ae` |
| `task8-canvas-general-sources.png` | 91,148 | `17f38b704c05211f43ff66c767d4ff48180cf73f641596026b57c102ac57bb31` |
| `task8-ppt-general-sources.png` | 116,212 | `8989cacafdaa44ffc9fc16222cdfbc78df4949aca363af30c884a729eec03398` |

전체 18개 artifact의 현재 byte size와 SHA-256은 `qa/artifacts/maintenance/task8-presentation-qa-summary.json`에 기록되어 있다.

## 증거 범위

합성 구조검증 자료이며 실데이터 또는 공식 경계 확보 증거가 아니다. Polygon hole과 MultiPolygon은 공급된 fixture 구조를 렌더러가 보존하는지만 검증한다.
