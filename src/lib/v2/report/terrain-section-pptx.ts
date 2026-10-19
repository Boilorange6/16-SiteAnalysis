import type { TerrainSections } from "../tile-result";
import { FONT, INK, LINE, MUTED, fitPt, plate, seg, type Slide } from "./pptx-kit";
import type { Rect } from "../ui/overlay-layout";
import { layerStyle } from "../ui/map-layers";
import { terrainCrossingLayer, terrainElevationLabel, terrainSectionAxisLabel, terrainSectionBands, terrainSectionElevationAt, terrainSectionMarkerGeometry, terrainSectionPosition, terrainSectionTotal, sortTerrainCrossings, TERRAIN_CROSSING_LABELS, TERRAIN_SECTION_LABELS, TERRAIN_SECTION_TABLE_MAX_ROWS } from "../ui/terrain-section";

const SECTION_LABELS = TERRAIN_SECTION_LABELS;
const CROSSING_LABELS = TERRAIN_CROSSING_LABELS;
const CAVEAT = "보간값(추정) · 현장 실측 아님";

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
  const pad = { left: 0.52, right: 0.12, top: 0.18, bottom: 0.12 };
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
      const y1 = Math.max(rect.y + pad.top, Math.min(rect.y + pad.top + height, marker.y1));
      const y2 = Math.max(rect.y + pad.top, Math.min(rect.y + pad.top + height, marker.y2));
      slide.addShape("line", { x: marker.x, y: y1, w: 0.001, h: Math.max(0.001, y2 - y1), line: { color: "FFFFFF", width: (style.strokeWidth ?? 1.5) + 2 }, objectName: `${group}|step-${index}-halo` });
      slide.addShape("line", { x: marker.x, y: y1, w: 0.001, h: Math.max(0.001, y2 - y1), line: { color, width: style.strokeWidth ?? 1.5, dashType }, objectName: `${group}|step-${index}` });
    }
  }
  slide.addText(terrainElevationLabel(maxZ), { x: rect.x, y: rect.y + 0.01, w: 0.48, h: 0.14, fontFace: FONT, fontSize: 8.5, color: MUTED, margin: 0, fit: "shrink", objectName: `${group}|y-max` });
  slide.addText(terrainElevationLabel(minZ), { x: rect.x, y: rect.y + rect.h - 0.15, w: 0.48, h: 0.14, fontFace: FONT, fontSize: 8.5, color: MUTED, margin: 0, fit: "shrink", objectName: `${group}|y-min` });
}

function ellipsize(value: string, maxChars: number): string {
  const chars = [...value];
  return chars.length <= maxChars ? value : `${chars.slice(0, Math.max(1, maxChars - 1)).join("")}…`;
}

/** D17 지도 장 위에 선택 단면을 편집 가능한 PPT 도형으로 그린다. */
export function drawTerrainSectionPptx(slide: Slide, sections: TerrainSections, selected: "A" | "B", rect: Rect, facilityCount: number | null = null): void {
  const section = sections[selected];
  const group = `GRP|terrain-section|${selected}`;
  const bands = terrainSectionBands(rect);
  plate(slide, rect, 0.12, `${group}|plate`);
  const title = `${SECTION_LABELS[selected]} · 지형 단면`;
  slide.addText(title, { x: bands.header.x, y: bands.header.y, w: bands.header.w, h: bands.header.h, fontFace: FONT, fontSize: fitPt(title, 9.5, bands.header.w, 1, 7), bold: true, color: INK, margin: 0, fit: "shrink", objectName: `${group}|title` });
  drawProfile(slide, section, bands.plot, group);
  slide.addText(terrainSectionAxisLabel(section), { x: bands.axis.x + 0.52, y: bands.axis.y + 0.01, w: Math.max(0.2, bands.axis.w - 0.64), h: bands.axis.h - 0.02, align: "center", fontFace: FONT, fontSize: fitPt(terrainSectionAxisLabel(section), 8.5, Math.max(0.2, bands.axis.w - 0.64), 1, 6), color: MUTED, margin: 0, fit: "shrink", objectName: `${group}|axis-label` });

  const tableX = bands.table.x;
  const tableW = bands.table.w;
  const kindW = tableW * 0.29;
  const positionW = tableW * 0.4;
  const heightW = Math.max(0.2, tableW - kindW - positionW);
  const rows = sortTerrainCrossings(section).slice(0, TERRAIN_SECTION_TABLE_MAX_ROWS);
  const lineCount = Math.max(1, rows.length + (section.crossings.length > rows.length ? 1 : 0));
  const caveatH = 0.16;
  const tableBodyY = bands.table.y + 0.2;
  const caveatY = bands.table.y + bands.table.h - caveatH;
  const rowH = Math.min(0.2, Math.max(0.14, (caveatY - tableBodyY - 0.03) / lineCount));
  slide.addText("종류", { x: tableX, y: bands.table.y, w: kindW, h: 0.16, fontFace: FONT, fontSize: 7.5, bold: true, color: MUTED, margin: 0, fit: "shrink", objectName: `${group}|table-title-kind` });
  slide.addText("위치", { x: tableX + kindW, y: bands.table.y, w: positionW, h: 0.16, fontFace: FONT, fontSize: 7.5, bold: true, color: MUTED, margin: 0, fit: "shrink", objectName: `${group}|table-title-position` });
  slide.addText("높이", { x: tableX + kindW + positionW, y: bands.table.y, w: heightW, h: 0.16, align: "right", fontFace: FONT, fontSize: 7.5, bold: true, color: MUTED, margin: 0, fit: "shrink", objectName: `${group}|table-title-height` });
  const addTableRow = (kind: string, position: string, height: string, index: number, color = INK) => {
    const y = tableBodyY + index * rowH;
    slide.addText(ellipsize(kind, 6), { x: tableX, y, w: kindW, h: Math.max(0.1, rowH - 0.03), fontFace: FONT, fontSize: fitPt(kind, 7.2, kindW, 1, 5.5), color, margin: 0, fit: "shrink", objectName: `${group}|table-row-${index}-kind` });
    slide.addText(ellipsize(position, 14), { x: tableX + kindW, y, w: positionW, h: Math.max(0.1, rowH - 0.03), fontFace: FONT, fontSize: fitPt(position, 7.2, positionW, 1, 5.5), color, margin: 0, fit: "shrink", objectName: `${group}|table-row-${index}-position` });
    slide.addText(ellipsize(height, 8), { x: tableX + kindW + positionW, y, w: heightW, h: Math.max(0.1, rowH - 0.03), align: "right", fontFace: FONT, fontSize: fitPt(height, 7.2, heightW, 1, 5.5), color, margin: 0, fit: "shrink", objectName: `${group}|table-row-${index}-height` });
    slide.addShape("line", { x: tableX, y: y + rowH - 0.02, w: tableW, h: 0, line: { color: LINE, width: 0.45 }, objectName: `${group}|table-rule-${index}` });
  };
  rows.forEach((crossing, index) => addTableRow(CROSSING_LABELS[crossing.kind], terrainSectionPosition(section, crossing.d), crossing.heightM === null ? "높이 미확인" : `${crossing.heightM.toFixed(1)}m`, index));
  if (rows.length === 0) addTableRow("시설 없음", "—", "—", 0, MUTED);
  if (section.crossings.length > rows.length) addTableRow("", `외 ${section.crossings.length - rows.length}건`, "", rows.length, MUTED);
  slide.addText(CAVEAT, { x: tableX, y: caveatY, w: tableW, h: caveatH, fontFace: FONT, fontSize: fitPt(CAVEAT, 7, tableW, 1, 7), color: "6B4B31", margin: 0, fit: "shrink", objectName: `${group}|caveat` });

  const summary = `대지 고저차 ${fmt(rangeOf(section))} · 대지 평균 경사 ${fmt(slopeOf(section), "°")} · 반경 내 단차 시설 수 ${facilityCount ?? section.crossings.length}개`;
  slide.addText(summary, { x: bands.footer.x, y: bands.footer.y, w: bands.footer.w, h: bands.footer.h, fontFace: FONT, fontSize: fitPt(summary, 7.5, bands.footer.w, 1, 5.5), color: MUTED, margin: 0, fit: "shrink", objectName: `${group}|summary` });
}
