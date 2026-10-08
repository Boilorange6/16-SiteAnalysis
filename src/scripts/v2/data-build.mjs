/**
 * v2 데이터 파일 빌드·게시.
 *   npm run data:build -- --version 2026-09-30a [--raw .cache/v2/raw] [--dem-source glo30|hgt] [--only core,buildings,parcels,reference,market,terrain] [--expectations exp.json] [--with buildings,parcels] [--wait-lock [분]]
 *   buildings 전용: [--sido 11,41] 이 시도만 · [--no-juso] 도로명주소 건물 보조 원천 제외
 * 도형 원천 zip은 풀되, 전유부 전국 zip은 수십 GB라 엔트리 스트림으로만 읽는다.
 */
import { readdirSync, statSync, existsSync, readFileSync, openSync, readSync, closeSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { inspect } from "node:util";

const { extractAll, extractSelected } = await import("../../lib/v2/ingest/unzip.ts");
const { latestShpPerSido, partCounts } = await import("../../lib/v2/ingest/shp-parts.ts");
const { readShp, readShpPoints } = await import("../../lib/v2/ingest/shp.ts");
const { csvRecords } = await import("../../lib/v2/a0/measure.ts");
const {
  addBuildLog,
  buildAndPublish,
  buildResumableSourceFiles,
  buildResumableSteps,
  progressLog,
  insertRelease,
  reclaimStaleDataDirLock,
  registerIngestProgressTotal,
} = await import("../../lib/v2/ingest/build.ts");
const { buildParcelPoints } = await import("../../lib/v2/ingest/sources/parcels.ts");
const { buildParcelPolygons } = await import("../../lib/v2/ingest/sources/parcel-polygons.ts");
const { buildBuildings, finalizeLedgerMatches, FLOOR_HEIGHT_M } = await import("../../lib/v2/ingest/sources/buildings.ts");
const { buildJusoBuildings, gisFeatureIdBound, jusoShpPerSido, shpExtent, JUSO_LICENSE_CODE, JUSO_PROVIDER, JUSO_RIGHTS, JUSO_SOURCE_ID, JUSO_SOURCE_URL, OVERLAP_MIN } = await import("../../lib/v2/ingest/sources/juso-buildings.ts");
const { buildLegalAreas } = await import("../../lib/v2/ingest/sources/legal-areas.ts");
const { buildLedger, buildLedgerTitleIndex, dropLedgerTitleIndex, hasLedgerTitleIndex, ledgerFloorLookup, ledgerTitleLookup } = await import("../../lib/v2/ingest/sources/ledger.ts");
const { ledgerExclusiveRecordsFromZip } = await import("../../lib/v2/ingest/sources/ledger-exclusive.ts");
const { createParcelSpatialLookup } = await import("../../lib/v2/ingest/sources/parcel-spatial.ts");
const { buildPointSource, STORE_SPEC, BUS_STOP_SPEC, PARK_SPEC } = await import("../../lib/v2/ingest/sources/points.ts");
const { buildSupply, readLegacyPlannedHousing } = await import("../../lib/v2/ingest/sources/supply.ts");
const { buildOsmSubway, buildPlannedRail, legalCodeFromCore } = await import("../../lib/v2/ingest/sources/rail.ts");
const { buildOsmRoads, OSM_ROADS_LAYER, OSM_ROADS_RIGHTS } = await import("../../lib/v2/ingest/sources/osm-roads.ts");
const { buildOsmAreas, OSM_GREEN_LAYERS, OSM_LANDUSE_SOURCE_ID, OSM_WATER_LAYERS, OSM_WATER_SOURCE_ID } = await import("../../lib/v2/ingest/sources/osm-landuse.ts");
const { buildDemTiles } = await import("../../lib/v2/ingest/sources/dem.ts");
const { GLO30_PROVIDER, GLO30_RIGHTS, GLO30_SOURCE_URL } = await import("../../lib/v2/data/terrain.ts");
const { legacyDbPath, v2DataDir } = await import("../../lib/v2/paths.ts");

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const version = opt("version");
if (!version || !/^[0-9A-Za-z._-]+$/.test(version)) {
  console.error("usage: data:build -- --version <name> [--raw dir] [--data-dir dir] [--dem-source glo30|hgt] [--only core,buildings,parcels,reference,market,terrain] [--with buildings,parcels] [--resume] [--log file] [--expectations file.json] [--reset-baseline parcel,parcel_building] [--dry-run]");
  process.exit(2);
}
// 로그: 콘솔 출력도 로그 파일(--log, 버전 폴더의 build.log)에 덧붙이고, 셸이 죽어 stdout이 닫혀도 빌드는 계속된다.
if (opt("log")) addBuildLog(opt("log"));
for (const m of ["log", "warn"]) console[m] = (...a) => progressLog(a.map((x) => (typeof x === "string" ? x : inspect(x))).join(" "));
const flag = (name) => args.includes(`--${name}`);
const resume = flag("resume");
const raw = opt("raw", ".cache/v2/raw");
const dataDir = opt("data-dir", v2DataDir());
const only = new Set(String(opt("only", "core,reference,market")).split(","));
const sidoOnly = opt("sido") ? new Set(String(opt("sido")).split(",")) : null;
/** 기본 빌드에 넣지 않는 무거운 원천: 건물·필지 도형은 core가 아니라 별도 파일. --only 또는 --with로 선택한다. */
for (const kind of String(opt("with", "")).split(",")) if (kind === "buildings" || kind === "parcels") only.add(kind);
if (only.has("market")) {
  const legacyPath = legacyDbPath();
  if (!existsSync(legacyPath)) {
    console.error(`legacy DB not found at ${legacyPath} — set DB_PATH=<existing site-analysis.db> and retry (for example, DB_PATH=D:\\path\\site-analysis.db)`);
    process.exit(2);
  }
}
/** --wait-lock [분]: 다른 빌드가 데이터 디렉터리 잠금을 쥐고 있으면 풀릴 때까지 기다린다(기본 180분) */
const waitLockIdx = args.indexOf("--wait-lock");
const waitLockMin = waitLockIdx < 0 ? null : /^\d+(\.\d+)?$/.test(args[waitLockIdx + 1] ?? "") ? Number(args[waitLockIdx + 1]) : 180;
const resetBaseline = opt("reset-baseline") ? opt("reset-baseline").split(",") : undefined;
const expectations = opt("expectations") ? JSON.parse(readFileSync(opt("expectations"), "utf8")) : undefined;

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}
/** 이름에 든 날짜(20YYMMDD, 20YYMM, 20YY-MM-DD)를 비교 가능한 숫자 문자열로. 없으면 "" */
const nameDate = (f) => {
  const m = basename(f).match(/(20\d{2})-?(\d{2})(?:-?(\d{2}))?/);
  return m ? `${m[1]}${m[2]}${m[3] ?? "00"}` : "";
};
/** 이름 날짜가 가장 늦은 파일, 이름에 날짜가 없거나 같으면 수정시각이 늦은 파일 */
const newest = (dir, re) => {
  const files = [...walk(join(raw, dir))].filter((f) => re.test(basename(f))).sort((a, b) => nameDate(b).localeCompare(nameDate(a)) || statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (files.length === 0) throw new Error(`no file matching ${re} under ${join(raw, dir)} — download it first (A0 표/vworld:fetch)`);
  return files[0];
};
const asOfOf = (file) => {
  const m = basename(file).match(/(20\d{2})-?(\d{2})-?(\d{2})?/);
  return m ? `${m[1]}-${m[2]}${m[3] ? `-${m[3]}` : ""}` : null;
};
const normalizeDataAsOf = (value) => {
  const text = String(value ?? "").trim();
  const m = /^(20\d{2})(?:[-./]?(\d{2})(?:[-./]?(\d{2}))?)?$/.exec(text);
  if (!m) return null;
  return m[2] ? `${m[1]}-${m[2]}${m[3] ? `-${m[3]}` : ""}` : m[1];
};
/** 표준데이터의 데이터기준일자를 release sourceAsOf로 옮긴다. 파일명/수정일은 대체하지 않는다. */
const csvDataAsOf = async (file, field = "데이터기준일자") => {
  const { records } = await csvRecords(file);
  let latest = null;
  for await (const record of records) {
    const asOf = normalizeDataAsOf(record.properties[field]);
    if (asOf && (!latest || asOf > latest)) latest = asOf;
  }
  return latest;
};
const release = (db, sourceId, file, provider, sourceUrl, licenseCode, sourceAsOf = undefined) => {
  const st = statSync(file);
  // ponytail: 수 GB 원천의 SHA-256 대신 크기·수정시각 — 원천 무결성 검증이 필요해지면 스트리밍 해시로 바꾼다
  return insertRelease(db, { sourceId, provider, sourceUrl, sourceAsOf: sourceAsOf === undefined ? asOfOf(file) : sourceAsOf, fetchedAt: st.mtime.toISOString(), checksum: `size-mtime:${st.size}-${Math.round(st.mtimeMs)}`, licenseCode });
};

/** DBF header record count is available before SHP decoding and is cheap to read. */
const dbfRecordCount = (shpFile) => {
  const dbfFile = shpFile.replace(/\.shp$/i, ".dbf");
  if (!existsSync(dbfFile)) return 0;
  const fd = openSync(dbfFile, "r");
  try {
    const header = Buffer.alloc(8);
    if (readSync(fd, header, 0, header.length, 0) !== header.length) return 0;
    return header.readUInt32LE(4);
  } finally {
    closeSync(fd);
  }
};
const registerShpProgress = (sourceId, files) => {
  const total = files.reduce((sum, file) => sum + dbfRecordCount(file), 0);
  if (total > 0) registerIngestProgressTotal(sourceId, total);
  return total;
};
const progressFiles = (files) => [...files].map((file) => {
  const st = statSync(file);
  return {
    absPath: file,
    path: relative(raw, file).replaceAll("\\", "/"),
    size: st.size,
    mtimeMs: Math.round(st.mtimeMs),
    rows: dbfRecordCount(file),
  };
}).sort((a, b) => a.path.localeCompare(b.path));
const progressSpec = (sourceId, kind, files, parameters) => ({
  sourceId,
  parameters: JSON.stringify({ schema: 1, kind, sourceId, ...parameters }),
  files: files.map(({ path, size, mtimeMs, rows }) => ({ path, size, mtimeMs, rows })),
});
async function* chain(...gens) {
  for (const g of gens) yield* g;
}

if (waitLockMin !== null && !flag("dry-run")) {
  reclaimStaleDataDirLock(dataDir);
  const { waitForDataDirLock } = await import("../../lib/v2/data/manifest.ts");
  if (!(await waitForDataDirLock(dataDir, { timeoutMs: waitLockMin * 60_000 }))) {
    console.error(`data dir still locked after ${waitLockMin} min — giving up`);
    process.exit(3);
  }
}

console.log("unzip:", extractAll(join(raw, "legal_dong")).length + extractAll(join(raw, "cadastral")).length + extractAll(join(raw, "gis_building")).length, "archive(s)");

/** 세트들 중 가장 오래된 날짜의 첫 파일(릴리스 기준일용) */
const oldestFile = (sets) => [...sets.values()].sort((a, b) => a.date.localeCompare(b.date))[0].files[0];
const flat = (sets) => [...sets.values()].flatMap((v) => v.files);
const oldestJuso = (sets) => [...sets.values()].sort((a, b) => a.date.localeCompare(b.date))[0].file;

/** 지적도·GIS건물 파일과 표제부를 고르고, 법정구역의 모든 시도가 지적도 또는 건물 파일로 덮이는지 확인한다. */
async function discoverCore() {
  const allIn = (dir) => [...walk(join(raw, dir))];
  const cadastral = latestShpPerSido(allIn("cadastral"), "AL_D002");
  const buildingAll = latestShpPerSido(allIn("gis_building"), "AL_D010");
  const buildings = new Map([...buildingAll].filter(([s]) => !cadastral.has(s)));
  if (cadastral.size + buildings.size === 0) throw new Error("지적도(cadastral)도 GIS건물(gis_building) 파일도 없습니다 — vworld:fetch로 받으세요");
  const legalSido = new Set();
  for await (const r of readShp(newest("legal_dong", /\(SIG\)\.shp$/i))) legalSido.add(String(r.properties.A1).slice(0, 2));
  const missing = [...legalSido].filter((c) => !cadastral.has(c) && !buildings.has(c)).sort();
  if (missing.length > 0) throw new Error(`시도 ${missing.join(",")}: 지적도도 GIS건물 파일도 없습니다 — 받은 뒤 다시 실행하세요`);
  const titles = allIn("ledger_title").filter((f) => /^title_\d{6}\.csv$/i.test(basename(f))).sort((a, b) => basename(b).localeCompare(basename(a)));
  const titleFile = titles[0] ?? newest("ledger_title", /^title_5sido\.csv$/i);
  console.log(`parcel points: cadastral parts by 시도 ${partCounts(cadastral)} · from buildings parts by 시도 ${partCounts(buildings)} · title ${basename(titleFile)}`);
  return { cadastral, buildings, buildingAll, titleFile, hasNationalTitle: titles.length > 0 };
}
if (flag("dry-run")) {
  await discoverCore();
  process.exit(0);
}

const builders = {};
const progress = {};
let coreTitleIndexStaging = false;
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
    const { cadastral, buildings, titleFile, hasNationalTitle } = await discoverCore();
    const parcels = [];
    if (cadastral.size > 0) {
      registerShpProgress("parcel", flat(cadastral));
      const parcelRel = release(db, "parcel", oldestFile(cadastral), "국토교통부(VWorld 연속지적도형정보)", "https://www.vworld.kr/dtmk/dtmk_ntads_s002.do?svcCde=NA&dsId=23", "CC-BY");
      const parcel = await buildParcelPoints(db, chain(...flat(cadastral).map((f) => readShpPoints(f))), parcelRel);
      parcel.expectedRegions = [...cadastral.keys()];
      parcels.push(parcel);
    } else {
      console.log("지적도 파일이 없어 모든 필지 대표점을 GIS건물에서 만듭니다");
    }
    if (buildings.size > 0) {
      // 500MB 넘는 시도 지적도는 VWorld가 일반 다운로드로 안 준다 — 그 시도만 GIS건물통합정보(A2=PNU)의 건물 대표점으로 대신한다. 지적도 뒤에 넣어 INSERT OR IGNORE가 지적도 행을 우선한다.
      const buildingRel = release(db, "parcel_building", oldestFile(buildings), "국토교통부(VWorld GIS건물통합정보, 필지 대표점 대체)", "https://www.vworld.kr/dtmk/dtmk_ntads_s002.do?svcCde=NA&dsId=18", "CC-BY");
      registerShpProgress("parcel_building", flat(buildings));
      async function* buildingAsParcels(file) {
        for await (const r of readShpPoints(file)) yield { properties: { A1: r.properties.A2, A5: null }, point: r.point };
      }
      const pb = await buildParcelPoints(db, chain(...flat(buildings).map(buildingAsParcels)), buildingRel, "parcel_building");
      pb.expectedRegions = [...buildings.keys()];
      parcels.push(pb);
    }
    const recapFile = newest("ledger_recap", /^recap_.*\.csv$/i);
    const exclusiveFiles = [...walk(join(raw, "ledger_exclusive"))].filter((file) => /^exclusive_.*\.zip$/i.test(basename(file))).sort((a, b) => nameDate(b).localeCompare(nameDate(a)) || statSync(b).mtimeMs - statSync(a).mtimeMs);
    const exclusiveFile = exclusiveFiles[0] ?? null;
    if (!exclusiveFile) console.warn("⚠ 전유공용면적 전국 ZIP이 없어 A05 타입을 적재하지 않습니다");
    if (!hasNationalTitle) console.warn("⚠ 전국 표제부(title_YYYYMM.csv)가 없어 5개 시도 표제부로 적재합니다 — 오피스텔·단일동 커버리지 일부");
    const ledger = await buildLedger(db, {
      recapReleaseId: release(db, "ledger_recap", recapFile, "국토교통부 건축HUB", "https://www.hub.go.kr/portal/opn/lps/idx-lgcpt-pvsn-srvc-list.do", "UNRESTRICTED"),
      titleReleaseId: release(db, "ledger_title", titleFile, "국토교통부 건축HUB", "https://www.hub.go.kr/portal/opn/lps/idx-lgcpt-pvsn-srvc-list.do", "UNRESTRICTED"),
      recap: (await csvRecords(recapFile)).records,
      title: (await csvRecords(titleFile)).records,
      ...(exclusiveFile ? {
        exclusiveReleaseId: release(db, "ledger_exclusive_area", exclusiveFile, "국토교통부 건축HUB", "https://www.hub.go.kr/portal/opn/lps/idx-lgcpt-pvsn-srvc-list.do", "UNRESTRICTED"),
        exclusive: ledgerExclusiveRecordsFromZip(exclusiveFile),
      } : {}),
    });
    const result = [...legal, ...parcels, ...ledger];
    if (only.has("buildings")) coreTitleIndexStaging = true;
    else dropLedgerTitleIndex(db);
    return result;
  };
}
if (only.has("buildings")) {
  // 건물 도형: 받은 모든 시도의 GIS건물통합정보. 시도 하나라도 없으면 있는 시도만 적재하고 그 사실을 알린다.
  // 이 빌더는 현재 core를 건드리지 않는다(ctx.core는 읽기 전용으로 전달됨) — --only buildings는 매니페스트의 core를 그대로 재사용한다.
  // --sido 11,41: 이 시도만 적재한다(GIS건물·도로명주소 건물 모두). 검증용 — 재개할 때도 같은 값을 줘야 한다.
  const buildingAll = new Map([...latestShpPerSido([...walk(join(raw, "gis_building"))], "AL_D010")].filter(([s]) => !sidoOnly || sidoOnly.has(s)));
  if (buildingAll.size === 0) throw new Error("GIS건물(gis_building) 파일이 없습니다 — vworld:fetch로 받으세요");
  const maxYear = new Date().getUTCFullYear();
  const buildingFiles = progressFiles(flat(buildingAll));
  const titleCandidates = [...walk(join(raw, "ledger_title"))].filter((file) => /^title_\d{6}\.csv$/i.test(basename(file))).sort((a, b) => basename(b).localeCompare(basename(a)));
  const titleFile = titleCandidates[0] ?? newest("ledger_title", /^title_5sido\.csv$/i);
  // 행안부 도로명주소 건물(보조 원천): raw/juso가 있으면 GIS건물 단계 뒤에 시도 파일마다 한 단계씩 잇는다. --no-juso로 끈다.
  let jusoAll = new Map();
  if (!flag("no-juso") && existsSync(join(raw, "juso"))) {
    extractSelected(join(raw, "juso"), (entry) => {
      const m = /(?:^|[\\/])TL_SPBD_BULD_(\d{2})_\d{6}\.(?:shp|dbf|prj|shx|cpg)$/i.exec(entry);
      return m !== null && (!sidoOnly || sidoOnly.has(m[1]));
    });
    jusoAll = new Map([...jusoShpPerSido([...walk(join(raw, "juso"))])].filter(([s]) => !sidoOnly || sidoOnly.has(s)));
  }
  const jusoFiles = progressFiles([...jusoAll.values()].map((v) => v.file));
  const withJuso = jusoFiles.length > 0;
  const buildingProgress = progressSpec("building", "buildings", [...buildingFiles, ...jusoFiles], {
    sourcePattern: "gis_building/AL_D010", maxYear,
    ledgerHeight: "title-dong-index-v2",
    ledgerTitle: { file: relative(raw, titleFile).replaceAll("\\", "/"), size: statSync(titleFile).size, mtimeMs: Math.round(statSync(titleFile).mtimeMs) },
    parcels: "same-build-or-current-manifest",
    ...(withJuso ? { juso: { sourcePattern: "juso/TL_SPBD_BULD", overlapMin: OVERLAP_MIN, floorHeightM: FLOOR_HEIGHT_M, replacementRule: "core-pnu-approval-name-v1" } } : {}),
  });
  progress.buildings = buildingProgress;
  const buildingByPath = new Map([...buildingFiles, ...jusoFiles].map((file) => [file.path, file.absPath]));
  builders.buildings = async (db, ctx) => {
    const rel = release(db, "building", oldestFile(buildingAll), "국토교통부(VWorld GIS건물통합정보)", "https://www.vworld.kr/dtmk/dtmk_ntads_s002.do?svcCde=NA&dsId=18", "CC-BY");
    let ledger = ledgerFloorLookup(ctx.core);
    let titleIndexInBuildings = false;
    if (!hasLedgerTitleIndex(ctx.core)) {
      titleIndexInBuildings = true;
      if (resume && hasLedgerTitleIndex(db)) {
        ledger = ledgerTitleLookup(db);
        console.log("buildings: reusing resumable ledger title index");
      } else {
        const titlePrefixes = sidoOnly ? new Set(sidoOnly) : undefined;
        const indexed = await buildLedgerTitleIndex(db, (await csvRecords(titleFile)).records, { pnuPrefixes: titlePrefixes });
        ledger = ledgerTitleLookup(db);
        console.log(`buildings: streamed ledger title index ${indexed.toLocaleString()} rows from ${basename(titleFile)}`);
      }
    } else {
      console.log("buildings: using same-run TEMP ledger title index from core");
    }
    const spatial = createParcelSpatialLookup(ctx.parcels, ctx.parcelVersion);
    if (spatial) console.log(`buildings: parcel spatial join enabled (parcelVersion=${ctx.parcelVersion})`);
    else console.warn("⚠ buildings: parcels.sqlite가 없어 spatial PNU 보강을 건너뜁니다");
    console.log(`buildings: 시도 ${partCounts(buildingAll)}${withJuso ? ` · 도로명주소 건물 시도 ${[...jusoAll.keys()].join(",")}` : " · 도로명주소 건물 없음(GIS건물만)"}`);
    if (!withJuso) {
      const b = await buildResumableSourceFiles(db, {
        spec: buildingProgress,
        releaseId: rel,
        fillFields: ["heightM", "floorsAbove", "useCode", "approvalDate"],
        buildFile: (file) => buildBuildings(db, readShp(buildingByPath.get(file.path)), rel, { maxYear, ledger, spatial, parcelVersion: ctx.parcelVersion, deferLedgerMatches: true }),
      });
      const ledgerResult = finalizeLedgerMatches(db, b);
      console.log(`buildings: ledger matches=${ledgerResult.matched} rejected 1:N=${ledgerResult.rejectedOneToMany}`);
      if (titleIndexInBuildings) dropLedgerTitleIndex(db);
      if (coreTitleIndexStaging && ctx.core) dropLedgerTitleIndex(ctx.core);
      b.expectedRegions = [...buildingAll.keys()];
      return [b];
    }
    const jusoRel = insertRelease(db, {
      sourceId: JUSO_SOURCE_ID, provider: JUSO_PROVIDER, sourceUrl: JUSO_SOURCE_URL,
      sourceAsOf: asOfOf(oldestJuso(jusoAll)), fetchedAt: statSync(oldestJuso(jusoAll)).mtime.toISOString(),
      checksum: `size-mtime:${jusoFiles.reduce((a, f) => a + f.size, 0)}-${Math.max(...jusoFiles.map((f) => f.mtimeMs))}`,
      licenseCode: JUSO_LICENSE_CODE, rights: JUSO_RIGHTS,
    });
    const sidoOfFile = new Map([...buildingAll].flatMap(([sido, v]) => v.files.map((f) => [f, sido])));
    const steps = [
      ...buildingFiles.map((file) => ({
        file,
        run: async () => {
          const s = await buildBuildings(db, readShp(file.absPath), rel, { maxYear, ledger, spatial, parcelVersion: ctx.parcelVersion, deferLedgerMatches: true });
          s.expectedRegions = [sidoOfFile.get(file.absPath)];
          return [s];
        },
      })),
      // 도로명주소 건물: 위 GIS건물 단계가 모두 끝난 뒤(순서 보장) — 겹침 판정 기준이 되는 GIS 건물 feature_id 상한을 처음 한 번 정해 둔다.
      ...[...jusoAll].map(([sido, v]) => ({
        file: jusoFiles.find((f) => f.absPath === v.file),
        run: async () => {
          const s = await buildJusoBuildings(db, readShp(v.file, { native: true }), jusoRel, {
            extent: shpExtent(v.file),
            gisMaxFeatureId: gisFeatureIdBound(db),
            core: ctx.core,
            coreApprovalMaxDate: new Date().toISOString().slice(0, 10),
          });
          s.expectedRegions = [sido];
          return [s];
        },
      })),
    ];
    const stepStats = await buildResumableSteps(db, buildingProgress, steps);
    const ledgerResult = finalizeLedgerMatches(db, stepStats);
    console.log(`buildings: ledger matches=${ledgerResult.matched} rejected 1:N=${ledgerResult.rejectedOneToMany}`);
    if (titleIndexInBuildings) dropLedgerTitleIndex(db);
    if (coreTitleIndexStaging && ctx.core) dropLedgerTitleIndex(ctx.core);
    return stepStats;
  };
}
if (only.has("parcels")) {
  // 연속지적 도형은 core의 대표점과 별도 게시한다. 시도별 최신 파트만 골라 첫 PNU를 유지한다.
  const parcelAll = new Map([...latestShpPerSido([...walk(join(raw, "cadastral"))], "AL_D002")].filter(([s]) => !sidoOnly || sidoOnly.has(s)));
  if (parcelAll.size === 0) throw new Error("연속지적도(cadastral) 파일이 없습니다 — vworld:fetch로 받으세요");
  const parcelFiles = progressFiles(flat(parcelAll));
  const parcelProgress = progressSpec("parcel_polygon", "parcels", parcelFiles, { sourcePattern: "cadastral/AL_D002" });
  progress.parcels = parcelProgress;
  const parcelByPath = new Map(parcelFiles.map((file) => [file.path, file.absPath]));
  builders.parcels = async (db) => {
    const rel = release(db, "parcel_polygon", oldestFile(parcelAll), "국토교통부(VWorld 연속지적도형정보)", "https://www.vworld.kr/dtmk/dtmk_ntads_s002.do?svcCde=NA&dsId=23", "CC-BY");
    const p = await buildResumableSourceFiles(db, {
      spec: parcelProgress,
      releaseId: rel,
      fillFields: ["jimok", "jibun", "sigungu", "areaM2"],
      buildFile: (file) => buildParcelPolygons(db, readShp(parcelByPath.get(file.path)), rel),
    });
    p.expectedRegions = [...parcelAll.keys()];
    console.log(`parcels: 시도 ${partCounts(parcelAll)}`);
    return [p];
  };
}
if (only.has("terrain")) {
  const demSource = String(opt("dem-source", "glo30")).toLowerCase();
  if (demSource !== "glo30" && demSource !== "hgt") throw new Error(`unsupported --dem-source ${demSource}; choose glo30 or hgt`);
  const demDir = join(raw, "dem", demSource);
  const demPattern = demSource === "glo30" ? /\.tif(?:f)?$/i : /\.hgt(?:\.gz)?$/i;
  const demFiles = [...walk(demDir)].filter((file) => demPattern.test(basename(file))).sort();
  if (demFiles.length === 0) throw new Error(`no DEM ${demSource} files under ${demDir} — run dem-fetch.mjs first`);
  builders.terrain = async (db) => {
    const stats = demFiles.map((file) => statSync(file));
    const fetchedAt = new Date(Math.max(...stats.map((s) => s.mtimeMs))).toISOString();
    const checksum = demFiles.map((file, i) => `${basename(file)}:${stats[i].size}-${Math.round(stats[i].mtimeMs)}`).join("|");
    const releaseId = insertRelease(db, {
      sourceId: "terrain_tiles",
      provider: demSource === "glo30" ? GLO30_PROVIDER : "Mapzen/AWS Terrain Tiles (SRTM 1 arc-second)",
      sourceUrl: demSource === "glo30" ? GLO30_SOURCE_URL : "https://registry.opendata.aws/terrain-tiles/",
      sourceAsOf: null,
      fetchedAt,
      checksum,
      licenseCode: "attribution",
      rights: demSource === "glo30"
        ? { attribution: GLO30_RIGHTS, verticalDatum: "EGM2008" }
        : { attribution: "Terrain Tiles: SRTM(NASA/USGS), GMTED2010, ETOPO1 — https://github.com/tilezen/joerd/blob/master/docs/attribution.md", verticalDatum: "EGM96" },
    });
    return [await buildDemTiles(db, demFiles, releaseId)];
  };
}
if (only.has("weather")) {
  const asosDir = join(raw, "asos");
  const stationFile = join(asosDir, "META_관측지점정보.csv");
  if (!existsSync(stationFile)) throw new Error(`ASOS 지점 메타 파일이 없습니다: ${stationFile} — weather-fetch.mjs를 먼저 실행하세요`);
  const { decodeText } = await import("../../lib/v2/a0/measure.ts");
  const { buildAsosWind, readStationCsv } = await import("../../lib/v2/ingest/sources/asos-wind.ts");
  const period = { start: opt("period-start", "2016-01-01"), end: opt("period-end", "2025-12-31") };
  const stations = readStationCsv(decodeText(readFileSync(stationFile)).text, period);
  if (stations.length === 0) throw new Error(`ASOS 지점 메타 파일에 유효한 지점이 없습니다: ${stationFile}`);
  const hourlyFiles = [...walk(asosDir)]
    .filter((file) => /^\d{4}\.jsonl$/i.test(basename(file)))
    .sort();
  if (hourlyFiles.length === 0) throw new Error(`ASOS 시간자료 JSONL이 없습니다: ${asosDir} — weather-fetch.mjs를 먼저 실행하세요`);
  builders.weather = async (db) => {
    const sourceFiles = [stationFile, ...hourlyFiles];
    const fileStats = sourceFiles.map((file) => statSync(file));
    const fetchedAt = new Date(Math.max(...fileStats.map((stat) => stat.mtimeMs))).toISOString();
    const checksum = sourceFiles.map((file, i) => `${file.slice(asosDir.length + 1)}:${fileStats[i].size}-${Math.round(fileStats[i].mtimeMs)}`).join("|");
    const releaseId = insertRelease(db, {
      sourceId: "asos",
      provider: "기상청 ASOS 시간자료",
      sourceUrl: "https://www.data.go.kr/data/15139432/openapi.do",
      sourceAsOf: period.end,
      fetchedAt,
      checksum,
      licenseCode: "KOGL-1",
      rights: { attribution: "기상청 ASOS 시간자료 · 공공저작물 출처표시 제1유형" },
    });
    async function* rows() {
      const { createReadStream } = await import("node:fs");
      const { createInterface } = await import("node:readline");
      for (const file of hourlyFiles) {
        const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
        for await (const line of lines) {
          if (!line.trim()) continue;
          const row = JSON.parse(line);
          const numberOrNull = (value) => {
            if (value === null || value === undefined || String(value).trim() === "" || String(value).trim() === "-") return null;
            const number = Number(value);
            return Number.isFinite(number) ? number : null;
          };
          yield {
            stnId: String(row.stnId ?? ""),
            tm: String(row.tm ?? ""),
            ws: numberOrNull(row.ws),
            wd: numberOrNull(row.wd),
            ta: numberOrNull(row.ta),
            hm: numberOrNull(row.hm),
            icsr: numberOrNull(row.icsr),
            dc10Tca: numberOrNull(row.dc10Tca),
          };
        }
      }
    }
    return [await buildAsosWind(db, stations, rows(), releaseId, period)];
  };
}
if (only.has("market")) {
  builders.market = async (db, ctx) => {
    if (!ctx.core) throw new Error("market needs core (build core first or publish a core file)");
    const moveInFile = newest("move_in", /^move_in_.*\.csv$/i);
    const applyhomeTypeFiles = [...walk(join(raw, "applyhome"))].filter((file) => /^applyhome_types_.*\.csv$/i.test(basename(file))).sort((a, b) => nameDate(b).localeCompare(nameDate(a)) || statSync(b).mtimeMs - statSync(a).mtimeMs);
    const applyhomeTypesFile = applyhomeTypeFiles[0] ?? null;
    if (!applyhomeTypesFile) console.warn("⚠ 청약홈 주택형 API 원천이 없어 A06 타입을 적재하지 않습니다");
    const legacyPath = legacyDbPath();
    return buildSupply(db, {
      core: ctx.core,
      legacy: readLegacyPlannedHousing(legacyPath),
      legacyReleaseId: release(db, "applyhome", legacyPath, "한국부동산원 청약홈(기존 앱 적재본)", "https://www.data.go.kr/data/15101046/fileData.do", "UNRESTRICTED"),
      moveIn: (await csvRecords(moveInFile)).records,
      moveInReleaseId: release(db, "move_in", moveInFile, "한국부동산원", "https://www.data.go.kr/data/15111714/fileData.do", "UNRESTRICTED"),
      ...(applyhomeTypesFile ? {
        applyhomeTypes: (await csvRecords(applyhomeTypesFile)).records,
        applyhomeTypesReleaseId: release(db, "applyhome_types", applyhomeTypesFile, "한국부동산원 청약홈", "https://www.data.go.kr/data/15098547/openapi.do", "UNRESTRICTED"),
      } : {}),
    });
  };
}

// 정비사업(market, development_event): 기존 market builder 뒤에 이어 붙인다. 원천에 위치가 없어 core는 필요 없다.
if (builders.market) {
  const base = builders.market;
  builders.market = async (db, ctx) => {
    const { buildMaintenance } = await import("../../lib/v2/ingest/sources/maintenance.ts");
    const integratedFile = newest("maintenance", /^maintenance-integrated-.*\.csv$/i);
    const stdFile = newest("maintenance", /^maintenance-std-.*\.csv$/i);
    const provider = "국토교통부·지방자치단체(도시정비사업)";
    return [
      ...(await base(db, ctx)),
      ...(await buildMaintenance(db, {
        integrated: (await csvRecords(integratedFile)).records,
        integratedReleaseId: release(db, "maintenance_integrated", integratedFile, provider, "https://www.data.go.kr/data/15160169/fileData.do", "UNRESTRICTED"),
        std: (await csvRecords(stdFile)).records,
        stdReleaseId: release(db, "maintenance_std", stdFile, provider, "https://www.data.go.kr/data/15155703/standard.do", "UNRESTRICTED", await csvDataAsOf(stdFile)),
      })),
    ];
  };
}

// 학교·학구 연계(reference)와 K-APT 단지(core): 기존 builder 뒤에 이어 붙인다.
const { buildKapt, buildSchoolZoneLinks, SCHOOL_SPEC, SCHOOL_ZONE_COVERAGE } = await import("../../lib/v2/ingest/sources/school-kapt.ts");
const { buildSchoolZones, readSchoolZoneGeoJson, SCHOOL_ZONE_LAYERS, SCHOOL_ZONE_RIGHTS, SCHOOL_ZONE_SOURCE_ID } = await import("../../lib/v2/ingest/sources/school-zones.ts");
// 용도지역(VWorld dsId 24, 레이어별 전국 SHP): 필지 점과 갱신 주기가 달라 core가 아니라 reference에 둔다.
const { buildLandPrice, latestLandPricePerSido, LAND_PRICE_RIGHTS } = await import("../../lib/v2/ingest/sources/land-price.ts");
const { buildZoning, seedZoningSeen, zoningLayerFiles, ZONING_LAYERS, ZONING_RIGHTS } = await import("../../lib/v2/ingest/sources/zoning.ts");

// 정비구역 경계(VWorld dsId 24 정비 5개 레이어) + 정비사업 명부 매칭: 폴더가 없으면 건너뛴다. 날짜 폴더 아래(maintenance_zone/YYYY-MM-DD/x)에 풀려 있다.
const { loadMaintenanceZones, finishMaintenanceZones, mzoneLayerFiles, sigunguIndexFromCore, MZONE_LAYERS, MZONE_RIGHTS } = await import("../../lib/v2/ingest/sources/maintenance-zone.ts");

// SGIS 1 km 인구·가구 격자(reference): .cache/v2/raw/sgis_grid 폴더가 있고 CSV가 풀려 있을 때만. 시도는 core 시군구 경계로 판정한다.
const { buildPopGrid, sgisRows, sgisDataYear, locateSigunguFromCore } = await import("../../lib/v2/ingest/sources/sgis-grid.ts");
const sgisDir = join(raw, "sgis_grid");
if (builders.core) {
  const base = builders.core;
  builders.core = async (db, ctx) => {
    const built = await base(db, ctx);
    const file = newest("kapt", /^kapt_complex_.*\.csv$/i);
    const releaseId = release(db, "kapt", file, "한국부동산원(공동주택 단지 식별정보)", "https://www.data.go.kr/data/15106861/fileData.do", "UNRESTRICTED");
    return [...built, ...(await buildKapt(db, { records: (await csvRecords(file)).records, releaseId }))];
  };
}

// 국토부 실거래: rtms:fetch로 받은 원본이 있을 때만 market에 이어 붙인다(없으면 건너뜀 — 빌드는 실패하지 않는다).
const { buildRtms, hasRtmsRaw } = await import("../../lib/v2/ingest/sources/rtms.ts");
if (builders.market && hasRtmsRaw(raw)) {
  const base = builders.market;
  builders.market = async (db, ctx) => [...(await base(db, ctx)), ...(await buildRtms(db, { core: ctx.core, rawDir: raw }))];
} else if (builders.market) {
  console.log("rtms: 원본 없음 — 실거래 적재 건너뜀 (npm run rtms:fetch)");
}

// D11·D12 구역·지구·도시계획시설(reference): Q1 레이어 표가 확정되고 raw/districts가 있을 때만 이어 붙인다.
const districtsDir = join(raw, "districts");
const { buildDistricts, seedDistrictSeen, districtLayerFiles, DISTRICT_LAYERS, DISTRICT_RIGHTS } = await import("../../lib/v2/ingest/sources/districts.ts");

// ── reference: 원천(파일) 단위 단계. 단계마다 한 트랜잭션 + 진행표 행이라 PC가 꺼져도 --resume으로 끝난 단계를 건너뛰고 이어 간다. ──
// 단계 순서 = 실행 순서. slot = 중단 없는 빌드가 돌려주던 통계 목록의 순서(ingest_run 순번을 그대로 두려는 것).
if (only.has("reference")) {
  // 폴더는 안에 파일이 늘면 수정시각이 바뀌므로 지문에서 뺀다(0).
  const fileStat = (f) => { const st = statSync(f); return st.isDirectory() ? { size: 0, mtimeMs: 0 } : st; };
  const fp = (files) => ({ size: files.reduce((a, f) => a + fileStat(f).size, 0), mtimeMs: Math.round(Math.max(0, ...files.map((f) => fileStat(f).mtimeMs))) });
  const steps = [];
  /** id: 진행표 경로(안정적 이름), files: 지문용 원천 파일들 */
  const step = (id, files, rows, slot, run, extra = {}) => steps.push({ file: { path: id, ...fp(files), rows }, slot, run, ...extra });
  let db_; // 단계 실행 중인 reference DB와 core (builder가 채운다)
  let core_ = null;
  const SLOT = { store: 0, bus_stop: 1, park: 2, subway: 3, planned: 4, roads: 5, landuse: 6, water: 7, school: 8, zones: 9, links: 10, zoning: 11, land_price: 20, mzone: 21, sgis: 22, districts: 23 };
  const provider = "한국교육시설안전원";

  // 학교·학구: 점(CSV) → 학구 폴리곤(VWorld GeoJSON) → 학교-학구 연계(CSV, 폴리곤 id로 걸러냄)
  const schoolFile = newest("school", /^school-location.*\.csv$/i);
  const linkFile = newest("school_zone", /^school-zone-link.*\.csv$/i);
  const elemFile = newest("school_zone", /^school-zone-elem.*\.csv$/i);
  const vworldDir = join(raw, "school_zone", "vworld");
  const vworldFiles = SCHOOL_ZONE_LAYERS.map((layer) => ({ layer, file: join(vworldDir, `${layer.apiLayer}.geojson`) }));
  const haveVworld = vworldFiles.every(({ file }) => existsSync(file));
  const zoneReleaseOf = () => {
    const done = vworldFiles.map(({ file }) => {
      try { return JSON.parse(readFileSync(`${file}.done.json`, "utf8")); } catch { return {}; }
    });
    const baseDates = done.flatMap((d) => Array.isArray(d.base_dates) ? d.base_dates : typeof d.base_dt === "string" ? [d.base_dt] : []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    const sts = vworldFiles.map(({ file }) => statSync(file));
    return insertRelease(db_, {
      sourceId: SCHOOL_ZONE_SOURCE_ID,
      provider: "국토교통부(VWorld Data API 학교 학구도·학교군)",
      sourceUrl: "https://api.vworld.kr/req/data",
      sourceAsOf: baseDates.at(-1) ?? null,
      fetchedAt: new Date(Math.max(...sts.map((st) => st.mtimeMs))).toISOString(),
      checksum: vworldFiles.map(({ file }, i) => `${basename(file)}:${sts[i].size}-${Math.round(sts[i].mtimeMs)}`).join("|"),
      licenseCode: "UNRESTRICTED",
      rights: SCHOOL_ZONE_RIGHTS,
    });
  };
  step(`school/${basename(schoolFile)}`, [schoolFile], 0, SLOT.school, async () => [
    await buildPointSource(db_, SCHOOL_SPEC, (await csvRecords(schoolFile)).records, release(db_, "school", schoolFile, provider, "https://www.data.go.kr/data/15021148/standard.do", "UNRESTRICTED", await csvDataAsOf(schoolFile))),
  ]);
  if (haveVworld) {
    step("school_zone/vworld", vworldFiles.map(({ file }) => file), 0, SLOT.zones, async () => {
      const zoneRelease = zoneReleaseOf();
      const zoneStats = await buildSchoolZones(db_, vworldFiles.map(({ layer, file }) => ({ layer: layer.key, releaseId: zoneRelease, records: readSchoolZoneGeoJson(file) })));
      const totalRows = zoneStats.reduce((n, s) => n + s.received, 0);
      const totalFeatures = zoneStats.reduce((n, s) => n + s.accepted, 0);
      db_.prepare("UPDATE source_release SET rights_json = ?, coverage_json = ? WHERE release_id = ?").run(
        JSON.stringify(SCHOOL_ZONE_RIGHTS),
        JSON.stringify({ polygons: true, layers: vworldFiles.map(({ layer }) => layer.apiLayer), features: totalFeatures, rows: totalRows }),
        zoneRelease,
      );
      console.log(`school_zone: VWorld polygons ${totalFeatures.toLocaleString()} features / ${totalRows.toLocaleString()} rows`);
      return zoneStats;
    });
  } else {
    console.log("school_zone: VWorld GeoJSON 3종이 모두 없어 폴리곤 적재를 건너뜁니다");
  }
  step("school_zone/link", [linkFile, elemFile], 0, SLOT.links, async () => {
    const linkRel = release(db_, "school_zone_link", linkFile, provider, "https://www.data.go.kr/data/15021158/standard.do", "UNRESTRICTED", await csvDataAsOf(linkFile));
    const elemRel = release(db_, "school_zone_elem", elemFile, provider, "https://www.data.go.kr/data/15021149/standard.do", "UNRESTRICTED", await csvDataAsOf(elemFile));
    const zoneIds = haveVworld ? new Set(db_.prepare("SELECT stable_id FROM feature WHERE kind IN ('school_zone_elem', 'school_zone_middle', 'school_zone_high')").pluck().all()) : null;
    const csvCoverage = { ...SCHOOL_ZONE_COVERAGE, polygons: zoneIds !== null, polygonSource: zoneIds !== null ? "school_zone" : null };
    for (const rel of [linkRel, elemRel]) db_.prepare("UPDATE source_release SET coverage_json = ? WHERE release_id = ?").run(JSON.stringify(csvCoverage), rel);
    return buildSchoolZoneLinks(db_, { link: (await csvRecords(linkFile)).records, elem: (await csvRecords(elemFile)).records, linkReleaseId: linkRel, elemReleaseId: elemRel, zoneIds });
  });

  // 철도: v1이 이미 가진 공개 파일. 기준일은 파일 안의 생성일(OSM) / 최근 검증일(계획)이며 없으면 null.
  const subwayFile = "public/data/osm-subway.json";
  const plannedFile = "public/data/rail/planned.json";
  const railManifestFile = "public/data/rail/manifest.json";
  const railRelease = (sourceId, file, asOf, url, prov, licenseCode, rights) => {
    const st = statSync(file);
    return insertRelease(db_, { sourceId, provider: prov, sourceUrl: url, sourceAsOf: asOf, fetchedAt: st.mtime.toISOString(), checksum: `size-mtime:${st.size}-${Math.round(st.mtimeMs)}`, licenseCode, rights });
  };
  step("rail/osm-subway", [subwayFile, railManifestFile], 0, SLOT.subway, async () => {
    const subway = JSON.parse(readFileSync(subwayFile, "utf8"));
    const railManifest = JSON.parse(readFileSync(railManifestFile, "utf8"));
    if (!core_) console.warn("⚠ core가 없어 철도 feature의 시도 코드를 (미상)으로 기록합니다");
    const generated = typeof subway.generated_at === "string" && /^\d{4}-\d{2}-\d{2}/.test(subway.generated_at) ? subway.generated_at.slice(0, 10) : null;
    return buildOsmSubway(db_, subway, railRelease("osm_subway", subwayFile, generated, "https://overpass-api.de/", "OpenStreetMap contributors(Overpass API, 기존 앱 스냅샷)", "ODbL-1.0", { attribution: subway.license ?? null, railSnapshotVersion: railManifest.snapshotVersion ?? null }), legalCodeFromCore(core_));
  });
  step("rail/planned", [plannedFile], 0, SLOT.planned, async () => {
    const planned = JSON.parse(readFileSync(plannedFile, "utf8"));
    const verified = planned.map((p) => p.lastVerifiedAt).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().at(-1) ?? null;
    return buildPlannedRail(db_, planned, railRelease("planned_rail", plannedFile, verified, "https://news.seoul.go.kr/citybuild/city_railroad", "기존 앱 계획 철도 공개 투영(공식 상태 + OSM 보조 선형)", "ODbL-1.0", { note: "선형이 OSM 공사 선형 보조(approximation)" }), legalCodeFromCore(core_));
  });

  // 점 CSV 3종
  for (const [spec, dir, re, prov, url, slot, asOfField] of [
    [STORE_SPEC, "store", /^store_.*\.csv$/i, "소상공인시장진흥공단", "https://www.data.go.kr/data/15083033/fileData.do", SLOT.store, null],
    [BUS_STOP_SPEC, "bus_stop", /^bus_stop_.*\.csv$/i, "국토교통부", "https://www.data.go.kr/data/15067528/fileData.do", SLOT.bus_stop, null],
    [PARK_SPEC, "park", /^park.*\.csv$/i, "지방자치단체(전국도시공원정보표준데이터)", "https://www.data.go.kr/data/15012890/standard.do", SLOT.park, "데이터기준일자"],
  ]) {
    const file = newest(dir, re);
    step(`${dir}/${basename(file)}`, [file], 0, slot, async () => [
      await buildPointSource(db_, spec, (await csvRecords(file)).records, release(db_, spec.sourceId, file, prov, url, "UNRESTRICTED", asOfField ? await csvDataAsOf(file, asOfField) : undefined)),
    ]);
  }

  // OSM Geofabrik free shapefile: dl.done가 있는 완성 zip만 선택 추출한다. 도로 → 녹지·수계 순.
  const osmDir = join(raw, "osm");
  const osmFind = (layer) => [...walk(osmDir)].find((file) => basename(file).toLowerCase() === `${layer}.shp`.toLowerCase()) ?? null;
  const osmArchive = () => [...walk(osmDir)].filter((file) => /\.zip$/i.test(file)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] ?? null;
  const osmAsOf = (file) => {
    const long = asOfOf(file);
    if (long) return long;
    const m = basename(file).match(/(?:^|-)(\d{2})(\d{2})(\d{2})(?:-|\.)/);
    return m ? `20${m[1]}-${m[2]}-${m[3]}` : null;
  };
  const osmMeta = (sourceId, archive, rights) => {
    const st = statSync(archive);
    return { sourceId, provider: "OpenStreetMap (Geofabrik free shapefile extract)", sourceUrl: "https://download.geofabrik.de/asia/south-korea.html", sourceAsOf: osmAsOf(archive), fetchedAt: st.mtime.toISOString(), checksum: `size-mtime:${st.size}-${Math.round(st.mtimeMs)}`, licenseCode: "ODbL-1.0", rights };
  };
  if (existsSync(osmDir)) {
    let roadsFile = osmFind(OSM_ROADS_LAYER);
    if (!roadsFile && existsSync(join(osmDir, "dl.done"))) {
      const extracted = extractSelected(osmDir, (entry) => new RegExp(`(?:^|/)${OSM_ROADS_LAYER}\\.(?:shp|dbf|prj|cpg)$`, "i").test(entry.replace(/\\/g, "/")));
      roadsFile = osmFind(OSM_ROADS_LAYER);
      console.log(`osm_roads: roads layer sidecars ${extracted.length ? "선택 추출" : "기존 추출본 사용"}`);
    }
    if (roadsFile) {
      const archive = osmArchive() ?? roadsFile;
      step(`osm_roads/${basename(roadsFile)}`, [roadsFile], dbfRecordCount(roadsFile), SLOT.roads, async () => {
        const releaseId = insertRelease(db_, osmMeta("osm_roads", archive, OSM_ROADS_RIGHTS));
        return [await buildOsmRoads(db_, readShp(roadsFile), releaseId, { legalCodeOf: legalCodeFromCore(core_) })];
      });
    } else {
      console.log(existsSync(join(osmDir, "dl.done")) ? `osm_roads: ${OSM_ROADS_LAYER}.shp 없음 — 도로 적재 건너뜀` : "osm_roads: dl.done 없음 — 다운로드 완료 후 도로 적재를 건너뜁니다");
    }

    const osmAreaLayers = [...OSM_GREEN_LAYERS, ...OSM_WATER_LAYERS];
    let areaFiles = new Map(osmAreaLayers.map((layer) => [layer, osmFind(layer)]).filter(([, file]) => file));
    if (areaFiles.size < osmAreaLayers.length && existsSync(join(osmDir, "dl.done"))) {
      // osm_roads의 선택 추출이 만든 .extracted marker가 있으면 선택 추출을 다시 허용한다(기존 도로 파일은 보존, target sidecar만 추가).
      const archive = osmArchive();
      if (archive) {
        const { unlinkSync } = await import("node:fs");
        const marker = join(osmDir, basename(archive, ".zip"), ".extracted");
        if (existsSync(marker)) unlinkSync(marker);
      }
      const extracted = extractSelected(osmDir, (entry) => new RegExp(`(?:^|/)gis_osm_(?:landuse_a|natural_a|water_a)_free_1\\.(?:shp|dbf|prj|cpg)$`, "i").test(entry.replace(/\\/g, "/")));
      areaFiles = new Map(osmAreaLayers.map((layer) => [layer, osmFind(layer)]).filter(([, file]) => file));
      console.log(`osm_landuse: area layer sidecars ${extracted.length ? "선택 추출" : "기존 추출본 사용"}`);
    } else if (areaFiles.size < osmAreaLayers.length) {
      console.log("osm_landuse: dl.done 없음 — 다운로드 완료 후 녹지·수계 적재를 건너뜁니다");
    }
    if (areaFiles.size === 0) {
      console.log("osm_landuse: 녹지·수계 면 layer 없음 — 적재 건너뜀");
    } else {
      const archive = osmArchive() ?? areaFiles.values().next().value;
      for (const [kind, sourceId, layers, slot] of [["landuse", OSM_LANDUSE_SOURCE_ID, OSM_GREEN_LAYERS, SLOT.landuse], ["water", OSM_WATER_SOURCE_ID, OSM_WATER_LAYERS, SLOT.water]]) {
        const present = layers.map((layer) => [layer, areaFiles.get(layer)]).filter(([, file]) => file);
        for (const [layer, file] of present) {
          step(`osm_${kind}/${basename(file)}`, [file], dbfRecordCount(file), slot, async () => {
            const releaseId = insertRelease(db_, osmMeta(sourceId, archive, { ...OSM_ROADS_RIGHTS, layer: present.map(([l]) => l) }));
            async function* records() {
              for await (const record of readShp(file)) yield { ...record, properties: { ...record.properties, layer } };
            }
            return [await buildOsmAreas(db_, records(), releaseId, kind)];
          });
        }
      }
    }
  }

  // 같은 지정ID가 여러 도형이면 stable id에 순번을 붙인다. 파일 단위 단계 사이에 순번 계수를 잇고, 재개 때는 DB에서 다시 센다.
  const seenCounts = new WeakMap();
  const seenFor = (name, seed) => {
    let byName = seenCounts.get(db_);
    if (!byName) seenCounts.set(db_, (byName = new Map()));
    if (!byName.has(name)) {
      const seen = new Map();
      for (const [key, n] of seed()) seen.set(key, n);
      byName.set(name, seen);
    }
    return byName.get(name);
  };
  const shpSteps = (files, slot, run) => {
    for (const file of files) step(rawRelOf(file), [file], dbfRecordCount(file), slot, () => run(file));
  };
  const rawRelOf = (file) => relative(raw, file).replaceAll("\\", "/");

  // 용도지역(VWorld dsId 24, 레이어별 전국 SHP): 필지 점과 갱신 주기가 달라 core가 아니라 reference에 둔다.
  if (existsSync(join(raw, "zoning"))) {
    extractAll(join(raw, "zoning"));
    const found = zoningLayerFiles([...walk(join(raw, "zoning"))]);
    const missing = ZONING_LAYERS.filter((l) => !found.has(l.key)).map((l) => l.title);
    if (missing.length > 0) throw new Error(`용도지역 레이어 없음: ${missing.join(", ")} — vworld:fetch -- --ds 24 로 받으세요`);
    for (const [i, l] of ZONING_LAYERS.entries()) {
      const set = found.get(l.key);
      shpSteps(set.files, SLOT.zoning + i, async (file) => {
        const st = statSync(set.files[0]);
        const d = set.date;
        const releaseId = insertRelease(db_, {
          sourceId: l.sourceId,
          provider: "국토교통부(VWorld 일별용도지역지구정보)",
          sourceUrl: "https://www.vworld.kr/dtmk/dtmk_ntads_s002.do?svcCde=NA&dsId=24",
          sourceAsOf: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
          fetchedAt: st.mtime.toISOString(),
          checksum: `size-mtime:${st.size}-${Math.round(st.mtimeMs)}`,
          licenseCode: "UNRESTRICTED",
          rights: { ...ZONING_RIGHTS, layer: l.title },
        });
        const seen = seenFor("zoning", () => seedZoningSeen(db_));
        return buildZoning(db_, [{ layer: l.key, releaseId, records: readShp(file) }], seen);
      });
    }
  }

  // 개별공시지가(VWorld dsId 6, 시도별 CSV): raw/land_price가 있을 때만(없으면 건너뜀). 시도 파일마다 한 단계.
  if (existsSync(join(raw, "land_price"))) {
    extractAll(join(raw, "land_price"));
    const sets = latestLandPricePerSido([...walk(join(raw, "land_price"))]);
    if (sets.size === 0) throw new Error("개별공시지가 CSV 없음 — vworld:fetch -- --ds 6 으로 받으세요");
    const list = [...sets.entries()].sort(([a], [b]) => a.localeCompare(b));
    for (const [sido, v] of list) {
      step(rawRelOf(v.file), [v.file], 0, SLOT.land_price, async () => {
        const d = list.map(([, x]) => x.date).sort()[0];
        const size = list.reduce((a, [, x]) => a + statSync(x.file).size, 0);
        const mtime = Math.max(...list.map(([, x]) => statSync(x.file).mtimeMs));
        const releaseId = insertRelease(db_, {
          sourceId: "land_price",
          provider: "국토교통부(VWorld 개별공시지가정보)",
          sourceUrl: "https://www.vworld.kr/dtmk/dtmk_ntads_s002.do?svcCde=NA&dsId=6",
          sourceAsOf: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
          fetchedAt: new Date(mtime).toISOString(),
          checksum: `size-mtime:${size}-${Math.round(mtime)}`,
          licenseCode: "UNRESTRICTED",
          rights: LAND_PRICE_RIGHTS,
        });
        async function* rows() {
          yield* (await csvRecords(v.file)).records;
        }
        // core가 있으면 옛 코드(29·46 → 12, 인천 구 분할)를 현재 코드로 옮겨 저장한다. expectedRegions도 저장 코드로 바뀐다
        return [await buildLandPrice(db_, rows(), releaseId, [sido], core_)];
      });
    }
  }

  // 정비구역 경계(VWorld dsId 24 정비 5개 레이어) + 정비사업 명부 매칭: 폴더가 없으면 건너뛴다. 레이어마다 한 단계, 명부 매칭은 마지막 단계.
  if (existsSync(join(raw, "maintenance_zone"))) {
    extractAll(join(raw, "maintenance_zone"));
    const found = mzoneLayerFiles([...walk(join(raw, "maintenance_zone"))]);
    const missing = MZONE_LAYERS.filter((l) => !found.has(l.key)).map((l) => l.title);
    if (missing.length > 0) throw new Error(`정비구역 레이어 없음: ${missing.join(", ")} — vworld:fetch -- --ds 24 로 받으세요`);
    for (const l of MZONE_LAYERS) {
      const set = found.get(l.key);
      step(`maintenance_zone/${l.key}`, set.files, set.files.reduce((a, f) => a + dbfRecordCount(f), 0), SLOT.mzone, async () => {
        const st = statSync(set.files[0]);
        const d = set.date;
        const releaseId = insertRelease(db_, {
          sourceId: l.sourceId,
          provider: "국토교통부(VWorld 일별용도지역지구정보)",
          sourceUrl: "https://www.vworld.kr/dtmk/dtmk_ntads_s002.do?svcCde=NA&dsId=24",
          sourceAsOf: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
          fetchedAt: st.mtime.toISOString(),
          checksum: `size-mtime:${st.size}-${Math.round(st.mtimeMs)}`,
          licenseCode: "UNRESTRICTED",
          rights: { ...MZONE_RIGHTS, layer: l.title },
        });
        return loadMaintenanceZones(db_, [{ layer: l.key, releaseId, records: chain(...set.files.map((f) => readShp(f))) }]);
      });
    }
    // 명부: 정비사업 CSV를 임시 메모리 DB에 적재해 사업 id·이름을 그대로 얻는다(market 파일과 같은 id). 명부나 core가 없으면 폴리곤만 적재.
    // 멱등(INSERT OR IGNORE + 같은 UPDATE)이라 트랜잭션으로 감싸지 않는다 — linkZones가 스스로 BEGIN/COMMIT 한다.
    const rosterFiles = existsSync(join(raw, "maintenance")) ? [newest("maintenance", /^maintenance-integrated-.*\.csv$/i), newest("maintenance", /^maintenance-std-.*\.csv$/i)] : [];
    step("maintenance_zone/link", rosterFiles.length ? rosterFiles : [join(raw, "maintenance_zone")], 0, SLOT.mzone, async (prior) => {
      let roster;
      if (core_ && rosterFiles.length) {
        const { default: Database } = await import("better-sqlite3");
        const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
        const { buildMaintenance } = await import("../../lib/v2/ingest/sources/maintenance.ts");
        const scratch = new Database(":memory:");
        initDataFileSchema(scratch, "market");
        const [integratedFile, stdFile] = rosterFiles;
        const p = "국토교통부·지방자치단체(도시정비사업)";
        await buildMaintenance(scratch, {
          integrated: (await csvRecords(integratedFile)).records,
          integratedReleaseId: release(scratch, "maintenance_integrated", integratedFile, p, "", "UNRESTRICTED"),
          std: (await csvRecords(stdFile)).records,
          stdReleaseId: release(scratch, "maintenance_std", stdFile, p, "", "UNRESTRICTED"),
        });
        const projects = scratch.prepare("SELECT coverage_json FROM source_release").pluck().all().flatMap((c) => JSON.parse(c).projects ?? []);
        scratch.close();
        roster = { projects, sigungu: sigunguIndexFromCore(core_) };
      }
      finishMaintenanceZones(db_, prior.filter((s) => MZONE_LAYERS.some((l) => l.sourceId === s.sourceId)), roster);
      return [];
    }, { atomic: false });
  }

  // SGIS 1 km 인구·가구 격자: .cache/v2/raw/sgis_grid 폴더가 있고 CSV가 풀려 있을 때만. 시도는 core 시군구 경계로 판정한다.
  if (existsSync(sgisDir)) {
    let year = sgisDataYear(sgisDir);
    if (!year) {
      extractAll(sgisDir);
      year = sgisDataYear(sgisDir);
    }
    if (!year) {
      console.log("sgis_grid: 통계 CSV 없음 — 격자 적재 건너뜀");
    } else {
      const zip = join(sgisDir, "sgis_grid.zip");
      const src = existsSync(zip) ? zip : sgisDir;
      step("sgis_grid", [src], 0, SLOT.sgis, async () => {
        const st = statSync(src);
        const releaseId = insertRelease(db_, {
          sourceId: "sgis_grid",
          provider: "국가데이터처(SGIS 격자 통계, 공공데이터포털)",
          sourceUrl: "https://www.data.go.kr/data/15141768/fileData.do",
          sourceAsOf: year,
          fetchedAt: st.mtime.toISOString(),
          checksum: `size-mtime:${st.size}-${Math.round(st.mtimeMs)}`,
          licenseCode: "UNRESTRICTED",
          rights: { note: "이용허락범위 제한 없음(A0 표 8행)", disclosure: "5 미만 값은 0 또는 5로 확률 대체, 그 이상은 최대 ±7 노이즈, 총괄 항목 일부 N/A(비공개)" },
        });
        if (!core_) console.warn("⚠ core가 없어 격자의 시도 코드를 (미상)으로 기록합니다");
        return [await buildPopGrid(db_, { rows: sgisRows(sgisDir), releaseId, dataYear: year, locate: locateSigunguFromCore(core_) })];
      });
    }
  }

  // D11·D12 구역·지구·도시계획시설: Q1 레이어 표가 확정되고 raw/districts가 있을 때만. 레이어의 파일마다 한 단계.
  if (existsSync(districtsDir)) {
    extractAll(districtsDir);
    if (DISTRICT_LAYERS.length === 0) {
      console.log("districts: Q1 레이어 제목이 확정되지 않아 적재를 건너뜁니다");
    } else {
      const found = districtLayerFiles([...walk(districtsDir)]);
      const missing = DISTRICT_LAYERS.filter((l) => !found.has(l.key)).map((l) => l.title || l.key);
      if (missing.length > 0) throw new Error(`구역·지구·도시계획시설 레이어 없음: ${missing.join(", ")} — vworld:fetch -- --ds 24 --folder districts 로 받으세요`);
      for (const [i, l] of DISTRICT_LAYERS.entries()) {
        const set = found.get(l.key);
        shpSteps(set.files, SLOT.districts + i, async (file) => {
          const st = statSync(set.files[0]);
          const d = set.date;
          const releaseId = insertRelease(db_, {
            sourceId: l.sourceId,
            provider: "국토교통부(VWorld 일별용도지역지구정보)",
            sourceUrl: "https://www.vworld.kr/dtmk/dtmk_ntads_s002.do?svcCde=NA&dsId=24",
            sourceAsOf: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
            fetchedAt: st.mtime.toISOString(),
            checksum: `size-mtime:${st.size}-${Math.round(st.mtimeMs)}`,
            licenseCode: "UNRESTRICTED",
            rights: { ...DISTRICT_RIGHTS, layer: l.title || l.key, cls: l.cls, kind: l.kind },
          });
          const seen = seenFor("districts", () => seedDistrictSeen(db_));
          return buildDistricts(db_, [{ layer: l, releaseId, records: readShp(file) }], seen);
        });
      }
    }
  }

  const referenceProgress = progressSpec("reference", "reference", steps.map((s) => s.file), { steps: steps.map((s) => s.file.path) });
  progress.reference = referenceProgress;
  builders.reference = async (db, ctx) => {
    db_ = db;
    core_ = ctx.core;
    return buildResumableSteps(db, referenceProgress, steps);
  };
}

const started = Date.now();
const out = await buildAndPublish({ dataDir, version, builders, progress, resume, expectations, resetBaseline, logFile: opt("log") });
for (const [kind, list] of Object.entries(out.stats)) {
  for (const s of list) {
    const located = s.accepted + s.unlocated === 0 ? "-" : `${((100 * s.accepted) / (s.accepted + s.unlocated)).toFixed(1)}%`;
    console.log(`${kind.padEnd(9)} ${s.sourceId.padEnd(24)} read ${s.received} · ok ${s.accepted} · unlocated ${s.unlocated} · rejected ${s.rejected} · located ${located}`);
  }
}
for (const id of out.baselineReset) console.log(`baseline reset: ${id}`);
console.log(out.published ? `published ${out.hash.slice(0, 12)} (${((Date.now() - started) / 60000).toFixed(1)} min)` : "NOT published:");
for (const f of out.failures) console.log(`  ${f.code} ${f.detail}`);
process.exit(out.published ? 0 : 1);
