import type { FeatureHit } from "../../data/features";
import type { EngineContext } from "../../engine/context";
import { areaInCircle } from "../../engine/tiles/geo";

export type MeasuredParcel = { areaM2: number; parts: number[][][][] };
export type ParcelMeasurement = { byFeature: Map<number, MeasuredParcel>; failed: number };

type CachedMeasurement = { featureKey: string; result: ParcelMeasurement };

// D19과 흡수된 D20은 같은 context·반경의 parcel을 읽으므로 지오메트리 교차를 한 번만 계산한다.
const cache = new WeakMap<EngineContext, CachedMeasurement>();

function featureKey(hits: readonly FeatureHit[]): string {
  return hits.map((hit) => hit.featureId).join(",");
}

export function measureParcels(ctx: EngineContext, hits: readonly FeatureHit[]): ParcelMeasurement {
  const key = featureKey(hits);
  const cached = cache.get(ctx);
  if (cached?.featureKey === key) return cached.result;

  const byFeature = new Map<number, MeasuredParcel>();
  let failed = 0;
  for (const hit of hits) {
    const result = areaInCircle(ctx.input.center, ctx.input.radiusM, hit.geometry);
    if (result === null) {
      failed++;
      continue;
    }
    byFeature.set(hit.featureId, { areaM2: result.areaM2, parts: result.parts });
  }
  const measurement = { byFeature, failed };
  cache.set(ctx, { featureKey: key, result: measurement });
  return measurement;
}

export function parcelAreaM2(hit: FeatureHit): number | null {
  const value = hit.properties.areaM2;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
