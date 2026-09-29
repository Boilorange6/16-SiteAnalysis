/**
 * 키를 정렬한 JSON. manifest 해시와 타일 캐시 키가 키 순서에 흔들리지 않게 한다.
 */
import { createHash } from "node:crypto";

export function canonicalJson(value: unknown): string {
  if (value === undefined) throw new TypeError("canonicalJson: undefined is not serializable");
  if (typeof value === "number" && !Number.isFinite(value)) throw new TypeError("canonicalJson: non-finite number");
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
