import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createElement } from "react";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

globalThis.React = React;

const { default: MapFigure } = await import("../../components/v2/map-figure.tsx");
const requireFromWorktree = createRequire(new URL("../../../package.json", import.meta.url));
const sharp = requireFromWorktree("sharp");

const outputDir = process.env.A01_PREVIEW_DIR ?? "C:/Users/da/AppData/Local/Temp/claude/D--V-coding-16-SiteAnalysis/6c9abf34-5f45-4bb2-a9cd-a613cdb3c712/scratchpad/W11";
const mode = process.env.A01_PREVIEW_MODE ?? "after";
const center = [127.056, 37.491];

const model = mode === "before"
  ? {
      center,
      radiusM: 900,
      features: [
        { fid: "station-dogok", layer: "rail_station", lng: 127.056, lat: 37.491, name: "도곡역", sublabel: "5호선·9호선", labelPriority: 1, badges: [{ text: "5", color: "#794698" }, { text: "9", color: "#D24791" }] },
        { fid: "exit-1", layer: "rail_entrance", lng: 127.05625, lat: 37.4909, name: "도곡역 1번 출구", labelPriority: 0 },
        { fid: "exit-2", layer: "rail_entrance", lng: 127.05575, lat: 37.4911, name: "도곡역 2번 출구", labelPriority: 0 },
        { fid: "bus-1", layer: "bus_stop", lng: 127.0549, lat: 37.49135, name: null, labelPriority: 0 },
      ],
      polygons: [],
      lines: [
        { fid: "line-5", layer: "rail_line", points: [[127.052, 37.491], [127.060, 37.491]], name: "5호선", labelPriority: 1, color: "#794698", emphasis: "major" },
        { fid: "line-9", layer: "rail_line", points: [[127.056, 37.487], [127.056, 37.495]], name: "9호선", labelPriority: 1, color: "#D24791", emphasis: "major" },
        { fid: "planned", layer: "planned_rail_line", points: [[127.052, 37.487], [127.060, 37.495]], name: "계획선", labelPriority: 1, color: "#8A5BC7" },
      ],
      total: 4,
      notes: [],
    }
  : {
      center,
      radiusM: 900,
      features: [
        { fid: "station-dogok", layer: "rail_station", lng: 127.056, lat: 37.491, name: "도곡역", sublabel: "5호선·9호선", labelPriority: 1, badges: [{ text: "5", color: "#996CAC" }, { text: "9", color: "#BDB092" }] },
        { fid: "exit-1", layer: "rail_entrance", lng: 127.05625, lat: 37.4909, label: "1", name: "도곡역 1번 출구", labelPriority: 0 },
        { fid: "exit-2", layer: "rail_entrance", lng: 127.05575, lat: 37.4911, label: "2", name: "도곡역 2번 출구", labelPriority: 0 },
        { fid: "bus-1", layer: "bus_stop", lng: 127.0549, lat: 37.49135, name: null, labelPriority: 0 },
      ],
      polygons: [],
      lines: [
        { fid: "axis-5", layer: "rail_station_axis", points: [[127.0543, 37.491], [127.0577, 37.491]], name: null, legendLabel: "5호선", labelPriority: 0, color: "#996CAC", casing: "#FFFFFF", strokeWidth: 9, casingWidth: 13.5, emphasis: "major" },
        { fid: "axis-9", layer: "rail_station_axis", points: [[127.056, 37.4893], [127.056, 37.4927]], name: null, legendLabel: "9호선", labelPriority: 0, color: "#BDB092", casing: "#172033", strokeWidth: 9, casingWidth: 13.5, emphasis: "major" },
        { fid: "line-5", layer: "rail_line", points: [[127.052, 37.491], [127.060, 37.491]], name: "5호선", legendLabel: "5호선", labelPriority: 1, color: "#996CAC", casing: "#FFFFFF", emphasis: "major" },
        { fid: "line-9", layer: "rail_line", points: [[127.056, 37.487], [127.056, 37.495]], name: "9호선", legendLabel: "9호선", labelPriority: 1, color: "#BDB092", casing: "#172033", emphasis: "major" },
        { fid: "planned", layer: "planned_rail_line", points: [[127.052, 37.487], [127.060, 37.495]], name: "계획선", labelPriority: 1, color: "#8A5BC7" },
      ],
      total: 4,
      notes: [],
    };

await mkdir(outputDir, { recursive: true });
for (const [name, width, height, extra] of [
  ["card", 480, 320, { showAutomaticLabels: false, compact: true }],
  ["detail", 960, 600, { showAutomaticLabels: true }],
]) {
  const svg = renderToStaticMarkup(createElement(MapFigure, {
    model,
    width,
    height,
    fixed: true,
    basemap: "none",
    scale: false,
    north: false,
    ...extra,
  }));
  const stem = join(outputDir, `a01-transit-${mode}-${name}`);
  await writeFile(`${stem}.svg`, svg, "utf8");
  await sharp(Buffer.from(svg)).png().toFile(`${stem}.png`);
  console.log(`${name}: ${stem}.png`);
}
