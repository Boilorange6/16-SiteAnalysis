"use client";

import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import type { PlannedSlide, ReportSlide } from "@/lib/v2/report/report-plan";
import { Stage } from "./tile-card";
import { useFocusTrap } from "./use-focus-trap";
import styles from "./board.module.css";

type Props = {
  /** buildReportPlan의 순서·면·복제 id를 그대로 소비한다. */
  plan: PlannedSlide[];
  onClose: () => void;
};

function sheetColumns(grid: Extract<ReportSlide, { kind: "sheet" }>["grid"]): number {
  return grid === "2x2" ? 2 : 3;
}

function TileSlide({ slide }: { slide: Extract<ReportSlide, { kind: "tile" }> }) {
  const titleId = useId();
  const state = slide.body.kind === "state";
  const chart = slide.view.hasFace && slide.body.face === "back";
  return (
    <section className={`${styles.presentationSlide} ${styles.presentationVisualSlide}`} aria-labelledby={titleId}>
      <div className={styles.presentationStage}>
        <Stage
          key={slide.view.tileId}
          view={slide.view}
          state={state}
          chart={chart}
          frame="detail"
          page={slide.callout?.page}
          onPage={() => {}}
          pinnedKeys={slide.pinnedKeys ?? []}
          mapResetKey={slide.view.tileId}
        />
      </div>
      <header className={styles.presentationVisualHead}>
        <h2 id={titleId}>{slide.view.title}</h2>
        {slide.faceLabel && <span>{slide.faceLabel}</span>}
        {slide.callout && <span>설명표 {slide.callout.page + 1} / {slide.callout.pages}</span>}
      </header>
      {slide.body.kind === "state" && <p className={styles.presentationState}>{slide.body.message}</p>}
    </section>
  );
}

function SheetSlide({ slide }: { slide: Extract<ReportSlide, { kind: "sheet" }> }) {
  const titleId = useId();
  const columns = sheetColumns(slide.grid);
  return (
    <section className={`${styles.presentationSlide} ${styles.presentationVisualSlide}`} aria-labelledby={titleId}>
      <header className={styles.presentationVisualHead}>
        <h2 id={titleId}>{slide.view.title}</h2>
        <span>{slide.grid}</span>
      </header>
      <div className={styles.presentationSheetGrid} style={{ "--presentation-sheet-cols": columns } as CSSProperties}>
        {slide.cells.map((cell, index) => cell ? (
          <div key={cell.mapKey} className={styles.presentationSheetCell}>
            <Stage
              key={cell.view.tileId}
              view={cell.view}
              state={false}
              chart={cell.view.hasFace && cell.face === "back"}
              frame="detail"
              pinnedKeys={cell.pinnedKeys ?? []}
              mapResetKey={cell.view.tileId}
            />
            <span className={styles.presentationSheetLabel}>{cell.view.title}</span>
          </div>
        ) : (
          <div key={`empty-${index}`} className={styles.presentationSheetCell}>타일 선택</div>
        ))}
      </div>
    </section>
  );
}

function CoverSlide({ slide }: { slide: Extract<ReportSlide, { kind: "cover" }> }) {
  return (
    <section className={`${styles.presentationSlide} ${styles.presentationTextSlide}`} aria-labelledby="presentation-cover-title">
      <p className={styles.presentationKicker}>대지분석 v2 · 발표</p>
      <h2 id="presentation-cover-title">{slide.address}</h2>
      <dl className={styles.presentationMetrics}>
        {slide.metrics.map((metric) => <div key={metric.label}><dt>{metric.label}</dt><dd>{metric.value}</dd></div>)}
      </dl>
      <ul className={styles.presentationLineList}>
        {slide.lines.map((line) => <li key={line.title}><span style={{ background: line.color }} aria-hidden="true" /> <b>{line.title}</b><span>{line.text}</span></li>)}
      </ul>
      <p className={styles.presentationAsOf}>{slide.asOfLine}{slide.incomplete ? ` · ${slide.incomplete}` : ""}</p>
    </section>
  );
}

function SourcesSlide({ slide }: { slide: Extract<ReportSlide, { kind: "sources" }> }) {
  return (
    <section className={`${styles.presentationSlide} ${styles.presentationTextSlide}`} aria-labelledby="presentation-sources-title">
      <p className={styles.presentationKicker}>대지분석 v2 · 출처</p>
      <h2 id="presentation-sources-title">출처·기준일</h2>
      <div className={styles.presentationSourcesWrap}>
        <table className={styles.presentationSources}>
          <thead><tr><th>자료</th><th>기준일</th><th>사용 타일</th><th>제공처</th></tr></thead>
          <tbody>{slide.rows.map((row) => <tr key={`${row.source}|${row.asOf}`}><td>{row.source}</td><td>{row.asOf}</td><td>{row.tiles}</td><td>{row.provider ?? "제공처 미기록"}</td></tr>)}</tbody>
        </table>
      </div>
      <p className={styles.presentationAsOf}>분석일 {slide.analysisDate}</p>
    </section>
  );
}

function Slide({ slide }: { slide: PlannedSlide }) {
  if (slide.kind === "cover") return <CoverSlide slide={slide} />;
  if (slide.kind === "sources") return <SourcesSlide slide={slide} />;
  if (slide.kind === "sheet") return <SheetSlide slide={slide} />;
  return <TileSlide slide={slide} />;
}

export default function Presentation({ plan, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const total = plan.length;
  const current = plan[index] ?? plan[0];

  useFocusTrap({ ref, onClose });

  useEffect(() => {
    setIndex((value) => Math.min(value, Math.max(0, total - 1)));
  }, [total]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const request = element.requestFullscreen?.();
    if (request) void request.catch(() => { /* 브라우저 정책으로 거부되어도 오버레이 발표는 계속한다. */ });
    return () => {
      if (document.fullscreenElement === element) void document.exitFullscreen().catch(() => {});
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!ref.current?.contains(event.target as Node)) return;
      if (event.key === "ArrowRight" || event.key === "PageDown" || event.key === " " || event.key === "Spacebar") {
        event.preventDefault();
        setIndex((value) => Math.min(total - 1, value + 1));
      } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        setIndex((value) => Math.max(0, value - 1));
      } else if (event.key === "Home") {
        event.preventDefault();
        setIndex(0);
      } else if (event.key === "End") {
        event.preventDefault();
        setIndex(Math.max(0, total - 1));
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [total]);

  if (!current) return null;
  return (
    <div ref={ref} className={styles.presentation} role="dialog" aria-modal="true" aria-labelledby="presentation-heading" tabIndex={-1}>
      <header className={styles.presentationTopbar}>
        <h1 id="presentation-heading">발표 모드</h1>
        <span className={styles.presentationDeckTitle}>대지분석 보고서</span>
        <button type="button" className={styles.presentationClose} onClick={onClose}>닫기 <span aria-hidden="true">×</span></button>
      </header>
      <main className={styles.presentationViewport} aria-live="polite">
        <Slide slide={current} />
      </main>
      <footer className={styles.presentationControls}>
        <button type="button" onClick={() => setIndex((value) => Math.max(0, value - 1))} disabled={index === 0} aria-label="이전 슬라이드">← 이전</button>
        <span aria-label={`현재 슬라이드 ${index + 1} / ${total}`}>{index + 1} / {total}</span>
        <button type="button" onClick={() => setIndex((value) => Math.min(total - 1, value + 1))} disabled={index >= total - 1} aria-label="다음 슬라이드">다음 →</button>
      </footer>
    </div>
  );
}
