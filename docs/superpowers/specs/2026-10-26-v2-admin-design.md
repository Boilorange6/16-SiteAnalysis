# v2 관리 페이지(/v2/admin) 설계

- 작성일: 2026-10-26
- 상태: 사용자 승인. 화면은 시안 C2 기준이다(https://claude.ai/artifact/5Zmxd62EBaNwcjrZKVEUDa 의 'C2 다이어그램 미리보기 + 수정 요청' 판).
- 배경:
  - [아키맵 벤치마크](../../research/2026-10-26-archimap-benchmark.md) 뒤 사용자가 결정했다. 타일 수 33개 고정을 없앤다(추가 기준은 `docs/design/v2-design-language.md` 결정 이력 2026-10-26).
  - 그 전제로 관리 페이지를 먼저 만든다. 목적은 두 가지다.
    1. "어떤 원천으로 어떤 타일을 어떤 형태로 만들고 있는지"를 확인한다.
    2. 각 타일의 실제 다이어그램을 보고 AI에게 수정 요청을 쌓아 둔다.

## 1. 목적

관리자가 한 화면에서 다음을 한다.

1. **원천 확인**: 제공처, 기준일, 경과일, 라이선스, 규모(적재·제외 건수), 수집 방식, 갱신 주기, 저장 파일
2. **타일 확인**: 실제 다이어그램(기준 분석을 지금 코드로 그린 썸네일), 형태, 쓰는 원천(선언·실제), 엔진 특성, 상태(정상·계산 대기·빈 결과), 관련 파일
3. **양방향 연결**: 원천을 고르면 그 원천을 쓰는 타일이 강조된다. 타일을 고르면 그 타일이 쓰는 원천이 강조된다. 원천 불일치('선언 누락'·'쓰지 않는데 선언')도 함께 표시한다.
4. **수정 요청 모아 두기**: 그림 위 번호 핀과 메모를 대기 목록에 쌓는다.
   - AI는 "대기 요청 처리해" 한마디로 꺼내 처리한다.
   - 처리 결과는 전·후 비교로 확인하고, 필요하면 다시 연다.

## 2. 범위

- 범위: 읽기 전용 관리 화면 + 수정 요청 저장(이것만 쓰기 동작)
- 비범위:
  - 데이터 갱신 실행 버튼
  - 원천·타일 편집
  - 사용자 관리
  - 요청 댓글·담당자·알림
  - 자동 처리 예약 작업(사용자 모르게 코드가 바뀌므로 하지 않는다)
- 화면 폭: PC·태블릿 가로(최소 1024 px)만
- 접근: 관리자(legacy DB `users.role = 'admin'`)만

## 3. 데이터 — 기존 등록부에서 자동 조립 (손으로 쓰는 복제 목록 금지)

| 정보 | 정본 | 위치 |
|---|---|---|
| 게시 버전·파일별 버전·생성일 | manifest | `src/lib/v2/data/manifest.ts:153` `readManifest()` |
| 원천 제공처·URL·기준일·적재일·라이선스·coverage | `source_release` | `src/lib/v2/ui/guide-sources.ts:67-113` `readGuideSourceSnapshot()` |
| 규모(expected·accepted·rejected)·채움률·미위치 | `ingest_run`(같은 파일, release_id로 연결) | `src/lib/v2/data/schema.ts:40-54` |
| 원천 역할·사용처·**수집 방식·갱신 주기(신규)** | `SOURCE_DETAIL_DEFINITIONS` | `src/lib/v2/ui/source-details.ts:63` — `collect`, `cycle` 필드 추가 |
| **원천 묶음(신규)** | 같은 정의 | 화면에서 한 줄로 합칠 묶음 키: 용도지역 5종, 구역·지구 5종, 도시계획시설 8종, 정비구역 5종, 건축물대장 3종, 학교·학구도 4종, RTMS 유형별 |
| 등록부 없는 원천(vworld_wmts·ngii_topo·browser_lbm·fallback_d2q9) | 기존 표시 규칙 | `source-details.ts:75-89` |
| 타일 제목·종류·설명·원천 선언·**형태(신규)** | `TILE_CATALOG` | `src/lib/v2/ui/tile-catalog.ts` — `forms` 필드 추가 |
| heavy·날짜 무관·대지 의존 | 서버 레지스트리 | `src/lib/v2/tile/server.ts:79-83` |
| 컷 가능 | `CUT_CODES` | `src/lib/v2/tile/client.ts:36` |
| 상세·CSV | `DETAIL_SPECS` | `src/lib/v2/engine/detail/registry.ts:122` |
| PPT 조판 훅 | 보고서 레지스트리 | `src/lib/v2/tile/report.ts:7` |
| 흡수한 옛 코드 | 보드 개명 맵 | `src/lib/v2/ui/board-state.ts:121-134` |
| 캐시 버전 | `cacheEngineVersion(code)` | `src/lib/v2/engine/tiles/common.ts` |
| 실제 사용 원천·상태 | 기준 분석의 `tile_result`(`provenance.sources`, status) | app.sqlite `tile_result`(`src/lib/v2/app-db.ts:86`) |
| 관련 파일 | 타일 폴더 | `src/lib/v2/tile/<code>/` 아래 실제 파일 목록을 서버가 읽음 |

### 3-1. 카탈로그 변경

- `TileForm = "vector" | "raster" | "chart" | "3d" | "section" | "aerial"`를 정의한다. `forms: readonly TileForm[]`를 모든 타일에 채운다(D10 = aerial·raster·vector, D17 = vector·section 등).
- 원천 선언 불일치를 바로잡는다. 가이드 페이지 표시도 함께 바르게 된다.
  - S03: 건물·DEM 추가
  - S02: DEM 추가
  - D10: 지적 제거
  - S04: 수관·DEM 추가
  - A12: 지적 추가

### 3-2. 선언 vs 실제

- 기준 분석의 provenance 원천과 카탈로그 선언을 타일별로 비교한다. 결과는 '선언 누락'과 '쓰지 않는데 선언' 두 가지로 표시한다.
- 비교는 순수 함수로 두고 단위 테스트한다.
- 기준 분석에 결과가 없는 타일은 '확인 불가'로 표시한다.
- **원천이 하나도 연결되지 않은 타일은 오류로 표시한다.**

### 3-3. 기준 분석

- 썸네일과 '실제 사용 원천'의 바탕이 되는 분석이다.
- 처음 값은 관리자의 가장 최근 완료 분석이다. 화면의 [기준 분석 바꾸기]로 관리자의 저장 프로젝트 중에서 고른다.
- 고른 분석 id는 브라우저 localStorage에 기억한다(보는 사람별 편의 설정).

## 4. 썸네일 (실시간, 캡처 아님)

- 기준 분석의 `tile_result`를 `toTileView`(`src/lib/v2/ui/tile-view.ts:357`)로 바꾼다. 그다음 `tileSvgForView(view, { withFrame: false })`(`src/lib/v2/export/tile-image.ts:251`)로 시각물만 그린다.
  - 이미 있는 도판 렌더러를 재사용하므로, 타일 코드를 고치면 관리 페이지 그림이 바로 바뀐다.
- 썸네일 격자는 4:3 지도 칸에 그리고, 이름은 그림 아래 한 줄로 둔다.
- 상세 서랍의 큰 그림은 같은 SVG를 크게 그린다.
- 33개를 한 번에 그리므로 화면에 보이는 칸부터 지연 렌더한다.
- S01(WebGL)은 `visualHref`가 없으면 S01 썸네일 자리에 "3D는 보드에서 확인" 자리표시를 둔다. 보고서 미리보기와 같은 방식으로 PNG를 주입할 수 있으면 그 방식을 따른다(판단은 구현자 몫).

## 5. 수정 요청 대기 목록

### 5-1. 저장

app.sqlite에 새 표를 둔다(`initV2AppSchema`에 추가).

```
tile_request(
  request_id INTEGER PRIMARY KEY,
  tile_code TEXT NOT NULL,
  analysis_id TEXT,            -- 기준 분석
  memo TEXT NOT NULL,
  pins_json TEXT NOT NULL,     -- [{x,y}] 0~1 정규화(그림 기준)
  context_json TEXT NOT NULL,  -- 요청 당시 형태·원천(선언/실제)·불일치·관련 파일·캐시 버전
  image_path TEXT,             -- 요청 당시 그림
  status TEXT NOT NULL CHECK (status IN ('대기','진행','완료','보류')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_commit TEXT,
  resolved_note TEXT,          -- 처리 메모 또는 보류 이유
  resolved_at TEXT,
  reopen_note TEXT,            -- 다시 열 때 덧붙인 아쉬운 점(누적)
  user_id TEXT
)
```

- 요청 당시 그림은 클라이언트가 `tilePng(view, { withFrame: false })`로 만든다(`tile-image.ts:289`).
  - 서버가 받아 `<v2DataDir의 상위>/requests/<request_id>.png`에 저장한다. 실제 경로는 `C:\SiteAnalysisData\v2\requests\`이고, 경로 함수는 `src/lib/v2/paths.ts`에 추가한다.
  - 그림은 런타임에 바뀌는 자료이므로 빌드 산출물 안에 두지 않는다(데이터 파이프라인 규칙).

### 5-2. API (모두 관리자만)

| 메서드·경로 | 동작 |
|---|---|
| `GET /api/v2/admin/overview?analysis=<id>` | §3 조립 결과 + 기준 분석 결과 상태 |
| `GET /api/v2/admin/requests?tile=<code>` | 요청 목록 |
| `POST /api/v2/admin/requests` | multipart: 메모·핀·tile_code·analysis_id·context + PNG. 요청 생성(대기) |
| `PATCH /api/v2/admin/requests/<id>` | 다시 열기(`status=대기`, reopen_note 누적) |
| `GET /api/v2/admin/requests/<id>/image` | 요청 당시 그림 |

- 공통: 비로그인 401, 관리자 아님 403.
- 입력 검증
  - 메모는 2,000자 이하
  - 핀은 0~9개이고 좌표는 0~1
  - PNG 서명을 확인하고 5 MB 이하
  - tile_code는 `TILE_CODES`에 있어야 함

### 5-3. AI 쪽 도구 — `src/scripts/v2/tile-requests.mjs`

| 명령 | 동작 |
|---|---|
| `list [--status 대기]` | 요청마다 타일·메모·핀·context·그림 경로를 사람이 읽기 좋게 출력 |
| `show <id>` | 한 건의 전체 맥락 |
| `start <id>` | 진행으로 바꿈 |
| `done <id> --commit <sha> --note "<처리 메모>"` | 완료로 바꿈 |
| `hold <id> --note "<보류 이유>"` | 보류로 바꿈 |

- `package.json` 스크립트 `tile-requests`로 연결한다.
- 사용자가 "대기 요청 처리해"라고 하면 AI는 다음 순서로 진행한다.
  1. `list`를 실행한다.
  2. 그림 파일을 열어 핀 위치를 확인한다.
  3. 고치고 테스트·실렌더로 확인한다.
  4. 커밋한다.
  5. `done`으로 완료 처리한다.
- 애매하면 사용자에게 묻고, 지금 할 수 없는 것은 `hold`로 이유를 남긴다.

### 5-4. 화면 동작

- **상세 서랍**
  - 큰 그림을 누르면 그 자리에 번호 핀(최대 9개)이 찍히고, [핀 지우기]로 지울 수 있다.
  - 메모를 적고 [요청 추가]를 누르면 대기 목록에 들어간다.
  - 서랍 아래에 '이 타일의 요청' 목록이 나온다.
- **요청 상태별 모습**

  | 상태 | 모습 |
  |---|---|
  | 대기 | 파랑 |
  | 완료 | 초록 '처리 메모'·커밋·처리일 + [전·후 비교] [다시 열기] |
  | 보류 | 회색 '보류 이유' + [다시 열기] |

- **전·후 비교 창**
  - 왼쪽은 요청 당시 그림과 그때의 핀, 오른쪽은 같은 기준 분석을 지금 코드로 그린 그림이다.
  - 아래에 요청 문구, 처리 메모, 커밋이 나오고 [다시 열기]와 [확인했어요] 버튼이 있다.
  - 요청 당시 그림이 없으면 "요청 당시 그림이 없습니다"라고 표시한다.
- **다시 열기**: '아직 아쉬운 점(선택)'을 받아 대기로 되돌린다.
- **배지·거르기**: 썸네일에 '요청 n'(대기 건수) 배지가 붙는다. 상단에 '대기 요청 n'과 거르기 '요청 대기'가 있다.

## 6. 접근 제어

- 모든 `/api/v2/admin/*` 라우트는 `requireAuth`(`src/lib/server/auth.ts:22`) 뒤에 `user.role !== 'admin'`이면 403을 돌려준다.
- 관리자 지정: `src/scripts/v2/set-user-role.mjs <username> <role>`로 legacy DB의 `users.role`을 바꾼다. 1회 실행한다.
- 페이지 `src/app/v2/admin/page.tsx`
  - 클라이언트에서 `authFetch`로 부르고, 403이면 "관리자 권한이 필요합니다" 카드를 보여 준다.
  - 데이터를 서버 컴포넌트 payload에 싣지 않는다. 지금의 v2는 클라 게이트뿐이기 때문이다.
- 진입 링크는 메인 v2 화면에서 role이 admin인 사용자에게만 보인다.

## 7. 화면 (시안 C2)

- **상단**: 제목 '데이터·타일 관리'
  - 요약: 게시 버전·원천 수·타일 수·주의/미기록/불일치/계산 대기·대기 요청 수
  - 기준 분석 줄: [기준 분석 바꾸기]
  - 거르기: 전체·분석·도판·시뮬레이션·원천 불일치·계산 대기·빈 결과·요청 대기
- **왼쪽(약 290 px)**: 원천 목록(묶음 단위)
  - 원천을 누르면 그 원천을 쓰는 타일이 강조되고 나머지는 흐려진다.
  - 타일이 선택되면 그 타일이 쓰는 원천만 진하게 보이고 '사용'·'선언 누락'·'쓰지 않는데 선언' 표시가 붙는다.
- **오른쪽**: 타일 썸네일 5열 격자
  - 코드·제목·형태 아래에 원천 불일치·상태·요청 배지가 붙는다.
- **상세 서랍**: 오른쪽 위에 떠서 덮는다(밀거나 줄이지 않음).
  - 큰 그림(핀), 형태·원천·원천 점검·엔진·상태·관련 파일
  - 요청 추가, 이 타일의 요청
- **전·후 비교**: 가운데 큰 창
- **공통 규칙**
  - 가이드 페이지 토큰(`src/app/v2/guide/guide.module.css`)을 쓴다. 배경 `#eef0f3`, 카드 흰색, 강조 `#2f6fdb`, 경고 `#8a4300`/`#fff1e0`.
  - 글꼴은 Noto Sans KR, 제목은 Do Hyeon.
  - 내부 id는 보조 표기로만 쓰고, 날짜는 `YYYY-MM-DD HH:mm`.
  - 누름 영역은 44 px 이상으로 하고, 색만으로 의미를 전하지 않는다(문구·테두리 모양 병행).

## 8. 검증

- **새 테스트**(`src/scripts/v2/test-v2-admin-*.mjs`, `test-v2-analysis-ownership.mjs` 패턴)
  - 모든 admin 라우트: 비로그인 401, 일반 사용자 403, 관리자 200
  - overview 응답에 모든 `TILE_CODES`·게시 원천이 들어 있음, 모든 타일에 `forms`가 있음, 원천 없는 타일 0
  - 선언 vs 실제 비교 함수
  - 요청 생성·검증 실패(핀 10개, 큰 PNG, 없는 타일 코드)·다시 열기·상태 전이
  - `tile-requests.mjs` list/done/hold
- **전체 검사**: `npx tsc --noEmit`, `npm run test:v2` 전체 PASS, tile-literals 게이트 PASS, `test-v2-guide.mjs` PASS
- **실렌더**
  - 관리자 계정으로 1440·1280·1024를 캡처한다(`my-design-taste` measure, 데스크톱 전용).
  - 요청 추가 → `tile-requests list` → `done` → 전·후 비교까지 한 바퀴 실제로 돌린다.
  - 일반 사용자로 403 화면을 확인한다.
