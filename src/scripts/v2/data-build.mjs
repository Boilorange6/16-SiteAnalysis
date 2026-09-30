/**
 * v2 데이터 파일 빌드·게시.
 *   npm run data:build -- --version 2026-09-30a [--raw .cache/v2/raw] [--only core,reference,market] [--expectations exp.json]
 * 원천 zip은 먼저 풀고(이미 풀린 것은 건너뜀), 원천 파일은 폴더마다 가장 새 파일을 쓴다.
 */
import { readdirSync, statSync, existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

const { extractAll } = await import("../../lib/v2/ingest/unzip.ts");
const { latestShpPerSido, partCounts } = await import("../../lib/v2/ingest/shp-parts.ts");
const { readShp, readShpPoints } = await import("../../lib/v2/ingest/shp.ts");
const { csvRecords } = await import("../../lib/v2/a0/measure.ts");
const { buildAndPublish, insertRelease } = await import("../../lib/v2/ingest/build.ts");
const { buildParcelPoints } = await import("../../lib/v2/ingest/sources/parcels.ts");
const { buildLegalAreas } = await import("../../lib/v2/ingest/sources/legal-areas.ts");
const { buildLedger } = await import("../../lib/v2/ingest/sources/ledger.ts");
const { buildPointSource, STORE_SPEC, BUS_STOP_SPEC, PARK_SPEC } = await import("../../lib/v2/ingest/sources/points.ts");
const { buildSupply, readLegacyPlannedHousing } = await import("../../lib/v2/ingest/sources/supply.ts");
const { buildOsmSubway, buildPlannedRail, legalCodeFromCore } = await import("../../lib/v2/ingest/sources/rail.ts");
const { legacyDbPath, v2DataDir } = await import("../../lib/v2/paths.ts");

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const version = opt("version");
if (!version || !/^[0-9A-Za-z._-]+$/.test(version)) {
  console.error("usage: data:build -- --version <name> [--raw dir] [--only core,reference,market] [--expectations file.json] [--reset-baseline parcel,parcel_building] [--dry-run]");
  process.exit(2);
}
const flag = (name) => args.includes(`--${name}`);
const raw = opt("raw", ".cache/v2/raw");
const only = new Set(String(opt("only", "core,reference,market")).split(","));
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
  return { cadastral, buildings, titleFile, hasNationalTitle: titles.length > 0 };
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

// 학교·학구 연계(reference)와 K-APT 단지(core): 기존 builder 뒤에 이어 붙인다.
const { buildKapt, buildSchoolZoneLinks, SCHOOL_SPEC, SCHOOL_ZONE_COVERAGE } = await import("../../lib/v2/ingest/sources/school-kapt.ts");
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
    for (const rel of [linkRel, elemRel]) db.prepare("UPDATE source_release SET coverage_json = ? WHERE release_id = ?").run(JSON.stringify(SCHOOL_ZONE_COVERAGE), rel);
    const zones = await buildSchoolZoneLinks(db, { link: (await csvRecords(linkFile)).records, elem: (await csvRecords(elemFile)).records, linkReleaseId: linkRel, elemReleaseId: elemRel });
    return [...(await base(db, ctx)), school, ...zones];
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
