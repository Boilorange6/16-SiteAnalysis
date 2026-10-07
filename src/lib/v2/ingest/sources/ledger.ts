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

export interface LedgerFloorInput {
  pnu: string | null;
  ledgerPk: string | null;
  name: string | null;
  grossFloorAreaM2: number | null;
  footprintAreaM2: number | null;
}

export type LedgerFloorMatchMethod = "ledger_pk" | "pnu_unique" | "pnu_name" | "pnu_area";

export interface LedgerFloorMatch {
  ledgerPk: string;
  floorsAbove: number | null;
  heightM?: number | null;
  approvalDate?: string | null;
  dongName?: string | null;
  buildingName?: string | null;
  footprintAreaM2?: number | null;
  grossFloorAreaM2?: number | null;
  useCode?: string | null;
  isMain?: boolean;
  method: LedgerFloorMatchMethod;
}

export interface LedgerFloorLookup {
  /** 표제부 후보가 있는 PNU인지 확인한다(다건 PNU 보수 판정용). */
  hasPnu(pnu: string): boolean;
  match(input: LedgerFloorInput): LedgerFloorMatch | null;
}

interface LedgerFloorCandidate extends LedgerFloorMatch {
  pnu: string | null;
  name: string | null;
  grossFloorAreaM2: number | null;
  footprintAreaM2: number | null;
}

const positiveInteger = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const positiveNumber = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const keyString = (value: unknown): string | null => {
  const s = String(value ?? "").trim();
  return s === "" ? null : s;
};

/** "101동"과 "101"을 같은 동명으로 보되, 다른 접두어는 보존한다. */
export const normalizedLedgerName = (value: string | null): string | null => {
  const normalized = value?.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/[\s()\[\]{}·,._\-/\\]/g, "") || null;
  return normalized?.replace(/동$/u, "") || null;
};

function propertyNumber(props: Props, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = positiveNumber(props[key]);
    if (value !== null) return value;
  }
  return null;
}

function areaMatches(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return false;
  return Math.abs(a - b) <= Math.max(1, Math.max(a, b) * 0.15);
}

const LEDGER_TITLE_TABLE = "ledger_title_dong";

function titleTableExists(db: Db): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_temp_master WHERE type = 'table' AND name = ? UNION ALL SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1").get(LEDGER_TITLE_TABLE, LEDGER_TITLE_TABLE));
}

export function hasLedgerTitleIndex(db: Db | null | undefined): boolean {
  return Boolean(db && titleTableExists(db));
}

function titleTableName(db: Db): string {
  // TEMP가 일반 sqlite_master보다 먼저 해석되므로 SQL에서는 짧은 이름을
  // 써도 된다. 존재 여부만 확인한 뒤 모든 쿼리가 같은 연결을 사용한다.
  if (!titleTableExists(db)) throw new Error("ledger_title_dong index is not available");
  return LEDGER_TITLE_TABLE;
}

/** 표제부 동 단위 인덱스. core 빌드에서는 TEMP, buildings 전용 빌드에서는 일반 테이블로 만든다. */
export function createLedgerTitleIndex(db: Db, temporary = false): void {
  db.exec(`${temporary ? "CREATE TEMP " : "CREATE "}TABLE IF NOT EXISTS ${LEDGER_TITLE_TABLE} (
    pnu TEXT,
    ledger_pk TEXT,
    dong_name TEXT,
    building_name TEXT,
    is_main INTEGER NOT NULL,
    floors_above INTEGER,
    height_m REAL,
    footprint_area_m2 REAL,
    gross_floor_area_m2 REAL,
    use_code TEXT,
    approval_date TEXT
  );
  CREATE INDEX IF NOT EXISTS ${temporary ? "temp." : ""}idx_ledger_title_dong_pnu ON ${LEDGER_TITLE_TABLE}(pnu);
  CREATE INDEX IF NOT EXISTS ${temporary ? "temp." : ""}idx_ledger_title_dong_pk ON ${LEDGER_TITLE_TABLE}(ledger_pk);`);
}

export function clearLedgerTitleIndex(db: Db): void {
  if (titleTableExists(db)) db.exec(`DELETE FROM ${LEDGER_TITLE_TABLE}`);
}

export function dropLedgerTitleIndex(db: Db): void {
  if (titleTableExists(db)) db.exec(`DROP TABLE ${LEDGER_TITLE_TABLE}`);
}

function titleIsMain(properties: Props): boolean {
  const name = keyString(properties["주_부속_구분_코드_명"]);
  if (name) return !name.includes("부속");
  const code = keyString(properties["주_부속_구분_코드"]);
  return code !== "1";
}

function titleIndexRow(properties: Props): {
  pnu: string | null;
  ledgerPk: string | null;
  dongName: string | null;
  buildingName: string | null;
  isMain: boolean;
  floorsAbove: number | null;
  heightM: number | null;
  footprintAreaM2: number | null;
  grossFloorAreaM2: number | null;
  useCode: string | null;
  approvalDate: string | null;
} {
  return {
    pnu: ledgerPnu(properties)?.pnu ?? null,
    ledgerPk: keyString(properties["관리_건축물대장_PK"]),
    dongName: keyString(properties["동_명"]),
    buildingName: keyString(properties["건물_명"]),
    isMain: titleIsMain(properties),
    floorsAbove: positiveInteger(properties["지상_층_수"]),
    heightM: positiveNumber(properties["높이(m)"]),
    footprintAreaM2: positiveNumber(properties["건축_면적(㎡)"]),
    grossFloorAreaM2: positiveNumber(properties["연면적(㎡)"]),
    useCode: keyString(properties["주_용도_코드"]),
    approvalDate: ymd(properties["사용승인_일"]),
  };
}

const titleInsertCache = new WeakMap<Db, BetterSqlite3.Statement>();
const titleInsert = (db: Db): BetterSqlite3.Statement => {
  const cached = titleInsertCache.get(db);
  if (cached) return cached;
  const prepared = db.prepare(`INSERT INTO ${LEDGER_TITLE_TABLE}
    (pnu, ledger_pk, dong_name, building_name, is_main, floors_above, height_m, footprint_area_m2, gross_floor_area_m2, use_code, approval_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  titleInsertCache.set(db, prepared);
  return prepared;
};

export function insertLedgerTitleIndexRow(db: Db, properties: Props): void {
  const row = titleIndexRow(properties);
  // PK와 PNU가 모두 없는 행은 어떤 건물에도 연결할 수 없으므로 인덱스에
  // 넣지 않는다. 그 외에는 높이/층수/승인일이 모두 비어 있어도 동 매칭에
  // 필요한 식별 정보일 수 있다.
  if (!row.ledgerPk && !row.pnu) return;
  titleInsert(db).run(row.pnu, row.ledgerPk, row.dongName, row.buildingName, row.isMain ? 1 : 0, row.floorsAbove, row.heightM, row.footprintAreaM2, row.grossFloorAreaM2, row.useCode, row.approvalDate);
}

/** buildings 전용 실행에서 표제부 CSV를 스트리밍으로 임시 인덱스에 적재한다. */
export async function buildLedgerTitleIndex(db: Db, records: AsyncIterable<MeasureRecord>, options: { temporary?: boolean; pnuPrefixes?: ReadonlySet<string> } = {}): Promise<number> {
  createLedgerTitleIndex(db, options.temporary ?? false);
  clearLedgerTitleIndex(db);
  const insert = titleInsert(db);
  let count = 0;
  await batched(db, records, (record) => {
    const row = titleIndexRow(record.properties);
    if (!row.ledgerPk && !row.pnu) return;
    if (options.pnuPrefixes && row.pnu && !options.pnuPrefixes.has(row.pnu.slice(0, 2))) return;
    if (options.pnuPrefixes && !row.pnu) return;
    insert.run(row.pnu, row.ledgerPk, row.dongName, row.buildingName, row.isMain ? 1 : 0, row.floorsAbove, row.heightM, row.footprintAreaM2, row.grossFloorAreaM2, row.useCode, row.approvalDate);
    count += 1;
  });
  return count;
}

interface LedgerTitleRow {
  pnu: string | null;
  ledger_pk: string;
  dong_name: string | null;
  building_name: string | null;
  is_main: number;
  floors_above: number | null;
  height_m: number | null;
  footprint_area_m2: number | null;
  gross_floor_area_m2: number | null;
  use_code: string | null;
  approval_date: string | null;
}

function sqlLedgerLookup(db: Db): LedgerFloorLookup {
  const table = titleTableName(db);
  const byPk = db.prepare(`SELECT * FROM ${table} WHERE ledger_pk = ?`);
  const byPnu = db.prepare(`SELECT * FROM ${table} WHERE pnu = ? AND is_main = 1`);
  const pnuExists = db.prepare(`SELECT 1 FROM ${table} WHERE pnu = ? AND is_main = 1 LIMIT 1`);
  const candidate = (row: LedgerTitleRow, method: LedgerFloorMatchMethod): LedgerFloorCandidate => ({
    ledgerPk: row.ledger_pk,
    floorsAbove: row.floors_above,
    heightM: row.height_m,
    approvalDate: row.approval_date,
    dongName: row.dong_name,
    buildingName: row.building_name,
    footprintAreaM2: row.footprint_area_m2,
    grossFloorAreaM2: row.gross_floor_area_m2,
    useCode: row.use_code,
    isMain: row.is_main === 1,
    method,
    pnu: row.pnu,
    name: row.dong_name ?? row.building_name,
  });
  const unique = (rows: LedgerTitleRow[], method: LedgerFloorMatchMethod): LedgerFloorMatch | null => rows.length === 1 ? candidate(rows[0], method) : null;
  const rowMatchesName = (row: LedgerTitleRow, name: string | null): boolean => {
    const source = normalizedLedgerName(name);
    if (!source) return false;
    return normalizedLedgerName(row.dong_name) === source || normalizedLedgerName(row.building_name) === source;
  };
  return {
    hasPnu: (pnu) => Boolean(pnuExists.get(pnu)),
    match: (input) => {
      const direct = input.ledgerPk ? unique(byPk.all(input.ledgerPk) as LedgerTitleRow[], "ledger_pk") : null;
      if (direct) return direct;
      if (!input.pnu) return null;
      const rows = byPnu.all(input.pnu) as LedgerTitleRow[];
      if (rows.length === 1) return unique(rows, "pnu_unique");
      const named = rows.filter((row) => rowMatchesName(row, input.name));
      const nameMatch = unique(named, "pnu_name");
      if (nameMatch) return nameMatch;
      const areaMatched = rows.filter((row) => areaMatches(input.footprintAreaM2, row.footprint_area_m2));
      return unique(areaMatched, "pnu_area");
    },
  };
}

export function ledgerTitleLookup(db: Db | null | undefined): LedgerFloorLookup | null {
  return db && titleTableExists(db) ? sqlLedgerLookup(db) : null;
}

/**
 * 현재 core에 보존된 표제부 층수 후보를 building PNU/대장 PK에 연결한다.
 *
 * housing_complex는 현재 총괄표제부로 집계되어 동별 층수가 없으므로,
 * floorsAbove가 실제로 남아 있는 표제부 후보만 사용한다. PNU 다건은
 * 대장 PK가 맞거나 이름/면적이 하나로 좁혀질 때만 반환한다.
 */
export function ledgerFloorLookup(core: Db | null | undefined): LedgerFloorLookup | null {
  if (!core) return null;
  if (titleTableExists(core)) return sqlLedgerLookup(core);
  const byPnu = new Map<string, LedgerFloorCandidate[]>();
  const byLedgerPk = new Map<string, LedgerFloorCandidate[]>();
  try {
    const rows = core.prepare("SELECT kind, pnu, name, properties_json FROM feature WHERE kind IN ('housing_complex', 'officetel')").all() as Array<{ kind: string; pnu: string | null; name: string | null; properties_json: string }>;
    for (const row of rows) {
      let props: Props;
      try {
        props = JSON.parse(row.properties_json) as Props;
      } catch {
        continue;
      }
      const floorsAbove = positiveInteger(props.floorsAbove);
      const ledgerPk = keyString(props.ledgerPk);
      if (floorsAbove === null || ledgerPk === null) continue;
      const candidate: LedgerFloorCandidate = {
        ledgerPk,
        floorsAbove,
        method: "pnu_unique",
        pnu: /^\d{19}$/.test(row.pnu ?? "") ? row.pnu : null,
        name: keyString(row.name),
        grossFloorAreaM2: propertyNumber(props, ["grossFloorAreaM2", "grossFloorArea", "gross_floor_area_m2", "연면적"]),
        footprintAreaM2: propertyNumber(props, ["footprintAreaM2", "footprintArea", "footprint_area_m2", "건축면적"]),
      };
      const byKey = byLedgerPk.get(ledgerPk) ?? [];
      byKey.push(candidate);
      byLedgerPk.set(ledgerPk, byKey);
      if (candidate.pnu) {
        const byParcel = byPnu.get(candidate.pnu) ?? [];
        byParcel.push(candidate);
        byPnu.set(candidate.pnu, byParcel);
      }
    }
  } catch {
    return null;
  }

  const unique = (candidates: LedgerFloorCandidate[], method: LedgerFloorMatchMethod): LedgerFloorMatch | null => {
    if (candidates.length !== 1) return null;
    return { ledgerPk: candidates[0].ledgerPk, floorsAbove: candidates[0].floorsAbove, method };
  };

  return {
    hasPnu: (pnu) => byPnu.has(pnu),
    match: (input) => {
      const direct = input.ledgerPk ? unique(byLedgerPk.get(input.ledgerPk) ?? [], "ledger_pk") : null;
      if (direct) return direct;
      if (!input.pnu) return null;
      const candidates = byPnu.get(input.pnu) ?? [];
      if (candidates.length === 1) return unique(candidates, "pnu_unique");

      const sourceName = normalizedLedgerName(input.name);
      const named = sourceName ? candidates.filter((candidate) => normalizedLedgerName(candidate.name) === sourceName) : [];
      const nameMatch = unique(named, "pnu_name");
      if (nameMatch) return nameMatch;

      const areaMatched = candidates.filter((candidate) =>
        areaMatches(input.grossFloorAreaM2, candidate.grossFloorAreaM2)
        || areaMatches(input.footprintAreaM2, candidate.footprintAreaM2),
      );
      return unique(areaMatched, "pnu_area");
    },
  };
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
  const recapPks = new Set<string>();
  const officetelPks = new Set<string>();

  await batched(db, input.recap, (r) => {
    const p = r.properties;
    const units = positive(p["세대_수(세대)"]);
    const mainUse = str(p["주_용도_코드_명"]);
    if (units === null && mainUse !== "공동주택") return; // 대상 아님: 세지 않는다
    recapStats.read();
    const loc = ledgerPnu(p);
    if (loc) recapPnus.add(loc.pnu); // 위치를 못 얻어도 표제부 동을 단지로 다시 세지 않는다
    const point = loc ? lookupParcelPoint(db, loc.pnu) : null;
    if (!loc || !point) return recapStats.unlocate();
    const pk = str(p["관리_건축물대장_PK"]) ?? loc.pnu;
    if (recapPks.has(pk)) return recapStats.reject(); // 같은 PK가 또 나옴: 첫 행만 남긴다
    recapPks.add(pk);
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
    recapStats.accept(props, loc.legalCode.slice(0, 2), mainUse ?? "(미상)");
  });

  const housingStats = new SourceStats("ledger_title_housing", input.titleReleaseId, ["units", "approvalDate"]);
  const officetelStats = new SourceStats("ledger_title_officetel", input.titleReleaseId, ["units", "floorsAbove", "approvalDate"]);
  // core의 총괄 feature는 계속 유지하되, buildings 단계가 같은 실행에서
  // 동별 값을 다시 찾을 수 있도록 연결 전용 staging 인덱스에 스트리밍으로
  // 남긴다. TEMP_STORE=MEMORY 설정에서도 3.8GB CSV가 RAM으로 올라가지
  // 않도록 SQLite 파일 테이블을 사용하고, 같은 실행의 buildings 단계가
  // 끝나면 data-build가 삭제한다.
  createLedgerTitleIndex(db, false);
  clearLedgerTitleIndex(db);
  const housing = new Map<string, {
    legalCode: string;
    name: string | null;
    otherUse: string | null;
    units: number;
    approvalDate: string | null;
    buildingCount: number;
    point: readonly [number, number];
    ledgerPk: string | null;
    floorsAbove: number | null;
    grossFloorAreaM2: number | null;
    footprintAreaM2: number | null;
  }>();

  await batched(db, input.title, (r) => {
    const p = r.properties;
    insertLedgerTitleIndexRow(db, p);
    const mainUse = str(p["주_용도_코드_명"]);
    const otherUse = str(p["기타_용도"]);
    if (mainUse === "공동주택") {
      const loc = ledgerPnu(p);
      if (loc && recapPnus.has(loc.pnu)) return; // 총괄표제부 단지의 동: 대상 아님
      housingStats.read();
      if (!loc) return housingStats.unlocate();
      const units = positive(p["세대_수(세대)"]);
      if (units === null) return housingStats.reject(); // 세대 미상
      const ledgerPk = str(p["관리_건축물대장_PK"]) ?? loc.pnu;
      const floorsAbove = positive(p["지상_층_수"]);
      const grossFloorAreaM2 = positive(p["연면적"]);
      const footprintAreaM2 = positive(p["건축면적"]);
      const cur = housing.get(loc.pnu);
      const point = cur ? cur.point : lookupParcelPoint(db, loc.pnu);
      if (!point) return housingStats.unlocate();
      const approval = ymd(p["사용승인_일"]);
      if (cur) {
        cur.units += units;
        cur.buildingCount += 1;
        // 한 PNU에 여러 동을 합치면 어느 동의 층수인지 알 수 없으므로
        // PK·층수·면적을 버리고, 총괄 feature에는 집계값만 남긴다.
        cur.ledgerPk = null;
        cur.floorsAbove = null;
        cur.grossFloorAreaM2 = null;
        cur.footprintAreaM2 = null;
        if (approval && (!cur.approvalDate || approval < cur.approvalDate)) cur.approvalDate = approval;
      } else {
        housing.set(loc.pnu, { legalCode: loc.legalCode, name: str(p["건물_명"]), otherUse, units, approvalDate: approval, buildingCount: 1, point, ledgerPk, floorsAbove, grossFloorAreaM2, footprintAreaM2 });
      }
    } else if (mainUse === "업무시설" && otherUse?.includes("오피스텔")) {
      officetelStats.read();
      const loc = ledgerPnu(p);
      const point = loc ? lookupParcelPoint(db, loc.pnu) : null;
      if (!loc || !point) return officetelStats.unlocate();
      const pk = str(p["관리_건축물대장_PK"]) ?? loc.pnu;
      if (officetelPks.has(pk)) return officetelStats.reject();
      officetelPks.add(pk);
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
    const props: Props = { source: "title", ledgerPk: null, mainUse: "공동주택", otherUse: h.otherUse, units: h.units, households: null, parking: null, approvalDate: h.approvalDate, buildingCount: h.buildingCount };
    if (h.buildingCount === 1 && h.ledgerPk && h.floorsAbove !== null) {
      props.ledgerPk = h.ledgerPk;
      props.floorsAbove = h.floorsAbove;
      if (h.grossFloorAreaM2 !== null) props.grossFloorAreaM2 = h.grossFloorAreaM2;
      if (h.footprintAreaM2 !== null) props.footprintAreaM2 = h.footprintAreaM2;
    }
    insertFeature(db, { stableId: `title-housing:${pnu}`, kind: "housing_complex", sourceKey: pnu, releaseId: input.titleReleaseId, geometry: pointGeometry(h.point), name: h.name, pnu, legalCode: h.legalCode, properties: props });
    for (let i = 0; i < h.buildingCount; i++) housingStats.accept(props, h.legalCode.slice(0, 2), "공동주택"); // 행 단위 집계
  });

  return [recapStats, housingStats, officetelStats];
}
