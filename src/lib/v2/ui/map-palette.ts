/** 다이어그램 팔레트: 범주형 8색·순서형 5색을 레이어 스타일에 입힌다. 순수 데이터·함수. */
import { h2r, r2h } from "./map-color";
import { LAYER_STYLES, LEGEND_GROUPS, type LayerStyle } from "./map-layers";

export type DiagramPaletteId = "app" | "soft" | "vivid" | "earth" | "pastel" | "safe" | "sea" | "gray";
/** cat 8색(범주형) + seq 5색(순서형, 낮음→높음) */
export type DiagramPaletteColors = { cat: string[]; seq: string[] };
export type DiagramPaletteRef = DiagramPaletteId | { name: string; colors: DiagramPaletteColors };

const RAW_PRESETS: Readonly<Record<Exclude<DiagramPaletteId, "app">, DiagramPaletteColors>> = {
  soft: {
    cat: ["#e8c37a", "#efa492", "#93c5a0", "#9db5de", "#c8a8d8", "#f0c9a0", "#9fd0cc", "#d8b4a6"],
    seq: ["#eef3f8", "#c9d9ec", "#9db5de", "#6f8fc4", "#4a69a3"],
  },
  vivid: {
    cat: ["#f2a900", "#e4572e", "#17a673", "#2f6fdb", "#9b5de5", "#f15bb5", "#00b4d8", "#8d6e63"],
    seq: ["#e0ecff", "#9cc2ff", "#4f8ff0", "#2f6fdb", "#173f8f"],
  },
  earth: {
    cat: ["#c99a4e", "#b5654a", "#7e9a63", "#6e8098", "#9c6f8f", "#d4b26a", "#5f8c86", "#8a6b52"],
    seq: ["#f3ead8", "#dcc49a", "#c09a5e", "#9a6d38", "#6b4520"],
  },
  pastel: {
    cat: ["#f3de9c", "#f2b8b5", "#c9e2c0", "#c5d3ec", "#dcc8ec", "#f6cfa8", "#bfe3e0", "#e6d3c6"],
    seq: ["#f4f6fb", "#dfe6f4", "#c5d3ec", "#a8bce0", "#8aa3d2"],
  },
  safe: {
    cat: ["#e69f00", "#d55e00", "#009e73", "#0072b2", "#cc79a7", "#56b4e9", "#f0e442", "#000000"],
    seq: ["#fde725", "#5ec962", "#21918c", "#3b528b", "#440154"],
  },
  sea: {
    cat: ["#f4b942", "#f07167", "#4fb0a5", "#2b6cb0", "#8e7cc3", "#5fa8d3", "#90be6d", "#b08968"],
    seq: ["#e6f2f5", "#b3dbe3", "#6fb8c9", "#2f8aa6", "#1b5f7a"],
  },
  gray: {
    cat: ["#3b3b3b", "#6a6a6a", "#969696", "#bebebe", "#525252", "#828282", "#aaaaaa", "#d2d2d2"],
    seq: ["#f0f0f0", "#c8c8c8", "#969696", "#646464", "#2f2f2f"],
  },
};

/** 호출자가 공유 프리셋을 바꾸지 못하게 얼린다. */
const PRESETS = Object.fromEntries(
  Object.entries(RAW_PRESETS).map(([id, c]) => [
    id,
    Object.freeze({ cat: Object.freeze([...c.cat]) as string[], seq: Object.freeze([...c.seq]) as string[] }),
  ]),
) as Readonly<Record<Exclude<DiagramPaletteId, "app">, DiagramPaletteColors>>;

const NAMES: Readonly<Record<DiagramPaletteId, string>> = {
  app: "지금 앱 색",
  soft: "부드러운",
  vivid: "선명",
  earth: "흙색",
  pastel: "파스텔",
  safe: "색약 안전",
  sea: "바다",
  gray: "먹 단계",
};

export const PALETTE_IDS = Object.keys(NAMES) as readonly DiagramPaletteId[];

const isPaletteId = (value: unknown): value is DiagramPaletteId =>
  typeof value === "string" && Object.prototype.hasOwnProperty.call(NAMES, value);

const HEX = /^#[0-9a-f]{6}$/i;
const hexList = (v: unknown, n: number): boolean =>
  Array.isArray(v) && v.length === n && v.every((c) => typeof c === "string" && HEX.test(c));

/** 프리셋 id이거나, 이름과 cat 8색·seq 5색이 모두 #rrggbb인 만든 팔레트. */
export function isPaletteRef(value: unknown): value is DiagramPaletteRef {
  if (isPaletteId(value)) return true;
  if (!value || typeof value !== "object") return false;
  const { name, colors } = value as { name?: unknown; colors?: { cat?: unknown; seq?: unknown } | null };
  return typeof name === "string" && !!colors && typeof colors === "object" && hexList(colors.cat, 8) && hexList(colors.seq, 5);
}

export function paletteName(ref: DiagramPaletteRef): string {
  return typeof ref === "string" ? NAMES[ref] : ref.name;
}

const VALID_CUSTOM = new WeakMap<object, boolean>();

/** `app`·모르는 값·없음이면 null(= 레이어 원래 색). */
export function paletteColors(ref?: DiagramPaletteRef | null): DiagramPaletteColors | null {
  if (typeof ref === "string") return ref === "app" || !isPaletteId(ref) ? null : PRESETS[ref];
  if (!ref || typeof ref !== "object") return null;
  // 렌더러가 지물마다 부르므로 같은 객체의 검증은 한 번만 한다.
  let valid = VALID_CUSTOM.get(ref);
  if (valid === undefined) {
    valid = isPaletteRef(ref);
    VALID_CUSTOM.set(ref, valid);
  }
  return valid ? ref.colors : null;
}

/** 용도지역(zone·zone_center)은 계획 관습 색이라 팔레트와 무관하게 앱 색을 쓴다. */
const CATEGORICAL_PREFIXES = new Set(["use", "store", "jimok", "district", "facility"]);
/** 기타·미상 범주는 팔레트 색을 받지 않는다. */
const OTHER_KEY = /(기타|미상|other)$/;
/** 순서형 묶음 안의 미상·가정·자료 부족 항목 */
const NO_VALUE_KEY = /(unknown|missing|assumed)/;

type Slot = { kind: "cat"; index: number } | { kind: "seq"; index: number; count: number };

let SLOTS: Map<string, Slot> | null = null;

/**
 * 레이어별 팔레트 칸. LAYER_STYLES 정의 순서로 한 번만 계산한다.
 * map-layers와 서로 가져오므로 모듈 로드 중이 아니라 첫 호출 때 만든다.
 */
function slots(): Map<string, Slot> {
  if (SLOTS) return SLOTS;
  const orderedGroups = new Set<string>([
    LEGEND_GROUPS.tradeQuantiles,
    LEGEND_GROUPS.tradeDistrict,
    LEGEND_GROUPS.d05Floors,
    LEGEND_GROUPS.d04CompletionYear,
  ]);
  const out = new Map<string, Slot>();
  const catCount = new Map<string, number>();
  const ordered = new Map<string, Array<{ layer: string; order: number }>>();
  for (const [layer, style] of Object.entries(LAYER_STYLES)) {
    const colon = layer.indexOf(":");
    const prefix = colon > 0 ? layer.slice(0, colon) : "";
    if (CATEGORICAL_PREFIXES.has(prefix)) {
      if (OTHER_KEY.test(layer)) continue;
      // legendOrder가 있으면 그 값이 칸(같은 범주의 별칭 키가 같은 색을 받는다). 없으면 정의 순서.
      if (style.legendOrder !== undefined) {
        out.set(layer, { kind: "cat", index: style.legendOrder });
        continue;
      }
      const n = catCount.get(prefix) ?? 0;
      catCount.set(prefix, n + 1);
      out.set(layer, { kind: "cat", index: n });
    } else if (style.legendGroup && orderedGroups.has(style.legendGroup) && !NO_VALUE_KEY.test(layer)) {
      const list = ordered.get(style.legendGroup) ?? [];
      list.push({ layer, order: style.legendOrder ?? Number.POSITIVE_INFINITY });
      ordered.set(style.legendGroup, list);
    }
  }
  for (const list of ordered.values()) {
    list.sort((a, b) => a.order - b.order);
    list.forEach(({ layer }, index) => out.set(layer, { kind: "seq", index, count: list.length }));
  }
  SLOTS = out;
  return out;
}

/** seq 5점을 잇는 구간 선형(RGB) 보간. t는 0~1. */
function seqAt(seq: string[], t: number): string {
  const x = t * (seq.length - 1);
  const i = Math.min(seq.length - 2, Math.max(0, Math.floor(x)));
  const a = h2r(seq[i]);
  const b = h2r(seq[i + 1]);
  return r2h(a.map((v, k) => v + (b[k] - v) * (x - i)));
}

/** 팔레트를 레이어 스타일에 입힌다. `app`·없음·팔레트 대상이 아닌 레이어는 같은 객체를 돌려준다. */
export function paletteLayerStyle(layer: string, style: LayerStyle, ref?: DiagramPaletteRef | null): LayerStyle {
  const colors = paletteColors(ref);
  if (!colors) return style;
  const slot = slots().get(layer);
  if (!slot) return style;
  const color = slot.kind === "cat"
    ? colors.cat[slot.index % colors.cat.length]
    : seqAt(colors.seq, slot.count > 1 ? slot.index / (slot.count - 1) : 0);
  return { ...style, color, ...(style.fill === undefined ? {} : { fill: color }) };
}
