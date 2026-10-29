# 16-SiteAnalysis 저장소 규칙

## 정본과 디자인

- 화면·타일·펼침 창·PPT를 만들거나 고치기 전에는 반드시 `docs/design/v2-design-language.md`를 읽고 따른다. 실행자 브리프에도 이 필독 지시를 넣고, 없는 패턴은 임의로 만들지 말고 보고한다. 새 패턴은 시안과 사용자 승인 후 문서에 추가하고 커밋한다. 인수 캡처도 그 정본과 대조한다.
- 지원 범위와 기존 모바일 코드 보존은 디자인 정본의 지원 화면 결정에 따른다. 화면 QA는 1440×900과 1024×768에서 한다. 이미 확정된 결정은 다시 묻지 않는다.
- 설계 선택은 시뮬레이션·도판·보고서 품질을 우선한다. 속도·용량도 고려하되 품질 저하의 이유로 삼지 않는다. `docs/research/2026-10-01-sitedia-simulation-benchmark.md` 수준 이상을 기준으로 하고, 더 낮은 대안은 비용·권리상 불가할 때만 고른다. 성능은 캐시·알고리즘 개선이나 백그라운드 실행으로 해결한다.
- 타일 수는 고정하지 않는다. 2026-10-06 중복 제거와 흡수 관계는 유지하며 신규 타일은 별도 질문에 답하고 원천이 등록되어 있으며 실데이터 시각 QA·PPT 장·출처 장을 통과해야 한다. 확정된 표식·지도·PPT 결정은 디자인 정본과 vault의 `10-Projects/16-SiteAnalysis/Decisions/2026-10-26 타일 수 고정 폐기와 추가 기준.md`를 따른다.

## 데이터와 안전

- 높이와 지상층수가 모두 없는 건물은 적재 원천은 미상으로 보존하고 엔진에서 1층 3m 추정을 적용한다. 확정값과 다른 추정값을 구분해 집계·한계를 표시하고 그림자·3D 장애물에 포함한다. 높이 수치를 설명할 때 1층 가정 비율을 함께 말한다.
- 사용자가 정한 비영리 사용을 전제로 원천 이용조건을 검토하고 출처 표기 조건을 화면·PPT·가이드에 반영한다. 도로명주소 건물의 출처·조건은 디자인 정본과 `src/lib/v2/ingest/sources/juso-buildings.ts`를 따른다. 영리 전환 시 이 결정을 다시 검토한다.
- v2 데이터는 C:/SiteAnalysisData/v2에 있으며 본 저장소의 D:/V-coding/16-SiteAnalysis/.cache/v2는 이를 가리키는 junction이다. 저장 분석이 고정한 버전을 보호하기 위해 옛 데이터 버전은 수동으로 지우지 않고 데이터 GC로 정리한다. 개발·운영 분석 DB를 모두 보호하도록 GC에 `--app-db C:/SiteAnalysisData/v2/app.sqlite,C:/SiteAnalysisData/serve/app.sqlite`를 넘긴다. 운영 사용자·분석 DB는 개발 DB와 분리한다.
- worktree 삭제 전 node_modules와 .cache 등 reparse point를 확인하고 각각 재귀 옵션 없이 링크만 끊은 뒤 삭제하며 공용 원본 데이터와 의존성이 남았는지 확인한다. 테스트가 worktree의 로컬 경로를 직접 참조하면 본 저장소의 node_modules를 가리키는 junction을 사용한다. vault `30-Patterns/Windows junction 안의 node_modules 와 재귀 삭제.md` 참조.
- 회사 PC는 매일 06:00·18:00에 종료되므로 수 시간 작업은 종료 시각을 고려하고 체크포인트·재개를 준비한다. 재개 전 부팅 시각·로그 수정 시각·프로세스를 확인한다. 데이터 빌드와 개발 서버의 V2_DATA_DIR은 D:/V-coding/16-SiteAnalysis/.cache/v2/data로 지정하고 reference 재개에는 원본 경로도 지정한다.
- 긴 한 줄 본문에 넓은 범위 정규식으로 grep하지 않는다. 필요한 부분을 잘라 읽고, 타임아웃 뒤 남은 탐색 프로세스는 정지·확인한다.

## 개발과 검증

- 명령의 정본은 `package.json`이다. 관련 검사는 `npm run lint`, `npm run test:v2`, `npm test` 등 변경 범위에 맞게 고른다.
- v2 타일 엔진 결과를 바꾸면 `src/lib/v2/engine/tiles/common.ts`에서 해당 타일 캐시 리비전을 올린다. 렌더 전용 변경에는 불필요하다. 리비전 변경은 새 분석이나 재분석에 적용되며 저장된 기존 분석을 열 때 자동 재계산되지 않는다.
- PNG·PDF 내보내기는 크기·구조뿐 아니라 실제 렌더, 불투명 픽셀과 잉크를 확인하고 PDF의 내장 이미지도 검사한다. PPTX 실렌더에는 PowerPoint의 Presentation SaveAs PNG를 사용하고 타임아웃을 둔다. 지도 도형이 많은 장에서 Slide Export는 멈출 수 있다. 테스트 덱에 배경 지도 이미지가 필요한지 확인한다.
- 개발 서버 화면 QA에 로그인이 필요하면 개발 계정 `devqa`와 로컬 환경의 `DEV_QA_PASSWORD`를 사용하고 사용자에게 로그인을 요청하지 않는다. 개발 서버의 로그인 API는 /site/api/auth/login, 계정 생성 API는 /site/api/auth/signup이다. 개발 DB에 계정이 없으면 개발 환경에서 만들고 로컬 환경을 갱신한다. 비밀번호는 메시지·메모·노트에 기록하지 않고 운영에는 이 계정을 만들지 않는다.
- 모델 선택은 사용자 전역 `routing-work-by-model-tier` 스킬을 따른다. 작업 기억은 `obsidian-memory` 스킬을 따른다.
