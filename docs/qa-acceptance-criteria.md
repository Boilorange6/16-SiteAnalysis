# 청와대 반경 3km 사이트 분석 산출물 QA 승인 기준

## 1. 목적
- 본 문서는 2026-04-15 기준 청와대 반경 3km 사이트 분석 앱 테스트용 산출물의 최종 승인 여부를 판정하기 위한 QA 기준을 정의한다.
- 판정 대상은 개발팀 산출물 `57fd5455`와 디자인팀 산출물 `5ed9a203`이다.

## 2. 참조 산출물
- 개발 계획서: `D:\v-coding\16-SiteAnalysis\.climpire-worktrees\57fd5455\docs\dev-supplement-plan.md`
- 개발 결과 JSON: `D:\v-coding\16-SiteAnalysis\.climpire-worktrees\57fd5455\output\cheongwadae-analysis.json`
- 개발 재현 스크립트: `D:\v-coding\16-SiteAnalysis\.climpire-worktrees\57fd5455\src\scripts\test-cheongwadae.mjs`
- 디자인 사양서: `D:\v-coding\16-SiteAnalysis\.climpire-worktrees\5ed9a203\docs\design-spec.md`
- 디자인 아이콘: `D:\v-coding\16-SiteAnalysis\.climpire-worktrees\5ed9a203\public\assets\icons`

## 3. 승인 체크 항목

| ID | 검증 항목 | 통과 기준 | 필수 증적 | 실패 시 치명도 |
| --- | --- | --- | --- | --- |
| QA-01 | 위성지도 타일 렌더링 | `satellite_map.source`가 확정값이며, 실제 출력물(`.pptx`, `.pdf`, 또는 슬라이드 이미지)에서 위성지도 배경이 확인된다. | 산출물 파일 + 메타데이터 | HIGH |
| QA-02 | 5개 POI 레이어 표시 | `subways`, `mountains`, `schools`, `parks`, `apartments` 5개 레이어가 모두 존재하고 각 레이어 수량이 1개 이상이며 대응 아이콘이 준비되어 있다. | 결과 JSON + 아이콘 파일 | HIGH |
| QA-03 | 오버레이 좌표 정합성 | 청와대 중심좌표는 `37.5866, 126.9748`이어야 하며, 각 레이어 개별 객체에 `lat`, `lng`가 존재하고 중심 반경 `3.05km` 이내여야 한다. | 개별 좌표 리스트 | HIGH |
| QA-04 | PPT 출력 완결성 | 실제 출력물(`.pptx` 또는 `.pdf`)이 존재하고 슬라이드 수가 디자인 사양서 기준 6장(커버, 전체뷰, 교통/자연, 교육, 분양아파트, 결론)과 일치한다. | 출력 파일 + 슬라이드 메타데이터 | HIGH |
| QA-05 | 데모 시나리오 재현성 | 재현 스크립트를 격리 경로에서 실행했을 때 결과 JSON이 기존 산출물과 바이트 단위로 동일하다. | 실행 로그 + 해시 비교 | MEDIUM |

## 4. 판정 규칙
- `CRITICAL` 또는 `HIGH` 실패가 1건 이상이면 최종 승인은 보류한다.
- `MEDIUM` 또는 `LOW` 실패만 존재하면 경고로 기록하고 조건부 승인 여부를 별도 판단한다.
- 산출물 부재 또는 시각 증적 부재는 "입증 실패"가 아니라 "검증 실패"로 처리한다.

## 5. 실행 방식
- 자동 검증 스크립트: `qa/validate-cheongwadae-deliverable.mjs`
- 실행 명령: `node qa/validate-cheongwadae-deliverable.mjs`
- 결과물:
  - `qa/results/cheongwadae-qa-report.json`
  - `qa/results/cheongwadae-qa-report.md`
