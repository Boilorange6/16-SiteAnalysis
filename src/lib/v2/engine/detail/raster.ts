/** 지형·환경·건물밀도 상세. 래스터는 저장된 타일을 읽고, 없으면 자료 없음으로 남긴다. */
import type { FeatureHit } from "../../data/features";
import { booleanPointInPolygon } from "@turf/turf";
import type { DetailCard, DetailColumn, DetailRow, DetailSpec, DetailContext } from "./registry";
import { catalogEntry } from "../../ui/tile-catalog";
import { sourceLineOf } from "../../ui/tile-view";
import { toLngLat, toUtmk } from "../../crs";
import { areaInCircle, lineLengthInCircle, polygonArea } from "../tiles/geo";
import { buildingRows, isCounted } from "../tiles/buildings-shared";
import { hitPoint } from "../tiles/common";
import { demGridFor, demSources } from "../tiles/terrain-shared";
import type { LocalGrid } from "../tiles/raster-grid";
import { maxOf, minOf } from "../../extent";

export const DENSITY_COLUMNS: DetailColumn[] = [
  { key: "name", label: "이름", kind: "text" },
  { key: "metric", label: "지표", kind: "category" },
  { key: "value", label: "밀도", kind: "number" },
  { key: "bandwidth_m", label: "대역폭(m)", kind: "number" },
  { key: "gross_floor_m2", label: "연면적(㎡)", kind: "number", csvOnly: true },
  { key: "floors_above", label: "지상층", kind: "number", csvOnly: true },
  { key: "coverage_pct", label: "건폐율(%)", kind: "number", csvOnly: true },
  { key: "floor_area_ratio_pct", label: "용적률(%)", kind: "number", csvOnly: true },
];

const GRID_COLUMNS: DetailColumn[] = [
  { key: "band", label: "구간", kind: "category" },
  { key: "value", label: "값", kind: "number" },
  { key: "area_m2", label: "면적(㎡)", kind: "number" },
  { key: "share_pct", label: "비율(%)", kind: "number" },
];

const ENV_COLUMNS: DetailColumn[] = [
  { key: "name", label: "이름", kind: "text" },
  { key: "class", label: "분류", kind: "category" },
  { key: "area_m2", label: "면적(㎡)", kind: "number" },
  { key: "share_pct", label: "비율(%)", kind: "number" },
];

const DENSITY_CONTROLS = [
  { key: "metric", label: "밀도 지표", options: [{ value: "gfa", label: "연면적" }, { value: "buildings", label: "건물 수" }], default: "gfa" },
  { key: "bandwidth", label: "대역폭", options: [{ value: "57", label: "57m" }, { value: "100", label: "100m" }, { value: "160", label: "160m" }], default: "100" },
] as const;

function number(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function sourceText(ctx: DetailContext, key: "buildings" | "reference" | "terrain", ids: readonly string[]): string {
  return sourceLineOf(ctx.sources(key, ids));
}

function control(ctx: DetailContext, key: string, fallback: string): string {
  return ctx.detailControls?.[key] ?? fallback;
}

function densityRows(ctx: DetailContext): DetailRow[] {
  const metric = control(ctx, "metric", "gfa");
  const bandwidth = Number(control(ctx, "bandwidth", "100"));
  const safeBandwidth = Number.isFinite(bandwidth) && bandwidth > 0 ? bandwidth : 100;
  return ctx.memo(`detail:density:${metric}:${safeBandwidth}`, () => {
    const rows = (buildingRows(ctx) ?? []).filter((row) => isCounted(ctx, row));
    const lngs = new Float64Array(rows.length);
    const lats = new Float64Array(rows.length);
    const xs = new Float64Array(rows.length);
    const ys = new Float64Array(rows.length);
    const weights = new Float64Array(rows.length);
    weights.fill(Number.NaN);
    for (let index = 0; index < rows.length; index++) {
      const [lng, lat] = hitPoint(rows[index].hit);
      lngs[index] = lng;
      lats[index] = lat;
      const [x, y] = toUtmk([lng, lat]);
      xs[index] = x;
      ys[index] = y;
      const weight = metric === "buildings" ? 1 : rows[index].grossFloorM2;
      if (weight !== null) weights[index] = weight;
    }
    const parcelAreas = new Map<string, number>();
    for (const parcel of ctx.hits("parcels", ["parcel"])) {
      if (!parcel.pnu) continue;
      const area = parcel.geometry.type === "Polygon"
        ? polygonArea(parcel.geometry.coordinates as number[][][])
        : parcel.geometry.type === "MultiPolygon"
          ? parcel.geometry.coordinates.reduce((sum, rings) => sum + polygonArea(rings as number[][][]), 0)
          : null;
      if (area !== null && area > 0) parcelAreas.set(parcel.pnu, area);
    }
    const denominator = 2 * Math.PI * safeBandwidth ** 2;
    return rows.map((row, index) => {
      const x = xs[index];
      const y = ys[index];
      let weighted = 0;
      let hasWeight = false;
      for (let other = 0; other < rows.length; other++) {
        const weight = weights[other];
        if (!Number.isFinite(weight)) continue;
        weighted += weight * Math.exp(-((x - xs[other]) ** 2 + (y - ys[other]) ** 2) / (2 * safeBandwidth ** 2));
        hasWeight = true;
      }
      const gfa = row.grossFloorM2;
      const parcelArea = row.hit.pnu ? parcelAreas.get(row.hit.pnu) ?? null : null;
      return {
        fid: String(row.hit.featureId),
        lng: lngs[index],
        lat: lats[index],
        cells: {
          name: row.hit.name,
          metric,
          value: hasWeight ? weighted / denominator : null,
          bandwidth_m: safeBandwidth,
          gross_floor_m2: gfa,
          floors_above: row.floorsAbove,
          coverage_pct: row.footprintM2 !== null && parcelArea !== null ? (row.footprintM2 / parcelArea) * 100 : null,
          floor_area_ratio_pct: gfa !== null && parcelArea !== null ? (gfa / parcelArea) * 100 : null,
        },
      };
    });
  });
}

function densityLocation(ctx: DetailContext, row: DetailRow): { distanceM: number; direction: string } {
  const [x, y] = toUtmk([row.lng, row.lat]);
  const [cx, cy] = toUtmk(ctx.input.center);
  const angle = (Math.atan2(x - cx, y - cy) * 180 / Math.PI + 360) % 360;
  return {
    distanceM: Math.round(Math.hypot(x - cx, y - cy)),
    direction: ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(angle / 45) % 8],
  };
}

function densitySpec(): DetailSpec {
  return {
    columns: DENSITY_COLUMNS,
    controls: [...DENSITY_CONTROLS],
    summary(ctx) {
      const rows = densityRows(ctx);
      const metric = control(ctx, "metric", "gfa") === "gfa" ? "연면적" : "건물 수";
      const bandwidth = Number(control(ctx, "bandwidth", "100"));
      const gfa = rows.map((row) => number(row.cells.gross_floor_m2)).filter((value): value is number => value !== null);
      const floors = rows.map((row) => number(row.cells.floors_above)).filter((value): value is number => value !== null);
      const far = rows.map((row) => number(row.cells.floor_area_ratio_pct)).filter((value): value is number => value !== null);
      const coverage = rows.map((row) => number(row.cells.coverage_pct)).filter((value): value is number => value !== null);
      const densest = rows.reduce<{ row: DetailRow; value: number } | null>((best, row) => {
        const value = number(row.cells.value);
        return value === null || (best && best.value >= value) ? best : { row, value };
      }, null);
      const densestLocation = densest ? densityLocation(ctx, densest.row) : null;
      return {
        title: catalogEntry("D16").title,
        subtitle: `${metric} · 대역폭 ${bandwidth}m · ${rows.length.toLocaleString("ko-KR")}동`,
        fields: [
          { label: "평균 용적률", value: far.length === 0 ? null : `${Math.round((far.reduce((sum, value) => sum + value, 0) / far.length) * 10) / 10}%` },
          { label: "연면적 합계", value: gfa.length === 0 ? null : `${Math.round(gfa.reduce((sum, value) => sum + value, 0))}㎡` },
          { label: "건물", value: `${rows.length.toLocaleString("ko-KR")}동` },
          { label: "건폐율", value: coverage.length === 0 ? null : `${Math.round((coverage.reduce((sum, value) => sum + value, 0) / coverage.length) * 10) / 10}%` },
          { label: "평균 층수", value: floors.length === 0 ? null : `${Math.round((floors.reduce((sum, value) => sum + value, 0) / floors.length) * 10) / 10}층` },
          { label: "가장 짙은 곳", value: densestLocation ? `${densestLocation.direction} · ${densestLocation.distanceM}m` : null },
          { label: "지표", value: metric },
          { label: "대역폭", value: `${bandwidth}m` },
        ],
        source: sourceText(ctx, "buildings", ["building", "building_juso", "gis_bldg"]),
        ...(() => { const missing = [...(rows.length === 0 ? ["건물 자료"] : []), ...(gfa.length === 0 ? ["연면적"] : []), ...(far.length === 0 ? ["용적률"] : []), ...(coverage.length === 0 ? ["건폐율"] : [])]; return missing.length > 0 ? { missing } : {}; })(),
      };
    },
    rows: densityRows,
    at(ctx, lng, lat) {
      const [x, y] = toUtmk([lng, lat]);
      const rows = densityRows(ctx);
      let best: { row: DetailRow; distance: number } | null = null;
      for (const row of rows) {
        const [rx, ry] = toUtmk([row.lng, row.lat]);
        const distance = Math.hypot(rx - x, ry - y);
        if (!best || distance < best.distance) best = { row, distance };
      }
      if (!best || best.distance > 120) return null;
      return { card: { title: String(best.row.cells.name ?? "건물 밀도"), fields: [{ label: "밀도", value: best.row.cells.value === null ? null : String(best.row.cells.value) }, { label: "대역폭", value: `${best.row.cells.bandwidth_m}m` }], source: sourceText(ctx, "buildings", ["building", "building_juso", "gis_bldg"]) }, fid: best.row.fid };
    },
  };
}

function gridValue(grid: LocalGrid, col: number, row: number): number | null {
  if (col < 0 || col >= grid.cols || row < 0 || row >= grid.rows) return null;
  const value = grid.values[row * grid.cols + col];
  return Number.isFinite(value) ? value : null;
}

function gridRows(ctx: DetailContext, kind: "elevation" | "slope"): DetailRow[] {
  const grid = demGridFor(ctx, 30);
  if (!grid) return [];
  const circleArea = Math.PI * ctx.input.radiusM ** 2;
  const output: DetailRow[] = [];
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const x = grid.x0 + col * grid.cellM;
      const y = grid.y0 + row * grid.cellM;
      if (Math.hypot(x - grid.cx, y - grid.cy) > ctx.input.radiusM) continue;
      const elevation = gridValue(grid, col, row);
      if (elevation === null) continue;
      let value = elevation;
      if (kind === "slope") {
        const left = gridValue(grid, col - 1, row);
        const right = gridValue(grid, col + 1, row);
        const down = gridValue(grid, col, row - 1);
        const up = gridValue(grid, col, row + 1);
        const dx = left !== null && right !== null ? (right - left) / (2 * grid.cellM) : null;
        const dy = down !== null && up !== null ? (up - down) / (2 * grid.cellM) : null;
        if (dx === null || dy === null) continue;
        value = Math.atan(Math.hypot(dx, dy)) * 180 / Math.PI;
      }
      const [lng, lat] = toLngLat([x, y]);
      output.push({ fid: `${kind}:${row}:${col}`, lng, lat, cells: { band: kind === "elevation" ? "표고" : "경사도", value, area_m2: grid.cellM ** 2, share_pct: circleArea > 0 ? (grid.cellM ** 2 / circleArea) * 100 : null } });
    }
  }
  return output;
}

function terrainSpec(code: "D17" | "D18", kind: "elevation" | "slope"): DetailSpec {
  return {
    columns: GRID_COLUMNS,
    summary(ctx) {
      const rows = gridRows(ctx, kind);
      const values = rows.map((row) => number(row.cells.value)).filter((value): value is number => value !== null);
      const min = values.length > 0 ? minOf(values) : null;
      const max = values.length > 0 ? maxOf(values) : null;
      return { title: catalogEntry(code).title, subtitle: `${rows.length.toLocaleString("ko-KR")}개 표본`, fields: [{ label: "최솟값", value: min === null ? null : `${min}${kind === "elevation" ? "m" : "°"}` }, { label: "최댓값", value: max === null ? null : `${max}${kind === "elevation" ? "m" : "°"}` }], source: sourceLineOf(demSources(ctx)), ...(rows.length === 0 ? { missing: ["DEM 표본"] } : {}) };
    },
    rows(ctx) { return gridRows(ctx, kind); },
    at(ctx, lng, lat) { return nearestGridCard(ctx, code, kind, lng, lat); },
  };
}

function nearestGridCard(ctx: DetailContext, code: string, kind: "elevation" | "slope", lng: number, lat: number): { card: DetailCard; fid?: string } | null {
  const rows = gridRows(ctx, kind);
  const [x, y] = toUtmk([lng, lat]);
  let best: { row: DetailRow; distance: number } | null = null;
  for (const row of rows) {
    const [rx, ry] = toUtmk([row.lng, row.lat]);
    const distance = Math.hypot(rx - x, ry - y);
    if (!best || distance < best.distance) best = { row, distance };
  }
  if (!best || best.distance > 50) return null;
  return { card: { title: catalogEntry(code).title, fields: [{ label: kind === "elevation" ? "표고" : "경사도", value: best.row.cells.value === null ? null : `${best.row.cells.value}${kind === "elevation" ? "m" : "°"}` }], source: sourceLineOf(demSources(ctx)) }, fid: best.row.fid };
}

type RasterView = { ref: NonNullable<ReturnType<NonNullable<DetailContext["rasterReader"]>>>["ref"]; values: NonNullable<ReturnType<NonNullable<DetailContext["rasterReader"]>>>["values"] };

function rasterFor(ctx: DetailContext, code: string, names: readonly string[]): RasterView | null {
  if (!ctx.rasterReader) return null;
  for (const name of names) {
    const raster = ctx.rasterReader(code, name);
    if (raster) return raster;
  }
  return null;
}

function rasterRows(ctx: DetailContext, code: string, names: readonly string[], label: string): DetailRow[] {
  const raster = rasterFor(ctx, code, names);
  if (!raster) return [];
  const { ref, values } = raster;
  const stride = Math.max(1, Math.ceil(Math.sqrt((ref.cols * ref.rows) / 3000)));
  const circleArea = Math.PI * ctx.input.radiusM ** 2;
  const output: DetailRow[] = [];
  for (let row = 0; row < ref.rows; row += stride) {
    for (let col = 0; col < ref.cols; col += stride) {
      const raw = values[row * ref.cols + col];
      if (ref.nodata !== null && raw === ref.nodata) continue;
      const value = Number(raw) * ref.scale + ref.offset;
      if (!Number.isFinite(value)) continue;
      const x = ref.x0 + (col + 0.5) * ref.cellM;
      const y = ref.y0 + (row + 0.5) * ref.cellM;
      if (Math.hypot(x - toUtmk(ctx.input.center)[0], y - toUtmk(ctx.input.center)[1]) > ctx.input.radiusM) continue;
      const [lng, lat] = toLngLat([x, y]);
      const area = (ref.cellM * stride) ** 2;
       output.push({ fid: `${code}:${row}:${col}`, lng, lat, cells: { band: label, value, area_m2: area, share_pct: circleArea > 0 ? (area / circleArea) * 100 : null } });
    }
  }
  return output;
}

const SVF_BANDS = [
  { label: "25% 미만", max: 0.25 },
  { label: "25~50%", max: 0.5 },
  { label: "50~75%", max: 0.75 },
  { label: "75% 이상", max: Number.POSITIVE_INFINITY },
] as const;

function svfBandRows(rows: readonly DetailRow[]): DetailRow[] {
  const bins = SVF_BANDS.map(() => ({ area: 0, weighted: 0, row: rows[0] }));
  for (const row of rows) {
    const value = number(row.cells.value);
    const area = number(row.cells.area_m2) ?? 0;
    if (value === null) continue;
    const index = SVF_BANDS.findIndex((band) => value < band.max);
    if (index < 0) continue;
    bins[index].area += area;
    bins[index].weighted += value * area;
    bins[index].row = row;
  }
  const totalArea = bins.reduce((sum, bin) => sum + bin.area, 0);
  return SVF_BANDS.flatMap((band, index) => {
    const bin = bins[index];
    if (bin.area <= 0 || !bin.row) return [];
    return [{
      fid: `svf:band:${index}`,
      lng: bin.row.lng,
      lat: bin.row.lat,
      cells: {
        band: band.label,
        value: bin.weighted / bin.area,
        area_m2: bin.area,
        share_pct: totalArea > 0 ? (bin.area / totalArea) * 100 : null,
      },
    }];
  });
}

function rasterSpec(code: "S02" | "D29", names: readonly string[], label: string): DetailSpec {
  const rowsFor = (ctx: DetailContext): DetailRow[] => {
    const rows = rasterRows(ctx, code, code === "S02" ? names.map((name) => `${name}_winter`) : names, label);
    return code === "D29" ? svfBandRows(rows) : rows;
  };
  const rawRowsFor = (ctx: DetailContext): DetailRow[] => {
    return rasterRows(ctx, code, code === "S02" ? names.map((name) => `${name}_winter`) : names, label);
  };
  return {
    columns: GRID_COLUMNS,
    controls: undefined,
    summary(ctx) {
      const selected = code === "S02" ? "동지" : "연중";
      const rows = rowsFor(ctx);
      const rawRows = rawRowsFor(ctx);
      const values = rawRows.map((row) => number(row.cells.value)).filter((value): value is number => value !== null);
      const average = values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
      const sorted = [...values].sort((a, b) => a - b);
      const median = sorted.length === 0 ? null : sorted[Math.floor((sorted.length - 1) / 2)];
      const closedArea = code === "D29" ? rawRows.filter((row) => (number(row.cells.value) ?? 1) < 0.5).reduce((sum, row) => sum + (number(row.cells.area_m2) ?? 0), 0) : 0;
      const allArea = rawRows.reduce((sum, row) => sum + (number(row.cells.area_m2) ?? 0), 0);
      return { title: catalogEntry(code).title, subtitle: `${selected} · ${rows.length.toLocaleString("ko-KR")}개 구간`, fields: [{ label: "평균", value: average === null ? null : String(Math.round(average * 100) / 100) }, ...(code === "D29" ? [{ label: "절반 미만", value: allArea > 0 ? `${Math.round((closedArea / allArea) * 1000) / 10}%` : null }, { label: "중앙값", value: median === null ? null : `${Math.round(median * 100)}%` }] : [])], source: code === "S02" ? sourceText(ctx, "reference", ["sunlight_result"]) : sourceText(ctx, "reference", ["svf"]), ...(rows.length === 0 ? { missing: ["래스터 결과"] } : {}) };
    },
    rows: rowsFor,
    at(ctx, lng, lat) {
      const rows = rawRowsFor(ctx);
      const [x, y] = toUtmk([lng, lat]);
      let best: { row: DetailRow; distance: number } | null = null;
      for (const row of rows) { const [rx, ry] = toUtmk([row.lng, row.lat]); const distance = Math.hypot(rx - x, ry - y); if (!best || distance < best.distance) best = { row, distance }; }
      return best && best.distance <= 100 ? { card: { title: catalogEntry(code).title, fields: [{ label, value: best.row.cells.value === null ? null : String(best.row.cells.value) }], source: code === "S02" ? sourceText(ctx, "reference", ["sunlight_result"]) : sourceText(ctx, "reference", ["svf"]) }, fid: best.row.fid } : null;
    },
  };
}

function environmentalHits(ctx: DetailContext): FeatureHit[] {
  return [...ctx.hits("reference", ["park"]), ...ctx.hits("reference", ["landuse"]), ...ctx.hits("reference", ["water"])].sort((a, b) => a.featureId - b.featureId);
}

function environmentalRows(ctx: DetailContext, code: "A04" | "D10"): DetailRow[] {
  const circleArea = Math.PI * ctx.input.radiusM ** 2;
  const vectorRows = environmentalHits(ctx).map((hit) => {
    const area = areaInCircle(ctx.input.center, ctx.input.radiusM, hit.geometry)?.areaM2 ?? number(hit.properties.areaM2) ?? 0;
    const [lng, lat] = hitPointOf(hit);
       return { fid: String(hit.featureId), lng, lat, cells: { name: hit.name, class: text(hit.properties.fclass) ?? text(hit.properties.parkType) ?? hit.kind, area_m2: area, share_pct: circleArea > 0 ? (area / circleArea) * 100 : null } };
  });
  if (code !== "D10") return vectorRows;
  const canopy = rasterFor(ctx, "D10", ["canopy"]);
  if (!canopy) return vectorRows;
  const [cx, cy] = toUtmk(ctx.input.center);
  const stride = Math.max(1, Math.ceil(Math.sqrt((canopy.ref.cols * canopy.ref.rows) / 3000)));
  const canopyRows: DetailRow[] = [];
  for (let row = 0; row < canopy.ref.rows; row += stride) {
    for (let col = 0; col < canopy.ref.cols; col += stride) {
      const raw = canopy.values[row * canopy.ref.cols + col];
      if (canopy.ref.nodata !== null && raw === canopy.ref.nodata) continue;
      const x = canopy.ref.x0 + (col + 0.5) * canopy.ref.cellM;
      const y = canopy.ref.y0 + (row + 0.5) * canopy.ref.cellM;
      if (Math.hypot(x - cx, y - cy) > ctx.input.radiusM) continue;
      const [lng, lat] = toLngLat([x, y]);
      const area = (canopy.ref.cellM * stride) ** 2;
       canopyRows.push({ fid: `canopy:${row}:${col}`, lng, lat, cells: { name: "수관", class: Number(raw) > 0 ? "수관" : "비수관", area_m2: area, share_pct: circleArea > 0 ? (area / circleArea) * 100 : null } });
    }
  }
  return canopyRows.length > 0 ? canopyRows : vectorRows;
}

function hitPointOf(hit: FeatureHit): [number, number] {
  if (hit.geometry.type === "Point") { const [lng, lat] = toLngLat(hit.geometry.coordinates as [number, number]); return [lng, lat]; }
  if (hit.geometry.type === "Polygon") { const [lng, lat] = toLngLat(hit.geometry.coordinates[0][0] as [number, number]); return [lng, lat]; }
  if (hit.geometry.type === "MultiPolygon") { const [lng, lat] = toLngLat(hit.geometry.coordinates[0][0][0] as [number, number]); return [lng, lat]; }
  if (hit.geometry.type === "LineString") { const [lng, lat] = toLngLat(hit.geometry.coordinates[0] as [number, number]); return [lng, lat]; }
  return [0, 0];
}

function containsPoint(hit: FeatureHit, lng: number, lat: number): boolean {
  const [x, y] = toUtmk([lng, lat]);
  try {
    if (hit.geometry.type === "Point") {
      const [px, py] = hit.geometry.coordinates as [number, number];
      return Math.hypot(px - x, py - y) <= 100;
    }
    if (hit.geometry.type === "Polygon" || hit.geometry.type === "MultiPolygon") {
      return booleanPointInPolygon([x, y] as [number, number], { type: "Feature", properties: {}, geometry: hit.geometry } as never);
    }
  } catch {
    return false;
  }
  return false;
}

function environmentalSpec(code: "A04" | "D10"): DetailSpec {
  return {
    columns: ENV_COLUMNS,
    summary(ctx) { const rows = environmentalRows(ctx, code); return { title: catalogEntry(code).title, subtitle: `${rows.length.toLocaleString("ko-KR")}개 지물`, fields: [{ label: "면적 합계", value: rows.length === 0 ? null : `${Math.round(rows.reduce((sum, row) => sum + (number(row.cells.area_m2) ?? 0), 0))}㎡` }], source: sourceLineOf([...ctx.sources("reference", ["park"]), ...ctx.sources("reference", ["osm_landuse", "osm_water"])]), ...(rows.length === 0 ? { missing: ["녹지·수계 자료"] } : {}) }; },
    rows(ctx) { return environmentalRows(ctx, code); },
    at(ctx, lng, lat) { const hit = environmentalHits(ctx).find((candidate) => containsPoint(candidate, lng, lat)); return hit ? { card: { title: hit.name ?? "환경 지물", fields: [{ label: "분류", value: text(hit.properties.fclass) ?? hit.kind }], source: sourceLineOf(ctx.sources("reference", ["park", "osm_landuse", "osm_water"])) }, fid: String(hit.featureId) } : null; },
  };
}

export const RASTER_SPECS: Partial<Record<"A04" | "D10" | "D16" | "D17" | "D18" | "S02" | "D29", DetailSpec>> = {
  A04: environmentalSpec("A04"),
  D10: environmentalSpec("D10"),
  D16: densitySpec(),
  D17: terrainSpec("D17", "elevation"),
  D18: terrainSpec("D18", "slope"),
  S02: rasterSpec("S02", ["sun_hours", "sunlight_hours"], "일조시간"),
  D29: rasterSpec("D29", ["svf"], "개방감"),
};
