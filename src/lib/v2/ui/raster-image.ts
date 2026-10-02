/** 브라우저 래스터 디코드·팔레트·지도 좌표 변환. 값 배열 칠하기는 Node 테스트도 가능하다. */
import { toLngLat } from "../crs";
import type { RasterRef } from "../tile-result";
import { worldPx, type Viewport } from "./map-projection";
import type { RasterStyle } from "./map-layers";
import { lic } from "./lic";

type RasterValues = Uint8Array | Uint16Array | Int16Array;

/**
 * S02의 일조시간은 하지의 낮 길이(약 15시간)까지 읽혀야 한다.
 *
 * `map-layers.ts`의 공용 팔레트는 다른 작업자가 소유하므로, 여기서는
 * 래스터를 실제로 칠하는 경로에서만 화면용 팔레트를 확장한다. 낮은 값은
 * 채도가 낮은 청회색으로 시작하고 높은 값으로 갈수록 차분한 황금색·주황색으로
 * 이동한다. 숫자 구간은 0~1, ..., 14~15, 15+이다.
 */
export const SUN_HOURS_COLORS = [
  "#43566B",
  "#4E6478",
  "#5A7184",
  "#678095",
  "#748EA2",
  "#829CAF",
  "#91A9B7",
  "#A1B5B8",
  "#B1BDA9",
  "#C2BE93",
  "#D1B77B",
  "#DDA963",
  "#E19A4F",
  "#E28A43",
  "#DF793B",
  "#D76835",
] as const;

export const SUN_HOURS_BREAKS = Array.from({ length: SUN_HOURS_COLORS.length - 1 }, (_, index) => index + 1);

/** 화면과 PPT가 같은 래스터 팔레트를 사용하도록 스타일을 해석한다. */
export function resolveRasterStyle(ref: Pick<RasterRef, "palette">, style: RasterStyle): RasterStyle {
  if (ref.palette !== "sun_hours" || style.mode !== "stepped") return style;
  return { ...style, colors: [...SUN_HOURS_COLORS], breaks: [...SUN_HOURS_BREAKS] };
}

/** 범례의 stepped 항목에 대응하는 색. 연속형은 gradient를 그리므로 null을 돌려준다. */
export function rasterLegendColor(
  ref: Pick<RasterRef, "palette">,
  style: RasterStyle,
  entry: { min: number | null; max: number | null },
): string | null {
  const resolved = resolveRasterStyle(ref, style);
  if (resolved.mode === "continuous") return null;
  if (resolved.mode === "mask") return resolved.colors[0] ?? "#43566B";
  const value = entry.min ?? entry.max ?? 0;
  const index = Math.min(resolved.colors.length - 1, (resolved.breaks ?? []).filter((breakValue) => value >= breakValue).length);
  return resolved.colors[index] ?? null;
}

function bytesPerSample(ref: RasterRef): number {
  return ref.dtype === "u16" || ref.dtype === "i16" ? 2 : 1;
}

function expectedBytes(ref: RasterRef): number {
  return ref.cols * ref.rows * ref.bands * bytesPerSample(ref);
}

/** deflate-raw 저장물을 원래 dtype 배열로 복원한다. */
export async function inflateRaster(ref: RasterRef, bytes: ArrayBuffer): Promise<RasterValues> {
  if (typeof DecompressionStream === "undefined") throw new Error("RASTER_DECOMPRESSION_UNAVAILABLE");
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const raw = await new Response(stream).arrayBuffer();
  if (raw.byteLength !== expectedBytes(ref)) throw new Error(`RASTER_RAW_LENGTH_MISMATCH: ${ref.name}`);
  if (ref.dtype === "u8" || ref.dtype === "bits") return new Uint8Array(raw);
  if (ref.dtype === "u16") return new Uint16Array(raw);
  return new Int16Array(raw);
}

function screenPoint(x: number, y: number, vp: Viewport): [number, number] {
  const [lng, lat] = toLngLat([x, y]);
  const [wx, wy] = worldPx(lng, lat, vp.zoom);
  const [cx, cy] = worldPx(vp.center[0], vp.center[1], vp.zoom);
  return [wx - cx + vp.width / 2, wy - cy + vp.height / 2];
}

/**
 * 격자 모서리 3점을 Web Mercator 화면 좌표에 맞춘다.
 * ponytail: 반경 3 km 끝에서의 비선형 잔차는 화면 px 1 이내로 운영한다. 더 큰 격자는 작은 타일로 나눠 타일별 아핀을 적용한다.
 */
export function rasterAffine(ref: RasterRef, vp: Viewport): [number, number, number, number, number, number] {
  const west = ref.x0;
  const east = ref.x0 + ref.cols * ref.cellM;
  const south = ref.y0;
  const north = ref.y0 + ref.rows * ref.cellM;
  const nw = screenPoint(west, north, vp);
  const ne = screenPoint(east, north, vp);
  const sw = screenPoint(west, south, vp);
  return [
    (ne[0] - nw[0]) / ref.cols,
    (ne[1] - nw[1]) / ref.cols,
    (sw[0] - nw[0]) / ref.rows,
    (sw[1] - nw[1]) / ref.rows,
    nw[0],
    nw[1],
  ];
}

function colorOf(hex: string): [number, number, number] {
  const value = hex.trim().replace(/^#/, "");
  const full = value.length === 3 ? [...value].map((c) => `${c}${c}`).join("") : value;
  if (!/^[0-9a-f]{6}$/i.test(full)) throw new Error(`INVALID_RASTER_COLOR: ${hex}`);
  return [Number.parseInt(full.slice(0, 2), 16), Number.parseInt(full.slice(2, 4), 16), Number.parseInt(full.slice(4, 6), 16)];
}

function paletteColor(colors: string[], value: number, style: RasterStyle): [number, number, number] {
  if (colors.length === 0) return [0, 0, 0];
  if (style.mode === "stepped") {
    const index = Math.min(colors.length - 1, (style.breaks ?? []).filter((breakValue) => value >= breakValue).length);
    return colorOf(colors[index]!);
  }
  const min = style.min ?? 0;
  const max = style.max ?? 1;
  const t = max <= min ? 0 : Math.max(0, Math.min(1, (value - min) / (max - min)));
  const suppliedStops = style.stops?.length === colors.length ? style.stops : null;
  const stops = suppliedStops && suppliedStops.every((stop, index) => Number.isFinite(stop) && (index === 0 || stop > suppliedStops[index - 1]!))
    ? suppliedStops.map((stop) => (max <= min ? 0 : Math.max(0, Math.min(1, (stop - min) / (max - min)))))
    : colors.map((_, index) => (colors.length === 1 ? 0 : index / (colors.length - 1)));
  if (t <= stops[0]!) return colorOf(colors[0]!);
  if (t >= stops[stops.length - 1]!) return colorOf(colors.at(-1)!);
  const index = Math.max(0, stops.findIndex((stop) => t <= stop) - 1);
  const span = stops[index + 1]! - stops[index]!;
  const f = span <= 0 ? 0 : (t - stops[index]!) / span;
  const a = colorOf(colors[index]!);
  const b = colorOf(colors[Math.min(colors.length - 1, index + 1)]!);
  return [Math.round(a[0] + (b[0] - a[0]) * f), Math.round(a[1] + (b[1] - a[1]) * f), Math.round(a[2] + (b[2] - a[2]) * f)];
}

function rawAt(values: RasterValues, index: number): number {
  return values[index] ?? 0;
}

export type VectorPaintOptions = { lengthPx?: number; seed?: number };

/**
 * Vector rasters use LIC texture over the same U/Uin colour ramp as scalar
 * wind values. The upload contract stores obstacle cells as (0, 0); those
 * cells are rendered white so buildings remain legible over the map.
 */
export function paintVector(
  ref: RasterRef,
  values: RasterValues,
  style: RasterStyle,
  width = ref.cols,
  height = ref.rows,
  options: VectorPaintOptions = {},
): Uint8ClampedArray {
  const expected = ref.cols * ref.rows * ref.bands;
  if (ref.kind !== "vector2" || ref.bands !== 2) throw new Error(`RASTER_VECTOR_REQUIRED: ${ref.name}`);
  if (values.length !== expected) throw new Error(`RASTER_LENGTH_MISMATCH: ${ref.name}`);
  const resolvedStyle = resolveRasterStyle(ref, style);
  const fieldU = new Float32Array(ref.cols * ref.rows);
  const fieldV = new Float32Array(ref.cols * ref.rows);
  // Raster row 0 is south, while the image/LIC coordinate origin is north.
  // Store the field in display order and invert north-positive v to screen y.
  for (let displayY = 0; displayY < ref.rows; displayY += 1) {
    const sourceY = ref.rows - 1 - displayY;
    for (let x = 0; x < ref.cols; x += 1) {
      const index = displayY * ref.cols + x;
      const sourceIndex = sourceY * ref.cols + x;
      const base = sourceIndex * 2;
      const u = rawAt(values, base) * ref.scale + ref.offset;
      const v = rawAt(values, base + 1) * ref.scale + ref.offset;
      // An exact zero pair is the compact obstacle marker used by S03 uploads.
      // Normal fluid cells have a non-zero normalized inflow component.
      if (!Number.isFinite(u) || !Number.isFinite(v) || (u === 0 && v === 0)) {
        fieldU[index] = Number.NaN;
        fieldV[index] = Number.NaN;
      } else {
        fieldU[index] = u;
        fieldV[index] = -v;
      }
    }
  }
  const texture = lic(fieldU, fieldV, ref.cols, ref.rows, width, height, options);
  const rgba = new Uint8ClampedArray(width * height * 4);
  const opacity = Math.max(0, Math.min(1, resolvedStyle.opacity ?? 1));
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(ref.rows - 1, Math.floor((y * ref.rows) / height));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(ref.cols - 1, Math.floor((x * ref.cols) / width));
      const sourceIndex = sourceY * ref.cols + sourceX;
      const out = (y * width + x) * 4;
      const u = fieldU[sourceIndex] ?? Number.NaN;
      const v = fieldV[sourceIndex] ?? Number.NaN;
      if (!Number.isFinite(u) || !Number.isFinite(v)) {
        rgba[out] = 255;
        rgba[out + 1] = 255;
        rgba[out + 2] = 255;
        rgba[out + 3] = Math.round(255 * opacity);
        continue;
      }
      const [red, green, blue] = paletteColor(resolvedStyle.colors, Math.hypot(u, v), resolvedStyle);
      const textureValue = texture[y * width + x] ?? 0.5;
      const gain = 0.72 + textureValue * 0.48;
      rgba[out] = Math.min(255, Math.round(red * gain));
      rgba[out + 1] = Math.min(255, Math.round(green * gain));
      rgba[out + 2] = Math.min(255, Math.round(blue * gain));
      rgba[out + 3] = Math.round(255 * opacity);
    }
  }
  return rgba;
}

/** 브라우저 canvas와 PPT data URL이 공유하는 원해상도 RGBA 칠하기. row 0은 격자의 남쪽이다. */
export function paintRgba(ref: RasterRef, values: RasterValues, style: RasterStyle, width = ref.cols, height = ref.rows): Uint8ClampedArray {
  const expected = ref.cols * ref.rows * ref.bands;
  if (values.length !== expected) throw new Error(`RASTER_LENGTH_MISMATCH: ${ref.name}`);
  if (ref.kind === "vector2" && ref.bands === 2) return paintVector(ref, values, style, width, height);
  const resolvedStyle = resolveRasterStyle(ref, style);
  const rgba = new Uint8ClampedArray(width * height * 4);
  const opacity = Math.max(0, Math.min(1, resolvedStyle.opacity ?? 1));
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(ref.rows - 1, Math.floor((y * ref.rows) / height));
    const sourceRow = ref.rows - 1 - sourceY;
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(ref.cols - 1, Math.floor((x * ref.cols) / width));
      const base = (sourceRow * ref.cols + sourceX) * ref.bands;
      const raw = rawAt(values, base);
      const out = (y * width + x) * 4;
      if (ref.nodata !== null && (raw === ref.nodata || (ref.bands === 2 && rawAt(values, base + 1) === ref.nodata))) {
        rgba[out + 3] = 0;
        continue;
      }
      let value = raw * ref.scale + ref.offset;
      if (ref.kind === "vector2" && ref.bands === 2) {
        const v = rawAt(values, base + 1) * ref.scale + ref.offset;
        value = Math.hypot(value, v);
      }
      const isMask = ref.kind === "mask" || ref.dtype === "bits" || resolvedStyle.mode === "mask";
      const color = isMask ? colorOf(resolvedStyle.colors[0] ?? "#ffffff") : paletteColor(resolvedStyle.colors, value, resolvedStyle);
      rgba[out] = color[0];
      rgba[out + 1] = color[1];
      rgba[out + 2] = color[2];
      rgba[out + 3] = isMask ? (raw === 0 ? 0 : Math.round(255 * opacity)) : Math.round(255 * opacity);
    }
  }
  return rgba;
}

/** DOM canvas가 있는 브라우저에서 RGBA를 PNG data URL로 만든다. */
export function paintRaster(ref: RasterRef, values: RasterValues, style: RasterStyle, width = ref.cols, height = ref.rows): string {
  if (typeof document === "undefined") throw new Error("RASTER_CANVAS_UNAVAILABLE");
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("RASTER_CANVAS_CONTEXT_UNAVAILABLE");
  const image = new ImageData(width, height);
  image.data.set(paintRgba(ref, values, style, width, height));
  context.putImageData(image, 0, 0);
  return canvas.toDataURL("image/png");
}
