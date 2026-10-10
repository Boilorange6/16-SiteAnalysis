/**
 * 국토부 실거래(RTMS) 원본 파일 → property_transaction (market).
 *
 * - 행 한 건 = 원천 item 한 건. 취소 거래(cdealType "O")도 버리지 않고 cancelled_at을 채운다(소비 쪽이 걸러 쓴다).
 * - transaction_id = "rtms:" + sha256(자연키).slice(0,20). 자연키 = 유형|시군구|법정동|지번|단지명|동|계약일|금액(거래가 또는 보증금/월세)|전용면적|층|매수자·매도자 구분|거래유형(중개/직거래)|중개사 소재지|(전월세) 계약기간·구분.
 *   취소·등기일 필드는 뺀다 — 같은 거래가 나중에 취소돼도 id가 같아야 재적재가 안정적이다.
 *   자연키가 완전히 같은 행은 중복으로 보고 첫 행만 남기며 rejected로 센다(동·호를 밝히지 않는 원천이라 실제 별개 거래가 합쳐질 수 있는 상한).
 * - 위치: 법정동(sggCd+umdCd)+지번 → PNU(makePnu) → core parcel_point. 구조화 코드가 없으면 시군구명+읍면동+지번을 resolveJibunDetailed로 푼다.
 *   PNU를 못 만들거나 대표점이 없으면 match_status "unlocated"로 행은 남기고(location_id NULL) unlocated로 센다.
 * - 금액은 만원 → 원. 건축연도·단지명은 스키마에 열이 없어 적재하지 않는다(원본 파일에 남아 있다).
 * - SourceStats 불변식: received = accepted(located) + unlocated + rejected. 시도(LAWD_CD 앞 2자리)별 표는 release coverage에 남긴다.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type BetterSqlite3 from "better-sqlite3";
import { sha256Hex } from "../../canonical-json";
import { resolveJibunDetailed } from "../../data/jibun";
import { lookupParcelPoint, makePnu } from "../../data/parcels";
import { batched, insertRelease, SourceStats } from "../build";
import { RTMS_TYPES, type RtmsRawFile, type RtmsType } from "../rtms-fetch";

type Db = BetterSqlite3.Database;
type Item = Record<string, string>;

const PROPERTY: Record<RtmsType, string> = { "apt-trade": "apt", "apt-rent": "apt", "offi-trade": "offi", "offi-rent": "offi" };
const PROVIDER = "국토교통부(실거래가 공개시스템)";
// A0 표 15행에서 확인한 개별 데이터셋 번호(아파트 매매·오피스텔 전월세). 나머지는 모음 페이지.
const COLLECTION = "https://www.data.go.kr/dataset/3050988/openapi.do";
const URLS: Record<RtmsType, string> = {
  "apt-trade": "https://www.data.go.kr/data/15126469/openapi.do",
  "apt-rent": COLLECTION,
  "offi-trade": COLLECTION,
  "offi-rent": "https://www.data.go.kr/data/15126475/openapi.do",
};

const num = (v: string | undefined): number | null => {
  const s = (v ?? "").replaceAll(",", "").trim();
  const n = Number(s);
  return s !== "" && Number.isFinite(n) ? n : null;
};
const manwon = (v: string | undefined): number | null => {
  const n = num(v);
  return n === null ? null : Math.round(n * 10_000);
};

/** cdealDay "26.03.15" / "2026-03-15" / "20260315" → ISO 날짜. 못 읽으면 null */
export function parseCancelDate(v: string | undefined): string | null {
  const s = (v ?? "").trim();
  let m = /^(\d{4})[-.](\d{2})[-.](\d{2})$/.exec(s) ?? /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{2})[-.](\d{2})[-.](\d{2})$/.exec(s);
  return m ? `20${m[1]}-${m[2]}-${m[3]}` : null;
}

export interface TxRow {
  transactionId: string;
  sourceRecordKey: string;
  lawd: string;
  dealDate: string;
  propertyType: string;
  contractType: string;
  renewal: "new" | "renewal" | null;
  priceKrw: number | null;
  depositKrw: number | null;
  rentKrw: number | null;
  areaM2: number | null;
  floor: number | null;
  cancelledAt: string | null;
  item: Item;
}

/** item 한 건을 표준 행으로. 계약일·금액이 없으면 null(reject) */
export function toTxRow(type: RtmsType, lawdOfFile: string, fetchedDate: string, it: Item): TxRow | null {
  const y = Number(it.dealYear);
  const mo = Number(it.dealMonth);
  const d = Number(it.dealDay);
  if (!(y >= 2000) || !(mo >= 1 && mo <= 12) || !(d >= 1 && d <= 31)) return null;
  const isRent = type.endsWith("rent");
  const price = isRent ? null : manwon(it.dealAmount);
  const deposit = isRent ? manwon(it.deposit) : null;
  const monthly = isRent ? (manwon(it.monthlyRent) ?? 0) : null;
  if (isRent ? deposit === null || (deposit <= 0 && !monthly) : price === null || price <= 0) return null;
  const lawd = /^\d{5}$/.test(it.sggCd ?? "") ? (it.sggCd as string) : lawdOfFile;
  const dealDate = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const name = it.aptNm ?? it.offiNm ?? "";
  const floor = num(it.floor);
  const contractType = isRent ? ((monthly ?? 0) > 0 ? "monthly" : "jeonse") : "trade";
  const renewal = !isRent ? null : it.contractType?.trim() === "신규" ? "new" : it.contractType?.trim() === "갱신" ? "renewal" : null;
  const key = [PROPERTY[type], isRent ? "rent" : "trade", lawd, it.umdCd ?? it.umdNm ?? "", it.jibun ?? "", name, it.aptDong ?? "", dealDate, it.dealAmount?.replaceAll(",", "") ?? "", it.deposit?.replaceAll(",", "") ?? "", it.monthlyRent?.replaceAll(",", "") ?? "", it.excluUseAr ?? "", it.floor ?? "", it.buyerGbn ?? "", it.slerGbn ?? "", it.dealingGbn ?? "", it.estateAgentSggNm ?? "", it.contractTerm ?? "", it.contractType ?? ""].join("|");
  const cancelled = (it.cdealType ?? "").trim().toUpperCase() === "O";
  return {
    transactionId: `rtms:${sha256Hex(key).slice(0, 20)}`,
    sourceRecordKey: key,
    lawd,
    dealDate,
    propertyType: PROPERTY[type],
    contractType,
    renewal,
    priceKrw: price,
    depositKrw: deposit,
    rentKrw: monthly,
    areaM2: num(it.excluUseAr),
    floor: floor === null || !Number.isInteger(floor) ? null : floor,
    // 취소일이 비어 있으면 원본을 받은 날을 쓴다("그 시점에는 취소돼 있었다")
    cancelledAt: cancelled ? (parseCancelDate(it.cdealDay) ?? fetchedDate) : null,
    item: it,
  };
}

/** 원본 파일 폴더의 (type → 파일 경로들). 없는 유형은 빠진다 */
export function listRtmsFiles(rawDir: string): Map<RtmsType, string[]> {
  const out = new Map<RtmsType, string[]>();
  for (const type of Object.keys(RTMS_TYPES) as RtmsType[]) {
    const base = join(rawDir, "rtms", type);
    if (!existsSync(base)) continue;
    const files: string[] = [];
    for (const ym of readdirSync(base).sort()) for (const f of readdirSync(join(base, ym)).sort()) if (/^\d{5}\.json$/.test(f)) files.push(join(base, ym, f));
    if (files.length > 0) out.set(type, files);
  }
  return out;
}

export function hasRtmsRaw(rawDir: string): boolean {
  return listRtmsFiles(rawDir).size > 0;
}

function locate(core: Db, sigName: Map<string, string>, lawd: string, it: Item): { pnu: string } | null {
  let pnu: string | null = null;
  if (/^\d{5}$/.test(it.umdCd ?? "") && /^\d+$/.test(it.bonbun ?? "")) {
    const mountain = it.landCd === "2" || /^산/.test(it.jibun ?? "");
    pnu = makePnu(`${lawd}${it.umdCd}`, mountain, it.bonbun as string, it.bubun || 0);
  } else if (it.umdNm && it.jibun && sigName.has(lawd)) {
    const r = resolveJibunDetailed(core, `${sigName.get(lawd)} ${it.umdNm} ${it.jibun}`);
    pnu = "pnu" in r ? r.pnu : null;
  }
  return pnu && lookupParcelPoint(core, pnu) ? { pnu } : null;
}

export interface Tally {
  received: number;
  accepted: number;
  unlocated: number;
  rejected: number;
}

/** raw가 있는 유형마다 release 하나와 SourceStats 하나를 만든다. 원본이 없으면 빈 배열 */
export async function buildRtms(db: Db, input: { core: Db; rawDir: string; now?: Date }): Promise<SourceStats[]> {
  const sigName = new Map((input.core.prepare("SELECT code, name FROM legal_area WHERE level = 'sigungu'").all() as { code: string; name: string }[]).map((r) => [r.code, r.name]));
  const runAt = (input.now ?? new Date()).toISOString();
  const out: SourceStats[] = [];
  const insert = db.prepare(`INSERT INTO property_transaction (transaction_id, source_record_key, lawd_cd, deal_date, property_type, contract_type, renewal, price_krw, deposit_krw, rent_krw, area_m2, floor, cancelled_at, location_id, match_status, release_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  for (const [type, files] of listRtmsFiles(input.rawDir)) {
    const latestYm = files.map((f) => f.split(/[\\/]/).at(-2) as string).sort().at(-1) as string;
    const lastDay = new Date(Date.UTC(Number(latestYm.slice(0, 4)), Number(latestYm.slice(4)), 0)).getUTCDate();
    const releaseId = insertRelease(db, {
      sourceId: `rtms_${type.replace("-", "_")}`, provider: PROVIDER, sourceUrl: URLS[type],
      sourceAsOf: `${latestYm.slice(0, 4)}-${latestYm.slice(4)}-${lastDay}`, fetchedAt: runAt,
      checksum: `files:${files.length}`, licenseCode: "UNRESTRICTED",
    });
    const stats = new SourceStats(`rtms_${type.replace("-", "_")}`, releaseId, ["area_m2", "floor"]);
    const tally: Record<string, Tally> = {};
    const seen = new Set<string>();
    function* rows() {
      for (const f of files) {
        const raw = JSON.parse(readFileSync(f, "utf8")) as RtmsRawFile;
        for (const item of raw.items) yield { raw, item };
      }
    }
    await batched(db, rows(), ({ raw, item }) => {
      stats.read();
      const t = (tally[raw.lawd.slice(0, 2)] ??= { received: 0, accepted: 0, unlocated: 0, rejected: 0 });
      t.received++;
      const row = toTxRow(type, raw.lawd, raw.fetchedAt.slice(0, 10), item);
      if (!row || seen.has(row.transactionId)) {
        t.rejected++;
        return stats.reject();
      }
      seen.add(row.transactionId);
      const loc = locate(input.core, sigName, row.lawd, item);
      insert.run(row.transactionId, row.sourceRecordKey, row.lawd, row.dealDate, row.propertyType, row.contractType, row.renewal, row.priceKrw, row.depositKrw, row.rentKrw, row.areaM2, row.floor, row.cancelledAt, loc?.pnu ?? null, loc ? "located" : "unlocated", releaseId);
      const region = row.lawd.slice(0, 2);
      if (!loc) {
        t.unlocated++;
        return stats.unlocate();
      }
      t.accepted++;
      stats.accept({ area_m2: row.areaM2, floor: row.floor }, region, `${row.propertyType}-${row.contractType}`);
    });
    const cancelled = db.prepare("SELECT COUNT(*) FROM property_transaction WHERE release_id = ? AND cancelled_at IS NOT NULL").pluck().get(releaseId) as number;
    db.prepare("UPDATE source_release SET coverage_json = ? WHERE release_id = ?").run(JSON.stringify({ byRegion: tally, files: files.length, cancelled, note: "위치 = 법정동+지번→PNU→parcel_point. unlocated 행도 테이블에 남김(location_id NULL). 시도 2자리는 LAWD_CD 앞자리." }), releaseId);
    stats.expectedRegions = Object.entries(tally).filter(([, v]) => v.accepted > 0).map(([k]) => k);
    out.push(stats);
  }
  return out;
}
