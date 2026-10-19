"use client";

import type { ChangeEvent } from "react";
import type { TerrainSections } from "../../tile-result";
import type { TerrainSectionId } from "../../ui/board-state";
import type { TileDialogPanelProps } from "../component-types";
import type { TileView } from "../../ui/tile-view";
import { layerStyle } from "../../ui/map-layers";
import { terrainCrossingLayer, terrainElevationLabel, terrainSectionAxisStops, terrainSectionElevationAt, terrainSectionMarkerGeometry, terrainSectionPosition, terrainSectionTotal, sortTerrainCrossings, TERRAIN_CROSSING_LABELS, TERRAIN_SECTION_LABELS } from "../../ui/terrain-section";
import styles from "./Panel.module.css";

const CAVEAT = "등고선·표고점 보간값(추정)입니다. 현장 실측을 대신하지 않습니다.";
const SECTION_LABELS: Record<TerrainSectionId, string> = TERRAIN_SECTION_LABELS;
const CROSSING_LABELS = TERRAIN_CROSSING_LABELS;

type Section = NonNullable<TerrainSections>["A"];

function selectedSection(view: TileView, section: TerrainSectionId): Section | null {
  const sections = view.terrainSections;
  return sections ? (section === "A" ? sections.A : sections.B) : null;
}

function validSamples(section: Section): Array<{ d: number; z: number }> {
  return section.samples.filter((sample): sample is { d: number; z: number } => sample.z !== null && Number.isFinite(sample.z));
}

function valueInSite(section: Section): Array<{ d: number; z: number }> {
  const [start, end] = section.siteSpan;
  return validSamples(section).filter((sample) => sample.d >= start && sample.d <= end);
}

function formatNumber(value: number, digits = 1): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
}

function elevationRange(section: Section): number | null {
  const values = valueInSite(section).map((sample) => sample.z);
  return values.length > 1 ? Math.max(...values) - Math.min(...values) : null;
}

function averageSlope(section: Section): number | null {
  const [start, end] = section.siteSpan;
  const samples = section.samples;
  const slopes: number[] = [];
  for (let index = 1; index < samples.length; index += 1) {
    const before = samples[index - 1];
    const current = samples[index];
    if (before.z === null || current.z === null || current.d < start || before.d > end || current.d === before.d) continue;
    slopes.push(Math.atan(Math.abs(current.z - before.z) / (current.d - before.d)) * 180 / Math.PI);
  }
  return slopes.length > 0 ? slopes.reduce((sum, value) => sum + value, 0) / slopes.length : null;
}

function stepCount(view: TileView): number | null {
  const row = view.rows.find((candidate) => candidate.label === "반경 안 단차 시설 수");
  if (!row) return null;
  const value = Number.parseInt(row.value.replace(/[^0-9-]/g, ""), 10);
  return Number.isFinite(value) ? value : null;
}

function chartPaths(section: Section, width: number, height: number, padX: number, padY: number): { paths: string[]; minZ: number; maxZ: number; xFor: (d: number) => number; yFor: (z: number) => number } {
  const samples = validSamples(section);
  const minZ = samples.length > 0 ? Math.min(...samples.map((sample) => sample.z)) : 0;
  const maxZ = samples.length > 0 ? Math.max(...samples.map((sample) => sample.z)) : 1;
  const range = Math.max(1, maxZ - minZ);
  const total = terrainSectionTotal(section);
  const xFor = (d: number) => padX + (d / total) * (width - padX * 2);
  const yFor = (z: number) => height - padY - ((z - minZ) / range) * (height - padY * 2);
  const paths: string[] = [];
  let current: string[] = [];
  for (const sample of section.samples) {
    if (sample.z === null) {
      if (current.length > 0) paths.push(current.join(" "));
      current = [];
      continue;
    }
    current.push(`${current.length === 0 ? "M" : "L"}${xFor(sample.d).toFixed(2)},${yFor(sample.z).toFixed(2)}`);
  }
  if (current.length > 0) paths.push(current.join(" "));
  return { paths, minZ, maxZ, xFor, yFor };
}

function SectionChart({ section, id }: { section: Section; id: string }) {
  const width = 760;
  const height = 240;
  const padX = 52;
  const padY = 28;
  const { paths, minZ, maxZ, xFor, yFor } = chartPaths(section, width, height, padX, padY);
  const total = terrainSectionTotal(section);
  const [siteStart, siteEnd] = section.siteSpan;
  const crossings = sortTerrainCrossings(section);
  const axisStops = terrainSectionAxisStops(section);
  return (
    <figure className={styles.graphWrap} aria-labelledby={`${id}-title`} aria-describedby={`${id}-table-title`}>
      <div className={styles.graphLayout}>
        <div className={styles.graphYAxis} aria-hidden="true">
          <span>{terrainElevationLabel(maxZ)}</span>
          <span>{terrainElevationLabel(minZ)}</span>
        </div>
        <div className={styles.graphMain}>
          <svg className={styles.graph} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-labelledby={`${id}-title`}>
            <title id={`${id}-title`}>{SECTION_LABELS[section.axis === "EW" ? "A" : "B"]} 표고 프로파일</title>
            <rect className={styles.siteSpan} x={xFor(siteStart)} y={padY} width={Math.max(0, xFor(siteEnd) - xFor(siteStart))} height={height - padY * 2} />
            <line className={styles.axis} x1={padX} x2={width - padX} y1={height - padY} y2={height - padY} />
            {paths.map((path, index) => <path key={index} className={styles.profile} d={path} />)}
            {crossings.map((crossing, index) => {
              const style = layerStyle(terrainCrossingLayer(crossing.kind));
              const x = xFor(crossing.d);
              const elevation = terrainSectionElevationAt(section, crossing.d);
              const marker = elevation === null ? null : terrainSectionMarkerGeometry(x, yFor(elevation));
              return (
                <g key={`${crossing.d}-${crossing.kind}-${index}`}>
                  {marker && <>
                    <line className={styles.stepHalo} x1={marker.x} x2={marker.x} y1={marker.y1} y2={marker.y2} stroke="#fff" strokeWidth={Math.max(3, (style.strokeWidth ?? 1.5) + 2)} strokeLinecap="round" />
                    <line className={styles.step} x1={marker.x} x2={marker.x} y1={marker.y1} y2={marker.y2} stroke={style.color} strokeWidth={Math.max(1.5, style.strokeWidth ?? 1.5)} strokeDasharray={style.dash} strokeLinecap={style.lineCap ?? "butt"} />
                  </>}
                  <title>{`${CROSSING_LABELS[crossing.kind]} · ${terrainSectionPosition(section, crossing.d)} · ${crossing.heightM === null ? "높이 미확인" : `${formatNumber(crossing.heightM)}m`}`}</title>
                </g>
              );
            })}
          </svg>
          <div className={styles.graphXAxis} aria-hidden="true">
            <span>{axisStops[0]}</span>
            <span>{axisStops[1]}</span>
            <span>{axisStops[2]}</span>
          </div>
        </div>
      </div>
      <p className={styles.graphNote}>파란 음영 = 대지 구간 · 갈색 선 = 표고 · 표식 = 단차 시설(범례와 같은 모양)</p>
      <span id={`${id}-table-title`} className={styles.srOnly}>단면 그래프의 단차 시설 표</span>
    </figure>
  );
}

export default function D17Panel({ view, titleId, terrainSection = "A", onTerrainSection }: TileDialogPanelProps) {
  if (view.code !== "D17" || !view.terrainSections) return null;
  const section = selectedSection(view, terrainSection) ?? view.terrainSections.A;
  const current = section === view.terrainSections.B ? "B" : "A";
  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.currentTarget.checked) onTerrainSection?.(event.currentTarget.value as TerrainSectionId);
  };
  const range = elevationRange(section);
  const slope = averageSlope(section);
  const count = stepCount(view);
  return (
    <section className={styles.panel} aria-labelledby={`${titleId}-terrain-title`}>
      <div className={styles.heading}>
        <h3 id={`${titleId}-terrain-title`}>지형·등고선</h3>
        <p>현장 확인 · 등고선 5 m · 표고점 · 옹벽·절성토</p>
      </div>
      <fieldset className={styles.choices} aria-label="단면 고르기">
        <legend className={styles.srOnly}>단면 고르기</legend>
        {(["A", "B"] as const).map((id) => (
          <label className={styles.choice} key={id}>
            <input type="radio" name={`terrain-section-${view.tileId}`} value={id} checked={current === id} onChange={onChange} />
            {SECTION_LABELS[id]}
          </label>
        ))}
      </fieldset>
      <SectionChart section={section} id={`${titleId}-terrain-chart`} />
      <div className={styles.tableWrap}>
        <table className={styles.table} aria-label={`${SECTION_LABELS[current]} 단차 시설`}>
          <caption className={styles.srOnly}>단차 시설 표</caption>
          <thead><tr><th scope="col">종류</th><th scope="col">위치</th><th scope="col">높이</th></tr></thead>
          <tbody>
            {section.crossings.length === 0 ? <tr><td colSpan={3}><p className={styles.empty}>단면을 가로지르는 시설 없음</p></td></tr> : sortTerrainCrossings(section).map((crossing, index) => (
              <tr key={`${crossing.d}-${crossing.kind}-${index}`}>
                <td>{CROSSING_LABELS[crossing.kind]}</td>
                <td>{terrainSectionPosition(section, crossing.d)}</td>
                <td>{crossing.heightM === null ? "높이 미확인" : `${formatNumber(crossing.heightM)}m`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className={styles.summary} aria-label="대지 지형 요약">
        <div className={styles.summaryCard}><dt>대지 고저차</dt><dd>{range === null ? "미확인" : `${formatNumber(range)}m`}</dd></div>
        <div className={styles.summaryCard}><dt>대지 평균 경사</dt><dd>{slope === null ? "미확인" : `${formatNumber(slope)}°`}</dd></div>
      <div className={styles.summaryCard}><dt>반경 내 단차 시설 수</dt><dd>{count === null ? "미확인" : `${count}개`}</dd></div>
      </dl>
      <p className={styles.caveat}>{CAVEAT}</p>
    </section>
  );
}

export const d17DialogRegistration = { codes: ["D17"], Component: D17Panel } as const;
