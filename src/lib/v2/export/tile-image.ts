/**
 * 타일 하나를 독립적으로 저장한다.
 *
 * 화면·PPT와 같은 MapFigure/MassFigure/WindRoseFigure를 사용하되, 저장 파일의
 * 바깥 판에 제목·범례·출처·한계를 고정한다. 배경 타일과 래스터는 먼저 data URL로
 * 바꿔 넣으므로 결과 SVG에는 서버나 타일 제공처의 외부 href가 남지 않는다.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import MapFigure, { type MapFigureProps } from "@/components/v2/map-figure";
import MassFigure from "@/components/v2/mass-figure";
import WindRoseFigure from "@/components/v2/wind-rose-figure";
import type { RasterRef, RoseSeason } from "../tile-result";
import type { MapModel } from "../ui/map-layers";
import { legendItems } from "../ui/map-layers";
import { BASEMAP_STACK, framedViewport, tilesFor, tileUrl, type BasemapChoice } from "../ui/map-projection";
import type { MassModel } from "../ui/mass-projection";
import type { RoseModel } from "../ui/wind-rose";
import type { TileView } from "../ui/tile-view";
import { compactDate, safeFilePart } from "./download";
import { effectiveLayer, fetchTile, loadRasters, rasterizeMass, svgOf, svgOfMass, svgOfRose, svgToPng } from "../report/map-image";

const DEFAULT_WIDTH = 1600;
const DEFAULT_HEIGHT = 1200;
const DEFAULT_SCALE = 2;

type HrefResolver<T> = ((value: T) => string | null | undefined) | Map<string, string> | string;

export type TileImageOptions = {
  width?: number;
  height?: number;
  /** true면 제목·범례·출처·한계를 포함한 독립 도판, false면 시각물만 */
  withFrame?: boolean;
  scale?: number;
  /** 이미 받아 둔 배경 타일 data URL. 함수·Map·단일 data URL을 모두 받는다. */
  tileHref?: HrefResolver<string>;
  /** 이미 압축 해제·팔레트 처리한 래스터 data URL. */
  rasterHref?: HrefResolver<RasterRef>;
  /** S01 WebGL 결과를 PNG data URL로 주입할 때 사용한다. */
  visualHref?: string | null;
  layer?: BasemapChoice;
  roseSeason?: RoseSeason;
};

type ResolvedOptions = Required<Pick<TileImageOptions, "width" | "height" | "withFrame" | "scale">> & TileImageOptions;
type TileLayout = { visualX: number; visualY: number; visualWidth: number; visualHeight: number };

const optionsOf = (options: TileImageOptions = {}): ResolvedOptions => ({
  width: options.width ?? DEFAULT_WIDTH,
  height: options.height ?? DEFAULT_HEIGHT,
  withFrame: options.withFrame ?? true,
  scale: options.scale ?? DEFAULT_SCALE,
  ...options,
});

const layoutOf = (options: ResolvedOptions): TileLayout => {
  if (!options.withFrame) return { visualX: 0, visualY: 0, visualWidth: options.width, visualHeight: options.height };
  const margin = Math.round(options.width * 0.02);
  const visualY = Math.round(options.height * 0.145);
  const footer = Math.round(options.height * 0.145);
  return {
    visualX: margin,
    visualY,
    visualWidth: Math.max(320, options.width - margin * 2),
    visualHeight: Math.max(240, options.height - visualY - footer - margin),
  };
};

const escapeXml = (value: string): string => value
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&apos;");

const isEmbeddedHref = (value: string | null | undefined): value is string => Boolean(value && value.startsWith("data:"));

function resolveHref<T>(resolver: HrefResolver<T> | undefined, value: T, mapKey: string): string | undefined {
  if (!resolver) return undefined;
  const candidate = typeof resolver === "function"
    ? resolver(value)
    : resolver instanceof Map
      ? resolver.get(mapKey)
      : resolver;
  return isEmbeddedHref(candidate) ? candidate : undefined;
}

function layoutForMap(model: MapModel, layout: TileLayout, requestedLayer?: BasemapChoice): { layer: BasemapChoice; urls: string[] } {
  const layer = effectiveLayer(model, requestedLayer);
  const viewport = framedViewport(model.center, model.radiusM, layout.visualWidth, layout.visualHeight);
  const urls = BASEMAP_STACK[layer].flatMap((mapLayer) => tilesFor(viewport).map((tile) => tileUrl(mapLayer, tile.z, tile.x, tile.y)));
  return { layer, urls };
}

const rasterKey = (model: MapModel, name: string): string => `${model.analysisId ?? ""}/${model.tileCode ?? ""}/${name}`;

function resourceMaps(model: MapModel, layout: TileLayout, options: ResolvedOptions): { layer: BasemapChoice; tiles: Map<string, string>; rasters: Map<string, string> } {
  const { layer, urls } = layoutForMap(model, layout, options.layer);
  const tiles = new Map<string, string>();
  for (const url of urls) {
    const href = resolveHref(options.tileHref, url, url);
    if (href) tiles.set(url, href);
  }
  const rasters = new Map<string, string>();
  for (const ref of model.rasters ?? []) {
    const href = resolveHref(options.rasterHref, ref, ref.name);
    if (href) rasters.set(rasterKey(model, ref.name), href);
  }
  return { layer, tiles, rasters };
}

function staticMap(model: MapModel, layout: TileLayout, options: ResolvedOptions): string {
  const { layer, tiles, rasters } = resourceMaps(model, layout, options);
  const props: MapFigureProps = {
    model,
    width: layout.visualWidth,
    height: layout.visualHeight,
    fixed: true,
    basemap: tiles.size > 0 ? "tiles" : "none",
    layer,
    tileHref: (url) => tiles.get(url),
    rasterHref: (ref) => rasters.get(rasterKey(model, ref.name)) ?? null,
    label: `${options.withFrame ? "" : ""}분석 지도`,
    legend: true,
    north: 42,
    credit: false,
    scale: true,
  };
  return renderToStaticMarkup(createElement(MapFigure, props));
}

function mapVisual(model: MapModel, layout: TileLayout, options: ResolvedOptions): string {
  const { layer, tiles, rasters } = resourceMaps(model, layout, options);
  if (typeof document !== "undefined") {
    try {
      return svgOf(model, tiles, layer, { legend: true, north: 42, credit: false, scale: true, label: "분석 지도" }, rasters, layout.visualWidth, layout.visualHeight);
    } catch {
      // React DOM이 아직 준비되지 않은 환경에서는 동일한 정적 컴포넌트로 계속한다.
    }
  }
  return staticMap(model, layout, options);
}

function staticMass(mass: MassModel, layout: TileLayout): string {
  return renderToStaticMarkup(createElement(MassFigure, {
    scene: mass.scene,
    camera: mass.camera,
    width: layout.visualWidth,
    height: layout.visualHeight,
    fixed: true,
    exploded: mass.exploded,
    quality: "detail",
    label: "S01 3D 매스",
  }));
}

function staticRose(model: RoseModel, layout: TileLayout, season: RoseSeason): string {
  return renderToStaticMarkup(createElement(WindRoseFigure, {
    model,
    width: layout.visualWidth,
    height: layout.visualHeight,
    fixed: true,
    season,
    chrome: "slide",
    label: "D22 바람장미",
  }));
}

function visualFor(view: TileView, layout: TileLayout, options: ResolvedOptions): string {
  if (options.visualHref && isEmbeddedHref(options.visualHref)) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${layout.visualWidth} ${layout.visualHeight}" width="${layout.visualWidth}" height="${layout.visualHeight}"><image href="${escapeXml(options.visualHref)}" x="0" y="0" width="${layout.visualWidth}" height="${layout.visualHeight}" preserveAspectRatio="xMidYMid meet" /></svg>`;
  }
  // 카드(tile-card FigureFor)와 같은 우선순위: 3D 매스 → 바람장미 → 지도. D22는 지도와 바람장미를 둘 다 가진다.
  if (view.mass) {
    if (typeof document !== "undefined") {
      try {
        return svgOfMass(view.mass, layout.visualWidth, layout.visualHeight, view.mass.exploded);
      } catch {
        // 정적 SVG fallback
      }
    }
    return staticMass(view.mass, layout);
  }
  const season = options.roseSeason ?? "annual";
  const rose = view.roses?.[season] ?? view.rose;
  if (rose) {
    if (typeof document !== "undefined") {
      try {
        return svgOfRose(rose, layout.visualWidth, layout.visualHeight, view.roses?.[season] ? season : "annual");
      } catch {
        // 정적 SVG fallback
      }
    }
    return staticRose(rose, layout, view.roses?.[season] ? season : "annual");
  }
  if (view.map) return mapVisual(view.map, layout, options);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${layout.visualWidth} ${layout.visualHeight}" width="${layout.visualWidth}" height="${layout.visualHeight}"><rect width="100%" height="100%" fill="#F2F2EF" /><text x="50%" y="50%" text-anchor="middle" font-family="Noto Sans KR, sans-serif" font-size="24" fill="#5B606B">자료 없음</text></svg>`;
}

function nestedSvg(inner: string, layout: TileLayout): string {
  const match = /^\s*<svg\b([^>]*)>/.exec(inner);
  if (!match) return inner;
  const attrs = match[1].replace(/\s(?:x|y|width|height)=(["'])[^"']*\1/g, "");
  return inner.replace(match[0], `<svg x="${layout.visualX}" y="${layout.visualY}" width="${layout.visualWidth}" height="${layout.visualHeight}" preserveAspectRatio="xMidYMid meet"${attrs}>`);
}

function legendText(view: TileView): string {
  if (view.map) {
    const labels = legendItems(view.map).map((item) => item.label);
    const raster = (view.map.rasters ?? []).map((ref) => ref.label ?? ref.name);
    const all = [...new Set([...labels, ...raster])];
    if (all.length > 0) return all.slice(0, 6).join(" · ") + (all.length > 6 ? ` · +${all.length - 6}` : "");
  }
  if (view.code === "S01") return view.mass?.exploded ? "지형 · 수계 · 녹지 · 도로 · 건물 · 완성" : "확보 높이 · 추정 높이 · 높이 미상";
  if (view.code === "D22") return "풍속 0.5~2 · 2~4 · 4~6 · 6~8 · 8m/s 이상";
  return "분석 반경 · 대지 표식";
}

function limitationText(view: TileView): string {
  const items = [...view.caveats, ...view.notes].filter(Boolean);
  return items.length > 0 ? items.slice(0, 2).join(" · ") : "계산·자료의 한계는 출처와 기준일을 확인하세요.";
}

/** 외부 참조 없는 독립 SVG 도판. Node 테스트에서도 정적 React 마크업으로 생성할 수 있다. */
export function tileSvg(view: TileView, options: TileImageOptions = {}): string {
  const resolved = optionsOf(options);
  const layout = layoutOf(resolved);
  const visual = nestedSvg(visualFor(view, layout, resolved), layout);
  if (!resolved.withFrame) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${resolved.width}" height="${resolved.height}" viewBox="0 0 ${resolved.width} ${resolved.height}" role="img" aria-label="${escapeXml(view.title)}">${visual}</svg>`;
  }
  const title = `${view.code} · ${view.title}`;
  const legend = legendText(view);
  const source = view.sourceLine || "출처 없음";
  const limitation = limitationText(view);
  const footerY = resolved.height - Math.round(resolved.height * 0.105);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${resolved.width}" height="${resolved.height}" viewBox="0 0 ${resolved.width} ${resolved.height}" role="img" aria-labelledby="tile-title tile-source">
  <title id="tile-title">${escapeXml(title)}</title>
  <rect width="100%" height="100%" fill="#FFFFFF" />
  <text x="${Math.round(resolved.width * 0.02)}" y="${Math.round(resolved.height * 0.055)}" font-family="Noto Sans KR, Malgun Gothic, sans-serif" font-size="30" font-weight="700" fill="#15171C">${escapeXml(title)}</text>
  <text x="${Math.round(resolved.width * 0.02)}" y="${Math.round(resolved.height * 0.095)}" font-family="Noto Sans KR, Malgun Gothic, sans-serif" font-size="18" fill="#676C76">범례 · ${escapeXml(legend)}</text>
  ${visual}
  <line x1="${Math.round(resolved.width * 0.02)}" y1="${footerY - 18}" x2="${Math.round(resolved.width * 0.98)}" y2="${footerY - 18}" stroke="#D9DCE2" />
  <text x="${Math.round(resolved.width * 0.02)}" y="${footerY + 12}" font-family="Noto Sans KR, Malgun Gothic, sans-serif" font-size="16" fill="#676C76">출처 · ${escapeXml(source)}</text>
  <text x="${Math.round(resolved.width * 0.02)}" y="${footerY + 42}" font-family="Noto Sans KR, Malgun Gothic, sans-serif" font-size="15" fill="#676C76">한계 · ${escapeXml(limitation)}</text>
  <text x="${Math.round(resolved.width * 0.98)}" y="${footerY + 42}" text-anchor="end" font-family="Noto Sans KR, Malgun Gothic, sans-serif" font-size="15" fill="#676C76">북쪽 ↑ · 축척 · 분석 반경</text>
</svg>`;
}

/** 브라우저에서 배경 타일·래스터·S01 WebGL 결과를 선적재한 뒤 SVG를 만든다. */
export async function tileSvgForView(view: TileView, options: TileImageOptions = {}): Promise<string> {
  const resolved = optionsOf(options);
  const layout = layoutOf(resolved);
  const prepared: TileImageOptions = { ...resolved };
  if (view.map) {
    const model = view.map;
    const { layer, urls } = layoutForMap(model, layout, resolved.layer);
    const tileCache = new Map<string, string | null>();
    await Promise.all(urls.map(async (url) => tileCache.set(url, await fetchTile(url))));
    const rasterCache = new Map<string, string>();
    await loadRasters(model, rasterCache);
    const previousTileHref = resolved.tileHref;
    const previousRasterHref = resolved.rasterHref;
    prepared.layer = layer;
    prepared.tileHref = (url) => tileCache.get(url) ?? resolveHref(previousTileHref, url, url) ?? null;
    prepared.rasterHref = (ref) => rasterCache.get(rasterKey(model, ref.name)) ?? resolveHref(previousRasterHref, ref, ref.name) ?? null;
  }
  if (view.mass && !prepared.visualHref && typeof document !== "undefined") {
    try {
      prepared.visualHref = await rasterizeMass(view.mass.scene, view.mass.camera, layout.visualWidth, layout.visualHeight, view.mass.exploded);
    } catch {
      // tileSvg의 MassFigure 정적 경로로 계속한다.
    }
  }
  return tileSvg(view, prepared);
}

function dataUrlBytes(value: string): Uint8Array {
  const comma = value.indexOf(",");
  if (comma < 0) throw new Error("PNG data URL이 아닙니다.");
  const encoded = value.slice(comma + 1);
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** true PNG 저장. 기본 1600×1200 SVG를 scale 2로 3200×2400 PNG로 만든다. */
export async function tilePng(view: TileView, options: TileImageOptions = {}): Promise<Uint8Array> {
  const resolved = optionsOf(options);
  const svg = await tileSvgForView(view, resolved);
  const dataUrl = await svgToPng(svg, resolved.width, resolved.height, resolved.scale);
  return dataUrlBytes(dataUrl);
}

export const tileFileName = (code: string, title: string, address: string, date: string, ext: "png" | "svg"): string =>
  `사이트분석_${safeFilePart(code)}_${safeFilePart(title)}_${safeFilePart(address)}_${compactDate(date)}.${ext}`;
