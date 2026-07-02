# main 기반 PPT 미리보기 개선 + 배포 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** main(배포 계열)의 PPT 미리보기에서 확인된 데이터 소실 버그(Overpass 소스 연쇄 실패)와 빈 패널·가독성 결함을 고치고, 검증 후 Lightsail 프로덕션에 배포한다.

**Architecture:** main의 기존 구조(Canvas2D 미리보기 `ppt-canvas-renderer.ts` ↔ pptxgenjs `ppt-generator.ts` 미러)를 **유지**한다. SlideSpec 단일 소스 이식은 이번 범위 외(백로그) — 이번 목표는 신뢰성과 디자인 품질이다. Overpass 호출 3곳(poi/park/subway-routes)을 공유 fetch 모듈(TTL 캐시+재시도)로 통일한다.

**Tech Stack:** Next.js 15 (basePath `/site`), better-sqlite3, pptxgenjs, Canvas2D, Overpass API. 테스트는 main 관례를 따라 **node .mjs 스크립트** (vitest 없음 — 도입 금지).

## Global Constraints

- 브랜치: `feature/slidespec-preview-on-main` (origin/main a678cd8에서 분기)
- 미리보기(canvas)와 PPT(pptxgenjs)는 **항상 같은 커밋에서 함께 수정** — 한쪽만 고치면 어긋남
- 서버 데이터 보존: 배포 시 `/home/bitnami/site-analysis/.env`, `.cache/`(sqlite DB·JWT secret) **절대 삭제/덮어쓰기 금지**
- 테스트 실행: `node <script>.mjs` (기존: `npm test` = 여러 .mjs 체인). 외부 네트워크 의존 테스트는 만들지 말 것 — 순수 로직만
- 커밋 메시지 끝: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- 빌드 게이트: `npx tsc --noEmit` + `npm run build`
- 재현된 버그 (수정 대상): categories 8종+planned=true 요청 시 `warnings:["osm"]` — Overpass poi 쿼리가 park-search의 Overpass 쿼리 직후 rate-limit으로 실패해 지하철/학교/산이 통째로 소실 → 점수 대시보드 "교통 0/25", 교통 슬라이드 빈 패널
  - 재현: `curl "http://localhost:3000/site/api/poi-search?lat=37.5866&lng=126.9748&radius=3000&categories=subway%2Cschool%2Cpark%2Cmountain%2Capartment%2Cofficetel%2Cresidential%2Cmaintenance&planned=true" -H "Authorization: Bearer <token>"` → park 51개만
  - 대조: categories=subway,school,park,mountain 4종이면 subway 15/school 89/park 51/mountain 10 정상

## File Structure

| 파일 | 작업 | 책임 |
|---|---|---|
| `src/lib/server/overpass-fetch.ts` | 생성 | Overpass 공유 fetch: 바운디드 TTL 캐시 + 429/5xx/타임아웃 지수 백오프 재시도 |
| `src/lib/overpass-api.ts` | 수정 | fetch 부분을 overpass-fetch로 교체 |
| `src/lib/server/park-search.ts` | 수정 | Overpass 호출부를 overpass-fetch로 교체 |
| `src/lib/overpass-subway-routes.ts` | 수정 | fetch를 overpass-fetch로 교체 (route단 캐시는 유지) |
| `src/scripts/test-overpass-fetch.mjs` | 생성 | 캐시/재시도 로직 순수 단위 테스트 (mock fetch) |
| `src/lib/ppt-canvas-renderer.ts` | 수정 | 빈 카테고리 패널 empty-state + 점수 대시보드 텍스트 가독성 |
| `src/lib/ppt-generator.ts` | 수정 | 위와 동일 변경의 pptx 측 미러 |
| `qa/validate-preview-parity.mjs` | 생성 | 두 렌더러의 empty-state 문자열/조건 동기 검증 (정적 검사) |

---

### Task 1: Overpass 공유 fetch 모듈 (TTL 캐시 + 재시도)

**Files:**
- Create: `src/lib/server/overpass-fetch.ts`
- Test: `src/scripts/test-overpass-fetch.mjs`

**Interfaces:**
- Produces: `overpassFetch(query: string, opts?: { timeoutMs?: number; fetchImpl?: typeof fetch; cacheTtlMs?: number; maxRetries?: number }): Promise<unknown>` — Overpass interpreter POST. 반환값은 파싱된 JSON. 같은 query 문자열은 TTL(기본 10분) 내 캐시 반환. 429/5xx/네트워크 오류/타임아웃 시 최대 2회 재시도(1s → 3s 백오프). 캐시는 최대 100엔트리(LRU 제거). `fetchImpl` 주입은 테스트용.
- 내부 상수: `OVERPASS_URL = "https://overpass-api.de/api/interpreter"`, 헤더 `Content-Type: application/x-www-form-urlencoded`, `Accept: */*`, `User-Agent: SiteAnalysisApp/1.0` (기존 overpass-api.ts와 동일 값)

- [ ] **Step 1: 실패하는 테스트 작성**

```js
// src/scripts/test-overpass-fetch.mjs
// 순수 로직 테스트 — 실제 네트워크 호출 없음 (fetchImpl 주입)
import assert from "node:assert/strict";

const { overpassFetch, __clearCacheForTest } = await import("../lib/server/overpass-fetch.ts").catch(async () => {
  // tsx 없이 node로 직접 실행할 수 없으므로 컴파일 우회: next 프로젝트의 관례에 따라
  // 이 테스트는 `npx tsx src/scripts/test-overpass-fetch.mjs`로 실행한다 (devDependency tsx 추가).
  throw new Error("run with: npx tsx src/scripts/test-overpass-fetch.mjs");
});

function makeFetch(responses) {
  let call = 0;
  const impl = async () => {
    const r = responses[Math.min(call, responses.length - 1)];
    call += 1;
    if (r instanceof Error) throw r;
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body ?? { elements: [] },
      text: async () => JSON.stringify(r.body ?? {}),
    };
  };
  impl.calls = () => call;
  return impl;
}

// 1) 성공 시 1회 호출, JSON 반환
{
  __clearCacheForTest();
  const f = makeFetch([{ status: 200, body: { elements: [1, 2] } }]);
  const out = await overpassFetch("Q1", { fetchImpl: f });
  assert.deepEqual(out, { elements: [1, 2] });
  assert.equal(f.calls(), 1);
}

// 2) 같은 쿼리는 캐시 반환 (fetch 재호출 없음)
{
  __clearCacheForTest();
  const f = makeFetch([{ status: 200, body: { elements: ["a"] } }]);
  await overpassFetch("Q2", { fetchImpl: f });
  const out2 = await overpassFetch("Q2", { fetchImpl: f });
  assert.deepEqual(out2, { elements: ["a"] });
  assert.equal(f.calls(), 1);
}

// 3) 429 → 재시도 후 성공 (총 2회 호출)
{
  __clearCacheForTest();
  const f = makeFetch([{ status: 429 }, { status: 200, body: { elements: ["r"] } }]);
  const out = await overpassFetch("Q3", { fetchImpl: f, maxRetries: 2 });
  assert.deepEqual(out, { elements: ["r"] });
  assert.equal(f.calls(), 2);
}

// 4) 계속 실패하면 마지막 오류 throw (maxRetries+1회 호출)
{
  __clearCacheForTest();
  const f = makeFetch([{ status: 500 }]);
  await assert.rejects(() => overpassFetch("Q4", { fetchImpl: f, maxRetries: 2 }));
  assert.equal(f.calls(), 3);
}

// 5) 실패 응답은 캐시되지 않음
{
  __clearCacheForTest();
  const f = makeFetch([{ status: 500 }, { status: 500 }, { status: 500 }, { status: 200, body: { elements: ["ok"] } }]);
  await assert.rejects(() => overpassFetch("Q5", { fetchImpl: f, maxRetries: 2 }));
  const out = await overpassFetch("Q5", { fetchImpl: f, maxRetries: 0 });
  assert.deepEqual(out, { elements: ["ok"] });
}

console.log("overpass-fetch: all tests passed");
```

- [ ] **Step 2: tsx devDependency 추가 후 테스트 실패 확인**

```powershell
npm install -D tsx
npx tsx src/scripts/test-overpass-fetch.mjs
```
Expected: FAIL — `Cannot find module '../lib/server/overpass-fetch.ts'`

- [ ] **Step 3: overpass-fetch.ts 구현**

```ts
// src/lib/server/overpass-fetch.ts
// Overpass API 공유 fetch. 문제: poi/park/subway-routes 세 모듈이 각자 Overpass를
// 연달아 때려 슬롯 고갈(429)로 한 소스가 통째로 죽는다. 해결: 쿼리 단위 TTL 캐시 +
// 지수 백오프 재시도를 한 곳에서 제공한다.
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const DEFAULT_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE = 100;
const DEFAULT_TIMEOUT_MS = 45_000;
const BACKOFF_MS = [1_000, 3_000];

interface CacheEntry {
  readonly value: unknown;
  readonly ts: number;
}

const cache = new Map<string, CacheEntry>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function __clearCacheForTest(): void {
  cache.clear();
}

export interface OverpassFetchOptions {
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly cacheTtlMs?: number;
  readonly maxRetries?: number;
}

export async function overpassFetch(query: string, opts: OverpassFetchOptions = {}): Promise<unknown> {
  const ttl = opts.cacheTtlMs ?? DEFAULT_TTL_MS;
  const maxRetries = opts.maxRetries ?? 2;
  const doFetch = opts.fetchImpl ?? fetch;

  const cached = cache.get(query);
  if (cached && Date.now() - cached.ts < ttl) {
    return cached.value;
  }

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      await sleep(BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)]);
    }
    try {
      const res = await doFetch(OVERPASS_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": "*/*",
          "User-Agent": "SiteAnalysisApp/1.0",
        },
        body: new URLSearchParams({ data: query }).toString(),
        signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
      if (!res.ok) {
        const text = await res.text();
        lastError = new Error(`Overpass API error [${res.status}]: ${text.slice(0, 200)}`);
        continue; // 429/5xx → 재시도
      }
      const value = await res.json();
      if (cache.size >= MAX_CACHE) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      cache.set(query, { value, ts: Date.now() });
      return value;
    } catch (err) {
      lastError = err; // 네트워크 오류/타임아웃 → 재시도
    }
  }
  throw lastError;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx tsx src/scripts/test-overpass-fetch.mjs`
Expected: `overpass-fetch: all tests passed`
주의: 테스트 4번(재시도 백오프)은 실제 sleep 1s+3s를 기다린다 — 총 실행 ~10초는 정상.

- [ ] **Step 5: 세 호출처 교체**

`src/lib/overpass-api.ts`의 `overpassPoiSearch` fetch 블록(43~60행 부근)을:
```ts
import { overpassFetch } from "./server/overpass-fetch";
// ...
const data = (await overpassFetch(query)) as { elements: OverpassElement[] };
return data.elements;
```
로 교체 (기존 fetch/헤더/에러처리 삭제 — overpassFetch가 담당). `OVERPASS_URL` 상수가 미사용이 되면 삭제.

`src/lib/server/park-search.ts`의 Overpass fetch(290행 부근)도 동일 패턴으로 교체 — 해당 함수의 쿼리 문자열을 그대로 `overpassFetch(query)`에 전달하고 기존 res.ok 검사/파싱 코드를 제거.

`src/lib/overpass-subway-routes.ts`의 fetch(93행 부근)도 동일 교체. `/api/subway-routes` 라우트의 기존 10분 캐시는 그대로 둔다(이중 캐시 무해).

- [ ] **Step 6: 타입/빌드 확인 + 실동작 확인**

```powershell
npx tsc --noEmit
npm run build
```
Expected: 성공. dev 서버 기동 후 재현 curl(Global Constraints 참조)을 2회 실행 —
Expected: 두 번째 호출에서 subway/school/mountain 포함 (첫 호출은 rate-limit 상황에 따라 재시도로 회복되거나, 최소 재실행 시 캐시로 성공). `warnings`에 "osm"이 없어야 함.

- [ ] **Step 7: 커밋**

```powershell
git add src/lib/server/overpass-fetch.ts src/scripts/test-overpass-fetch.mjs src/lib/overpass-api.ts src/lib/server/park-search.ts src/lib/overpass-subway-routes.ts package.json package-lock.json
git commit -m "fix: Overpass 호출 공유 모듈화 — TTL 캐시+재시도로 소스 연쇄 소실 해결"
```

---

### Task 2: 빈 카테고리 패널 empty-state (canvas + pptx 동시)

**Files:**
- Modify: `src/lib/ppt-canvas-renderer.ts`
- Modify: `src/lib/ppt-generator.ts`
- Test: `qa/validate-preview-parity.mjs` (생성)

**Interfaces:**
- Consumes: 두 파일의 기존 카테고리 슬라이드(교통/교육/자연/분양 등) 패널 그리기 함수
- Produces: 공통 상수 `EMPTY_PANEL_TEXT = "반경 내 확인된 시설이 없습니다"` — 두 파일 모두 이 **정확한 문자열**을 사용

- [ ] **Step 1: 현재 동작 파악**

두 파일에서 카테고리별 목록 패널을 그리는 함수(교통 분석 흰 패널 — QA에서 데이터 0건일 때 빈 흰 박스로 렌더됨)를 찾는다:
```powershell
grep -n "교통 분석" src/lib/ppt-canvas-renderer.ts src/lib/ppt-generator.ts
grep -n "역세권\|지하철역" src/lib/ppt-canvas-renderer.ts | head
```
패널에 항목이 0건일 때 아무 텍스트도 넣지 않는 분기를 확인한다.

- [ ] **Step 2: parity 검증 스크립트 작성 (실패 확인)**

```js
// qa/validate-preview-parity.mjs
// 미리보기(canvas)와 PPT(pptx) 렌더러가 같은 empty-state 문자열을 쓰는지 정적 검증.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const canvas = readFileSync("src/lib/ppt-canvas-renderer.ts", "utf8");
const pptx = readFileSync("src/lib/ppt-generator.ts", "utf8");
const TEXT = "반경 내 확인된 시설이 없습니다";

assert.ok(canvas.includes(TEXT), `canvas renderer missing empty-state text: ${TEXT}`);
assert.ok(pptx.includes(TEXT), `pptx generator missing empty-state text: ${TEXT}`);
console.log("preview parity: empty-state OK");
```

Run: `node qa/validate-preview-parity.mjs`
Expected: FAIL (아직 어느 쪽에도 문자열 없음)

- [ ] **Step 3: 두 렌더러에 empty-state 추가**

카테고리 목록 패널 그리기에서 항목 0건일 때:
- canvas: 패널 배경은 그대로 그리되 중앙에 `"반경 내 확인된 시설이 없습니다"`를 기존 본문 폰트 스타일(회색 `d.subTextColor` 계열, 기존 본문 크기)로 렌더
- pptx: 같은 조건에서 같은 문자열을 `slide.addText`로 같은 위치에 추가
- 두 파일에서 동일한 조건식(`items.length === 0` 등 해당 함수의 항목 배열 기준)을 사용

- [ ] **Step 4: 검증**

```powershell
node qa/validate-preview-parity.mjs
npx tsc --noEmit
```
Expected: `preview parity: empty-state OK`, 타입 클린

- [ ] **Step 5: 커밋**

```powershell
git add src/lib/ppt-canvas-renderer.ts src/lib/ppt-generator.ts qa/validate-preview-parity.mjs
git commit -m "fix: 카테고리 데이터 0건 시 빈 흰 패널 대신 안내 문구 (미리보기·PPT 동기)"
```

---

### Task 3: 점수 대시보드 가독성 — 지도 위 직접 텍스트에 배경 처리

**Files:**
- Modify: `src/lib/ppt-canvas-renderer.ts` (점수 대시보드 슬라이드)
- Modify: `src/lib/ppt-generator.ts` (동일 슬라이드 — `addScoreDashboardSlide`)

**Interfaces:**
- Consumes: 점수 대시보드 슬라이드 함수 (`addScoreDashboardSlide` 및 canvas 대응 함수), `PptDesignConfig`의 색 토큰
- Produces: 없음 (시각 변경만)

- [ ] **Step 1: 문제 확인**

QA 스크린샷 기준: 카테고리 점수 바(교통/교육/자연/주거 공급/개발·정비) 오른쪽의 설명 텍스트가 반투명 지도 위에 직접 얹혀 대비가 낮다. 두 파일에서 해당 텍스트 그리기 코드를 찾는다:
```powershell
grep -n "반경내\|최근접 역\|카테고리" src/lib/ppt-generator.ts | head
```

- [ ] **Step 2: 배경 카드 추가 (양쪽 동일)**

점수 바 + 설명 텍스트 영역 전체 뒤에 흰색 반투명 패널(기존 TOTAL 카드와 같은 스타일 — `d.canvasColor` 기반, 같은 투명도/테두리 값 재사용)을 깐다. 위치·크기 값은 기존 바 레이아웃 좌표를 감싸도록 산출 (바 x 시작 ~ 설명 텍스트 끝 + 여백 0.15in). canvas와 pptx 둘 다 같은 인치 좌표를 사용하므로 같은 값을 양쪽에 적용.

- [ ] **Step 3: 육안 검증**

dev 서버에서 샘플 실행 → PPT 미리보기 → 점수 대시보드 스크린샷. 설명 텍스트가 패널 위에 올라와 가독성 개선 확인. `npx tsc --noEmit` 클린.

- [ ] **Step 4: 커밋**

```powershell
git add src/lib/ppt-canvas-renderer.ts src/lib/ppt-generator.ts
git commit -m "design: 점수 대시보드 점수바·설명 영역에 배경 패널 — 지도 위 텍스트 가독성"
```

---

### Task 4: 데이터 정상 상태 라이브 QA + 발견 결함 수정

**Files:**
- 수정 대상은 QA 결과에 따름 (원칙: 슬라이드 시각 변경은 두 렌더러 동시)

- [ ] **Step 1: dev 서버 + 로컬 계정으로 전체 흐름 QA**

qa-tester 계정(있으면 재사용, 없으면 signup API로 생성) → 샘플 실행(청와대) → 데이터 로드 확인 (Task 1 이후 subway 15·school 89·park 51·mountain 10이 와야 함) → PPT 미리보기 15장 각각 스크린샷.

체크리스트:
1. 교통 분석: 역 마커 + 역 목록 패널 채워짐 (빈 패널 아님)
2. 점수 대시보드: 교통 점수가 0이 아님 ("반경 내 확인된 지하철역이 없습니다" 사라짐)
3. 각 슬라이드 텍스트 겹침/잘림/대비
4. 키 없는 카테고리(분양 등): Task 2의 empty-state 문구가 표시됨
5. 콘솔 에러 0건

- [ ] **Step 2: PPT 다운로드 + XML 검증**

미리보기에서 PPT 다운로드 실행. 다운로드가 헤드리스에서 저장 안 되면 node에서 직접 생성:
```powershell
# pptxgenjs가 node에서 write 가능 — 간단 스크립트로 슬라이드 XML에 <a:t>, graphicFrame 존재 확인
```
슬라이드 텍스트/도형이 네이티브인지(`<a:t>`, `<p:sp>`), 이미지는 지도뿐인지 확인.

- [ ] **Step 3: 발견 결함 수정 + 개별 커밋**

시각 결함은 두 렌더러 동시 수정 원칙. 수정마다 `npx tsc --noEmit` + 해당 화면 재확인.

```powershell
git add -A && git commit -m "fix: 라이브 QA 발견 결함 수정"
```

---

### Task 5: 최종 검증 (Fable 5) — whole-branch 리뷰 + 회귀 게이트

**Files:** 없음 (검증)

- [ ] **Step 1: 회귀 게이트 일괄 실행**

```powershell
npx tsx src/scripts/test-overpass-fetch.mjs
node qa/validate-preview-parity.mjs
npx tsc --noEmit
npm run build
```
Expected: 전부 성공

- [ ] **Step 2: whole-branch 리뷰 디스패치**

`scripts/review-package a678cd8 HEAD`로 패키지 생성 → **model fable** 리뷰어에게 requesting-code-review 템플릿으로 디스패치. Critical/Important는 수정 후 재리뷰.

---

### Task 6: Lightsail 배포

**Files:** 없음 (서버 작업). 사전조건: Task 5 승인.

- [ ] **Step 1: GitHub 반영**

```powershell
git checkout main && git merge --ff-only feature/slidespec-preview-on-main 2>$null; if ($LASTEXITCODE -ne 0) { git merge feature/slidespec-preview-on-main }
git push origin main
```

- [ ] **Step 2: 서버 사전 점검 (읽기 전용)**

```bash
SSH='ssh -i /d/V-coding/LightsailDefaultKey-ap-northeast-2.pem -o BatchMode=yes bitnami@43.200.41.165'
$SSH "node -v; df -h /home | tail -1; ls ~/site-analysis/.env ~/site-analysis/.cache/site-analysis.db"
```
Node 메이저가 로컬(개발)과 크게 다르면 중단하고 보고. 디스크 여유 1GB 미만이면 중단하고 보고.

- [ ] **Step 3: 소스 동기화 (보존 파일 제외)**

서버는 git 저장소가 아니므로 tar 스트림으로 전송 (rsync가 Windows에 없음):
```bash
git archive HEAD | ssh -i /d/V-coding/LightsailDefaultKey-ap-northeast-2.pem bitnami@43.200.41.165 "mkdir -p ~/site-analysis-new && tar -x -C ~/site-analysis-new"
```
새 디렉터리에 풀어서 기존 앱을 건드리지 않는다. `.env`/`.cache`는 tar에 없음(gitignore) — 기존 것을 링크/복사한다:
```bash
$SSH "cp ~/site-analysis/.env ~/site-analysis-new/.env && cp -r ~/site-analysis/.cache ~/site-analysis-new/.cache 2>/dev/null || true"
```

- [ ] **Step 4: 서버 빌드**

```bash
$SSH "cd ~/site-analysis-new && npm ci --no-audit --no-fund && npm run build 2>&1 | tail -5"
```
Expected: 빌드 성공. 실패 시 기존 앱은 무손상 — 원인 보고 후 중단.

- [ ] **Step 5: 무중단 스왑 + 재시작**

```bash
$SSH "cd ~ && mv site-analysis site-analysis-prev && mv site-analysis-new site-analysis && pm2 restart site-analysis && sleep 5 && pm2 list | grep site-analysis"
```
standalone 실행 스크립트 경로(`.next/standalone/server.js`)는 pm2 설정에 절대경로로 저장되어 있어 디렉터리 스왑 후 restart로 새 빌드가 뜬다. `.next/standalone` 내부에 `.env`가 복사되는지 확인 (Next standalone은 `.env`를 cwd에서 읽음 — pm2 exec cwd가 `~/site-analysis`이므로 OK).

- [ ] **Step 6: 스모크 테스트 + 롤백 기준**

```bash
curl -s -o /dev/null -w "%{http_code}" http://43.200.41.165/site        # 200
curl -s -o /dev/null -w "%{http_code}" http://43.200.41.165/site/login  # 200
```
로그인 → 샘플 실행 → 미리보기까지 브라우저로 1회 확인 (프로덕션 qa 계정 생성은 하지 않는다 — 사용자에게 배포 완료 보고 후 사용자 계정으로 확인 요청).
실패 시 롤백:
```bash
$SSH "cd ~ && mv site-analysis site-analysis-failed && mv site-analysis-prev site-analysis && pm2 restart site-analysis"
```
성공 시 1일 뒤 `site-analysis-prev` 정리 안내를 보고에 포함.

---

## Self-Review 결과

- **커버리지**: 재현된 osm 소실 버그(Task 1), 빈 패널(Task 2), 가독성(Task 3), 전수 QA(Task 4), 검증(Task 5), 배포+보존+롤백(Task 6) — 목표 전부 매핑.
- **주의된 리스크**: Task 1 Step 6의 실동작 확인은 외부 Overpass 상태에 의존 — 재시도·캐시 특성상 "재실행 시 성공"까지 허용 기준으로 명시. Task 2/3는 대상 함수명을 grep으로 찾게 함(1685/1808줄 파일이라 행 번호 고정이 불가능) — 구현자가 함수를 못 찾으면 NEEDS_CONTEXT로 반환할 것.
- **모델 배정**: 구현 태스크(1~4) = sonnet, 태스크 리뷰·최종 리뷰(5) = fable, 배포(6)는 컨트롤러가 직접 수행.
