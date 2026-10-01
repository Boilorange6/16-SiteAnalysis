/**
 * 대지 일조 추정 (기하학적 직달광만). 격자 셀 중심이 어떤 건물 그림자에도 들지 않고 태양이 지평선 위면 그 간격은 "일조".
 * 각 간격은 그 간격 중앙 시각의 태양 위치로 계산한다(09:00~15:00, 10분이면 09:05, 09:15, … 36개 = 6시간).
 * 미계산 셀(높이를 모르는 건물이 덮은 셀)은 0시간으로 세지 않고 분모에서 뺀 뒤 미계산 면적률로 따로 낸다.
 */
import { buildingShadow, pointInRings, ringBBox, shadowBBox, shadowVector, pointInShadow, type BBox, type Building, type Shadow, type XY } from "./shadow";
import { sunPosition, kst } from "./sun";

export interface SunlightInput {
  /** 대지 외곽 링 (미터 좌표) */
  site: readonly XY[];
  buildings: readonly Building[];
  /** 태양 위치 계산용 대지 중심 위경도 */
  latDeg: number;
  lonDeg: number;
  date: { year: number; month: number; day: number };
  /** KST 자정 기준 분. 기본 540(09:00) ~ 900(15:00) */
  windowStartMin?: number;
  windowEndMin?: number;
  stepMin?: number;
  gridM?: number;
  /** 대지 경계에서 이 거리 안의 건물만 차폐 후보. 기본 300m */
  influenceM?: number;
  /** 대지 안 건물이 덮은 셀을 수광면에서 뺀다(기존 건물 철거 가정). 기본 false */
  removeBuildingsInSite?: boolean;
  /** "연속 N시간 이상" 기준. 기본 2 */
  minContinuousHours?: number;
}

export interface SunlightStep {
  minuteKst: number;
  azimuthDeg: number;
  altitudeDeg: number;
  sunUp: boolean;
  /** 계산된 셀 중 그림자 든 비율. 태양이 지평선 아래면 null */
  shadedRatio: number | null;
}

export type CellState = "calculated" | "removed" | "uncalculated";
export interface SunlightCell {
  x: number;
  y: number;
  state: CellState;
  /** state가 calculated일 때만 의미 있음. 아니면 null */
  hours: number | null;
  longestRunHours: number | null;
}

export interface SunlightResult {
  params: {
    date: string;
    windowStartMin: number;
    windowEndMin: number;
    stepMin: number;
    gridM: number;
    influenceM: number;
    removeBuildingsInSite: boolean;
    minContinuousHours: number;
  };
  cells: SunlightCell[];
  steps: SunlightStep[];
  counts: { cells: number; calculated: number; removed: number; uncalculated: number };
  buildings: { inInfluence: number; used: number; excludedNoHeight: number; inSiteRemoved: number };
  /** 창 안에서 태양이 떠 있는 시간(h) = 어떤 셀도 이보다 많이 받을 수 없음 */
  sunUpHours: number;
  medianHours: number | null;
  shareAtLeastN: number | null;
  uncalculatedRatio: number | null;
}

const bboxOverlap = (a: BBox, b: BBox) => a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;

function distToSegment(p: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function withinDistance(ring: readonly XY[], site: readonly XY[], r: number): boolean {
  if (ring.some((p) => pointInRings(p[0], p[1], [site]) )) return true;
  if (site.some((p) => pointInRings(p[0], p[1], [ring]))) return true;
  for (const p of ring) for (let i = 0; i < site.length; i++) if (distToSegment(p, site[i], site[(i + 1) % site.length]) <= r) return true;
  return false;
}

/** 철거 가정이면 대지와 겹치는 발자국은 수광면과 그림자 원천 모두에서 뺀다. */
export function shadowSourcesFor(buildings: readonly Building[], site: readonly XY[], removeBuildingsInSite: boolean): readonly Building[] {
  if (!removeBuildingsInSite) return buildings;
  const siteBox = ringBBox(site);
  return buildings.filter((building) => !bboxOverlap(ringBBox(building.ring), siteBox));
}

export function computeSunlight(input: SunlightInput): SunlightResult {
  const g = input.gridM ?? 2;
  const stepMin = input.stepMin ?? 10;
  const w0 = input.windowStartMin ?? 540;
  const w1 = input.windowEndMin ?? 900;
  const influenceM = input.influenceM ?? 300;
  const remove = input.removeBuildingsInSite ?? false;
  const minRun = input.minContinuousHours ?? 2;
  const { year, month, day } = input.date;
  const site = input.site;
  const sb = ringBBox(site);

  // 1) 영향 영역 안 건물
  const influencing = input.buildings.filter((b) => withinDistance(b.ring, site, influenceM));
  const shadowBuildings = shadowSourcesFor(influencing, site, remove);
  const heights = shadowBuildings.filter((b) => b.heightM !== null && b.heightM > 0);
  const noHeight = influencing.filter((b) => b.heightM === null);
  const footprints = influencing.map((b) => ({ b, box: ringBBox(b.ring) })).filter((f) => bboxOverlap(f.box, sb));

  // 2) 셀 분류
  const cells: SunlightCell[] = [];
  for (let y = sb.minY + g / 2; y < sb.maxY; y += g) {
    for (let x = sb.minX + g / 2; x < sb.maxX; x += g) {
      if (!pointInRings(x, y, [site])) continue;
      let state: CellState = "calculated";
      for (const { b, box } of footprints) {
        if (x < box.minX || x > box.maxX || y < box.minY || y > box.maxY || !pointInRings(x, y, [b.ring])) continue;
        if (remove) state = "removed";
        else if (b.heightM === null) state = "uncalculated";
        if (state !== "calculated") break;
      }
      cells.push({ x, y, state, hours: null, longestRunHours: null });
    }
  }
  const live = cells.filter((c) => c.state === "calculated");
  const hours = new Float64Array(live.length);
  const run = new Float64Array(live.length);
  const longest = new Float64Array(live.length);

  // 3) 시간 간격별 계산
  const dtH = stepMin / 60;
  const steps: SunlightStep[] = [];
  let sunUpHours = 0;
  for (let m = w0; m + stepMin <= w1; m += stepMin) {
    const mid = m + stepMin / 2;
    const sun = sunPosition(input.latDeg, input.lonDeg, kst(year, month, day, 0, mid));
    const sunUp = sun.altitudeDeg > 0.01;
    if (!sunUp) {
      run.fill(0);
      steps.push({ minuteKst: mid, azimuthDeg: sun.azimuthDeg, altitudeDeg: sun.altitudeDeg, sunUp, shadedRatio: null });
      continue;
    }
    sunUpHours += dtH;
    const shadows: Shadow[] = [];
    for (const b of heights) {
      const v = shadowVector(b.heightM as number, sun);
      if (v && bboxOverlap(shadowBBox(b, v), sb)) {
        const s = buildingShadow(b, sun);
        if (s) shadows.push(s);
      }
    }
    let shaded = 0;
    for (let i = 0; i < live.length; i++) {
      const c = live[i];
      let inShadow = false;
      for (const s of shadows) if (pointInShadow(c.x, c.y, s)) { inShadow = true; break; }
      if (inShadow) {
        shaded++;
        run[i] = 0;
      } else {
        hours[i] += dtH;
        run[i] += dtH;
        if (run[i] > longest[i]) longest[i] = run[i];
      }
    }
    steps.push({ minuteKst: mid, azimuthDeg: sun.azimuthDeg, altitudeDeg: sun.altitudeDeg, sunUp, shadedRatio: live.length ? shaded / live.length : null });
  }
  live.forEach((c, i) => {
    c.hours = round(hours[i]);
    c.longestRunHours = round(longest[i]);
  });

  // 4) 요약
  const uncalculated = cells.filter((c) => c.state === "uncalculated").length;
  const removed = cells.filter((c) => c.state === "removed").length;
  const sorted = Array.from(hours).sort((a, b) => a - b);
  const median = sorted.length === 0 ? null : sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  const eps = 1e-9;
  const denom = live.length + uncalculated;
  return {
    params: {
      date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      windowStartMin: w0,
      windowEndMin: w1,
      stepMin,
      gridM: g,
      influenceM,
      removeBuildingsInSite: remove,
      minContinuousHours: minRun,
    },
    cells,
    steps,
    counts: { cells: cells.length, calculated: live.length, removed, uncalculated },
    buildings: { inInfluence: influencing.length, used: heights.length, excludedNoHeight: noHeight.length, inSiteRemoved: remove ? footprints.length : 0 },
    sunUpHours: round(sunUpHours),
    medianHours: median === null ? null : round(median),
    shareAtLeastN: live.length === 0 ? null : Array.from(longest).filter((h) => h >= minRun - eps).length / live.length,
    uncalculatedRatio: denom === 0 ? null : uncalculated / denom,
  };
}

const round = (h: number) => Math.round(h * 1e6) / 1e6;
