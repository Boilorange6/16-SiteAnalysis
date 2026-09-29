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
