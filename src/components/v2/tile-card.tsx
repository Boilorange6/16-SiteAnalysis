"use client";

import { memo, useCallback, useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { CardFace, CutSpec, DemoPhase, PinnedLabel, TileSize } from "@/lib/v2/ui/board-state";
import { STRIP_COLORS } from "@/lib/v2/ui/map-layers";
import { OV, badgesToShow, cardReserved, stripText } from "@/lib/v2/ui/overlay-layout";
import { faceLabel, shortHeadlineLabel, type Badge, type OutputFace, type TileView } from "@/lib/v2/ui/tile-view";
import { cutCandidates, cutKey, cutOwnsRaster, normalizedCut, viewForCut } from "@/lib/v2/ui/cut-selection";
import { faceExtraFor, stageFor } from "@/lib/v2/tile/components";
import MapBox from "./map-box";
import DetailWindow from "./detail-window";
import { LayerSelect } from "./layer-select";
import { mapLabelEntries, type MapFigureElementPick } from "./map-figure";
import styles from "./board.module.css";
import { hasDetail } from "@/lib/v2/ui/detail-state";
import type { TileStageProps } from "@/lib/v2/tile/component-types";

const BADGE_CLASS = { status: styles.badgeStatus, limit: styles.badgeLimit, model: styles.badgeModel } as const;
const FACES: OutputFace[] = ["front", "back", "both"];

function BadgeHint({ text, note, tone }: { text: string; note?: string; tone?: Badge["tone"] }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const popoverId = `badge-note-${useId().replace(/:/g, "")}`;
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        (wrapRef.current?.querySelector("button") as HTMLButtonElement | null)?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);
  const className = `${styles.badge} ${tone ? BADGE_CLASS[tone] : ""}`;
  if (!note) return <span className={className}>{text}</span>;
  return (
    <span ref={wrapRef} className={styles.badgeWrap}>
      <button type="button" className={className} aria-expanded={open} aria-controls={popoverId} aria-describedby={open ? popoverId : undefined} onClick={() => setOpen((value) => !value)}>
        {text}
      </button>
      {open && <span id={popoverId} className={styles.badgePopover} role="tooltip">{note}</span>}
    </span>
  );
}

export function CutSelect({ view, value, onChange, compact = false }: { view: TileView; value?: CutSpec | null; onChange: (cut: CutSpec) => void; compact?: boolean }) {
  const candidates = cutCandidates(view, value);
  if (candidates.length === 0) return null;
  const selected = normalizedCut(view, value);
  const selectedKey = selected ? cutKey(selected) : cutKey(candidates[0]!.cut);
  return (
    <div className={`${styles.mfWind} ${compact ? styles.mfCutCompact : ""}`} data-cut-selector>
      <label className={styles.mfWindLabel}>
        <span>컷</span>
        <select value={selectedKey} onChange={(event) => {
          const picked = candidates.find((candidate) => cutKey(candidate.cut) === event.currentTarget.value);
          if (picked && !picked.disabled) onChange(picked.cut);
        }} aria-label={`${view.title} 컷 선택`}>
          {candidates.map((candidate) => <option key={cutKey(candidate.cut)} value={cutKey(candidate.cut)} disabled={candidate.disabled}>{candidate.label}{candidate.disabled ? " · 계산 대기" : ""}</option>)}
        </select>
      </label>
    </div>
  );
}

export function BadgeList({ badges, extra }: { badges: Badge[]; extra?: string }) {
  if (badges.length === 0 && !extra) return null;
  return (
    <div className={styles.badges}>
      {badges.map((b, i) => (
        <BadgeHint key={`${b.text}-${i}`} text={b.text} note={b.note} tone={b.tone} />
      ))}
      {extra && <span className={styles.badge}>{extra}</span>}
    </div>
  );
}

/** 카드 핵심 값 카드 아래 배지: 최대 2개, 나머지는 "+n" (전부는 펼침에서) */
export function ValueBadges({ badges }: { badges: Badge[] }) {
  const { shown, more } = badgesToShow(badges);
  if (shown.length === 0) return null;
  const hidden = badges.slice(shown.length);
  return (
    <div className={styles.badges}>
      {shown.map((b, i) => (
        <BadgeHint key={`${b.text}-${i}`} text={b.text} note={b.note} tone={b.tone} />
      ))}
      {more > 0 && (
        <BadgeHint text={`+${more}`} note={hidden.map((b) => b.note ? `${b.text}: ${b.note}` : b.text).join(" · ")} />
      )}
    </div>
  );
}

export function Headline({ view, small }: { view: TileView; small?: boolean }) {
  const h = view.headline;
  if (!h) return <div className={styles.sub}>표시할 결과가 없습니다</div>;
  const longAux = !!h.aux && h.aux.length > 4; // "직선" 같은 짧은 보조어만 숫자 옆에 둔다
  const label = shortHeadlineLabel(h.label);
  return (
    <div className={styles.bigWrap}>
      <div className={styles.bigLine}>
        <span className={`${styles.display} ${styles.big} ${small || h.value.length > 5 ? styles.bigSmall : ""}`}>{h.value}</span>
        {h.aux && !longAux && <span className={styles.aux}>{h.aux}</span>}
        <span className={styles.headlineLabel}>· {label}</span>
        {h.tag && <span className={styles.tag}>{h.tag}</span>}
      </div>
      {longAux && <div className={styles.sub}>{h.aux}</div>}
    </div>
  );
}

export function RowList({ rows, className }: { rows: TileView["rows"]; className?: string }) {
  return (
    <ul className={className ?? styles.rows}>
      {rows.map((r, index) => (
        <li key={`${r.label}-${index}`}>
          <span>{r.label}</span>
          <span>
            {r.value}
            {r.aux && <span className={styles.aux}>{r.aux}</span>}
            {r.tag && <span className={styles.tag}>{r.tag}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** 요약면 사실 행: 카드 높이에 들어가는 행만 온전히 보이고, 모자라는 행은 통째로 접는다(잘린 반쪽 행 금지). */
function FitRows({ rows }: { rows: TileView["rows"] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const ul = ref.current?.querySelector("ul");
    // 기준은 높이가 고정된 요약면(.sf, container-type: size) — ul·sfMain은 flex로 줄어들어 기준이 되면 행이 모두 숨는다
    const face = ul?.closest<HTMLElement>(`.${styles.sf}`);
    const foot = face?.querySelector<HTMLElement>(`:scope > .${styles.sfFoot}`);
    if (!ul || !face) return;
    const fit = () => {
      const items = Array.from(ul.children) as HTMLElement[];
      for (const li of items) li.style.display = "";
      const cs = getComputedStyle(face);
      const gap = parseFloat(cs.rowGap) || 0;
      const limit = face.getBoundingClientRect().bottom - parseFloat(cs.paddingBottom) - (foot ? foot.getBoundingClientRect().height + gap : 0) + 0.5;
      for (const li of items) if (li.getBoundingClientRect().bottom > limit) li.style.display = "none";
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(face);
    if (foot) ro.observe(foot);
    return () => ro.disconnect();
  }, [rows]);
  return (
    <div ref={ref} style={{ display: "contents" }}>
      <RowList rows={rows} className={styles.sfRows} />
    </div>
  );
}

export function FaceSelect({ view, value, onChange }: { view: TileView; value: OutputFace; onChange: (f: OutputFace) => void }) {
  return (
    <div className={styles.seg} role="group" aria-label={`${view.title} 보고서 출력`}>
      보고서 출력
      {FACES.map((f) => (
        <button key={f} type="button" aria-pressed={value === f} onClick={() => onChange(f)}>
          {faceLabel(f)}
        </button>
      ))}
    </div>
  );
}

/** 도판 뒤집은 면: 연한 타일색 바탕에 구성비 막대가 가득 (카드·펼침 공통) */
export function FaceChart({ view }: { view: TileView }) {
  const chart = view.chart ?? [];
  const max = Math.max(1, ...chart.map((c) => c.value));
  const valueText = (c: (typeof chart)[number]) => `${c.value}${c.unit === "%" ? "%" : ` ${c.unit}`}`;
  return (
    <div className={styles.faceChart} style={{ background: `${view.color}10` }} role="img" aria-label={`${view.title} 구성비: ${chart.map((c) => `${c.label} ${valueText(c)}`).join(", ")}`}>
      {chart.map((c, i) => (
        <div key={`${c.label}-${i}`} className={styles.fcRow}>
          <span className={styles.fcLabel}>{c.label}</span>
          <span className={styles.fcTrack}>
            <i style={{ width: `${(c.value / max) * 100}%`, background: STRIP_COLORS[i % STRIP_COLORS.length] }} />
          </span>
          <b className={styles.fcVal}>{valueText(c)}</b>
        </div>
      ))}
    </div>
  );
}

// ── 오버레이 조각 (카드·펼침 공통 문법) ──

/** 왼쪽 위: 타일 색 점 + 타일명 + 종류 배지 */
export function TitleChip({ view, lead, tail, headingId, as: H = "h3" }: { view: TileView; lead?: ReactNode; tail?: ReactNode; headingId?: string; as?: "h2" | "h3" }) {
  return (
    <div className={styles.ovTL}>
      <div className={`${styles.plate} ${styles.titleChip}`}>
        {lead}
        <span className={styles.dot} style={{ background: view.color }} />
        <H id={headingId} className={styles.title}>
          {view.title}
        </H>
        <span className={styles.kindTag}>{view.kindLabel}</span>
        {tail}
      </div>
    </div>
  );
}

/** 맨 아래: 출처·기준일 띠 */
export function SourceStrip({ view }: { view: TileView }) {
  const text = stripText(view.sourceLine);
  return (
    <div className={styles.srcStrip} title={text}>
      {text}
    </div>
  );
}

/** 왼쪽 아래: 핵심 값 카드 */
export function ValueCard({ view }: { view: TileView }) {
  if (!view.headline) return null;
  return (
    <div className={`${styles.plate} ${styles.valueCard}`}>
      <Headline view={view} />
      <ValueBadges badges={view.badges} />
    </div>
  );
}

/** 상태 화면 가운데 판: 미제공·실패·자료 없음·대기·계산 중 */
export function StatusPlate({ view, phase, onRetry, waitingNote }: { view: TileView; phase: DemoPhase | null; onRetry?: () => void; waitingNote?: string | null }) {
  const waiting = phase === "pending" || phase === "running";
  const head = waiting ? (phase === "running" ? "계산 중" : "대기") : (view.badges.find((b) => b.tone === "status")?.text ?? "표시할 결과가 없습니다");
  const rest = view.badges.filter((b) => b.tone !== "status");
  const retryText = view.status === "cancelled" ? "다시 계산" : "이 타일 다시 계산";
  return (
    <div className={styles.statusWrap}>
      <div className={`${styles.plate} ${styles.statusPlate}`}>
        {waiting && <span className={styles.spinner} role="status" aria-label={`${view.title} ${head}`} />}
        <b className={styles.statusHead}>{head}</b>
        {waiting && waitingNote && <p className={styles.statusNote}>{waitingNote}</p>}
        {!waiting && view.notes[0] && <p className={styles.statusNote}>{view.notes[0]}</p>}
        {!waiting && rest.length > 0 && <ValueBadges badges={rest} />}
        {!waiting && view.retryable && onRetry && (
          <button type="button" className={styles.retry} onClick={onRetry}>
            {retryText}
          </button>
        )}
      </div>
    </div>
  );
}

/** 전면 시각물: 타일 소유 stage 또는 지도(또는 흐린 대지 지도, 또는 D04 구성비 차트). */
type StageProps = Omit<TileStageProps, "displayView" | "label">;

export function Stage({ view, state, chart, frame, siteX, rightInset, legendY, page, onPage, cut, roseSeason = "annual", pinnedKeys = [], hoverKey = null, emphasisKey = null, onFeaturePin }: StageProps) {
  const selectedCut = normalizedCut(view, cut);
  const displayView = selectedCut ? viewForCut(view, selectedCut) : view;
  if (chart) return <FaceChart view={view} />;
  const card = frame === "card";
  const label = `${view.title} 지도`;
  if (state) return <MapBox model={displayView.backdrop} muted legend={false} north={false} scale={false} credit={false} label={label} siteX={siteX} />;
  const TileStage = stageFor(view.code, displayView);
  if (TileStage) return <TileStage view={view} displayView={displayView} state={state} chart={chart} frame={frame} label={label} page={page} onPage={onPage} cut={selectedCut} roseSeason={roseSeason} siteX={siteX} rightInset={rightInset} legendY={legendY} pinnedKeys={pinnedKeys} hoverKey={hoverKey} emphasisKey={emphasisKey} onFeaturePin={onFeaturePin} />;
  return (
    <MapBox
      model={displayView.map ?? displayView.backdrop}
      label={label}
      legend={!card}
      legendY={legendY}
      north={22}
      credit={false}
      bottomInset={card ? 0 : OV.stripH}
      pad={card ? 7 : undefined}
      pinnedKeys={pinnedKeys}
      hoverKey={hoverKey}
      emphasisKey={emphasisKey}
      onFeaturePin={onFeaturePin}
      avoid={(w, h) => {
        const inset = typeof rightInset === "function" ? rightInset(w) : (rightInset ?? 0);
        // 카드: 지도 위에는 북쪽(오른쪽 위)·범례 알약(왼쪽 아래)·축척(오른쪽 아래)만 있다
        const reserved = card
          ? [{ x0: w - 44, y0: 0, x1: w, y1: 44 }, { x0: 0, y0: h - 34, x1: w, y1: h }]
          : cardReserved(w, h, { valueH: 0, right: 0 });
        return [...reserved, ...(inset ? [{ x0: w - inset, y0: 0, x1: w, y1: h }] : [])];
      }}
      siteX={siteX}
      rightInset={rightInset}
      scaleLeft={!card}
    />
  );
}

type TileCardBaseProps = {
  view: TileView;
  analysisId?: string | null;
  layer: string;
  onLayer: (layer: string) => void;
  phase: DemoPhase | null;
  included: boolean;
  face: OutputFace;
  editing: boolean;
  canUp: boolean;
  canDown: boolean;
  size: TileSize;
  dragging: boolean;
  floatStyle?: CSSProperties;
  /** queued/running 타일에 표시할 대기 위치·경과 시간 안내 */
  waitingNote?: string | null;
  cut: CutSpec | null;
  /** 화면 면 (요약면/지도면). 보고서 출력 면(face)과 무관 */
  cardFace: CardFace;
  onWindUploaded?: () => void;
  stackable?: boolean;
  stackSelected?: boolean;
  sheetable?: boolean;
  sheetSelected?: boolean;
  pinnedLabels: PinnedLabel[];
};

export type TileCardAction =
  | { type: "resize"; size: TileSize }
  | { type: "open" }
  | { type: "sources" }
  | { type: "include"; value: boolean }
  | { type: "face"; face: OutputFace }
  | { type: "cut"; cut: CutSpec }
  | { type: "cardFace"; face: CardFace }
  | { type: "remove" }
  | { type: "move"; dir: -1 | 1 }
  | { type: "retry" }
  | { type: "toggleLabel"; key: string }
  | { type: "setAllLabels"; on: boolean }
  | { type: "stackToggle"; selected: boolean }
  | { type: "unstack" }
  | { type: "sheetToggle"; selected: boolean }
  | { type: "unsheet" };

export type TileCardProps = TileCardBaseProps & {
  onHandleDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onAction: (id: string, action: TileCardAction) => void;
};

type TileCardRenderProps = TileCardBaseProps & {
  onHandleDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onResize: (size: TileSize) => void;
  onOpen: () => void;
  onSources: () => void;
  onInclude: (v: boolean) => void;
  onFace: (f: OutputFace) => void;
  onCut: (cut: CutSpec) => void;
  onCardFace: (f: CardFace) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  onRetry: () => void;
  onStackToggle?: (selected: boolean) => void;
  onUnstack?: () => void;
  onSheetToggle?: (selected: boolean) => void;
  onUnsheet?: () => void;
  onToggleLabel: (key: string) => void;
  onSetAllLabels: (on: boolean) => void;
};

const INTERACTIVE = "button,input,label,a,select,[data-handle],[role=menu],[data-map-feature],[data-map-legend]";

const Svg = ({ children, size = 16, fill }: { children: ReactNode; size?: number; fill?: boolean }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? "currentColor" : "none"} stroke={fill ? "none" : "currentColor"} strokeWidth={2.3} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
    {children}
  </svg>
);

/** ⋯ 더 보기: 상세 보기 · 지도에 보기(도판/구성비) · 보고서에 넣을 그림(도판/구성비/둘 다). Esc·바깥 누름·Tab으로 닫히고 닫힐 때 ⋯ 버튼으로 포커스가 돌아온다. */
function MoreMenu({ view, active, back, onBack, face, onFace, onDetail, pinnedCount, onSetAllLabels, compact, detailOnly, triggerClass }: { view: TileView; active: boolean; back: boolean; onBack: (v: boolean) => void; face: OutputFace; onFace: (f: OutputFace) => void; onDetail?: () => void; pinnedCount: number; onSetAllLabels?: (on: boolean) => void; compact?: { included: boolean; onInclude: (v: boolean) => void; onOpen: () => void }; detailOnly?: boolean; triggerClass?: string }) {
  const [open, setOpen] = useState(false);
  const trigRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []).filter((el) => el.offsetParent !== null);
  useEffect(() => {
    if (!open) return;
    items()[0]?.focus();
    const onDown = (e: Event) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !trigRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);
  useEffect(() => {
    if (!active) setOpen(false); // 카드가 뒤집히면 메뉴도 닫는다
  }, [active]);
  if (!compact && !onDetail && !view.hasFace && !onSetAllLabels) return null;
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) trigRef.current?.focus();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === "Tab") {
      close(false);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
      e.preventDefault();
      const list = items();
      const at = list.indexOf(document.activeElement as HTMLElement);
      const next = e.key === "Home" ? 0 : e.key === "End" ? list.length - 1 : (at + (e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length;
      list[next]?.focus();
    }
  };
  const seg = (label: string, on: boolean, pick: () => void, wide?: boolean) => (
    <button key={label} type="button" role="menuitemradio" aria-checked={on} className={`${styles.mfSegBtn} ${wide ? styles.mfSegWide : ""}`} onClick={pick}>
      {label}
    </button>
  );
  return (
    <>
      <button ref={trigRef} type="button" className={`${styles.mfBtn} ${open ? styles.mfBtnOn : ""} ${triggerClass ?? ""}`} data-more-button aria-haspopup="menu" aria-expanded={open} aria-label={`${view.title} 더 보기${pinnedCount > 0 ? ` · 고정 라벨 ${pinnedCount}개` : ""}`} title="더 보기" onClick={() => setOpen((v) => !v)}>
        <Svg fill>
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </Svg>
        {pinnedCount > 0 && <span className={styles.mfPinBadge} aria-hidden>{pinnedCount}</span>}
      </button>
      {open && (
        <div ref={menuRef} role="menu" aria-label={`${view.title} 더 보기`} className={styles.mfMenu} onKeyDown={onKeyDown}>
          {compact && (
            <>
              <button type="button" role="menuitemcheckbox" aria-checked={compact.included} className={`${styles.mfMenuItem} ${styles.mfMenuCompact}`} onClick={() => compact.onInclude(!compact.included)}>
                보고서에 포함<span>{compact.included ? "포함" : "제외"}</span>
              </button>
              <button type="button" role="menuitem" className={`${styles.mfMenuItem} ${styles.mfMenuCompact}`} onClick={() => { close(true); compact.onOpen(); }}>
                펼치기
              </button>
            </>
          )}
          {onDetail && (
            <button
              type="button"
              role="menuitem"
              className={styles.mfMenuItem}
              onClick={() => {
                close(true); // 상세 창이 닫힐 때 돌아갈 자리를 ⋯ 버튼으로 둔다
                onDetail();
              }}
            >
              상세 보기<span>표·출처 전체</span>
            </button>
          )}
          {onSetAllLabels && pinnedCount > 0 && (
            <button type="button" role="menuitem" className={styles.mfMenuItem} onClick={() => { onSetAllLabels(false); close(true); }}>
              고정 라벨 모두 끄기 ({pinnedCount})
            </button>
          )}
          {view.hasFace && !detailOnly && (
            <>
              <div className={styles.mfMenuHead} id={`mf-view-${view.tileId}`}>지도에 보기</div>
              <div role="group" aria-labelledby={`mf-view-${view.tileId}`} className={styles.mfSeg}>
                {seg("도판", !back, () => onBack(false))}
                {seg("구성비", back, () => onBack(true))}
              </div>
              <div className={styles.mfMenuHead} id={`mf-out-${view.tileId}`}>보고서에 넣을 그림</div>
              <div role="group" aria-labelledby={`mf-out-${view.tileId}`} className={styles.mfSeg}>
                {FACES.map((f) => seg(f === "both" ? "둘 다" : faceLabel(f), face === f, () => onFace(f), f === "both"))}
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}

/** 지도 면: 헤더 40px(지도 밖) · 지도(남은 높이 전부) · 출처 24px(지도 밖). 지도 위에는 북쪽·축척·한 줄 범례만 둔다. */
function MapFace({ p, active, state, back, onBack, onFlip, onDetail, mapReady }: { p: TileCardRenderProps; active: boolean; state: boolean; back: boolean; onBack: (v: boolean) => void; onFlip: () => void; onDetail?: () => void; mapReady: boolean }) {
  const { view } = p;
  const cut = normalizedCut(view, p.cut);
  const cutOwnsS02 = cutOwnsRaster(view, cut);
  const displayView = cutOwnsS02 ? viewForCut(view, cut!) : view;
  const FaceExtra = faceExtraFor(view.code);
  const h = displayView.headline;
  const shortAux = h?.aux && h.aux.length <= 4 ? h.aux : "";
  const headlineLabel = h ? shortHeadlineLabel(h.label) : "";
  const extra = view.stackLayers ? view.stackLayers.join(" + ") : view.sheetGrid;
  const text = stripText(view.sourceLine);
  const labelEntries = view.map ? mapLabelEntries(view.map) : [];
  const pinnedCount = p.pinnedLabels.filter((label) => label.on && labelEntries.some((entry) => entry.key === label.key)).length;
  const pinnedKeys = p.pinnedLabels.filter((label) => label.on && labelEntries.some((entry) => entry.key === label.key)).map((label) => label.key);
  const onFeaturePin = useCallback((feature: MapFigureElementPick) => p.onToggleLabel(feature.key), [p.onToggleLabel]);
  // 제목과 핵심 숫자가 함께 들어가지 않으면 숫자를 통째로 숨긴다(잘린 숫자는 오독되고, 숫자는 요약 면에 있다).
  const headRef = useRef<HTMLElement>(null);
  const [keyHidden, setKeyHidden] = useState(false);
  useEffect(() => {
    const head = headRef.current;
    if (!head) return;
    const measure = () => {
      const title = head.querySelector<HTMLElement>("h3");
      const key = head.querySelector<HTMLElement>("[data-mf-key]");
      if (!title || !key) return;
      let used = 0;
      for (const c of head.children) if (c !== title && c !== key) used += (c as HTMLElement).offsetWidth;
      const pad = parseFloat(getComputedStyle(head).paddingLeft) + parseFloat(getComputedStyle(head).paddingRight);
      setKeyHidden(title.scrollWidth + key.scrollWidth + 8 + used + pad > head.clientWidth);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(head);
    return () => ro.disconnect();
  }, [view.title, h?.value]);
  return (
    <div className={styles.mf}>
      <header ref={headRef} className={styles.mfHead}>
        <span className={styles.dot} style={{ background: view.color }} />
        <h3 className={styles.mfTitle} title={view.title}>{view.title}</h3>
        {view.filterChip && <span className={styles.filterChip} title={view.filterChip}>{view.filterChip}</span>}
        {h && (
          <span data-mf-key className={`${styles.mfKey} ${keyHidden ? styles.mfKeyHidden : ""}`} aria-hidden={keyHidden || undefined} title={`${headlineLabel}${h.aux ? ` · ${h.aux}` : ""}`}>
            <b>{h.value}</b>
            {shortAux && <small>{shortAux}</small>}
          </span>
        )}
        {extra && <span className={`${styles.kindTag} ${styles.mfKeyLabel}`}>{extra}</span>}
        <label className={`${styles.check} ${styles.mfCheck} ${styles.mfCollapse}`} title="보고서에 포함">
          <input type="checkbox" checked={p.included} onChange={(e) => p.onInclude(e.target.checked)} aria-label={`${view.title} 보고서 포함`} />
          <span className={styles.mfCheckText}>보고서</span>
        </label>
        <button type="button" className={`${styles.mfBtn} ${styles.mfBtnDark} ${styles.mfCollapse}`} onClick={p.onOpen} aria-label={`${view.title} 펼치기`} title="펼치기">
          <Svg size={14}>
            <path d="M7 17L17 7" />
            <path d="M8 7h9v9" />
          </Svg>
        </button>
        {FaceExtra && <FaceExtra view={view} cut={cut} state={state} placement="header" onCut={p.onCut} onOpen={p.onOpen} />}
        <MoreMenu view={view} active={active} back={back} onBack={onBack} face={p.face} onFace={p.onFace} onDetail={onDetail} pinnedCount={pinnedCount} onSetAllLabels={labelEntries.length > 0 ? p.onSetAllLabels : undefined} compact={{ included: p.included, onInclude: p.onInclude, onOpen: p.onOpen }} />
        <button type="button" className={styles.mfBtn} data-card-face-button="summary" onClick={onFlip} aria-pressed aria-label={`${view.title} 요약/지도 보기 전환`} title="요약 보기">
          <Svg size={15}>
            <path d="M3 12a9 9 0 1 0 3-6.7" />
            <path d="M3 4v5h5" />
          </Svg>
        </button>
      </header>
      {h && (
        <div className={styles.mfMetricLine} title={`${h.value} · ${headlineLabel}${h.aux ? ` · ${h.aux}` : ""}`}>
          {keyHidden && <b>{h.value} · </b>}
          <span> {headlineLabel}</span>
          {h.aux && h.aux.length > 4 && <span> · {h.aux}</span>}
          {h.tag && <span className={styles.tag}>{h.tag}</span>}
        </div>
      )}
      {!cutOwnsS02 && <LayerSelect view={view} value={p.layer} onChange={p.onLayer} />}
      {FaceExtra && <FaceExtra view={view} cut={cut} state={state} placement="controls" onCut={p.onCut} onOpen={p.onOpen} />}
      {!state && <CutSelect view={view} value={cut} onChange={p.onCut} compact />}
      <div className={styles.mfMap}>
        <div className={styles.stage} aria-hidden={!mapReady || undefined}>
          {mapReady && <Stage view={view} state={state} chart={view.hasFace && back && !state} frame="card" cut={cut} pinnedKeys={pinnedKeys} onFeaturePin={onFeaturePin} />}
        </div>
      </div>
      <footer className={styles.mfFoot} title={text}>
        <button type="button" className={styles.sourceTrigger} data-source-button onClick={p.onSources} aria-label={`${view.title} 출처·기준일 열기`}>
          <span className={styles.sourceText}>{text}</span>
          <span className={styles.sourceCount} aria-label={`출처 ${view.sourceRefs.length}개`}>출처 {view.sourceRefs.length}</span>
        </button>
      </footer>
    </div>
  );
}

/** 요약면: 지도 없는 흰 카드. 제목 줄 · 큰 숫자 + 한 줄 라벨 · 사실 3줄 · 상태 배지(최대 2개) · 출처 한 줄 · "지도 ↻" */
function SummaryFace({ p, state, waiting, onFlip, onDetail }: { p: TileCardRenderProps; state: boolean; waiting: boolean; onFlip: () => void; onDetail?: () => void }) {
  const { view, phase } = p;
  const cut = normalizedCut(view, p.cut);
  const cutOwnsS02 = cutOwnsRaster(view, cut);
  const displayView = cutOwnsS02 ? viewForCut(view, cut!) : view;
  const FaceExtra = faceExtraFor(view.code);
  const facts = displayView.rows.filter((r) => r.label !== displayView.headline?.label).slice(0, 3);
  const head = waiting ? (phase === "running" ? "계산 중" : "대기") : (view.badges.find((b) => b.tone === "status")?.text ?? "표시할 결과가 없습니다");
  const rest = view.badges.filter((b) => b.tone !== "status");
  const retryText = view.status === "cancelled" ? "다시 계산" : "이 타일 다시 계산";
  return (
    <div className={styles.sf}>
      <div className={styles.sfTop}>
        {p.editing && (
          <span className={styles.handle} data-handle onPointerDown={p.onHandleDown} title="끌어서 옮기기 (키보드는 위로·아래로 버튼)" aria-hidden>
            ⠿
          </span>
        )}
        <span className={styles.dot} style={{ background: view.color }} />
        <h3 className={styles.title}>{view.title}</h3>
        <span className={styles.kindTag}>{view.kindLabel}</span>
        {view.filterChip && <span className={styles.filterChip} title={view.filterChip}>{view.filterChip}</span>}
        {view.stackLayers && <span className={styles.kindTag}>{view.stackLayers.join(" + ")}</span>}
        {view.sheetGrid && <span className={styles.kindTag}>{view.sheetGrid}</span>}
        {p.editing && p.stackable && p.onStackToggle && (
          <label className={styles.check}>
            <input type="checkbox" checked={!!p.stackSelected} onChange={(e) => p.onStackToggle!(e.target.checked)} aria-label={`${view.title} 스택에 넣기`} />
            스택에 넣기
          </label>
        )}
        {p.editing && p.sheetable && p.onSheetToggle && (
          <label className={styles.check}>
            <input type="checkbox" checked={!!p.sheetSelected} onChange={(e) => p.onSheetToggle!(e.target.checked)} aria-label={`${view.title} 조판에 넣기`} />
            조판에 넣기
          </label>
        )}
        {!waiting && (
          <>
            <label className={`${styles.check} ${styles.sfCollapse}`}>
              <input type="checkbox" checked={p.included} onChange={(e) => p.onInclude(e.target.checked)} aria-label={`${view.title} 보고서 포함`} />
              <span className={styles.checkText}>보고서</span>
            </label>
            {!p.editing && (
              <button type="button" className={`${styles.open} ${styles.sfCollapse}`} onClick={p.onOpen} aria-label={`${view.title} 펼치기`} title="펼치기">
                ↗
              </button>
            )}
            {onDetail && (
              <button type="button" className={`${styles.open} ${styles.sfCollapse}`} data-detail-button onClick={onDetail} aria-label={`${view.title} 상세 열기`} title="상세">
                상세
              </button>
            )}
            {!p.editing && (
              <MoreMenu view={view} active back={false} onBack={() => {}} face={p.face} onFace={p.onFace} onDetail={onDetail} pinnedCount={0} detailOnly triggerClass={styles.sfMore} compact={{ included: p.included, onInclude: p.onInclude, onOpen: p.onOpen }} />
            )}
          </>
        )}
      </div>

      {state ? (
        <div className={styles.sfState}>
          {waiting && <span className={styles.spinner} role="status" aria-label={`${view.title} ${head}`} />}
          <b className={styles.statusHead}>{head}</b>
          {waiting && p.waitingNote && <p className={styles.statusNote}>{p.waitingNote}</p>}
          {!waiting && view.notes[0] && <p className={styles.statusNote}>{view.notes[0]}</p>}
          {!waiting && rest.length > 0 && <ValueBadges badges={rest} />}
          {!waiting && view.retryable && (
            <button type="button" className={styles.retry} onClick={p.onRetry}>
              {retryText}
            </button>
          )}
          {FaceExtra && <FaceExtra view={view} cut={cut} state={state} placement="summary" onCut={p.onCut} onOpen={p.onOpen} phase={phase} onWindUploaded={p.onWindUploaded} />}
        </div>
      ) : (
        <div className={styles.sfMain}>
          {!cutOwnsS02 && <LayerSelect view={view} value={p.layer} onChange={p.onLayer} />}
          <Headline view={displayView} />
          {facts.length > 0 && <FitRows rows={facts} />}
        </div>
      )}

      <div className={styles.sfFoot}>
        {p.editing ? (
          <div className={styles.editRow}>
            <button type="button" className={styles.iconBtn} onClick={() => p.onMove(-1)} disabled={!p.canUp} aria-label={`${view.title} 위로 이동`}>
              위로
            </button>
            <button type="button" className={styles.iconBtn} onClick={() => p.onMove(1)} disabled={!p.canDown} aria-label={`${view.title} 아래로 이동`}>
              아래로
            </button>
            <span className={styles.seg} role="group" aria-label={`${view.title} 크기`}>
              {([1, 2, 4] as const).map((n) => (
                <button key={n} type="button" aria-pressed={p.size === n} onClick={() => p.onResize(n)} aria-label={`${view.title} ${n}칸`}>
                  {n}칸
                </button>
              ))}
            </span>
            {view.code === "STACK" && p.onUnstack && (
              <button type="button" className={styles.iconBtn} onClick={p.onUnstack} aria-label={`${view.title} 풀기`}>
                풀기
              </button>
            )}
            {view.code === "SHEET" && p.onUnsheet && (
              <button type="button" className={styles.iconBtn} onClick={p.onUnsheet} aria-label={`${view.title} 풀기`}>
                풀기
              </button>
            )}
            <button type="button" className={styles.iconBtn} onClick={p.onRemove} aria-label={`${view.title} 제거`}>
              ×
            </button>
          </div>
        ) : (
          <>
            {!state && <ValueBadges badges={view.badges} />}
            <div className={styles.sfLine}>
              <button type="button" className={styles.sourceTrigger} data-source-button onClick={p.onSources} aria-label={`${view.title} 출처·기준일 열기`}>
                <span className={styles.sfSrc} title={stripText(view.sourceLine, false)}>{stripText(view.sourceLine, false)}</span>
                <span className={styles.sourceCount} aria-label={`출처 ${view.sourceRefs.length}개`}>출처 {view.sourceRefs.length}</span>
              </button>
              {!state && (
                <button type="button" className={styles.flipBtn} data-card-face-button="map" onClick={onFlip} aria-pressed={false} aria-label={`${view.title} 요약/지도 보기 전환`}>
                  지도 ↻
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function TileCard(p: TileCardProps) {
  const { view, phase } = p;
  const id = view.tileId;
  const [back, setBack] = useState(false);
  const cardRef = useRef<HTMLElement>(null);
  const focusFace = useRef<CardFace | null>(null);
  const waiting = phase === "pending" || phase === "running";
  const noResult = !waiting && view.headline === null;
  const state = waiting || noResult;
  // 편집 중·결과 없음·계산 중에는 요약면만 (지도면에 보여 줄 것이 없다)
  const shown: CardFace = state || p.editing ? "summary" : p.cardFace;
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (shown === "map") setSeen(true);
  }, [shown]);
  const [nearViewport, setNearViewport] = useState(false);
  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    if (typeof IntersectionObserver === "undefined") {
      setNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setNearViewport(true);
    }, { rootMargin: "600px" });
    observer.observe(card);
    return () => observer.disconnect();
  }, []);
  const mapReady = nearViewport;
  useEffect(() => {
    if (focusFace.current !== shown) return;
    const buttonFace = shown === "map" ? "summary" : "map";
    cardRef.current?.querySelector<HTMLButtonElement>(`[data-on="true"] [data-card-face-button="${buttonFace}"]`)?.focus();
    focusFace.current = null;
  }, [shown]);
  const onCardFace = useCallback((face: CardFace) => {
    focusFace.current = face;
    p.onAction(id, { type: "cardFace", face });
  }, [id, p.onAction]);
  const onResize = useCallback((size: TileSize) => p.onAction(id, { type: "resize", size }), [id, p.onAction]);
  const onOpen = useCallback(() => p.onAction(id, { type: "open" }), [id, p.onAction]);
  const onSources = useCallback(() => p.onAction(id, { type: "sources" }), [id, p.onAction]);
  const onInclude = useCallback((value: boolean) => p.onAction(id, { type: "include", value }), [id, p.onAction]);
  const onFace = useCallback((face: OutputFace) => p.onAction(id, { type: "face", face }), [id, p.onAction]);
  const onCut = useCallback((cut: CutSpec) => p.onAction(id, { type: "cut", cut }), [id, p.onAction]);
  const onRemove = useCallback(() => p.onAction(id, { type: "remove" }), [id, p.onAction]);
  const onMove = useCallback((dir: -1 | 1) => p.onAction(id, { type: "move", dir }), [id, p.onAction]);
  const onRetry = useCallback(() => p.onAction(id, { type: "retry" }), [id, p.onAction]);
  const onToggleLabel = useCallback((key: string) => p.onAction(id, { type: "toggleLabel", key }), [id, p.onAction]);
  const onSetAllLabels = useCallback((on: boolean) => p.onAction(id, { type: "setAllLabels", on }), [id, p.onAction]);
  const onStackToggle = useCallback((selected: boolean) => p.onAction(id, { type: "stackToggle", selected }), [id, p.onAction]);
  const onUnstack = useCallback(() => p.onAction(id, { type: "unstack" }), [id, p.onAction]);
  const onSheetToggle = useCallback((selected: boolean) => p.onAction(id, { type: "sheetToggle", selected }), [id, p.onAction]);
  const onUnsheet = useCallback(() => p.onAction(id, { type: "unsheet" }), [id, p.onAction]);
  const renderProps: TileCardRenderProps = {
    ...p,
    onResize,
    onOpen,
    onSources,
    onInclude,
    onFace,
    onCut,
    onCardFace,
    onRemove,
    onMove,
    onRetry,
    onStackToggle,
    onUnstack,
    onSheetToggle,
    onUnsheet,
    onToggleLabel,
    onSetAllLabels,
  };
  const cls = [styles.tile, p.size === 2 && styles.span2, p.size === 4 && styles.span4, p.editing && styles.tileEdit, p.dragging && styles.tileDrag, state && styles.tileState, !waiting && view.status === "failed" && styles.tileFail]
    .filter(Boolean)
    .join(" ");
  const openable = !p.editing && !waiting;
  // 결과가 빈 상태여도 T34 상세 API는 분석 ID로 요약/결측을 보여 줄 수 있다.
  // 지도 모델이 없는 타일(D19/D20/D22/D28/D29)도 현재 분석 URL을 사용해 상세를 연다.
  const hasAnalysisContext = !!p.analysisId || !!view.map?.analysisId;
  const detailable = openable && hasDetail(view.code) && hasAnalysisContext;
  const [detailOpen, setDetailOpen] = useState(false);
  const onClick = (e: MouseEvent<HTMLElement>) => {
    if (openable && !(e.target as HTMLElement).closest(INTERACTIVE)) onOpen();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (openable && e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      onOpen();
    }
  };

  return (
    <article
      ref={cardRef}
      className={cls}
      aria-label={view.title}
      data-tile={view.code}
      data-tile-id={view.tileId}
      style={p.floatStyle}
      tabIndex={openable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      <div className={styles.flipInner} data-face={shown}>
        <div className={`${styles.face} ${styles.faceSummary}`} data-on={shown === "summary"} inert={shown !== "summary"} aria-hidden={shown !== "summary"}>
          <SummaryFace p={renderProps} state={state} waiting={waiting} onFlip={() => onCardFace("map")} onDetail={detailable ? () => setDetailOpen(true) : undefined} />
        </div>
      <div className={`${styles.face} ${styles.faceMap}`} data-on={shown === "map"} inert={shown !== "map"} aria-hidden={shown !== "map"}>
          {(shown === "map" || seen) && (
            <MapFace p={renderProps} active={shown === "map"} state={state} back={back} onBack={setBack} onFlip={() => onCardFace("summary")} onDetail={detailable ? () => setDetailOpen(true) : undefined} mapReady={mapReady} />
          )}
        </div>
      </div>
      {detailOpen && detailable && <DetailWindow view={view} layer={p.layer} onLayer={p.onLayer} onClose={() => setDetailOpen(false)} />}
    </article>
  );
}

export default memo(TileCard);
