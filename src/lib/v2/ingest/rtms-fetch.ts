/**
 * 국토부 실거래(RTMS) 원천 수집: (유형, 계약월, 시군구) 한 칸 = 원본 파일 하나.
 *   <raw>/rtms/<type>/<yyyymm>/<lawd>.json  = { type, lawd, ym, fetchedAt, totalCount, items:[{태그:값}] }
 * 이어받기: 파일이 있으면 건너뛴다. 하루 호출 한도는 원장(<raw>/rtms/_ledger.json)으로 세어 유형별 한도 전에 깨끗이 멈춘다.
 * 서비스키는 요청 URL에 실리므로 오류·로그 문장에서는 항상 가린다.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const RTMS_TYPES = {
  "apt-trade": "https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev",
  "apt-rent": "https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent",
  "offi-trade": "https://apis.data.go.kr/1613000/RTMSDataSvcOffiTrade/getRTMSDataSvcOffiTrade",
  "offi-rent": "https://apis.data.go.kr/1613000/RTMSDataSvcOffiRent/getRTMSDataSvcOffiRent",
} as const;
export type RtmsType = keyof typeof RTMS_TYPES;

const PAGE_ROWS = 1000;
const MAX_PAGES = 30;
const TIMEOUT_MS = 20_000;
export const DAILY_LIMIT = 9_500; // 개발계정 유형(API)별 10,000/일 중 여유 500

export class BudgetStop extends Error {}
export class FatalKeyError extends Error {}

export const maskKey = (text: string, key: string): string => (key ? text.split(key).join("***").split(encodeURIComponent(key)).join("***") : text);

export interface RtmsRawFile {
  type: RtmsType;
  lawd: string;
  ym: string;
  fetchedAt: string;
  totalCount: number;
  items: Record<string, string>[];
}

const clean = (s: string) => s.replaceAll("<![CDATA[", "").replaceAll("]]>", "").trim();

/** 응답 XML → { totalCount, items }. 오류 응답은 throw(code를 message에 담는다) */
export function parseRtmsXml(xml: string): { totalCount: number; items: Record<string, string>[] } {
  if (!/<response[\s>]/u.test(xml)) {
    const code = /<returnReasonCode>\s*(\d+)/u.exec(xml)?.[1] ?? "";
    throw Object.assign(new Error(`RTMS 응답 형식 오류${code ? ` (code ${code})` : ""}`), { code });
  }
  const code = /<resultCode>\s*(\S+?)\s*<\/resultCode>/u.exec(xml)?.[1] ?? "";
  if (code && code !== "00" && code !== "000") {
    const msg = /<resultMsg>([\s\S]*?)<\/resultMsg>/u.exec(xml)?.[1]?.trim() ?? "";
    throw Object.assign(new Error(`RTMS 오류 ${code} ${msg}`.trim()), { code });
  }
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gu)].map((m) => {
    const o: Record<string, string> = {};
    for (const t of (m[1] ?? "").matchAll(/<(\w+)>([\s\S]*?)<\/\1>/gu)) o[t[1] as string] = clean(t[2] as string);
    return o;
  });
  const total = Number(/<totalCount>\s*(\d+)/u.exec(xml)?.[1] ?? items.length);
  return { totalCount: total, items };
}

// ---- 호출 원장 ----
type LedgerData = Record<string, Record<string, number>>; // 날짜 → 유형 → 호출 수
export class Ledger {
  private data: LedgerData = {};
  private dirty = 0;
  constructor(private readonly path: string, private readonly today: string) {
    if (existsSync(path)) this.data = JSON.parse(readFileSync(path, "utf8")) as LedgerData;
  }
  count(type: string): number {
    return this.data[this.today]?.[type] ?? 0;
  }
  spend(type: string, limit: number): void {
    if (this.count(type) >= limit) throw new BudgetStop(`${type} 일일 호출 한도 ${limit} 도달`);
    const day = (this.data[this.today] ??= {});
    day[type] = (day[type] ?? 0) + 1;
    if (++this.dirty >= 10) this.flush();
  }
  flush(): void {
    this.dirty = 0;
    writeAtomic(this.path, JSON.stringify(this.data, null, 1));
  }
}

export function writeAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

export const rawPath = (rawDir: string, type: string, ym: string, lawd: string): string => join(rawDir, "rtms", type, ym, `${lawd}.json`);

export function monthsBetween(from: string, to: string): string[] {
  const ok = /^\d{4}-\d{2}$/;
  if (!ok.test(from) || !ok.test(to) || from > to) throw new Error(`잘못된 기간 ${from}..${to} (yyyy-mm)`);
  const out: string[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5));
  while (`${y}-${String(m).padStart(2, "0")}` <= to) {
    out.push(`${y}${String(m).padStart(2, "0")}`);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

export interface FetchOptions {
  serviceKey: string;
  rawDir: string;
  types: RtmsType[];
  months: string[]; // yyyymm
  lawds: string[];
  fetchImpl?: typeof fetch;
  concurrency?: number;
  dailyLimit?: number;
  today?: string;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /** 이미 있는 파일도 다시 받는다(진행 중인 달 갱신용) */
  refetch?: boolean;
  /** 시간 예산: 이 시각을 넘으면 새 칸을 시작하지 않고 멈춘다 */
  deadline?: number;
  log?: (line: string) => void;
}

export interface FetchSummary {
  calls: Record<string, number>;
  done: number;
  skipped: number;
  failed: { cell: string; error: string }[];
  budgetStopped: string[];
  deadlineHit: boolean;
  fatal: string | null;
  rows: number;
}

export async function fetchRtms(o: FetchOptions): Promise<FetchSummary> {
  const fetchImpl = o.fetchImpl ?? fetch;
  const sleep = o.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const limit = o.dailyLimit ?? DAILY_LIMIT;
  const now = o.now ?? (() => new Date());
  const today = o.today ?? new Date(now().getTime() + 9 * 3600_000).toISOString().slice(0, 10); // KST 날짜
  const ledger = new Ledger(join(o.rawDir, "rtms", "_ledger.json"), today);
  const log = o.log ?? (() => {});
  const sum: FetchSummary = { calls: {}, done: 0, skipped: 0, failed: [], budgetStopped: [], deadlineHit: false, fatal: null, rows: 0 };
  const mask = (s: string) => maskKey(s, o.serviceKey);

  const cells: { type: RtmsType; ym: string; lawd: string }[] = [];
  for (const type of o.types) for (const ym of o.months) for (const lawd of o.lawds) cells.push({ type, ym, lawd });

  async function call(type: RtmsType, ym: string, lawd: string, pageNo: number) {
    const url = `${RTMS_TYPES[type]}?serviceKey=${encodeURIComponent(o.serviceKey)}&LAWD_CD=${lawd}&DEAL_YMD=${ym}&numOfRows=${PAGE_ROWS}&pageNo=${pageNo}`;
    for (let attempt = 0; ; attempt++) {
      ledger.spend(type, limit); // 재시도도 호출로 센다
      sum.calls[type] = (sum.calls[type] ?? 0) + 1;
      try {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
        let res: Response;
        try {
          res = await fetchImpl(url, { signal: ac.signal });
        } finally {
          clearTimeout(timer);
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return parseRtmsXml(await res.text());
      } catch (e) {
        const code = (e as { code?: string }).code ?? "";
        if (code === "22") throw new BudgetStop("서비스 측 일일 한도 초과(22)");
        if (["20", "30", "31", "32", "33"].includes(code)) throw new FatalKeyError(`서비스키 오류 code ${code}`);
        if (attempt >= 3) throw new Error(mask(String((e as Error).message ?? e)));
        await sleep(1000 * 2 ** attempt);
      }
    }
  }

  let next = 0;
  async function worker() {
    while (!sum.fatal) {
      const cell = cells[next++];
      if (!cell) return;
      if (o.deadline && Date.now() > o.deadline) { sum.deadlineHit = true; return; }
      const path = rawPath(o.rawDir, cell.type, cell.ym, cell.lawd);
      if (!o.refetch && existsSync(path)) { sum.skipped++; continue; }
      if (ledger.count(cell.type) >= limit) { if (!sum.budgetStopped.includes(cell.type)) sum.budgetStopped.push(cell.type); continue; }
      try {
        const items: Record<string, string>[] = [];
        let total = 0;
        for (let page = 1; page <= MAX_PAGES; page++) {
          const r = await call(cell.type, cell.ym, cell.lawd, page);
          total = r.totalCount;
          items.push(...r.items);
          if (items.length >= total || r.items.length === 0) break;
        }
        if (items.length !== total) throw new Error(`불완전 수집 ${items.length}/${total}`);
        const file: RtmsRawFile = { ...cell, fetchedAt: now().toISOString(), totalCount: total, items };
        writeAtomic(path, JSON.stringify(file));
        sum.done++;
        sum.rows += items.length;
      } catch (e) {
        if (e instanceof BudgetStop) {
          if (!sum.budgetStopped.includes(cell.type)) sum.budgetStopped.push(cell.type);
          log(`budget stop ${cell.type}: ${e.message}`);
        } else if (e instanceof FatalKeyError) {
          sum.fatal = e.message;
        } else {
          sum.failed.push({ cell: `${cell.type}/${cell.ym}/${cell.lawd}`, error: mask(String((e as Error).message ?? e)) });
        }
      }
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(o.concurrency ?? 4, 4) }, worker));
  } finally {
    ledger.flush();
  }
  return sum;
}
