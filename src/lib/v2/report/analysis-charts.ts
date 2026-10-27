/** 분석 장 그래프 자료(구성비·거리). 지도 모델에서 계산하는 순수 함수라 미리보기·PPT·테스트가 같은 값을 쓴다. */
import { legendItems, legendItemsForModel, modelLayerStyle, type MapModel } from "../ui/map-layers";
import { metersPerPixel, worldPx } from "../ui/map-projection";

export type CompositionItem = { label: string; color: string; count: number; share: number };
export type DistanceData =
  | { kind: "scatter"; axis: { label: string; unit: string }; points: { d: number; v: number; color: string }[]; median: number; mean: number; max: number; site: number | null; sampled: boolean }
  | { kind: "bands"; bands: { from: number; to: number; count: number }[] };
export type AnalysisCharts = { radiusM: number; total: number; countUnit: string; subject: string; missing: number; composition: CompositionItem[]; distance: DistanceData };

const MAX_POINTS = 2000;
const BAND_M = 100;
const OTHER = { label: "그 밖", color: "#B9BDC6" };
/** 거리·포함 판정은 지도와 같은 Web Mercator 세계 픽셀(z20)에서 한다. 미터는 metersPerPixel로 환산. */
const Z = 20;

type Px = readonly [number, number];
type LngLat = readonly [number, number];

const toPx = (rings: readonly (readonly LngLat[])[]): Px[][] => rings.map((ring) => ring.map(([lng, lat]) => worldPx(lng, lat, Z)));

/** 첫 고리의 면적 중심. 면적이 0이면 꼭짓점 평균. */
function ringCentroid(ring: readonly Px[]): Px {
  // 세계 픽셀은 1e8 크기라 외적이 자릿수를 잃는다 — 첫 꼭짓점을 원점으로 옮겨 계산한다.
  const [ox, oy] = ring[0]!;
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const x0 = ring[i]![0] - ox;
    const y0 = ring[i]![1] - oy;
    const x1 = ring[i + 1]![0] - ox;
    const y1 = ring[i + 1]![1] - oy;
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  if (Math.abs(area) < 1e-9) return [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
  return [ox + cx / (3 * area), oy + cy / (3 * area)];
}

function inRing(p: Px, ring: readonly Px[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const inPolygon = (p: Px, rings: readonly (readonly Px[])[]): boolean => inRing(p, rings[0]!) && !rings.slice(1).some((hole) => inRing(p, hole));

const median = (sorted: number[]): number => {
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

export function analysisCharts(model: MapModel): AnalysisCharts | null {
  const items = legendItemsForModel(model);
  if (items.length < 2) return null;

  // 같은 표시명으로 합쳐진 레이어(도로 등)는 범례의 항목 하나로 모은다.
  const itemByLayer = new Map(items.map((item) => [item.layer, item]));
  const layerByLabel = new Map(legendItems(model).map((item) => [item.label, item.layer]));
  const itemFor = (layer: string) => {
    if (layer.endsWith("_site")) return undefined; // 대지 레이어
    return itemByLayer.get(layer) ?? itemByLayer.get(layerByLabel.get(modelLayerStyle(model, layer).label) ?? "");
  };

  const mpp = metersPerPixel(model.center[1], Z);
  const [cx, cy] = worldPx(model.center[0], model.center[1], Z);
  const counted: Array<{ d: number; value: number | null | undefined; at: Px; item: NonNullable<ReturnType<typeof itemFor>> }> = [];
  const consider = (layer: string, at: Px, value: number | null | undefined) => {
    const item = itemFor(layer);
    if (!item) return;
    const d = Math.hypot(at[0] - cx, at[1] - cy) * mpp;
    if (d <= model.radiusM) counted.push({ d, value, at, item });
  };
  for (const f of model.features) consider(f.layer, worldPx(f.lng, f.lat, Z), f.value);
  for (const p of model.polygons ?? []) if (p.rings[0]?.length) consider(p.layer, ringCentroid(toPx(p.rings)[0]!), p.value);
  if (counted.length === 0) return null;

  // 구성비: 범례 항목 순서, 6개를 넘으면 수가 많은 상위 5개 + 그 밖
  const countByItem = new Map<(typeof items)[number], number>();
  for (const c of counted) countByItem.set(c.item, (countByItem.get(c.item) ?? 0) + 1);
  const present = items.filter((item) => countByItem.has(item));
  const total = counted.length;
  const toComposition = (item: (typeof items)[number]): CompositionItem => ({ label: item.label, color: item.color, count: countByItem.get(item)!, share: countByItem.get(item)! / total });
  let composition = present.map(toComposition);
  if (composition.length > 6) {
    const keep = new Set([...present].sort((a, b) => countByItem.get(b)! - countByItem.get(a)!).slice(0, 5));
    const rest = present.filter((item) => !keep.has(item)).reduce((sum, item) => sum + countByItem.get(item)!, 0);
    composition = [...present.filter((item) => keep.has(item)).map(toComposition), { ...OTHER, count: rest, share: rest / total }];
  }

  const top = present.reduce((best, item) => (countByItem.get(item)! > countByItem.get(best)! ? item : best));
  const subject = modelLayerStyle(model, top.layer).subject ?? "지물";
  const countUnit = model.valueAxis?.countUnit ?? "개";

  const valued = counted.filter((c): c is typeof c & { value: number } => typeof c.value === "number");
  let distance: DistanceData;
  let missing = 0;
  if (valued.length > 0) {
    missing = counted.filter((c) => c.value === null).length;
    const values = valued.map((c) => c.value).sort((a, b) => a - b);
    const sitePx = (model.siteParcel ?? []).map((p) => toPx(p.rings));
    const inSite = valued.filter((c) => sitePx.some((rings) => inPolygon(c.at, rings)));
    // ponytail: 거리순 균등 추출 — 극값이 빠질 수 있다(통계는 전체로 계산). 부족하면 구간별 최대 보존으로 바꾼다.
    const sorted = valued.map((c, i) => ({ c, i })).sort((a, b) => a.c.d - b.c.d || a.i - b.i).map(({ c }) => c);
    const sampled = sorted.length > MAX_POINTS;
    const picked = sampled ? Array.from({ length: MAX_POINTS }, (_, i) => sorted[Math.floor((i * (sorted.length - 1)) / (MAX_POINTS - 1))]!) : sorted;
    distance = {
      kind: "scatter",
      axis: { label: model.valueAxis?.label ?? "값", unit: model.valueAxis?.unit ?? "" },
      points: picked.map((c) => ({ d: Math.round(c.d * 10) / 10, v: c.value, color: c.item.color })),
      median: median(values),
      mean: values.reduce((s, v) => s + v, 0) / values.length,
      max: values[values.length - 1]!,
      site: inSite.length ? Math.round(inSite.reduce((s, c) => s + c.value, 0) / inSite.length) : null,
      sampled,
    };
  } else {
    const n = Math.max(1, Math.ceil(model.radiusM / BAND_M));
    const bands = Array.from({ length: n }, (_, i) => ({ from: i * BAND_M, to: Math.min((i + 1) * BAND_M, model.radiusM), count: 0 }));
    for (const c of counted) bands[Math.min(Math.floor(c.d / BAND_M), n - 1)]!.count++;
    distance = { kind: "bands", bands };
  }

  return { radiusM: model.radiusM, total, countUnit, subject, missing, composition, distance };
}

const num = (v: number, unit: string) => {
  const r = Math.round(v);
  return `${unit === "년" ? String(r) : r.toLocaleString("ko-KR")}${unit}`;
};

export function analysisStatLine(c: AnalysisCharts): string {
  const radius = c.radiusM >= 1000 ? `${c.radiusM / 1000} km` : `${c.radiusM} m`;
  const head = `반경 ${radius} 안 ${c.subject} ${c.total.toLocaleString("ko-KR")}${c.countUnit}`;
  const d = c.distance;
  if (d.kind === "bands") {
    const best = d.bands.reduce((a, b) => (b.count > a.count ? b : a));
    return `${head} · 가장 많은 거리 ${best.from}–${best.to} m`;
  }
  const parts = [head, `중앙값 ${num(d.median, d.axis.unit)}`, `최고 ${num(d.max, d.axis.unit)}`];
  if (c.missing > 0) parts.push(`${d.axis.unit === "층" ? "1층 가정" : "값 없음"} ${c.missing.toLocaleString("ko-KR")}${c.countUnit}`);
  return parts.join(" · ");
}
