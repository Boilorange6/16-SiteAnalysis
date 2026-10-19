"use client";

import type { ChangeEvent } from "react";
import type { TerrainSections } from "../../tile-result";
import type { TerrainSectionId } from "../../ui/board-state";
import type { TileDialogPanelProps } from "../component-types";
import type { TileView } from "../../ui/tile-view";
import styles from "./Panel.module.css";

const CAVEAT = "등고선·표고점 보간값(추정)입니다. 현장 실측을 대신하지 않습니다.";
const SECTION_LABELS: Record<TerrainSectionId, string> = {
  A: "단면 A–A′ (동서)",
  B: "단면 B–B′ (남북)",
};
const CROSSING_LABELS = { retaining: "옹벽", cut_fill: "절성토", fence: "울타리" } as const;

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

function positionLabel(section: Section, d: number): string {
  const total = Math.hypot(section.to[0] - section.from[0], section.to[1] - section.from[1]);
  const offset = d - total / 2;
  return `${formatNumber(Math.abs(offset), 1)}m ${offset < 0 ? "전" : "후"}`;
}

function chartPaths(section: Section, width: number, height: number, pad: number): { paths: string[]; minZ: number; maxZ: number; xFor: (d: number) => number; yFor: (z: number) => number } {
  const samples = validSamples(section);
  const minZ = samples.length > 0 ? Math.min(...samples.map((sample) => sample.z)) : 0;
  const maxZ = samples.length > 0 ? Math.max(...samples.map((sample) => sample.z)) : 1;
  const range = Math.max(1, maxZ - minZ);
  const total = Math.max(1, Math.hypot(section.to[0] - section.from[0], section.to[1] - section.from[1]));
  const xFor = (d: number) => pad + (d / total) * (width - pad * 2);
  const yFor = (z: number) => height - pad - ((z - minZ) / range) * (height - pad * 2);
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
  const width = 520;
  const height = 176;
  const pad = 30;
  const { paths, minZ, maxZ, xFor, yFor } = chartPaths(section, width, height, pad);
  const total = Math.max(1, section.samples.at(-1)?.d ?? 1);
  const [siteStart, siteEnd] = section.siteSpan;
  return (
    <figure className={styles.graphWrap} aria-labelledby={`${id}-title`} aria-describedby={`${id}-table-title`}>
      <svg className={styles.graph} viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${id}-title`}>
        <title id={`${id}-title`}>{SECTION_LABELS[section.axis === "EW" ? "A" : "B"]} 표고 프로파일</title>
        <rect className={styles.siteSpan} x={xFor(siteStart)} y={pad} width={Math.max(0, xFor(siteEnd) - xFor(siteStart))} height={height - pad * 2} />
        <line className={styles.axis} x1={pad} x2={width - pad} y1={height - pad} y2={height - pad} />
        <text x={pad} y={height - 10}>{formatNumber(0, 0)}m</text>
        <text x={width - pad} y={height - 10} textAnchor="end">{formatNumber(total, 0)}m</text>
        <text x={pad} y={pad - 8}>{formatNumber(maxZ, 1)}m</text>
        <text x={pad} y={height - pad - 5}>{formatNumber(minZ, 1)}m</text>
        {section.crossings.map((crossing, index) => (
          <g key={`${crossing.d}-${crossing.kind}-${index}`}>
            <line className={styles.step} x1={xFor(crossing.d)} x2={xFor(crossing.d)} y1={pad} y2={height - pad} />
            <title>{`${CROSSING_LABELS[crossing.kind]} · ${positionLabel(section, crossing.d)} · ${crossing.heightM === null ? "높이 미확인" : `${formatNumber(crossing.heightM)}m`}`}</title>
          </g>
        ))}
        {paths.map((path, index) => <path key={index} className={styles.profile} d={path} />)}
      </svg>
      <p className={styles.graphNote}>파란 음영 = 대지 구간 · 갈색 선 = 표고 · 점선 = 단차 시설</p>
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
            {section.crossings.length === 0 ? <tr><td colSpan={3}><p className={styles.empty}>단면을 가로지르는 시설 없음</p></td></tr> : section.crossings.map((crossing, index) => (
              <tr key={`${crossing.d}-${crossing.kind}-${index}`}>
                <td>{CROSSING_LABELS[crossing.kind]}</td>
                <td>{positionLabel(section, crossing.d)}</td>
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
