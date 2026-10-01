/**
 * 엔진 테스트용 작은 데이터 디렉터리(core·reference·market·terrain·weather)를 만들고 게시한다. 테스트가 아니다.
 * 중심점 다산(127.1506, 37.6245) 둘레에 거리를 알고 있는 점들을 둔다.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";

const { toUtmk, toLngLat } = await import("../../lib/v2/crs.ts");
const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { DEM_NODATA, insertDemTile } = await import("../../lib/v2/data/terrain.ts");
const { insertFeature } = await import("../../lib/v2/data/features.ts");
const { insertRelease } = await import("../../lib/v2/ingest/build.ts");
const M = await import("../../lib/v2/data/manifest.ts");

export const CENTER = [127.1506, 37.6245];
const [cx, cy] = toUtmk(CENTER);
export const at = (dx, dy = 0) => [...toLngLat([cx + dx, cy + dy])];
const pt = (dx, dy = 0) => ({ type: "Point", coordinates: at(dx, dy) });
const rect = (x0, x1, y0, y1) => ({ type: "Polygon", coordinates: [[at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1), at(x0, y0)]] });
/** n각형 원판(정점 n개 — 단순화 상한 검증용) */
const disc = (dx, dy, r, n) => ({ type: "Polygon", coordinates: [Array.from({ length: n + 1 }, (_, i) => at(dx + r * Math.cos((2 * Math.PI * (i % n)) / n), dy + r * Math.sin((2 * Math.PI * (i % n)) / n)))] });
const box = (x0, x1) => ({ type: "Polygon", coordinates: [[at(x0, -4000), at(x1, -4000), at(x1, 4000), at(x0, 4000), at(x0, -4000)]] });

export const PNU_DASAN_100 = "4136011800101000000";
export const PARCEL_PNUS = [
  PNU_DASAN_100,
  "4136011800101000002",
  "4136011800101000003",
  "4136011800101000004",
  "4136011800101000005",
  "4136011800101000006",
  "4136011800101000007",
  "4136011800101000008",
  "4136011800101000009",
];
/** 실거래 위치 필지(중심에서 동쪽 거리). A: 100m · B: 300m · C: 600m(송파 쪽) · FAR: 2000m(반경 밖) */
export const TRADE_PNU = { A: "4136011800100010000", B: "4136011800100020000", C: "1171010100100030000", FAR: "4136011800100040000" };
const TRADE_PNU_DX = { [TRADE_PNU.A]: 100, [TRADE_PNU.B]: 300, [TRADE_PNU.C]: 600, [TRADE_PNU.FAR]: 2000 };

const rel = (db, sourceId, sourceAsOf, extra = {}) =>
  insertRelease(db, { sourceId, provider: "테스트", sourceUrl: "https://example.invalid", sourceAsOf, fetchedAt: "2026-09-29T00:00:00Z", checksum: "x", licenseCode: "TEST", ...extra });

function run(db, sourceId, releaseId, snapshot, rejected = 0, count = 10) {
  db.prepare(`INSERT INTO ingest_run (run_id, source_id, started_at, finished_at, status, received_count, accepted_count, rejected_count, release_id, snapshot_json)
    VALUES (?, ?, '2026-09-29T00:00:00Z', '2026-09-29T00:01:00Z', 'succeeded', ?, ?, ?, ?, ?)`)
    .run(`${sourceId}:1`, sourceId, count, count, rejected, releaseId, JSON.stringify(snapshot));
}

/** options.noMarket: market 파일을 게시하지 않는다. options.extraBus: 버스정류장을 더한다(새 버전 검증용). options.buildings/parcels/terrain/weather/roads/landuse/rents: 해당 파일·fixture를 게시한다. */
export async function buildEngineFixture(dataDir, version, options = {}) {
  const dir = join(dataDir, "versions", version);
  mkdirSync(dir, { recursive: true });
  const files = {};
  const open = (kind) => {
    const db = new Database(join(dir, `${kind}.sqlite`));
    initDataFileSchema(db, kind);
    return db;
  };

  // ── core
  let db = open("core");
  const legal = rel(db, "legal_areas", "2026-09-09");
  const parcel = rel(db, "parcel", "2026-09-08");
  const recap = rel(db, "ledger_recap", "2026-08");
  const title = rel(db, "ledger_title", "2026-08");
  const la = db.prepare("INSERT INTO legal_area VALUES (?, ?, ?, ?, ?)");
  la.run("41360", "sigungu", "경기도 남양주시", null, legal);
  la.run("41360118", "emd", "다산동", "41360", legal);
  la.run("41360130", "emd", "별내동", "41360", legal);
  la.run("41360131", "emd", "별내동", "41360", legal); // 동명 → 모호
  la.run("11710", "sigungu", "서울특별시 송파구", null, legal);
  db.prepare("INSERT INTO parcel_point VALUES (?, ?, ?, ?, ?)").run(PNU_DASAN_100, CENTER[0], CENTER[1], "대", parcel);
  if (options.trades || options.rents) {
    const pp = db.prepare("INSERT INTO parcel_point VALUES (?, ?, ?, ?, ?)");
    for (const [pnu, dx] of Object.entries(TRADE_PNU_DX)) pp.run(pnu, ...at(dx, 0), "대", parcel);
  }
  insertFeature(db, { stableId: "sig:41360", kind: "legal_sigungu", sourceKey: "41360", releaseId: legal, geometry: box(-5000, 5000), name: "경기도 남양주시", legalCode: "4136000000" });
  insertFeature(db, { stableId: "sig:11710", kind: "legal_sigungu", sourceKey: "11710", releaseId: legal, geometry: box(600, 5000), name: "서울특별시 송파구", legalCode: "1171000000" });
  const hc = (id, dx, releaseId, props, name = id) =>
    insertFeature(db, { stableId: id, kind: "housing_complex", sourceKey: id, releaseId, geometry: pt(dx, 100), name, properties: props });
  // 실제 대장 행 모양(고덕역 1km): 총괄표제부 "아파트, 상가", 표제부 "공동주택" 300세대, 총괄표제부 "아파트" 세대 미상
  hc("recap:apt1", 100, recap, { source: "recap", mainUse: "공동주택", otherUse: "아파트, 상가", units: 480, households: 500, parking: 600, approvalDate: "1996-09-30" });
  hc("title-housing:apt2", 200, title, { source: "title", mainUse: "공동주택", otherUse: "공동주택", units: 300, households: null, parking: null, approvalDate: "2010-05-01" });
  hc("recap:apt3", 300, recap, { source: "recap", mainUse: "공동주택", otherUse: "아파트", units: null, households: null, parking: null, approvalDate: null });
  // 연립·다세대: mainUse는 똑같이 "공동주택"이지만 아파트가 아니다
  hc("recap:villa1", 410, recap, { source: "recap", mainUse: "공동주택", otherUse: "공동주택(도시형생활주택 단지형 다세대주택) 및 근린생활시설", units: 40, households: null, parking: 34, approvalDate: "2022-01-01" });
  hc("title-housing:villa2", 420, title, { source: "title", mainUse: "공동주택", otherUse: "다세대주택,제2종근린생활시설", units: 6, households: null, parking: null, approvalDate: "1987-11-21" });
  hc("title-housing:villa3", 430, title, { source: "title", mainUse: "공동주택", otherUse: "공동주택", units: 12, households: null, parking: null, approvalDate: "2002-07-26" });
  hc("recap:villa4", 440, recap, { source: "recap", mainUse: "공동주택", otherUse: "공동주택(연립주택), 관리실, 노인정", units: 156, households: null, parking: null, approvalDate: "1991-01-01" });
  hc("recap:house", 400, recap, { source: "recap", mainUse: "단독주택", units: 4, households: null, parking: null, approvalDate: "1996-10-01" });
  hc("recap:far", 4000, recap, { source: "recap", mainUse: "공동주택", units: 999, households: 999, parking: 1, approvalDate: "2000-01-01" }); // 반경 밖
  const of = (id, dx, props) => insertFeature(db, { stableId: id, kind: "officetel", sourceKey: id, releaseId: title, geometry: pt(dx, -100), name: id, properties: props });
  of("title:off1", 150, { units: 100, approvalDate: "2015-01-01" });
  of("title:off2", 250, { units: null, approvalDate: null });
  if (options.kapt) {
    const kp = rel(db, "kapt", "2026-08-01");
    const kc = (id, dx, type, households, linkTo) => {
      const sid = `kapt:${id}`;
      insertFeature(db, { stableId: sid, kind: "kapt_complex", sourceKey: id, releaseId: kp, geometry: pt(dx, 100), name: id, properties: { complexId: id, complexType: type, households } });
      if (linkTo) db.prepare("INSERT INTO feature_link (from_stable_id, to_stable_id, relation_type, method, confidence, release_id) VALUES (?, ?, 'same_parcel', 'pnu', 1, ?)").run(sid, linkTo, kp);
    };
    kc("k1", 100, "1", 510, "recap:apt1"); // 대장 가구 수 500이 우선
    kc("k2", 200, "1", 320, "title-housing:apt2"); // 대장 가구 수 null → K-APT 320 (대장 세대 수 300 대신)
    kc("k3", 350, "1", 700, null); // K-APT에만 있는 아파트
    kc("k4", 360, "2", 100, null); // 종류 코드 2: 아파트로 세지 않음
    kc("kfar", 4000, "1", 900, null); // 반경 밖
    run(db, "kapt", kp, { byRegion: { 41: 5 }, byType: {}, fillRates: {}, unlocated: 0 });
  }
  run(db, "ledger_recap_housing", recap,{ byRegion: { 41: 10 }, byType: {}, fillRates: {}, unlocated: 2 }, 3);
  run(db, "ledger_title_housing", title, { byRegion: { 41: 10 }, byType: {}, fillRates: {}, unlocated: 1 }, 1);
  db.close();
  files.core = "core";

  // ── buildings
  if (options.buildings) {
    db = open("buildings");
    const buildingRelease = rel(db, "building", "2026-09-08");
    const fact = db.prepare(`INSERT INTO building_fact (feature_id, ledger_pk, height_m, height_method, floors_above, floors_below, use_code, approval_date, gross_floor_area_m2, footprint_area_m2, field_provenance_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const building = (id, dx, dy, size, details, pnu = null) => {
      const featureId = insertFeature(db, { stableId: `building:${id}`, kind: "building", sourceKey: id, releaseId: buildingRelease, geometry: rect(dx - size / 2, dx + size / 2, dy - size / 2, dy + size / 2), name: id, pnu, legalCode: pnu ? "4136011800" : null });
      fact.run(featureId, null, details.heightM, details.method, details.floors, null, details.useCode, details.approval, null, size * size, details.method === "floors_estimate" ? JSON.stringify({ height_m: "A26*floorHeightM", floorHeightM: 3 }) : "{}");
    };
    building("b_apt", 0, 0, 10, { heightM: 12, method: "source", floors: 4, useCode: "02000", approval: "1979-05-01" }, PNU_DASAN_100);
    building("b_office", 70, 0, 20, { heightM: 40, method: "source", floors: 12, useCode: "14000", approval: "1985-01-01" });
    building("b_tower", -70, 0, 15, { heightM: 90, method: "floors_estimate", floors: 30, useCode: "02000", approval: "1995-01-01" });
    building("b_unknown", 0, 70, 10, { heightM: null, method: "unknown", floors: null, useCode: null, approval: "2005-01-01" });
    building("b_shop", 0, -70, 12, { heightM: 8, method: "source", floors: 2, useCode: "03000", approval: "2015-01-01" });
    building("b_noledger", 120, 0, 10, { heightM: null, method: "unknown", floors: null, useCode: null, approval: null });
    building("b_far", 3000, 0, 10, { heightM: 20, method: "source", floors: 6, useCode: "02000", approval: "2000-01-01" });
    run(db, "building", buildingRelease, { byRegion: { 41: 7 }, byType: { source: 4, floors_estimate: 1, unknown: 2 }, fillRates: {}, unlocated: 0 }, 0, 7);
    db.close();
    files.buildings = "buildings";
  }

  // ── parcel polygons
  if (options.parcels) {
    db = open("parcels");
    const parcelRelease = rel(db, "parcel_polygon", "2026-09-08");
    const parcel = (pnu, name, jimok, geometry, areaM2, mountain = false) => insertFeature(db, {
      stableId: `parcel:${pnu}`,
      kind: "parcel",
      sourceKey: pnu,
      releaseId: parcelRelease,
      geometry,
      name,
      pnu,
      legalCode: "4136011800",
      properties: { jimok, jibun: name.replace(jimok ?? "", ""), sigungu: "41360", areaM2, mountain },
      roundM: 0.01,
    });
    parcel(PARCEL_PNUS[0], "100대", "대", rect(-20, 20, -20, 20), 1600);
    parcel(PARCEL_PNUS[1], "100-2대", "대", rect(30, 40, 30, 40), 100);
    parcel(PARCEL_PNUS[2], "100-3대", "대", rect(50, 70, 50, 70), 400);
    parcel(PARCEL_PNUS[3], "100-4대", "대", rect(100, 160, 100, 160), 3600);
    parcel(PARCEL_PNUS[4], "100-5도", "도", rect(-200, 200, 100, 110), 4000);
    parcel(PARCEL_PNUS[5], "100-6천", "천", rect(-300, -100, -300, -200), 20000);
    parcel(PARCEL_PNUS[6], "산100-7임", "임", rect(200, 400, -400, -200), 40000, true);
    parcel(PARCEL_PNUS[7], "100-8대", "대", rect(700, 900, -50, 50), 20000);
    parcel(PARCEL_PNUS[8], "100-9대", "대", rect(2000, 2100, 0, 100), 10000);
    run(db, "parcel_polygon", parcelRelease, { byRegion: { 41: 9 }, byType: { 대: 6, 도: 1, 천: 1, 임: 1 }, fillRates: {}, unlocated: 0 }, 0, 9);
    db.close();
    files.parcels = "parcels";
  }

  // ── terrain: 30m에 가까운 작은 HGT 격자. 값은 중심 기준 EPSG:5179의 경사 + 언덕이다.
  if (options.terrain) {
    db = open("terrain");
    const terrainRelease = rel(db, "terrain_tiles", "2026-10-01", {
      rights: { attribution: "Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved", verticalDatum: "EGM2008" },
    });
    const meta = { tile: "fx", lat0: 37.58, lon0: 127.10, rows: 181, cols: 181, cellDeg: 0.0005, nodata: DEM_NODATA, vertical: "EGM2008", resolutionM: 30 };
    const rows = [];
    for (let row = 0; row < meta.rows; row++) {
      const data = Buffer.alloc(meta.cols * 2);
      for (let col = 0; col < meta.cols; col++) {
        const lng = meta.lon0 + col * meta.cellDeg;
        const lat = meta.lat0 + (meta.rows - 1 - row) * meta.cellDeg;
        const [x, y] = toUtmk([lng, lat]);
        const dx = x - cx;
        const dy = y - cy;
        const height = 50 + 0.05 * dx + 30 * Math.exp(-((dx ** 2) + (dy - 300) ** 2) / (2 * 100 ** 2));
        // HGT 표본은 정수 m이므로 가장 가까운 정수로 양자화한다.
        data.writeInt16BE(row === 0 && col === 0 ? DEM_NODATA : Math.round(height), col * 2);
      }
      rows.push({ row, data });
    }
    insertDemTile(db, meta, terrainRelease, rows);
    db.close();
    files.terrain = "terrain";
  }

  // ── weather: 최근 10년 ASOS 요약. near만 장미를 넣어 전체 관측시간 합이 한 지점의 유효시간이 된다.
  if (options.weather) {
    db = open("weather");
    const weatherRelease = rel(db, "asos", "2025-12-31");
    const station = db.prepare(`INSERT INTO weather_station (station_id, name, lng, lat, elevation_m, period_start, period_end, total_hours, calm_hours, missing_hours, release_id)
      VALUES (?, ?, ?, ?, ?, '2016-01-01', '2025-12-31', ?, ?, ?, ?)`);
    station.run("near", "near", ...at(3000, 0), 30, 87672, 8767, 4384, weatherRelease);
    station.run("far", "far", ...at(40000, 0), 80, 87672, 8767, 4384, weatherRelease);
    const validHours = 87672 - 8767 - 4384;
    const wind = db.prepare("INSERT INTO wind_rose (station_id, dir16, speed_bin, hours) VALUES ('near', ?, ?, ?)");
    const rest = validHours - 20000;
    const base = Math.floor(rest / 75);
    const remainder = rest - base * 75;
    for (let dir16 = 0; dir16 < 16; dir16++) {
      for (let speedBin = 0; speedBin < 5; speedBin++) {
        if (dir16 === 14 && speedBin === 1) {
          wind.run(dir16, speedBin, 20000);
        } else if (dir16 === 14) {
          wind.run(dir16, speedBin, 0);
        } else {
          const hours = base + (dir16 === 15 && speedBin === 4 ? remainder : 0);
          wind.run(dir16, speedBin, hours);
        }
      }
    }
    if (options.weather === "legacy") {
      // P4-T4: 새 계절 테이블이 없는 옛 weather 파일 모양.
      db.exec("DROP TABLE weather_season_hour; DROP TABLE wind_rose_season;");
    } else {
      const seasonSpecs = [
        { season: "spring", dir16: 12, ta: 18, hm: 55, ws: 1.8, ghi: 600, cloud: 4 },
        { season: "summer", dir16: 10, ta: 31, hm: 60, ws: 2.2, ghi: 750, cloud: 5 },
        { season: "autumn", dir16: 0, ta: 20, hm: 55, ws: 2.0, ghi: 550, cloud: 4 },
        { season: "winter", dir16: 14, ta: 3, hm: 50, ws: 3.0, ghi: 420, cloud: 3 },
      ];
      const insertSeasonWind = db.prepare("INSERT INTO wind_rose_season (station_id, season, dir16, speed_bin, hours, calm_hours) VALUES (?, ?, ?, ?, ?, ?)");
      const insertSeasonHour = db.prepare(`INSERT INTO weather_season_hour
        (station_id, season, hour, n, ta_med, hm_med, ws_med, ghi_med_wm2, cloud_med)
        VALUES (?, ?, ?, 300, ?, ?, ?, ?, ?)`);
      for (const stationId of ["near", "far"]) {
        for (const spec of seasonSpecs) {
          const calmHours = stationId === "near" ? 100 : 200;
          for (let dir16 = 0; dir16 < 16; dir16++) {
            for (let speedBin = 0; speedBin < 5; speedBin++) {
              insertSeasonWind.run(stationId, spec.season, dir16, speedBin, dir16 === spec.dir16 && speedBin === 1 ? 20000 : 0, calmHours);
            }
          }
          for (let hour = 0; hour < 24; hour++) {
            const ws = options.weather === "calm" ? 0.3 : spec.ws;
            const ghi = hour >= 8 && hour <= 17 ? spec.ghi : 0;
            const ta = hour === 14 ? spec.ta : spec.ta - 5;
            insertSeasonHour.run(stationId, spec.season, hour, ta, spec.hm, ws, ghi, spec.cloud);
          }
        }
      }
    }
    run(db, "asos", weatherRelease, { byRegion: { near: 1, far: 1 }, byType: {}, fillRates: {}, unlocated: 0 }, 0, 87672);
    db.close();
    files.weather = "weather";
  }

  // P4-T6: landuse/water fixture
  // ── reference
  db = open("reference");
  const store = rel(db, "store", "2026-06");
  const bus = rel(db, "bus_stop", "2025-12-09");
  const park = rel(db, "park", null);
  if (options.roads) {
    const road = rel(db, "osm_roads", "2026-09-30", { rights: { attribution: "© OpenStreetMap contributors" } });
    const line = (stableId, points, hierarchy = "국지") => insertFeature(db, {
      stableId: `road:${stableId}`,
      kind: "road",
      sourceKey: stableId,
      releaseId: road,
      geometry: { type: "LineString", coordinates: points.map(([dx, dy]) => at(dx, dy)) },
      properties: { osmId: stableId, fclass: "residential", hierarchy, name: null },
    });
    for (const dy of [-200, 0, 200]) line(`h${dy}`, [[-600, dy], [600, dy]]);
    for (const dx of [-200, 0, 200]) line(`v${dx}`, [[dx, -600], [dx, 600]]);
    line("walk", [[-100, -200], [-100, 0]], "보행·자전거");
    run(db, "osm_roads", road, { byRegion: { "41": 7 }, byType: { 국지: 6, "보행·자전거": 1 }, fillRates: {}, unlocated: 0 }, 0, 7);
  }
  // P4-T6: landuse/water fixture — 녹지 3면(중첩 grass 포함)과 수계 1면.
  if (options.landuse) {
    const landuse = rel(db, "osm_landuse", "2026-09-29", { rights: { license: "ODbL 1.0", attribution: "© OpenStreetMap contributors" } });
    const water = rel(db, "osm_water", "2026-09-29", { rights: { license: "ODbL 1.0", attribution: "© OpenStreetMap contributors" } });
    const area = (id, sourceLayer, kind, fclass, cls, geometry, name, releaseId) => insertFeature(db, {
      stableId: `osm:${sourceLayer}:${id}`,
      kind,
      sourceKey: id,
      releaseId,
      geometry,
      name,
      properties: { osmId: id, fclass, cls, name, layer: sourceLayer },
    });
    area("forest", "gis_osm_landuse_a_free_1", "landuse", "forest", "forest", rect(200, 400, 200, 400), "fixture forest", landuse);
    area("park", "gis_osm_landuse_a_free_1", "landuse", "park", "park", rect(-400, -200, -100, 100), "fixture park", landuse);
    area("grass", "gis_osm_natural_a_free_1", "landuse", "meadow", "grass", rect(-350, -250, -50, 50), "fixture grass", landuse);
    area("riverbank", "gis_osm_water_a_free_1", "water", "riverbank", "water", rect(-150, 150, -430, -370), "fixture water", water);
    run(db, "osm_landuse", landuse, { byRegion: { "(미상)": 3 }, byType: { forest: 1, park: 1, grass: 1 }, fillRates: { name: 1 }, unlocated: 0 }, 0, 3);
    run(db, "osm_water", water, { byRegion: { "(미상)": 1 }, byType: { water: 1 }, fillRates: { name: 1 }, unlocated: 0 }, 0, 1);
  }
  const sp = (id, dx, code, major, mid) =>
    insertFeature(db, { stableId: `store:${id}`, kind: "store", sourceKey: id, releaseId: store, geometry: pt(dx, 0), name: id, properties: { majorCategory: major, midCategory: mid, minorCategory: "x", categoryCode: code, floor: null, address: null } });
  sp("cvs", 100, "G20405", "소매", "종합 소매");
  sp("pharm-far", 900, "G21501", "소매", "의약·화장품 소매"); // 반경 800에서는 밖, 1000에서는 안
  sp("clinic", 300, "Q10210", "보건의료", "의원");
  sp("cafe", 400, "I21201", "음식", "비알코올");
  sp("hair", 50, "S20701", "수리·개인", "이용·미용");
  sp("shoes", 60, "G20910", "소매", "섬유·의복·신발 소매");
  const bp = (id, dx) => insertFeature(db, { stableId: `bus_stop:${id}`, kind: "bus_stop", sourceKey: id, releaseId: bus, geometry: pt(dx, 0), name: id, properties: { cityCode: "31", cityName: "남양주시", stopNo: id, collectedAt: "2025-12-09" } });
  bp("b1", 250);
  bp("b2", 700);
  bp("b3", 1500);
  if (options.extraBus) bp("b4", 100);
  const pk = (id, dx, areaM2) => insertFeature(db, { stableId: `park:${id}`, kind: "park", sourceKey: id, releaseId: park, geometry: pt(dx, 0), name: id, properties: { parkType: "근린공원", areaM2, designatedAt: null, jibunAddress: null } });
  pk("p1", 300, 10000);
  pk("p2", 600, 5000);
  pk("p3", 700, null);
  if (options.rail) {
    const osm = rel(db, "osm_subway", "2026-09-01");
    const st = (name, dx, dy, lineRefs) => insertFeature(db, { stableId: `rail_station:${name}`, kind: "rail_station", sourceKey: name, releaseId: osm, geometry: pt(dx, dy), name, properties: { lineRefs, lineNames: lineRefs, lineColors: [], operator: null } });
    const en = (station, id, dx, dy) => insertFeature(db, { stableId: `rail_entrance:${id}`, kind: "rail_entrance", sourceKey: id, releaseId: osm, geometry: pt(dx, dy), name: id, properties: { stationName: station, entranceRef: id } });
    st("가온역", 1200, 0, ["K"]); // 반경 800 밖, 탐색 1500 안
    en("가온역", "가온1", 1100, 0);
    en("가온역", "가온2", 1300, 0);
    st("먼역", 2000, 0, ["Z"]); // 탐색 1500 밖
    en("먼역", "먼1", 1900, 0);
    if (options.rail !== "far") {
      st("나래역", -600, 0, ["5"]); // 출입구 자료 없음 → 역 대표점
      st("다온역", 0, 500, ["5", "9"]); // 역 대표점은 500m지만 출입구가 650m → 출입구 기준
      en("다온역", "다온1", 0, 650);
    }
    insertFeature(db, { stableId: "rail_line:5", kind: "rail_line", sourceKey: "5", releaseId: osm, geometry: { type: "LineString", coordinates: [at(-3000, 300), at(3000, 300)] }, name: "5호선", properties: { lineRef: "5", color: null } });
    run(db, "rail_station", osm, { byRegion: { 41: 4 }, byType: {}, fillRates: {}, unlocated: 0 });
  }
  if (options.planned) {
    const pl = rel(db, "planned_rail", "2026-07-17");
    insertFeature(db, { stableId: "planned_rail_line:p1", kind: "planned_rail_line", sourceKey: "p1", releaseId: pl, geometry: { type: "LineString", coordinates: [at(-3000, -300), at(3000, -300)] }, name: "계획선", properties: { projectId: "p1", lineName: "계획선", lifecycleStatus: "under_construction", sourceType: "approximation", confidenceLabel: "medium", lastVerifiedAt: "2026-07-17", nextReviewAt: "2027-01-15" } });
    insertFeature(db, { stableId: "planned_rail_station:p1:계획역", kind: "planned_rail_station", sourceKey: "p1:계획역", releaseId: pl, geometry: pt(200, -300), name: "계획역", properties: { projectId: "p1", lineName: "계획선", lifecycleStatus: "under_construction", lastVerifiedAt: "2026-07-17" } });
    run(db, "planned_rail_line", pl, { byRegion: { 41: 1 }, byType: {}, fillRates: {}, unlocated: 0 });
  }
  if (options.school) {
    const sc = rel(db, "school", "2026-04-01");
    const sch = (id, dx, level, status = "운영") => insertFeature(db, { stableId: `school:${id}`, kind: "school", sourceKey: id, releaseId: sc, geometry: pt(dx, -200), name: id, properties: { schoolId: id, level, operatingStatus: status } });
    sch("e1", 400, "초등학교");
    sch("e2", 900, "초등학교"); // 반경 800 밖, 탐색 1500 안
    sch("e-closed", 100, "초등학교", "폐교"); // 비운영: 제외
    sch("m1", 500, "중학교");
    sch("h1", 700, "고등학교");
    sch("sp", 200, "특수학교"); // 초·중·고 아님
    run(db, "school", sc, { byRegion: { 41: 6 }, byType: {}, fillRates: {}, unlocated: 0 });
  }
  if (options.zoning) {
    // z1 주거(x<200) · z2 상업(x>=200) · 우산 “도시지역” 전체. zoning:"umbrella"는 우산만, "overlap"은 관리지역 전체와 곡선 녹지 도형을 더한다.
    const zu = rel(db, "zoning_urban", "2026-09-20");
    const za = (id, name, cls, geometry, extra = {}, layer = "urban", umbrella = false) =>
      insertFeature(db, { stableId: `zoning:${id}`, kind: "zoning_area", sourceKey: id, releaseId: layer === "urban" ? zu : zm, geometry, name, legalCode: "4136000000", properties: { zoningClass: cls, umbrella, zoningCode: null, zoningName: name, layer, designatedDate: null, remark: [], sourceUpdatedAt: null, ...extra } });
    let zm = null;
    if (options.zoning === "overlap") zm = rel(db, "zoning_management", "2026-09-20");
    za("u", "도시지역", "기타", box(-4000, 4000), {}, "urban", true);
    if (options.zoning !== "umbrella") {
      za("z1", "제2종일반주거지역", "주거", rect(-4000, 200, -4000, 4000));
      za("z2", "일반상업지역", "상업", rect(200, 4000, -4000, 4000));
    }
    if (options.zoning === "overlap") {
      za("z3", "계획관리지역", "관리", box(-4000, 4000), {}, "management");
      za("z4", "자연녹지지역", "녹지", disc(0, 500, 150, 1500));
    }
    run(db, "zoning_urban", zu, { byRegion: { 41: 4 }, byType: {}, fillRates: {}, unlocated: 0 });
    if (zm) run(db, "zoning_management", zm, { byRegion: { 41: 1 }, byType: {}, fillRates: {}, unlocated: 0 });
  }
  if (options.maint === "zones") {
    const mz = rel(db, "maintenance_zone", "2026-08-01");
    const zone = (id, name, x0, x1, y0, y1, props) => insertFeature(db, { stableId: `maintenance_zone:${id}`, kind: "maintenance_zone", sourceKey: id, releaseId: mz, geometry: rect(x0, x1, y0, y1), name, properties: props });
    zone("za", "다산1구역", 100, 300, 100, 300, { type: "재개발" });
    zone("zb", "다산2구역", -300, -100, 0, 200, { projectType: "재건축", stage: "구역지정", households: 300 });
    zone("zfar", "먼구역", 3000, 3200, 0, 200, { type: "재개발", stage: "착공" });
    db.prepare("INSERT INTO feature_link (from_stable_id, to_stable_id, relation_type, method, confidence, release_id) VALUES ('maintenance_zone:za', 'maint:a', 'zone_of_project', 'name', 1, ?)").run(mz);
    run(db, "maintenance_zone", mz, { byRegion: { 41: 3 }, byType: {}, fillRates: {}, unlocated: 0 });
  }
  run(db, "store", store,{ byRegion: { 41: 6 }, byType: {}, fillRates: {}, unlocated: 0 });
  run(db, "bus_stop", bus, { byRegion: { "경기도 남양주시": 4 }, byType: {}, fillRates: {}, unlocated: 0 });
  run(db, "park", park, { byRegion: { 경기도: 3 }, byType: {}, fillRates: {}, unlocated: 0 });
  db.close();
  files.reference = "reference";

  // ── market
  if (!options.noMarket) {
    db = open("market");
    if (options.rents === "nocolumn") db.exec("ALTER TABLE property_transaction DROP COLUMN renewal;");
    const ah = rel(db, "applyhome", null);
    const mi = rel(db, "move_in", "2026-06-30");
    const ps = (id, dx, releaseId, props) =>
      insertFeature(db, { stableId: id, kind: "planned_supply", sourceKey: id, releaseId, geometry: pt(dx, 0), name: id, properties: { kind: "apartment", address: null, ...props } });
    ps("applyhome:1", 100, ah, { source: "applyhome", units: 800, plannedMonth: "2026-12" });
    ps("applyhome:2", 200, ah, { source: "applyhome", units: 300, plannedMonth: "2026-01" });
    ps("applyhome:3", 300, ah, { source: "applyhome", units: 100, plannedMonth: "2030-01" });
    ps("applyhome:4", 400, ah, { source: "applyhome", units: null, plannedMonth: "2026-10" });
    ps("movein:1", 150, mi, { source: "move_in", units: 500, plannedMonth: "2028-05" });
    ps("movein:2", 250, mi, { source: "move_in", units: 200, plannedMonth: null });
    ps("movein:far", 4000, mi, { source: "move_in", units: 9999, plannedMonth: "2027-01" });
    const ev = db.prepare(`INSERT INTO development_event (event_id, project_id, event_type, stage, planned_date_precision, units, geometry_id, evidence_url, release_id)
      VALUES (?, ?, 'x', 'x', 'month', 1, ?, 'https://example.invalid', ?)`);
    ev.run("e1", "e1", "applyhome:1", ah);
    ev.run("e2", "e2", "movein:1", mi);
    if (options.trades) {
      // 분석일 2026-09-30 기준 창 (2025-09-30, 2026-09-30], 최근 반기 (2026-03-30, 2026-09-30]
      const rt = rel(db, "rtms_apt_trade", "2026-09-30");
      const ins = db.prepare(`INSERT INTO property_transaction (transaction_id, source_record_key, lawd_cd, deal_date, property_type, contract_type, price_krw, deposit_krw, rent_krw, area_m2, floor, cancelled_at, location_id, match_status, release_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, 5, ?, ?, ?, ?)`);
      let n = 0;
      // unit: 만원/㎡ (면적 100㎡ 고정이면 거래금액 = unit×100 만원)
      const tx = (pnu, date, unit, o = {}) =>
        ins.run(`t${++n}`, `k${n}`, o.lawd ?? "41360", date, o.type ?? "apt", o.contract ?? "trade", Math.round(unit * 100 * 10_000), "area" in o ? o.area : 100, o.cancelled ?? null, pnu, pnu === null ? "unlocated" : "located", rt);
      for (let i = 0; i < 12; i++) tx(TRADE_PNU.A, `2026-05-${10 + i}`, 1000 + 10 * i); // 최근 반기 12건: 중앙값 1055
      for (let i = 0; i < 12; i++) tx(TRADE_PNU.A, `2025-11-${10 + i}`, 900 + 10 * i); // 이전 반기 12건: 중앙값 955
      tx(TRADE_PNU.B, "2026-08-01", 1500);
      tx(TRADE_PNU.B, "2026-08-02", 1600);
      tx(TRADE_PNU.B, "2026-08-03", 1700);
      tx(TRADE_PNU.B, "2026-08-04", 500, { area: null }); // 면적 없음: 건수에만 들어간다
      tx(TRADE_PNU.B, "2026-08-05", 1300, { cancelled: "2026-08-20" }); // 취소: 별도 집계
      tx(TRADE_PNU.C, "2026-09-01", 1200, { lawd: "11710" }); // 송파 쪽 필지(600m)
      for (let i = 0; i < 5; i++) tx(TRADE_PNU.FAR, `2026-07-1${i}`, 3000); // 반경 밖
      tx(TRADE_PNU.A, "2025-09-30", 700); // 12개월 창의 시작일(제외)
      tx(TRADE_PNU.A, "2025-09-29", 700);
      tx(TRADE_PNU.A, "2026-10-05", 700); // 분석일 이후
      tx(TRADE_PNU.A, "2026-08-10", 800, { type: "offi" }); // 오피스텔
      tx(TRADE_PNU.A, "2026-08-11", 800, { contract: "jeonse" }); // 전월세
      tx(null, "2026-08-12", 800); // 위치 미확인
      tx(null, "2026-08-13", 800, { lawd: "11710" });
      run(db, "rtms_apt_trade", rt, { byRegion: options.trades === "41360only" ? { 41: 24 } : { 41: 24, 11: 1 }, byType: {}, fillRates: {}, unlocated: 2 }, 2);
      if (options.trades === "41360only") db.prepare("DELETE FROM property_transaction WHERE lawd_cd = '11710'").run(); // 송파 자료 없음
    }
    if (options.rents) {
      const rentRelease = rel(db, "rtms_apt_rent", "2026-09-30");
      const hasRenewal = db.prepare("PRAGMA table_info(property_transaction)").all().some((column) => column.name === "renewal");
      const rentInsert = hasRenewal
        ? db.prepare(`INSERT INTO property_transaction (transaction_id, source_record_key, lawd_cd, deal_date, property_type, contract_type, renewal, price_krw, deposit_krw, rent_krw, area_m2, floor, cancelled_at, location_id, match_status, release_id)
          VALUES (?, ?, ?, ?, 'apt', ?, ?, NULL, ?, ?, 84, 4, ?, ?, ?, ?)`)
        : db.prepare(`INSERT INTO property_transaction (transaction_id, source_record_key, lawd_cd, deal_date, property_type, contract_type, price_krw, deposit_krw, rent_krw, area_m2, floor, cancelled_at, location_id, match_status, release_id)
          VALUES (?, ?, ?, ?, 'apt', ?, NULL, ?, ?, 84, 4, ?, ?, ?, ?)`);
      let n = 0;
      const rent = (pnu, date, depositManwon, monthlyManwon, renewal = null, o = {}) => {
        const locationId = "location" in o ? o.location : pnu;
        const matchStatus = locationId === null ? "unlocated" : "located";
        const contract = monthlyManwon > 0 ? "monthly" : "jeonse";
        if (hasRenewal) rentInsert.run(`r${++n}`, `rk${n}`, o.lawd ?? (pnu === TRADE_PNU.C ? "11710" : "41360"), date, contract, renewal, depositManwon * 10_000, monthlyManwon * 10_000, o.cancelled ?? null, locationId, matchStatus, rentRelease);
        else rentInsert.run(`r${++n}`, `rk${n}`, o.lawd ?? (pnu === TRADE_PNU.C ? "11710" : "41360"), date, contract, depositManwon * 10_000, monthlyManwon * 10_000, o.cancelled ?? null, locationId, matchStatus, rentRelease);
      };
      // A: 전세 6건(신규 4·갱신 2), B: 전세 2·월세 4, C: 반경 밖 전세 3(1건 취소), 별도 위치 미확인 1건.
      rent(TRADE_PNU.A, "2026-01-10", 42_000, 0, "new");
      rent(TRADE_PNU.A, "2026-02-10", 44_000, 0, "new");
      rent(TRADE_PNU.A, "2026-03-10", 46_000, 0, "new");
      rent(TRADE_PNU.A, "2026-04-10", 48_000, 0, "new");
      rent(TRADE_PNU.A, "2026-05-10", 49_000, 0, "renewal");
      rent(TRADE_PNU.A, "2026-06-10", 50_000, 0, "renewal");
      rent(TRADE_PNU.B, "2026-07-01", 10_000, 0);
      rent(TRADE_PNU.B, "2026-07-02", 12_000, 0);
      rent(TRADE_PNU.B, "2026-08-01", 10_000, 80);
      rent(TRADE_PNU.B, "2026-08-02", 10_000, 90);
      rent(TRADE_PNU.B, "2026-08-03", 10_000, 100);
      rent(TRADE_PNU.B, "2026-08-04", 10_000, 120);
      rent(TRADE_PNU.C, "2026-08-10", 30_000, 0);
      rent(TRADE_PNU.C, "2026-08-11", 31_000, 0, null, { cancelled: "2026-08-20" });
      rent(TRADE_PNU.C, "2026-08-12", 32_000, 0);
      rent(null, "2026-08-13", 15_000, 0, null, { location: null });
      run(db, "rtms_apt_rent", rentRelease, { byRegion: { 41: 12, 11: 3 }, byType: {}, fillRates: {}, unlocated: 1 }, 1, 16);
    }
    if (options.maint) {
      const roster = [
        { id: "maint:a", sido: "41", sigungu: "남양주시", name: "다산1구역", type: "재개발", stage: "조합", households: 1000 },
        { id: "maint:b", sido: "41", sigungu: "남양주시", name: "다산2구역", type: "재건축", stage: "구역지정", households: null },
        { id: "maint:c", sido: "11", sigungu: "송파구", name: "송파3구역", type: "재개발", stage: "관리처분", households: 500 },
        { id: "maint:d", sido: "41", sigungu: "수원시", name: "수원구역", type: "재개발", stage: "착공", households: 900 },
        { id: "maint:e", sido: "11", sigungu: "강동구", name: "강동구역", type: "재건축", stage: "사업시행", households: 300 },
      ];
      const mi2 = rel(db, "maintenance_integrated", "2026-06-01", { coverage: { projects: roster } });
      const ev = db.prepare(`INSERT INTO development_event (event_id, project_id, event_type, stage, planned_date_precision, units, geometry_id, evidence_url, release_id)
        VALUES (?, ?, 'maintenance_stage', ?, 'unknown', ?, NULL, 'https://example.invalid', ?)`);
      ev.run("m1", "maint:a", "구역지정", null, mi2);
      ev.run("m2", "maint:a", "조합", 1000, mi2);
      run(db, "maintenance_integrated", mi2, { byRegion: { 41: 3, 11: 2 }, byType: {}, fillRates: {}, unlocated: 5 }, 5);
    }
    run(db, "applyhome", ah, { byRegion: { 경기: 4 }, byType: {}, fillRates: {}, unlocated: 5 }, 5);
    run(db, "move_in", mi, { byRegion: { 경기: 3 }, byType: {}, fillRates: {}, unlocated: 0 });
    db.close();
    files.market = "market";
  }

  const manifest = { version, createdAt: "2026-09-30T00:00:00Z", files: {} };
  for (const kind of Object.values(files)) {
    const path = `versions/${version}/${kind}.sqlite`;
    manifest.files[kind] = { path, sha256: await M.sha256File(join(dataDir, path)), kind, schemaVersion: 2 };
  }
  const r = await M.publishManifest(dataDir, manifest, () => ({ ok: true, failures: [] }));
  if (!r.published) throw new Error("fixture publish failed");
  return r.hash;
}
