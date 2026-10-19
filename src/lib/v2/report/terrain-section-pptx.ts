import type { TerrainSections } from "../tile-result";
import { FONT, INK, LINE, MUTED, fitPt, plate, seg, type Slide } from "./pptx-kit";
import type { Rect } from "../ui/overlay-layout";
import { layerStyle } from "../ui/map-layers";
import { terrainCrossingLayer, terrainElevationLabel, terrainSectionAxisLabel, terrainSectionElevationAt, terrainSectionMarkerGeometry, terrainSectionPosition, terrainSectionTotal, sortTerrainCrossings, TERRAIN_CROSSING_LABELS, TERRAIN_SECTION_LABELS } from "../ui/terrain-section";

const SECTION_LABELS = TERRAIN_SECTION_LABELS;
const CROSSING_LABELS = TERRAIN_CROSSING_LABELS;
const CAVEAT = "등고선·표고점 보간값(추정)입니다. 현장 실측을 대신하지 않습니다.";

function validSamples(section: TerrainSections["A"]): Array<{ d: number; z: number }> {
  return section.samples.filter((sample): sample is { d: number; z: number } => sample.z !== null && Number.isFinite(sample.z));
}

function siteSamples(section: TerrainSections["A"]): Array<{ d: number; z: number }> {
  const [start, end] = section.siteSpan;
  return validSamples(section).filter((sample) => sample.d >= start && sample.d <= end);
}

function rangeOf(section: TerrainSections["A"]): number | null {
  const values = siteSamples(section).map((sample) => sample.z);
  return values.length > 1 ? Math.max(...values) - Math.min(...values) : null;
}

function slopeOf(section: TerrainSections["A"]): number | null {
  const [start, end] = section.siteSpan;
  const values: number[] = [];
  for (let index = 1; index < section.samples.length; index += 1) {
    const before = section.samples[index - 1];
    const current = section.samples[index];
    if (before.z === null || current.z === null || before.d > end || current.d < start || current.d === before.d) continue;
    values.push(Math.atan(Math.abs(current.z - before.z) / (current.d - before.d)) * 180 / Math.PI);
  }
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function fmt(value: number | null, unit = "m"): string {
  return value === null ? "미확인" : `${value.toFixed(1)}${unit}`;
}

function drawProfile(slide: Slide, section: TerrainSections["A"], rect: Rect, group: string): void {
  const pad = { left: 0.52, right: 0.12, top: 0.38, bottom: 0.28 };
  const width = Math.max(0.6, rect.w - pad.left - pad.right);
  const height = Math.max(0.35, rect.h - pad.top - pad.bottom);
  const samples = validSamples(section);
  const minZ = samples.length > 0 ? Math.min(...samples.map((sample) => sample.z)) : 0;
  const maxZ = samples.length > 0 ? Math.max(...samples.map((sample) => sample.z)) : 1;
  const zRange = Math.max(1, maxZ - minZ);
  const total = terrainSectionTotal(section);
  const xFor = (d: number) => rect.x + pad.left + (d / total) * width;
  const yFor = (z: number) => rect.y + pad.top + height - ((z - minZ) / zRange) * height;
  const [siteStart, siteEnd] = section.siteSpan;
  slide.addShape("rect", { x: xFor(siteStart), y: rect.y + pad.top, w: Math.max(0.01, xFor(siteEnd) - xFor(siteStart)), h: height, fill: { color: "2350B8", transparency: 91 }, line: { color: "2350B8", transparency: 100, width: 0 }, objectName: `${group}|site-span` });
  slide.addShape("line", { x: rect.x + pad.left, y: rect.y + pad.top + height, w: width, h: 0, line: { color: "B9C0CA", width: 0.5 }, objectName: `${group}|axis` });
  for (let index = 1; index < section.samples.length; index += 1) {
    const before = section.samples[index - 1];
    const current = section.samples[index];
    if (before.z === null || current.z === null) continue;
    seg(slide, [xFor(before.d), yFor(before.z)], [xFor(current.d), yFor(current.z)], "8A5A2E", 1.5, 0, `${group}|profile`);
  }
  for (const [index, crossing] of sortTerrainCrossings(section).entries()) {
    const style = layerStyle(terrainCrossingLayer(crossing.kind));
    const x = xFor(crossing.d);
    const elevation = terrainSectionElevationAt(section, crossing.d);
    const marker = elevation === null ? null : terrainSectionMarkerGeometry(x, yFor(elevation), 0.08);
    const color = style.color.replace(/^#/, "");
    const dashType = style.dash === "1 3" ? "sysDot" : style.dash ? "dash" : "solid";
    if (marker) {
      slide.addShape("line", { x: marker.x, y: marker.y1, w: 0.001, h: marker.y2 - marker.y1, line: { color: "FFFFFF", width: (style.strokeWidth ?? 1.5) + 2 }, objectName: `${group}|step-${index}-halo` });
      slide.addShape("line", { x: marker.x, y: marker.y1, w: 0.001, h: marker.y2 - marker.y1, line: { color, width: style.strokeWidth ?? 1.5, dashType }, objectName: `${group}|step-${index}` });
    }
  }
  slide.addText(terrainSectionAxisLabel(section), { x: rect.x + pad.left, y: rect.y + pad.top + height + 0.03, w: width, h: 0.18, align: "center", fontFace: FONT, fontSize: 8.5, color: MUTED, margin: 0, fit: "shrink", objectName: `${group}|axis-label` });
  slide.addText(terrainElevationLabel(maxZ), { x: rect.x, y: rect.y + pad.top - 0.16, w: 0.48, h: 0.16, align: "right", fontFace: FONT, fontSize: 8.5, color: MUTED, margin: 0 });
  slide.addText(terrainElevationLabel(minZ), { x: rect.x, y: rect.y + pad.top + height - 0.1, w: 0.48, h: 0.16, align: "right", fontFace: FONT, fontSize: 8.5, color: MUTED, margin: 0 });
}

/** D17 지도 장 위에 선택 단면을 편집 가능한 PPT 도형으로 그린다. */
export function drawTerrainSectionPptx(slide: Slide, sections: TerrainSections, selected: "A" | "B", rect: Rect, facilityCount: number | null = null): void {
  const section = sections[selected];
  const group = `GRP|terrain-section|${selected}`;
  plate(slide, rect, 0.12, `${group}|plate`);
  const titleH = 0.24;
  slide.addText(`${SECTION_LABELS[selected]} · 지형 단면`, { x: rect.x + 0.16, y: rect.y + 0.1, w: rect.w - 0.32, h: titleH, fontFace: FONT, fontSize: fitPt(`${SECTION_LABELS[selected]} · 지형 단면`, 9.5, rect.w - 0.32, 1, 7), bold: true, color: INK, margin: 0, objectName: `${group}|title` });
  const graph = { x: rect.x, y: rect.y + 0.34, w: Math.max(2.4, rect.w * 0.62), h: rect.h - 0.45 };
  drawProfile(slide, section, graph, group);
  const tableX = rect.x + rect.w * 0.65;
  const tableW = rect.x + rect.w - tableX - 0.14;
  slide.addText("종류 · 위치 · 높이", { x: tableX, y: rect.y + 0.43, w: tableW, h: 0.18, fontFace: FONT, fontSize: 7.5, bold: true, color: MUTED, margin: 0, objectName: `${group}|table-title` });
  const rows = sortTerrainCrossings(section).slice(0, 5);
  rows.forEach((crossing, index) => {
    const y = rect.y + 0.66 + index * 0.24;
    const text = `${CROSSING_LABELS[crossing.kind]} · ${terrainSectionPosition(section, crossing.d)} · ${crossing.heightM === null ? "높이 미확인" : `${crossing.heightM.toFixed(1)}m`}`;
    slide.addText(text, { x: tableX, y, w: tableW, h: 0.2, fontFace: FONT, fontSize: fitPt(text, 7.2, tableW, 1, 6), color: INK, margin: 0, fit: "shrink", objectName: `${group}|table-row-${index}` });
    slide.addShape("line", { x: tableX, y: y + 0.22, w: tableW, h: 0, line: { color: LINE, width: 0.45 }, objectName: `${group}|table-rule-${index}` });
  });
  if (rows.length === 0) slide.addText("단면을 가로지르는 시설 없음", { x: tableX, y: rect.y + 0.66, w: tableW, h: 0.2, fontFace: FONT, fontSize: 7.2, color: MUTED, margin: 0, fit: "shrink", objectName: `${group}|table-empty` });
  if (section.crossings.length > rows.length) slide.addText(`외 ${section.crossings.length - rows.length}건`, { x: tableX, y: rect.y + 0.66 + rows.length * 0.24, w: tableW, h: 0.2, fontFace: FONT, fontSize: 7, color: MUTED, margin: 0, objectName: `${group}|table-more` });
  const summary = `대지 고저차 ${fmt(rangeOf(section))} · 대지 평균 경사 ${fmt(slopeOf(section), "°")} · 반경 내 단차 시설 수 ${facilityCount ?? section.crossings.length}개`;
  slide.addText(summary, { x: rect.x + 0.16, y: rect.y + rect.h - 0.28, w: rect.w - 0.32, h: 0.16, fontFace: FONT, fontSize: fitPt(summary, 7.5, rect.w - 0.32, 1, 6), color: MUTED, margin: 0, fit: "shrink", objectName: `${group}|summary` });
  slide.addText(CAVEAT, { x: tableX, y: rect.y + rect.h - 0.28, w: tableW, h: 0.16, fontFace: FONT, fontSize: 5.7, color: "6B4B31", margin: 0, fit: "shrink", objectName: `${group}|caveat` });
}
