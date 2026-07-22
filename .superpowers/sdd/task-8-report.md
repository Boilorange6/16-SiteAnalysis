# Task 8 최종 구현 보고서

## 최종 결과

- 구현 커밋: `50af6e0` (`fix: eliminate final presentation splits`)
- 문서 확정 커밋: 이 문서를 포함하는 후속 HEAD
- PowerPoint COM: 16/16장, 1920×1080
- 편집 가능한 텍스트 도형: 391개
- 직접 시각 점검: PPT 16/16, Canvas 증거 4/4, 지정 증거 8/8 통과
- 숨은 제어문자: COM 추출·PPT XML 모두 0건
- split audit: `추정합|니다.`, `종로 가로주택정|비`, `재|건축 1건`, `1,050세|대`, `1,200세|대` 포함 전부 통과
- timeline geometry: `1,050세대`, `1,200세대` 모두 1 line, 11pt, BoundHeight 13.2pt < ShapeHeight 18.72pt
- 경계 도형: slide10 총 7링, 실선 4, 점선 3, unavailable 0
- Canvas 경계 픽셀: exact `#EC4899` 710개
- POI footer: Canvas/PPT 모두 17개
- 공원 상태: `공원: 수집 실패 — 본 보고서에 누락`
- 배너: text/fill/topmost/pixel 16/16
- 의미 본문 최소: slide2/9/11/12 모두 11pt

## 커밋 이력

- `0977fe2 feat: 정비사업 분석과 PPT 출처 정보 확장`
- `e0fa267 docs: Task 8 구현 증빙 기록`
- `69db9ae fix: 정비사업 PPT 출처와 가독성 보강`
- `af71688 docs: Task 8 리뷰 증빙 갱신`
- `bac8deb fix: harden maintenance presentation layout`
- `28fcd7c fix: finalize maintenance presentation QA`
- `50af6e0 fix: eliminate final presentation splits`

## 검증 게이트

| gate | result |
|---|---|
| focused presentation | pass |
| `npm run test:maintenance` | pass |
| `npm run lint` / `tsc --noEmit` | pass |
| direct Next build | `BUILD_EXPLICIT_EXIT_0` |
| COM Lines/XML/pixel/font/ring | pass |

## 최종 산출물

| artifact | bytes | resolution | SHA-256 |
|---|---:|---|---|
| task8-canvas-maintenance-map.png | 140399 | 960x540 | `c367731856f45ca7754d8c94fdca80aa8d1c22918819ab6a92edcad378121883` |
| task8-canvas-maintenance-table.png | 113364 | 960x540 | `176917c18ad387e5aef6f4b0a9b79905bc4e5abff0904505a7551c200f029e77` |
| task8-canvas-general-sources.png | 86089 | 960x540 | `71c63a556f93fc2709598f5a7c3ed513926f0548cdf5abbb0e47b760949a0a75` |
| task8-canvas-maintenance-sources.png | 71498 | 960x540 | `aa1b1e441ae6ed110bd8211157b4418e4bbb8c3d2e067edbaf46ffc95e920c3b` |
| task8-ppt-maintenance-map.png | 1600400 | 1920x1080 | `8df3b347bde181b644a85d999f1423c8b885b28ca7094722b2e0195e8783bd39` |
| task8-ppt-maintenance-table.png | 141062 | 1920x1080 | `48fb4aa557330cecf34568ad042cde752c7ab9d7b3cd328d9780ca33194d00a7` |
| task8-ppt-general-sources.png | 112598 | 1920x1080 | `617987d1731617dec4f91b1eb47b3e6eef26fdf6319c66766cf3e0de9513cf65` |
| task8-ppt-maintenance-sources.png | 91621 | 1920x1080 | `0a860514cd4a8366ea2a9f239d0603640e8eec6889bbbff606142024c538fac3` |
| task8-maintenance-report.pptx | 4944446 | n/a | `f5fed38d192b7837d9eb86b18f25b748bcb05c2a59b5446c9010255ee2997655` |
| task8-com-audit.json | 1985 | n/a | `bf748d56e5e4f2e978dc976a86de9c6339b36078583015ced71fdd75c9c612aa` |

## 증거 범위

합성 구조검증 자료이며 실데이터 또는 공식 경계 확보 증거가 아니다. Polygon hole과 MultiPolygon은 공급된 fixture 구조를 렌더러가 보존하는지만 검증한다.
