# Task 8 최종 구현 보고서

## 최종 결과

- 구현 커밋: `a673bfb` (`fix: gate failed park presentation data`)
- PowerPoint COM: 16/16장, 1920×1080
- 편집 가능한 텍스트 도형: 363개
- 직접 시각 점검: PPT 실패 상태 3장 + Canvas parity 3장, 전체 PPT COM 16/16 통과
- 숨은 제어문자: COM 추출·PPT XML 모두 0건
- 의미 본문: 16장 전체 11pt 이상
- 타이포 예외: title/eyebrow ≤80pt, footer/legal ≥475pt, `※` note, synthetic disclosure ≥9pt
- 경계 도형: slide10 총 7링, 실선 4, 점선 3
- Canvas 경계 픽셀: exact `#EC4899` 1,366개
- 입력 POI 17개 / 보고서 산출 POI 16개
- failed park 입력 1개 / 보고서 공원 POI 0개
- slide6 stale 공원 라벨 0, 핵심 포인트 카드 overlap 0
- slides 6/9/14: `공원 데이터 수집 실패 · 산출 제외`
- park-derived `공원 0개`, `생활공원 500m`, `접근성 0/100` 전 보고서 0건
- 방법 문구: `경계가 없으면 면적 기반 원형거리로 추정합니다.` 1 line

## 재현 명령

```powershell
npm run qa:maintenance-presentation
```

위 명령은 일반 `/site` 제품 경로에서 Playwright route interception으로 합성 fixture를 주입하고, Canvas 증거와 PPTX를 만든 뒤 PowerPoint COM 감사를 실행한다. QA 전용 제품 route는 없다.

개별 명령:

```powershell
npm run qa:maintenance-presentation:generate
npm run qa:maintenance-presentation:audit
```

## 검증 게이트

| gate | result |
|---|---|
| focused presentation | pass |
| `npm run test:maintenance` | pass |
| `npm run lint` / `tsc --noEmit` | pass |
| `npm run qa:maintenance-presentation` | pass |
| `npm run build` | pass |
| general `npm test` | pre-existing `CONDITIONAL_HOLD` in cheongwadae deliverable validator |

## 증거

- `qa/artifacts/maintenance/task8-maintenance-report.pptx`
- `qa/artifacts/maintenance/task8-com-audit.json`
- `qa/artifacts/maintenance/task8-presentation-qa-summary.json`
- `qa/artifacts/maintenance/task8-presentation-qa-report.md`
- Canvas/PPT failure-state PNG 14개

각 artifact의 현재 byte size와 SHA-256은 `task8-presentation-qa-summary.json`에 기록했다.

## 증거 범위

합성 구조검증 자료이며 실데이터 또는 공식 경계 확보 증거가 아니다. Polygon hole과 MultiPolygon은 공급된 fixture 구조를 렌더러가 보존하는지만 검증한다.
