/** 「내 테마」 계정 저장을 부르는 브라우저 쪽. 목록 읽기는 실패해도 빈 목록을 돌려주고, 저장·삭제 실패는 던져서 팝오버가 인라인 문구로 보인다. */
import { authFetch } from "@/lib/auth-fetch";
import type { SavedBase, SavedPalette } from "@/lib/server/map-color-store";
import type { BaseThemeColors } from "./map-theme";
import type { DiagramPaletteColors } from "./map-palette";

export type { SavedBase, SavedPalette };
export type MyColors = { base: SavedBase[]; palette: SavedPalette[] };

const ENDPOINT = "/site/api/user/map-colors";
export const SAVE_FAILED_MESSAGE = "내 테마를 저장하지 못했습니다";

export async function loadMyColors(): Promise<MyColors> {
  try {
    const res = await authFetch(ENDPOINT);
    if (!res.ok) return { base: [], palette: [] };
    const data = (await res.json()) as Partial<MyColors>;
    return { base: Array.isArray(data.base) ? data.base : [], palette: Array.isArray(data.palette) ? data.palette : [] };
  } catch {
    return { base: [], palette: [] };
  }
}

export async function saveMyColor(kind: "base", colors: BaseThemeColors): Promise<SavedBase>;
export async function saveMyColor(kind: "palette", colors: DiagramPaletteColors): Promise<SavedPalette>;
export async function saveMyColor(kind: "base" | "palette", colors: BaseThemeColors | DiagramPaletteColors): Promise<SavedBase | SavedPalette> {
  const res = await authFetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, colors }) });
  if (!res.ok) throw new Error(SAVE_FAILED_MESSAGE);
  return res.json();
}

export async function removeMyColor(id: number): Promise<void> {
  const res = await authFetch(`${ENDPOINT}?id=${id}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new Error("내 테마를 지우지 못했습니다");
}
