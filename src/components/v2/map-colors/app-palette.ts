/** 「지금 앱 색」(팔레트 app)의 실제 색. 프리셋과 달리 데이터가 없어서 앱의 레이어 색에서 읽는다. */
import { LAYER_STYLES, LEGEND_GROUPS } from "@/lib/v2/ui/map-layers";
import { paletteColors, type DiagramPaletteColors } from "@/lib/v2/ui/map-palette";

let cached: DiagramPaletteColors | null = null;

/**
 * 범주 8색 = 건축물 용도(`use:`)의 앞 8개 색(목록 색 띠는 이 중 앞 5칸).
 * 순서 5색 = 층수 단계(d05)의 5단계 색. 못 읽으면 `부드러운`의 순서 색.
 */
export function appPaletteColors(): DiagramPaletteColors {
  if (cached) return cached;
  const entries = Object.entries(LAYER_STYLES);
  const cat = entries.filter(([key]) => key.startsWith("use:")).slice(0, 8).map(([, style]) => style.color);
  const seq = entries
    .filter(([key, style]) => style.legendGroup === LEGEND_GROUPS.d05Floors && !/(unknown|missing|assumed)/.test(key))
    .sort((a, b) => (a[1].legendOrder ?? 0) - (b[1].legendOrder ?? 0))
    .map(([, style]) => style.color);
  cached = { cat: cat.length === 8 ? cat : [...paletteColors("soft")!.cat], seq: seq.length === 5 ? seq : [...paletteColors("soft")!.seq] };
  return cached;
}
