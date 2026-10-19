import type { TopoErrorCopyCode } from "./topo-upload";
import { toUtmk, type LngLat } from "../crs";
import type { TopoSummary } from "../topo/build";

export type TopoState =
  | { s: "idle" }
  | { s: "preparing" }
  | { s: "uploading"; loaded: number; total: number }
  | { s: "ready"; topoId: string; fileName: string; summary: TopoSummary; coveragePct: number | null }
  | { s: "error"; code: TopoErrorCopyCode };

export type TopoAction =
  | { type: "pick"; fileName: string }
  | { type: "progress"; loaded: number; total: number }
  | {
      type: "done";
      topoId: string;
      fileName: string;
      summary: TopoSummary;
      center: LngLat | null;
      radiusM: number;
    }
  | { type: "fail"; code: TopoErrorCopyCode }
  | { type: "remove" }
  | { type: "recheck"; center: LngLat; radiusM: number };

const INTEGRATION_STEPS = 2048;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function verticalOverlap(x: number, centerX: number, centerY: number, radiusM: number, minY: number, maxY: number): number {
  const dx = x - centerX;
  const halfHeight = Math.sqrt(Math.max(0, radiusM * radiusM - dx * dx));
  const circleMinY = centerY - halfHeight;
  const circleMaxY = centerY + halfHeight;
  return Math.max(0, Math.min(maxY, circleMaxY) - Math.max(minY, circleMinY));
}

function circleRectangleIntersectionArea(
  centerX: number,
  centerY: number,
  radiusM: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): number {
  const startX = Math.max(minX, centerX - radiusM);
  const endX = Math.min(maxX, centerX + radiusM);
  if (endX <= startX || maxY <= minY) return 0;

  const step = (endX - startX) / INTEGRATION_STEPS;
  let sum = verticalOverlap(startX, centerX, centerY, radiusM, minY, maxY) + verticalOverlap(endX, centerX, centerY, radiusM, minY, maxY);
  for (let index = 1; index < INTEGRATION_STEPS; index += 1) {
    const x = startX + step * index;
    sum += (index % 2 === 0 ? 2 : 4) * verticalOverlap(x, centerX, centerY, radiusM, minY, maxY);
  }
  return (sum * step) / 3;
}

/** Percentage of the analysis-radius circle covered by the uploaded UTM-K bbox. */
export function coveragePct(summary: TopoSummary, center: LngLat, radiusM: number): number {
  if (!Number.isFinite(radiusM) || radiusM <= 0) return 0;
  const [centerX, centerY] = toUtmk(center);
  const [minX, minY, maxX, maxY] = summary.bboxUtmk;
  if (![centerX, centerY, minX, minY, maxX, maxY].every(Number.isFinite)) return 0;

  const area = circleRectangleIntersectionArea(centerX, centerY, radiusM, minX, minY, maxX, maxY);
  const circleArea = Math.PI * radiusM * radiusM;
  return Math.round(clamp((area / circleArea) * 100, 0, 100));
}

function readyCoverage(
  summary: TopoSummary,
  center: LngLat | null,
  radiusM: number,
): { coveragePct: number | null; outside: boolean } {
  if (!center) return { coveragePct: null, outside: false };
  const pct = coveragePct(summary, center, radiusM);
  return { coveragePct: pct, outside: pct <= 0 };
}

export function topoReducer(state: TopoState, action: TopoAction): TopoState {
  switch (action.type) {
    case "pick":
      return { s: "preparing" };
    case "progress":
      return {
        s: "uploading",
        loaded: Math.max(0, action.loaded),
        total: Math.max(0, action.total),
      };
    case "done": {
      const result = readyCoverage(action.summary, action.center, action.radiusM);
      if (result.outside) return { s: "error", code: "topo_outside" };
      return {
        s: "ready",
        topoId: action.topoId,
        fileName: action.fileName,
        summary: action.summary,
        coveragePct: result.coveragePct,
      };
    }
    case "fail":
      return { s: "error", code: action.code };
    case "remove":
      return { s: "idle" };
    case "recheck": {
      if (state.s !== "ready") return state;
      const result = readyCoverage(state.summary, action.center, action.radiusM);
      if (result.outside) return { s: "error", code: "topo_outside" };
      return { ...state, coveragePct: result.coveragePct };
    }
  }
}
