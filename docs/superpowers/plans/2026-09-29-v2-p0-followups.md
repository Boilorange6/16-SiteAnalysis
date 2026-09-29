# v2 P0 — 실행 중 결정과 P1 이월 항목

P0 계획(`2026-09-29-v2-p0-foundation.md`)을 실행하며 계획과 달리 정한 것과, P1이 먼저 처리할 것을 모았다. 커밋 범위: 705fea1..(이 문서 커밋).

## 계획과 달라진 결정

| 항목 | 결정 | 이유 |
|---|---|---|
| 실행자 | Task 1만 GPT-5.6 Luna, Task 2~9는 Claude Sonnet, Task 10은 Claude Opus | codex Windows 샌드박스가 git 쓰기·tsx(esbuild) 실행을 막아 TDD·커밋 불가. 샌드박스 해제는 사용자 동의가 필요해 쓰지 않음 |
| 좌표 거리 테스트 허용치 | 0.2% → 0.3% | 기준값이 구면 haversine이라 GRS80 타원체와 약 0.22% 차이가 정상 |
| `tile_result.judgment` | `criteria: string \| null` 추가. 등급이 있으면 근거 지표와 기준 문구 필수 | 스펙 §5.2 "적용 조건", §4.1 "기준을 함께 적는다" |
| manifest | 경로 정규형 강제, 데이터 디렉터리 잠금(`.lock`), 잠금/비잠금 함수 분리(`*Locked`), WAL 모드 파일 거부(`WAL_MODE`), 롤백 전 검증, 같은 해시 재게시 시 prev 유지, 게시 후 불일치 시 게시 전 바이트 그대로 복원 | 리뷰에서 GC가 살아 있는 파일·미게시 빌드를 지울 수 있는 경로를 찾음 |
| GC | 실행 중 분석의 버전도 보호. 열린 파일(EBUSY/EPERM)은 `skipped`로 보고하고 계속 | 스펙 §3.4 "진행 중 분석은 이전 파일을 계속 쓴다" |
| `saveProject` | `saveProject(db, dataDir, p)` 비동기, 잠금 안에서 보관 manifest가 없으면 `DATA_VERSION_GONE` | 수거된 버전을 저장하면 GC가 영원히 막히던 문제 |
| A0 측정 CSV | 전체 읽기 → 스트리밍, 인코딩은 앞 1 MiB로 판별(`--encoding`으로 지정 가능), cp949 등 별칭 → euc-kr | 전국 파일(수 GB) 측정이 목적 |
| A0 검수지 배정 | SHP 첫 꼭짓점 → bbox 중심, 한국 범위 밖 좌표는 `outOfRangePoints` | 큰 폴리곤이 엉뚱한 검수지에 잡힘 |
| A0 다운로드 | 상한 5 GB를 넘김(`.cache/v2/raw` 약 8.4 GB, 실제 네트워크 약 1.2 GB + 압축 해제본) | 세션 중단 전 받은 표제부 등. P1에서 재사용(gitignore) |
| 완주 검수 좌표 | 292 m 보정 | 200 m 기준 초과 |

## P1이 먼저 처리할 것 (리뷰에서 보류)

1. `collectGarbage`가 핀 목록을 잠금 **안에서** 계산하도록 `() => ReadonlySet<string>`을 받게 한다(프로세스 간 저장/GC 경합). `runSkeletonAnalysis`의 manifest 읽기~running 핀 사이 공백도 같이 해결.
2. 데이터 빌드가 잠금을 오래 잡으면 `saveProject`가 `LOCKED`로 실패한다 → API 계층에 재시도 또는 "잠시 후 다시" 안내.
3. GC `skipped`가 여러 번 연속 비어 있지 않으면 경고(Windows EPERM은 권한 문제도 포함).
4. 게시 후 불일치 복원 자체가 실패하면 오류 코드가 사라지고 tmp 파일이 남을 수 있다(상태는 유효).
5. 데이터 빌더는 해시 전에 `PRAGMA journal_mode=DELETE`, 빌드는 `withDataDirLock` 안에서 하고 게시는 `publishManifestLocked`.
6. 작은 보강: GC가 손으로 고친 manifest 경로를 `resolveDataPath`로 검증 / 현재 manifest가 깨졌으면 prev로 복사하지 않음 / 분석 종료 후 `saveTileResult` 막기 / `finishAnalysisRun` 모르는 id 오류 / `saveTileResult`가 캐시 키를 직접 계산.
7. A0 후속: 버스정류장 행 수 불일치(227,065 vs 206,022), K-APT 행 수(307,834 vs 44,628)와 단지종류 코드, K-APT 시군구별 검수지 수를 측정 파일에 저장, 고정 지점 기대치는 첫 적재 후 승인.

## 사용자 조치 (A0 검증표 블로커 요약 참조)

- VWorld 로그인 후 dsId 18·23·24·6(CSV)·21 다운로드(연속지적도는 23. 30563은 공공누리 4유형).
- ~~VWorld 항공영상 사전 승인 문의~~ → 해소(2026-09-29 사용자 확인: 회사가 VWorld 허가 확보). 항공사진·수목 도판을 v1 대상으로 되돌릴 수 있음.
- 서울 OA-20281(공공누리 4유형) 사용 결정, 학구도 폴리곤은 schoolzone.emac.kr에서 확보.
