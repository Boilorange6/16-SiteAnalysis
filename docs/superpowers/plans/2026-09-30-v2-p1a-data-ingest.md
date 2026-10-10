# SiteAnalysis v2 P1a (데이터 적재) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** VWorld 파일을 자동으로 받고, 이미 받아 둔 공공데이터 파일과 함께 전국 `core`·`reference`·`market` 데이터 파일을 한 번의 잠금 안에서 만들어 품질 검사를 거쳐 게시한다. 결과로 반경 조회만으로 법정동·시군구, 필지 위치, 주거 단지·오피스텔, 상가, 버스정류장, 공원, 분양·입주예정을 찾을 수 있게 된다.

**Architecture:** P1은 셋으로 나눈다 — **P1a 데이터 적재(이 계획)**, P1b 타일 엔진(A01·A03·A04·A05·A06·A07·A09·A10), P1c 보드 UI·PPT v2. 실거래(RTMS)·정비사업·철도·OSM PBF 같은 API/PBF 원천은 P1a-2 계획으로 뺀다. P1a의 모든 코드는 `src/lib/v2/ingest/`(적재)와 `src/lib/v2/data/`(조회)에 둔다. 원천 파일 → 어댑터(async iterable) → 원천별 빌더(순수 함수에 가깝게, 테스트는 합성 레코드) → `buildAndPublish`(잠금·파일 생성·ingest_run·품질 검사·게시). 위치가 없는 원천(건축물대장, 입주예정)은 PNU → 필지 대표점(`parcel_point`)으로 붙인다.

**Tech Stack:** TypeScript, better-sqlite3(R*Tree), proj4, @turf/turf, shapefile 0.6, jszip(테스트용 zip 생성), Node 24 내장 `fetch`/`Headers.getSetCookie`/`process.loadEnvFile`, Windows `tar.exe`(zip 해제). tsx 테스트(`node:assert/strict`).

**Spec:** `docs/superpowers/specs/2026-09-29-site-analysis-v2-design.md` (§3 데이터, §3.5 적재·품질 검사, §6 P1). 선행: `docs/superpowers/plans/2026-09-29-v2-p0-foundation.md`, P0 이월 `docs/superpowers/plans/2026-09-29-v2-p0-followups.md`, 원천 검증 `docs/superpowers/a0/2026-09-29-a0-verification.md`.

## Global Constraints

- 기존 앱 파일(`src/lib/server/**`, `src/app/**`, `src/components/**`, `deploy/**`)은 **수정하지 않는다**. import만 한다(spec §4.6).
- PNU·법정동 코드는 **문자열**이다. `Number`로 바꾸지 않는다(spec §3.3). PNU는 19자리 = 법정동 10 + 산 구분 1(`1` 일반, `2` 산) + 본번 4 + 부번 4.
- 모르는 값은 `NULL`이다. 원천의 `0`·빈 문자열·`"None"`이 "미상"을 뜻하는 필드(세대수·주차·호수·면적)는 `null`로 넣는다(spec §3.3, A0 측정: 대장 0 = 미상).
- 위치를 확정하지 못한 레코드는 **임의 좌표에 찍지 않는다**. `unlocated`로 세고 feature를 만들지 않는다(spec §3.3, tile-catalog A07 미확인 처리).
- 거리·면적은 EPSG:5179. 저장·반환 도형 규칙은 P0 `features.ts` 그대로(입력 WGS84, 저장 5179).
- 데이터 파일은 `journal_mode = DELETE`로 만든다. WAL 모드 파일은 게시가 거부된다(P0 `WAL_MODE`).
- 빌드와 게시는 **한 번의 `withDataDirLock` 안에서** `publishManifestLocked`로 끝낸다(P0 followups #5).
- VWorld 자격 증명은 `.env.local`의 `VWORLD_ID`·`VWORLD_PW`에서만 읽는다. **값을 출력·로그·파일·커밋 메시지에 절대 남기지 않는다.** 로그인 결과 `expirePw`(비밀번호 사용기간 초과)는 성공으로 처리하고 경고 한 줄만 남긴다(사용자 결정 2026-09-29).
- VWorld 요청 사이 간격 기본 2000 ms(약관 "과도한 부하" 금지). 한 번에 한 요청만 보낸다.
- 테스트는 네트워크에 나가지 않는다(로컬 `http.createServer`만). 실제 원천 파일은 테스트에서 읽지 않는다(Task 11의 실제 적재 단계만 읽는다).
- 원천 파일·중간 산출물은 `.cache/v2/raw/`(gitignore)에 둔다. 커밋하지 않는다.
- 새 npm 의존성을 추가하지 않는다. `npm install`을 실행하지 않는다.
- 테스트는 `src/scripts/v2/test-*.mjs`, `node:assert/strict`, `npx tsx <파일>`. 각 태스크는 `package.json`의 `test:v2` 체인 끝에 자기 테스트를 추가한다.
- 커밋: `git -c user.name=boilorange -c user.email=impgy613@gmail.com commit -F <메시지파일>`, 한국어 `feat:`/`fix:`/`test:`/`docs:` 접두사, 마지막 두 줄:
  ```
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01AusXwp6sJGXBRZEjcohHWc
  ```
- 푸시·배포하지 않는다.

## Review Focus

1. **다운로드 도중 VWorld 세션이 끊기면** 서버는 파일 대신 HTML 로그인 페이지를 준다. 그 HTML을 `.zip`으로 저장하면 안 되고, 그 파일만 `NOT_A_FILE`로 실패시키고 `.part`를 남기지 않아야 한다(Task 3 테스트).
2. **대장의 `0` 값**(세대수·주차·호수)은 "없음"이 아니라 "미상"이다. `null`로 들어가야 A05 세대당 주차가 0으로 왜곡되지 않는다(Task 8 테스트).
3. **블록 지번(대지_구분_코드 2)·잘못된 번지·필지 대표점 없음**은 엉뚱한 위치가 아니라 `unlocated`여야 한다(Task 8·10 테스트).
4. **빌더가 중간에 예외를 던지면** 현재 manifest는 그대로, 잠금은 풀려 있어야 한다. 같은 버전 이름으로 다시 빌드하면 덮어쓰지 않고 거부한다(Task 5 테스트).
5. **리(里)·산 번지·두 단어 시군구 주소**("경기도 성남시 분당구 정자동 178", "강원특별자치도 강릉시 주문진읍 주문리 762-5", "… 송정동 산 77-3")가 올바른 PNU로 풀려야 하고, 뒤에 건물명이 붙은 주소는 추측하지 않고 `null`이어야 한다(Task 7 테스트).

---

## 원천 파일 형식 (2026-09-30 실측)

| 원천 | 경로(예) | 형식 | 필드 |
|---|---|---|---|
| 법정구역 SIG | `legal_dong/<기준일>/sig/AL_D001_00_<기준일>(SIG).shp` | SHP, EPSG:5186(.prj `Korea_2000_Korea_Central_Belt_2010`), EUC-KR | `A1` 시군구코드 5자리, `A2` "시도 시군구" 전체 이름(예 `전남광주통합특별시 목포시`), `A4` 시군구코드 |
| 법정구역 EMD | `…(EMD).shp` (5,373개) | 같음 | `A1` 읍면동 코드 8자리, `A2` 읍면동 이름, `A4` 시군구코드 |
| 법정구역 LIO | `…(LIO).shp` (15,176개) | 같음 | `A1` 리 코드 10자리(앞 8자리 = 읍면동), `A2` 리 이름, `A4` 시군구코드 |
| 연속지적도 | `cadastral/<기준일>/<시도>/AL_D002_<시도코드>_<기준일>.shp` | SHP, EPSG:5186, `.cpg` EUC-KR | `A1` PNU 19자리, `A2` 법정동코드 10자리, `A3` 주소, `A4` 지번, `A5` 지번+지목(예 `203-24전`, `930 공`), `A7` 시군구코드 |
| 총괄표제부 | `ledger_recap/recap_202608.csv` | CSV UTF-8 | `관리_건축물대장_PK, 대지_위치, 건물_명, 시군구_코드, 법정동_코드, 대지_구분_코드(0 대지·1 산·2 블록), 번, 지, 주_용도_코드_명, 기타_용도, 세대_수(세대), 가구_수(가구), 주_건축물_수, 총_주차_수, 사용승인_일(YYYYMMDD), 호_수(호)` |
| 표제부 | `ledger_title/title_202608.csv` (전국, 없으면 `title_5sido.csv`) | CSV UTF-8 | 위와 같은 주소 필드 + `대장_종류_코드_명, 동_명, 주_용도_코드_명, 기타_용도, 세대_수(세대), 호_수(호), 높이(m), 지상_층_수, 사용승인_일` |
| 상가 | `store/store_national_202606.csv` | CSV UTF-8 | `상가업소번호, 상호명, 지점명, 상권업종대분류명, 상권업종중분류명, 상권업종소분류명, 상권업종소분류코드, 시도코드, 법정동코드, 도로명주소, 층정보, 경도, 위도` |
| 버스정류장 | `bus_stop/bus_stop_20251209.csv` | CSV EUC-KR | `정류장번호, 정류장명, 위도, 경도, 정보수집일, 모바일단축번호, 도시코드, 도시명` |
| 공원 | `park/park-std.csv` | CSV UTF-8 | `관리번호, 공원명, 공원구분, 소재지도로명주소, 소재지지번주소, 위도, 경도, 공원면적, 지정고시일` |
| 입주예정 | `move_in/move_in_20260630.csv` | CSV UTF-8(BOM) | `입주예정월(YYYY-MM), 지역, 사업유형, 주소(지번), 아파트명, 세대수` |
| 청약홈 분양 | 기존 앱 DB `.cache/site-analysis.db`의 `planned_housing`(읽기 전용, 3,134행 중 2,581행 좌표 있음) | SQLite | `id, name, address, area_name, kind, units, sale_date, move_in_month(YYYYMM), homepage_url, notice_url, lat, lng` |

VWorld 다운로드(2026-09-30 확인): 로그인 `POST /v4po_usrlogin_a004.do` 폼 `usrIdeE`·`usrPwdE`(UTF-8 base64)·`nextUrl`, 헤더 `referer`·`origin`·`x-requested-with` 없으면 `잘못된 접근입니다`. 목록 `GET /dtmk/dtmk_ntads_s002.do?svcCde=NA&dsId=<id>&datPageIndex=<n>&datPageSize=100&startDate=2000-01-01&endDate=2099-12-31`. 파일 `GET /dtmk/downloadResourceFile.do?ds_id=<dsFileId>&fileNo=<fileSq>`(content-type `application/download`). dsId: 21 법정구역정보(`20171128DS00001`), 23 연속지적도형정보(`20171128DS00002`), 18 GIS건물통합정보(`20171128DS00010`).

## File Structure

| 파일 | 책임 |
|---|---|
| `src/lib/v2/data/manifest.ts` (수정) | GC 핀을 잠금 안에서 계산, 보존 경로 검증, 깨진 현재본이 prev를 덮지 않음 |
| `src/lib/v2/data/schema.ts` (수정) | 스키마 v2: `parcel_point`, `legal_area`, `ingest_run.snapshot_json`, 버전 불일치 거부 |
| `src/lib/v2/ingest/vworld.ts` | VWorld 로그인·목록·다운로드 |
| `src/lib/v2/ingest/shp.ts` | SHP 읽기(좌표계 판별·재투영·속성 정리) |
| `src/lib/v2/ingest/unzip.ts` | zip(중첩 포함) 해제 |
| `src/lib/v2/ingest/build.ts` | `SourceStats`, `insertRelease`, `batched`, `buildAndPublish` |
| `src/lib/v2/data/parcels.ts` | `makePnu`, `lookupParcelPoint` |
| `src/lib/v2/data/legal-areas.ts` | `legalAreasForCircle` |
| `src/lib/v2/data/jibun.ts` | 지번 주소 → PNU |
| `src/lib/v2/ingest/sources/parcels.ts` | 연속지적도 → `parcel_point` |
| `src/lib/v2/ingest/sources/legal-areas.ts` | 법정구역 → `legal_area` + `legal_sigungu`/`legal_emd` feature |
| `src/lib/v2/ingest/sources/ledger.ts` | 총괄표제부·표제부 → `housing_complex`/`officetel` feature |
| `src/lib/v2/ingest/sources/points.ts` | 상가·버스정류장·공원 → point feature |
| `src/lib/v2/ingest/sources/supply.ts` | 청약홈(기존 DB)·입주예정 → `planned_supply` feature + `development_event` |
| `src/scripts/v2/vworld-fetch.mjs` | VWorld 다운로드 CLI |
| `src/scripts/v2/data-build.mjs` | 원천 찾기·해제·빌드·게시 CLI |
| `docs/superpowers/a0/2026-09-30-p1a-first-load.md` | 첫 전국 적재 결과(Task 11) |

---

### Task 1: P0 이월 — GC 핀을 잠금 안에서, 보존 경로 검증, 깨진 현재본

**Files:**
- Modify: `src/lib/v2/data/manifest.ts` (`collectGarbage`, `collectGarbageLocked`, `publishManifestLocked`)
- Modify: `src/scripts/v2/test-v2-manifest.mjs` (끝에 섹션 11 추가)

**Interfaces:**
- Consumes: P0 `manifest.ts` 전체
- Produces: `type PinSource = ReadonlySet<string> | (() => ReadonlySet<string>)`, `collectGarbage(dataDir: string, pins: PinSource): Promise<GcResult>` (기존 Set 호출도 그대로 동작)

- [ ] **Step 1: Write the failing test**

`src/scripts/v2/test-v2-manifest.mjs`의 마지막 `console.log("✓ v2 manifest");` 바로 위에 추가:

```js
// ─── 11. P0 이월: 핀은 잠금 안에서 계산, 손으로 고친 경로 거부, 깨진 현재본 ──
{
  // (a) 핀 함수는 잠금을 쥔 상태에서 불린다 → 저장과 GC 사이 경합이 없다
  const dir = makeDataDir();
  await M.publishManifest(dir, await buildVersion(dir, "v1"), OK);
  let lockSeen = null;
  await M.collectGarbage(dir, () => {
    lockSeen = existsSync(join(dir, ".lock"));
    return new Set();
  });
  assert.equal(lockSeen, true, "핀 함수는 잠금 안에서 평가된다");
  assert.equal(existsSync(join(dir, ".lock")), false);
}
{
  // (b) 손으로 고친 manifest.json의 비정규 경로 → GC는 아무것도 지우지 않고 거부
  const dir = makeDataDir();
  const v1 = await buildVersion(dir, "v1");
  await M.publishManifest(dir, v1, OK);
  const edited = { ...v1, files: { core: { ...v1.files.core, path: "versions/v1/./core.sqlite" } } };
  writeFileSync(join(dir, M.MANIFEST_FILE), JSON.stringify(edited));
  await assert.rejects(M.collectGarbage(dir, new Set()), (e) => e.code === "PATH_ESCAPE");
  assert.ok(existsSync(join(dir, "versions/v1/core.sqlite")), "살아 있는 파일을 지우지 않는다");
}
{
  // (c) 현재 manifest.json이 깨져 있으면 prev를 덮지 않는다(유일한 롤백 대상 보존)
  const dir = makeDataDir();
  const v1 = await buildVersion(dir, "v1");
  const v2 = await buildVersion(dir, "v2");
  await M.publishManifest(dir, v1, OK);
  await M.publishManifest(dir, v2, OK); // prev = v1
  const prevBefore = readFileSync(join(dir, M.PREVIOUS_MANIFEST_FILE), "utf8");
  writeFileSync(join(dir, M.MANIFEST_FILE), "{ broken");
  const v3 = await buildVersion(dir, "v3");
  const r = await M.publishManifest(dir, v3, OK);
  assert.equal(r.published, true);
  assert.equal(readFileSync(join(dir, M.PREVIOUS_MANIFEST_FILE), "utf8"), prevBefore, "prev는 v1 그대로");
  assert.deepEqual(M.readManifest(dir), v3);
}
```

파일 맨 위 import 줄에 `existsSync`, `readFileSync`, `writeFileSync`가 없으면 `node:fs` import에 추가한다.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx src/scripts/v2/test-v2-manifest.mjs`
Expected: FAIL — (a)에서 `TypeError`(Set이 아닌 함수의 `for…of`) 또는 (b)에서 `PATH_ESCAPE`가 아닌 결과, (c)에서 prev 불일치

- [ ] **Step 3: Write minimal implementation**

`src/lib/v2/data/manifest.ts`:

```ts
export type PinSource = ReadonlySet<string> | (() => ReadonlySet<string>);

export function collectGarbage(dataDir: string, pins: PinSource): Promise<GcResult> {
  // 핀은 잠금을 쥔 뒤에 계산한다 — 저장(saveProject)과 GC가 서로 다른 프로세스여도 경합이 없다.
  return withDataDirLock(dataDir, () => collectGarbageLocked(dataDir, typeof pins === "function" ? pins() : pins));
}
```

`collectGarbageLocked`의 `keep` 함수를 다음으로 바꾼다(보존할 경로를 먼저 검증):

```ts
  const keep = (m: Manifest) => {
    for (const f of Object.values(m.files)) resolveDataPath(dataDir, f.path); // 비정규 경로면 PATH_ESCAPE로 중단
    keepManifests.add(manifestHash(m));
    for (const f of Object.values(m.files)) keepFiles.add(f.path);
  };
```

`publishManifestLocked`에서 현재본을 읽는 부분과 prev 복사 조건을 바꾼다:

```ts
  let currentHash: string | null = null;
  let currentUnreadable = false;
  try {
    const cur = readManifest(dataDir);
    currentHash = cur ? manifestHash(cur) : null;
  } catch {
    currentUnreadable = true; // 깨진 현재본은 롤백 대상이 될 수 없다 — prev를 덮지 않는다
  }
  if (oldCurrent && !currentUnreadable && currentHash !== hash) {
    const prevTmp = `${prevPath}.tmp`;
    writeFileSync(prevTmp, oldCurrent);
    renameSync(prevTmp, prevPath);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx src/scripts/v2/test-v2-manifest.mjs && npm run test:v2 && npx tsc --noEmit`
Expected: `✓ v2 manifest` 포함 전체 통과, tsc 오류 0

- [ ] **Step 5: Commit**

```bash
git add src/lib/v2/data/manifest.ts src/scripts/v2/test-v2-manifest.mjs
# 메시지: "fix: GC 핀을 잠금 안에서 계산하고 보존 경로를 검증한다 (P0 이월)"
```

---

### Task 2: 데이터 파일 스키마 v2

**Files:**
- Modify: `src/lib/v2/data/schema.ts`
- Modify: `src/scripts/v2/test-v2-data-schema.mjs`

**Interfaces:**
- Produces: `DATA_SCHEMA_VERSION = 2`; core 전용 테이블 `parcel_point(pnu TEXT PK, lng REAL, lat REAL, jimok TEXT, release_id)`, `legal_area(code TEXT PK, level 'sigungu'|'emd'|'ri', name, parent_code, release_id)`; 공통 `ingest_run.snapshot_json TEXT`; 다른 버전으로 만든 파일에 `initDataFileSchema`를 부르면 `Error("data file schema version X != 2; rebuild the data file")`

- [ ] **Step 1: Write the failing test**

`src/scripts/v2/test-v2-data-schema.mjs`의 `console.log("✓ v2 data schema");` 위에 추가:

```js
// ─── 6. 스키마 v2: 필지 대표점·법정구역 이름표·적재 스냅샷 ───────────────────
{
  assert.equal(DATA_SCHEMA_VERSION, 2);
  for (const kind of DATA_FILE_KINDS) {
    const db = new Database(":memory:");
    initDataFileSchema(db, kind);
    const t = tables(db);
    assert.equal(t.has("parcel_point"), kind === "core", `${kind}: parcel_point`);
    assert.equal(t.has("legal_area"), kind === "core", `${kind}: legal_area`);
    const cols = db.prepare("PRAGMA table_info(ingest_run)").all().map((c) => c.name);
    assert.ok(cols.includes("snapshot_json"), `${kind}: ingest_run.snapshot_json`);
  }
  const db = new Database(":memory:");
  initDataFileSchema(db, "core");
  seedRelease(db);
  db.prepare("INSERT INTO parcel_point (pnu, lng, lat, jimok, release_id) VALUES ('1168010100100010000', 127.05, 37.48, '대', 'r1')").run();
  assert.equal(db.prepare("SELECT typeof(pnu) t FROM parcel_point").get().t, "text");
  assert.throws(() => db.prepare("INSERT INTO legal_area (code, level, name, parent_code, release_id) VALUES ('11680','dong','x',null,'r1')").run(), /CHECK/);
}

// ─── 7. 버전이 다른 파일은 초기화하지 않고 거부 ─────────────────────────────
{
  const db = new Database(":memory:");
  initDataFileSchema(db, "core");
  db.prepare("UPDATE data_file_meta SET value = '1' WHERE key = 'schema_version'").run();
  assert.throws(() => initDataFileSchema(db, "core"), /schema version 1 != 2/);
}
```

기존 섹션 1의 `assert.deepEqual(readDataFileMeta(db), { kind, schemaVersion: DATA_SCHEMA_VERSION });`는 그대로 둔다.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx src/scripts/v2/test-v2-data-schema.mjs`
Expected: FAIL — `DATA_SCHEMA_VERSION` 1 !== 2

- [ ] **Step 3: Write minimal implementation**

`src/lib/v2/data/schema.ts`:

1. `export const DATA_SCHEMA_VERSION = 2;`
2. `COMMON_SQL`의 `ingest_run` 정의 마지막 두 줄

```sql
    release_id TEXT REFERENCES source_release(release_id)
  );
```

을 다음으로 바꾼다:

```sql
    release_id TEXT REFERENCES source_release(release_id),
    snapshot_json TEXT
  );
```
3. `CORE_SQL` 끝에 추가:

```sql
  CREATE TABLE IF NOT EXISTS parcel_point (
    pnu TEXT PRIMARY KEY,
    lng REAL NOT NULL,
    lat REAL NOT NULL,
    jimok TEXT,
    release_id TEXT NOT NULL REFERENCES source_release(release_id)
  ) WITHOUT ROWID;

  CREATE TABLE IF NOT EXISTS legal_area (
    code TEXT PRIMARY KEY,
    level TEXT NOT NULL CHECK (level IN ('sigungu','emd','ri')),
    name TEXT NOT NULL,
    parent_code TEXT,
    release_id TEXT NOT NULL REFERENCES source_release(release_id)
  );
  CREATE INDEX IF NOT EXISTS idx_legal_area_parent ON legal_area (parent_code, level);
```

4. `initDataFileSchema` 안, 기존 kind 비교 직후에 버전 비교를 넣는다:

```ts
  if (existing !== undefined) {
    const stored = db.prepare("SELECT value FROM data_file_meta WHERE key='schema_version'").pluck().get() as string | undefined;
    if (stored !== undefined && Number(stored) !== DATA_SCHEMA_VERSION) {
      throw new Error(`data file schema version ${stored} != ${DATA_SCHEMA_VERSION}; rebuild the data file`);
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:v2 && npx tsc --noEmit`
Expected: 전체 통과(기존 manifest·skeleton 테스트는 새로 만든 파일만 쓰므로 영향 없음), tsc 오류 0

- [ ] **Step 5: Commit**

```bash
git add src/lib/v2/data/schema.ts src/scripts/v2/test-v2-data-schema.mjs
# 메시지: "feat: 데이터 파일 스키마 v2 — 필지 대표점, 법정구역 이름표, 적재 스냅샷"
```

---

### Task 3: VWorld 클라이언트와 다운로드 CLI

**Files:**
- Create: `src/lib/v2/ingest/vworld.ts`, `src/scripts/v2/vworld-fetch.mjs`
- Test: `src/scripts/v2/test-v2-vworld.mjs`
- Modify: `package.json` (`test:v2` 끝에 ` && tsx src/scripts/v2/test-v2-vworld.mjs`, 새 스크립트 `"vworld:fetch": "tsx src/scripts/v2/vworld-fetch.mjs"`)

**Interfaces:**
- Produces:
  - `VWORLD_BASE = "https://www.vworld.kr"`
  - `interface VworldFile { dsId: string; dsFileId: string; fileSq: string; region: string; title: string; format: string; approxBytes: number | null; kind: string; baseDate: string }`
  - `parseFileList(html: string, dsId: string): VworldFile[]`, `latestFull(files: VworldFile[]): VworldFile[]`
  - `class VworldError extends Error { code: "LOGIN_FAILED" | "NOT_A_FILE" | "HTTP" }`
  - `class VworldSession(opts?: { base?: string; delayMs?: number; sleep?: (ms: number) => Promise<void> })` with `login(id, pw): Promise<"success" | "expirePw">`, `listFiles(dsId): Promise<VworldFile[]>`, `download(file, outPath): Promise<{ bytes: number; skipped: boolean }>`

- [ ] **Step 1: Write the failing test**

`src/scripts/v2/test-v2-vworld.mjs`:

```js
/**
 * VWorld 클라이언트 테스트 — 로컬 가짜 서버만 쓴다(네트워크 없음).
 * 세션이 끊기면 서버는 파일 대신 로그인 HTML을 준다. 그걸 zip으로 저장하면 안 된다.
 */
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { parseFileList, latestFull, VworldSession, VworldError } = await import("../../lib/v2/ingest/vworld.ts");

const row = (sq, region, size, unit, kind, base) => `<li><!--v-for="n in 10"-->
<div class="item row"><input type="hidden" name="dsFileSq" value="${sq}"><input type="hidden" name="dsFileId" value="20171128DS00002">
<div class="format"><span class="shp">SHP</span></div><div class="less"><div class="path bg min"><span class="sigunguNm1">
${region}</span></div><div class="tit min">연속지적도형정보</div></div>
<div class="txt"><span>용량<em>
${size}</em>
${unit}</span><span>구분<em>${kind}</em></span><span>기준일<em class="xxs">${base}</em></span></div></div></li>`;

// ─── 1. 목록 파싱 ──────────────────────────────────────────────────────────
{
  const html = row("4729", "세종특별자치시", "37", "MB", "전체데이터", "2026-09-08") + row("4733", "경상북도", "1,203", "MB", "전체데이터", "2026-09-08") + row("4800", "세종특별자치시", "12", "KB", "변동데이터", "2026-09-28") + row("4600", "세종특별자치시", "36", "MB", "전체데이터", "2026-08-08");
  const files = parseFileList(html, "23");
  assert.equal(files.length, 4);
  assert.deepEqual(files[0], { dsId: "23", dsFileId: "20171128DS00002", fileSq: "4729", region: "세종특별자치시", title: "연속지적도형정보", format: "shp", approxBytes: 37 * 1024 ** 2, kind: "전체데이터", baseDate: "2026-09-08" });
  assert.equal(files[1].approxBytes, 1203 * 1024 ** 2, "천 단위 쉼표");
  assert.equal(files[2].approxBytes, 12 * 1024);
  assert.deepEqual(latestFull(files).map((f) => f.fileSq), ["4729", "4733"], "전체데이터 중 최신 기준일만");
}

// ─── 가짜 VWorld 서버 ──────────────────────────────────────────────────────
const state = { loggedIn: new Set(), expired: false, listPages: 0 };
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const sid = (req.headers.cookie ?? "").match(/SID=(\w+)/)?.[1];
  if (url.pathname === "/v4po_usrlogin_a001.do") {
    res.setHeader("set-cookie", [`SID=s${Date.now()}${Math.random().toString(36).slice(2, 6)}; Path=/`]);
    return res.end("<html>login</html>");
  }
  if (url.pathname === "/v4po_usrlogin_a004.do") {
    let body = "";
    for await (const c of req) body += c;
    const p = new URLSearchParams(body);
    res.setHeader("content-type", "application/json");
    if (!req.headers.referer || !req.headers.origin) return res.end(JSON.stringify({ resultMap: { result: "failed", msg: "잘못된 접근입니다." } }));
    if (p.get("usrIdeE") === b64("user") && p.get("usrPwdE") === b64("pass")) {
      state.loggedIn.add(sid);
      return res.end(JSON.stringify({ resultMap: { result: "expirePw", msg: "비밀번호 사용기간(6개월)이 초과하였습니다.", url: "/v4po_usrinf_i003.do" } }));
    }
    return res.end(JSON.stringify({ resultMap: { result: "error", msg: "아이디 또는 비밀번호가 일치하지 않습니다." } }));
  }
  if (url.pathname === "/dtmk/dtmk_ntads_s002.do") {
    state.listPages++;
    const page = Number(url.searchParams.get("datPageIndex"));
    const n = page === 1 ? 100 : 3;
    return res.end(Array.from({ length: n }, (_, i) => row(String(page * 1000 + i), "세종특별자치시", "1", "MB", "전체데이터", "2026-09-08")).join(""));
  }
  if (url.pathname === "/dtmk/downloadResourceFile.do") {
    if (!state.loggedIn.has(sid) || state.expired) {
      res.setHeader("content-type", "text/html;charset=UTF-8");
      return res.end("<html>로그인 후 이용해주세요</html>");
    }
    const payload = Buffer.from(`PK-fake-zip-${url.searchParams.get("fileNo")}`);
    res.setHeader("content-type", "application/download; UTF-8");
    res.setHeader("content-length", String(payload.length));
    return res.end(payload);
  }
  res.statusCode = 404;
  res.end();
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
let sleeps = 0;
const opts = { base, delayMs: 5, sleep: async () => { sleeps++; } };

try {
  // ─── 2. 로그인 ───────────────────────────────────────────────────────────
  await assert.rejects(new VworldSession(opts).login("user", "wrong"), (e) => e instanceof VworldError && e.code === "LOGIN_FAILED" && !/wrong/.test(e.message));
  const s = new VworldSession(opts);
  assert.equal(await s.login("user", "pass"), "expirePw", "비밀번호 기간 초과도 로그인 성공");

  // ─── 3. 목록: 페이지 넘김과 간격 ──────────────────────────────────────────
  const before = sleeps;
  const all = await s.listFiles("23");
  assert.equal(all.length, 103);
  assert.equal(state.listPages, 2);
  assert.equal(sleeps - before, 1, "두 번째 페이지 전에 한 번 쉰다");

  // ─── 4. 다운로드, 다시 받으면 건너뜀 ──────────────────────────────────────
  const dir = mkdtempSync(join(tmpdir(), "v2-vworld-"));
  const file = { dsId: "23", dsFileId: "20171128DS00002", fileSq: "4729", region: "세종특별자치시", title: "연속지적도형정보", format: "shp", approxBytes: null, kind: "전체데이터", baseDate: "2026-09-08" };
  const out = join(dir, "cadastral", "2026-09-08", "세종특별자치시.zip");
  const r1 = await s.download(file, out);
  assert.deepEqual(r1, { bytes: 16, skipped: false });
  assert.equal(readFileSync(out, "utf8"), "PK-fake-zip-4729");
  assert.equal(JSON.parse(readFileSync(`${out}.done.json`, "utf8")).fileSq, "4729");
  assert.deepEqual(await s.download(file, out), { bytes: 16, skipped: true });

  // ─── 5. 세션 만료 → HTML을 저장하지 않는다 ───────────────────────────────
  state.expired = true;
  const out2 = join(dir, "cadastral", "2026-09-08", "경상북도.zip");
  await assert.rejects(s.download({ ...file, fileSq: "4733", region: "경상북도" }, out2), (e) => e.code === "NOT_A_FILE");
  assert.equal(existsSync(out2), false);
  assert.deepEqual(readdirSync(join(dir, "cadastral", "2026-09-08")).filter((f) => f.endsWith(".part")), [], ".part 없음");
} finally {
  server.close();
}

console.log("✓ v2 vworld");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx src/scripts/v2/test-v2-vworld.mjs`
Expected: FAIL — `Cannot find module '.../src/lib/v2/ingest/vworld.ts'`

- [ ] **Step 3: Write minimal implementation**

`src/lib/v2/ingest/vworld.ts`:

```ts
/**
 * VWorld 공간정보 다운로드 클라이언트.
 * 로그인이 필요한 파일(법정구역·연속지적도·GIS건물)을 사람 대신 받는다.
 * 약관의 "과도한 부하" 금지 때문에 요청 사이에 간격을 두고, 한 번에 한 요청만 보낸다.
 * 자격 증명은 인자로만 받고 어디에도 기록하지 않는다.
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

export const VWORLD_BASE = "https://www.vworld.kr";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
const UNIT_BYTES: Record<string, number> = { KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 };

export interface VworldFile {
  dsId: string;
  dsFileId: string;
  fileSq: string;
  region: string;
  title: string;
  format: string;
  /** 목록 표시 용량(반올림값). 정확한 크기는 다운로드 응답의 content-length */
  approxBytes: number | null;
  /** "전체데이터" | "변동데이터" */
  kind: string;
  baseDate: string;
}

export class VworldError extends Error {
  readonly name = "VworldError";
  constructor(readonly code: "LOGIN_FAILED" | "NOT_A_FILE" | "HTTP", message: string) {
    super(message);
  }
}

export function parseFileList(html: string, dsId: string): VworldFile[] {
  return html
    .split('<li><!--v-for="n in 10"-->')
    .slice(1)
    .map((item) => {
      const pick = (re: RegExp) => (item.match(re)?.[1] ?? "").replace(/\s+/g, " ").trim();
      const size = item.match(/용량<em>\s*([\d.,]+)\s*<\/em>\s*([KMG]B)/);
      return {
        dsId,
        dsFileId: pick(/name="dsFileId" value="([^"]*)"/),
        fileSq: pick(/name="dsFileSq" value="([^"]*)"/),
        region: pick(/sigunguNm1">([^<]*)</),
        title: pick(/class="tit min">([^<]*)</),
        format: pick(/class="format"><span class="([^"]*)"/),
        approxBytes: size ? Math.round(Number(size[1].replace(/,/g, "")) * UNIT_BYTES[size[2]]) : null,
        kind: pick(/구분<em>([^<]*)</),
        baseDate: pick(/기준일<em[^>]*>([^<]*)</),
      };
    })
    .filter((f) => f.fileSq !== "");
}

/** 전체데이터 중 가장 최근 기준일의 파일들(시도별 한 벌) */
export function latestFull(files: VworldFile[]): VworldFile[] {
  const full = files.filter((f) => f.kind === "전체데이터");
  const latest = full.reduce((max, f) => (f.baseDate > max ? f.baseDate : max), "");
  return full.filter((f) => f.baseDate === latest);
}

export interface VworldSessionOptions {
  base?: string;
  /** 요청 사이 간격. 기본 2000 ms */
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export class VworldSession {
  private readonly cookies = new Map<string, string>();

  constructor(private readonly opts: VworldSessionOptions = {}) {}

  private get base(): string {
    return this.opts.base ?? VWORLD_BASE;
  }

  private pause(): Promise<void> {
    const ms = this.opts.delayMs ?? 2000;
    return (this.opts.sleep ?? ((m: number) => new Promise<void>((r) => setTimeout(r, m))))(ms);
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("user-agent", USER_AGENT);
    if (this.cookies.size > 0) headers.set("cookie", [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "));
    const res = await fetch(this.base + path, { ...init, headers, redirect: "manual" });
    for (const raw of res.headers.getSetCookie()) {
      const pair = raw.split(";")[0];
      const eq = pair.indexOf("=");
      if (eq > 0) this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1));
    }
    return res;
  }

  async login(id: string, pw: string): Promise<"success" | "expirePw"> {
    await (await this.request("/v4po_usrlogin_a001.do")).arrayBuffer();
    const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
    const res = await this.request("/v4po_usrlogin_a004.do", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "x-requested-with": "XMLHttpRequest",
        accept: "application/json, text/javascript, */*; q=0.01",
        referer: `${this.base}/v4po_usrlogin_a001.do`,
        origin: this.base,
      },
      body: new URLSearchParams({ usrIdeE: b64(id), usrPwdE: b64(pw), nextUrl: "" }).toString(),
    });
    let result = "";
    let msg = "";
    try {
      const rm = ((await res.json()) as { resultMap?: { result?: unknown; msg?: unknown } }).resultMap ?? {};
      result = String(rm.result ?? "");
      msg = String(rm.msg ?? "").replace(/<br\s*\/?>/g, " ");
    } catch {
      throw new VworldError("LOGIN_FAILED", `login returned non-JSON (HTTP ${res.status})`);
    }
    if (result === "success" || result === "expirePw") return result;
    throw new VworldError("LOGIN_FAILED", `login ${result || "unknown"}: ${msg}`);
  }

  async listFiles(dsId: string): Promise<VworldFile[]> {
    const all: VworldFile[] = [];
    for (let page = 1; page <= 200; page++) {
      if (page > 1) await this.pause();
      const q = new URLSearchParams({ svcCde: "NA", dsId, datPageIndex: String(page), datPageSize: "100", startDate: "2000-01-01", endDate: "2099-12-31" });
      const res = await this.request(`/dtmk/dtmk_ntads_s002.do?${q}`);
      if (!res.ok) throw new VworldError("HTTP", `list ${dsId} page ${page}: HTTP ${res.status}`);
      const items = parseFileList(await res.text(), dsId);
      all.push(...items);
      if (items.length < 100) return all;
    }
    throw new VworldError("HTTP", `list ${dsId}: more than 200 pages`);
  }

  async download(file: VworldFile, outPath: string): Promise<{ bytes: number; skipped: boolean }> {
    const donePath = `${outPath}.done.json`;
    if (existsSync(outPath) && existsSync(donePath)) {
      const done = JSON.parse(readFileSync(donePath, "utf8")) as { fileSq: string; baseDate: string; bytes: number };
      if (done.fileSq === file.fileSq && done.baseDate === file.baseDate) return { bytes: done.bytes, skipped: true };
    }
    await this.pause();
    const q = new URLSearchParams({ ds_id: file.dsFileId, fileNo: file.fileSq });
    const res = await this.request(`/dtmk/downloadResourceFile.do?${q}`);
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !type.includes("download") || !res.body) {
      await res.arrayBuffer().catch(() => undefined);
      throw new VworldError("NOT_A_FILE", `${file.region} ${file.title}: HTTP ${res.status} ${type} — 세션 만료이거나 대용량 전용 다운로더가 필요한 파일`);
    }
    mkdirSync(dirname(outPath), { recursive: true });
    const part = `${outPath}.part`;
    try {
      await pipeline(Readable.fromWeb(res.body as unknown as WebReadableStream<Uint8Array>), createWriteStream(part));
      const bytes = statSync(part).size;
      const expected = Number(res.headers.get("content-length"));
      if (Number.isFinite(expected) && expected > 0 && expected !== bytes) {
        throw new VworldError("HTTP", `truncated download: ${bytes}/${expected} bytes`);
      }
      renameSync(part, outPath);
      writeFileSync(donePath, JSON.stringify({ fileSq: file.fileSq, baseDate: file.baseDate, bytes, region: file.region, title: file.title, downloadedAt: new Date().toISOString() }, null, 2));
      return { bytes, skipped: false };
    } finally {
      rmSync(part, { force: true });
    }
  }
}
```

`src/scripts/v2/vworld-fetch.mjs`:

```js
/**
 * VWorld 파일 받기.
 *   npm run vworld:fetch -- --ds 21,23 [--region 세종특별자치시,서울특별시] [--out .cache/v2/raw]
 * 자격 증명은 .env.local의 VWORLD_ID / VWORLD_PW. 값을 출력하지 않는다.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

const { VworldSession, VworldError, latestFull } = await import("../../lib/v2/ingest/vworld.ts");
const FOLDERS = { 21: "legal_dong", 23: "cadastral", 18: "gis_building" };

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const dsIds = String(opt("ds", "21,23")).split(",").filter(Boolean);
const regions = opt("region") ? new Set(String(opt("region")).split(",")) : null;
const outDir = opt("out", ".cache/v2/raw");
for (const ds of dsIds) {
  if (!FOLDERS[ds]) {
    console.error(`unsupported dsId ${ds} (supported: ${Object.keys(FOLDERS).join(",")})`);
    process.exit(2);
  }
}

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const id = process.env.VWORLD_ID;
const pw = process.env.VWORLD_PW;
if (!id || !pw) {
  console.error("VWORLD_ID / VWORLD_PW가 .env.local에 없습니다.");
  process.exit(2);
}

const session = new VworldSession();
const login = await session.login(id, pw);
if (login === "expirePw") console.warn("⚠ VWorld 비밀번호 사용기간이 지났습니다(로그인은 됨). 다운로드를 계속합니다.");

const failures = [];
for (const ds of dsIds) {
  const files = latestFull(await session.listFiles(ds)).filter((f) => !regions || regions.has(f.region));
  console.log(`ds ${ds}: ${files.length} files (기준일 ${files[0]?.baseDate ?? "-"})`);
  for (const f of files) {
    const out = join(outDir, FOLDERS[ds], f.baseDate, `${f.region}.zip`);
    try {
      const r = await session.download(f, out);
      console.log(`  ${r.skipped ? "skip" : "got "} ${f.region} ${(r.bytes / 1024 ** 2).toFixed(1)} MB`);
    } catch (e) {
      if (!(e instanceof VworldError)) throw e;
      failures.push(`${ds} ${f.region}: ${e.message}`);
      console.error(`  FAIL ${f.region}: ${e.message}`);
    }
  }
}
if (failures.length > 0) {
  console.error(`${failures.length} file(s) failed`);
  process.exit(1);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx src/scripts/v2/test-v2-vworld.mjs && npm run test:v2 && npx tsc --noEmit`
Expected: `✓ v2 vworld`, 전체 통과, tsc 오류 0

- [ ] **Step 5: Commit**

```bash
git add src/lib/v2/ingest/vworld.ts src/scripts/v2/vworld-fetch.mjs src/scripts/v2/test-v2-vworld.mjs package.json
# 메시지: "feat: VWorld 자동 다운로드 — 로그인·목록·이어받기, 세션 만료 시 HTML 저장 거부"
```

---

### Task 4: zip 해제와 SHP 읽기

**Files:**
- Create: `src/lib/v2/ingest/unzip.ts`, `src/lib/v2/ingest/shp.ts`
- Test: `src/scripts/v2/test-v2-shp.mjs`
- Modify: `package.json` (`test:v2`에 추가)

**Interfaces:**
- Consumes: `normalizeEncoding` (`src/lib/v2/a0/measure.ts`), `UTMK`·`LngLat` (`crs.ts`), 레거시 `PROJ4_DEFINITIONS` (`src/lib/server/maintenance/boundary-crs.ts`, import만)
- Produces:
  - `extractAll(dir: string): string[]` — `dir` 아래 모든 `.zip`(중첩 포함)을 `<zip이름 확장자 제외>/` 폴더에 풀고, 푼 zip 목록을 돌려준다. 이미 풀린 zip(`<폴더>/.extracted` 표시)은 건너뛴다.
  - `crsFromPrj(prjText: string): string` (`EPSG:5186` | `EPSG:5179` | `EPSG:5174`, 그 밖은 throw)
  - `cleanProps(p: Record<string, unknown>): Record<string, unknown>`
  - `reprojectToWgs84(g: Geometry, crs: string): Geometry`
  - `interface ShpRecord { properties: Record<string, unknown>; geometry: Geometry | null }`, `interface ShpPointRecord { properties: Record<string, unknown>; point: LngLat | null }`
  - `readShp(shpPath: string, opts?: { crs?: string; encoding?: string }): AsyncGenerator<ShpRecord>`
  - `readShpPoints(shpPath: string, opts?: { crs?: string; encoding?: string }): AsyncGenerator<ShpPointRecord>` — 원본 좌표계에서 bbox 중심을 구해 한 점만 WGS84로 바꾼다(전국 필지 속도)

- [ ] **Step 1: Write the failing test**

`src/scripts/v2/test-v2-shp.mjs`:

```js
/**
 * SHP·zip 도우미 테스트. 실제 원천 SHP는 테스트에서 읽지 않는다(Task 11 실제 적재에서 확인).
 */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import JSZip from "jszip";

const { crsFromPrj, cleanProps, reprojectToWgs84 } = await import("../../lib/v2/ingest/shp.ts");
const { extractAll } = await import("../../lib/v2/ingest/unzip.ts");

// ─── 1. .prj → 좌표계 ──────────────────────────────────────────────────────
assert.equal(crsFromPrj('PROJCS["Korea_2000_Korea_Central_Belt_2010", GEOGCS["GCS_Korea_2000"'), "EPSG:5186");
assert.equal(crsFromPrj('PROJCS["Korea_2000_Korea_Unified_Coordinate_System",'), "EPSG:5179");
assert.equal(crsFromPrj('PROJCS["Korean_1985_Modified_Korea_Central_Belt",'), "EPSG:5174");
assert.throws(() => crsFromPrj('PROJCS["WGS_1984_UTM_Zone_52N"'), /unsupported \.prj/);

// ─── 2. 속성 정리: NUL 제거, 빈 값 null, 날짜 ───────────────────────────────
assert.deepEqual(cleanProps({ A1: "3611033025103020002", A8: "\u0000\u0000\u0000", A9: null, A12: 0, A24: "  ", A3: new Date("2026-09-05T15:00:00.000Z") }), {
  A1: "3611033025103020002", A8: null, A9: null, A12: 0, A24: null, A3: "2026-09-05",
});

// ─── 3. 재투영: EPSG:5186 원점(200000, 600000) = 동경 127°, 북위 38° ──────────
{
  const g = reprojectToWgs84({ type: "Point", coordinates: [200000, 600000] }, "EPSG:5186");
  assert.ok(Math.abs(g.coordinates[0] - 127) < 1e-6 && Math.abs(g.coordinates[1] - 38) < 1e-6, JSON.stringify(g.coordinates));
  const poly = reprojectToWgs84({ type: "Polygon", coordinates: [[[200000, 600000], [200100, 600000], [200100, 600100], [200000, 600000]]] }, "EPSG:5186");
  assert.equal(poly.coordinates[0].length, 4);
  assert.throws(() => reprojectToWgs84({ type: "GeometryCollection", geometries: [] }, "EPSG:5186"), /GeometryCollection/);
}

// ─── 4. 중첩 zip 해제, 두 번째는 건너뜀 ─────────────────────────────────────
{
  const dir = mkdtempSync(join(tmpdir(), "v2-unzip-"));
  const inner = new JSZip();
  inner.file("AL_D001_00_20260909(EMD).dbf", "dbf-bytes");
  const outer = new JSZip();
  outer.file("AL_D001_00_20260909(EMD).zip", await inner.generateAsync({ type: "nodebuffer" }));
  writeFileSync(join(dir, "legal_dong_20260909.zip"), await outer.generateAsync({ type: "nodebuffer" }));

  const first = extractAll(dir);
  assert.equal(first.length, 2, "바깥 zip + 안쪽 zip");
  const extracted = join(dir, "legal_dong_20260909", "AL_D001_00_20260909(EMD)", "AL_D001_00_20260909(EMD).dbf");
  assert.equal(readFileSync(extracted, "utf8"), "dbf-bytes");
  assert.deepEqual(extractAll(dir), [], "이미 푼 zip은 다시 풀지 않는다");
  assert.ok(existsSync(join(dir, "legal_dong_20260909", ".extracted")));
}

console.log("✓ v2 shp");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx src/scripts/v2/test-v2-shp.mjs`
Expected: FAIL — `Cannot find module '.../src/lib/v2/ingest/shp.ts'`

- [ ] **Step 3: Write minimal implementation**

`src/lib/v2/ingest/unzip.ts`:

```ts
/**
 * 원천 zip 해제. VWorld 법정구역 zip은 zip 안에 zip이 들어 있다.
 * Windows는 내장 tar.exe(bsdtar, zip 지원), 그 밖은 unzip을 쓴다. Git Bash의 GNU tar는 zip을 못 푼다.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";

function unzipTool(zip: string, dest: string): [string, string[]] {
  if (process.platform === "win32") return [join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"), ["-xf", zip, "-C", dest]];
  return ["unzip", ["-o", "-q", zip, "-d", dest]];
}

function* zipsUnder(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* zipsUnder(p);
    else if (extname(e.name).toLowerCase() === ".zip") yield p;
  }
}

export function extractAll(dir: string): string[] {
  const done: string[] = [];
  for (let changed = true; changed; ) {
    changed = false;
    for (const zip of [...zipsUnder(dir)]) {
      const dest = join(dirname(zip), basename(zip, extname(zip)));
      if (existsSync(join(dest, ".extracted"))) continue;
      mkdirSync(dest, { recursive: true });
      const [cmd, args] = unzipTool(zip, dest);
      const r = spawnSync(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
      if (r.status !== 0) throw new Error(`unzip failed for ${zip}: ${r.stderr?.toString() ?? r.error?.message}`);
      writeFileSync(join(dest, ".extracted"), new Date().toISOString());
      done.push(zip);
      changed = true; // 안쪽 zip이 새로 생겼을 수 있다
    }
  }
  return done;
}
```

`src/lib/v2/ingest/shp.ts`:

```ts
/**
 * SHP 읽기. VWorld·국토부 SHP는 대부분 EPSG:5186 + EUC-KR, 속성 이름은 A0…An이다.
 * 문자열 속성에는 NUL(\u0000) 채움이 섞여 있어 정리해서 넘긴다.
 */
import { existsSync, readFileSync } from "node:fs";
import type { Geometry, Position } from "geojson";
import proj4 from "proj4";
import { open as openShapefile } from "shapefile";
import { PROJ4_DEFINITIONS } from "../../server/maintenance/boundary-crs";
import { UTMK, type LngLat } from "../crs";
import { normalizeEncoding } from "../a0/measure";

for (const [name, def] of Object.entries(PROJ4_DEFINITIONS)) proj4.defs(name, def);

export interface ShpRecord {
  properties: Record<string, unknown>;
  geometry: Geometry | null;
}

export interface ShpPointRecord {
  properties: Record<string, unknown>;
  point: LngLat | null;
}

const PRJ_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/Korea_2000_Korea_Central_Belt_2010/i, "EPSG:5186"],
  [/Korea_2000_Korea_Unified_Coordinate_System/i, UTMK],
  [/Korean_1985_Modified_Korea_Central_Belt/i, "EPSG:5174"],
];

export function crsFromPrj(prjText: string): string {
  for (const [re, crs] of PRJ_RULES) if (re.test(prjText)) return crs;
  throw new Error(`unsupported .prj: ${prjText.slice(0, 80)}`);
}

export function cleanProps(p: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p ?? {})) {
    if (typeof v === "string") {
      const s = v.replace(/\u0000/g, "").trim();
      out[k] = s === "" ? null : s;
    } else if (v instanceof Date) {
      out[k] = Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
    } else {
      out[k] = v ?? null;
    }
  }
  return out;
}

function mapPositions(coords: unknown, fn: (p: Position) => Position): unknown {
  if (!Array.isArray(coords)) throw new TypeError("invalid coordinates");
  if (typeof coords[0] === "number") return fn(coords as Position);
  return coords.map((c) => mapPositions(c, fn));
}

export function reprojectToWgs84(g: Geometry, crs: string): Geometry {
  if (g.type === "GeometryCollection") throw new TypeError("GeometryCollection is not supported");
  if (crs === "EPSG:4326") return g;
  const t = proj4(crs, "EPSG:4326");
  return { type: g.type, coordinates: mapPositions(g.coordinates, (p) => t.forward([p[0], p[1]])) } as Geometry;
}

function detect(shpPath: string, opts: { crs?: string; encoding?: string }) {
  const prj = shpPath.replace(/\.shp$/i, ".prj");
  const cpg = shpPath.replace(/\.shp$/i, ".cpg");
  const crs = opts.crs ?? (existsSync(prj) ? crsFromPrj(readFileSync(prj, "utf8")) : undefined);
  if (!crs) throw new Error(`no CRS for ${shpPath}: pass opts.crs or provide a .prj`);
  const encoding = normalizeEncoding(opts.encoding ?? (existsSync(cpg) ? readFileSync(cpg, "utf8").trim() : "euc-kr"));
  return { crs, encoding };
}

export async function* readShp(shpPath: string, opts: { crs?: string; encoding?: string } = {}): AsyncGenerator<ShpRecord> {
  const { crs, encoding } = detect(shpPath, opts);
  const source = await openShapefile(shpPath, undefined, { encoding });
  for (let r = await source.read(); !r.done; r = await source.read()) {
    const f = r.value;
    yield { properties: cleanProps((f.properties ?? {}) as Record<string, unknown>), geometry: f.geometry ? reprojectToWgs84(f.geometry, crs) : null };
  }
}

export async function* readShpPoints(shpPath: string, opts: { crs?: string; encoding?: string } = {}): AsyncGenerator<ShpPointRecord> {
  const { crs, encoding } = detect(shpPath, opts);
  const t = proj4(crs, "EPSG:4326");
  const source = await openShapefile(shpPath, undefined, { encoding });
  for (let r = await source.read(); !r.done; r = await source.read()) {
    const f = r.value;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    if (f.geometry && f.geometry.type !== "GeometryCollection") {
      mapPositions(f.geometry.coordinates, (p) => {
        if (p[0] < minX) minX = p[0];
        if (p[1] < minY) minY = p[1];
        if (p[0] > maxX) maxX = p[0];
        if (p[1] > maxY) maxY = p[1];
        return p;
      });
    }
    const point = minX === Infinity ? null : (t.forward([(minX + maxX) / 2, (minY + maxY) / 2]) as unknown as LngLat);
    yield { properties: cleanProps((f.properties ?? {}) as Record<string, unknown>), point };
  }
}
```

(`src/lib/v2/a0/shapefile.d.ts`가 `shapefile` 모듈 타입을 이미 선언한다. 타입이 `Feature`의 `geometry`를 `Geometry | null`로 주지 않아 tsc가 불평하면 `f.geometry as Geometry | null`로 좁힌다.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx src/scripts/v2/test-v2-shp.mjs && npm run test:v2 && npx tsc --noEmit`
Expected: `✓ v2 shp`, 전체 통과, tsc 오류 0

- [ ] **Step 5: Commit**

```bash
git add src/lib/v2/ingest/unzip.ts src/lib/v2/ingest/shp.ts src/scripts/v2/test-v2-shp.mjs package.json
# 메시지: "feat: 원천 zip 해제와 SHP 읽기 — 좌표계 판별, 재투영, NUL 속성 정리"
```

---

### Task 5: 적재 틀 — 통계, 릴리스, 한 잠금 안의 빌드·게시

**Files:**
- Create: `src/lib/v2/ingest/build.ts`
- Test: `src/scripts/v2/test-v2-build.mjs`
- Modify: `package.json` (`test:v2`에 추가)

**Interfaces:**
- Consumes: `withDataDirLock`, `publishManifestLocked`, `readManifest`, `openDataFile`, `resolveDataPath`, `sha256File`, `VERSIONS_DIR`, `Manifest`, `ManifestFile` (manifest.ts); `initDataFileSchema`, `DATA_SCHEMA_VERSION`, `DataFileKind` (schema.ts); `evaluateIngest`, `checkExpectations`, `IngestSnapshot`, `GateFailure`, `GateResult`, `SiteExpectation` (quality-gate.ts); `isFilled` (a0/measure.ts); `queryFeaturesInRadius` (features.ts); `REVIEW_SITES` (a0/review-sites.ts)
- Produces:
  - `interface ReleaseInput { sourceId: string; provider: string; sourceUrl: string; sourceAsOf: string | null; fetchedAt: string; checksum: string; licenseCode: string; rights?: Record<string, unknown>; coverage?: Record<string, unknown> }`
  - `insertRelease(db, r: ReleaseInput): string` — `release_id = "<sourceId>@<sourceAsOf ?? fetchedAt 날짜>"`
  - `class SourceStats(sourceId: string, releaseId: string, fillFields: readonly string[])` — 필드 `received, accepted, rejected, unlocated, byRegion, byType, expectedRegions: string[], startedAt`; 메서드 `read()`, `accept(props, region, type)`, `reject()`, `unlocate()`, `snapshot(): IngestSnapshot`
  - `batched<T>(db, items: AsyncIterable<T> | Iterable<T>, fn: (item: T) => void, size?: number): Promise<void>` — `size`(기본 5000)개마다 BEGIN/COMMIT
  - `type KindBuilder = (db: Db, ctx: { core: Db | null }) => Promise<SourceStats[]>`
  - `interface BuildPlan { dataDir: string; version: string; builders: Partial<Record<DataFileKind, KindBuilder>>; expectations?: SiteExpectation[] }`
  - `interface BuildOutcome { published: boolean; hash: string; failures: GateFailure[]; files: Record<string, ManifestFile>; stats: Record<string, SourceStats[]> }`
  - `buildAndPublish(plan: BuildPlan): Promise<BuildOutcome>`

- [ ] **Step 1: Write the failing test**

`src/scripts/v2/test-v2-build.mjs`:

```js
/**
 * 적재 틀 테스트. 빌드와 게시가 한 잠금 안에서 끝나고,
 * 품질 검사에 걸리면 현재 manifest는 그대로여야 한다.
 */
import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { toUtmk, toLngLat } = await import("../../lib/v2/crs.ts");
const { insertFeature } = await import("../../lib/v2/data/features.ts");
const M = await import("../../lib/v2/data/manifest.ts");
const B = await import("../../lib/v2/ingest/build.ts");
const { REVIEW_SITES } = await import("../../lib/v2/a0/review-sites.ts");

const dasan = REVIEW_SITES.find((s) => s.id === "dasan").center;
const [cx, cy] = toUtmk(dasan);
const at = (dx, dy) => [...toLngLat([cx + dx, cy + dy])];

const release = (db, sourceId) => B.insertRelease(db, { sourceId, provider: "test", sourceUrl: "https://example.invalid", sourceAsOf: "2026-09-01", fetchedAt: "2026-09-30T00:00:00Z", checksum: "x", licenseCode: "TEST" });

/** n개의 building feature를 다산 근처에 넣는 core 빌더 */
const coreBuilder = (n, { received = n } = {}) => async (db) => {
  const rel = release(db, "bld");
  const s = new B.SourceStats("bld", rel, ["height"]);
  await B.batched(db, Array.from({ length: received }, (_, i) => i), (i) => {
    s.read();
    if (i >= n) return s.reject();
    insertFeature(db, { stableId: `b${i}`, kind: "building", sourceKey: `b${i}`, releaseId: rel, geometry: { type: "Point", coordinates: at(i * 10, 0) } });
    s.accept({ height: i % 2 ? 10 : null }, "41", "building");
  });
  return [s];
};
const refBuilder = (assertCore) => async (db, ctx) => {
  if (assertCore) assertCore(ctx.core);
  const rel = release(db, "stops");
  const s = new B.SourceStats("stops", rel, []);
  s.read();
  insertFeature(db, { stableId: "s1", kind: "bus_stop", sourceKey: "s1", releaseId: rel, geometry: { type: "Point", coordinates: at(5, 5) } });
  s.accept({}, "41", "bus_stop");
  return [s];
};

const dataDir = mkdtempSync(join(tmpdir(), "v2-build-"));

// ─── 1. 첫 빌드·게시 ────────────────────────────────────────────────────────
const a = await B.buildAndPublish({ dataDir, version: "a", builders: { core: coreBuilder(10), reference: refBuilder() } });
assert.equal(a.published, true, JSON.stringify(a.failures));
assert.deepEqual(Object.keys(M.readManifest(dataDir).files).sort(), ["core", "reference"]);
assert.equal(a.files.core.path, "versions/a/core.sqlite");
{
  const db = M.openDataFile(dataDir, M.readManifest(dataDir), "core");
  const run = db.prepare("SELECT * FROM ingest_run WHERE source_id='bld'").get();
  assert.equal(run.status, "succeeded");
  assert.equal(run.accepted_count, 10);
  assert.equal(JSON.parse(run.snapshot_json).total, 10);
  assert.equal(JSON.parse(run.snapshot_json).fillRates.height, 0.5);
  assert.equal(db.pragma("journal_mode", { simple: true }), "delete");
  assert.equal(db.prepare("SELECT release_id FROM source_release").pluck().get(), "bld@2026-09-01");
  db.close();
}
assert.equal(existsSync(join(dataDir, ".lock")), false);

// ─── 2. 급감 → 게시 거부, 현재본 유지 ──────────────────────────────────────
const before = M.manifestHash(M.readManifest(dataDir));
const b = await B.buildAndPublish({ dataDir, version: "b", builders: { core: coreBuilder(3) } });
assert.equal(b.published, false);
assert.ok(b.failures.some((f) => f.code === "TOTAL_DROP" && f.detail.startsWith("bld:")), JSON.stringify(b.failures));
assert.equal(M.manifestHash(M.readManifest(dataDir)), before);

// ─── 3. reference만 다시 빌드 → core는 이전 파일 유지, ctx.core는 현재 core ──
const c = await B.buildAndPublish({
  dataDir, version: "c",
  builders: { reference: refBuilder((core) => assert.equal(core.prepare("SELECT count(*) FROM feature").pluck().get(), 10)) },
});
assert.equal(c.published, true, JSON.stringify(c.failures));
assert.equal(M.readManifest(dataDir).files.core.path, "versions/a/core.sqlite");
assert.equal(M.readManifest(dataDir).files.reference.path, "versions/c/reference.sqlite");

// ─── 4. 같은 버전 이름 재사용 거부 ─────────────────────────────────────────
await assert.rejects(B.buildAndPublish({ dataDir, version: "c", builders: { reference: refBuilder() } }), /already exists/);

// ─── 5. 빌더 예외 → 현재본 유지, 잠금 해제 ─────────────────────────────────
const cur = M.manifestHash(M.readManifest(dataDir));
await assert.rejects(B.buildAndPublish({ dataDir, version: "d", builders: { core: async () => { throw new Error("boom"); } } }), /boom/);
assert.equal(M.manifestHash(M.readManifest(dataDir)), cur);
assert.equal(existsSync(join(dataDir, ".lock")), false);

// ─── 6. 읽었는데 하나도 못 받음 → PARSED_ZERO_WITH_ROWS ─────────────────────
const e = await B.buildAndPublish({ dataDir, version: "e", builders: { core: coreBuilder(0, { received: 5 }) } });
assert.equal(e.published, false);
assert.ok(e.failures.some((f) => f.code === "PARSED_ZERO_WITH_ROWS"));

// ─── 7. 고정 지점 기대치 ───────────────────────────────────────────────────
const f = await B.buildAndPublish({ dataDir, version: "f", builders: { core: coreBuilder(10) }, expectations: [{ siteId: "dasan", kind: "building", minCount: 50 }] });
assert.equal(f.published, false);
assert.ok(f.failures.some((x) => x.code === "EXPECTATION_BELOW" && /dasan building: 10 < 50/.test(x.detail)));
const g = await B.buildAndPublish({ dataDir, version: "g", builders: { core: coreBuilder(10) }, expectations: [{ siteId: "dasan", kind: "building", minCount: 10 }] });
assert.equal(g.published, true, JSON.stringify(g.failures));

console.log("✓ v2 build");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx src/scripts/v2/test-v2-build.mjs`
Expected: FAIL — `Cannot find module '.../src/lib/v2/ingest/build.ts'`

- [ ] **Step 3: Write minimal implementation**

`src/lib/v2/ingest/build.ts`:

```ts
/**
 * 적재 틀 (spec §3.4~3.5).
 * 한 번의 데이터 디렉터리 잠금 안에서 새 버전 파일을 만들고, 원천별 적재 이력과 스냅샷을 남기고,
 * 품질 검사를 통과하면 게시한다. 검사에 걸리면 새 파일은 참조되지 않은 채 남고 다음 GC가 치운다.
 */
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";
import { isFilled } from "../a0/measure";
import { REVIEW_SITES } from "../a0/review-sites";
import { queryFeaturesInRadius } from "../data/features";
import {
  openDataFile,
  publishManifestLocked,
  readManifest,
  resolveDataPath,
  sha256File,
  VERSIONS_DIR,
  withDataDirLock,
  type Manifest,
  type ManifestFile,
} from "../data/manifest";
import { checkExpectations, evaluateIngest, type GateFailure, type GateResult, type IngestSnapshot, type SiteExpectation } from "../data/quality-gate";
import { DATA_FILE_KINDS, DATA_SCHEMA_VERSION, initDataFileSchema, type DataFileKind } from "../data/schema";

type Db = BetterSqlite3.Database;

export interface ReleaseInput {
  sourceId: string;
  provider: string;
  sourceUrl: string;
  sourceAsOf: string | null;
  fetchedAt: string;
  checksum: string;
  licenseCode: string;
  rights?: Record<string, unknown>;
  coverage?: Record<string, unknown>;
}

export function insertRelease(db: Db, r: ReleaseInput): string {
  const releaseId = `${r.sourceId}@${r.sourceAsOf ?? r.fetchedAt.slice(0, 10)}`;
  db.prepare(`INSERT INTO source_release (release_id, source_id, provider, source_url, source_as_of, fetched_at, checksum, schema_version, license_code, rights_json, coverage_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(releaseId, r.sourceId, r.provider, r.sourceUrl, r.sourceAsOf, r.fetchedAt, r.checksum, DATA_SCHEMA_VERSION, r.licenseCode, JSON.stringify(r.rights ?? {}), JSON.stringify(r.coverage ?? {}));
  return releaseId;
}

export class SourceStats {
  received = 0;
  accepted = 0;
  rejected = 0;
  /** 읽었지만 위치를 확정하지 못해 feature로 넣지 않은 레코드 */
  unlocated = 0;
  readonly byRegion: Record<string, number> = {};
  readonly byType: Record<string, number> = {};
  /** 첫 적재에도 반드시 있어야 하는 지역 코드 (품질 검사 REGION_MISSING) */
  expectedRegions: string[] = [];
  readonly startedAt = new Date().toISOString();
  private readonly filled = new Map<string, number>();

  constructor(readonly sourceId: string, readonly releaseId: string, readonly fillFields: readonly string[]) {}

  read(): void {
    this.received++;
  }

  accept(props: Record<string, unknown>, region: string, type: string): void {
    this.accepted++;
    this.byRegion[region] = (this.byRegion[region] ?? 0) + 1;
    this.byType[type] = (this.byType[type] ?? 0) + 1;
    for (const f of this.fillFields) if (isFilled(props[f])) this.filled.set(f, (this.filled.get(f) ?? 0) + 1);
  }

  reject(): void {
    this.rejected++;
  }

  unlocate(): void {
    this.unlocated++;
  }

  snapshot(): IngestSnapshot {
    const fillRates: Record<string, number> = {};
    for (const f of this.fillFields) fillRates[f] = this.accepted === 0 ? 0 : (this.filled.get(f) ?? 0) / this.accepted;
    return { total: this.accepted, byRegion: { ...this.byRegion }, byType: { ...this.byType }, fillRates };
  }
}

export async function batched<T>(db: Db, items: AsyncIterable<T> | Iterable<T>, fn: (item: T) => void, size = 5000): Promise<void> {
  let n = 0;
  db.exec("BEGIN");
  try {
    for await (const item of items) {
      fn(item);
      if (++n % size === 0) {
        db.exec("COMMIT");
        db.exec("BEGIN");
      }
    }
    db.exec("COMMIT");
  } catch (e) {
    if (db.inTransaction) db.exec("ROLLBACK");
    throw e;
  }
}

function recordRun(db: Db, s: SourceStats, finishedAt: string): void {
  db.prepare(`INSERT INTO ingest_run (run_id, source_id, partition_key, started_at, finished_at, status, expected_count, received_count, accepted_count, rejected_count, error_code, release_id, snapshot_json)
    VALUES (?, ?, '', ?, ?, 'succeeded', NULL, ?, ?, ?, NULL, ?, ?)`)
    .run(`${s.sourceId}:${s.startedAt}`, s.sourceId, s.startedAt, finishedAt, s.received, s.accepted, s.rejected + s.unlocated, s.releaseId, JSON.stringify(s.snapshot()));
}

export type KindBuilder = (db: Db, ctx: { core: Db | null }) => Promise<SourceStats[]>;

export interface BuildPlan {
  dataDir: string;
  version: string;
  builders: Partial<Record<DataFileKind, KindBuilder>>;
  expectations?: SiteExpectation[];
}

export interface BuildOutcome {
  published: boolean;
  hash: string;
  failures: GateFailure[];
  files: Record<string, ManifestFile>;
  stats: Record<string, SourceStats[]>;
}

function previousSnapshot(db: Db, sourceId: string): IngestSnapshot | null {
  try {
    const json = db
      .prepare("SELECT snapshot_json FROM ingest_run WHERE source_id = ? AND status = 'succeeded' ORDER BY finished_at DESC LIMIT 1")
      .pluck()
      .get(sourceId) as string | null | undefined;
    return json ? (JSON.parse(json) as IngestSnapshot) : null;
  } catch {
    return null; // 스키마 v1 파일에는 snapshot_json이 없다
  }
}

function countNearSite(dataDir: string, m: Manifest, siteId: string, kind: string): number {
  const site = REVIEW_SITES.find((s) => s.id === siteId);
  if (!site) throw new Error(`unknown review site ${siteId}`);
  let total = 0;
  for (const [key, file] of Object.entries(m.files)) {
    if (!(DATA_FILE_KINDS as readonly string[]).includes(file.kind)) continue;
    const db = openDataFile(dataDir, m, key);
    try {
      total += queryFeaturesInRadius(db, site.center, 1000, [kind]).length;
    } finally {
      db.close();
    }
  }
  return total;
}

function gate(plan: BuildPlan, previous: Manifest | null, stats: Record<string, SourceStats[]>, candidate: Manifest): GateResult {
  const failures: GateFailure[] = [];
  for (const [kind, list] of Object.entries(stats)) {
    const prevDb = previous?.files[kind] ? openDataFile(plan.dataDir, previous, kind) : null;
    try {
      for (const s of list) {
        const r = evaluateIngest({
          responseRowsReported: s.received,
          parsedRows: s.accepted,
          pageLimitHit: false,
          totalCountReported: null,
          next: s.snapshot(),
          previous: prevDb ? previousSnapshot(prevDb, s.sourceId) : null,
          expectedRegions: s.expectedRegions,
        });
        for (const f of r.failures) failures.push({ code: f.code, detail: `${s.sourceId}: ${f.detail}` });
      }
    } finally {
      prevDb?.close();
    }
  }
  if (plan.expectations && plan.expectations.length > 0) {
    failures.push(...checkExpectations(plan.expectations, (siteId, kind) => countNearSite(plan.dataDir, candidate, siteId, kind)).failures);
  }
  return { ok: failures.length === 0, failures };
}

const BUILD_ORDER: readonly DataFileKind[] = ["core", "reference", "market", "osm"];

export function buildAndPublish(plan: BuildPlan): Promise<BuildOutcome> {
  return withDataDirLock(plan.dataDir, async () => {
    const current = readManifest(plan.dataDir);
    const files: Record<string, ManifestFile> = {};
    const stats: Record<string, SourceStats[]> = {};
    const handles: Db[] = [];
    let core: Db | null = null;
    try {
      if (!plan.builders.core && current?.files.core) {
        core = openDataFile(plan.dataDir, current, "core");
        handles.push(core);
      }
      for (const kind of BUILD_ORDER) {
        const builder = plan.builders[kind];
        if (!builder) continue;
        const rel = `${VERSIONS_DIR}/${plan.version}/${kind}.sqlite`;
        const abs = resolveDataPath(plan.dataDir, rel);
        if (existsSync(abs)) throw new Error(`${rel} already exists; choose a new version name`);
        mkdirSync(dirname(abs), { recursive: true });
        const db = new Database(abs);
        handles.push(db);
        db.pragma("journal_mode = DELETE");
        db.pragma("foreign_keys = ON");
        initDataFileSchema(db, kind);
        const kindStats = await builder(db, { core });
        const finishedAt = new Date().toISOString();
        for (const s of kindStats) recordRun(db, s, finishedAt);
        stats[kind] = kindStats;
        files[kind] = { path: rel, sha256: "", kind, schemaVersion: DATA_SCHEMA_VERSION };
        if (kind === "core") core = db;
      }
    } finally {
      for (const db of handles) db.close();
    }
    for (const f of Object.values(files)) f.sha256 = await sha256File(resolveDataPath(plan.dataDir, f.path));
    const candidate: Manifest = { version: plan.version, createdAt: new Date().toISOString(), files: { ...(current?.files ?? {}), ...files } };
    const result = await publishManifestLocked(plan.dataDir, candidate, (m) => gate(plan, current, stats, m));
    return { ...result, files, stats };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx src/scripts/v2/test-v2-build.mjs && npm run test:v2 && npx tsc --noEmit`
Expected: `✓ v2 build`, 전체 통과, tsc 오류 0

- [ ] **Step 5: Commit**

```bash
git add src/lib/v2/ingest/build.ts src/scripts/v2/test-v2-build.mjs package.json
# 메시지: "feat: 적재 틀 — 한 잠금 안에서 빌드·적재 이력·품질 검사·게시"
```

---

### Task 6: 필지 대표점 (PNU → 좌표)

**Files:**
- Create: `src/lib/v2/data/parcels.ts`, `src/lib/v2/ingest/sources/parcels.ts`
- Test: `src/scripts/v2/test-v2-parcels.mjs`
- Modify: `package.json` (`test:v2`에 추가)

**Interfaces:**
- Consumes: `SourceStats`, `batched` (build.ts); `ShpPointRecord` (shp.ts); `LngLat` (crs.ts)
- Produces:
  - `makePnu(legalCode: string, mountain: boolean, bun: string | number, ji: string | number): string | null`
  - `lookupParcelPoint(db, pnu: string): LngLat | null`
  - `jimokOf(v: unknown): string | null` — `"203-24전"` → `"전"`, `"930 공"` → `"공"`, `"산12-3임"` → `"임"`
  - `buildParcelPoints(db, records: AsyncIterable<ShpPointRecord>, releaseId: string): Promise<SourceStats>` — sourceId `"parcel"`, 지역 = PNU 앞 2자리, 유형 `"parcel"`, 채움 `["jimok"]`

- [ ] **Step 1: Write the failing test**

`src/scripts/v2/test-v2-parcels.mjs`:

```js
/**
 * 필지 대표점 테스트. 대장·입주예정처럼 좌표가 없는 원천은 PNU로 이 표를 찾아 위치를 얻는다.
 */
import assert from "node:assert/strict";
import Database from "better-sqlite3";

const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { insertRelease } = await import("../../lib/v2/ingest/build.ts");
const { makePnu, lookupParcelPoint } = await import("../../lib/v2/data/parcels.ts");
const { buildParcelPoints, jimokOf } = await import("../../lib/v2/ingest/sources/parcels.ts");

// ─── 1. PNU 만들기 ─────────────────────────────────────────────────────────
assert.equal(makePnu("3611011100", false, "0640", "0000"), "3611011100106400000");
assert.equal(makePnu("3611011100", true, 12, 3), "3611011100200120003");
assert.equal(makePnu("361101110", false, 1, 0), null, "법정동 코드는 10자리");
assert.equal(makePnu("3611011100", false, 0, 0), null, "본번 0은 없다");
assert.equal(makePnu("3611011100", false, "12a", 0), null);
assert.equal(makePnu("3611011100", false, 10000, 0), null);

// ─── 2. 지목 ──────────────────────────────────────────────────────────────
assert.equal(jimokOf("203-24전"), "전");
assert.equal(jimokOf("930 공"), "공");
assert.equal(jimokOf("산12-3임"), "임");
assert.equal(jimokOf("930"), null);
assert.equal(jimokOf(null), null);

// ─── 3. 적재와 조회 ───────────────────────────────────────────────────────
{
  const db = new Database(":memory:");
  initDataFileSchema(db, "core");
  const rel = insertRelease(db, { sourceId: "parcel", provider: "국토교통부", sourceUrl: "https://www.vworld.kr", sourceAsOf: "2026-09-08", fetchedAt: "2026-09-30T00:00:00Z", checksum: "x", licenseCode: "CC-BY" });
  async function* recs() {
    yield { properties: { A1: "3611010100102030024", A5: "203-24전" }, point: [127.28, 36.48] };
    yield { properties: { A1: "3611010100102030024", A5: "203-24전" }, point: [127.28, 36.48] }; // 중복
    yield { properties: { A1: "36110101001", A5: "1대" }, point: [127.2, 36.4] }; // PNU 형식 오류
    yield { properties: { A1: "3611010100109300000", A5: "930 공" }, point: null }; // 도형 없음
    yield { properties: { A1: "1168010100100010000", A5: "1대" }, point: [127.05, 37.49] };
  }
  const s = await buildParcelPoints(db, recs(), rel);
  assert.equal(s.received, 5);
  assert.equal(s.accepted, 2);
  assert.equal(s.rejected, 3);
  assert.deepEqual(s.byRegion, { 36: 1, 11: 1 });
  assert.deepEqual(lookupParcelPoint(db, "3611010100102030024"), [127.28, 36.48]);
  assert.equal(lookupParcelPoint(db, "3611010100109300000"), null);
  assert.equal(db.prepare("SELECT jimok FROM parcel_point WHERE pnu='1168010100100010000'").pluck().get(), "대");
}

console.log("✓ v2 parcels");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx src/scripts/v2/test-v2-parcels.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

`src/lib/v2/data/parcels.ts`:

```ts
/**
 * PNU(필지고유번호) 도우미. PNU = 법정동 10 + 산 구분(1 일반·2 산) + 본번 4 + 부번 4, 항상 문자열.
 */
import type BetterSqlite3 from "better-sqlite3";
import type { LngLat } from "../crs";

type Db = BetterSqlite3.Database;

export function makePnu(legalCode: string, mountain: boolean, bun: string | number, ji: string | number): string | null {
  if (!/^\d{10}$/.test(legalCode)) return null;
  const b = typeof bun === "number" ? bun : /^\d+$/.test(String(bun).trim()) ? Number(bun) : NaN;
  const j = typeof ji === "number" ? ji : /^\d*$/.test(String(ji ?? "").trim()) ? Number(String(ji ?? "").trim() || 0) : NaN;
  if (!Number.isInteger(b) || !Number.isInteger(j) || b <= 0 || b > 9999 || j < 0 || j > 9999) return null;
  return `${legalCode}${mountain ? "2" : "1"}${String(b).padStart(4, "0")}${String(j).padStart(4, "0")}`;
}

const stmtCache = new WeakMap<Db, BetterSqlite3.Statement>();

export function lookupParcelPoint(db: Db, pnu: string): LngLat | null {
  let stmt = stmtCache.get(db);
  if (!stmt) {
    stmt = db.prepare("SELECT lng, lat FROM parcel_point WHERE pnu = ?");
    stmtCache.set(db, stmt);
  }
  const row = stmt.get(pnu) as { lng: number; lat: number } | undefined;
  return row ? [row.lng, row.lat] : null;
}
```

`src/lib/v2/ingest/sources/parcels.ts`:

```ts
/**
 * 연속지적도 → 필지 대표점(bbox 중심). 전국 약 3,900만 필지라 도형은 저장하지 않는다.
 * ponytail: bbox 중심 — ㄷ자 필지는 대표점이 필지 밖일 수 있다. 필지 도형 적재(P2) 때 내부점으로 바꾼다.
 */
import type BetterSqlite3 from "better-sqlite3";
import { batched, SourceStats } from "../build";
import type { ShpPointRecord } from "../shp";

export function jimokOf(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^(?:산\s*)?[\d-]+\s*([^\d\s-]+)$/);
  return m ? m[1] : null;
}

export async function buildParcelPoints(db: BetterSqlite3.Database, records: AsyncIterable<ShpPointRecord>, releaseId: string): Promise<SourceStats> {
  const stats = new SourceStats("parcel", releaseId, ["jimok"]);
  const insert = db.prepare("INSERT OR IGNORE INTO parcel_point (pnu, lng, lat, jimok, release_id) VALUES (?, ?, ?, ?, ?)");
  await batched(db, records, (r) => {
    stats.read();
    const pnu = r.properties.A1;
    if (typeof pnu !== "string" || !/^\d{19}$/.test(pnu) || !r.point) return stats.reject();
    const jimok = jimokOf(r.properties.A5);
    if (insert.run(pnu, r.point[0], r.point[1], jimok, releaseId).changes === 0) return stats.reject(); // 중복 PNU
    stats.accept({ jimok }, pnu.slice(0, 2), "parcel");
  });
  return stats;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx src/scripts/v2/test-v2-parcels.mjs && npm run test:v2 && npx tsc --noEmit`
Expected: `✓ v2 parcels`, 전체 통과, tsc 오류 0

- [ ] **Step 5: Commit**

```bash
git add src/lib/v2/data/parcels.ts src/lib/v2/ingest/sources/parcels.ts src/scripts/v2/test-v2-parcels.mjs package.json
# 메시지: "feat: 필지 대표점 — 연속지적도 PNU → 좌표, PNU 만들기"
```

---

### Task 7: 법정구역 — 경계 적재, 반경 판별, 지번 주소 → PNU

**Files:**
- Create: `src/lib/v2/ingest/sources/legal-areas.ts`, `src/lib/v2/data/legal-areas.ts`, `src/lib/v2/data/jibun.ts`
- Test: `src/scripts/v2/test-v2-legal-areas.mjs`
- Modify: `package.json` (`test:v2`에 추가)

**Interfaces:**
- Consumes: `insertFeature`, `queryFeaturesInRadius` (features.ts); `SourceStats`, `batched` (build.ts); `ShpRecord` (shp.ts); `makePnu` (parcels.ts); `LngLat` (crs.ts)
- Produces:
  - `buildLegalAreas(db, input: { sig: AsyncIterable<ShpRecord>; emd: AsyncIterable<ShpRecord>; ri: AsyncIterable<ShpRecord>; releaseId: string }): Promise<SourceStats[]>` — sourceId `legal_sigungu`·`legal_emd`·`legal_ri`; feature kind `legal_sigungu`(legalCode = 시군구5 + `"00000"`), `legal_emd`(legalCode = 읍면동8 + `"00"`); `legal_area` 행 3단계
  - `interface LegalAreaRef { code: string; name: string }`
  - `legalAreasForCircle(core, center: LngLat, radiusM: number): { sigungu: LegalAreaRef[]; emd: LegalAreaRef[] }` — 시군구 코드 5자리, 읍면동 코드 8자리, 코드순
  - `parseJibunAddress(address: string): { head: string; mountain: boolean; bun: number; ji: number } | null`
  - `resolveJibunAddress(core, address: string): { legalCode: string; pnu: string } | null`

- [ ] **Step 1: Write the failing test**

`src/scripts/v2/test-v2-legal-areas.mjs`:

```js
/**
 * 법정구역 테스트. 반경과 교차하는 모든 시군구·읍면동을 로컬에서 판별해야
 * 실거래 조회에서 시군구 경계 너머가 빠지지 않는다(spec §3.3).
 */
import assert from "node:assert/strict";
import Database from "better-sqlite3";

const { toUtmk, toLngLat } = await import("../../lib/v2/crs.ts");
const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { insertRelease } = await import("../../lib/v2/ingest/build.ts");
const { buildLegalAreas } = await import("../../lib/v2/ingest/sources/legal-areas.ts");
const { legalAreasForCircle } = await import("../../lib/v2/data/legal-areas.ts");
const { parseJibunAddress, resolveJibunAddress } = await import("../../lib/v2/data/jibun.ts");

const C = [127.1265, 37.47]; // 복정역 부근
const [cx, cy] = toUtmk(C);
const box = (x0, y0, w, h) => ({ type: "Polygon", coordinates: [[[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h], [x0, y0]].map(([x, y]) => [...toLngLat([cx + x, cy + y])])] });
async function* from(arr) { for (const x of arr) yield x; }

const db = new Database(":memory:");
initDataFileSchema(db, "core");
const rel = insertRelease(db, { sourceId: "legal", provider: "국토교통부", sourceUrl: "https://www.vworld.kr", sourceAsOf: "2026-09-09", fetchedAt: "2026-09-30T00:00:00Z", checksum: "x", licenseCode: "CC-BY" });

const stats = await buildLegalAreas(db, {
  releaseId: rel,
  sig: from([
    { properties: { A1: "11710", A2: "서울특별시 송파구", A4: "11710" }, geometry: box(-3000, -1000, 3000, 3000) }, // 서쪽
    { properties: { A1: "41135", A2: "경기도 성남시 분당구", A4: "41135" }, geometry: box(0, -1000, 3000, 3000) }, // 동쪽
    { properties: { A1: "51150", A2: "강원특별자치도 강릉시", A4: "51150" }, geometry: box(50000, 50000, 1000, 1000) }, // 멀리
    { properties: { A1: "bad", A2: "x" }, geometry: box(0, 0, 1, 1) },
  ]),
  emd: from([
    { properties: { A1: "11710114", A2: "장지동", A4: "11710" }, geometry: box(-500, -500, 500, 1000) },
    { properties: { A1: "41135107", A2: "정자동", A4: "41135" }, geometry: box(0, -500, 500, 1000) },
    { properties: { A1: "51150118", A2: "견소동", A4: "51150" }, geometry: box(50000, 50000, 100, 100) },
    { properties: { A1: "51150250", A2: "주문진읍", A4: "51150" }, geometry: box(50200, 50000, 100, 100) },
    { properties: { A1: "51150112", A2: "송정동", A4: "51150" }, geometry: box(50400, 50000, 100, 100) },
    { properties: { A1: "41135108", A2: "구미동", A4: "41135" }, geometry: null },
  ]),
  ri: from([{ properties: { A1: "5115025021", A2: "주문리", A4: "51150" }, geometry: box(50200, 50000, 50, 50) }]),
});

// ─── 1. 적재 통계 ──────────────────────────────────────────────────────────
assert.deepEqual(stats.map((s) => [s.sourceId, s.accepted, s.rejected]), [["legal_sigungu", 3, 1], ["legal_emd", 5, 1], ["legal_ri", 1, 0]]);
assert.equal(db.prepare("SELECT legal_code FROM feature WHERE stable_id='emd:41135107'").pluck().get(), "4113510700");
assert.equal(db.prepare("SELECT parent_code FROM legal_area WHERE code='5115025021'").pluck().get(), "51150250");

// ─── 2. 반경 판별: 시군구 경계를 넘는 원 ───────────────────────────────────
{
  const r = legalAreasForCircle(db, C, 800);
  assert.deepEqual(r.sigungu, [{ code: "11710", name: "서울특별시 송파구" }, { code: "41135", name: "경기도 성남시 분당구" }]);
  assert.deepEqual(r.emd.map((e) => e.code), ["11710114", "41135107"]);
}

// ─── 3. 지번 주소 파싱 ─────────────────────────────────────────────────────
assert.deepEqual(parseJibunAddress("강원특별자치도 강릉시 견소동 219-0"), { head: "강원특별자치도 강릉시 견소동", mountain: false, bun: 219, ji: 0 });
assert.deepEqual(parseJibunAddress("강원특별자치도 강릉시 송정동 산 77-3"), { head: "강원특별자치도 강릉시 송정동", mountain: true, bun: 77, ji: 3 });
assert.deepEqual(parseJibunAddress("경기도 성남시 분당구 정자동 178번지"), { head: "경기도 성남시 분당구 정자동", mountain: false, bun: 178, ji: 0 });
assert.equal(parseJibunAddress("강원특별자치도 강릉시 견소동"), null);

// ─── 4. 주소 → PNU ────────────────────────────────────────────────────────
assert.deepEqual(resolveJibunAddress(db, "강원특별자치도 강릉시 견소동 219-0"), { legalCode: "5115011800", pnu: "5115011800102190000" });
assert.deepEqual(resolveJibunAddress(db, "강원 강릉시 주문진읍 주문리 762-5"), { legalCode: "5115025021", pnu: "5115025021107620005" }, "약칭 시도 + 리");
assert.deepEqual(resolveJibunAddress(db, "강원특별자치도 강릉시 송정동 산 77-3"), { legalCode: "5115011200", pnu: "5115011200200770003" }, "산 번지");
assert.deepEqual(resolveJibunAddress(db, "경기도 성남시 분당구 정자동 178"), { legalCode: "4113510700", pnu: "4113510700101780000" }, "두 단어 시군구");
assert.equal(resolveJibunAddress(db, "경기도 성남시분당구 정자동 178")?.legalCode, "4113510700", "시군구 사이 공백 없음");
assert.equal(resolveJibunAddress(db, "강원특별자치도 강릉시 없는동 1"), null, "모르는 동");
assert.equal(resolveJibunAddress(db, "강원특별자치도 강릉시 견소동 219 오션시티"), null, "뒤에 건물명 → 추측하지 않음");
assert.equal(resolveJibunAddress(db, "강원특별자치도 강릉시 주문진읍 없는리 1"), null, "모르는 리");

console.log("✓ v2 legal areas");
```

주의: 마지막 두 번째 줄(`… 219 오션시티`)은 `parseJibunAddress`가 끝이 숫자가 아니라 `null`이 되므로 자연히 `null`이다.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx src/scripts/v2/test-v2-legal-areas.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

`src/lib/v2/ingest/sources/legal-areas.ts`:

```ts
/**
 * VWorld 법정구역정보(dsId 21) → 시군구·읍면동 경계 feature + 이름표(legal_area).
 * 리(里)는 경계가 필요 없고 주소 풀이용 이름만 넣는다.
 */
import type BetterSqlite3 from "better-sqlite3";
import { insertFeature } from "../../data/features";
import { batched, SourceStats } from "../build";
import type { ShpRecord } from "../shp";

type Db = BetterSqlite3.Database;

interface Layer {
  sourceId: string;
  level: "sigungu" | "emd" | "ri";
  codeLength: number;
  featureKind: string | null;
  legalCode: (code: string) => string;
  parent: (code: string, p: Record<string, unknown>) => string | null;
}

const LAYERS: Record<"sig" | "emd" | "ri", Layer> = {
  sig: { sourceId: "legal_sigungu", level: "sigungu", codeLength: 5, featureKind: "legal_sigungu", legalCode: (c) => `${c}00000`, parent: () => null },
  emd: { sourceId: "legal_emd", level: "emd", codeLength: 8, featureKind: "legal_emd", legalCode: (c) => `${c}00`, parent: (_c, p) => (typeof p.A4 === "string" ? p.A4 : null) },
  ri: { sourceId: "legal_ri", level: "ri", codeLength: 10, featureKind: null, legalCode: (c) => c, parent: (c) => c.slice(0, 8) },
};

async function loadLayer(db: Db, layer: Layer, records: AsyncIterable<ShpRecord>, releaseId: string): Promise<SourceStats> {
  const stats = new SourceStats(layer.sourceId, releaseId, []);
  const insertArea = db.prepare("INSERT OR IGNORE INTO legal_area (code, level, name, parent_code, release_id) VALUES (?, ?, ?, ?, ?)");
  await batched(db, records, (r) => {
    stats.read();
    const code = r.properties.A1;
    const name = r.properties.A2;
    if (typeof code !== "string" || !new RegExp(`^\\d{${layer.codeLength}}$`).test(code) || typeof name !== "string") return stats.reject();
    if (layer.featureKind && !r.geometry) return stats.reject();
    if (insertArea.run(code, layer.level, name, layer.parent(code, r.properties), releaseId).changes === 0) return stats.reject();
    if (layer.featureKind && r.geometry) {
      insertFeature(db, {
        stableId: `${layer.level === "sigungu" ? "sig" : layer.level}:${code}`,
        kind: layer.featureKind,
        sourceKey: code,
        releaseId,
        geometry: r.geometry,
        name,
        legalCode: layer.legalCode(code),
      });
    }
    stats.accept({}, code.slice(0, 2), layer.level);
  }, 500);
  return stats;
}

export async function buildLegalAreas(
  db: Db,
  input: { sig: AsyncIterable<ShpRecord>; emd: AsyncIterable<ShpRecord>; ri: AsyncIterable<ShpRecord>; releaseId: string },
): Promise<SourceStats[]> {
  return [
    await loadLayer(db, LAYERS.sig, input.sig, input.releaseId),
    await loadLayer(db, LAYERS.emd, input.emd, input.releaseId),
    await loadLayer(db, LAYERS.ri, input.ri, input.releaseId),
  ];
}
```

`src/lib/v2/data/legal-areas.ts`:

```ts
/**
 * 반경과 교차하는 시군구·읍면동 (spec §3.3). 기존 앱의 역지오코딩 21회를 대체한다.
 */
import type BetterSqlite3 from "better-sqlite3";
import type { LngLat } from "../crs";
import { queryFeaturesInRadius } from "./features";

export interface LegalAreaRef {
  code: string;
  name: string;
}

export function legalAreasForCircle(core: BetterSqlite3.Database, center: LngLat, radiusM: number): { sigungu: LegalAreaRef[]; emd: LegalAreaRef[] } {
  const sigungu = new Map<string, string>();
  const emd = new Map<string, string>();
  for (const hit of queryFeaturesInRadius(core, center, radiusM, ["legal_sigungu", "legal_emd"])) {
    if (!hit.legalCode) continue;
    if (hit.kind === "legal_sigungu") sigungu.set(hit.legalCode.slice(0, 5), hit.name ?? "");
    else emd.set(hit.legalCode.slice(0, 8), hit.name ?? "");
  }
  const sorted = (m: Map<string, string>) => [...m].sort(([a], [b]) => (a < b ? -1 : 1)).map(([code, name]) => ({ code, name }));
  return { sigungu: sorted(sigungu), emd: sorted(emd) };
}
```

`src/lib/v2/data/jibun.ts`:

```ts
/**
 * 지번 주소 → 법정동 코드·PNU. 좌표가 없는 원천(입주예정 등)을 필지 대표점에 붙일 때 쓴다.
 * 확신이 없으면 null을 돌려준다 — 비슷한 동에 찍는 것보다 "위치 미확인"이 낫다.
 */
import type BetterSqlite3 from "better-sqlite3";
import { makePnu } from "./parcels";

type Db = BetterSqlite3.Database;

const SIDO_ALIASES: Record<string, string> = {
  서울: "서울특별시", 부산: "부산광역시", 대구: "대구광역시", 인천: "인천광역시", 대전: "대전광역시", 울산: "울산광역시",
  세종: "세종특별자치시", 경기: "경기도", 강원: "강원특별자치도", 강원도: "강원특별자치도", 충북: "충청북도", 충남: "충청남도",
  전북: "전북특별자치도", 전라북도: "전북특별자치도", 경북: "경상북도", 경남: "경상남도", 제주: "제주특별자치도", 제주도: "제주특별자치도",
  광주: "전남광주통합특별시", 광주광역시: "전남광주통합특별시", 전남: "전남광주통합특별시", 전라남도: "전남광주통합특별시",
};

export function parseJibunAddress(address: string): { head: string; mountain: boolean; bun: number; ji: number } | null {
  const m = address.trim().replace(/\s+/g, " ").match(/^(.*?)\s+(산\s*)?(\d+)(?:-(\d+))?(?:\s*번지)?$/);
  if (!m || !m[1]) return null;
  return { head: m[1], mountain: Boolean(m[2]), bun: Number(m[3]), ji: m[4] === undefined ? 0 : Number(m[4]) };
}

interface Area {
  code: string;
  name: string;
}

const sigCache = new WeakMap<Db, Area[]>();

function sigungus(db: Db): Area[] {
  let rows = sigCache.get(db);
  if (!rows) {
    rows = db.prepare("SELECT code, name FROM legal_area WHERE level = 'sigungu'").all() as Area[];
    sigCache.set(db, rows);
  }
  return rows;
}

export function resolveJibunAddress(db: Db, address: string): { legalCode: string; pnu: string } | null {
  const parsed = parseJibunAddress(address);
  if (!parsed) return null;
  const tokens = parsed.head.split(" ");
  if (tokens.length < 3) return null;
  const sido = SIDO_ALIASES[tokens[0]] ?? tokens[0];
  const restJoined = tokens.slice(1).join("");

  // 시군구: "시도 시군구" 이름에서 시도를 떼고 공백을 무시해 가장 긴 접두어를 고른다(예: "성남시 분당구")
  let best: { code: string; restName: string } | null = null;
  for (const s of sigungus(db)) {
    if (!s.name.startsWith(`${sido} `)) continue;
    const restName = s.name.slice(sido.length + 1).replace(/\s+/g, "");
    if (restJoined.startsWith(restName) && (!best || restName.length > best.restName.length)) best = { code: s.code, restName };
  }
  if (!best) return null;

  // 시군구 이름이 차지한 토큰을 건너뛴다
  let consumed = "";
  let i = 1;
  while (i < tokens.length && consumed.length < best.restName.length) consumed += tokens[i++];
  if (consumed !== best.restName) return null;
  const rest = tokens.slice(i);
  if (rest.length < 1 || rest.length > 2) return null;

  const emd = db.prepare("SELECT code FROM legal_area WHERE level = 'emd' AND parent_code = ? AND name = ?").pluck().get(best.code, rest[0]) as string | undefined;
  if (!emd) return null;
  let legalCode = `${emd}00`;
  if (rest.length === 2) {
    const ri = db.prepare("SELECT code FROM legal_area WHERE level = 'ri' AND parent_code = ? AND name = ?").pluck().get(emd, rest[1]) as string | undefined;
    if (!ri) return null;
    legalCode = ri;
  }
  const pnu = makePnu(legalCode, parsed.mountain, parsed.bun, parsed.ji);
  return pnu ? { legalCode, pnu } : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx src/scripts/v2/test-v2-legal-areas.mjs && npm run test:v2 && npx tsc --noEmit`
Expected: `✓ v2 legal areas`, 전체 통과, tsc 오류 0

- [ ] **Step 5: Commit**

```bash
git add src/lib/v2/ingest/sources/legal-areas.ts src/lib/v2/data/legal-areas.ts src/lib/v2/data/jibun.ts src/scripts/v2/test-v2-legal-areas.mjs package.json
# 메시지: "feat: 법정구역 — 경계 적재, 반경 교차 시군구·읍면동, 지번 주소 → PNU"
```

---

### Task 8: 건축물대장 — 공동주택 단지·오피스텔

**Files:**
- Create: `src/lib/v2/ingest/sources/ledger.ts`
- Test: `src/scripts/v2/test-v2-ledger.mjs`
- Modify: `package.json` (`test:v2`에 추가)

**Interfaces:**
- Consumes: `insertFeature` (features.ts); `SourceStats`, `batched` (build.ts); `makePnu`, `lookupParcelPoint` (parcels.ts); `MeasureRecord` (a0/measure.ts)
- Produces:
  - `ledgerPnu(p: Record<string, unknown>): { legalCode: string; pnu: string } | null` — 대지_구분_코드 `0`→일반, `1`→산, 그 밖(블록 `2` 등)→`null`
  - `buildLedger(db, input: { recap: AsyncIterable<MeasureRecord>; title: AsyncIterable<MeasureRecord>; recapReleaseId: string; titleReleaseId: string }): Promise<SourceStats[]>` — sourceId `ledger_recap_housing`, `ledger_title_housing`, `ledger_title_officetel`
  - feature kind `housing_complex` props `{ source: "recap" | "title", ledgerPk: string | null, mainUse: string | null, otherUse: string | null, units: number | null, households: number | null, parking: number | null, approvalDate: string | null, buildingCount: number | null }`
  - feature kind `officetel` props `{ ledgerPk, units, floorsAbove, heightM, approvalDate, otherUse }`

규칙:
- 총괄표제부(recap): `세대_수(세대)` > 0 이거나 `주_용도_코드_명` = `공동주택`인 행 → 단지 1개. stableId `recap:<PK>`.
- 표제부(title) 공동주택: `주_용도_코드_명` = `공동주택`이고 세대수 > 0이며 **그 PNU에 recap 단지가 없는** 행을 PNU별로 합친다(세대수 합, 가장 이른 사용승인일, 첫 건물명, 동 수). stableId `title-housing:<PNU>`. (총괄표제부가 없는 단일 동·다세대)
- 표제부 오피스텔: `주_용도_코드_명` = `업무시설`이고 `기타_용도`에 `오피스텔`이 들어간 행 → 건물 1개. stableId `title:<PK>`.
- 숫자 `0`·빈 값은 `null`(미상). 사용승인일은 `YYYYMMDD` → `YYYY-MM-DD`, 형식이 아니면 `null`.
- PNU를 못 만들거나 대표점이 없으면 `unlocate()`하고 feature를 만들지 않는다.

- [ ] **Step 1: Write the failing test**

`src/scripts/v2/test-v2-ledger.mjs`:

```js
/**
 * 건축물대장 테스트. 대장에는 좌표가 없어 PNU → 필지 대표점으로 위치를 얻는다.
 * 대장의 0은 "없음"이 아니라 "미상"이다(A0 측정).
 */
import assert from "node:assert/strict";
import Database from "better-sqlite3";

const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { insertRelease } = await import("../../lib/v2/ingest/build.ts");
const { ledgerPnu, buildLedger } = await import("../../lib/v2/ingest/sources/ledger.ts");

const db = new Database(":memory:");
initDataFileSchema(db, "core");
const rel = (id) => insertRelease(db, { sourceId: id, provider: "국토교통부 건축HUB", sourceUrl: "https://www.hub.go.kr", sourceAsOf: "2026-08-01", fetchedAt: "2026-09-30T00:00:00Z", checksum: "x", licenseCode: "UNRESTRICTED" });
const recapRel = rel("ledger_recap");
const titleRel = rel("ledger_title");
const pp = db.prepare("INSERT INTO parcel_point (pnu, lng, lat, jimok, release_id) VALUES (?, ?, ?, '대', ?)");
pp.run("3611011100106400000", 127.27, 36.52, recapRel);
pp.run("4136010100160000000", 127.15, 37.62, recapRel);
pp.run("1168010100100100000", 127.05, 37.49, recapRel);
pp.run("1168010100100200000", 127.06, 37.49, recapRel);

const addr = (sgg, bjd, gb, bun, ji) => ({ 시군구_코드: sgg, 법정동_코드: bjd, 대지_구분_코드: gb, 번: bun, 지: ji });
async function* from(rows) { for (const properties of rows) yield { properties, point: null }; }

// ─── 1. PNU ───────────────────────────────────────────────────────────────
assert.deepEqual(ledgerPnu(addr("36110", "11100", "0", "0640", "0000")), { legalCode: "3611011100", pnu: "3611011100106400000" });
assert.equal(ledgerPnu(addr("36110", "11100", "1", "12", "3"))?.pnu, "3611011100200120003");
assert.equal(ledgerPnu(addr("36110", "11100", "2", "0001", "0000")), null, "블록 지번");
assert.equal(ledgerPnu(addr("36110", "", "0", "0640", "0000")), null);

// ─── 2. 적재 ──────────────────────────────────────────────────────────────
const stats = await buildLedger(db, {
  recapReleaseId: recapRel,
  titleReleaseId: titleRel,
  recap: from([
    { 관리_건축물대장_PK: "108215000068706", 건물_명: "가재마을4단지", ...addr("36110", "11100", "0", "0640", "0000"), 주_용도_코드_명: "공동주택", 기타_용도: "아파트", "세대_수(세대)": "1010", "가구_수(가구)": "0", 주_건축물_수: "12", 총_주차_수: "0", 사용승인_일: "20120330" },
    { 관리_건축물대장_PK: "P2", 건물_명: "블록단지", ...addr("41360", "10100", "2", "0001", "0000"), 주_용도_코드_명: "공동주택", "세대_수(세대)": "500", 사용승인_일: "" },
    { 관리_건축물대장_PK: "P3", 건물_명: "창고", ...addr("41360", "10100", "0", "6000", "0000"), 주_용도_코드_명: "창고시설", "세대_수(세대)": "0" },
    { 관리_건축물대장_PK: "P4", 건물_명: "대표점없음", ...addr("41360", "10100", "0", "7000", "0000"), 주_용도_코드_명: "공동주택", "세대_수(세대)": "30", 사용승인_일: "00000000" },
  ]),
  title: from([
    { 관리_건축물대장_PK: "T1", 대장_종류_코드_명: "표제부", 건물_명: "가재마을4단지", 동_명: "401동", ...addr("36110", "11100", "0", "0640", "0000"), 주_용도_코드_명: "공동주택", "세대_수(세대)": "84" }, // recap 있음 → 제외
    { 관리_건축물대장_PK: "T2", 대장_종류_코드_명: "표제부", 건물_명: "해피빌라", 동_명: "A동", ...addr("11680", "10100", "0", "0010", "0000"), 주_용도_코드_명: "공동주택", 기타_용도: "다세대주택", "세대_수(세대)": "8", 사용승인_일: "20051201" },
    { 관리_건축물대장_PK: "T3", 대장_종류_코드_명: "표제부", 건물_명: "해피빌라", 동_명: "B동", ...addr("11680", "10100", "0", "0010", "0000"), 주_용도_코드_명: "공동주택", 기타_용도: "다세대주택", "세대_수(세대)": "6", 사용승인_일: "20031101" },
    { 관리_건축물대장_PK: "T4", 대장_종류_코드_명: "표제부", 건물_명: "역삼오피스텔", ...addr("11680", "10100", "0", "0020", "0000"), 주_용도_코드_명: "업무시설", 기타_용도: "오피스텔,근린생활시설", "호_수(호)": "0", "높이(m)": "45.2", 지상_층_수: "15", 사용승인_일: "20190510" },
    { 관리_건축물대장_PK: "T5", 대장_종류_코드_명: "표제부", 건물_명: "사무동", ...addr("11680", "10100", "0", "0020", "0000"), 주_용도_코드_명: "업무시설", 기타_용도: "사무소" },
  ]),
});

const byId = Object.fromEntries(stats.map((s) => [s.sourceId, s]));
assert.deepEqual([byId.ledger_recap_housing.accepted, byId.ledger_recap_housing.unlocated, byId.ledger_recap_housing.received], [1, 2, 4], "창고는 대상 아님(읽기만), 블록·대표점없음은 위치 미확인");
assert.equal(byId.ledger_title_housing.accepted, 1, "해피빌라 A·B동 → PNU 하나로 합침");
assert.equal(byId.ledger_title_officetel.accepted, 1);

const props = (id) => JSON.parse(db.prepare("SELECT properties_json FROM feature WHERE stable_id = ?").pluck().get(id));
assert.deepEqual(props("recap:108215000068706"), { source: "recap", ledgerPk: "108215000068706", mainUse: "공동주택", otherUse: "아파트", units: 1010, households: null, parking: null, approvalDate: "2012-03-30", buildingCount: 12 }, "0은 미상(null)");
assert.deepEqual(props("title-housing:1168010100100100000"), { source: "title", ledgerPk: null, mainUse: "공동주택", otherUse: "다세대주택", units: 14, households: null, parking: null, approvalDate: "2003-11-01", buildingCount: 2 });
assert.deepEqual(props("title:T4"), { ledgerPk: "T4", units: null, floorsAbove: 15, heightM: 45.2, approvalDate: "2019-05-10", otherUse: "오피스텔,근린생활시설" });
assert.equal(db.prepare("SELECT pnu FROM feature WHERE stable_id = 'recap:108215000068706'").pluck().get(), "3611011100106400000");
assert.equal(db.prepare("SELECT count(*) FROM feature WHERE stable_id LIKE 'recap:P%'").pluck().get(), 0, "위치 미확인은 feature를 만들지 않는다");

console.log("✓ v2 ledger");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx src/scripts/v2/test-v2-ledger.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

`src/lib/v2/ingest/sources/ledger.ts`:

```ts
/**
 * 건축물대장(총괄표제부·표제부) → 공동주택 단지·오피스텔 (tile-catalog A05).
 * 좌표가 없어 PNU → 필지 대표점으로 위치를 얻는다. 못 얻으면 feature를 만들지 않고 unlocated로 센다.
 */
import type BetterSqlite3 from "better-sqlite3";
import type { MeasureRecord } from "../../a0/measure";
import { insertFeature } from "../../data/features";
import { lookupParcelPoint, makePnu } from "../../data/parcels";
import { batched, SourceStats } from "../build";

type Db = BetterSqlite3.Database;
type Props = Record<string, unknown>;

const str = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};
/** 대장의 0·빈 값은 미상이다 */
const positive = (v: unknown): number | null => {
  const n = Number(String(v ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) && n > 0 ? n : null;
};
const ymd = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return /^\d{8}$/.test(s) && s !== "00000000" ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null;
};

export function ledgerPnu(p: Props): { legalCode: string; pnu: string } | null {
  const legalCode = `${str(p["시군구_코드"]) ?? ""}${str(p["법정동_코드"]) ?? ""}`;
  const gb = str(p["대지_구분_코드"]);
  if (gb !== "0" && gb !== "1") return null; // 2 = 블록 지번: PNU가 없다
  const pnu = makePnu(legalCode, gb === "1", str(p["번"]) ?? "", str(p["지"]) ?? "0");
  return pnu ? { legalCode, pnu } : null;
}

function pointGeometry(lngLat: readonly [number, number]) {
  return { type: "Point" as const, coordinates: [lngLat[0], lngLat[1]] };
}

export async function buildLedger(
  db: Db,
  input: { recap: AsyncIterable<MeasureRecord>; title: AsyncIterable<MeasureRecord>; recapReleaseId: string; titleReleaseId: string },
): Promise<SourceStats[]> {
  const recapStats = new SourceStats("ledger_recap_housing", input.recapReleaseId, ["units", "parking", "approvalDate"]);
  const recapPnus = new Set<string>();

  await batched(db, input.recap, (r) => {
    recapStats.read();
    const p = r.properties;
    const units = positive(p["세대_수(세대)"]);
    const mainUse = str(p["주_용도_코드_명"]);
    if (units === null && mainUse !== "공동주택") return; // 대상 아님
    const loc = ledgerPnu(p);
    const point = loc ? lookupParcelPoint(db, loc.pnu) : null;
    if (!loc || !point) return recapStats.unlocate();
    const pk = str(p["관리_건축물대장_PK"]) ?? loc.pnu;
    const props = {
      source: "recap",
      ledgerPk: pk,
      mainUse,
      otherUse: str(p["기타_용도"]),
      units,
      households: positive(p["가구_수(가구)"]),
      parking: positive(p["총_주차_수"]),
      approvalDate: ymd(p["사용승인_일"]),
      buildingCount: positive(p["주_건축물_수"]),
    };
    insertFeature(db, { stableId: `recap:${pk}`, kind: "housing_complex", sourceKey: pk, releaseId: input.recapReleaseId, geometry: pointGeometry(point), name: str(p["건물_명"]), pnu: loc.pnu, legalCode: loc.legalCode, properties: props });
    recapPnus.add(loc.pnu);
    recapStats.accept(props, loc.legalCode.slice(0, 2), mainUse ?? "(미상)");
  });

  const housingStats = new SourceStats("ledger_title_housing", input.titleReleaseId, ["units", "approvalDate"]);
  const officetelStats = new SourceStats("ledger_title_officetel", input.titleReleaseId, ["units", "floorsAbove", "approvalDate"]);
  const housing = new Map<string, { legalCode: string; name: string | null; otherUse: string | null; units: number; approvalDate: string | null; buildingCount: number }>();

  await batched(db, input.title, (r) => {
    const p = r.properties;
    const mainUse = str(p["주_용도_코드_명"]);
    const otherUse = str(p["기타_용도"]);
    if (mainUse === "공동주택") {
      housingStats.read();
      const units = positive(p["세대_수(세대)"]);
      const loc = ledgerPnu(p);
      if (!loc) return housingStats.unlocate();
      if (recapPnus.has(loc.pnu) || units === null) return; // 총괄표제부 단지의 동이거나 세대 미상
      const approval = ymd(p["사용승인_일"]);
      const cur = housing.get(loc.pnu);
      if (cur) {
        cur.units += units;
        cur.buildingCount += 1;
        if (approval && (!cur.approvalDate || approval < cur.approvalDate)) cur.approvalDate = approval;
      } else {
        housing.set(loc.pnu, { legalCode: loc.legalCode, name: str(p["건물_명"]), otherUse, units, approvalDate: approval, buildingCount: 1 });
      }
    } else if (mainUse === "업무시설" && otherUse?.includes("오피스텔")) {
      officetelStats.read();
      const loc = ledgerPnu(p);
      const point = loc ? lookupParcelPoint(db, loc.pnu) : null;
      if (!loc || !point) return officetelStats.unlocate();
      const pk = str(p["관리_건축물대장_PK"]) ?? loc.pnu;
      const props = {
        ledgerPk: pk,
        units: positive(p["호_수(호)"]),
        floorsAbove: positive(p["지상_층_수"]),
        heightM: positive(p["높이(m)"]),
        approvalDate: ymd(p["사용승인_일"]),
        otherUse,
      };
      insertFeature(db, { stableId: `title:${pk}`, kind: "officetel", sourceKey: pk, releaseId: input.titleReleaseId, geometry: pointGeometry(point), name: str(p["건물_명"]), pnu: loc.pnu, legalCode: loc.legalCode, properties: props });
      officetelStats.accept(props, loc.legalCode.slice(0, 2), "officetel");
    }
  });

  await batched(db, housing, ([pnu, h]) => {
    const point = lookupParcelPoint(db, pnu);
    if (!point) return housingStats.unlocate();
    const props = { source: "title", ledgerPk: null, mainUse: "공동주택", otherUse: h.otherUse, units: h.units, households: null, parking: null, approvalDate: h.approvalDate, buildingCount: h.buildingCount };
    insertFeature(db, { stableId: `title-housing:${pnu}`, kind: "housing_complex", sourceKey: pnu, releaseId: input.titleReleaseId, geometry: pointGeometry(point), name: h.name, pnu, legalCode: h.legalCode, properties: props });
    housingStats.accept(props, h.legalCode.slice(0, 2), "공동주택");
  });

  return [recapStats, housingStats, officetelStats];
}
```

(주의: 표제부 공동주택의 `received`는 합치기 전 행 수이고 `accepted`는 합친 PNU 수다. `evaluateIngest`의 PARSED_ZERO 판정은 둘 다 0보다 크면 걸리지 않는다.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx src/scripts/v2/test-v2-ledger.mjs && npm run test:v2 && npx tsc --noEmit`
Expected: `✓ v2 ledger`, 전체 통과, tsc 오류 0

- [ ] **Step 5: Commit**

```bash
git add src/lib/v2/ingest/sources/ledger.ts src/scripts/v2/test-v2-ledger.mjs package.json
# 메시지: "feat: 건축물대장 적재 — 공동주택 단지·오피스텔, PNU로 위치, 0은 미상"
```

---

### Task 9: 좌표가 있는 점 원천 — 상가·버스정류장·공원

**Files:**
- Create: `src/lib/v2/ingest/sources/points.ts`
- Test: `src/scripts/v2/test-v2-points.mjs`
- Modify: `package.json` (`test:v2`에 추가)

**Interfaces:**
- Consumes: `insertFeature` (features.ts); `SourceStats`, `batched` (build.ts); `MeasureRecord` (a0/measure.ts)
- Produces:
  - `interface PointSourceSpec { sourceId: string; kind: string; lngField: string; latField: string; fillFields: string[]; idOf(p): string | null; nameOf(p): string | null; legalCodeOf(p): string | null; regionOf(p): string; typeOf(p): string; propsOf(p): Record<string, unknown> }`
  - `STORE_SPEC`, `BUS_STOP_SPEC`, `PARK_SPEC`
  - `buildPointSource(db, spec: PointSourceSpec, records: AsyncIterable<MeasureRecord>, releaseId: string): Promise<SourceStats>` — 한국 범위(경도 124~132, 위도 33~39) 밖·좌표 없음·ID 없음·중복 ID는 `reject()`

- [ ] **Step 1: Write the failing test**

`src/scripts/v2/test-v2-points.mjs`:

```js
import assert from "node:assert/strict";
import Database from "better-sqlite3";

const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { insertRelease } = await import("../../lib/v2/ingest/build.ts");
const { buildPointSource, STORE_SPEC, BUS_STOP_SPEC, PARK_SPEC } = await import("../../lib/v2/ingest/sources/points.ts");

const db = new Database(":memory:");
initDataFileSchema(db, "reference");
const rel = (id) => insertRelease(db, { sourceId: id, provider: "공공데이터포털", sourceUrl: "https://www.data.go.kr", sourceAsOf: "2026-06-30", fetchedAt: "2026-09-30T00:00:00Z", checksum: "x", licenseCode: "UNRESTRICTED" });
async function* from(rows) { for (const properties of rows) yield { properties, point: null }; }
const props = (id) => JSON.parse(db.prepare("SELECT properties_json FROM feature WHERE stable_id = ?").pluck().get(id));

// ─── 1. 상가 ──────────────────────────────────────────────────────────────
{
  const s = await buildPointSource(db, STORE_SPEC, from([
    { 상가업소번호: "MA01", 상호명: "다산마트", 지점명: "2호점", 상권업종대분류명: "소매", 상권업종중분류명: "종합 소매", 상권업종소분류명: "슈퍼마켓", 상권업종소분류코드: "G20405", 시도코드: "41", 법정동코드: "4136010100", 도로명주소: "경기도 남양주시 다산중앙로 1", 층정보: "1", 경도: "127.1506", 위도: "37.6245" },
    { 상가업소번호: "MA02", 상호명: "좌표없음", 시도코드: "41", 경도: "", 위도: "" },
    { 상가업소번호: "MA03", 상호명: "투영좌표", 시도코드: "41", 경도: "200000", 위도: "500000" },
    { 상가업소번호: "MA01", 상호명: "중복", 시도코드: "41", 경도: "127.15", 위도: "37.62" },
    { 상가업소번호: "", 상호명: "번호없음", 경도: "127.15", 위도: "37.62" },
  ]), rel("store"));
  assert.deepEqual([s.received, s.accepted, s.rejected], [5, 1, 4]);
  assert.deepEqual(s.byRegion, { 41: 1 });
  const row = db.prepare("SELECT name, legal_code, kind FROM feature WHERE stable_id = 'store:MA01'").get();
  assert.deepEqual(row, { name: "다산마트 2호점", legal_code: "4136010100", kind: "store" });
  assert.deepEqual(props("store:MA01"), { majorCategory: "소매", midCategory: "종합 소매", minorCategory: "슈퍼마켓", categoryCode: "G20405", floor: "1", address: "경기도 남양주시 다산중앙로 1" });
}

// ─── 2. 버스정류장 (EUC-KR 원천, 도시별) ───────────────────────────────────
{
  const s = await buildPointSource(db, BUS_STOP_SPEC, from([
    { 정류장번호: "11001", 정류장명: "복정역", 위도: "37.4702", 경도: "127.1265", 정보수집일: "2025-12-01", 모바일단축번호: "24001", 도시코드: "11", 도시명: "서울특별시" },
    { 정류장번호: "", 정류장명: "번호없음", 위도: "37.47", 경도: "127.12", 도시코드: "11", 도시명: "서울특별시" },
  ]), rel("bus_stop"));
  assert.deepEqual([s.accepted, s.rejected], [1, 1]);
  assert.deepEqual(props("bus_stop:11:11001"), { cityCode: "11", cityName: "서울특별시", stopNo: "11001", mobileNo: "24001", collectedAt: "2025-12-01" });
  assert.deepEqual(s.byRegion, { 서울특별시: 1 });
}

// ─── 3. 공원: 면적 빈 값은 null ───────────────────────────────────────────
{
  const s = await buildPointSource(db, PARK_SPEC, from([
    { 관리번호: "P1", 공원명: "다산중앙공원", 공원구분: "근린공원", 소재지도로명주소: "", 소재지지번주소: "경기도 남양주시 다산동 4000", 위도: "37.62", 경도: "127.15", 공원면적: "35000.5", 지정고시일: "2016-03-02" },
    { 관리번호: "P2", 공원명: "쌈지공원", 공원구분: "소공원", 소재지지번주소: "서울특별시 송파구 장지동 1", 위도: "37.47", 경도: "127.12", 공원면적: "", 지정고시일: "" },
  ]), rel("park"));
  assert.equal(s.accepted, 2);
  assert.deepEqual(props("park:P2"), { parkType: "소공원", areaM2: null, designatedAt: null, jibunAddress: "서울특별시 송파구 장지동 1", roadAddress: null });
  assert.deepEqual(s.byRegion, { 경기도: 1, 서울특별시: 1 });
  assert.deepEqual(s.byType, { 근린공원: 1, 소공원: 1 });
}

console.log("✓ v2 points");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx src/scripts/v2/test-v2-points.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

`src/lib/v2/ingest/sources/points.ts`:

```ts
/**
 * 좌표가 있는 CSV 원천 → point feature. 원천마다 필드 이름만 다르다.
 */
import type BetterSqlite3 from "better-sqlite3";
import type { MeasureRecord } from "../../a0/measure";
import { insertFeature } from "../../data/features";
import { batched, SourceStats } from "../build";

type Props = Record<string, unknown>;

const str = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};
const positive = (v: unknown): number | null => {
  const n = Number(String(v ?? "").replace(/,/g, "").trim());
  return str(v) !== null && Number.isFinite(n) && n > 0 ? n : null;
};
const firstToken = (v: unknown): string | null => str(v)?.split(/\s+/)[0] ?? null;

export interface PointSourceSpec {
  sourceId: string;
  kind: string;
  lngField: string;
  latField: string;
  fillFields: string[];
  idOf(p: Props): string | null;
  nameOf(p: Props): string | null;
  legalCodeOf(p: Props): string | null;
  regionOf(p: Props): string;
  typeOf(p: Props): string;
  propsOf(p: Props): Record<string, unknown>;
}

export const STORE_SPEC: PointSourceSpec = {
  sourceId: "store",
  kind: "store",
  lngField: "경도",
  latField: "위도",
  fillFields: ["상권업종소분류코드", "층정보"],
  idOf: (p) => str(p["상가업소번호"]),
  nameOf: (p) => [str(p["상호명"]), str(p["지점명"])].filter(Boolean).join(" ") || null,
  legalCodeOf: (p) => (/^\d{10}$/.test(str(p["법정동코드"]) ?? "") ? str(p["법정동코드"]) : null),
  regionOf: (p) => str(p["시도코드"]) ?? "(미상)",
  typeOf: (p) => str(p["상권업종대분류명"]) ?? "(미상)",
  propsOf: (p) => ({
    majorCategory: str(p["상권업종대분류명"]),
    midCategory: str(p["상권업종중분류명"]),
    minorCategory: str(p["상권업종소분류명"]),
    categoryCode: str(p["상권업종소분류코드"]),
    floor: str(p["층정보"]),
    address: str(p["도로명주소"]),
  }),
};

export const BUS_STOP_SPEC: PointSourceSpec = {
  sourceId: "bus_stop",
  kind: "bus_stop",
  lngField: "경도",
  latField: "위도",
  fillFields: ["정류장명", "모바일단축번호"],
  idOf: (p) => (str(p["정류장번호"]) ? `${str(p["도시코드"]) ?? "0"}:${str(p["정류장번호"])}` : null),
  nameOf: (p) => str(p["정류장명"]),
  legalCodeOf: () => null,
  regionOf: (p) => str(p["도시명"]) ?? "(미상)",
  typeOf: () => "bus_stop",
  propsOf: (p) => ({ cityCode: str(p["도시코드"]), cityName: str(p["도시명"]), stopNo: str(p["정류장번호"]), mobileNo: str(p["모바일단축번호"]), collectedAt: str(p["정보수집일"]) }),
};

export const PARK_SPEC: PointSourceSpec = {
  sourceId: "park",
  kind: "park",
  lngField: "경도",
  latField: "위도",
  fillFields: ["공원면적", "지정고시일"],
  idOf: (p) => str(p["관리번호"]),
  nameOf: (p) => str(p["공원명"]),
  legalCodeOf: () => null,
  regionOf: (p) => firstToken(p["소재지지번주소"]) ?? firstToken(p["소재지도로명주소"]) ?? "(미상)",
  typeOf: (p) => str(p["공원구분"]) ?? "(미상)",
  propsOf: (p) => ({ parkType: str(p["공원구분"]), areaM2: positive(p["공원면적"]), designatedAt: str(p["지정고시일"]), jibunAddress: str(p["소재지지번주소"]), roadAddress: str(p["소재지도로명주소"]) }),
};

export async function buildPointSource(db: BetterSqlite3.Database, spec: PointSourceSpec, records: AsyncIterable<MeasureRecord>, releaseId: string): Promise<SourceStats> {
  const stats = new SourceStats(spec.sourceId, releaseId, spec.fillFields);
  const seen = new Set<string>();
  await batched(db, records, (r) => {
    stats.read();
    const p = r.properties;
    const id = spec.idOf(p);
    const lng = Number(str(p[spec.lngField]));
    const lat = Number(str(p[spec.latField]));
    if (!id || seen.has(id) || str(p[spec.lngField]) === null || !(lng >= 124 && lng <= 132 && lat >= 33 && lat <= 39)) return stats.reject();
    seen.add(id);
    insertFeature(db, {
      stableId: `${spec.kind}:${id}`,
      kind: spec.kind,
      sourceKey: id,
      releaseId,
      geometry: { type: "Point", coordinates: [lng, lat] },
      name: spec.nameOf(p),
      legalCode: spec.legalCodeOf(p),
      properties: spec.propsOf(p),
    });
    stats.accept(p, spec.regionOf(p), spec.typeOf(p));
  });
  return stats;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx src/scripts/v2/test-v2-points.mjs && npm run test:v2 && npx tsc --noEmit`
Expected: `✓ v2 points`, 전체 통과, tsc 오류 0

- [ ] **Step 5: Commit**

```bash
git add src/lib/v2/ingest/sources/points.ts src/scripts/v2/test-v2-points.mjs package.json
# 메시지: "feat: 점 원천 적재 — 상가·버스정류장·공원, 범위 밖·중복 거부"
```

---

### Task 10: 분양·입주예정 공급

**Files:**
- Create: `src/lib/v2/ingest/sources/supply.ts`
- Test: `src/scripts/v2/test-v2-supply.mjs`
- Modify: `package.json` (`test:v2`에 추가)

**Interfaces:**
- Consumes: `insertFeature` (features.ts); `SourceStats`, `batched` (build.ts); `resolveJibunAddress` (jibun.ts); `lookupParcelPoint` (parcels.ts); `sha256Hex` (canonical-json.ts); `MeasureRecord` (a0/measure.ts)
- Produces:
  - `interface LegacyPlannedRow { id: string; name: string; address: string; area_name: string; kind: string; units: number; sale_date: string; move_in_month: string; homepage_url: string; notice_url: string; lat: number | null; lng: number | null }`
  - `readLegacyPlannedHousing(dbPath: string): LegacyPlannedRow[]` (읽기 전용으로 열고 닫는다)
  - `buildSupply(db, input: { legacy: LegacyPlannedRow[]; legacyReleaseId: string; moveIn: AsyncIterable<MeasureRecord>; moveInReleaseId: string; core: Db }): Promise<SourceStats[]>` — sourceId `applyhome`, `move_in`
  - feature kind `planned_supply` + `development_event` 행. 위치가 없는 공급은 feature 없이 `development_event`(geometry_id `NULL`)만 넣고 `unlocate()` — 반경 집계에서는 빠지지만 시군구 수준 사실로 남는다.

규칙:
- 청약홈(기존 앱 `planned_housing`): event_type `sale_notice`, stage `announced`, effective_date = `sale_date`(형식 `YYYY-MM-DD`일 때만), planned_date = `move_in_month`(`YYYYMM` → `YYYY-MM`), 정밀도 `month`/`unknown`, evidence_url = `notice_url` → `homepage_url` → `https://www.applyhome.co.kr`.
- 입주예정: event_type `move_in`, stage `scheduled`, planned_date = `입주예정월`(`YYYY-MM`), evidence_url `https://www.data.go.kr/data/15111714/fileData.do`, 주소 → `resolveJibunAddress(core)` → `lookupParcelPoint(core)`.
- 같은 공급이 두 원천에 모두 있을 수 있다. 중복 정리는 P1b A06 타일이 한다(spec: 한 번만 집계) — 여기서는 원천별로 그대로 넣고 `properties.source`로 구분한다.

- [ ] **Step 1: Write the failing test**

`src/scripts/v2/test-v2-supply.mjs`:

```js
import assert from "node:assert/strict";
import Database from "better-sqlite3";

const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { insertRelease } = await import("../../lib/v2/ingest/build.ts");
const { buildSupply } = await import("../../lib/v2/ingest/sources/supply.ts");

// core: 강릉시 견소동 이름표 + 필지 대표점
const core = new Database(":memory:");
initDataFileSchema(core, "core");
const cRel = insertRelease(core, { sourceId: "legal", provider: "x", sourceUrl: "x", sourceAsOf: "2026-09-09", fetchedAt: "2026-09-30T00:00:00Z", checksum: "x", licenseCode: "CC-BY" });
core.prepare("INSERT INTO legal_area VALUES ('51150','sigungu','강원특별자치도 강릉시',NULL,?)").run(cRel);
core.prepare("INSERT INTO legal_area VALUES ('51150118','emd','견소동','51150',?)").run(cRel);
core.prepare("INSERT INTO parcel_point VALUES ('5115011800102190000', 128.93, 37.77, '대', ?)").run(cRel);

const db = new Database(":memory:");
initDataFileSchema(db, "market");
const rel = (id) => insertRelease(db, { sourceId: id, provider: "한국부동산원", sourceUrl: "https://www.data.go.kr", sourceAsOf: "2026-06-30", fetchedAt: "2026-09-30T00:00:00Z", checksum: "x", licenseCode: "UNRESTRICTED" });
async function* from(rows) { for (const properties of rows) yield { properties, point: null }; }

const stats = await buildSupply(db, {
  core,
  legacyReleaseId: rel("applyhome"),
  moveInReleaseId: rel("move_in"),
  legacy: [
    { id: "2026000123", name: "다산 자이", address: "경기도 남양주시 다산동 6000", area_name: "경기", kind: "apartment", units: 800, sale_date: "2026-03-10", move_in_month: "202809", homepage_url: "https://example.com/h", notice_url: "", lat: 37.62, lng: 127.15 },
    { id: "2026000124", name: "좌표없는 단지", address: "OO택지 A-3블록", area_name: "경기", kind: "apartment", units: 0, sale_date: "", move_in_month: "2028", homepage_url: "", notice_url: "", lat: null, lng: null },
  ],
  moveIn: from([
    { 입주예정월: "2026-12", 지역: "강원", 사업유형: "분양", 주소: "강원특별자치도 강릉시 견소동 219-0", 아파트명: "강릉 모아미래도 오션리버", 세대수: "561" },
    { 입주예정월: "2027-04", 지역: "강원", 사업유형: "분양", 주소: "강원특별자치도 강릉시 포남동 1153-0", 아파트명: "모르는 동", 세대수: "226" },
  ]),
});

const byId = Object.fromEntries(stats.map((s) => [s.sourceId, s]));
assert.deepEqual([byId.applyhome.accepted, byId.applyhome.unlocated], [1, 1]);
assert.deepEqual([byId.move_in.accepted, byId.move_in.unlocated], [1, 1]);

const ev = db.prepare("SELECT * FROM development_event WHERE event_id = 'applyhome:2026000123'").get();
assert.deepEqual(
  { t: ev.event_type, s: ev.stage, e: ev.effective_date, p: ev.planned_date, pr: ev.planned_date_precision, u: ev.units, g: ev.geometry_id, url: ev.evidence_url },
  { t: "sale_notice", s: "announced", e: "2026-03-10", p: "2028-09", pr: "month", u: 800, g: "applyhome:2026000123", url: "https://example.com/h" },
);
const ev2 = db.prepare("SELECT planned_date, planned_date_precision, units, geometry_id FROM development_event WHERE event_id = 'applyhome:2026000124'").get();
assert.deepEqual(ev2, { planned_date: null, planned_date_precision: "unknown", units: null, geometry_id: null }, "위치·일정·세대 미상도 사실로 남긴다");

const mv = db.prepare("SELECT e.*, f.pnu FROM development_event e JOIN feature f ON f.stable_id = e.geometry_id WHERE e.event_type = 'move_in'").get();
assert.equal(mv.planned_date, "2026-12");
assert.equal(mv.units, 561);
assert.equal(mv.pnu, "5115011800102190000");
assert.equal(db.prepare("SELECT count(*) FROM development_event WHERE event_type = 'move_in'").pluck().get(), 2);
assert.equal(db.prepare("SELECT count(*) FROM feature WHERE kind = 'planned_supply'").pluck().get(), 2);

console.log("✓ v2 supply");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx src/scripts/v2/test-v2-supply.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

`src/lib/v2/ingest/sources/supply.ts`:

```ts
/**
 * 분양(청약홈)·입주예정 → 미래 공급 (tile-catalog A06).
 * 청약홈은 기존 앱이 이미 지오코딩해 둔 planned_housing을 읽기 전용으로 재사용한다(spec §4.6: 기존 파일은 import·읽기만).
 */
import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";
import type { MeasureRecord } from "../../a0/measure";
import { sha256Hex } from "../../canonical-json";
import { insertFeature } from "../../data/features";
import { resolveJibunAddress } from "../../data/jibun";
import { lookupParcelPoint } from "../../data/parcels";
import { batched, SourceStats } from "../build";

type Db = BetterSqlite3.Database;

export interface LegacyPlannedRow {
  id: string;
  name: string;
  address: string;
  area_name: string;
  kind: string;
  units: number;
  sale_date: string;
  move_in_month: string;
  homepage_url: string;
  notice_url: string;
  lat: number | null;
  lng: number | null;
}

export function readLegacyPlannedHousing(dbPath: string): LegacyPlannedRow[] {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    return db.prepare("SELECT id, name, address, area_name, kind, units, sale_date, move_in_month, homepage_url, notice_url, lat, lng FROM planned_housing").all() as LegacyPlannedRow[];
  } finally {
    db.close();
  }
}

const str = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};
const positive = (v: unknown): number | null => {
  const n = Number(String(v ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) && n > 0 ? n : null;
};
const inKorea = (lng: unknown, lat: unknown): lng is number =>
  typeof lng === "number" && typeof lat === "number" && lng >= 124 && lng <= 132 && lat >= 33 && lat <= 39;

function insertEvent(db: Db, e: { eventId: string; eventType: string; stage: string; effectiveDate: string | null; plannedMonth: string | null; units: number | null; geometryId: string | null; evidenceUrl: string; releaseId: string }): void {
  db.prepare(`INSERT INTO development_event (event_id, project_id, event_type, stage, effective_date, planned_date, planned_date_precision, units, geometry_id, evidence_url, release_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(e.eventId, e.eventId, e.eventType, e.stage, e.effectiveDate, e.plannedMonth, e.plannedMonth ? "month" : "unknown", e.units, e.geometryId, e.evidenceUrl, e.releaseId);
}

export async function buildSupply(
  db: Db,
  input: { legacy: LegacyPlannedRow[]; legacyReleaseId: string; moveIn: AsyncIterable<MeasureRecord>; moveInReleaseId: string; core: Db },
): Promise<SourceStats[]> {
  const applyhome = new SourceStats("applyhome", input.legacyReleaseId, ["units", "plannedMonth"]);
  await batched(db, input.legacy, (r) => {
    applyhome.read();
    const id = `applyhome:${r.id}`;
    const m = /^(\d{4})(\d{2})$/.exec(String(r.move_in_month ?? "").trim());
    const plannedMonth = m ? `${m[1]}-${m[2]}` : null;
    const units = positive(r.units);
    const located = inKorea(r.lng, r.lat);
    if (located) {
      insertFeature(db, { stableId: id, kind: "planned_supply", sourceKey: r.id, releaseId: input.legacyReleaseId, geometry: { type: "Point", coordinates: [r.lng as number, r.lat as number] }, name: str(r.name), properties: { source: "applyhome", kind: str(r.kind), units, plannedMonth, address: str(r.address) } });
    }
    insertEvent(db, {
      eventId: id, eventType: "sale_notice", stage: "announced",
      effectiveDate: /^\d{4}-\d{2}-\d{2}$/.test(String(r.sale_date ?? "")) ? r.sale_date : null,
      plannedMonth, units, geometryId: located ? id : null,
      evidenceUrl: str(r.notice_url) ?? str(r.homepage_url) ?? "https://www.applyhome.co.kr", releaseId: input.legacyReleaseId,
    });
    if (located) applyhome.accept({ units, plannedMonth }, str(r.area_name) ?? "(미상)", str(r.kind) ?? "(미상)");
    else applyhome.unlocate();
  });

  const moveIn = new SourceStats("move_in", input.moveInReleaseId, ["units", "plannedMonth"]);
  await batched(db, input.moveIn, (rec) => {
    moveIn.read();
    const p = rec.properties;
    const address = str(p["주소"]) ?? "";
    const name = str(p["아파트명"]);
    const id = `movein:${sha256Hex(`${address}|${name ?? ""}`).slice(0, 16)}`;
    const plannedMonth = /^\d{4}-\d{2}$/.test(str(p["입주예정월"]) ?? "") ? str(p["입주예정월"]) : null;
    const units = positive(p["세대수"]);
    const loc = resolveJibunAddress(input.core, address);
    const point = loc ? lookupParcelPoint(input.core, loc.pnu) : null;
    if (loc && point) {
      insertFeature(db, { stableId: id, kind: "planned_supply", sourceKey: id, releaseId: input.moveInReleaseId, geometry: { type: "Point", coordinates: [point[0], point[1]] }, name, pnu: loc.pnu, legalCode: loc.legalCode, properties: { source: "move_in", kind: str(p["사업유형"]), units, plannedMonth, address } });
    }
    insertEvent(db, { eventId: id, eventType: "move_in", stage: "scheduled", effectiveDate: null, plannedMonth, units, geometryId: loc && point ? id : null, evidenceUrl: "https://www.data.go.kr/data/15111714/fileData.do", releaseId: input.moveInReleaseId });
    if (loc && point) moveIn.accept({ units, plannedMonth }, str(p["지역"]) ?? "(미상)", str(p["사업유형"]) ?? "(미상)");
    else moveIn.unlocate();
  });

  return [applyhome, moveIn];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx src/scripts/v2/test-v2-supply.mjs && npm run test:v2 && npx tsc --noEmit`
Expected: `✓ v2 supply`, 전체 통과, tsc 오류 0

- [ ] **Step 5: Commit**

```bash
git add src/lib/v2/ingest/sources/supply.ts src/scripts/v2/test-v2-supply.mjs package.json
# 메시지: "feat: 분양·입주예정 적재 — 청약홈(기존 DB 재사용)·입주예정 주소 → 필지"
```

---

### Task 11: 적재 CLI와 첫 전국 적재

코드 한 파일과 **실제 데이터로 한 번 끝까지 돌리는 작업**이다. 결과 문서가 P1 완료 기준("8곳 검수 주소 보고서")과 고정 지점 기대치 승인의 입력이 된다.

**Files:**
- Create: `src/scripts/v2/data-build.mjs`
- Create: `docs/superpowers/a0/2026-09-30-p1a-first-load.md`
- Modify: `package.json` (`"data:build": "tsx src/scripts/v2/data-build.mjs"`)

**Interfaces:**
- Consumes: 앞 태스크 전부, `legacyDbPath`·`v2DataDir` (paths.ts), `csvRecords` (a0/measure.ts), `REVIEW_SITES`
- Produces: CLI `npm run data:build -- --version <이름> [--raw .cache/v2/raw] [--only core,reference,market] [--expectations <json>]`

- [ ] **Step 1: CLI 작성**

`src/scripts/v2/data-build.mjs`:

```js
/**
 * v2 데이터 파일 빌드·게시.
 *   npm run data:build -- --version 2026-09-30a [--raw .cache/v2/raw] [--only core,reference,market] [--expectations exp.json]
 * 원천 zip은 먼저 풀고(이미 풀린 것은 건너뜀), 원천 파일은 폴더마다 가장 새 파일을 쓴다.
 */
import { readdirSync, statSync, existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

const { extractAll } = await import("../../lib/v2/ingest/unzip.ts");
const { readShp, readShpPoints } = await import("../../lib/v2/ingest/shp.ts");
const { csvRecords } = await import("../../lib/v2/a0/measure.ts");
const { buildAndPublish, insertRelease } = await import("../../lib/v2/ingest/build.ts");
const { buildParcelPoints } = await import("../../lib/v2/ingest/sources/parcels.ts");
const { buildLegalAreas } = await import("../../lib/v2/ingest/sources/legal-areas.ts");
const { buildLedger } = await import("../../lib/v2/ingest/sources/ledger.ts");
const { buildPointSource, STORE_SPEC, BUS_STOP_SPEC, PARK_SPEC } = await import("../../lib/v2/ingest/sources/points.ts");
const { buildSupply, readLegacyPlannedHousing } = await import("../../lib/v2/ingest/sources/supply.ts");
const { legacyDbPath, v2DataDir } = await import("../../lib/v2/paths.ts");

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const version = opt("version");
if (!version || !/^[0-9A-Za-z._-]+$/.test(version)) {
  console.error("usage: data:build -- --version <name> [--raw dir] [--only core,reference,market] [--expectations file.json]");
  process.exit(2);
}
const raw = opt("raw", ".cache/v2/raw");
const only = new Set(String(opt("only", "core,reference,market")).split(","));
const expectations = opt("expectations") ? JSON.parse(readFileSync(opt("expectations"), "utf8")) : undefined;

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}
const newest = (dir, re) => {
  const files = [...walk(join(raw, dir))].filter((f) => re.test(basename(f))).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (files.length === 0) throw new Error(`no file matching ${re} under ${join(raw, dir)} — download it first (A0 표/vworld:fetch)`);
  return files[0];
};
/** 이름에 든 날짜(YYYYMMDD 또는 YYYYMM 또는 YYYY-MM-DD)가 가장 늦은 한 벌 */
const latestSet = (dir, re) => {
  const files = [...walk(join(raw, dir))].filter((f) => re.test(basename(f)));
  const dateOf = (f) => (basename(f).match(/(20\d{6})/) ?? [])[1] ?? "";
  const latest = files.map(dateOf).sort().at(-1);
  return files.filter((f) => dateOf(f) === latest);
};
const asOfOf = (file) => {
  const m = basename(file).match(/(20\d{2})-?(\d{2})-?(\d{2})?/);
  return m ? `${m[1]}-${m[2]}${m[3] ? `-${m[3]}` : ""}` : null;
};
const release = (db, sourceId, file, provider, sourceUrl, licenseCode) => {
  const st = statSync(file);
  // ponytail: 수 GB 원천의 SHA-256 대신 크기·수정시각 — 원천 무결성 검증이 필요해지면 스트리밍 해시로 바꾼다
  return insertRelease(db, { sourceId, provider, sourceUrl, sourceAsOf: asOfOf(file), fetchedAt: st.mtime.toISOString(), checksum: `size-mtime:${st.size}-${Math.round(st.mtimeMs)}`, licenseCode });
};
async function* chain(...gens) {
  for (const g of gens) yield* g;
}

console.log("unzip:", extractAll(join(raw, "legal_dong")).length + extractAll(join(raw, "cadastral")).length, "archive(s)");

const builders = {};
if (only.has("core")) {
  builders.core = async (db) => {
    const sig = newest("legal_dong", /\(SIG\)\.shp$/i);
    const legalRel = release(db, "legal_areas", sig, "국토교통부(VWorld 법정구역정보)", "https://www.vworld.kr/dtmk/dtmk_ntads_s002.do?svcCde=NA&dsId=21", "CC-BY");
    const legal = await buildLegalAreas(db, {
      releaseId: legalRel,
      sig: readShp(sig),
      emd: readShp(newest("legal_dong", /\(EMD\)\.shp$/i)),
      ri: readShp(newest("legal_dong", /\(LIO\)\.shp$/i)),
    });
    const parcelFiles = latestSet("cadastral", /^AL_D002_\d+_\d{8}\.shp$/i);
    console.log(`cadastral: ${parcelFiles.length} 시도 파일`);
    const parcelRel = release(db, "parcel", parcelFiles[0], "국토교통부(VWorld 연속지적도형정보)", "https://www.vworld.kr/dtmk/dtmk_ntads_s002.do?svcCde=NA&dsId=23", "CC-BY");
    const parcel = await buildParcelPoints(db, chain(...parcelFiles.map((f) => readShpPoints(f))), parcelRel);
    parcel.expectedRegions = Object.keys(legal[0].byRegion); // 법정구역 시군구의 시도 코드 = 지적도가 있어야 할 시도
    const recapFile = newest("ledger_recap", /^recap_.*\.csv$/i);
    const titleFiles = [...walk(join(raw, "ledger_title"))].filter((f) => /^title_\d{6}\.csv$/i.test(basename(f)));
    const titleFile = titleFiles[0] ?? newest("ledger_title", /^title_5sido\.csv$/i);
    if (!titleFiles[0]) console.warn("⚠ 전국 표제부(title_YYYYMM.csv)가 없어 5개 시도 표제부로 적재합니다 — 오피스텔·단일동 커버리지 일부");
    const ledger = await buildLedger(db, {
      recapReleaseId: release(db, "ledger_recap", recapFile, "국토교통부 건축HUB", "https://www.hub.go.kr/portal/opn/lps/idx-lgcpt-pvsn-srvc-list.do", "UNRESTRICTED"),
      titleReleaseId: release(db, "ledger_title", titleFile, "국토교통부 건축HUB", "https://www.hub.go.kr/portal/opn/lps/idx-lgcpt-pvsn-srvc-list.do", "UNRESTRICTED"),
      recap: (await csvRecords(recapFile)).records,
      title: (await csvRecords(titleFile)).records,
    });
    return [...legal, parcel, ...ledger];
  };
}
if (only.has("reference")) {
  builders.reference = async (db) => {
    const one = async (spec, dir, re, provider, url) => {
      const file = newest(dir, re);
      return buildPointSource(db, spec, (await csvRecords(file)).records, release(db, spec.sourceId, file, provider, url, "UNRESTRICTED"));
    };
    return [
      await one(STORE_SPEC, "store", /^store_.*\.csv$/i, "소상공인시장진흥공단", "https://www.data.go.kr/data/15083033/fileData.do"),
      await one(BUS_STOP_SPEC, "bus_stop", /^bus_stop_.*\.csv$/i, "국토교통부", "https://www.data.go.kr/data/15067528/fileData.do"),
      await one(PARK_SPEC, "park", /^park.*\.csv$/i, "지방자치단체(전국도시공원정보표준데이터)", "https://www.data.go.kr/data/15012890/standard.do"),
    ];
  };
}
if (only.has("market")) {
  builders.market = async (db, ctx) => {
    if (!ctx.core) throw new Error("market needs core (build core first or publish a core file)");
    const moveInFile = newest("move_in", /^move_in_.*\.csv$/i);
    const legacyPath = legacyDbPath();
    return buildSupply(db, {
      core: ctx.core,
      legacy: readLegacyPlannedHousing(legacyPath),
      legacyReleaseId: release(db, "applyhome", legacyPath, "한국부동산원 청약홈(기존 앱 적재본)", "https://www.data.go.kr/data/15101046/fileData.do", "UNRESTRICTED"),
      moveIn: (await csvRecords(moveInFile)).records,
      moveInReleaseId: release(db, "move_in", moveInFile, "한국부동산원", "https://www.data.go.kr/data/15111714/fileData.do", "UNRESTRICTED"),
    });
  };
}

const started = Date.now();
const out = await buildAndPublish({ dataDir: v2DataDir(), version, builders, expectations });
for (const [kind, list] of Object.entries(out.stats)) {
  for (const s of list) {
    const located = s.accepted + s.unlocated === 0 ? "-" : `${((100 * s.accepted) / (s.accepted + s.unlocated)).toFixed(1)}%`;
    console.log(`${kind.padEnd(9)} ${s.sourceId.padEnd(24)} read ${s.received} · ok ${s.accepted} · unlocated ${s.unlocated} · rejected ${s.rejected} · located ${located}`);
  }
}
console.log(out.published ? `published ${out.hash.slice(0, 12)} (${((Date.now() - started) / 60000).toFixed(1)} min)` : "NOT published:");
for (const f of out.failures) console.log(`  ${f.code} ${f.detail}`);
process.exit(out.published ? 0 : 1);
```

주의: `parcel.expectedRegions` 줄은 법정구역 시군구 적재에서 나온 시도 코드(앞 2자리) 목록을 필지의 필수 지역으로 쓴다 — 한 시도의 지적도가 통째로 빠지면 `REGION_MISSING`으로 게시가 막힌다. `readShpPoints`가 파일마다 `.prj`로 좌표계를 판별하므로 시도별로 좌표계가 달라도 된다.

- [ ] **Step 2: 원천 받기·풀기** (실제 네트워크·실제 파일)

```bash
npm run vworld:fetch -- --ds 21,23
```
Expected: `ds 21: 1 files`, `ds 23: 16 files`(시도 수), 실패 0. 500 MB가 넘는 시도에서 `NOT_A_FILE`이 나오면 그 시도 이름과 메시지를 결과 문서에 적고, 사용자에게 그 파일만 VWorld에서 직접 받아 같은 경로(`.cache/v2/raw/cadastral/<기준일>/<시도>.zip`)에 넣어 달라고 요청한다(`BLOCKED`로 보고).

전국 표제부 CSV가 없으면(`ls .cache/v2/raw/ledger_title`에 `title_YYYYMM.csv` 없음) `title_202608.zip`을 푼다:
```bash
"$SYSTEMROOT/System32/tar.exe" -xf .cache/v2/raw/ledger_title/title_202608.zip -C .cache/v2/raw/ledger_title
```
풀린 파일 이름이 `title_202608.csv`가 아니면 그 이름으로 바꾼다(헤더가 한국어 컬럼명인지 `head -1`로 확인. A0 측정 때처럼 헤더가 없으면 `docs/superpowers/a0/measurements/ledger_title-5sido.json`의 `fields` 순서로 헤더 한 줄을 붙인다).

- [ ] **Step 3: 빌드·게시**

```bash
npm run data:build -- --version 2026-09-30a
```
Expected: `published <hash>`. 원천별 줄에 `ok`가 0보다 크고, `parcel`의 `located`가 100%, `ledger_recap_housing`의 `located`가 90% 이상. 품질 검사에 걸리면 실패 코드·내용을 결과 문서에 적고, 원인이 코드면 해당 태스크 파일을 고쳐 테스트를 추가한 뒤 새 버전 이름으로 다시 돌린다.

- [ ] **Step 4: 검수 8곳 확인**

한 번 쓰고 버리는 확인 스크립트를 `$TEMP`에 두고 실행한다(저장소에 넣지 않는다):

```bash
cat > "$TEMP/p1a-sites.mjs" <<'EOF'
const { readManifest, openDataFile } = await import(process.cwd() + "/src/lib/v2/data/manifest.ts");
const { queryFeaturesInRadius } = await import(process.cwd() + "/src/lib/v2/data/features.ts");
const { legalAreasForCircle } = await import(process.cwd() + "/src/lib/v2/data/legal-areas.ts");
const { REVIEW_SITES } = await import(process.cwd() + "/src/lib/v2/a0/review-sites.ts");
const { v2DataDir } = await import(process.cwd() + "/src/lib/v2/paths.ts");
const dir = v2DataDir(); const m = readManifest(dir);
const dbs = Object.fromEntries(Object.keys(m.files).map((k) => [k, openDataFile(dir, m, k)]));
const KINDS = { core: ["housing_complex", "officetel"], reference: ["store", "bus_stop", "park"], market: ["planned_supply"] };
for (const s of REVIEW_SITES) {
  const counts = {};
  for (const [file, kinds] of Object.entries(KINDS)) for (const k of kinds) counts[k] = queryFeaturesInRadius(dbs[file], s.center, 1000, [k]).length;
  const la = legalAreasForCircle(dbs.core, s.center, 1000);
  console.log(s.id, JSON.stringify(counts), "시군구", la.sigungu.map((x) => x.name).join("/"), "읍면동", la.emd.length);
}
EOF
npx tsx "$TEMP/p1a-sites.mjs"
```
Expected: 8줄. `bokjeong`은 시군구가 둘 이상(서울 송파구·경기 성남시), `wanju`는 수치가 작아도 오류 없이 출력.

- [ ] **Step 5: 결과 문서**

`docs/superpowers/a0/2026-09-30-p1a-first-load.md`를 아래 틀로 채운다(숫자는 Step 3·4 출력을 그대로 옮긴다):

```markdown
# P1a 첫 전국 적재 결과

실행: 2026-09-30 · 버전 `2026-09-30a` · manifest `<hash 12자리>` · 소요 <분>

## 원천별

| 파일 | 원천 | 읽음 | 적재 | 위치 미확인 | 거부 | 위치 확보율 | 기준일 |
|---|---|---|---|---|---|---|---|

## 검수 8곳 (반경 1 km)

| 지역 | 공동주택 | 오피스텔 | 상가 | 버스정류장 | 공원 | 공급 예정 | 교차 시군구 |
|---|---|---|---|---|---|---|---|

## 고정 지점 기대치 후보 (미승인)

spec §3.5: 첫 적재 결과를 원천 총건수·독립 표본과 대조해 **승인한 값만** 기대치로 쓴다. 아래는 대조 전 후보다.

| siteId | kind | 이번 값 | 대조 방법 |
|---|---|---|---|

## 문제와 후속

(품질 검사 실패, 대용량 다운로드 실패, 위치 미확인이 많은 원천과 원인 추정, P1a-2로 넘길 것)
```

- [ ] **Step 6: Commit**

```bash
git add src/scripts/v2/data-build.mjs package.json docs/superpowers/a0/2026-09-30-p1a-first-load.md
# 메시지: "feat: 데이터 빌드 CLI와 첫 전국 적재 결과"
```

(`.cache/`의 원천·데이터 파일은 커밋하지 않는다.)

---

## Self-Review (작성자 확인 결과)

- **스펙 대응:** §3.1 요청 경로 로컬 전용 → 적재한 feature만 조회(Task 6~10) / §3.2 core·reference·market 파일 → Task 5·11 / §3.3 PNU 문자열·미상 NULL·교차 판정·모든 교차 시군구 → Task 6·7·8 / §3.4 한 잠금 안 빌드·게시·이전본 유지 → Task 1·5 / §3.5 급감·지역 소실·채움률·PARSED_ZERO·고정 지점 → Task 5(검사), Task 11(후보 기록) / §3.6 원천 교체(역지오코딩 21회 → 로컬 법정동, 대장 API → 전국 파일, 공원 API → 파일) → Task 7·8·9 / §6 P1 원천 목록 중 A05(대장)·A03(상가)·A06(입주예정)·A01 일부(버스)·A04 일부(공원) → Task 8·9·10. **P1a-2로 넘김:** RTMS 실거래(A07), 정비사업(A09), 계획·운영 철도(A01·A10), OSM PBF(도로·녹지), K-APT(주차 보강). P1b는 P1a와 P1a-2의 feature를 읽는다.
- **의도적 선택:** 필지는 도형 대신 bbox 중심만 저장(전국 3,900만 필지, P2에서 도형 적재 시 내부점으로 교체 — Task 6 ponytail). 원천 checksum은 크기·수정시각(Task 11 ponytail). 공급 중복 정리는 A06 타일 몫(Task 10 규칙).
- **타입 일관성:** `SourceStats(sourceId, releaseId, fillFields)`를 Task 6~10이 같은 순서로 부른다. `ShpRecord.geometry`는 `Geometry | null`(Task 4), Task 7이 `null`을 거부한다. `MeasureRecord`(P0 a0/measure.ts)의 `properties`를 Task 8·9·10이 쓴다. `KindBuilder`의 `ctx.core`는 Task 11 market 빌더가 쓴다.
