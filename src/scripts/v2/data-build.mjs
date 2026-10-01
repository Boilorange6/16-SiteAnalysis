/**
 * v2 데이터 파일 빌드·게시.
 *   npm run data:build -- --version 2026-09-30a [--raw .cache/v2/raw] [--only core,buildings,parcels,reference,market,terrain] [--expectations exp.json] [--with buildings,parcels] [--wait-lock [분]]
 * 원천 zip은 먼저 풀고(이미 풀린 것은 건너뜀), 원천 파일은 폴더마다 가장 새 파일을 쓴다.
 */
import { readdirSync, statSync, existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

const { extractAll, extractSelected } = await import("../../lib/v2/ingest/unzip.ts");
const { latestShpPerSido, partCounts } = await import("../../lib/v2/ingest/shp-parts.ts");
const { readShp, readShpPoints } = await import("../../lib/v2/ingest/shp.ts");
const { csvRecords } = await import("../../lib/v2/a0/measure.ts");
const { buildAndPublish, insertRelease } = await import("../../lib/v2/ingest/build.ts");
const { buildParcelPoints } = await import("../../lib/v2/ingest/sources/parcels.ts");
const { buildParcelPolygons } = await import("../../lib/v2/ingest/sources/parcel-polygons.ts");
const { buildBuildings } = await import("../../lib/v2/ingest/sources/buildings.ts");
const { buildLegalAreas } = await import("../../lib/v2/ingest/sources/legal-areas.ts");
const { buildLedger } = await import("../../lib/v2/ingest/sources/ledger.ts");
const { buildPointSource, STORE_SPEC, BUS_STOP_SPEC, PARK_SPEC } = await import("../../lib/v2/ingest/sources/points.ts");
const { buildSupply, readLegacyPlannedHousing } = await import("../../lib/v2/ingest/sources/supply.ts");
const { buildOsmSubway, buildPlannedRail, legalCodeFromCore } = await import("../../lib/v2/ingest/sources/rail.ts");
const { buildOsmRoads, OSM_ROADS_LAYER, OSM_ROADS_RIGHTS } = await import("../../lib/v2/ingest/sources/osm-roads.ts");
const { buildDemTiles } = await import("../../lib/v2/ingest/sources/dem.ts");
const { legacyDbPath, v2DataDir } = await import("../../lib/v2/paths.ts");

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const version = opt("version");
if (!version || !/^[0-9A-Za-z._-]+$/.test(version)) {
  console.error("usage: data:build -- --version <name> [--raw dir] [--only core,buildings,parcels,reference,market,terrain] [--expectations file.json] [--reset-baseline parcel,parcel_building] [--dry-run]");
  process.exit(2);
}
const flag = (name) => args.includes(`--${name}`);
const raw = opt("raw", ".cache/v2/raw");
const only = new Set(String(opt("only", "core,reference,market")).split(","));
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
const release = (db, sourceId, file, provider, sourceUrl, licenseCode) => {
  const st = statSync(file);
  // ponytail: 수 GB 원천의 SHA-256 대신 크기·수정시각 — 원천 무결성 검증이 필요해지면 스트리밍 해시로 바꾼다
  return insertRelease(db, { sourceId, provider, sourceUrl, sourceAsOf: asOfOf(file), fetchedAt: st.mtime.toISOString(), checksum: `size-mtime:${st.size}-${Math.round(st.mtimeMs)}`, licenseCode });
};
async function* chain(...gens) {
  for (const g of gens) yield* g;
}

if (waitLockMin !== null && !flag("dry-run")) {
  const { waitForDataDirLock } = await import("../../lib/v2/data/manifest.ts");
  if (!(await waitForDataDirLock(v2DataDir(), { timeoutMs: waitLockMin * 60_000 }))) {
    console.error(`data dir still locked after ${waitLockMin} min — giving up`);
    process.exit(3);
  }
}

console.log("unzip:", extractAll(join(raw, "legal_dong")).length + extractAll(join(raw, "cadastral")).length + extractAll(join(raw, "gis_building")).length, "archive(s)");

/** 세트들 중 가장 오래된 날짜의 첫 파일(릴리스 기준일용) */
const oldestFile = (sets) => [...sets.values()].sort((a, b) => a.date.localeCompare(b.date))[0].files[0];
const flat = (sets) => [...sets.values()].flatMap((v) => v.files);

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
      async function* buildingAsParcels(file) {
        for await (const r of readShpPoints(file)) yield { properties: { A1: r.properties.A2, A5: null }, point: r.point };
      }
      const pb = await buildParcelPoints(db, chain(...flat(buildings).map(buildingAsParcels)), buildingRel, "parcel_building");
      pb.expectedRegions = [...buildings.keys()];
      parcels.push(pb);
    }
    const recapFile = newest("ledger_recap", /^recap_.*\.csv$/i);
    if (!hasNationalTitle) console.warn("⚠ 전국 표제부(title_YYYYMM.csv)가 없어 5개 시도 표제부로 적재합니다 — 오피스텔·단일동 커버리지 일부");
    const ledger = await buildLedger(db, {
      recapReleaseId: release(db, "ledger_recap", recapFile, "국토교통부 건축HUB", "https://www.hub.go.kr/portal/opn/lps/idx-lgcpt-pvsn-srvc-list.do", "UNRESTRICTED"),
      titleReleaseId: release(db, "ledger_title", titleFile, "국토교통부 건축HUB", "https://www.hub.go.kr/portal/opn/lps/idx-lgcpt-pvsn-srvc-list.do", "UNRESTRICTED"),
      recap: (await csvRecords(recapFile)).records,
      title: (await csvRecords(titleFile)).records,
    });
    return [...legal, ...parcels, ...ledger];
  };
}
if (only.has("buildings")) {
  // 건물 도형: 받은 모든 시도의 GIS건물통합정보. 시도 하나라도 없으면 있는 시도만 적재하고 그 사실을 알린다.
  // 이 빌더는 현재 core를 건드리지 않는다(ctx.core는 읽기 전용으로 전달됨) — --only buildings는 매니페스트의 core를 그대로 재사용한다.
  builders.buildings = async (db) => {
    const buildingAll = latestShpPerSido([...walk(join(raw, "gis_building"))], "AL_D010");
    if (buildingAll.size === 0) throw new Error("GIS건물(gis_building) 파일이 없습니다 — vworld:fetch로 받으세요");
    const rel = release(db, "building", oldestFile(buildingAll), "국토교통부(VWorld GIS건물통합정보)", "https://www.vworld.kr/dtmk/dtmk_ntads_s002.do?svcCde=NA&dsId=18", "CC-BY");
    const b = await buildBuildings(db, chain(...flat(buildingAll).map((f) => readShp(f))), rel);
    b.expectedRegions = [...buildingAll.keys()];
    console.log(`buildings: 시도 ${partCounts(buildingAll)}`);
    return [b];
  };
}
if (only.has("parcels")) {
  // 연속지적 도형은 core의 대표점과 별도 게시한다. 시도별 최신 파트만 골라 첫 PNU를 유지한다.
  builders.parcels = async (db) => {
    const parcelAll = latestShpPerSido([...walk(join(raw, "cadastral"))], "AL_D002");
    if (parcelAll.size === 0) throw new Error("연속지적도(cadastral) 파일이 없습니다 — vworld:fetch로 받으세요");
    const rel = release(db, "parcel_polygon", oldestFile(parcelAll), "국토교통부(VWorld 연속지적도형정보)", "https://www.vworld.kr/dtmk/dtmk_ntads_s002.do?svcCde=NA&dsId=23", "CC-BY");
    const p = await buildParcelPolygons(db, chain(...flat(parcelAll).map((f) => readShp(f))), rel);
    p.expectedRegions = [...parcelAll.keys()];
    console.log(`parcels: 시도 ${partCounts(parcelAll)}`);
    return [p];
  };
}
if (only.has("terrain")) {
  const demDir = join(raw, "dem");
  const demFiles = [...walk(demDir)].filter((file) => /\.hgt(?:\.gz)?$/i.test(basename(file))).sort();
  if (demFiles.length === 0) throw new Error(`no DEM HGT files under ${demDir} — run dem-fetch.mjs first`);
  builders.terrain = async (db) => {
    const stats = demFiles.map((file) => statSync(file));
    const fetchedAt = new Date(Math.max(...stats.map((s) => s.mtimeMs))).toISOString();
    const checksum = demFiles.map((file, i) => `${basename(file)}:${stats[i].size}-${Math.round(stats[i].mtimeMs)}`).join("|");
    const releaseId = insertRelease(db, {
      sourceId: "terrain_tiles",
      provider: "Mapzen/AWS Terrain Tiles (SRTM 1 arc-second)",
      sourceUrl: "https://registry.opendata.aws/terrain-tiles/",
      sourceAsOf: null,
      fetchedAt,
      checksum,
      licenseCode: "attribution",
      rights: { attribution: "Terrain Tiles: SRTM(NASA/USGS), GMTED2010, ETOPO1 — https://github.com/tilezen/joerd/blob/master/docs/attribution.md" },
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
  const stations = readStationCsv(decodeText(readFileSync(stationFile)).text);
  if (stations.length === 0) throw new Error(`ASOS 지점 메타 파일에 유효한 지점이 없습니다: ${stationFile}`);
  const period = { start: opt("period-start", "2016-01-01"), end: opt("period-end", "2025-12-31") };
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
          yield { stnId: String(row.stnId ?? ""), tm: String(row.tm ?? ""), ws: numberOrNull(row.ws), wd: numberOrNull(row.wd) };
        }
      }
    }
    return [await buildAsosWind(db, stations, rows(), releaseId, period)];
  };
}
if (only.has("reference")) {
  builders.reference = async (db, ctx) => {
    // 철도: v1이 이미 가진 공개 파일. 기준일은 파일 안의 생성일(OSM) / 최근 검증일(계획)이며 없으면 null.
    const subwayFile = "public/data/osm-subway.json";
    const plannedFile = "public/data/rail/planned.json";
    const subway = JSON.parse(readFileSync(subwayFile, "utf8"));
    const planned = JSON.parse(readFileSync(plannedFile, "utf8"));
    const railManifest = JSON.parse(readFileSync("public/data/rail/manifest.json", "utf8"));
    const railRelease = (sourceId, file, asOf, url, provider, licenseCode, rights) => {
      const st = statSync(file);
      return insertRelease(db, { sourceId, provider, sourceUrl: url, sourceAsOf: asOf, fetchedAt: st.mtime.toISOString(), checksum: `size-mtime:${st.size}-${Math.round(st.mtimeMs)}`, licenseCode, rights });
    };
    const generated = typeof subway.generated_at === "string" && /^\d{4}-\d{2}-\d{2}/.test(subway.generated_at) ? subway.generated_at.slice(0, 10) : null;
    const verified = planned.map((p) => p.lastVerifiedAt).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().at(-1) ?? null;
    const legalCodeOf = legalCodeFromCore(ctx.core);
    if (!ctx.core) console.warn("⚠ core가 없어 철도 feature의 시도 코드를 (미상)으로 기록합니다");
    const rail = [
      ...(await buildOsmSubway(db, subway, railRelease("osm_subway", subwayFile, generated, "https://overpass-api.de/", "OpenStreetMap contributors(Overpass API, 기존 앱 스냅샷)", "ODbL-1.0", { attribution: subway.license ?? null, railSnapshotVersion: railManifest.snapshotVersion ?? null }), legalCodeOf)),
      ...(await buildPlannedRail(db, planned, railRelease("planned_rail", plannedFile, verified, "https://news.seoul.go.kr/citybuild/city_railroad", "기존 앱 계획 철도 공개 투영(공식 상태 + OSM 보조 선형)", "ODbL-1.0", { note: "선형이 OSM 공사 선형 보조(approximation)" }), legalCodeOf)),
    ];
    const one = async (spec, dir, re, provider, url) => {
      const file = newest(dir, re);
      return buildPointSource(db, spec, (await csvRecords(file)).records, release(db, spec.sourceId, file, provider, url, "UNRESTRICTED"));
    };
    return [
      await one(STORE_SPEC, "store", /^store_.*\.csv$/i, "소상공인시장진흥공단", "https://www.data.go.kr/data/15083033/fileData.do"),
      await one(BUS_STOP_SPEC, "bus_stop", /^bus_stop_.*\.csv$/i, "국토교통부", "https://www.data.go.kr/data/15067528/fileData.do"),
      await one(PARK_SPEC, "park", /^park.*\.csv$/i, "지방자치단체(전국도시공원정보표준데이터)", "https://www.data.go.kr/data/15012890/standard.do"),
      ...rail,
    ];
  };
}

// OSM Geofabrik free shapefile(reference): dl.done이 있는 완성 zip만 선택 추출하고 도로 layer만 적재한다.
const osmDir = join(raw, "osm");
const osmRoadShp = () => [...walk(osmDir)].find((file) => basename(file).toLowerCase() === `${OSM_ROADS_LAYER}.shp`.toLowerCase()) ?? null;
const osmArchive = () => [...walk(osmDir)].filter((file) => /\.zip$/i.test(file)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] ?? null;
const osmAsOf = (file) => {
  const long = asOfOf(file);
  if (long) return long;
  const m = basename(file).match(/(?:^|-)(\d{2})(\d{2})(\d{2})(?:-|\.)/);
  return m ? `20${m[1]}-${m[2]}-${m[3]}` : null;
};
if (builders.reference && existsSync(osmDir)) {
  const base = builders.reference;
  builders.reference = async (db, ctx) => {
    const built = await base(db, ctx);
    let roadsFile = osmRoadShp();
    if (!roadsFile) {
      if (!existsSync(join(osmDir, "dl.done"))) {
        console.log("osm_roads: dl.done 없음 — 다운로드 완료 후 도로 적재를 건너뜁니다");
        return built;
      }
      const extracted = extractSelected(osmDir, (entry) => new RegExp(`(?:^|/)${OSM_ROADS_LAYER}\\.(?:shp|dbf|prj|cpg)$`, "i").test(entry.replace(/\\/g, "/")));
      roadsFile = osmRoadShp();
      console.log(`osm_roads: roads layer sidecars ${extracted.length ? "선택 추출" : "기존 추출본 사용"}`);
    }
    if (!roadsFile) {
      console.log(`osm_roads: ${OSM_ROADS_LAYER}.shp 없음 — 도로 적재 건너뜀`);
      return built;
    }
    const archive = osmArchive() ?? roadsFile;
    const st = statSync(archive);
    const releaseId = insertRelease(db, {
      sourceId: "osm_roads",
      provider: "OpenStreetMap (Geofabrik free shapefile extract)",
      sourceUrl: "https://download.geofabrik.de/asia/south-korea.html",
      sourceAsOf: osmAsOf(archive),
      fetchedAt: st.mtime.toISOString(),
      checksum: `size-mtime:${st.size}-${Math.round(st.mtimeMs)}`,
      licenseCode: "ODbL-1.0",
      rights: OSM_ROADS_RIGHTS,
    });
    const stats = await buildOsmRoads(db, readShp(roadsFile), releaseId, { legalCodeOf: legalCodeFromCore(ctx.core) });
    return [...built, stats];
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
        stdReleaseId: release(db, "maintenance_std", stdFile, provider, "https://www.data.go.kr/data/15155703/standard.do", "UNRESTRICTED"),
      })),
    ];
  };
}

// 학교·학구 연계(reference)와 K-APT 단지(core): 기존 builder 뒤에 이어 붙인다.
const { buildKapt, buildSchoolZoneLinks, SCHOOL_SPEC, SCHOOL_ZONE_COVERAGE } = await import("../../lib/v2/ingest/sources/school-kapt.ts");
const { buildSchoolZones, readSchoolZoneGeoJson, SCHOOL_ZONE_LAYERS, SCHOOL_ZONE_RIGHTS, SCHOOL_ZONE_SOURCE_ID } = await import("../../lib/v2/ingest/sources/school-zones.ts");
if (builders.reference) {
  const base = builders.reference;
  builders.reference = async (db, ctx) => {
    const schoolFile = newest("school", /^school-location.*\.csv$/i);
    const linkFile = newest("school_zone", /^school-zone-link.*\.csv$/i);
    const elemFile = newest("school_zone", /^school-zone-elem.*\.csv$/i);
    const provider = "한국교육시설안전원";
    const school = await buildPointSource(db, SCHOOL_SPEC, (await csvRecords(schoolFile)).records, release(db, "school", schoolFile, provider, "https://www.data.go.kr/data/15021148/standard.do", "UNRESTRICTED"));
    const linkRel = release(db, "school_zone_link", linkFile, provider, "https://www.data.go.kr/data/15021158/standard.do", "UNRESTRICTED");
    const elemRel = release(db, "school_zone_elem", elemFile, provider, "https://www.data.go.kr/data/15021149/standard.do", "UNRESTRICTED");
    const vworldDir = join(raw, "school_zone", "vworld");
    const vworldFiles = SCHOOL_ZONE_LAYERS.map((layer) => ({ layer, file: join(vworldDir, `${layer.apiLayer}.geojson`) }));
    const haveVworld = vworldFiles.every(({ file }) => existsSync(file));
    let zoneRelease = null;
    let zoneStats = [];
    let zoneIds = null;
    if (haveVworld) {
      const done = vworldFiles.map(({ file }) => {
        try { return JSON.parse(readFileSync(`${file}.done.json`, "utf8")); } catch { return {}; }
      });
      const baseDates = done.flatMap((d) => Array.isArray(d.base_dates) ? d.base_dates : typeof d.base_dt === "string" ? [d.base_dt] : []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
      const files = vworldFiles.map(({ file }) => statSync(file));
      const sourceAsOf = baseDates.at(-1) ?? null;
      const fetchedAt = new Date(Math.max(...files.map((st) => st.mtimeMs))).toISOString();
      const checksum = vworldFiles.map(({ file }, i) => `${basename(file)}:${files[i].size}-${Math.round(files[i].mtimeMs)}`).join("|");
      zoneRelease = insertRelease(db, {
        sourceId: SCHOOL_ZONE_SOURCE_ID,
        provider: "국토교통부(VWorld Data API 학교 학구도·학교군)",
        sourceUrl: "https://api.vworld.kr/req/data",
        sourceAsOf,
        fetchedAt,
        checksum,
        licenseCode: "UNRESTRICTED",
        rights: SCHOOL_ZONE_RIGHTS,
      });
      zoneStats = await buildSchoolZones(db, vworldFiles.map(({ layer, file }) => ({ layer: layer.key, releaseId: zoneRelease, records: readSchoolZoneGeoJson(file) })));
      zoneIds = new Set(db.prepare("SELECT stable_id FROM feature WHERE kind IN ('school_zone_elem', 'school_zone_middle', 'school_zone_high')").pluck().all());
      const totalRows = zoneStats.reduce((n, s) => n + s.received, 0);
      const totalFeatures = zoneStats.reduce((n, s) => n + s.accepted, 0);
      db.prepare("UPDATE source_release SET rights_json = ?, coverage_json = ? WHERE release_id = ?").run(
        JSON.stringify(SCHOOL_ZONE_RIGHTS),
        JSON.stringify({ polygons: true, layers: vworldFiles.map(({ layer }) => layer.apiLayer), features: totalFeatures, rows: totalRows }),
        zoneRelease,
      );
      console.log(`school_zone: VWorld polygons ${totalFeatures.toLocaleString()} features / ${totalRows.toLocaleString()} rows`);
    } else {
      console.log("school_zone: VWorld GeoJSON 3종이 모두 없어 폴리곤 적재를 건너뜁니다");
    }
    const csvCoverage = { ...SCHOOL_ZONE_COVERAGE, polygons: zoneIds !== null, polygonSource: zoneIds !== null ? "school_zone" : null };
    for (const rel of [linkRel, elemRel]) db.prepare("UPDATE source_release SET coverage_json = ? WHERE release_id = ?").run(JSON.stringify(csvCoverage), rel);
    const zones = await buildSchoolZoneLinks(db, { link: (await csvRecords(linkFile)).records, elem: (await csvRecords(elemFile)).records, linkReleaseId: linkRel, elemReleaseId: elemRel, zoneIds });
    return [...(await base(db, ctx)), school, ...zoneStats, ...zones];
  };
}
// 용도지역(VWorld dsId 24, 레이어별 전국 SHP): 필지 점과 갱신 주기가 달라 core가 아니라 reference에 둔다.
const { buildZoning, zoningLayerFiles, ZONING_LAYERS, ZONING_RIGHTS } = await import("../../lib/v2/ingest/sources/zoning.ts");
if (builders.reference && existsSync(join(raw, "zoning"))) {
  const base = builders.reference;
  builders.reference = async (db, ctx) => {
    const built = await base(db, ctx);
    extractAll(join(raw, "zoning"));
    const found = zoningLayerFiles([...walk(join(raw, "zoning"))]);
    const missing = ZONING_LAYERS.filter((l) => !found.has(l.key)).map((l) => l.title);
    if (missing.length > 0) throw new Error(`용도지역 레이어 없음: ${missing.join(", ")} — vworld:fetch -- --ds 24 로 받으세요`);
    const layers = ZONING_LAYERS.map((l) => {
      const set = found.get(l.key);
      const st = statSync(set.files[0]);
      const d = set.date;
      const releaseId = insertRelease(db, {
        sourceId: l.sourceId,
        provider: "국토교통부(VWorld 일별용도지역지구정보)",
        sourceUrl: "https://www.vworld.kr/dtmk/dtmk_ntads_s002.do?svcCde=NA&dsId=24",
        sourceAsOf: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
        fetchedAt: st.mtime.toISOString(),
        checksum: `size-mtime:${st.size}-${Math.round(st.mtimeMs)}`,
        licenseCode: "UNRESTRICTED",
        rights: { ...ZONING_RIGHTS, layer: l.title },
      });
      return { layer: l.key, releaseId, records: chain(...set.files.map((f) => readShp(f))) };
    });
    return [...built, ...(await buildZoning(db, layers))];
  };
}
// 개별공시지가(VWorld dsId 6, 시도별 CSV): raw/land_price가 있을 때만 reference에 이어 붙인다(없으면 건너뜀).
const { buildLandPrice, latestLandPricePerSido, LAND_PRICE_RIGHTS } = await import("../../lib/v2/ingest/sources/land-price.ts");
if (builders.reference && existsSync(join(raw, "land_price"))) {
  const base = builders.reference;
  builders.reference = async (db, ctx) => {
    const built = await base(db, ctx);
    extractAll(join(raw, "land_price"));
    const sets = latestLandPricePerSido([...walk(join(raw, "land_price"))]);
    if (sets.size === 0) throw new Error("개별공시지가 CSV 없음 — vworld:fetch -- --ds 6 으로 받으세요");
    const list = [...sets.entries()].sort(([a], [b]) => a.localeCompare(b));
    const d = list.map(([, v]) => v.date).sort()[0];
    const size = list.reduce((a, [, v]) => a + statSync(v.file).size, 0);
    const mtime = Math.max(...list.map(([, v]) => statSync(v.file).mtimeMs));
    const releaseId = insertRelease(db, {
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
      for (const [, v] of list) yield* (await csvRecords(v.file)).records;
    }
    // core가 있으면 옛 코드(29·46 → 12, 인천 구 분할)를 현재 코드로 옮겨 저장한다. expectedRegions도 저장 코드로 바뀐다
    return [...built, await buildLandPrice(db, rows(), releaseId, list.map(([k]) => k), ctx.core)];
  };
}

// 정비구역 경계(VWorld dsId 24 정비 5개 레이어) + 정비사업 명부 매칭: 폴더가 없으면 건너뛴다. 날짜 폴더 아래(maintenance_zone/YYYY-MM-DD/x)에 풀려 있다.
const { buildMaintenanceZones, mzoneLayerFiles, sigunguIndexFromCore, MZONE_LAYERS, MZONE_RIGHTS } = await import("../../lib/v2/ingest/sources/maintenance-zone.ts");
if (builders.reference && existsSync(join(raw, "maintenance_zone"))) {
  const base = builders.reference;
  builders.reference = async (db, ctx) => {
    const built = await base(db, ctx);
    extractAll(join(raw, "maintenance_zone"));
    const found = mzoneLayerFiles([...walk(join(raw, "maintenance_zone"))]);
    const missing = MZONE_LAYERS.filter((l) => !found.has(l.key)).map((l) => l.title);
    if (missing.length > 0) throw new Error(`정비구역 레이어 없음: ${missing.join(", ")} — vworld:fetch -- --ds 24 로 받으세요`);
    const layers = MZONE_LAYERS.map((l) => {
      const set = found.get(l.key);
      const st = statSync(set.files[0]);
      const d = set.date;
      const releaseId = insertRelease(db, {
        sourceId: l.sourceId,
        provider: "국토교통부(VWorld 일별용도지역지구정보)",
        sourceUrl: "https://www.vworld.kr/dtmk/dtmk_ntads_s002.do?svcCde=NA&dsId=24",
        sourceAsOf: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
        fetchedAt: st.mtime.toISOString(),
        checksum: `size-mtime:${st.size}-${Math.round(st.mtimeMs)}`,
        licenseCode: "UNRESTRICTED",
        rights: { ...MZONE_RIGHTS, layer: l.title },
      });
      return { layer: l.key, releaseId, records: chain(...set.files.map((f) => readShp(f))) };
    });
    // 명부: 정비사업 CSV를 임시 메모리 DB에 적재해 사업 id·이름을 그대로 얻는다(market 파일과 같은 id). 명부나 core가 없으면 폴리곤만 적재.
    let roster;
    if (ctx.core && existsSync(join(raw, "maintenance"))) {
      const { default: Database } = await import("better-sqlite3");
      const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
      const { buildMaintenance } = await import("../../lib/v2/ingest/sources/maintenance.ts");
      const scratch = new Database(":memory:");
      initDataFileSchema(scratch, "market");
      const integratedFile = newest("maintenance", /^maintenance-integrated-.*\.csv$/i);
      const stdFile = newest("maintenance", /^maintenance-std-.*\.csv$/i);
      const p = "국토교통부·지방자치단체(도시정비사업)";
      await buildMaintenance(scratch, {
        integrated: (await csvRecords(integratedFile)).records,
        integratedReleaseId: release(scratch, "maintenance_integrated", integratedFile, p, "", "UNRESTRICTED"),
        std: (await csvRecords(stdFile)).records,
        stdReleaseId: release(scratch, "maintenance_std", stdFile, p, "", "UNRESTRICTED"),
      });
      const projects = scratch.prepare("SELECT coverage_json FROM source_release").pluck().all().flatMap((c) => JSON.parse(c).projects ?? []);
      scratch.close();
      roster = { projects, sigungu: sigunguIndexFromCore(ctx.core) };
    }
    return [...built, ...(await buildMaintenanceZones(db, layers, roster))];
  };
}

// SGIS 1 km 인구·가구 격자(reference): .cache/v2/raw/sgis_grid 폴더가 있고 CSV가 풀려 있을 때만. 시도는 core 시군구 경계로 판정한다.
const { buildPopGrid, sgisRows, sgisDataYear, locateSigunguFromCore } = await import("../../lib/v2/ingest/sources/sgis-grid.ts");
const sgisDir = join(raw, "sgis_grid");
if (builders.reference && existsSync(sgisDir)) {
  const base = builders.reference;
  builders.reference = async (db, ctx) => {
    const built = await base(db, ctx);
    let year = sgisDataYear(sgisDir);
    if (!year) {
      extractAll(sgisDir);
      year = sgisDataYear(sgisDir);
    }
    if (!year) {
      console.log("sgis_grid: 통계 CSV 없음 — 격자 적재 건너뜀");
      return built;
    }
    const zip = join(sgisDir, "sgis_grid.zip");
    const st = statSync(existsSync(zip) ? zip : sgisDir);
    const releaseId = insertRelease(db, {
      sourceId: "sgis_grid",
      provider: "국가데이터처(SGIS 격자 통계, 공공데이터포털)",
      sourceUrl: "https://www.data.go.kr/data/15141768/fileData.do",
      sourceAsOf: year,
      fetchedAt: st.mtime.toISOString(),
      checksum: `size-mtime:${st.size}-${Math.round(st.mtimeMs)}`,
      licenseCode: "UNRESTRICTED",
      rights: { note: "이용허락범위 제한 없음(A0 표 8행)", disclosure: "5 미만 값은 0 또는 5로 확률 대체, 그 이상은 최대 ±7 노이즈, 총괄 항목 일부 N/A(비공개)" },
    });
    if (!ctx.core) console.warn("⚠ core가 없어 격자의 시도 코드를 (미상)으로 기록합니다");
    return [...built, await buildPopGrid(db, { rows: sgisRows(sgisDir), releaseId, dataYear: year, locate: locateSigunguFromCore(ctx.core) })];
  };
}
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
const { buildDistricts, districtLayerFiles, DISTRICT_LAYERS, DISTRICT_RIGHTS } = await import("../../lib/v2/ingest/sources/districts.ts");
if (builders.reference && existsSync(districtsDir)) {
  const base = builders.reference;
  builders.reference = async (db, ctx) => {
    const built = await base(db, ctx);
    extractAll(districtsDir);
    if (DISTRICT_LAYERS.length === 0) {
      console.log("districts: Q1 레이어 제목이 확정되지 않아 적재를 건너뜁니다");
      return built;
    }
    const found = districtLayerFiles([...walk(districtsDir)]);
    const missing = DISTRICT_LAYERS.filter((l) => !found.has(l.key)).map((l) => l.title || l.key);
    if (missing.length > 0) throw new Error(`구역·지구·도시계획시설 레이어 없음: ${missing.join(", ")} — vworld:fetch -- --ds 24 --folder districts 로 받으세요`);
    const layers = DISTRICT_LAYERS.map((l) => {
      const set = found.get(l.key);
      const st = statSync(set.files[0]);
      const d = set.date;
      const releaseId = insertRelease(db, {
        sourceId: l.sourceId,
        provider: "국토교통부(VWorld 일별용도지역지구정보)",
        sourceUrl: "https://www.vworld.kr/dtmk/dtmk_ntads_s002.do?svcCde=NA&dsId=24",
        sourceAsOf: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
        fetchedAt: st.mtime.toISOString(),
        checksum: `size-mtime:${st.size}-${Math.round(st.mtimeMs)}`,
        licenseCode: "UNRESTRICTED",
        rights: { ...DISTRICT_RIGHTS, layer: l.title || l.key, cls: l.cls, kind: l.kind },
      });
      return { layer: l, releaseId, records: chain(...set.files.map((f) => readShp(f))) };
    });
    return [...built, ...(await buildDistricts(db, layers))];
  };
}

const started = Date.now();
const out = await buildAndPublish({ dataDir: v2DataDir(), version, builders, expectations, resetBaseline });
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
