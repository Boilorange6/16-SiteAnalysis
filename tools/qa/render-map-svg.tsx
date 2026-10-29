// 실제 분석의 타일 지도를 화면과 같은 MapFigure SVG로 그리고, 대지 바깥 윤곽의 변 길이·꼭짓점 표고를 출력한다.
// npx tsx tools/qa/render-map-svg.tsx <analysisId> <outDir> [A12,D03] [460x330] [--marks] [--zoom=2.5]
// --marks: 대지 치수·표고 장식을 켠다. --zoom: 대지 중심으로 확대(zoomDelta).
// 환경변수: V2_APP_DB_PATH(기본 .cache/v2/app.sqlite)
import Database from "better-sqlite3";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadScene, loadTileResults } from "@/lib/v2/app-db";
import { toUtmk } from "@/lib/v2/crs";
import { toTileView } from "@/lib/v2/ui/tile-view";
import { siteParcelFromResults } from "@/lib/v2/ui/site-parcel";
import { siteOutlineFromScene } from "@/lib/v2/ui/site-outline";
import MapFigure from "@/components/v2/map-figure";

(globalThis as any).React = React;
const flags = process.argv.slice(2).filter((a) => a.startsWith("--"));
const [id, outDir, codesArg = "A12", sizeArg = "460x330"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const siteMarks = flags.includes("--marks") ? { dims: true, elevations: true } : undefined;
const zoom = Number(flags.find((f) => f.startsWith("--zoom="))?.slice(7));
const view = Number.isFinite(zoom) ? { zoomDelta: zoom, offsetM: [0, 0] } : undefined;
if (!id || !outDir) throw new Error("usage: render-map-svg.tsx <analysisId> <outDir> [A12,D03] [460x330]");
const [width, height] = sizeArg.split("x").map(Number);
const db = new Database(process.env.V2_APP_DB_PATH ?? ".cache/v2/app.sqlite", { readonly: true });
const scene: any = loadScene(db as any, id);
const results = loadTileResults(db as any, id);
mkdirSync(outDir, { recursive: true });

const outline = siteOutlineFromScene(scene);
console.log("ground", scene.ground.kind, "site rings", scene.site?.length ?? 0);
for (const [r, ring] of (outline?.rings ?? []).entries()) {
  const edges = ring.points.map((p, i) => {
    const [ax, ay] = toUtmk(p);
    const [bx, by] = toUtmk(ring.points[(i + 1) % ring.points.length]);
    return (Math.round(Math.hypot(bx - ax, by - ay) * 10) / 10).toFixed(1);
  });
  console.log(`ring ${r}: edges m ${edges.join(" / ")}`);
  console.log(`ring ${r}: elevations ${ring.elevations.map((e) => e ?? "-").join(" / ")}`);
}
if (!outline) console.log("no site outline");

for (const code of codesArg.split(",")) {
  const result = results.find((row: any) => row.tileCode === code);
  if (!result) { console.log(code, "no result"); continue; }
  const model = toTileView(result as any, scene, siteParcelFromResults(results as any)).map;
  if (!model) { console.log(code, "no map"); continue; }
  const svg = renderToStaticMarkup(createElement(MapFigure as any, { model, width, height, fixed: true, layer: "vector", legend: false, credit: false, siteMarks, view }));
  writeFileSync(join(outDir, `${code}.svg`), svg);
  console.log(code, `${width}x${height}`, "svg", svg.length);
}
