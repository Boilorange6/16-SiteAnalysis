/**
 * 배경지도 타일 프록시의 로직(서버 전용). VWorld 키는 서버 환경변수에만 있고 브라우저로 나가지 않는다.
 * VWorld WMTS 주소는 .../{KEY}/{layer}/{z}/{행 y}/{열 x}.{ext} — z/y/x 순서(z15 행12700 열27946 = 서울).
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const TILE_LAYERS = {
  white: { ext: "png", type: "image/png" },
  Base: { ext: "png", type: "image/png" },
  Satellite: { ext: "jpeg", type: "image/jpeg" },
  Hybrid: { ext: "png", type: "image/png" },
} as const;
export type TileLayer = keyof typeof TILE_LAYERS;

const MIN_Z = 6;
const MAX_Z = 19;
export const TILE_CACHE_CONTROL = "public, max-age=604800, immutable";

export type TileParams = { layer: string; z: string; y: string; x: string };
export type TileRef = { layer: TileLayer; z: number; y: number; x: number };

/** Origin이 없을 때만 Referer를 보조로 사용하고, 실제 요청 host와 정확히 비교한다. */
export function sameOriginRequest(origin: string | null, referer: string | null, requestHost: string | null): boolean {
  if (!requestHost) return false;
  const candidate = origin ?? referer;
  if (!candidate) return false;
  try {
    return new URL(candidate).host.toLowerCase() === requestHost.trim().toLowerCase();
  } catch {
    return false;
  }
}

/** 검증: 화이트리스트 레이어, 정수 z 6–19, 0 ≤ y,x < 2^z. 실패하면 null. */
export function parseTile(p: TileParams): TileRef | null {
  if (!Object.prototype.hasOwnProperty.call(TILE_LAYERS, p.layer)) return null;
  const num = (s: string) => (/^\d{1,8}$/.test(s) ? Number(s) : NaN);
  const [z, y, x] = [num(p.z), num(p.y), num(p.x)];
  if (!(z >= MIN_Z && z <= MAX_Z)) return null;
  const n = 2 ** z;
  if (!(y < n && x < n)) return null;
  return { layer: p.layer as TileLayer, z, y, x };
}

export function tileCachePath(t: TileRef, root = process.env.V2_TILE_CACHE_DIR || resolve(process.cwd(), ".cache/v2/tiles")): string {
  return resolve(root, t.layer, String(t.z), String(t.y), `${t.x}.${TILE_LAYERS[t.layer].ext}`);
}

// ponytail: 프로세스 하나 안의 토큰 버킷(초당 50, 순간 200). 여러 인스턴스로 널리 배포하면 공유 리미터(예: 앞단 프록시·Redis)로 옮긴다.
const RATE = 50;
const BURST = 200;
let tokens = BURST;
let last = Date.now();
export function takeToken(now = Date.now()): boolean {
  tokens = Math.min(BURST, tokens + ((now - last) / 1000) * RATE);
  last = now;
  if (tokens < 1) return false;
  tokens -= 1;
  return true;
}
export function resetLimiter() {
  tokens = BURST;
  last = Date.now();
}

export type TileReply = { status: number; body: Uint8Array | string; type: string; cache?: boolean };
const text = (status: number, body: string): TileReply => ({ status, body, type: "text/plain; charset=utf-8" });

export type TileDeps = { fetch?: typeof fetch; key?: string | undefined; cacheRoot?: string; now?: number };

export async function serveTile(p: TileParams, secFetchSite: string | null, deps: TileDeps = {}): Promise<TileReply> {
  if (secFetchSite === "cross-site") return text(403, "허용되지 않은 요청");
  const t = parseTile(p);
  if (!t) return text(400, "잘못된 타일 주소");
  if (!takeToken(deps.now)) return text(429, "요청이 너무 많음");
  const meta = TILE_LAYERS[t.layer];
  const file = tileCachePath(t, deps.cacheRoot);
  try {
    return { status: 200, body: await readFile(file), type: meta.type, cache: true };
  } catch {
    /* 캐시 없음 → 받아 온다 */
  }
  const key = "key" in deps ? deps.key : process.env.VWORLD_API_KEY;
  if (!key) return text(503, "배경지도 키 미설정");
  try {
    const res = await (deps.fetch ?? fetch)(`https://api.vworld.kr/req/wmts/1.0.0/${encodeURIComponent(key)}/${t.layer}/${t.z}/${t.y}/${t.x}.${meta.ext}`, {
      signal: AbortSignal.timeout(8000),
    });
    // 잘못된 요청도 200 + XML로 오므로 이미지인지 확인한다.
    if (!res.ok || !(res.headers.get("content-type") ?? "").startsWith("image/")) return text(502, "배경지도 서버 오류");
    const bytes = new Uint8Array(await res.arrayBuffer());
    // 같은 타일을 동시에 받아도 마지막 rename이 이길 뿐 내용은 같다.
    const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    try {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(tmp, bytes);
      await rename(tmp, file);
    } catch {
      /* 캐시 쓰기 실패는 응답을 막지 않는다 */
    }
    return { status: 200, body: bytes, type: meta.type };
  } catch {
    return text(502, "배경지도 서버 오류"); // 오류 객체·주소(키 포함)를 싣지 않는다
  }
}
