/**
 * 브라우저 전용: MapFigure(SVG)를 이미지 data URL(1600×1000)로 만든다.
 * SVG를 이미지로 불러오면 바깥 주소의 배경 타일은 못 받으므로, 타일을 CORS로 미리 받아 data URI로 끼워 넣는다.
 * 배경 타일을 받지 못하면 배경 없이(격자) 계속한다.
 */
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import MapFigure, { type MapFigureProps } from "@/components/v2/map-figure";
import MassFigure from "@/components/v2/mass-figure";
import WindRoseFigure from "@/components/v2/wind-rose-figure";
import type { MapModel } from "../ui/map-layers";
import type { MassCamera, MassColorScheme, MassModel } from "../ui/mass-projection";
import type { RoseModel } from "../ui/wind-rose";
import type { RoseSeason } from "../tile-result";
import type { Scene } from "../scene";
import { SLIDE, slideLayout, slideReserved, slideSiteX, slideLegend } from "../ui/overlay-layout";
import { BASEMAP_STACK, framedViewport, tilesFor, tileUrl, type BasemapChoice } from "../ui/map-projection";
import { inflateRaster, paintRaster } from "../ui/raster-image";
import { RASTER_STYLES } from "../ui/map-layers";
import { SLIDE_OVERVIEW_FILL, slideCalloutFrame } from "../ui/callout-layout";
import { mapKeyOf, type PlannedSlide } from "./report-plan";
import type { MapImages } from "./render-pptx";

// 슬라이드 비율(16:9)로 그린다: 지도가 슬라이드 전체이고 오버레이는 pptx 도형이 얹는다
const VIEW_W = 960;
const VIEW_H = 540;
const OUT_W = 1920;
const OUT_H = 1080;
const PX_PER_INCH = VIEW_W / SLIDE.w;
type Extra = Pick<MapFigureProps, "muted" | "siteX" | "avoid" | "fill" | "scale" | "legend" | "bare">;
type MassExplodedOptions = { spreadPct: number; scheme?: MassColorScheme };
const TILE_TIMEOUT_MS = 8000;

const rasterKey = (analysisId: string, code: string, name: string) => `${analysisId}/${code}/${name}`;

/** 결과 타일이 지정한 배경을 PPT·화면 공통으로 우선한다(D01은 항상 Satellite). */
export const effectiveLayer = (model: MapModel, layer: BasemapChoice): BasemapChoice => model.basemap ?? layer;

const blobToDataUrl = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });

async function fetchTile(url: string): Promise<string | null> {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TILE_TIMEOUT_MS);
    try {
      const res = await fetch(url, { mode: "cors", signal: ctl.signal });
      return res.ok ? await blobToDataUrl(await res.blob()) : null;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

function svgOf(model: MapModel, tiles: Map<string, string>, layer: BasemapChoice, extra: Extra, rasterCache: Map<string, string>): string {
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    const usable = tiles.size > 0;
    const activeLayer = effectiveLayer(model, layer);
    flushSync(() =>
      root.render(
        createElement(MapFigure, {
          model,
          width: VIEW_W,
          height: VIEW_H,
          fixed: true,
          basemap: usable ? "tiles" : "none",
          layer: activeLayer,
          tileHref: (u: string) => tiles.get(u),
          rasterHref: (ref) => (model.analysisId && model.tileCode ? rasterCache.get(rasterKey(model.analysisId, model.tileCode, ref.name)) ?? null : null),
          label: "분석 반경 지도",
          // 범례·북쪽·저작권은 슬라이드의 판/출처 띠가 대신한다 (축척만 그림 안, 출처 띠 위)
          legend: extra.legend ?? false,
          bare: extra.bare,
          north: false,
          credit: false,
          bottomInset: slideLayout().strip.h * PX_PER_INCH,
          ...extra,
        }),
      ),
    );
    return host.innerHTML;
  } finally {
    root.unmount();
  }
}

async function loadRasters(model: MapModel, rasterCache: Map<string, string>): Promise<void> {
  if (!model.analysisId || !model.tileCode || !model.rasters?.length) return;
  await Promise.all(
    model.rasters.map(async (ref) => {
      const key = rasterKey(model.analysisId!, model.tileCode!, ref.name);
      if (rasterCache.has(key)) return;
      const style = RASTER_STYLES[ref.palette];
      if (!style) return;
      try {
        const response = await fetch(`/site/api/v2/analyses/${encodeURIComponent(model.analysisId!)}/tiles/${encodeURIComponent(model.tileCode!)}/rasters/${encodeURIComponent(ref.name)}`);
        if (!response.ok) return;
        const values = await inflateRaster(ref, await response.arrayBuffer());
        rasterCache.set(key, paintRaster(ref, values, style));
      } catch {
        // 래스터를 못 받은 장도 벡터·배경만으로 보고서를 계속 만든다.
      }
    }),
  );
}

/** 보고서 계획에 포함된 모든 래스터를 미리 받아 MapFigure가 외부 URL을 참조하지 않게 한다. */
export async function prefetchRasters(plan: PlannedSlide[], analysisId: string): Promise<Map<string, string>> {
  const models: MapModel[] = [];
  for (const slide of plan) {
    if (slide.kind === "sheet") models.push(...slide.cells.map((cell) => cell.view.map).filter((model): model is MapModel => !!model));
    else if (slide.map) models.push(slide.map);
  }
  const cache = new Map<string, string>();
  await Promise.all(models.map((model) => loadRasters(model.analysisId ? model : { ...model, analysisId }, cache)));
  return cache;
}

function svgOfMass(mass: MassModel, width: number, height: number, exploded?: MassExplodedOptions): string {
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    flushSync(() => root.render(createElement(MassFigure, { scene: mass.scene, camera: mass.camera, width, height, fixed: true, exploded: exploded ?? mass.exploded })));
    return host.innerHTML;
  } finally {
    root.unmount();
  }
}

function svgOfRose(model: RoseModel, width: number, height: number, season: RoseSeason): string {
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    flushSync(() => root.render(createElement(WindRoseFigure, { model, width, height, fixed: true, season, chrome: "slide" })));
    return host.innerHTML;
  } finally {
    root.unmount();
  }
}

async function toPng(svg: string): Promise<string> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = OUT_W;
    canvas.height = OUT_H;
    const g = canvas.getContext("2d")!;
    g.fillStyle = "#fff";
    g.fillRect(0, 0, OUT_W, OUT_H);
    g.drawImage(img, 0, 0, OUT_W, OUT_H);
    // PNG는 장당 2MB 안팎이라 덱이 10MB를 넘는다. 지도(사진에 가까운 래스터)는 JPEG로 충분하다.
    return canvas.toDataURL("image/jpeg", 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 한 장 그리기. tileCache는 같은 중심·반경의 여러 장이 타일을 다시 받지 않게 공유한다. */
export async function rasterizeMap(
  model: MapModel,
  tileCache: Map<string, string | null> = new Map(),
  layer: BasemapChoice = "white",
  extra: Extra = {},
  rasterCache: Map<string, string> = new Map(),
): Promise<string> {
  const vp = framedViewport(model.center, model.radiusM, VIEW_W, VIEW_H, extra.siteX, extra.fill);
  const activeLayer = effectiveLayer(model, layer);
  const urls = BASEMAP_STACK[activeLayer].flatMap((ly) => tilesFor(vp).map((t) => tileUrl(ly, t.z, t.x, t.y)));
  await Promise.all(
    urls
      .filter((u) => !tileCache.has(u))
      .map(async (u) => {
        tileCache.set(u, await fetchTile(u));
      }),
  );
  const got = new Map<string, string>();
  for (const u of urls) {
    const d = tileCache.get(u);
    if (d) got.set(u, d);
  }
  await loadRasters(model, rasterCache);
  return toPng(svgOf(model, got, activeLayer, extra, rasterCache));
}

export function rasterizeMass(mass: MassModel, exploded?: MassExplodedOptions): Promise<string>;
export function rasterizeMass(scene: Scene | null, camera: MassCamera, width?: number, height?: number, exploded?: MassExplodedOptions): Promise<string>;
export async function rasterizeMass(
  sceneOrMass: Scene | MassModel | null,
  cameraOrExploded?: MassCamera | MassExplodedOptions,
  width = VIEW_W,
  height = VIEW_H,
  exploded?: MassExplodedOptions,
): Promise<string> {
  const isCamera = Boolean(cameraOrExploded && "azimuthDeg" in cameraOrExploded && "elevationDeg" in cameraOrExploded);
  const mass: MassModel = isCamera
    ? { scene: sceneOrMass as Scene | null, camera: cameraOrExploded as MassCamera, exploded }
    : {
        ...(sceneOrMass as MassModel),
        exploded: exploded ?? (cameraOrExploded && "spreadPct" in cameraOrExploded ? cameraOrExploded : undefined),
      };
  return toPng(svgOfMass(mass, width, height, mass.exploded));
}

export async function rasterizeRose(model: RoseModel, width = VIEW_W, height = VIEW_H, season: RoseSeason = "annual"): Promise<string> {
  return toPng(svgOfRose(model, width, height, season));
}

/** 슬라이드마다 다른 오버레이 자리를 피하게 한다 (표지·출처는 지도 가운데, 타일은 오른쪽 정보 판을 뺀 영역) */
function extraFor(p: PlannedSlide, model: MapModel): Extra {
  if (p.kind !== "tile") return { avoid: slideReserved(PX_PER_INCH, { info: false }) };
  // 설명표 장: 두 칸 사이에 반경 원을 넣는 프레임 (렌더러가 점·표를 같은 프레임으로 놓는다)
  if (p.callout && p.callout.page > 0) {
    const f = slideCalloutFrame(4);
    return { siteX: f.siteX, fill: f.fill, avoid: [], scale: false };
  }
  if (p.callout) return { siteX: slideSiteX(), fill: SLIDE_OVERVIEW_FILL, avoid: slideReserved(PX_PER_INCH, { legend: slideLegend(model).rect }) };
  return { muted: p.muted, siteX: slideSiteX(), avoid: slideReserved(PX_PER_INCH, { legend: slideLegend(model).rect }) };
}

/** 계획의 모든 지도 자리에 대한 PNG. 실패한 장은 빠진다(렌더러가 자리표시를 넣는다). */
export async function buildMapImages(plan: PlannedSlide[], layer: BasemapChoice = "white"): Promise<MapImages> {
  const cache = new Map<string, string | null>();
  const rasterCache = await prefetchRasters(plan, "");
  const out: MapImages = {};
  for (const p of plan) {
    if (p.kind === "sheet") {
      for (const cell of p.cells) {
        if (!cell.view.map || out[cell.mapKey]) continue;
        try {
          out[cell.mapKey] = await rasterizeMap(cell.view.map, cache, effectiveLayer(cell.view.map, layer), { siteX: 0.5, avoid: [], legend: true, bare: false }, rasterCache);
        } catch (e) {
          console.warn(`조판 셀 이미지 생성 실패 (${cell.mapKey})`, e);
        }
      }
      continue;
    }
    const key = mapKeyOf(p);
    if (!key || out[key]) continue;
    if (p.kind === "tile" && p.mass) {
      try {
        out[key] = await rasterizeMass(p.mass);
      } catch (e) {
        console.warn(`매스 이미지 생성 실패 (${key})`, e);
      }
      continue;
    }
    if (p.kind === "tile" && p.rose) {
      try {
        out[key] = await rasterizeRose(p.rose);
      } catch (e) {
        console.warn(`바람장미 이미지 생성 실패 (${key})`, e);
      }
      continue;
    }
    const model = p.map;
    if (!model) continue;
    try {
      out[key] = await rasterizeMap(model, cache, effectiveLayer(model, layer), extraFor(p, model), rasterCache);
    } catch (e) {
      console.warn(`지도 이미지 생성 실패 (${key})`, e);
    }
  }
  return out;
}
