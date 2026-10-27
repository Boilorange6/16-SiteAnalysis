/** 「내 테마」: 사용자가 만든 바탕 색 7개·다이어그램 팔레트를 계정에 저장한다. 종류마다 최대 12개. */
import { getDb } from "./database";
import { COLOR_KEYS, isBaseThemeRef, type BaseThemeColors } from "../v2/ui/map-theme";
import { isPaletteRef, type DiagramPaletteColors } from "../v2/ui/map-palette";

export type MapColorKind = "base" | "palette";
export type SavedBase = { id: number; name: string; colors: BaseThemeColors };
export type SavedPalette = { id: number; name: string; colors: DiagramPaletteColors };

export const MAX_SAVED_PER_KIND = 12;
const NAME_PREFIX = "내 테마 ";

type Row = { id: number; kind: MapColorKind; name: string; colors: string };

/** 요청 본문을 검사해 { kind, colors }로 줄인다. 모르는 kind·형식이 틀린 색이면 null. */
export function parseMapColorBody(body: unknown): { kind: "base"; colors: BaseThemeColors } | { kind: "palette"; colors: DiagramPaletteColors } | null {
  if (!body || typeof body !== "object") return null;
  const { kind, colors } = body as { kind?: unknown; colors?: unknown };
  if (kind === "base" && isBaseThemeRef({ name: "x", colors })) {
    const c = colors as Record<string, string>;
    return { kind, colors: Object.fromEntries(COLOR_KEYS.map((k) => [k, c[k]])) as BaseThemeColors };
  }
  if (kind === "palette" && isPaletteRef({ name: "x", colors })) {
    const c = colors as DiagramPaletteColors;
    return { kind, colors: { cat: [...c.cat], seq: [...c.seq] } };
  }
  return null;
}

const toSaved = (row: Row): SavedBase | SavedPalette => ({ id: row.id, name: row.name, colors: JSON.parse(row.colors) });

export function listMapColors(userId: number): { base: SavedBase[]; palette: SavedPalette[] } {
  const rows = getDb()
    .prepare("SELECT id, kind, name, colors FROM user_map_colors WHERE user_id = ? ORDER BY id DESC")
    .all(userId) as Row[];
  return {
    base: rows.filter((r) => r.kind === "base").map((r) => toSaved(r) as SavedBase),
    palette: rows.filter((r) => r.kind === "palette").map((r) => toSaved(r) as SavedPalette),
  };
}

export function saveMapColor(userId: number, kind: "base", colors: BaseThemeColors): SavedBase;
export function saveMapColor(userId: number, kind: "palette", colors: DiagramPaletteColors): SavedPalette;
export function saveMapColor(userId: number, kind: MapColorKind, colors: BaseThemeColors | DiagramPaletteColors): SavedBase | SavedPalette;
export function saveMapColor(userId: number, kind: MapColorKind, colors: BaseThemeColors | DiagramPaletteColors): SavedBase | SavedPalette {
  const parsed = parseMapColorBody({ kind, colors });
  if (!parsed) throw new Error("invalid map colors");
  const db = getDb();
  return db.transaction(() => {
    // 번호는 이 사용자·종류에 남은 이름 중 가장 큰 번호 + 1 — 중간 것을 지우거나 오래된 것이 밀려나도 겹치지 않는다.
    const names = db.prepare("SELECT name FROM user_map_colors WHERE user_id = ? AND kind = ?").all(userId, kind) as { name: string }[];
    const last = Math.max(0, ...names.map((r) => Number(r.name.slice(NAME_PREFIX.length)) || 0));
    const name = `${NAME_PREFIX}${last + 1}`;
    const info = db
      .prepare("INSERT INTO user_map_colors (user_id, kind, name, colors, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(userId, kind, name, JSON.stringify(parsed.colors), Date.now() / 1000);
    db.prepare(
      "DELETE FROM user_map_colors WHERE user_id = ? AND kind = ? AND id NOT IN (SELECT id FROM user_map_colors WHERE user_id = ? AND kind = ? ORDER BY id DESC LIMIT ?)",
    ).run(userId, kind, userId, kind, MAX_SAVED_PER_KIND);
    return { id: Number(info.lastInsertRowid), name, colors: parsed.colors } as SavedBase | SavedPalette;
  })();
}

/** 내 것이 아니거나 없으면 false. */
export function deleteMapColor(userId: number, id: number): boolean {
  return getDb().prepare("DELETE FROM user_map_colors WHERE id = ? AND user_id = ?").run(id, userId).changes > 0;
}
