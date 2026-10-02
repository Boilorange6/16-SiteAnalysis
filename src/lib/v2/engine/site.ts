/**
 * 입력(지번 주소 또는 좌표) → 분석 중심점. 도로명 주소는 받지 않는다(지번만).
 * 확신이 없으면 실패 이유를 돌려준다 — 비슷한 곳에 찍지 않는다.
 */
import type BetterSqlite3 from "better-sqlite3";
import type { LngLat } from "../crs";
import { resolveJibunDetailed } from "../data/jibun";
import { lookupParcelPoint } from "../data/parcels";
import { isRoadAddress, ROAD_ADDRESS_UNSUPPORTED_MESSAGE } from "../site";

export type SiteFailure = "parse_failed" | "not_found" | "ambiguous" | "no_point" | "road_address_unsupported";
export type SiteResult =
  | { ok: true; center: LngLat; pnu: string | null; legalCode: string | null; jimok: string | null; label: string }
  | { ok: false; reason: SiteFailure };

export function resolveSite(core: BetterSqlite3.Database, input: { address?: string; center?: LngLat }): SiteResult {
  const address = input.address?.trim().replace(/\s+/g, " ") ?? "";
  if (input.center) {
    const [lng, lat] = input.center;
    return { ok: true, center: [lng, lat], pnu: null, legalCode: null, jimok: null, label: address || `좌표 ${lng.toFixed(5)}, ${lat.toFixed(5)}` };
  }
  if (!address) return { ok: false, reason: "parse_failed" };
  if (isRoadAddress(address)) return { ok: false, reason: "road_address_unsupported" };
  const r = resolveJibunDetailed(core, address);
  if ("reason" in r) return { ok: false, reason: r.reason };
  const point = lookupParcelPoint(core, r.pnu);
  if (!point) return { ok: false, reason: "no_point" };
  const jimok = core.prepare("SELECT jimok FROM parcel_point WHERE pnu = ?").pluck().get(r.pnu) as string | null | undefined;
  return { ok: true, center: point, pnu: r.pnu, legalCode: r.legalCode, jimok: jimok ?? null, label: address };
}

/** 화면에 그대로 보여 줄 안내 문구 */
export const SITE_FAILURE_MESSAGE: Record<SiteFailure, string> = {
  road_address_unsupported: ROAD_ADDRESS_UNSUPPORTED_MESSAGE,
  parse_failed: "지번 주소로 입력해 주세요. 예: 서울 강동구 고덕동 123",
  not_found: "주소를 찾지 못했습니다. 시·도, 시·군·구, 동·리 이름을 확인해 주세요.",
  ambiguous: "동·리까지 입력해 주세요.",
  no_point: "필지 위치 미확보 — 이 필지의 위치 자료가 아직 적재되지 않았습니다.",
};
