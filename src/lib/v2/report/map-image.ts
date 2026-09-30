/**
 * 브라우저 전용: MapFigure(SVG)를 이미지 data URL(1600×1000)로 만든다.
 * SVG를 이미지로 불러오면 바깥 주소의 배경 타일은 못 받으므로, 타일을 CORS로 미리 받아 data URI로 끼워 넣는다.
 * 배경 타일을 받지 못하면 배경 없이(격자) 계속한다.
 */
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import MapFigure, { type MapFigureProps } from "@/components/v2/map-figure";
import type { MapModel } from "../ui/map-layers";
import { SLIDE, slideLayout, slideReserved, slideSiteX, slideLegend } from "../ui/overlay-layout";
import { BASEMAP_STACK, tilesFor, tileUrl, viewportFor, type BasemapChoice } from "../ui/map-projection";
import { mapKeyOf, type PlannedSlide } from "./report-plan";
import type { MapImages } from "./render-pptx";

// 슬라이드 비율(16:9)로 그린다: 지도가 슬라이드 전체이고 오버레이는 pptx 도형이 얹는다
const VIEW_W = 960;
const VIEW_H = 540;
const OUT_W = 1920;
const OUT_H = 1080;
const PX_PER_INCH = VIEW_W / SLIDE.w;
type Extra = Pick<MapFigureProps, "muted" | "siteX" | "avoid">;
const TILE_TIMEOUT_MS = 8000;

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

function svgOf(model: MapModel, tiles: Map<string, string>, layer: BasemapChoice, extra: Extra): string {
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    const usable = tiles.size > 0;
    flushSync(() =>
      root.render(
        createElement(MapFigure, {
          model,
          width: VIEW_W,
          height: VIEW_H,
          fixed: true,
          basemap: usable ? "tiles" : "none",
          layer,
          tileHref: (u: string) => tiles.get(u),
          label: "분석 반경 지도",
          // 범례·북쪽·저작권은 슬라이드의 판/출처 띠가 대신한다 (축척만 그림 안, 출처 띠 위)
          legend: false,
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
export async function rasterizeMap(model: MapModel, tileCache: Map<string, string | null> = new Map(), layer: BasemapChoice = "white", extra: Extra = {}): Promise<string> {
  const vp = viewportFor(model.center, model.radiusM, VIEW_W, VIEW_H);
  const urls = BASEMAP_STACK[layer].flatMap((ly) => tilesFor(vp).map((t) => tileUrl(ly, t.z, t.x, t.y)));
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
  return toPng(svgOf(model, got, layer, extra));
}

/** 슬라이드마다 다른 오버레이 자리를 피하게 한다 (표지·출처는 지도 가운데, 타일은 오른쪽 정보 판을 뺀 영역) */
function extraFor(p: PlannedSlide, model: MapModel): Extra {
  if (p.kind !== "tile") return { avoid: slideReserved(PX_PER_INCH, { info: false }) };
  return { muted: p.muted, siteX: slideSiteX(), avoid: slideReserved(PX_PER_INCH, { legend: slideLegend(model).rect }) };
}

/** 계획의 모든 지도 자리에 대한 PNG. 실패한 장은 빠진다(렌더러가 자리표시를 넣는다). */
export async function buildMapImages(plan: PlannedSlide[], layer: BasemapChoice = "white"): Promise<MapImages> {
  const cache = new Map<string, string | null>();
  const out: MapImages = {};
  for (const p of plan) {
    const key = mapKeyOf(p);
    const model = p.map;
    if (!key || !model || out[key]) continue;
    try {
      out[key] = await rasterizeMap(model, cache, layer, extraFor(p, model));
    } catch (e) {
      console.warn(`지도 이미지 생성 실패 (${key})`, e);
    }
  }
  return out;
}
