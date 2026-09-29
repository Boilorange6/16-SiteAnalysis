# SiteAnalysis v2 P0 (검증·기반) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** v2의 데이터 기반(교체형 데이터 파일 + manifest + 공간 조회 + 품질 검사 + `tile_result` 계약 + 별도 앱 DB)을 만들고, 한 분석이 화면·PPT용 결과까지 같은 manifest 해시를 가리키는 것을 끝에서 끝까지 증명하며, A0 검증표를 채울 측정 도구와 검증 문서를 만든다.

**Architecture:** v2 코드는 전부 `src/lib/v2/` 아래 새 모듈로 만든다. 기존 앱 모듈(`src/lib/server/**`)은 수정하지 않고 읽기 전용으로만 import한다. 공공데이터는 `V2_DATA_DIR/versions/<version>/*.sqlite` 읽기 전용 파일로 두고, `manifest.json` 포인터 하나를 원자적으로 바꿔 전환한다. 사용자·분석 결과는 `V2_APP_DB_PATH`의 별도 SQLite에 둔다. 공간 조회는 EPSG:5179(UTM-K, 미터)로 저장한 GeoJSON + SQLite R*Tree 후보 검색 + turf 정밀 판정이다.

**Tech Stack:** TypeScript, better-sqlite3 12 (SQLite 3.53, R*Tree 내장 확인), proj4 2.20, @turf/turf 7.3, zod 4.3, shapefile 0.6, tsx 테스트(`node:assert/strict`).

**Spec:** `docs/superpowers/specs/2026-09-29-site-analysis-v2-design.md` (§3 데이터 구조, §5.2 `tile_result`, §6 P0, §6.1 검수 지역, §7 위험). 상세 근거: `docs/research/2026-09-29-data-architecture-astra.md` §4.

## Global Constraints

- 기존 앱 파일(`src/lib/server/**`, `src/app/**`, `src/components/**`, `deploy/**`)은 **수정하지 않는다**. v2는 import만 한다(spec §4.6).
- v2 앱 DB 경로는 `V2_APP_DB_PATH`(기본 `.cache/v2/app.sqlite`), 데이터 디렉터리는 `V2_DATA_DIR`(기본 `.cache/v2/data`). 기존 `DB_PATH`(기본 `.cache/site-analysis.db`)와 같으면 실행을 거부한다.
- PNU·법정동 코드는 **문자열**이다. `Number`로 바꾸지 않는다(spec §3.3).
- 모르는 값은 `NULL`이다. 0이나 오늘 날짜로 채우지 않는다. `value_status`는 `observed / estimated / suppressed / missing / not_applicable`(spec §3.3).
- 거리·면적은 EPSG:5179 미터 좌표로 계산한다. Web Mercator로 계산하지 않는다(spec §3.3).
- 분석 시간대는 `Asia/Seoul`, 분석 기준일은 `YYYY-MM-DD` 문자열(spec §5.2).
- 새 npm 의존성을 추가하지 않는다. `npm install`을 실행하지 않는다. 의존성이 없어 보이면 BLOCKED로 보고한다.
- 테스트는 `src/scripts/v2/test-*.mjs`에 `node:assert/strict`로 쓰고 `npx tsx <파일>`로 실행한다(기존 `src/scripts/test-*.mjs` 관례).
- 커밋은 `git -c user.name=boilorange -c user.email=impgy613@gmail.com commit -F <메시지파일>`로 한다(이 PC에 git 전역 사용자가 없음). 메시지는 기존 관례대로 한국어 `feat:`/`test:`/`docs:` 접두사, 마지막에 아래 두 줄을 실제 줄바꿈으로 붙인다:
  ```
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01AusXwp6sJGXBRZEjcohHWc
  ```
- 푸시·배포하지 않는다.

## Review Focus

1. **19자리 PNU를 숫자로 넘기는 호출** — JS에서 `1168010100100010000`은 정밀도가 깨진다. `insertFeature`는 문자열이 아닌 PNU를 TypeError로 거부해야 한다(Task 3 테스트).
2. **대표점은 반경 밖인데 경계가 반경에 걸친 필지·구역** — 반드시 결과에 포함되어야 하고, bbox만 겹치고 원과 안 겹치는 모서리 객체는 빠져야 한다(Task 3 테스트).
3. **게시 도중 실패·손상된 파일** — 해시 불일치, WAL 잔존, 품질 검사 실패, 게시 후 재확인 불일치 어느 경우에도 현재 `manifest.json`은 직전 정상본이어야 한다(Task 5 테스트).
4. **저장된 프로젝트가 참조하는 옛 데이터 버전의 정리** — 가비지 수집은 핀 고정 manifest의 파일을 지우면 안 되고, 핀 manifest 원본이 없으면 아무것도 지우지 않고 중단해야 한다(Task 5, Task 8 테스트).
5. **EUC-KR 공공데이터 CSV** — 대부분의 data.go.kr CSV가 CP949다. 측정 도구가 UTF-8로 잘못 읽으면 채움률이 조용히 틀린다. BOM·EUC-KR을 자동 판별해야 한다(Task 9 테스트).

---

## File Structure

| 파일 | 책임 |
|---|---|
| `src/lib/v2/crs.ts` | WGS84 ↔ EPSG:5179 변환 |
| `src/lib/v2/canonical-json.ts` | 키 정렬 JSON 직렬화, SHA-256 |
| `src/lib/v2/paths.ts` | v2 앱 DB·데이터 디렉터리 경로, 기존 DB와 충돌 거부 |
| `src/lib/v2/data/schema.ts` | 데이터 파일(core/reference/market/osm) 스키마 |
| `src/lib/v2/data/features.ts` | 공간 객체 적재·반경 조회 |
| `src/lib/v2/data/quality-gate.ts` | 적재 품질 검사, 고정 지점 기대치 검사 |
| `src/lib/v2/data/manifest.ts` | manifest 해시·검증·원자 게시·롤백·가비지 수집·데이터 파일 열기 |
| `src/lib/v2/tile-result.ts` | `tile_result` 계약(zod)과 캐시 키 |
| `src/lib/v2/app-db.ts` | v2 앱 DB 스키마·분석 실행·타일 결과·저장 프로젝트 |
| `src/lib/v2/analysis-skeleton.ts` | P0 끝에서 끝 증명용 최소 분석(D02 건물 수 타일) |
| `src/lib/v2/a0/review-sites.ts` | 검수 대표 지역 8곳 |
| `src/lib/v2/a0/measure.ts` | 인코딩 판별, CSV·SHP 레코드, 채움률·지역·검수지 측정 |
| `src/scripts/v2/a0-measure.mjs` | 측정 CLI |
| `src/scripts/v2/test-*.mjs` | 각 모듈 테스트 |
| `docs/superpowers/a0/2026-09-29-a0-verification.md` | A0 검증표 |
| `package.json` | `test:v2` 스크립트만 추가 |

---

### Task 1: v2 기반 모듈 (좌표계·정규 JSON·경로)

**Files:**
- Create: `src/lib/v2/crs.ts`, `src/lib/v2/canonical-json.ts`, `src/lib/v2/paths.ts`
- Test: `src/scripts/v2/test-v2-foundations.mjs`
- Modify: `package.json` (`scripts`에 `test:v2` 추가)

**Interfaces:**
- Produces:
  - `type LngLat = readonly [number, number]`, `type XY = readonly [number, number]`, `const UTMK = "EPSG:5179"`, `toUtmk(p: LngLat): XY`, `toLngLat(p: XY): LngLat`
  - `canonicalJson(value: unknown): string`, `sha256Hex(text: string): string`
  - `legacyDbPath(): string`, `v2AppDbPath(): string`, `v2DataDir(): string`

- [ ] **Step 1: Write the failing test**

`src/scripts/v2/test-v2-foundations.mjs`:

```js
/**
 * v2 기반 모듈 테스트.
 * 좌표계가 틀리면 모든 거리·면적이 조용히 틀리고,
 * 정규 JSON이 키 순서에 흔들리면 같은 manifest가 다른 해시를 갖는다.
 */
import assert from "node:assert/strict";
import { resolve } from "node:path";

const { toUtmk, toLngLat, UTMK } = await import("../../lib/v2/crs.ts");
const { canonicalJson, sha256Hex } = await import("../../lib/v2/canonical-json.ts");
const { v2AppDbPath, v2DataDir, legacyDbPath } = await import("../../lib/v2/paths.ts");

// ─── 1. 좌표 왕복 ──────────────────────────────────────────────────────────
{
  assert.equal(UTMK, "EPSG:5179");
  const cityHall = [126.978, 37.5665];
  const back = toLngLat(toUtmk(cityHall));
  assert.ok(Math.abs(back[0] - cityHall[0]) < 1e-9, "경도 왕복 오차");
  assert.ok(Math.abs(back[1] - cityHall[1]) < 1e-9, "위도 왕복 오차");
}

// ─── 2. 투영 거리가 실제 거리와 0.2% 안에서 맞는다 ─────────────────────────
{
  const a = [126.978, 37.5665];
  const b = [126.978, 37.5755];
  const [ax, ay] = toUtmk(a);
  const [bx, by] = toUtmk(b);
  const planar = Math.hypot(bx - ax, by - ay);
  const R = 6371008.8;
  const haversine = R * ((b[1] - a[1]) * Math.PI) / 180; // 같은 경도, 위도 차이만
  assert.ok(Math.abs(planar - haversine) / haversine < 0.002, `planar=${planar} haversine=${haversine}`);
}

// ─── 3. 정규 JSON ──────────────────────────────────────────────────────────
{
  assert.equal(canonicalJson({ b: 1, a: { d: [1, 2], c: "x" } }), '{"a":{"c":"x","d":[1,2]},"b":1}');
  assert.equal(canonicalJson({ a: 1, b: 2 }), canonicalJson({ b: 2, a: 1 }), "키 순서와 무관");
  assert.equal(canonicalJson({ a: 1, skip: undefined }), '{"a":1}', "undefined 속성은 뺀다");
  assert.equal(canonicalJson(null), "null");
  assert.throws(() => canonicalJson({ a: Number.NaN }), TypeError, "NaN은 거부");
  assert.throws(() => canonicalJson([undefined]), TypeError, "배열 속 undefined는 거부");
  assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
}

// ─── 4. 경로: v2 앱 DB가 기존 DB와 같으면 거부 ─────────────────────────────
{
  const saved = { DB_PATH: process.env.DB_PATH, V2_APP_DB_PATH: process.env.V2_APP_DB_PATH, V2_DATA_DIR: process.env.V2_DATA_DIR };
  try {
    delete process.env.DB_PATH;
    delete process.env.V2_APP_DB_PATH;
    delete process.env.V2_DATA_DIR;
    assert.equal(legacyDbPath(), resolve(process.cwd(), ".cache/site-analysis.db"));
    assert.equal(v2AppDbPath(), resolve(process.cwd(), ".cache/v2/app.sqlite"));
    assert.equal(v2DataDir(), resolve(process.cwd(), ".cache/v2/data"));

    process.env.DB_PATH = "C:/tmp/Same.db";
    process.env.V2_APP_DB_PATH = "c:/tmp/same.db";
    assert.throws(() => v2AppDbPath(), /must differ/, "대소문자만 다른 같은 경로도 거부(Windows)");

    process.env.V2_APP_DB_PATH = "C:/tmp/v2.db";
    assert.equal(v2AppDbPath(), "C:/tmp/v2.db");
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

console.log("✓ v2 foundations");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx src/scripts/v2/test-v2-foundations.mjs`
Expected: FAIL — `Cannot find module '.../src/lib/v2/crs.ts'`

- [ ] **Step 3: Write minimal implementation**

`src/lib/v2/crs.ts`:

```ts
/**
 * v2의 모든 거리·면적은 EPSG:5179(UTM-K, 미터)에서 계산한다.
 * Web Mercator 면적은 위도에 따라 부풀어서 구성비가 틀린다.
 */
import proj4 from "proj4";

export const UTMK = "EPSG:5179";
proj4.defs(UTMK, "+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +units=m +no_defs");

export type LngLat = readonly [number, number];
export type XY = readonly [number, number];

export function toUtmk([lng, lat]: LngLat): XY {
  const [x, y] = proj4("EPSG:4326", UTMK, [lng, lat]);
  return [x, y];
}

export function toLngLat([x, y]: XY): LngLat {
  const [lng, lat] = proj4(UTMK, "EPSG:4326", [x, y]);
  return [lng, lat];
}
```

`src/lib/v2/canonical-json.ts`:

```ts
/**
 * 키를 정렬한 JSON. manifest 해시와 타일 캐시 키가 키 순서에 흔들리지 않게 한다.
 */
import { createHash } from "node:crypto";

export function canonicalJson(value: unknown): string {
  if (value === undefined) throw new TypeError("canonicalJson: undefined is not serializable");
  if (typeof value === "number" && !Number.isFinite(value)) throw new TypeError("canonicalJson: non-finite number");
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
```

`src/lib/v2/paths.ts`:

```ts
/**
 * v2는 기존 앱 DB를 건드리지 않는다(spec §4.6).
 * 두 경로가 같게 설정되면 사용자 데이터가 섞이므로 시작부터 거부한다.
 */
import { resolve } from "node:path";

/** 기존 src/lib/server/database.ts의 DB_PATH 규칙과 같다. 그 파일을 수정하지 않으려고 복제했다. */
export function legacyDbPath(): string {
  return process.env.DB_PATH || resolve(process.cwd(), ".cache/site-analysis.db");
}

export function v2AppDbPath(): string {
  const path = process.env.V2_APP_DB_PATH || resolve(process.cwd(), ".cache/v2/app.sqlite");
  if (resolve(path).toLowerCase() === resolve(legacyDbPath()).toLowerCase()) {
    throw new Error("V2_APP_DB_PATH must differ from the legacy DB_PATH");
  }
  return path;
}

export function v2DataDir(): string {
  return process.env.V2_DATA_DIR || resolve(process.cwd(), ".cache/v2/data");
}
```

`package.json` `scripts`에 한 줄 추가(다른 줄은 건드리지 않는다):

```json
"test:v2": "tsx src/scripts/v2/test-v2-foundations.mjs",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:v2`
Expected: `✓ v2 foundations`

Run: `npx tsc --noEmit`
Expected: 오류 0

- [ ] **Step 5: Commit**

```bash
git add src/lib/v2/crs.ts src/lib/v2/canonical-json.ts src/lib/v2/paths.ts src/scripts/v2/test-v2-foundations.mjs package.json
# 메시지 파일: "feat: v2 기반 모듈 — UTM-K 좌표계, 정규 JSON, 기존 DB와 분리된 경로" + 트레일러
git -c user.name=boilorange -c user.email=impgy613@gmail.com commit -F <메시지파일>
```

---

### Task 2: 데이터 파일 스키마

**Files:**
- Create: `src/lib/v2/data/schema.ts`
- Test: `src/scripts/v2/test-v2-data-schema.mjs`
- Modify: `package.json` (`test:v2` 끝에 ` && tsx src/scripts/v2/test-v2-data-schema.mjs`)

**Interfaces:**
- Produces:
  - `type DataFileKind = "core" | "reference" | "market" | "osm"`, `const DATA_FILE_KINDS: readonly DataFileKind[]`
  - `const DATA_SCHEMA_VERSION = 1`
  - `const VALUE_STATUSES = ["observed","estimated","suppressed","missing","not_applicable"] as const`
  - `initDataFileSchema(db: BetterSqlite3.Database, kind: DataFileKind): void`
  - `readDataFileMeta(db): { kind: DataFileKind; schemaVersion: number }`
  - 테이블: 공통 `data_file_meta`, `source_release`, `ingest_run`, `feature`, `feature_rtree`, `feature_link`, `observation`; core 전용 `building_fact`; market 전용 `property_transaction`, `development_event`

- [ ] **Step 1: Write the failing test**

`src/scripts/v2/test-v2-data-schema.mjs`:

```js
/**
 * 데이터 파일 스키마 테스트.
 * PNU를 숫자로 저장하면 19자리가 깨지고, 높이를 0으로 채우면 "모름"과 "0m"가 섞인다.
 */
import assert from "node:assert/strict";
import Database from "better-sqlite3";

const { initDataFileSchema, readDataFileMeta, DATA_SCHEMA_VERSION, DATA_FILE_KINDS } = await import("../../lib/v2/data/schema.ts");

function tables(db) {
  return new Set(db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table')").all().map((r) => r.name));
}

function seedRelease(db) {
  db.prepare(`INSERT INTO source_release (release_id, source_id, provider, source_url, fetched_at, checksum, schema_version, license_code)
    VALUES ('r1','gis_building','국토교통부','https://www.data.go.kr/data/15083092/fileData.do','2026-09-29T00:00:00+09:00','abc',1,'KOGL-1')`).run();
}

// ─── 1. 종류별 테이블 ──────────────────────────────────────────────────────
{
  assert.deepEqual([...DATA_FILE_KINDS], ["core", "reference", "market", "osm"]);
  for (const kind of DATA_FILE_KINDS) {
    const db = new Database(":memory:");
    initDataFileSchema(db, kind);
    const t = tables(db);
    for (const common of ["data_file_meta", "source_release", "ingest_run", "feature", "feature_link", "observation"]) {
      assert.ok(t.has(common), `${kind}: ${common}`);
    }
    assert.ok(t.has("feature_rtree"), `${kind}: R*Tree`);
    assert.equal(t.has("building_fact"), kind === "core", `${kind}: building_fact`);
    assert.equal(t.has("property_transaction"), kind === "market", `${kind}: property_transaction`);
    assert.equal(t.has("development_event"), kind === "market", `${kind}: development_event`);
    assert.deepEqual(readDataFileMeta(db), { kind, schemaVersion: DATA_SCHEMA_VERSION });
    initDataFileSchema(db, kind); // 두 번 불러도 안전
  }
}

// ─── 2. 다른 종류로 다시 초기화하면 거부 ────────────────────────────────────
{
  const db = new Database(":memory:");
  initDataFileSchema(db, "core");
  assert.throws(() => initDataFileSchema(db, "market"), /already initialized as core/);
}

// ─── 3. PNU는 문자열 그대로, 높이 미상은 NULL ───────────────────────────────
{
  const db = new Database(":memory:");
  initDataFileSchema(db, "core");
  seedRelease(db);
  db.prepare(`INSERT INTO feature (stable_id, kind, source_key, release_id, geom_json, pnu) VALUES ('b1','building','k1','r1','{}','1168010100100010000')`).run();
  const row = db.prepare("SELECT pnu, typeof(pnu) AS t FROM feature WHERE stable_id='b1'").get();
  assert.equal(row.pnu, "1168010100100010000");
  assert.equal(row.t, "text");

  const id = db.prepare("SELECT feature_id FROM feature WHERE stable_id='b1'").get().feature_id;
  db.prepare("INSERT INTO building_fact (feature_id, height_method) VALUES (?, 'unknown')").run(id);
  const fact = db.prepare("SELECT height_m, floors_above, approval_date FROM building_fact WHERE feature_id=?").get(id);
  assert.deepEqual(fact, { height_m: null, floors_above: null, approval_date: null }, "미상은 NULL");
  assert.throws(() => db.prepare("INSERT INTO building_fact (feature_id, height_method) VALUES (?, 'guess')").run(id + 1), /CHECK/);
}

// ─── 4. value_status 제약 ──────────────────────────────────────────────────
{
  const db = new Database(":memory:");
  initDataFileSchema(db, "reference");
  seedRelease(db);
  const ins = db.prepare(`INSERT INTO observation (subject_id, metric, period_start, period_end, value, unit, value_status, release_id, method_version)
    VALUES ('g1','population','2025-01-01','2025-12-31',?,'명',?,'r1','sgis@1')`);
  ins.run(null, "suppressed");
  assert.throws(() => ins.run(0, "zero"), /CHECK/);
}

// ─── 5. ingest_run 상태 제약 ───────────────────────────────────────────────
{
  const db = new Database(":memory:");
  initDataFileSchema(db, "market");
  assert.throws(
    () => db.prepare("INSERT INTO ingest_run (run_id, source_id, started_at, status) VALUES ('x','rtms','2026-09-29T00:00:00+09:00','ok')").run(),
    /CHECK/,
  );
}

console.log("✓ v2 data schema");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx src/scripts/v2/test-v2-data-schema.mjs`
Expected: FAIL — `Cannot find module '.../src/lib/v2/data/schema.ts'`

- [ ] **Step 3: Write minimal implementation**

`src/lib/v2/data/schema.ts`:

```ts
/**
 * v2 데이터 파일 스키마 (spec §3.2~3.3).
 *
 * 데이터 파일은 로컬 PC에서 만들어 읽기 전용으로 게시한다. 파일 하나가 한 종류(core/reference/market/osm)다.
 * geom_json은 EPSG:5179 미터 좌표의 GeoJSON geometry다.
 * ponytail: WKB 대신 GeoJSON 텍스트 — 파일 크기가 커진다. A0 실측에서 core가 디스크 예산을 넘으면 WKB로 바꾼다.
 */
import type BetterSqlite3 from "better-sqlite3";

type Db = BetterSqlite3.Database;

export type DataFileKind = "core" | "reference" | "market" | "osm";
export const DATA_FILE_KINDS: readonly DataFileKind[] = ["core", "reference", "market", "osm"];
export const DATA_SCHEMA_VERSION = 1;
export const VALUE_STATUSES = ["observed", "estimated", "suppressed", "missing", "not_applicable"] as const;

const statusList = VALUE_STATUSES.map((s) => `'${s}'`).join(",");

const COMMON_SQL = `
  CREATE TABLE IF NOT EXISTS data_file_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS source_release (
    release_id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    source_url TEXT NOT NULL,
    source_as_of TEXT,
    published_at TEXT,
    fetched_at TEXT NOT NULL,
    checksum TEXT NOT NULL,
    schema_version INTEGER NOT NULL,
    license_code TEXT NOT NULL,
    rights_json TEXT NOT NULL DEFAULT '{}',
    coverage_json TEXT NOT NULL DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS ingest_run (
    run_id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    partition_key TEXT NOT NULL DEFAULT '',
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL CHECK (status IN ('running','succeeded','rejected','failed')),
    expected_count INTEGER,
    received_count INTEGER NOT NULL DEFAULT 0,
    accepted_count INTEGER NOT NULL DEFAULT 0,
    rejected_count INTEGER NOT NULL DEFAULT 0,
    error_code TEXT,
    release_id TEXT REFERENCES source_release(release_id)
  );

  CREATE TABLE IF NOT EXISTS feature (
    feature_id INTEGER PRIMARY KEY,
    stable_id TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    source_key TEXT NOT NULL,
    release_id TEXT NOT NULL REFERENCES source_release(release_id),
    geom_json TEXT NOT NULL,
    name TEXT,
    pnu TEXT,
    legal_code TEXT,
    properties_json TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX IF NOT EXISTS idx_feature_kind ON feature (kind);
  CREATE INDEX IF NOT EXISTS idx_feature_pnu ON feature (pnu);

  CREATE VIRTUAL TABLE IF NOT EXISTS feature_rtree USING rtree(feature_id, min_x, max_x, min_y, max_y);

  CREATE TABLE IF NOT EXISTS feature_link (
    from_stable_id TEXT NOT NULL,
    to_stable_id TEXT NOT NULL,
    relation_type TEXT NOT NULL,
    method TEXT NOT NULL,
    confidence REAL,
    release_id TEXT NOT NULL REFERENCES source_release(release_id),
    valid_from TEXT,
    valid_to TEXT,
    PRIMARY KEY (from_stable_id, to_stable_id, relation_type)
  );

  CREATE TABLE IF NOT EXISTS observation (
    subject_id TEXT NOT NULL,
    metric TEXT NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    value REAL,
    unit TEXT NOT NULL,
    value_status TEXT NOT NULL CHECK (value_status IN (${statusList})),
    release_id TEXT NOT NULL REFERENCES source_release(release_id),
    method_version TEXT NOT NULL,
    PRIMARY KEY (subject_id, metric, period_start, release_id)
  );
`;

const CORE_SQL = `
  CREATE TABLE IF NOT EXISTS building_fact (
    feature_id INTEGER PRIMARY KEY REFERENCES feature(feature_id),
    ledger_pk TEXT,
    complex_id TEXT,
    height_m REAL,
    height_method TEXT NOT NULL CHECK (height_method IN ('source','floors_estimate','user','unknown')),
    floors_above INTEGER,
    floors_below INTEGER,
    use_code TEXT,
    approval_date TEXT,
    gross_floor_area_m2 REAL,
    footprint_area_m2 REAL,
    field_provenance_json TEXT NOT NULL DEFAULT '{}'
  );
`;

const MARKET_SQL = `
  CREATE TABLE IF NOT EXISTS property_transaction (
    transaction_id TEXT PRIMARY KEY,
    source_record_key TEXT NOT NULL,
    lawd_cd TEXT NOT NULL,
    deal_date TEXT NOT NULL,
    property_type TEXT NOT NULL,
    contract_type TEXT NOT NULL,
    price_krw INTEGER,
    deposit_krw INTEGER,
    rent_krw INTEGER,
    area_m2 REAL,
    floor INTEGER,
    cancelled_at TEXT,
    location_id TEXT,
    match_status TEXT NOT NULL,
    release_id TEXT NOT NULL REFERENCES source_release(release_id)
  );
  CREATE INDEX IF NOT EXISTS idx_tx_lawd_date ON property_transaction (lawd_cd, deal_date);

  CREATE TABLE IF NOT EXISTS development_event (
    event_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    stage TEXT NOT NULL,
    effective_date TEXT,
    planned_date TEXT,
    planned_date_precision TEXT NOT NULL CHECK (planned_date_precision IN ('day','month','half','year','unknown')),
    units INTEGER,
    geometry_id TEXT,
    evidence_url TEXT NOT NULL,
    release_id TEXT NOT NULL REFERENCES source_release(release_id)
  );
  CREATE INDEX IF NOT EXISTS idx_devevent_project ON development_event (project_id);
`;

export function initDataFileSchema(db: Db, kind: DataFileKind): void {
  const hasMeta = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='data_file_meta'").get() !== undefined;
  const existing = hasMeta
    ? (db.prepare("SELECT value FROM data_file_meta WHERE key='kind'").pluck().get() as string | undefined)
    : undefined;
  if (existing !== undefined && existing !== kind) {
    throw new Error(`data file already initialized as ${existing}`);
  }
  db.exec(COMMON_SQL);
  if (kind === "core") db.exec(CORE_SQL);
  if (kind === "market") db.exec(MARKET_SQL);
  const upsert = db.prepare("INSERT INTO data_file_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  upsert.run("kind", kind);
  upsert.run("schema_version", String(DATA_SCHEMA_VERSION));
}

export function readDataFileMeta(db: Db): { kind: DataFileKind; schemaVersion: number } {
  const rows = db.prepare("SELECT key, value FROM data_file_meta").all() as Array<{ key: string; value: string }>;
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const kind = map.get("kind");
  if (!kind || !(DATA_FILE_KINDS as readonly string[]).includes(kind)) throw new Error("data file has no valid kind");
  return { kind: kind as DataFileKind, schemaVersion: Number(map.get("schema_version")) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:v2`
Expected: `✓ v2 foundations`, `✓ v2 data schema`

- [ ] **Step 5: Commit**

```bash
git add src/lib/v2/data/schema.ts src/scripts/v2/test-v2-data-schema.mjs package.json
# 메시지: "feat: v2 데이터 파일 스키마 — core/reference/market/osm, R*Tree, 미상은 NULL"
```

---

### Task 3: 공간 객체 적재와 반경 조회

**Files:**
- Create: `src/lib/v2/data/features.ts`
- Test: `src/scripts/v2/test-v2-features.mjs`
- Modify: `package.json` (`test:v2`에 이 테스트 추가)

**Interfaces:**
- Consumes: `toUtmk`, `toLngLat`, `LngLat` (Task 1); `initDataFileSchema` (Task 2)
- Produces:
  - `const MAX_RADIUS_M = 5000`
  - `interface FeatureInput { stableId: string; kind: string; sourceKey: string; releaseId: string; geometry: Geometry /* WGS84 */; name?: string | null; pnu?: string | null; legalCode?: string | null; properties?: Record<string, unknown> }`
  - `insertFeature(db, input: FeatureInput): number` (feature_id)
  - `interface FeatureHit { featureId: number; stableId: string; kind: string; releaseId: string; name: string | null; pnu: string | null; legalCode: string | null; properties: Record<string, unknown>; geometry: Geometry /* EPSG:5179 */; distanceM: number | null }`
  - `queryFeaturesInRadius(db, center: LngLat, radiusM: number, kinds: readonly string[]): FeatureHit[]` — `distanceM`은 Point/MultiPoint만 값이 있고 나머지는 `null`

- [ ] **Step 1: Write the failing test**

`src/scripts/v2/test-v2-features.mjs`:

```js
/**
 * 반경 조회 테스트.
 * 대표점만 보고 거르면 경계가 반경에 걸친 필지·구역이 빠진다(spec §3.3).
 * bbox만 보고 거르면 원 밖 모서리 객체가 들어온다.
 */
import assert from "node:assert/strict";
import Database from "better-sqlite3";

const { toUtmk, toLngLat } = await import("../../lib/v2/crs.ts");
const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { insertFeature, queryFeaturesInRadius, MAX_RADIUS_M } = await import("../../lib/v2/data/features.ts");

const CENTER = [127.0592, 37.4869]; // 구룡역 부근
const [cx, cy] = toUtmk(CENTER);
const at = (dx, dy) => { const [lng, lat] = toLngLat([cx + dx, cy + dy]); return [lng, lat]; };
const square = (dx, dy, size) => ({
  type: "Polygon",
  coordinates: [[at(dx, dy), at(dx + size, dy), at(dx + size, dy + size), at(dx, dy + size), at(dx, dy)]],
});

function freshDb() {
  const db = new Database(":memory:");
  initDataFileSchema(db, "core");
  db.prepare(`INSERT INTO source_release (release_id, source_id, provider, source_url, fetched_at, checksum, schema_version, license_code)
    VALUES ('r1','test','test','https://example.invalid','2026-09-29T00:00:00+09:00','x',1,'TEST')`).run();
  return db;
}
const base = { sourceKey: "k", releaseId: "r1" };

const db = freshDb();
insertFeature(db, { ...base, stableId: "p-in", kind: "station", geometry: { type: "Point", coordinates: at(0, 990) } });
insertFeature(db, { ...base, stableId: "p-out", kind: "station", geometry: { type: "Point", coordinates: at(0, 1010) } });
// 중심(대표점)은 1,200m 밖이지만 가장 가까운 변은 950m — 반드시 포함
insertFeature(db, { ...base, stableId: "straddle", kind: "parcel", pnu: "1168010100100010000", geometry: square(950, -250, 500) });
// bbox는 겹치지만 원과는 안 겹치는 NE 모서리(가장 가까운 꼭짓점 ≈ 1,273m) — 제외
insertFeature(db, { ...base, stableId: "corner", kind: "parcel", geometry: square(900, 900, 50) });
insertFeature(db, { ...base, stableId: "bld", kind: "building", geometry: square(10, 10, 20) });

// ─── 1. 점: 정확한 거리 ─────────────────────────────────────────────────────
{
  const hits = queryFeaturesInRadius(db, CENTER, 1000, ["station"]);
  assert.deepEqual(hits.map((h) => h.stableId), ["p-in"]);
  assert.ok(Math.abs(hits[0].distanceM - 990) < 0.01, `distance=${hits[0].distanceM}`);
}

// ─── 2. 면: 교차 판정 ───────────────────────────────────────────────────────
{
  const ids = queryFeaturesInRadius(db, CENTER, 1000, ["parcel"]).map((h) => h.stableId).sort();
  assert.deepEqual(ids, ["straddle"], "경계가 걸친 필지는 포함, bbox만 겹친 모서리는 제외");
  const hit = queryFeaturesInRadius(db, CENTER, 1000, ["parcel"])[0];
  assert.equal(hit.pnu, "1168010100100010000", "PNU 문자열 보존");
  assert.equal(hit.distanceM, null, "면의 distanceM은 null");
  assert.equal(hit.geometry.type, "Polygon");
  assert.ok(hit.geometry.coordinates[0][0][0] > 100000, "반환 도형은 미터 좌표(EPSG:5179)");
}

// ─── 3. 종류 필터·빈 목록 ──────────────────────────────────────────────────
{
  assert.deepEqual(queryFeaturesInRadius(db, CENTER, 1000, ["building"]).map((h) => h.stableId), ["bld"]);
  assert.deepEqual(queryFeaturesInRadius(db, CENTER, 1000, []), []);
}

// ─── 4. 반경 검증 ──────────────────────────────────────────────────────────
{
  assert.equal(MAX_RADIUS_M, 5000);
  for (const bad of [0, -1, Number.NaN, 5001]) {
    assert.throws(() => queryFeaturesInRadius(db, CENTER, bad, ["station"]), RangeError, `radius ${bad}`);
  }
}

// ─── 5. PNU·법정동 코드를 숫자로 넘기면 거부 ──────────────────────────────
{
  assert.throws(
    () => insertFeature(db, { ...base, stableId: "bad-pnu", kind: "parcel", pnu: 1168010100100010000, geometry: square(0, 0, 10) }),
    /pnu must be a string/,
  );
  assert.throws(
    () => insertFeature(db, { ...base, stableId: "bad-legal", kind: "parcel", legalCode: 1168010100, geometry: square(0, 0, 10) }),
    /legalCode must be a string/,
  );
  assert.throws(
    () => insertFeature(db, { ...base, stableId: "gc", kind: "x", geometry: { type: "GeometryCollection", geometries: [] } }),
    /GeometryCollection/,
  );
}

console.log("✓ v2 features");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx src/scripts/v2/test-v2-features.mjs`
Expected: FAIL — `Cannot find module '.../src/lib/v2/data/features.ts'`

- [ ] **Step 3: Write minimal implementation**

`src/lib/v2/data/features.ts`:

```ts
/**
 * 공간 객체 적재·반경 조회 (spec §3.3).
 * R*Tree로 bbox 후보를 추린 뒤 원과의 실제 교차를 판정한다.
 * 저장·반환 도형은 EPSG:5179 미터 좌표다.
 */
import type BetterSqlite3 from "better-sqlite3";
import type { Geometry, Position } from "geojson";
import { booleanIntersects, polygon } from "@turf/turf";
import { toUtmk, type LngLat } from "../crs";

type Db = BetterSqlite3.Database;

export const MAX_RADIUS_M = 5000;
const CIRCLE_SEGMENTS = 64;

export interface FeatureInput {
  stableId: string;
  kind: string;
  sourceKey: string;
  releaseId: string;
  /** WGS84 경위도 */
  geometry: Geometry;
  name?: string | null;
  pnu?: string | null;
  legalCode?: string | null;
  properties?: Record<string, unknown>;
}

export interface FeatureHit {
  featureId: number;
  stableId: string;
  kind: string;
  releaseId: string;
  name: string | null;
  pnu: string | null;
  legalCode: string | null;
  properties: Record<string, unknown>;
  /** EPSG:5179 미터 좌표 */
  geometry: Geometry;
  /** Point/MultiPoint만 값이 있다 */
  distanceM: number | null;
}

function mapPositions(coords: unknown, fn: (p: LngLat) => readonly [number, number]): unknown {
  if (!Array.isArray(coords)) throw new TypeError("invalid coordinates");
  if (typeof coords[0] === "number") return [...fn([coords[0] as number, coords[1] as number])];
  return coords.map((c) => mapPositions(c, fn));
}

function* positions(coords: unknown): Generator<Position> {
  if (!Array.isArray(coords)) return;
  if (typeof coords[0] === "number") {
    yield coords as Position;
    return;
  }
  for (const c of coords) yield* positions(c);
}

export function projectGeometry(geometry: Geometry): Geometry {
  if (geometry.type === "GeometryCollection") throw new TypeError("GeometryCollection is not supported");
  return { type: geometry.type, coordinates: mapPositions(geometry.coordinates, toUtmk) } as Geometry;
}

function bboxOf(geometry: Geometry): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  if (geometry.type === "GeometryCollection") throw new TypeError("GeometryCollection is not supported");
  for (const [x, y] of positions(geometry.coordinates)) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new TypeError("non-finite coordinate");
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (minX === Infinity) throw new TypeError("empty geometry");
  return [minX, minY, maxX, maxY];
}

export function insertFeature(db: Db, input: FeatureInput): number {
  for (const [field, value] of [["pnu", input.pnu], ["legalCode", input.legalCode]] as const) {
    if (value != null && typeof value !== "string") throw new TypeError(`${field} must be a string (got ${typeof value})`);
  }
  const projected = projectGeometry(input.geometry);
  const [minX, minY, maxX, maxY] = bboxOf(projected);
  const info = db
    .prepare(`INSERT INTO feature (stable_id, kind, source_key, release_id, geom_json, name, pnu, legal_code, properties_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      input.stableId, input.kind, input.sourceKey, input.releaseId, JSON.stringify(projected),
      input.name ?? null, input.pnu ?? null, input.legalCode ?? null, JSON.stringify(input.properties ?? {}),
    );
  const featureId = Number(info.lastInsertRowid);
  // SQLite R*Tree는 32비트 실수로 저장하되 바깥쪽으로 반올림한다 — 후보가 빠지지 않는다.
  db.prepare("INSERT INTO feature_rtree (feature_id, min_x, max_x, min_y, max_y) VALUES (?, ?, ?, ?, ?)").run(featureId, minX, maxX, minY, maxY);
  return featureId;
}

// ponytail: 원에 외접하는 64각형 — 교차 판정이 원보다 최대 r·(1/cos(π/64)−1) ≈ 0.12% 넓다(1km에서 1.2m).
// 경계 1m 안쪽 정밀도가 필요해지면 선분–원 거리 판정으로 바꾼다.
function circlePolygon(cx: number, cy: number, r: number) {
  const outer = r / Math.cos(Math.PI / CIRCLE_SEGMENTS);
  const ring: [number, number][] = [];
  for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
    const a = (2 * Math.PI * i) / CIRCLE_SEGMENTS;
    ring.push([cx + outer * Math.cos(a), cy + outer * Math.sin(a)]);
  }
  ring.push(ring[0]);
  return polygon([ring]);
}

interface FeatureRow {
  feature_id: number;
  stable_id: string;
  kind: string;
  release_id: string;
  geom_json: string;
  name: string | null;
  pnu: string | null;
  legal_code: string | null;
  properties_json: string;
}

export function queryFeaturesInRadius(db: Db, center: LngLat, radiusM: number, kinds: readonly string[]): FeatureHit[] {
  if (!Number.isFinite(radiusM) || radiusM <= 0 || radiusM > MAX_RADIUS_M) {
    throw new RangeError(`radiusM must be in (0, ${MAX_RADIUS_M}], got ${radiusM}`);
  }
  if (kinds.length === 0) return [];
  const [cx, cy] = toUtmk(center);
  const rows = db
    .prepare(`SELECT f.feature_id, f.stable_id, f.kind, f.release_id, f.geom_json, f.name, f.pnu, f.legal_code, f.properties_json
      FROM feature_rtree r JOIN feature f ON f.feature_id = r.feature_id
      WHERE r.max_x >= ? AND r.min_x <= ? AND r.max_y >= ? AND r.min_y <= ?
        AND f.kind IN (${kinds.map(() => "?").join(",")})
      ORDER BY f.feature_id`)
    .all(cx - radiusM, cx + radiusM, cy - radiusM, cy + radiusM, ...kinds) as FeatureRow[];

  const circle = circlePolygon(cx, cy, radiusM);
  const hits: FeatureHit[] = [];
  for (const row of rows) {
    const geometry = JSON.parse(row.geom_json) as Geometry;
    let distanceM: number | null = null;
    if (geometry.type === "Point" || geometry.type === "MultiPoint") {
      distanceM = Math.min(...[...positions(geometry.coordinates)].map(([x, y]) => Math.hypot(x - cx, y - cy)));
      if (distanceM > radiusM) continue;
    } else if (!booleanIntersects(circle, geometry)) {
      continue;
    }
    hits.push({
      featureId: row.feature_id,
      stableId: row.stable_id,
      kind: row.kind,
      releaseId: row.release_id,
      name: row.name,
      pnu: row.pnu,
      legalCode: row.legal_code,
      properties: JSON.parse(row.properties_json) as Record<string, unknown>,
      geometry,
      distanceM,
    });
  }
  return hits;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:v2 && npx tsc --noEmit`
Expected: `✓ v2 foundations`, `✓ v2 data schema`, `✓ v2 features`, tsc 오류 0

- [ ] **Step 5: Commit**

```bash
git add src/lib/v2/data/features.ts src/scripts/v2/test-v2-features.mjs package.json
# 메시지: "feat: v2 공간 객체 적재와 반경 조회 — R*Tree 후보 + 원 교차 판정"
```

---

### Task 4: 적재 품질 검사

**Files:**
- Create: `src/lib/v2/data/quality-gate.ts`
- Test: `src/scripts/v2/test-v2-quality-gate.mjs`
- Modify: `package.json` (`test:v2`에 추가)

**Interfaces:**
- Consumes: `DROP_REJECT_RATIO` from `src/lib/server/dataset-store.ts` (기존 모듈, import만)
- Produces:
  - `const FILL_RATE_DROP_THRESHOLD = 0.1`
  - `interface IngestSnapshot { total: number; byRegion: Record<string, number>; byType: Record<string, number>; fillRates: Record<string, number> /* 0..1 */ }`
  - `interface IngestObservation { responseRowsReported: number | null; parsedRows: number; pageLimitHit: boolean; totalCountReported: number | null; next: IngestSnapshot; previous: IngestSnapshot | null; expectedRegions?: readonly string[] }`
  - `type GateFailureCode = "PARSED_ZERO_WITH_ROWS" | "EMPTY" | "TOTAL_DROP" | "REGION_MISSING" | "TYPE_MISSING" | "FILL_RATE_DROP" | "INCOMPLETE_FETCH" | "EXPECTATION_BELOW"`
  - `interface GateFailure { code: GateFailureCode; detail: string }`, `interface GateResult { ok: boolean; failures: GateFailure[] }`
  - `evaluateIngest(obs: IngestObservation): GateResult`
  - `interface SiteExpectation { siteId: string; kind: string; minCount: number }`
  - `checkExpectations(expectations: readonly SiteExpectation[], count: (siteId: string, kind: string) => number): GateResult`

- [ ] **Step 1: Write the failing test**

`src/scripts/v2/test-v2-quality-gate.mjs`:

```js
/**
 * 적재 품질 검사 테스트 (spec §3.5).
 * 2026-08-05 사고: 상류 포맷이 바뀌어 HTTP 200에 0건 — 전국 합계만 보면 못 잡는 실패들이 있다.
 */
import assert from "node:assert/strict";

const { evaluateIngest, checkExpectations, FILL_RATE_DROP_THRESHOLD } = await import("../../lib/v2/data/quality-gate.ts");

const snap = (over = {}) => ({
  total: 1000,
  byRegion: { "11": 500, "26": 300, "41": 200 },
  byType: { apartment: 800, officetel: 200 },
  fillRates: { height_m: 0.8, approval_date: 0.95 },
  ...over,
});
const obs = (over = {}) => ({
  responseRowsReported: 1000, parsedRows: 1000, pageLimitHit: false, totalCountReported: 1000,
  next: snap(), previous: snap(), ...over,
});
const codes = (r) => r.failures.map((f) => f.code).sort();

// 정상
assert.deepEqual(evaluateIngest(obs()), { ok: true, failures: [] });

// 행은 왔는데 파싱 0건
assert.deepEqual(codes(evaluateIngest(obs({ parsedRows: 0, next: snap({ total: 0, byRegion: {}, byType: {} }) }))).includes("PARSED_ZERO_WITH_ROWS"), true);

// 전량 0건
assert.ok(codes(evaluateIngest(obs({ responseRowsReported: 0, parsedRows: 0, totalCountReported: 0, previous: null, next: snap({ total: 0, byRegion: {}, byType: {} }) }))).includes("EMPTY"));

// 30% 초과 급감 / 경계 30%는 통과
assert.ok(codes(evaluateIngest(obs({ parsedRows: 650, totalCountReported: 650, next: snap({ total: 650 }) }))).includes("TOTAL_DROP"));
assert.ok(!codes(evaluateIngest(obs({ parsedRows: 700, totalCountReported: 700, next: snap({ total: 700 }) }))).includes("TOTAL_DROP"));

// 전국 합계는 정상인데 부산(26)이 통째로 사라짐
assert.deepEqual(
  codes(evaluateIngest(obs({ next: snap({ byRegion: { "11": 800, "41": 200 } }) }))),
  ["REGION_MISSING"],
);

// 첫 적재라도 기대 지역이 빠지면 차단
assert.deepEqual(
  codes(evaluateIngest(obs({ previous: null, expectedRegions: ["11", "26", "41", "50"] }))),
  ["REGION_MISSING"],
);

// 유형 소실
assert.deepEqual(codes(evaluateIngest(obs({ next: snap({ byType: { apartment: 1000 } }) }))), ["TYPE_MISSING"]);

// 채움률 급락(10%p 초과) / 정확히 10%p는 통과
assert.equal(FILL_RATE_DROP_THRESHOLD, 0.1);
assert.deepEqual(codes(evaluateIngest(obs({ next: snap({ fillRates: { height_m: 0.65, approval_date: 0.95 } }) }))), ["FILL_RATE_DROP"]);
assert.deepEqual(codes(evaluateIngest(obs({ next: snap({ fillRates: { height_m: 0.7, approval_date: 0.95 } }) }))), []);
// 이전에 있던 필드가 통째로 빠진 것도 급락
assert.deepEqual(codes(evaluateIngest(obs({ next: snap({ fillRates: { approval_date: 0.95 } }) }))), ["FILL_RATE_DROP"]);

// 페이지 상한·totalCount 불일치
assert.deepEqual(codes(evaluateIngest(obs({ pageLimitHit: true }))), ["INCOMPLETE_FETCH"]);
assert.deepEqual(codes(evaluateIngest(obs({ totalCountReported: 1200 }))), ["INCOMPLETE_FETCH"]);
assert.deepEqual(codes(evaluateIngest(obs({ totalCountReported: null }))), [], "totalCount를 안 주는 원천은 비교하지 않는다");

// 고정 지점 기대치
{
  const counts = { "guryong:building": 120, "dasan:apartment": 50 };
  const count = (s, k) => counts[`${s}:${k}`] ?? 0;
  assert.deepEqual(checkExpectations([{ siteId: "guryong", kind: "building", minCount: 100 }], count), { ok: true, failures: [] });
  const r = checkExpectations([{ siteId: "dasan", kind: "apartment", minCount: 56 }], count);
  assert.equal(r.ok, false);
  assert.equal(r.failures[0].code, "EXPECTATION_BELOW");
  assert.match(r.failures[0].detail, /dasan.*apartment.*50.*56/);
}

console.log("✓ v2 quality gate");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx src/scripts/v2/test-v2-quality-gate.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

`src/lib/v2/data/quality-gate.ts`:

```ts
/**
 * 적재 품질 검사 (spec §3.5).
 * 기존 30% 급감 거부를 최종 안전장치로 유지하고, 전국 합계로는 안 보이는 실패를 더 잡는다.
 */
import { DROP_REJECT_RATIO } from "../../server/dataset-store";

/** 이전 대비 이만큼(비율 포인트) 넘게 채움률이 떨어지면 보류한다 */
export const FILL_RATE_DROP_THRESHOLD = 0.1;

export interface IngestSnapshot {
  total: number;
  byRegion: Record<string, number>;
  byType: Record<string, number>;
  /** 필드별 채움률 0..1 */
  fillRates: Record<string, number>;
}

export interface IngestObservation {
  /** 원천이 응답에 담았다고 밝힌 행 수. 모르면 null */
  responseRowsReported: number | null;
  parsedRows: number;
  pageLimitHit: boolean;
  totalCountReported: number | null;
  next: IngestSnapshot;
  previous: IngestSnapshot | null;
  /** 첫 적재에도 반드시 있어야 하는 지역 코드 */
  expectedRegions?: readonly string[];
}

export type GateFailureCode =
  | "PARSED_ZERO_WITH_ROWS"
  | "EMPTY"
  | "TOTAL_DROP"
  | "REGION_MISSING"
  | "TYPE_MISSING"
  | "FILL_RATE_DROP"
  | "INCOMPLETE_FETCH"
  | "EXPECTATION_BELOW";

export interface GateFailure {
  code: GateFailureCode;
  detail: string;
}

export interface GateResult {
  ok: boolean;
  failures: GateFailure[];
}

function missingKeys(previous: Record<string, number>, next: Record<string, number>): string[] {
  return Object.entries(previous)
    .filter(([key, count]) => count > 0 && !((next[key] ?? 0) > 0))
    .map(([key]) => key);
}

export function evaluateIngest(obs: IngestObservation): GateResult {
  const failures: GateFailure[] = [];
  const { next, previous } = obs;

  if ((obs.responseRowsReported ?? 0) > 0 && obs.parsedRows === 0) {
    failures.push({ code: "PARSED_ZERO_WITH_ROWS", detail: `response reported ${obs.responseRowsReported} rows, parsed 0` });
  } else if (next.total <= 0) {
    failures.push({ code: "EMPTY", detail: "ingest produced 0 rows" });
  }

  if (previous && previous.total > 0 && next.total < previous.total * (1 - DROP_REJECT_RATIO)) {
    failures.push({ code: "TOTAL_DROP", detail: `${previous.total} -> ${next.total}` });
  }

  const regionBaseline: Record<string, number> = { ...(previous?.byRegion ?? {}) };
  for (const region of obs.expectedRegions ?? []) regionBaseline[region] = Math.max(regionBaseline[region] ?? 0, 1);
  const lostRegions = missingKeys(regionBaseline, next.byRegion);
  if (lostRegions.length > 0) failures.push({ code: "REGION_MISSING", detail: lostRegions.join(",") });

  if (previous) {
    const lostTypes = missingKeys(previous.byType, next.byType);
    if (lostTypes.length > 0) failures.push({ code: "TYPE_MISSING", detail: lostTypes.join(",") });

    const dropped = Object.entries(previous.fillRates)
      .filter(([field, rate]) => rate - (next.fillRates[field] ?? 0) > FILL_RATE_DROP_THRESHOLD + 1e-9)
      .map(([field, rate]) => `${field} ${rate} -> ${next.fillRates[field] ?? 0}`);
    if (dropped.length > 0) failures.push({ code: "FILL_RATE_DROP", detail: dropped.join("; ") });
  }

  if (obs.pageLimitHit || (obs.totalCountReported !== null && obs.totalCountReported !== obs.parsedRows)) {
    failures.push({
      code: "INCOMPLETE_FETCH",
      detail: obs.pageLimitHit ? "page limit reached" : `totalCount ${obs.totalCountReported} != parsed ${obs.parsedRows}`,
    });
  }

  return { ok: failures.length === 0, failures };
}

export interface SiteExpectation {
  siteId: string;
  kind: string;
  minCount: number;
}

export function checkExpectations(
  expectations: readonly SiteExpectation[],
  count: (siteId: string, kind: string) => number,
): GateResult {
  const failures: GateFailure[] = [];
  for (const e of expectations) {
    const actual = count(e.siteId, e.kind);
    if (actual < e.minCount) {
      failures.push({ code: "EXPECTATION_BELOW", detail: `${e.siteId} ${e.kind}: ${actual} < ${e.minCount}` });
    }
  }
  return { ok: failures.length === 0, failures };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:v2 && npx tsc --noEmit`
Expected: 네 줄 모두 `✓`, tsc 오류 0

- [ ] **Step 5: Commit**

```bash
git add src/lib/v2/data/quality-gate.ts src/scripts/v2/test-v2-quality-gate.mjs package.json
# 메시지: "feat: v2 적재 품질 검사 — 지역·유형 소실, 채움률 급락, 불완전 수집, 고정 지점 기대치"
```

---

### Task 5: manifest 게시·롤백·가비지 수집

**Files:**
- Create: `src/lib/v2/data/manifest.ts`
- Test: `src/scripts/v2/test-v2-manifest.mjs`
- Modify: `package.json` (`test:v2`에 추가)

**Interfaces:**
- Consumes: `canonicalJson`, `sha256Hex` (Task 1); `DataFileKind` (Task 2); `GateResult`, `GateFailure` (Task 4)
- Produces:
  - 상수 `MANIFEST_FILE = "manifest.json"`, `PREVIOUS_MANIFEST_FILE = "manifest.prev.json"`, `MANIFEST_ARCHIVE_DIR = "manifests"`, `VERSIONS_DIR = "versions"`
  - `type ManifestFileKind = DataFileKind | "pmtiles" | "dem" | "epw"`
  - `interface ManifestFile { path: string /* "versions/..." 상대경로, / 구분 */; sha256: string; kind: ManifestFileKind; schemaVersion: number }`
  - `interface Manifest { version: string; createdAt: string; files: Record<string, ManifestFile> }`
  - `class ManifestError extends Error { code: ManifestErrorCode }`, `type ManifestErrorCode = "MISSING_FILE" | "HASH_MISMATCH" | "PATH_ESCAPE" | "WAL_PRESENT" | "POST_PUBLISH_MISMATCH" | "NO_PREVIOUS" | "MISSING_PINNED_MANIFEST" | "UNKNOWN_FILE_KEY"`
  - `manifestHash(m: Manifest): string`
  - `sha256File(path: string): Promise<string>`
  - `resolveDataPath(dataDir: string, relPath: string): string`
  - `readManifest(dataDir: string): Manifest | null`
  - `readArchivedManifest(dataDir: string, hash: string): Manifest | null`
  - `verifyManifestFiles(dataDir: string, m: Manifest): Promise<void>`
  - `publishManifest(dataDir: string, candidate: Manifest, check: (m: Manifest) => GateResult | Promise<GateResult>): Promise<{ published: boolean; hash: string; failures: GateFailure[] }>`
  - `rollbackManifest(dataDir: string): void`
  - `collectGarbage(dataDir: string, pinnedHashes: ReadonlySet<string>): { deleted: string[] }`
  - `openDataFile(dataDir: string, m: Manifest, key: string): BetterSqlite3.Database` (읽기 전용)

- [ ] **Step 1: Write the failing test**

`src/scripts/v2/test-v2-manifest.mjs`:

```js
/**
 * manifest 게시 테스트 (spec §3.4).
 * 어떤 실패에서도 현재 manifest는 직전 정상본이어야 하고,
 * 저장된 프로젝트가 쓰는 옛 버전 파일은 지워지면 안 된다.
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

const M = await import("../../lib/v2/data/manifest.ts");
const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const OK = () => ({ ok: true, failures: [] });

function makeDataDir() {
  return mkdtempSync(join(tmpdir(), "v2-manifest-"));
}

/** versions/<version>/core.sqlite 를 만들고 manifest를 돌려준다 */
async function buildVersion(dataDir, version) {
  const rel = `versions/${version}/core.sqlite`;
  const abs = join(dataDir, rel);
  mkdirSync(join(dataDir, "versions", version), { recursive: true });
  const db = new Database(abs);
  initDataFileSchema(db, "core");
  db.close();
  return {
    version,
    createdAt: `2026-09-29T00:00:0${version.slice(-1)}+09:00`,
    files: { core: { path: rel, sha256: await M.sha256File(abs), kind: "core", schemaVersion: 1 } },
  };
}

// ─── 1. 첫 게시 ────────────────────────────────────────────────────────────
{
  const dir = makeDataDir();
  assert.equal(M.readManifest(dir), null);
  const v1 = await buildVersion(dir, "v1");
  const r = await M.publishManifest(dir, v1, OK);
  assert.deepEqual(r, { published: true, hash: M.manifestHash(v1), failures: [] });
  assert.deepEqual(M.readManifest(dir), v1);
  assert.deepEqual(M.readArchivedManifest(dir, r.hash), v1);
  assert.equal(existsSync(join(dir, M.PREVIOUS_MANIFEST_FILE)), false);
  assert.equal(M.manifestHash(v1), M.manifestHash(JSON.parse(JSON.stringify({ files: v1.files, createdAt: v1.createdAt, version: v1.version }))), "키 순서 무관");
}

// ─── 2. 실패 시 현재본 유지 ─────────────────────────────────────────────────
{
  const dir = makeDataDir();
  const v1 = await buildVersion(dir, "v1");
  await M.publishManifest(dir, v1, OK);

  const v2 = await buildVersion(dir, "v2");
  const tampered = { ...v2, files: { core: { ...v2.files.core, sha256: "0".repeat(64) } } };
  await assert.rejects(M.publishManifest(dir, tampered, OK), (e) => e.code === "HASH_MISMATCH");
  assert.deepEqual(M.readManifest(dir), v1, "해시 불일치 후 v1 유지");

  const missing = { ...v2, files: { core: { ...v2.files.core, path: "versions/nope/core.sqlite" } } };
  await assert.rejects(M.publishManifest(dir, missing, OK), (e) => e.code === "MISSING_FILE");

  const escape = { ...v2, files: { core: { ...v2.files.core, path: "../outside.sqlite" } } };
  await assert.rejects(M.publishManifest(dir, escape, OK), (e) => e.code === "PATH_ESCAPE");

  writeFileSync(join(dir, v2.files.core.path) + "-wal", "x");
  await assert.rejects(M.publishManifest(dir, v2, OK), (e) => e.code === "WAL_PRESENT");
  assert.deepEqual(M.readManifest(dir), v1);
}

// ─── 3. 품질 검사 실패 → 게시 안 함 ─────────────────────────────────────────
{
  const dir = makeDataDir();
  const v1 = await buildVersion(dir, "v1");
  await M.publishManifest(dir, v1, OK);
  const v2 = await buildVersion(dir, "v2");
  const r = await M.publishManifest(dir, v2, () => ({ ok: false, failures: [{ code: "EXPECTATION_BELOW", detail: "dasan apartment: 50 < 56" }] }));
  assert.equal(r.published, false);
  assert.equal(r.failures[0].code, "EXPECTATION_BELOW");
  assert.deepEqual(M.readManifest(dir), v1);
}

// ─── 4. 두 번째 게시 → 이전본 보관, 롤백 ─────────────────────────────────────
{
  const dir = makeDataDir();
  const v1 = await buildVersion(dir, "v1");
  await M.publishManifest(dir, v1, OK);
  const v2 = await buildVersion(dir, "v2");
  await M.publishManifest(dir, v2, OK);
  assert.deepEqual(M.readManifest(dir), v2);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, M.PREVIOUS_MANIFEST_FILE), "utf8")), v1);
  M.rollbackManifest(dir);
  assert.deepEqual(M.readManifest(dir), v1);

  const fresh = makeDataDir();
  assert.throws(() => M.rollbackManifest(fresh), (e) => e.code === "NO_PREVIOUS");
}

// ─── 5. 데이터 파일은 읽기 전용으로 열린다 ─────────────────────────────────
{
  const dir = makeDataDir();
  const v1 = await buildVersion(dir, "v1");
  await M.publishManifest(dir, v1, OK);
  const db = M.openDataFile(dir, v1, "core");
  assert.throws(() => db.prepare("INSERT INTO data_file_meta (key, value) VALUES ('x','y')").run(), /readonly/);
  db.close();
  assert.throws(() => M.openDataFile(dir, v1, "market"), (e) => e.code === "UNKNOWN_FILE_KEY");
}

// ─── 6. 가비지 수집: 핀 고정본은 남긴다 ─────────────────────────────────────
{
  const dir = makeDataDir();
  const v1 = await buildVersion(dir, "v1");
  const h1 = (await M.publishManifest(dir, v1, OK)).hash;
  await M.publishManifest(dir, await buildVersion(dir, "v2"), OK);
  await M.publishManifest(dir, await buildVersion(dir, "v3"), OK); // 현재 v3, 이전 v2
  mkdirSync(join(dir, "versions", "orphan"), { recursive: true });
  writeFileSync(join(dir, "versions", "orphan", "core.sqlite"), "junk");

  // 모르는 핀 → 아무것도 지우지 않고 중단
  assert.throws(() => M.collectGarbage(dir, new Set(["f".repeat(64)])), (e) => e.code === "MISSING_PINNED_MANIFEST");
  assert.ok(existsSync(join(dir, "versions", "orphan", "core.sqlite")));

  const kept = M.collectGarbage(dir, new Set([h1]));
  assert.ok(existsSync(join(dir, v1.files.core.path)), "핀 고정된 v1 유지");
  assert.ok(existsSync(join(dir, "versions/v2/core.sqlite")), "이전본 v2 유지");
  assert.ok(existsSync(join(dir, "versions/v3/core.sqlite")), "현재본 v3 유지");
  assert.deepEqual(kept.deleted, ["versions/orphan/core.sqlite"]);

  const swept = M.collectGarbage(dir, new Set());
  assert.ok(!existsSync(join(dir, v1.files.core.path)), "핀 해제된 v1 삭제");
  assert.ok(swept.deleted.includes("versions/v1/core.sqlite"));
  assert.ok(swept.deleted.includes(`manifests/${h1}.json`));
}

console.log("✓ v2 manifest");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx src/scripts/v2/test-v2-manifest.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

`src/lib/v2/data/manifest.ts`:

```ts
/**
 * 데이터 버전 전환 (spec §3.4).
 *
 * 데이터 파일은 versions/<version>/ 아래에 완성된 뒤 바뀌지 않는다.
 * 현재 버전은 manifest.json 하나가 가리키고, 그 파일을 rename으로 원자 교체한다.
 * 게시한 모든 manifest는 manifests/<hash>.json에 보관해, 저장된 프로젝트가 옛 버전을 다시 열 수 있게 한다.
 */
import { createHash } from "node:crypto";
import { copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";
import { canonicalJson, sha256Hex } from "../canonical-json";
import { DATA_FILE_KINDS, type DataFileKind } from "./schema";
import type { GateFailure, GateResult } from "./quality-gate";

export const MANIFEST_FILE = "manifest.json";
export const PREVIOUS_MANIFEST_FILE = "manifest.prev.json";
export const MANIFEST_ARCHIVE_DIR = "manifests";
export const VERSIONS_DIR = "versions";

export type ManifestFileKind = DataFileKind | "pmtiles" | "dem" | "epw";

export interface ManifestFile {
  /** dataDir 기준 상대경로, "/" 구분, 반드시 versions/ 아래 */
  path: string;
  sha256: string;
  kind: ManifestFileKind;
  schemaVersion: number;
}

export interface Manifest {
  version: string;
  createdAt: string;
  files: Record<string, ManifestFile>;
}

export type ManifestErrorCode =
  | "MISSING_FILE"
  | "HASH_MISMATCH"
  | "PATH_ESCAPE"
  | "WAL_PRESENT"
  | "POST_PUBLISH_MISMATCH"
  | "NO_PREVIOUS"
  | "MISSING_PINNED_MANIFEST"
  | "UNKNOWN_FILE_KEY";

export class ManifestError extends Error {
  readonly name = "ManifestError";
  constructor(readonly code: ManifestErrorCode, message: string) {
    super(message);
  }
}

export function manifestHash(m: Manifest): string {
  return sha256Hex(canonicalJson(m));
}

/** 전국 파일은 수 GB라 스트림으로 읽는다 */
export function sha256File(path: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolvePromise(hash.digest("hex")));
  });
}

export function resolveDataPath(dataDir: string, relPath: string): string {
  const root = resolve(dataDir);
  const abs = resolve(root, relPath);
  if (!relPath.startsWith(`${VERSIONS_DIR}/`) || !abs.startsWith(root + sep + VERSIONS_DIR + sep)) {
    throw new ManifestError("PATH_ESCAPE", `path must stay under ${VERSIONS_DIR}/: ${relPath}`);
  }
  return abs;
}

function readJson(path: string): Manifest | null {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Manifest) : null;
}

export function readManifest(dataDir: string): Manifest | null {
  return readJson(join(dataDir, MANIFEST_FILE));
}

export function readArchivedManifest(dataDir: string, hash: string): Manifest | null {
  return readJson(join(dataDir, MANIFEST_ARCHIVE_DIR, `${hash}.json`));
}

export async function verifyManifestFiles(dataDir: string, m: Manifest): Promise<void> {
  for (const [key, file] of Object.entries(m.files)) {
    const abs = resolveDataPath(dataDir, file.path);
    if (!existsSync(abs)) throw new ManifestError("MISSING_FILE", `${key}: ${file.path}`);
    if ((DATA_FILE_KINDS as readonly string[]).includes(file.kind) && existsSync(`${abs}-wal`)) {
      throw new ManifestError("WAL_PRESENT", `${key}: close the database before publishing (${file.path}-wal)`);
    }
    const actual = await sha256File(abs);
    if (actual !== file.sha256) throw new ManifestError("HASH_MISMATCH", `${key}: expected ${file.sha256}, got ${actual}`);
  }
}

export async function publishManifest(
  dataDir: string,
  candidate: Manifest,
  check: (m: Manifest) => GateResult | Promise<GateResult>,
): Promise<{ published: boolean; hash: string; failures: GateFailure[] }> {
  await verifyManifestFiles(dataDir, candidate);
  const hash = manifestHash(candidate);
  const gate = await check(candidate);
  if (!gate.ok) return { published: false, hash, failures: gate.failures };

  mkdirSync(join(dataDir, MANIFEST_ARCHIVE_DIR), { recursive: true });
  writeFileSync(join(dataDir, MANIFEST_ARCHIVE_DIR, `${hash}.json`), JSON.stringify(candidate, null, 2));

  const current = join(dataDir, MANIFEST_FILE);
  const hadPrevious = existsSync(current);
  if (hadPrevious) copyFileSync(current, join(dataDir, PREVIOUS_MANIFEST_FILE));
  const tmp = `${current}.tmp`;
  writeFileSync(tmp, JSON.stringify(candidate, null, 2));
  renameSync(tmp, current);

  const reread = readManifest(dataDir);
  if (!reread || manifestHash(reread) !== hash) {
    if (hadPrevious) rollbackManifest(dataDir);
    else rmSync(current, { force: true });
    throw new ManifestError("POST_PUBLISH_MISMATCH", "manifest.json does not match the published candidate");
  }
  return { published: true, hash, failures: [] };
}

export function rollbackManifest(dataDir: string): void {
  const previous = join(dataDir, PREVIOUS_MANIFEST_FILE);
  if (!existsSync(previous)) throw new ManifestError("NO_PREVIOUS", "no previous manifest to roll back to");
  const tmp = join(dataDir, `${MANIFEST_FILE}.tmp`);
  copyFileSync(previous, tmp);
  renameSync(tmp, join(dataDir, MANIFEST_FILE));
}

function* walkFiles(dir: string): Generator<string> {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkFiles(abs);
    else yield abs;
  }
}

export function collectGarbage(dataDir: string, pinnedHashes: ReadonlySet<string>): { deleted: string[] } {
  const keepFiles = new Set<string>();
  const keepManifests = new Set<string>();
  const keep = (m: Manifest) => {
    keepManifests.add(manifestHash(m));
    for (const f of Object.values(m.files)) keepFiles.add(f.path);
  };

  for (const name of [MANIFEST_FILE, PREVIOUS_MANIFEST_FILE]) {
    const m = readJson(join(dataDir, name));
    if (m) keep(m);
  }
  // 하나라도 핀 원본이 없으면 무엇이 쓰이는지 모르는 것이다 — 아무것도 지우지 않는다.
  for (const hash of pinnedHashes) {
    const m = readArchivedManifest(dataDir, hash);
    if (!m) throw new ManifestError("MISSING_PINNED_MANIFEST", `pinned manifest ${hash} not found`);
    keep(m);
  }

  const deleted: string[] = [];
  for (const abs of walkFiles(join(dataDir, VERSIONS_DIR))) {
    const rel = relative(dataDir, abs).split(sep).join("/");
    if (keepFiles.has(rel)) continue;
    rmSync(abs);
    deleted.push(rel);
  }
  for (const abs of walkFiles(join(dataDir, MANIFEST_ARCHIVE_DIR))) {
    const hash = basename(abs, ".json");
    if (keepManifests.has(hash)) continue;
    rmSync(abs);
    deleted.push(`${MANIFEST_ARCHIVE_DIR}/${basename(abs)}`);
  }
  return { deleted: deleted.sort() };
}

export function openDataFile(dataDir: string, m: Manifest, key: string): BetterSqlite3.Database {
  const file = m.files[key];
  if (!file) throw new ManifestError("UNKNOWN_FILE_KEY", `manifest has no file "${key}"`);
  return new Database(resolveDataPath(dataDir, file.path), { readonly: true, fileMustExist: true });
}
```

참고: 테스트 6의 `kept.deleted`가 `["versions/orphan/core.sqlite"]` 하나여야 하므로, v1·v2·v3 archive manifest는 v1(핀)·v2(이전)·v3(현재)라 모두 남는다. `swept`에서는 핀이 풀린 v1 파일과 `manifests/<h1>.json`이 지워진다.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:v2 && npx tsc --noEmit`
Expected: 다섯 줄 모두 `✓`, tsc 오류 0

- [ ] **Step 5: Commit**

```bash
git add src/lib/v2/data/manifest.ts src/scripts/v2/test-v2-manifest.mjs package.json
# 메시지: "feat: v2 manifest 원자 게시·롤백·핀 고정 가비지 수집"
```

---

### Task 6: `tile_result` 계약

**Files:**
- Create: `src/lib/v2/tile-result.ts`
- Test: `src/scripts/v2/test-v2-tile-result.mjs`
- Modify: `package.json` (`test:v2`에 추가)

**Interfaces:**
- Consumes: `canonicalJson`, `sha256Hex` (Task 1); `VALUE_STATUSES` (Task 2)
- Produces:
  - `TILE_TYPES = ["analysis","diagram","simulation","stack"]`, `TILE_STATUSES = ["complete","partial","failed","cancelled","no_data","not_provided"]`, `OUTPUT_FACES = ["front","back","both"]`, `JUDGMENT_LEVELS = ["good","fair","caution"]`, `LIMITATION_KINDS = ["unknown","estimated","suppressed","partial","incomplete","not_provided"]`
  - `TileResultSchema` (zod), `type TileResult = z.infer<typeof TileResultSchema>`, `type TileConditions = TileResult["conditions"]`
  - `parseTileResult(value: unknown): TileResult` (위반 시 ZodError)
  - `tileCacheKey(input: { tileCode: string; manifestHash: string; engineVersion: string; conditions: TileConditions }): string`

- [ ] **Step 1: Write the failing test**

`src/scripts/v2/test-v2-tile-result.mjs`:

```js
/**
 * tile_result 계약 테스트 (spec §5.2).
 * 화면·PPT·DXF가 모두 이 결과에서 나온다. 여기서 "모름"을 0으로, 미완료를 완료로 통과시키면
 * 모든 출력이 조용히 틀린다.
 */
import assert from "node:assert/strict";

const { parseTileResult, tileCacheKey } = await import("../../lib/v2/tile-result.ts");

const HASH = "a".repeat(64);
const valid = () => ({
  tileId: "t1",
  analysisId: "a1",
  tileType: "analysis",
  tileCode: "A01",
  status: "complete",
  engineVersion: "v2-p0",
  conditions: {
    address: "서울특별시 강남구 개포동",
    center: [127.0592, 37.4869],
    radiusM: 800,
    analysisDate: "2026-09-29",
    timezone: "Asia/Seoul",
    filters: {},
    simulation: null,
    parcelSnapshotHash: null,
  },
  metrics: [
    { id: "nearest_station_m", label: "최근접 역 출입구", value: 420, unit: "m", formulaVersion: "a01-nearest@1", numerator: null, denominator: null, status: "observed" },
    { id: "bus_routes", label: "버스 노선 수", value: null, unit: "개", formulaVersion: "a01-routes@1", numerator: null, denominator: null, status: "missing" },
  ],
  judgment: { ruleId: "A01-rail-distance@1", basisMetricIds: ["nearest_station_m"], sentence: "철도 접근은 가까운 편이다(직선 420m, 내부 제안 기준).", level: "good" },
  presentation: { legend: [], camera: null, layers: ["station"], outputFace: "front" },
  provenance: { manifestHash: HASH, sources: [{ sourceId: "rail", releaseId: "r1", sourceAsOf: "2026-09-01", fetchedAt: "2026-09-29T00:00:00+09:00" }] },
  limitations: [{ kind: "unknown", note: "버스 노선 연결 미확보" }],
});

// 정상
assert.equal(parseTileResult(valid()).tileCode, "A01");

const rejects = (mutate, why) => {
  const v = valid();
  mutate(v);
  assert.throws(() => parseTileResult(v), undefined, why);
};

rejects((v) => { v.metrics[0].value = null; }, "observed인데 값 없음");
rejects((v) => { v.metrics[1].value = 0; }, "missing인데 값 0");
rejects((v) => { v.provenance.sources = []; }, "complete인데 출처 없음");
rejects((v) => { v.conditions.analysisDate = "2026-9-29"; }, "기준일 형식");
rejects((v) => { v.conditions.timezone = "UTC"; }, "시간대 고정");
rejects((v) => { v.provenance.manifestHash = "abc"; }, "manifest 해시 형식");
rejects((v) => { v.judgment.basisMetricIds = ["bus_routes"]; }, "근거 지표가 missing이면 등급 금지");
rejects((v) => { v.judgment.basisMetricIds = ["nope"]; }, "없는 지표를 근거로 삼음");
rejects((v) => { v.presentation.outputFace = "flipped"; }, "출력 면");
rejects((v) => { v.conditions.radiusM = 0; }, "반경 0");

// 등급 없는 판단(사실 문장)은 근거가 missing이어도 허용
{
  const v = valid();
  v.judgment = { ruleId: "A06-fact@1", basisMetricIds: ["bus_routes"], sentence: "노선 연결은 미확인이다.", level: null };
  assert.equal(parseTileResult(v).judgment.level, null);
}

// 실패 타일은 출처 없이도 허용
{
  const v = valid();
  v.status = "failed";
  v.provenance.sources = [];
  v.judgment = null;
  assert.equal(parseTileResult(v).status, "failed");
}

// 캐시 키
{
  const base = { tileCode: "A01", manifestHash: HASH, engineVersion: "v2-p0", conditions: valid().conditions };
  const k = tileCacheKey(base);
  assert.match(k, /^[0-9a-f]{64}$/);
  assert.equal(tileCacheKey({ ...base, conditions: { ...base.conditions, filters: {} } }), k, "같은 조건은 같은 키");
  assert.notEqual(tileCacheKey({ ...base, conditions: { ...base.conditions, analysisDate: "2026-09-30" } }), k, "기준일이 바뀌면 다른 키");
  assert.notEqual(tileCacheKey({ ...base, manifestHash: "b".repeat(64) }), k, "데이터 버전");
  assert.notEqual(tileCacheKey({ ...base, conditions: { ...base.conditions, parcelSnapshotHash: "c".repeat(64) } }), k, "최신 필지 스냅샷");
}

console.log("✓ v2 tile result");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx src/scripts/v2/test-v2-tile-result.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

`src/lib/v2/tile-result.ts`:

```ts
/**
 * 모든 타일의 결과 계약 (spec §5.2).
 * 화면·PPT·PNG·DXF·GLB는 이 결과에서만 만든다. 내보내는 동안 새 데이터를 조회하지 않는다.
 */
import { z } from "zod";
import { canonicalJson, sha256Hex } from "./canonical-json";
import { VALUE_STATUSES } from "./data/schema";

export const TILE_TYPES = ["analysis", "diagram", "simulation", "stack"] as const;
export const TILE_STATUSES = ["complete", "partial", "failed", "cancelled", "no_data", "not_provided"] as const;
export const OUTPUT_FACES = ["front", "back", "both"] as const;
export const JUDGMENT_LEVELS = ["good", "fair", "caution"] as const;
export const LIMITATION_KINDS = ["unknown", "estimated", "suppressed", "partial", "incomplete", "not_provided"] as const;

const HAS_VALUE = new Set<string>(["observed", "estimated"]);

const MetricSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    value: z.number().finite().nullable(),
    unit: z.string(),
    formulaVersion: z.string().min(1),
    numerator: z.number().finite().nullable(),
    denominator: z.number().finite().nullable(),
    status: z.enum(VALUE_STATUSES),
  })
  .refine((m) => (m.value !== null) === HAS_VALUE.has(m.status), {
    message: "value must be present exactly when status is observed or estimated",
  });

const ConditionsSchema = z.object({
  address: z.string(),
  center: z.tuple([z.number().finite(), z.number().finite()]),
  radiusM: z.number().positive(),
  analysisDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timezone: z.literal("Asia/Seoul"),
  filters: z.record(z.string(), z.unknown()),
  simulation: z.record(z.string(), z.unknown()).nullable(),
  parcelSnapshotHash: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
});

export const TileResultSchema = z
  .object({
    tileId: z.string().min(1),
    analysisId: z.string().min(1),
    tileType: z.enum(TILE_TYPES),
    tileCode: z.string().regex(/^[ADS]\d{2}$|^STACK$|^SUMMARY$/),
    status: z.enum(TILE_STATUSES),
    engineVersion: z.string().min(1),
    conditions: ConditionsSchema,
    metrics: z.array(MetricSchema),
    judgment: z
      .object({
        ruleId: z.string().min(1),
        basisMetricIds: z.array(z.string()),
        sentence: z.string().min(1),
        level: z.enum(JUDGMENT_LEVELS).nullable(),
      })
      .nullable(),
    presentation: z.object({
      legend: z.array(z.object({ label: z.string(), min: z.number().nullable(), max: z.number().nullable() })),
      camera: z.record(z.string(), z.unknown()).nullable(),
      layers: z.array(z.string()),
      outputFace: z.enum(OUTPUT_FACES),
    }),
    provenance: z.object({
      manifestHash: z.string().regex(/^[0-9a-f]{64}$/),
      sources: z.array(
        z.object({
          sourceId: z.string().min(1),
          releaseId: z.string().min(1),
          sourceAsOf: z.string().nullable(),
          fetchedAt: z.string().min(1),
        }),
      ),
    }),
    limitations: z.array(z.object({ kind: z.enum(LIMITATION_KINDS), note: z.string().min(1) })),
  })
  .superRefine((t, ctx) => {
    if (t.status === "complete" && t.provenance.sources.length === 0) {
      ctx.addIssue({ code: "custom", path: ["provenance", "sources"], message: "a complete tile needs at least one source" });
    }
    if (t.judgment) {
      const byId = new Map(t.metrics.map((m) => [m.id, m]));
      for (const id of t.judgment.basisMetricIds) {
        const metric = byId.get(id);
        if (!metric) {
          ctx.addIssue({ code: "custom", path: ["judgment", "basisMetricIds"], message: `unknown metric ${id}` });
        } else if (t.judgment.level !== null && !HAS_VALUE.has(metric.status)) {
          ctx.addIssue({ code: "custom", path: ["judgment", "level"], message: `cannot grade on ${id} with status ${metric.status}` });
        }
      }
    }
  });

export type TileResult = z.infer<typeof TileResultSchema>;
export type TileConditions = TileResult["conditions"];

export function parseTileResult(value: unknown): TileResult {
  return TileResultSchema.parse(value);
}

export function tileCacheKey(input: { tileCode: string; manifestHash: string; engineVersion: string; conditions: TileConditions }): string {
  return sha256Hex(canonicalJson(input));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:v2 && npx tsc --noEmit`
Expected: 여섯 줄 모두 `✓`, tsc 오류 0

- [ ] **Step 5: Commit**

```bash
git add src/lib/v2/tile-result.ts src/scripts/v2/test-v2-tile-result.mjs package.json
# 메시지: "feat: v2 tile_result 계약 — 미상·미완료·근거 없는 등급을 거부"
```

---

### Task 7: v2 앱 DB

**Files:**
- Create: `src/lib/v2/app-db.ts`
- Test: `src/scripts/v2/test-v2-app-db.mjs`
- Modify: `package.json` (`test:v2`에 추가)

**Interfaces:**
- Consumes: `v2AppDbPath` (Task 1); `parseTileResult`, `TileResult` (Task 6)
- Produces:
  - `V2_APP_SCHEMA_VERSION = 1`
  - `openV2AppDb(path?: string): BetterSqlite3.Database` (WAL, 스키마 초기화)
  - `initV2AppSchema(db): void`
  - `interface AnalysisRunInput { analysisId: string; address: string; center: readonly [number, number]; radiusM: number; analysisDate: string; manifestHash: string; engineVersion: string; parameters: Record<string, unknown> }`
  - `createAnalysisRun(db, input: AnalysisRunInput): void`, `finishAnalysisRun(db, analysisId: string, status: "complete" | "failed"): void`
  - `getAnalysisRun(db, analysisId: string): (AnalysisRunInput & { status: string }) | null`
  - `saveTileResult(db, result: TileResult, cacheKey: string): void` — 스키마 검증, 분석 실행의 manifest 해시와 다르면 `Error("MANIFEST_HASH_MISMATCH")`
  - `loadTileResults(db, analysisId: string): TileResult[]` (tile_code 순)
  - `saveProject(db, p: { projectId: string; name: string; analysisId: string; board: unknown }): void`
  - `pinnedManifestHashes(db): Set<string>`

- [ ] **Step 1: Write the failing test**

`src/scripts/v2/test-v2-app-db.mjs`:

```js
/**
 * v2 앱 DB 테스트.
 * 분석 결과가 다른 데이터 버전을 섞으면 화면과 PPT 숫자가 달라진다.
 * 저장된 프로젝트의 데이터 버전은 가비지 수집에서 보호되어야 한다.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const A = await import("../../lib/v2/app-db.ts");

const H1 = "1".repeat(64);
const H2 = "2".repeat(64);
const run = (id, hash) => ({
  analysisId: id, address: "경기도 남양주시 다산동", center: [127.1506, 37.6245], radiusM: 800,
  analysisDate: "2026-09-29", manifestHash: hash, engineVersion: "v2-p0", parameters: {},
});
const tile = (analysisId, hash, code = "D02") => ({
  tileId: `${analysisId}-${code}`, analysisId, tileType: "diagram", tileCode: code, status: "complete", engineVersion: "v2-p0",
  conditions: { address: "경기도 남양주시 다산동", center: [127.1506, 37.6245], radiusM: 800, analysisDate: "2026-09-29", timezone: "Asia/Seoul", filters: {}, simulation: null, parcelSnapshotHash: null },
  metrics: [{ id: "building_count", label: "건물 수", value: 3, unit: "동", formulaVersion: "d02-count@1", numerator: null, denominator: null, status: "observed" }],
  judgment: null,
  presentation: { legend: [], camera: null, layers: ["building"], outputFace: "front" },
  provenance: { manifestHash: hash, sources: [{ sourceId: "gis_building", releaseId: "r1", sourceAsOf: null, fetchedAt: "2026-09-29T00:00:00+09:00" }] },
  limitations: [],
});

const db = A.openV2AppDb(join(mkdtempSync(join(tmpdir(), "v2-app-")), "app.sqlite"));
assert.equal(db.pragma("journal_mode", { simple: true }), "wal");

A.createAnalysisRun(db, run("a1", H1));
A.createAnalysisRun(db, run("a2", H2));
assert.equal(A.getAnalysisRun(db, "a1").manifestHash, H1);
assert.equal(A.getAnalysisRun(db, "a1").status, "running");
assert.deepEqual(A.getAnalysisRun(db, "a1").center, [127.1506, 37.6245]);
assert.equal(A.getAnalysisRun(db, "nope"), null);

// 결과 저장·복원
A.saveTileResult(db, tile("a1", H1), "k1");
assert.deepEqual(A.loadTileResults(db, "a1"), [tile("a1", H1)]);

// 다른 데이터 버전의 결과는 거부
assert.throws(() => A.saveTileResult(db, tile("a1", H2, "D03"), "k2"), /MANIFEST_HASH_MISMATCH/);
// 계약 위반은 거부
assert.throws(() => A.saveTileResult(db, { ...tile("a1", H1, "D04"), status: "complete", provenance: { manifestHash: H1, sources: [] } }, "k3"));
// 없는 분석은 거부
assert.throws(() => A.saveTileResult(db, tile("zzz", H1), "k4"), /unknown analysis/);

A.finishAnalysisRun(db, "a1", "complete");
assert.equal(A.getAnalysisRun(db, "a1").status, "complete");

// 저장 프로젝트가 참조하는 버전만 핀
assert.deepEqual(A.pinnedManifestHashes(db), new Set());
A.saveProject(db, { projectId: "p1", name: "다산역 검토", analysisId: "a1", board: { tiles: ["D02"] } });
assert.deepEqual(A.pinnedManifestHashes(db), new Set([H1]));

console.log("✓ v2 app db");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx src/scripts/v2/test-v2-app-db.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

`src/lib/v2/app-db.ts`:

```ts
/**
 * v2 앱 DB — 분석 실행·타일 결과·저장 프로젝트 (spec §3.2, §5.2).
 * 기존 .cache/site-analysis.db와 다른 파일이다. 교체 대상이 아니다.
 * ponytail: 사용자 계정은 P1에서 기존 로그인과 연결할 때 붙인다. P0는 로컬 단일 사용자.
 */
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";
import { v2AppDbPath } from "./paths";
import { parseTileResult, type TileResult } from "./tile-result";

type Db = BetterSqlite3.Database;

export const V2_APP_SCHEMA_VERSION = 1;

export interface AnalysisRunInput {
  analysisId: string;
  address: string;
  center: readonly [number, number];
  radiusM: number;
  analysisDate: string;
  manifestHash: string;
  engineVersion: string;
  parameters: Record<string, unknown>;
}

export function openV2AppDb(path: string = v2AppDbPath()): Db {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  initV2AppSchema(db);
  return db;
}

export function initV2AppSchema(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

    CREATE TABLE IF NOT EXISTS analysis_run (
      analysis_id TEXT PRIMARY KEY,
      address TEXT NOT NULL,
      center_lng REAL NOT NULL,
      center_lat REAL NOT NULL,
      radius_m REAL NOT NULL,
      analysis_date TEXT NOT NULL,
      manifest_hash TEXT NOT NULL,
      engine_version TEXT NOT NULL,
      parameters_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('running','complete','failed')),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tile_result (
      tile_id TEXT PRIMARY KEY,
      analysis_id TEXT NOT NULL REFERENCES analysis_run(analysis_id),
      tile_code TEXT NOT NULL,
      cache_key TEXT NOT NULL,
      status TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (analysis_id, tile_code)
    );
    CREATE INDEX IF NOT EXISTS idx_tile_result_cache ON tile_result (cache_key);

    CREATE TABLE IF NOT EXISTS saved_project (
      project_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      analysis_id TEXT NOT NULL REFERENCES analysis_run(analysis_id),
      board_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.prepare("INSERT INTO schema_meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(String(V2_APP_SCHEMA_VERSION));
}

const now = () => new Date().toISOString();

export function createAnalysisRun(db: Db, r: AnalysisRunInput): void {
  db.prepare(`INSERT INTO analysis_run (analysis_id, address, center_lng, center_lat, radius_m, analysis_date, manifest_hash, engine_version, parameters_json, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?)`)
    .run(r.analysisId, r.address, r.center[0], r.center[1], r.radiusM, r.analysisDate, r.manifestHash, r.engineVersion, JSON.stringify(r.parameters), now());
}

export function finishAnalysisRun(db: Db, analysisId: string, status: "complete" | "failed"): void {
  db.prepare("UPDATE analysis_run SET status = ? WHERE analysis_id = ?").run(status, analysisId);
}

interface RunRow {
  analysis_id: string; address: string; center_lng: number; center_lat: number; radius_m: number;
  analysis_date: string; manifest_hash: string; engine_version: string; parameters_json: string; status: string;
}

export function getAnalysisRun(db: Db, analysisId: string): (AnalysisRunInput & { status: string }) | null {
  const row = db.prepare("SELECT * FROM analysis_run WHERE analysis_id = ?").get(analysisId) as RunRow | undefined;
  if (!row) return null;
  return {
    analysisId: row.analysis_id,
    address: row.address,
    center: [row.center_lng, row.center_lat],
    radiusM: row.radius_m,
    analysisDate: row.analysis_date,
    manifestHash: row.manifest_hash,
    engineVersion: row.engine_version,
    parameters: JSON.parse(row.parameters_json) as Record<string, unknown>,
    status: row.status,
  };
}

export function saveTileResult(db: Db, result: TileResult, cacheKey: string): void {
  const parsed = parseTileResult(result);
  const run = getAnalysisRun(db, parsed.analysisId);
  if (!run) throw new Error(`unknown analysis ${parsed.analysisId}`);
  if (run.manifestHash !== parsed.provenance.manifestHash) {
    throw new Error(`MANIFEST_HASH_MISMATCH: analysis ${run.manifestHash}, tile ${parsed.provenance.manifestHash}`);
  }
  db.prepare(`INSERT INTO tile_result (tile_id, analysis_id, tile_code, cache_key, status, result_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(analysis_id, tile_code) DO UPDATE SET tile_id = excluded.tile_id, cache_key = excluded.cache_key,
      status = excluded.status, result_json = excluded.result_json, created_at = excluded.created_at`)
    .run(parsed.tileId, parsed.analysisId, parsed.tileCode, cacheKey, parsed.status, JSON.stringify(parsed), now());
}

export function loadTileResults(db: Db, analysisId: string): TileResult[] {
  const rows = db.prepare("SELECT result_json FROM tile_result WHERE analysis_id = ? ORDER BY tile_code").pluck().all(analysisId) as string[];
  return rows.map((json) => parseTileResult(JSON.parse(json)));
}

export function saveProject(db: Db, p: { projectId: string; name: string; analysisId: string; board: unknown }): void {
  const t = now();
  db.prepare(`INSERT INTO saved_project (project_id, name, analysis_id, board_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET name = excluded.name, analysis_id = excluded.analysis_id, board_json = excluded.board_json, updated_at = excluded.updated_at`)
    .run(p.projectId, p.name, p.analysisId, JSON.stringify(p.board), t, t);
}

export function pinnedManifestHashes(db: Db): Set<string> {
  const rows = db
    .prepare("SELECT DISTINCT r.manifest_hash FROM saved_project p JOIN analysis_run r ON r.analysis_id = p.analysis_id")
    .pluck()
    .all() as string[];
  return new Set(rows);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:v2 && npx tsc --noEmit`
Expected: 일곱 줄 모두 `✓`, tsc 오류 0

- [ ] **Step 5: Commit**

```bash
git add src/lib/v2/app-db.ts src/scripts/v2/test-v2-app-db.mjs package.json
# 메시지: "feat: v2 앱 DB — 분석 실행·타일 결과·저장 프로젝트, 데이터 버전 혼합 거부"
```

---

### Task 8: 끝에서 끝 증명 — 최소 분석

**Files:**
- Create: `src/lib/v2/analysis-skeleton.ts`
- Test: `src/scripts/v2/test-v2-analysis-skeleton.mjs`
- Modify: `package.json` (`test:v2`에 추가)

**Interfaces:**
- Consumes: Task 1~7 전부 — `LngLat`, `queryFeaturesInRadius`, `readManifest`, `manifestHash`, `openDataFile`, `collectGarbage`, `parseTileResult`, `tileCacheKey`, `createAnalysisRun`, `saveTileResult`, `finishAnalysisRun`, `loadTileResults`, `saveProject`, `pinnedManifestHashes`
- Produces:
  - `const SKELETON_ENGINE_VERSION = "v2-p0"`
  - `interface SkeletonInput { address: string; center: LngLat; radiusM: number; analysisDate: string }`
  - `runSkeletonAnalysis(appDb, dataDir: string, input: SkeletonInput): { analysisId: string; manifestHash: string; tiles: TileResult[] }`

P0 완료 기준(spec §6): "한 분석의 화면과 PPT가 같은 manifest 해시를 가리킴". 이 태스크는 D02(건물) 타일 하나로 그 흐름을 증명한다. 실제 타일 계산은 P1 이후다.

- [ ] **Step 1: Write the failing test**

`src/scripts/v2/test-v2-analysis-skeleton.mjs`:

```js
/**
 * 끝에서 끝: 데이터 파일 → manifest 게시 → 분석 → tile_result → 저장 → 새 버전 게시 → 옛 결과 복원 → 가비지 수집.
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

const { toUtmk, toLngLat } = await import("../../lib/v2/crs.ts");
const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { insertFeature } = await import("../../lib/v2/data/features.ts");
const M = await import("../../lib/v2/data/manifest.ts");
const A = await import("../../lib/v2/app-db.ts");
const { runSkeletonAnalysis } = await import("../../lib/v2/analysis-skeleton.ts");

const CENTER = [127.1506, 37.6245];
const [cx, cy] = toUtmk(CENTER);
const at = (dx, dy) => [...toLngLat([cx + dx, cy + dy])];
const box = (dx, dy) => ({ type: "Polygon", coordinates: [[at(dx, dy), at(dx + 10, dy), at(dx + 10, dy + 10), at(dx, dy + 10), at(dx, dy)]] });

async function buildCore(dataDir, version, offsets) {
  const rel = `versions/${version}/core.sqlite`;
  mkdirSync(join(dataDir, "versions", version), { recursive: true });
  const db = new Database(join(dataDir, rel));
  initDataFileSchema(db, "core");
  if (offsets.length > 0) {
    db.prepare(`INSERT INTO source_release (release_id, source_id, provider, source_url, source_as_of, fetched_at, checksum, schema_version, license_code)
      VALUES (?, 'gis_building', '국토교통부', 'https://www.data.go.kr/data/15083092/fileData.do', '2026-09-01', '2026-09-29T00:00:00+09:00', 'x', 1, 'KOGL-1')`).run(`rel-${version}`);
  }
  offsets.forEach(([dx, dy], i) => insertFeature(db, { stableId: `${version}-b${i}`, kind: "building", sourceKey: `b${i}`, releaseId: `rel-${version}`, geometry: box(dx, dy) }));
  db.close();
  const manifest = { version, createdAt: "2026-09-29T00:00:00+09:00", files: { core: { path: rel, sha256: await M.sha256File(join(dataDir, rel)), kind: "core", schemaVersion: 1 } } };
  const r = await M.publishManifest(dataDir, manifest, () => ({ ok: true, failures: [] }));
  assert.equal(r.published, true);
  return r.hash;
}

const dataDir = mkdtempSync(join(tmpdir(), "v2-e2e-data-"));
const appDb = A.openV2AppDb(join(mkdtempSync(join(tmpdir(), "v2-e2e-app-")), "app.sqlite"));
const input = { address: "경기도 남양주시 다산동", center: CENTER, radiusM: 800, analysisDate: "2026-09-29" };

// 데이터 없음 → 분석 거부
assert.throws(() => runSkeletonAnalysis(appDb, dataDir, input), /no published manifest/);

// v1: 반경 안 2동, 밖 1동
const h1 = await buildCore(dataDir, "v1", [[0, 0], [300, 300], [2000, 0]]);
const r1 = runSkeletonAnalysis(appDb, dataDir, input);
assert.equal(r1.manifestHash, h1);
assert.equal(r1.tiles.length, 1);
const d02 = r1.tiles[0];
assert.equal(d02.tileCode, "D02");
assert.equal(d02.status, "complete");
assert.equal(d02.metrics[0].value, 2);
assert.equal(d02.provenance.manifestHash, h1, "타일이 분석과 같은 데이터 버전");
assert.equal(d02.provenance.sources[0].releaseId, "rel-v1");
assert.equal(d02.provenance.sources[0].sourceAsOf, "2026-09-01");
assert.equal(A.getAnalysisRun(appDb, r1.analysisId).status, "complete");
A.saveProject(appDb, { projectId: "p1", name: "다산", analysisId: r1.analysisId, board: { tiles: ["D02"] } });

// v2 게시(5동) → 새 분석은 새 버전, 옛 분석은 그대로
const h2 = await buildCore(dataDir, "v2", [[0, 0], [100, 0], [200, 0], [300, 0], [400, 0]]);
const r2 = runSkeletonAnalysis(appDb, dataDir, input);
assert.equal(r2.manifestHash, h2);
assert.equal(r2.tiles[0].metrics[0].value, 5);
assert.deepEqual(A.loadTileResults(appDb, r1.analysisId), r1.tiles, "저장된 분석은 옛 결과 그대로 복원");

// v3 게시(건물 없음) → 0동이 아니라 no_data (출처가 없으므로)
await buildCore(dataDir, "v3", []);
const r3 = runSkeletonAnalysis(appDb, dataDir, input);
assert.equal(r3.tiles[0].status, "no_data");
assert.equal(r3.tiles[0].metrics[0].status, "missing");
assert.equal(r3.tiles[0].metrics[0].value, null);

// 가비지 수집: 저장 프로젝트가 쓰는 v1은 남는다 (현재 v3, 이전 v2)
M.collectGarbage(dataDir, A.pinnedManifestHashes(appDb));
assert.ok(existsSync(join(dataDir, "versions/v1/core.sqlite")), "핀 고정된 v1 유지");

console.log("✓ v2 analysis skeleton (end to end)");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx src/scripts/v2/test-v2-analysis-skeleton.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

`src/lib/v2/analysis-skeleton.ts`:

```ts
/**
 * P0 끝에서 끝 증명용 최소 분석 (spec §6 P0 완료 기준).
 * D02 건물 타일 하나만 만든다. 실제 타일 엔진은 P1에서 이 흐름 위에 올린다.
 */
import { randomUUID } from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";
import type { LngLat } from "./crs";
import { queryFeaturesInRadius } from "./data/features";
import { manifestHash, openDataFile, readManifest } from "./data/manifest";
import { createAnalysisRun, finishAnalysisRun, getAnalysisRun, saveTileResult } from "./app-db";
import { parseTileResult, tileCacheKey, type TileResult } from "./tile-result";

export const SKELETON_ENGINE_VERSION = "v2-p0";

export interface SkeletonInput {
  address: string;
  center: LngLat;
  radiusM: number;
  analysisDate: string;
}

interface ReleaseRow {
  release_id: string;
  source_id: string;
  source_as_of: string | null;
  fetched_at: string;
}

export function runSkeletonAnalysis(
  appDb: BetterSqlite3.Database,
  dataDir: string,
  input: SkeletonInput,
): { analysisId: string; manifestHash: string; tiles: TileResult[] } {
  const manifest = readManifest(dataDir);
  if (!manifest) throw new Error("no published manifest — run a data build first");
  const hash = manifestHash(manifest);
  // 데이터 파일을 먼저 연다 — 열기에 실패하면 'running'으로 남는 분석 실행을 만들지 않는다.
  const core = openDataFile(dataDir, manifest, "core");
  const analysisId = randomUUID();
  try {
    createAnalysisRun(appDb, {
      analysisId, address: input.address, center: input.center, radiusM: input.radiusM,
      analysisDate: input.analysisDate, manifestHash: hash, engineVersion: SKELETON_ENGINE_VERSION, parameters: {},
    });
    const hits = queryFeaturesInRadius(core, input.center, input.radiusM, ["building"]);
    // 반경 안 건물이 0동이어도 건물 원천이 적재돼 있으면 "0동 관측"이다. 원천 자체가 없으면 "자료 없음"이다.
    const releases = core
      .prepare(`SELECT release_id, source_id, source_as_of, fetched_at FROM source_release
        WHERE release_id IN (SELECT DISTINCT release_id FROM feature WHERE kind = 'building') ORDER BY release_id`)
      .all() as ReleaseRow[];
    const hasSource = releases.length > 0;

    const conditions = {
      address: input.address,
      center: [input.center[0], input.center[1]] as [number, number],
      radiusM: input.radiusM,
      analysisDate: input.analysisDate,
      timezone: "Asia/Seoul" as const,
      filters: {},
      simulation: null,
      parcelSnapshotHash: null,
    };
    const tile = parseTileResult({
      tileId: `${analysisId}-D02`,
      analysisId,
      tileType: "diagram",
      tileCode: "D02",
      status: hasSource ? "complete" : "no_data",
      engineVersion: SKELETON_ENGINE_VERSION,
      conditions,
      metrics: [{
        id: "building_count", label: "반경 내 건물", value: hasSource ? hits.length : null, unit: "동",
        formulaVersion: "d02-count@1", numerator: null, denominator: null, status: hasSource ? "observed" : "missing",
      }],
      judgment: null,
      presentation: { legend: [], camera: null, layers: ["building"], outputFace: "front" },
      provenance: {
        manifestHash: hash,
        sources: releases.map((r) => ({ sourceId: r.source_id, releaseId: r.release_id, sourceAsOf: r.source_as_of, fetchedAt: r.fetched_at })),
      },
      limitations: hasSource ? [] : [{ kind: "not_provided", note: "건물 원천이 적재되지 않았습니다" }],
    });
    saveTileResult(appDb, tile, tileCacheKey({ tileCode: "D02", manifestHash: hash, engineVersion: SKELETON_ENGINE_VERSION, conditions }));
    finishAnalysisRun(appDb, analysisId, "complete");
    return { analysisId, manifestHash: hash, tiles: [tile] };
  } catch (error) {
    if (getAnalysisRun(appDb, analysisId)) finishAnalysisRun(appDb, analysisId, "failed");
    throw error;
  } finally {
    core.close();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:v2 && npx tsc --noEmit`
Expected: 여덟 줄 모두 `✓`, tsc 오류 0

- [ ] **Step 5: 기존 테스트가 그대로인지 확인**

Run: `npm run test:dataset`
Expected: 기존 테스트 전부 통과(v2가 기존 모듈을 바꾸지 않았음을 확인)

Run: `git status --short src/lib/server src/app src/components deploy`
Expected: 출력 없음

- [ ] **Step 6: Commit**

```bash
git add src/lib/v2/analysis-skeleton.ts src/scripts/v2/test-v2-analysis-skeleton.mjs package.json
# 메시지: "feat: v2 끝에서 끝 증명 — 분석·타일·저장·새 버전·복원·가비지 수집이 같은 manifest 해시를 따른다"
```

---

### Task 9: A0 측정 도구

**Files:**
- Create: `src/lib/v2/a0/review-sites.ts`, `src/lib/v2/a0/measure.ts`, `src/scripts/v2/a0-measure.mjs`
- Test: `src/scripts/v2/test-v2-a0-measure.mjs`
- Modify: `package.json` (`test:v2`에 추가, `"a0:measure": "tsx src/scripts/v2/a0-measure.mjs"` 추가)

**Interfaces:**
- Consumes: `toUtmk`, `LngLat` (Task 1)
- Produces:
  - `interface ReviewSite { id: string; name: string; address: string; center: LngLat; checks: string }`, `const REVIEW_SITES: readonly ReviewSite[]` (8곳)
  - `decodeText(buf: Uint8Array): { text: string; encoding: "utf-8" | "euc-kr" }`
  - `parseCsv(text: string): string[][]`
  - `isFilled(v: unknown): boolean`
  - `interface MeasureRecord { properties: Record<string, unknown>; point: LngLat | null }`
  - `interface FieldReport { field: string; filled: number; total: number; fillRate: number | null /* 분모 0이면 null */ }`
  - `interface MeasureReport { rows: number; fields: FieldReport[]; byRegion: Record<string, number>; bySite: Record<string, { rows: number; fields: FieldReport[] }> }`
  - `interface MeasureOptions { regionField?: string; regionDigits?: number; sites?: readonly ReviewSite[]; siteRadiusM?: number }`
  - `measureRecords(records: Iterable<MeasureRecord> | AsyncIterable<MeasureRecord>, fieldNames: readonly string[], options?: MeasureOptions): Promise<MeasureReport>`
  - `csvRecords(buf: Uint8Array, opts?: { lngField?: string; latField?: string }): { encoding: string; fieldNames: string[]; records: MeasureRecord[] }`
  - `shpRecords(shpPath: string, opts: { encoding: string; crs: string }): Promise<{ fieldNames: string[]; records: AsyncIterable<MeasureRecord> }>`

- [ ] **Step 1: Write the failing test**

`src/scripts/v2/test-v2-a0-measure.mjs`:

```js
/**
 * A0 측정 도구 테스트.
 * data.go.kr CSV는 대부분 CP949다. UTF-8로 잘못 읽으면 채움률이 조용히 틀린다.
 */
import assert from "node:assert/strict";

const { decodeText, parseCsv, isFilled, measureRecords, csvRecords } = await import("../../lib/v2/a0/measure.ts");
const { REVIEW_SITES } = await import("../../lib/v2/a0/review-sites.ts");

// ─── 1. 인코딩 판별 ────────────────────────────────────────────────────────
{
  // "가" = EUC-KR B0 A1
  const euckr = Uint8Array.from([0x6e, 0x61, 0x6d, 0x65, 0x0a, 0xb0, 0xa1, 0x0a]);
  assert.deepEqual(decodeText(euckr), { text: "name\n가\n", encoding: "euc-kr" });
  const bom = Uint8Array.from([0xef, 0xbb, 0xbf, ...Buffer.from("name\n가\n", "utf8")]);
  assert.deepEqual(decodeText(bom), { text: "name\n가\n", encoding: "utf-8" });
  assert.equal(decodeText(Buffer.from("a,b\n", "utf8")).encoding, "utf-8");
}

// ─── 2. CSV: 따옴표 안 쉼표·줄바꿈·이스케이프, CRLF ─────────────────────────
{
  assert.deepEqual(parseCsv('a,b\r\n"x,1","y ""q"""\r\n"multi\nline",z\r\n'), [["a", "b"], ["x,1", 'y "q"'], ["multi\nline", "z"]]);
  assert.deepEqual(parseCsv("a,b\n1,\n"), [["a", "b"], ["1", ""]], "빈 마지막 칸 보존");
}

// ─── 3. 채움 판정 ──────────────────────────────────────────────────────────
{
  for (const v of ["", "  ", null, undefined, "None", "null", "NULL", "-", "NaN"]) assert.equal(isFilled(v), false, `${v}`);
  for (const v of ["0", 0, "가", "2020-01-01"]) assert.equal(isFilled(v), true, `${v}`);
}

// ─── 4. 측정: 전체·지역·검수지 ──────────────────────────────────────────────
{
  const site = REVIEW_SITES.find((s) => s.id === "dasan");
  const csv = Buffer.from(
    ["code,height,lng,lat",
     `4136010100,12.5,${site.center[0]},${site.center[1]}`,
     `4136010100,,${site.center[0]},${site.center[1]}`,
     "1168010100,30,127.0592,37.4869",
     "2635010100,None,,"].join("\n") + "\n",
    "utf8",
  );
  const { fieldNames, records, encoding } = csvRecords(csv, { lngField: "lng", latField: "lat" });
  assert.equal(encoding, "utf-8");
  assert.deepEqual(fieldNames, ["code", "height", "lng", "lat"]);
  assert.equal(records[3].point, null, "좌표 없는 행");

  const report = await measureRecords(records, fieldNames, { regionField: "code", regionDigits: 2, sites: REVIEW_SITES, siteRadiusM: 1000 });
  assert.equal(report.rows, 4);
  assert.deepEqual(report.fields.find((f) => f.field === "height"), { field: "height", filled: 2, total: 4, fillRate: 0.5 });
  assert.deepEqual(report.byRegion, { "11": 1, "26": 1, "41": 2 });
  assert.equal(report.bySite.dasan.rows, 2);
  assert.deepEqual(report.bySite.dasan.fields.find((f) => f.field === "height"), { field: "height", filled: 1, total: 2, fillRate: 0.5 });
  assert.equal(report.bySite.guryong.rows, 1);
  assert.equal(report.bySite.wanju.rows, 0);
  assert.deepEqual(report.bySite.wanju.fields.find((f) => f.field === "height"), { field: "height", filled: 0, total: 0, fillRate: null }, "0행이면 채움률은 산정 불가(null)");
}

// ─── 5. 검수지 8곳 ─────────────────────────────────────────────────────────
{
  assert.equal(REVIEW_SITES.length, 8);
  assert.deepEqual(REVIEW_SITES.map((s) => s.id), ["guryong", "dasan", "cheongwadae", "jeongja", "marinecity", "bokjeong", "sejong", "wanju"]);
  for (const s of REVIEW_SITES) {
    assert.ok(s.center[0] > 124 && s.center[0] < 132 && s.center[1] > 33 && s.center[1] < 39, `${s.id} 좌표가 한국 범위`);
  }
}

console.log("✓ v2 a0 measure");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx src/scripts/v2/test-v2-a0-measure.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

`src/lib/v2/a0/review-sites.ts`:

```ts
/**
 * 검수 대표 지역 8곳 (spec §6.1).
 * 좌표는 대표 지점의 근사값이다. Task 10에서 주소 검색으로 한 번 확인하고 필요하면 고친다.
 */
import type { LngLat } from "../crs";

export interface ReviewSite {
  id: string;
  name: string;
  address: string;
  center: LngLat;
  checks: string;
}

export const REVIEW_SITES: readonly ReviewSite[] = [
  { id: "guryong", name: "구룡역", address: "서울특별시 강남구 개포동 구룡역", center: [127.0592, 37.4869], checks: "정비사업 밀집, 기존 QA 비교" },
  { id: "dasan", name: "다산역", address: "경기도 남양주시 다산동 다산역", center: [127.1506, 37.6245], checks: "신도시, 분양·입주 물량, 기존 QA 비교" },
  { id: "cheongwadae", name: "청와대", address: "서울특별시 종로구 청와대로 1", center: [126.9748, 37.5866], checks: "도심 + 산지, 기존 샘플 비교" },
  { id: "jeongja", name: "정자역", address: "경기도 성남시 분당구 정자동 정자역", center: [127.1085, 37.367], checks: "경기 정비사업 단계" },
  { id: "marinecity", name: "해운대 마린시티", address: "부산광역시 해운대구 우동 마린시티", center: [129.1445, 35.156], checks: "초고층, 해안" },
  { id: "bokjeong", name: "복정역", address: "서울특별시 송파구 장지동 복정역", center: [127.1265, 37.47], checks: "시군구 경계를 넘는 반경(서울·성남)" },
  { id: "sejong", name: "세종 정부청사", address: "세종특별자치시 도움6로 11", center: [127.265, 36.504], checks: "계획도시, 신규 지역" },
  { id: "wanju", name: "완주 봉동읍", address: "전북특별자치도 완주군 봉동읍", center: [127.164, 35.944], checks: "농촌·산지, 자료 공백" },
];
```

`src/lib/v2/a0/measure.ts`:

```ts
/**
 * A0 검증표용 측정 (spec §6 P0, §7).
 * 원천 파일의 행 수, 필드별 채움률, 시도별 행 수, 검수지 반경 내 행 수·채움률을 잰다.
 */
import { open as openShapefile } from "shapefile";
import proj4 from "proj4";
import { toUtmk, UTMK, type LngLat } from "../crs";
import type { ReviewSite } from "./review-sites";

export function decodeText(buf: Uint8Array): { text: string; encoding: "utf-8" | "euc-kr" } {
  const bytes = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? buf.subarray(3) : buf;
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("euc-kr").decode(bytes), encoding: "euc-kr" };
  }
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

const EMPTY_MARKERS = new Set(["", "none", "null", "-", "nan"]);

export function isFilled(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  return !EMPTY_MARKERS.has(String(v).trim().toLowerCase());
}

export interface MeasureRecord {
  properties: Record<string, unknown>;
  point: LngLat | null;
}

export interface FieldReport {
  field: string;
  filled: number;
  total: number;
  /** 분모가 0이면 산정 불가(null) */
  fillRate: number | null;
}

export interface MeasureReport {
  rows: number;
  fields: FieldReport[];
  byRegion: Record<string, number>;
  bySite: Record<string, { rows: number; fields: FieldReport[] }>;
}

export interface MeasureOptions {
  regionField?: string;
  regionDigits?: number;
  sites?: readonly ReviewSite[];
  siteRadiusM?: number;
}

class Tally {
  rows = 0;
  filled = new Map<string, number>();
  constructor(private readonly fieldNames: readonly string[]) {}
  add(props: Record<string, unknown>) {
    this.rows++;
    for (const f of this.fieldNames) if (isFilled(props[f])) this.filled.set(f, (this.filled.get(f) ?? 0) + 1);
  }
  report(): FieldReport[] {
    return this.fieldNames.map((field) => {
      const filled = this.filled.get(field) ?? 0;
      return { field, filled, total: this.rows, fillRate: this.rows === 0 ? null : filled / this.rows };
    });
  }
}

export async function measureRecords(
  records: Iterable<MeasureRecord> | AsyncIterable<MeasureRecord>,
  fieldNames: readonly string[],
  options: MeasureOptions = {},
): Promise<MeasureReport> {
  const all = new Tally(fieldNames);
  const byRegion: Record<string, number> = {};
  const sites = (options.sites ?? []).map((s) => ({ site: s, xy: toUtmk(s.center), tally: new Tally(fieldNames) }));
  const radius = options.siteRadiusM ?? 1000;

  for await (const r of records) {
    all.add(r.properties);
    if (options.regionField) {
      const code = String(r.properties[options.regionField] ?? "").slice(0, options.regionDigits ?? 2);
      const key = code === "" ? "(없음)" : code;
      byRegion[key] = (byRegion[key] ?? 0) + 1;
    }
    if (r.point && sites.length > 0) {
      const [x, y] = toUtmk(r.point);
      for (const s of sites) if (Math.hypot(x - s.xy[0], y - s.xy[1]) <= radius) s.tally.add(r.properties);
    }
  }
  const bySite: MeasureReport["bySite"] = {};
  for (const s of sites) bySite[s.site.id] = { rows: s.tally.rows, fields: s.tally.report() };
  return { rows: all.rows, fields: all.report(), byRegion, bySite };
}

export function csvRecords(buf: Uint8Array, opts: { lngField?: string; latField?: string } = {}) {
  const { text, encoding } = decodeText(buf);
  const [header = [], ...rows] = parseCsv(text).filter((r) => !(r.length === 1 && r[0] === ""));
  const records: MeasureRecord[] = rows.map((cells) => {
    const properties = Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""]));
    const lng = opts.lngField ? Number(properties[opts.lngField]) : Number.NaN;
    const lat = opts.latField ? Number(properties[opts.latField]) : Number.NaN;
    const hasPoint = isFilled(properties[opts.lngField ?? ""]) && isFilled(properties[opts.latField ?? ""]) && Number.isFinite(lng) && Number.isFinite(lat);
    return { properties, point: hasPoint ? ([lng, lat] as LngLat) : null };
  });
  return { encoding, fieldNames: header, records };
}

/** SHP 첫 좌표를 대표점으로 쓴다(검수지 반경 집계용 근사). crs는 "EPSG:5186"처럼 준다. */
export async function shpRecords(shpPath: string, opts: { encoding: string; crs: string }) {
  if (opts.crs !== "EPSG:4326" && !proj4.defs(opts.crs)) {
    throw new Error(`unknown CRS ${opts.crs} — define it with proj4.defs first (UTM-K is ${UTMK})`);
  }
  const source = await openShapefile(shpPath, undefined, { encoding: opts.encoding });
  const first = await source.read();
  const fieldNames = first.done ? [] : Object.keys(first.value.properties ?? {});
  const toLngLat = (xy: number[]): LngLat => {
    const [lng, lat] = opts.crs === "EPSG:4326" ? xy : proj4(opts.crs, "EPSG:4326", xy);
    return [lng, lat];
  };
  const firstPosition = (coords: unknown): number[] | null => {
    let c: unknown = coords;
    while (Array.isArray(c) && Array.isArray(c[0])) c = c[0];
    return Array.isArray(c) && typeof c[0] === "number" ? (c as number[]) : null;
  };
  async function* records(): AsyncGenerator<MeasureRecord> {
    let next = first;
    while (!next.done) {
      const f = next.value;
      const pos = f.geometry && "coordinates" in f.geometry ? firstPosition(f.geometry.coordinates) : null;
      yield { properties: (f.properties ?? {}) as Record<string, unknown>, point: pos ? toLngLat(pos) : null };
      next = await source.read();
    }
  }
  return { fieldNames, records: records() };
}
```

`shapefile` 패키지에 타입 선언이 없어 `tsc`가 실패하면, 같은 폴더에 `src/lib/v2/a0/shapefile.d.ts`를 만든다:

```ts
declare module "shapefile" {
  import type { Feature } from "geojson";
  interface Source {
    read(): Promise<{ done: true; value: undefined } | { done: false; value: Feature }>;
  }
  export function open(shp: string, dbf?: string, options?: { encoding?: string }): Promise<Source>;
}
```

(기존 코드가 이미 `shapefile`을 import하므로 선언이 있으면 이 파일은 만들지 않는다. `npx tsc --noEmit` 결과로 판단한다.)

`src/scripts/v2/a0-measure.mjs`:

```js
/**
 * A0 측정 CLI.
 *   npm run a0:measure -- <file.csv|file.shp> [--region-field CODE] [--region-digits 2]
 *                         [--lng-field X --lat-field Y] [--encoding cp949] [--crs EPSG:5186]
 *                         [--site-radius 1000] [--out report.json]
 */
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { extname } from "node:path";
import proj4 from "proj4";

const { measureRecords, csvRecords, shpRecords } = await import("../../lib/v2/a0/measure.ts");
const { REVIEW_SITES } = await import("../../lib/v2/a0/review-sites.ts");
const { PROJ4_DEFINITIONS } = await import("../../lib/server/maintenance/boundary-crs.ts");
for (const [name, def] of Object.entries(PROJ4_DEFINITIONS)) proj4.defs(name, def);
await import("../../lib/v2/crs.ts"); // EPSG:5179 정의

const [file, ...rest] = process.argv.slice(2);
if (!file) {
  console.error("usage: a0-measure <file.csv|file.shp> [options]");
  process.exit(2);
}
const opt = (name, fallback) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : fallback;
};

const ext = extname(file).toLowerCase();
let fieldNames;
let records;
let encoding;
if (ext === ".csv") {
  ({ fieldNames, records, encoding } = csvRecords(readFileSync(file), { lngField: opt("lng-field"), latField: opt("lat-field") }));
} else if (ext === ".shp") {
  encoding = opt("encoding", "cp949");
  ({ fieldNames, records } = await shpRecords(file, { encoding, crs: opt("crs", "EPSG:5186") }));
} else {
  console.error(`unsupported file type ${ext}`);
  process.exit(2);
}

const report = await measureRecords(records, fieldNames, {
  regionField: opt("region-field"),
  regionDigits: Number(opt("region-digits", "2")),
  sites: REVIEW_SITES,
  siteRadiusM: Number(opt("site-radius", "1000")),
});
const out = { file, bytes: statSync(file).size, encoding, measuredAt: new Date().toISOString(), ...report };
const json = JSON.stringify(out, null, 2);
const outPath = opt("out");
if (outPath) writeFileSync(outPath, json);
console.log(json);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:v2 && npx tsc --noEmit`
Expected: 아홉 줄 모두 `✓`, tsc 오류 0

Run (CLI 스모크, 임시 CSV):

```bash
printf 'code,height,lng,lat\n4136010100,12,127.1506,37.6245\n' > "$TEMP/a0-smoke.csv"
npm run a0:measure -- "$TEMP/a0-smoke.csv" --region-field code --lng-field lng --lat-field lat
```

Expected: JSON 출력에 `"rows": 1`, `"byRegion": { "41": 1 }`, `bySite.dasan.rows`가 1

- [ ] **Step 5: Commit**

```bash
git add src/lib/v2/a0 src/scripts/v2/a0-measure.mjs src/scripts/v2/test-v2-a0-measure.mjs package.json
# 메시지: "feat: A0 측정 도구 — 인코딩 자동 판별, 채움률·시도별·검수지별 측정"
```

---

### Task 10: A0 검증 수행과 검증표

이 태스크는 코드가 아니라 **조사·측정 작업**이다. 결과물은 검증표 문서와 측정 JSON이며, P0의 첫 번째 완료 기준(spec §6 P0: 원천별 취득 가능 여부·권리·실측 크기·채움률·블로커 확정)을 채운다. 로그인·활용신청이 필요한 단계는 사용자에게 요청하고, 그 사실을 표에 적는다. 원본 파일은 `.cache/v2/raw/`(gitignore됨)에 둔다. 원본 파일과 API 키는 커밋하지 않는다.

**Files:**
- Create: `docs/superpowers/a0/2026-09-29-a0-verification.md`
- Create: `docs/superpowers/a0/measurements/<source_id>.json` (측정 결과, 원천마다 하나)
- Modify: `src/lib/v2/a0/review-sites.ts` (좌표 확인 결과 반영 시에만)

- [ ] **Step 1: 검증표 틀 작성**

`docs/superpowers/a0/2026-09-29-a0-verification.md`를 아래 내용으로 만든다. 표의 원천 목록은 spec §3.6과 `docs/research/2026-09-29-data-architecture-astra.md` §3에서 가져왔다.

```markdown
# A0 원천 검증표

작성 시작: 2026-09-29 · 기준 스펙: docs/superpowers/specs/2026-09-29-site-analysis-v2-design.md

판정: ✅ 사용 가능 / ⚠️ 조건부 / ⛔ 차단 / ⏳ 사용자 조치 대기

| # | source_id | 원천 (링크) | 취득 방법 | 라이선스·이용 조건 (원문 인용) | 내부 업무 사용 | 원본 크기 | 전국 행 수 | 핵심 필드 채움률 | 검수지 8곳 행 수 | 판정 | 블로커·메모 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | gis_building | GIS건물통합정보 https://www.data.go.kr/data/15083092/fileData.do | | | | | | 높이·층수·사용승인일 | | | |
| 2 | ledger_recap | 건축물대장 총괄표제부 https://www.data.go.kr/data/15044719/fileData.do | | | | | | 세대수·주차·사용승인일 | | | |
| 3 | ledger_title | 건축물대장 표제부 https://www.data.go.kr/data/15044720/fileData.do | | | | | | 주용도·기타용도·호수 | | | |
| 4 | cadastral | 연속지적도 (VWorld 공간정보 다운로드) | | | | | | PNU·지목 | | | |
| 5 | zoning | 용도지역·지구 (VWorld / https://www.data.go.kr/data/15123973/openapi.do) | | | | | | 용도지역 코드 | | | 파일별 공공누리 유형 확인 |
| 6 | land_price | 개별공시지가 https://www.data.go.kr/data/15052266/fileData.do | | | | | | 공시지가·기준연도 | | | |
| 7 | legal_dong | 법정동 경계 (VWorld LT_C_ADEMD 또는 SGIS 경계) | | | | | | 법정동 코드 | | | |
| 8 | sgis_grid | SGIS 격자 통계 https://www.data.go.kr/data/15141768/fileData.do | | | | | | 인구·가구 | | | 비밀보호 노이즈 |
| 9 | school | 학교 위치 표준데이터 https://www.data.go.kr/data/15021148/standard.do | | | | | | 학교급·운영상태·좌표 | | | |
| 10 | school_zone | 초등 통학구역 https://www.data.go.kr/data/15021149/standard.do · 학구도 연계 https://www.data.go.kr/data/15021158/standard.do | | | | | | 폴리곤 유무·학교 연결 | | | CSV에 폴리곤 없음(확인 필요) |
| 11 | store | 소상공인 상가정보 https://www.data.go.kr/data/15083033/fileData.do | | | | | | 업종코드·좌표 | | | |
| 12 | bus_stop | 전국 버스정류장 https://www.data.go.kr/data/15067528/fileData.do | | | | | | 좌표·정류장ID | | | |
| 13 | move_in | 입주예정물량 https://www.data.go.kr/data/15111714/fileData.do | | | | | | 입주시기·세대수 | | | |
| 14 | applyhome | 청약홈 분양정보 https://www.data.go.kr/data/15101046/fileData.do | | | | | | 공급위치·세대수 | | | 좌표 실패 553/3,134 (api-audit) |
| 15 | rtms | 국토부 실거래 API 모음 https://www.data.go.kr/dataset/3050988/openapi.do | | | | | | | | | 일일 호출 한도·운영계정 |
| 16 | kapt | K-APT 단지 목록·상세 | | | | | | 세대수·주차 | | | |
| 17 | maintenance | 정비사업 통합 15160169·표준 15155703·서울·부산·경기 | | | | | | 단계·기준일 | | | 경계 SHP 비상업 허락 = 내부 업무 가능(2026-09-29 확인) |
| 18 | park | 도시공원 표준데이터(파일) | | | | | | 면적·유형 | | | |
| 19 | osm | Geofabrik south-korea-latest.osm.pbf https://download.geofabrik.de/asia/south-korea.html | | ODbL | | | | | | | |
| 20 | dem | 국토지리정보원 DEM / AWS Terrain Tiles https://registry.opendata.aws/terrain-tiles/ | | | | | | 해상도·수직 기준 | | | DEM/DSM 구분 |
| 21 | weather | EPW(Climate.OneBuilding) · 기상청 ASOS https://www.data.go.kr/data/15057210/openapi.do | | | | | | 관측 기간·결측 | | | |
| 22 | vworld_wmts | VWorld WMTS 배경·항공영상 https://vworld.kr/dev/v4dv_wmtsguide_s001.do | | | | — | — | — | — | | 저장·스티칭·PPT 삽입 허용 여부 |

## 검수지 좌표 확인

| id | 이름 | 코드상 좌표 | 확인한 좌표 | 확인 방법 |
|---|---|---|---|---|

## 블로커 요약

(판정 ⛔·⏳ 항목과 필요한 사용자 조치를 적는다)

## 고정 지점 기대치 후보

(spec §3.5: 첫 적재 결과를 원천 총건수·독립 표본과 대조해 승인한 값만 적는다. 형식: siteId · kind · minCount · 근거)
```

- [ ] **Step 2: 권리 확인 (원천마다)**

각 원천 페이지에서 이용허락 범위(공공누리 유형, 제한 없음, ODbL 등) 원문을 그대로 인용해 "라이선스·이용 조건" 칸에 적는다. "내부 업무 사용" 칸에는 ✅/⚠️/⛔와 한 줄 근거를 적는다. 페이지 조회는 `/browse` 스킬을 쓴다. 판단이 애매하면 ⚠️로 두고 블로커 요약에 올린다.

- [ ] **Step 3: 파일 취득**

로그인 없이 받을 수 있는 파일은 `.cache/v2/raw/<source_id>/`에 받는다. 로그인·활용신청이 필요하면 판정을 ⏳로 두고 필요한 사용자 조치를 블로커 요약에 적는다(예: "VWorld 로그인 후 연속지적도 시도별 SHP 다운로드 필요"). 파일 크기(바이트)를 "원본 크기"에 적는다.

- [ ] **Step 4: 측정**

받은 파일마다 실행한다(예시 — 필드명은 실제 헤더를 보고 바꾼다):

```bash
npm run a0:measure -- .cache/v2/raw/school/school.csv --region-field 시도교육청코드 --lng-field 경도 --lat-field 위도 --out docs/superpowers/a0/measurements/school.json
npm run a0:measure -- .cache/v2/raw/gis_building/<시도>.shp --encoding cp949 --crs EPSG:5186 --region-field A1 --out docs/superpowers/a0/measurements/gis_building-<시도>.json
```

측정 JSON에서 "전국 행 수", "핵심 필드 채움률", "검수지 8곳 행 수"를 표에 옮긴다. 검수지 행 수가 0인 곳은 메모에 적는다(완주처럼 실제로 적을 수 있는 곳과 원천 공백을 구별).

전국 파일이 수 GB라 시도별로 나뉘어 있으면, 검수지가 속한 시도(서울 11, 부산 26, 경기 41, 세종 36, 전북 52)만 먼저 측정하고 나머지는 행 수만 적는다.

- [ ] **Step 5: 검수지 좌표 확인**

8곳 좌표를 지도 검색으로 확인해 "검수지 좌표 확인" 표를 채운다. 200m 넘게 차이 나면 `src/lib/v2/a0/review-sites.ts`를 고치고 `npm run test:v2`를 다시 돌린다.

- [ ] **Step 6: 블로커 요약과 사용자 보고**

⛔·⏳ 항목을 모아 블로커 요약에 적는다. 각 항목에 "무엇을, 누가, 어디서" 해야 하는지 한 줄로 적는다. 이 요약을 사용자에게 보고하고 결정을 받는다(P1 구현 계획은 이 결과를 입력으로 쓴다).

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/a0 src/lib/v2/a0/review-sites.ts
# 메시지: "docs: A0 원천 검증표 — 권리·크기·채움률·블로커"
```

---

## Self-Review (작성자 확인 결과)

- **스펙 대응:** §3.2 저장 구조 → Task 2·5·7 / §3.3 테이블·규칙 → Task 2·3 / §3.4 교체·보존 → Task 5·8 / §3.5 품질 검사·고정 지점 → Task 4(검사), Task 10(기대치 수집) / §5.2 `tile_result`·캐시 키·기준일 → Task 6·7 / §4.6 기존 앱 비수정 → Global Constraints, Task 8 Step 5 / §6 P0 두 완료 기준 → Task 8(같은 manifest 해시), Task 10(A0 표) / §6.1 검수지 → Task 9·10 / §7 위험 → Task 10 표. P0 범위 밖(P1 이후): 실제 원천 적재 파이프라인, 법정동 로컬 판별, 타일 엔진, UI.
- **의도적 차이:** 스펙 초안(data-architecture-astra §4)의 `geom_wkb`는 P0에서 GeoJSON 텍스트(`geom_json`)로 둔다. 새 의존성 없이 turf로 판정하기 위해서다. A0 실측에서 core 파일이 디스크 예산을 넘으면 WKB로 바꾼다(Task 2 ponytail 주석).
- **타입 일관성:** `LngLat`(Task 1)을 Task 3·8·9가 같은 이름으로 쓴다. `GateResult`/`GateFailure`(Task 4)를 Task 5가 쓴다. `TileResult`/`TileConditions`(Task 6)를 Task 7·8이 쓴다. `FieldReport.fillRate`는 `number | null`(Task 9 본문에 명시).
