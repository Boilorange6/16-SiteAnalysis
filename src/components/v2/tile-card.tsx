"use client";

import { createPortal } from "react-dom";
import { memo, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { CardFace, CutSpec, DemoPhase, PinnedLabel, TerrainSectionId, TileSize } from "@/lib/v2/ui/board-state";
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
import { useCardRoving } from "./use-card-roving";
import { useTileResize } from "./use-tile-resize";
import { catalogEntry } from "@/lib/v2/ui/tile-catalog";
import { floatingMenuPosition, type FloatingMenuPosition } from "@/lib/v2/ui/menu-position";

const BADGE_CLASS = { status: styles.badgeStatus, limit: styles.badgeLimit, model: styles.badgeModel } as const;
const FACES: OutputFace[] = ["front", "back", "both"];
const TOPO_NUDGE_COPY = "대지 고저차가 커서 30 m 자료로는 부정확할 수 있습니다. 수치지형도를 넣으면 원본 등고선으로 다시 계산합니다.";

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
    const nudge = face?.querySelector<HTMLElement>(`:scope > .${styles.topoNudge}`);
    if (!ul || !face) return;
    const fit = () => {
      const items = Array.from(ul.children) as HTMLElement[];
      for (const li of items) li.style.display = "";
      const cs = getComputedStyle(face);
      const gap = parseFloat(cs.rowGap) || 0;
      const bottomReserved = (nudge ? nudge.getBoundingClientRect().height + gap : 0) + (foot ? foot.getBoundingClientRect().height + gap : 0);
      const limit = face.getBoundingClientRect().bottom - parseFloat(cs.paddingBottom) - bottomReserved + 0.5;
      for (const li of items) if (li.getBoundingClientRect().bottom > limit) li.style.display = "none";
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(face);
    if (foot) ro.observe(foot);
    if (nudge) ro.observe(nudge);
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

export function Stage({ view, state, chart, frame, siteX, rightInset, legendY, page, onPage, cut, roseSeason = "annual", pinnedKeys = [], hoverKey = null, emphasisKey = null, onFeaturePin, showMapLabels, terrainSection }: StageProps) {
  const selectedCut = normalizedCut(view, cut);
  const displayView = selectedCut ? viewForCut(view, selectedCut) : view;
  if (chart) return <FaceChart view={view} />;
  const card = frame === "card";
  const showLabels = showMapLabels ?? !card;
  const label = `${view.title} 지도`;
  const mapZoom = catalogEntry(view.code).mapZoom;
  const mapInteractive = !state && view.code !== "S01" && view.code !== "D22" && (frame !== "card" || mapZoom?.card !== false);
  const mapWheel = card ? "modifier" as const : "plain" as const;
  const mapTouchPan = card ? "two" as const : "one" as const;
  if (state) return <MapBox model={displayView.backdrop} muted legend={false} north={false} scale={false} credit={false} label={label} siteX={siteX} mapInteractive={false} />;
  const TileStage = stageFor(view.code, displayView);
  if (TileStage) return <TileStage view={view} displayView={displayView} state={state} chart={chart} frame={frame} label={label} page={page} onPage={onPage} cut={selectedCut} roseSeason={roseSeason} siteX={siteX} rightInset={rightInset} legendY={legendY} pinnedKeys={pinnedKeys} hoverKey={hoverKey} emphasisKey={emphasisKey} onFeaturePin={onFeaturePin} mapInteractive={mapInteractive} mapWheel={mapWheel} mapTouchPan={mapTouchPan} mapResetKey={view.tileId} showMapLabels={showLabels} />;
  return (
    <MapBox
      model={displayView.map ?? displayView.backdrop}
      label={label}
      // 모든 지도 면은 지도 밖 공용 범례 띠를 쓴다.
      legend={false}
      showAutomaticLabels={showLabels}
      legendY={legendY}
      north={22}
      credit={false}
      bottomInset={card ? 0 : OV.stripH}
      pad={card ? 7 : undefined}
      pinnedKeys={pinnedKeys}
      hoverKey={hoverKey}
      emphasisKey={emphasisKey}
      onFeaturePin={onFeaturePin}
      terrainSection={terrainSection}
      mapInteractive={mapInteractive}
      mapWheel={mapWheel}
      mapTouchPan={mapTouchPan}
      avoid={(w, h) => {
        const inset = typeof rightInset === "function" ? rightInset(w) : (rightInset ?? 0);
        // 카드: 지도 위에는 북쪽(오른쪽 위)·레이어 칩(왼쪽 위)·축척(오른쪽 아래).
        const reserved = card
          ? [{ x0: w - 44, y0: 0, x1: w, y1: 44 }, { x0: 0, y0: 0, x1: Math.max(0, w - 56), y1: 48 }, { x0: 0, y0: h - 34, x1: w, y1: h }]
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
  canUp: boolean;
  canDown: boolean;
  size: TileSize;
  cellW: number;
  rowH: number;
  dragging: boolean;
  floatStyle?: CSSProperties;
  /** queued/running 타일에 표시할 대기 위치·경과 시간 안내 */
  waitingNote?: string | null;
  /** 특정 카드에 직접 붙이는 추가 자료 안내 */
  topoNudge?: { onClick: () => void; disabled: boolean };
  cut: CutSpec | null;
  /** 화면 면 (요약면/지도면). 보고서 출력 면(face)과 무관 */
  cardFace: CardFace;
  onWindUploaded?: () => void;
  terrainSection?: TerrainSectionId;
  onTerrainSection?: (section: TerrainSectionId) => void;
  stackable?: boolean;
  stackSelected?: boolean;
  sheetable?: boolean;
  sheetSelected?: boolean;
  pinnedLabels: PinnedLabel[];
  /** 카드 지도 자동 라벨 표시 상태. 누락된 옛 저장본은 false로 읽는다. */
  showMapLabels: boolean;
  /** + 칸에서 방금 추가된 타일의 짧은 확인 링. */
  highlighted?: boolean;
  rovingTabIndex: number;
  onRovingFocus: (id: string) => void;
  onRovingMove: (id: string, key: string, event: KeyboardEvent<HTMLElement>) => void;
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
  | { type: "duplicate" }
  | { type: "move"; dir: -1 | 1 }
  | { type: "retry" }
  | { type: "toggleLabel"; key: string }
  | { type: "setAllLabels"; on: boolean }
  | { type: "mapLabels"; show: boolean }
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
  onDuplicate: () => void;
  onMove: (dir: -1 | 1) => void;
  onRetry: () => void;
  onStackToggle?: (selected: boolean) => void;
  onUnstack?: () => void;
  onSheetToggle?: (selected: boolean) => void;
  onUnsheet?: () => void;
  onToggleLabel: (key: string) => void;
  onSetAllLabels: (on: boolean) => void;
  onMapLabels: (show: boolean) => void;
};

type BoardMenuActions = Pick<TileCardRenderProps, "canUp" | "canDown" | "size" | "stackable" | "stackSelected" | "sheetable" | "sheetSelected" | "onResize" | "onMove" | "onRemove" | "onStackToggle" | "onUnstack" | "onSheetToggle" | "onUnsheet">;

// 지도 컨트롤이 시점 초기화로 즉시 사라질 때 클릭 대상이 뷰포트로
// 재조정되어도 카드 펼침으로 전파되지 않게 한다.
const INTERACTIVE = "button,input,label,a,select,[data-handle],[role=menu],[data-map-feature],[data-map-legend],[data-map-viewport]";
const BOARD_GRID_GAP = 16;

const Svg = ({ children, size = 16, fill }: { children: ReactNode; size?: number; fill?: boolean }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? "currentColor" : "none"} stroke={fill ? "none" : "currentColor"} strokeWidth={2.3} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
    {children}
  </svg>
);

function DragHandle({ p }: { p: Pick<TileCardRenderProps, "view" | "canUp" | "canDown" | "onHandleDown" | "onMove"> }) {
  return (
    <button
      type="button"
      className={styles.handle}
      data-handle
      onPointerDown={p.onHandleDown}
      onKeyDown={(event) => {
        if (event.key === "ArrowUp" && p.canUp) {
          event.preventDefault();
          p.onMove(-1);
        } else if (event.key === "ArrowDown" && p.canDown) {
          event.preventDefault();
          p.onMove(1);
        }
      }}
      title="끌어서 옮기기 · 키보드는 위·아래 화살표 또는 더 보기"
      aria-label={`${p.view.title} 순서 조정. 끌어서 옮기거나 위·아래 화살표를 사용하세요`}
    >
      <span aria-hidden>⠿</span>
    </button>
  );
}

/** ⋯ 더 보기: 상세 보기 · 지도에 보기(도판/구성비) · 보고서에 넣을 그림(도판/구성비/둘 다). Esc·바깥 누름·Tab으로 닫히고 닫힐 때 ⋯ 버튼으로 포커스가 돌아온다. */
function MoreMenu({ view, active, back, onBack, face, onFace, onDetail, onDuplicate, pinnedCount, onSetAllLabels, compact, detailOnly, triggerClass, actions }: { view: TileView; active: boolean; back: boolean; onBack: (v: boolean) => void; face: OutputFace; onFace: (f: OutputFace) => void; onDetail?: () => void; onDuplicate?: () => void; pinnedCount: number; onSetAllLabels?: (on: boolean) => void; compact?: { included: boolean; onInclude: (v: boolean) => void; onOpen: () => void; showLabels: boolean; onShowLabels: (show: boolean) => void }; detailOnly?: boolean; triggerClass?: string; actions?: BoardMenuActions }) {
  const [open, setOpen] = useState(false);
  const trigRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState<FloatingMenuPosition | null>(null);
  const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []).filter((el) => {
    const computed = getComputedStyle(el);
    return !el.hidden && computed.display !== "none" && computed.visibility !== "hidden";
  });
  useLayoutEffect(() => {
    if (!open) {
      setMenuPosition(null);
      return;
    }
    const update = () => {
      const trigger = trigRef.current?.getBoundingClientRect();
      const menu = menuRef.current?.getBoundingClientRect();
      if (!trigger || !menu) return;
      setMenuPosition(floatingMenuPosition(
        trigger,
        { width: menu.width, height: menu.height },
        { width: window.innerWidth, height: window.innerHeight },
      ));
    };
    update();
    window.addEventListener("resize", update);
    document.addEventListener("scroll", update, true);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    if (observer) {
      if (trigRef.current) observer.observe(trigRef.current);
      if (menuRef.current) observer.observe(menuRef.current);
    }
    return () => {
      window.removeEventListener("resize", update);
      document.removeEventListener("scroll", update, true);
      observer?.disconnect();
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    items()[0]?.focus();
    const onDown = (e: Event) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !trigRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, menuPosition !== null]);
  useEffect(() => {
    if (!active) setOpen(false); // 카드가 뒤집히면 메뉴도 닫는다
  }, [active]);
  if (!compact && !onDetail && !onDuplicate && !view.hasFace && !onSetAllLabels && !actions) return null;
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
      <button ref={trigRef} type="button" className={`${styles.mfBtn} ${open ? styles.mfBtnOn : ""} ${triggerClass ?? ""}`} data-more-button aria-haspopup="menu" aria-expanded={open} aria-label={`${view.title} 더 보기${pinnedCount > 0 ? ` · 고정 라벨 ${pinnedCount}개` : ""}`} title="더 보기" onClick={() => { setMenuPosition(null); setOpen((v) => !v); }}>
        <Svg fill>
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </Svg>
        {pinnedCount > 0 && <span className={styles.mfPinBadge} aria-hidden>{pinnedCount}</span>}
      </button>
      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={`${view.title} 더 보기`}
          className={styles.mfMenu}
          data-menu-portal="true"
          onKeyDown={onKeyDown}
          style={{ top: menuPosition?.top ?? 0, left: menuPosition?.left ?? 0, visibility: menuPosition ? "visible" : "hidden" }}
        >
          {compact && (
            <>
              <button type="button" role="menuitemcheckbox" aria-checked={compact.showLabels} className={`${styles.mfMenuItem} ${styles.mfMenuLegend}`} onClick={() => compact.onShowLabels(!compact.showLabels)}>
                라벨 보기<span>{compact.showLabels ? "표시" : "숨김"}</span>
              </button>
              <button type="button" role="menuitemcheckbox" aria-checked={compact.included} className={`${styles.mfMenuItem} ${styles.mfMenuCompact}`} onClick={() => compact.onInclude(!compact.included)}>
                보고서에 포함<span>{compact.included ? "포함" : "제외"}</span>
              </button>
              <button type="button" role="menuitem" className={`${styles.mfMenuItem} ${styles.mfMenuCompact}`} onClick={() => { close(true); compact.onOpen(); }}>
                펼치기
              </button>
            </>
          )}
          {onDuplicate && (
            <button type="button" role="menuitem" className={`${styles.mfMenuItem} ${styles.mfMenuCompact}`} onClick={() => { onDuplicate(); close(true); }}>
              복제<span>원본 바로 뒤</span>
            </button>
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
          {actions && (
            <>
              <div className={styles.mfMenuHead}>배치</div>
              <button type="button" role="menuitem" className={styles.mfMenuItem} onClick={() => { actions.onMove(-1); close(true); }} disabled={!actions.canUp}>
                위로
              </button>
              <button type="button" role="menuitem" className={styles.mfMenuItem} onClick={() => { actions.onMove(1); close(true); }} disabled={!actions.canDown}>
                아래로
              </button>
              <div className={styles.mfMenuHead}>크기</div>
              <div role="group" aria-label={`${view.title} 크기`} className={styles.mfSeg}>
                {([1, 2, 4] as const).map((size) => seg(`${size}칸`, actions.size === size, () => actions.onResize(size)))}
              </div>
              {actions.stackable && actions.onStackToggle && (
                <button type="button" role="menuitemcheckbox" aria-checked={!!actions.stackSelected} className={styles.mfMenuItem} onClick={() => actions.onStackToggle!(!actions.stackSelected)}>
                  스택에 넣기<span>{actions.stackSelected ? "선택됨" : "선택"}</span>
                </button>
              )}
              {actions.sheetable && actions.onSheetToggle && (
                <button type="button" role="menuitemcheckbox" aria-checked={!!actions.sheetSelected} className={styles.mfMenuItem} onClick={() => actions.onSheetToggle!(!actions.sheetSelected)}>
                  조판에 넣기<span>{actions.sheetSelected ? "선택됨" : "선택"}</span>
                </button>
              )}
              {view.code === "STACK" && actions.onUnstack && (
                <button type="button" role="menuitem" className={styles.mfMenuItem} onClick={() => { actions.onUnstack!(); close(true); }}>
                  풀기
                </button>
              )}
              {view.code === "SHEET" && actions.onUnsheet && (
                <button type="button" role="menuitem" className={styles.mfMenuItem} onClick={() => { actions.onUnsheet!(); close(true); }}>
                  풀기
                </button>
              )}
              <button type="button" role="menuitem" className={`${styles.mfMenuItem} ${styles.mfMenuDanger}`} onClick={() => { actions.onRemove(); close(true); }}>
                삭제
              </button>
            </>
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
        </div>,
        document.body,
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
        <MoreMenu view={view} active={active} back={back} onBack={onBack} face={p.face} onFace={p.onFace} onDetail={onDetail} onDuplicate={p.onDuplicate} pinnedCount={pinnedCount} onSetAllLabels={labelEntries.length > 0 ? p.onSetAllLabels : undefined} actions={p} compact={{ included: p.included, onInclude: p.onInclude, onOpen: p.onOpen, showLabels: p.showMapLabels, onShowLabels: p.onMapLabels }} />
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
      {FaceExtra && <FaceExtra view={view} cut={cut} state={state} placement="controls" onCut={p.onCut} onOpen={p.onOpen} />}
      {!state && <CutSelect view={view} value={cut} onChange={p.onCut} compact />}
      <div className={styles.mfMap}>
        {!cutOwnsS02 && (
          <div className={styles.mfLayerSelect} data-map-layer-select="true">
            <LayerSelect view={view} value={p.layer} onChange={p.onLayer} />
          </div>
        )}
        <div className={styles.stage} aria-hidden={!mapReady || undefined}>
          {mapReady && <Stage view={view} state={state} chart={view.hasFace && back && !state} frame="card" cut={cut} pinnedKeys={pinnedKeys} onFeaturePin={onFeaturePin} showMapLabels={p.showMapLabels} />}
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

/** 요약면: 지도 없는 흰 카드. 제목 줄 · 큰 숫자 + 한 줄 라벨 · 사실 3줄 · 상태 배지(최대 2개) · 출처 한 줄 */
function SummaryFace({ p, state, waiting, onFlip, onDetail }: { p: TileCardRenderProps; state: boolean; waiting: boolean; onFlip: () => void; onDetail?: () => void }) {
  const { view, phase } = p;
  const topoNudgeCopyId = `topo-nudge-copy-${useId().replace(/:/g, "")}`;
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
        <span className={styles.dot} style={{ background: view.color }} />
        <h3 className={styles.title}>{view.title}</h3>
        <span className={styles.kindTag}>{view.kindLabel}</span>
        {view.filterChip && <span className={styles.filterChip} title={view.filterChip}>{view.filterChip}</span>}
        {view.stackLayers && <span className={styles.kindTag}>{view.stackLayers.join(" + ")}</span>}
        {view.sheetGrid && <span className={styles.kindTag}>{view.sheetGrid}</span>}
        {!waiting && (
          <>
            <label className={`${styles.check} ${styles.sfCollapse}`}>
              <input type="checkbox" checked={p.included} onChange={(e) => p.onInclude(e.target.checked)} aria-label={`${view.title} 보고서 포함`} />
              <span className={styles.checkText}>보고서</span>
            </label>
            <button type="button" className={`${styles.open} ${styles.sfCollapse}`} onClick={p.onOpen} aria-label={`${view.title} 펼치기`} title="펼치기">
              ↗
            </button>
            {onDetail && (
              <button type="button" className={`${styles.open} ${styles.sfCollapse}`} data-detail-button onClick={onDetail} aria-label={`${view.title} 상세 열기`} title="상세">
                상세
              </button>
            )}
            <MoreMenu view={view} active back={false} onBack={() => {}} face={p.face} onFace={p.onFace} onDetail={onDetail} onDuplicate={p.onDuplicate} pinnedCount={0} detailOnly triggerClass={styles.sfMore} actions={p} compact={{ included: p.included, onInclude: p.onInclude, onOpen: p.onOpen, showLabels: p.showMapLabels, onShowLabels: p.onMapLabels }} />
            <button type="button" className={styles.mfBtn} data-card-face-button="map" onClick={onFlip} aria-pressed={false} aria-label={`${view.title} 요약/지도 보기 전환`} title="지도 보기">
              <Svg size={15}>
                <path d="M3 12a9 9 0 1 0 3-6.7" />
                <path d="M3 4v5h5" />
              </Svg>
            </button>
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

      {p.topoNudge && (
        <aside className={styles.topoNudge} role="note" aria-label="수치지형도 안내">
          <p id={topoNudgeCopyId}>{TOPO_NUDGE_COPY}</p>
          <button type="button" onClick={p.topoNudge.onClick} disabled={p.topoNudge.disabled} aria-describedby={topoNudgeCopyId}>수치지형도 넣고 다시 분석</button>
        </aside>
      )}

      <div className={styles.sfFoot}>
        {!state && <ValueBadges badges={view.badges} />}
        <div className={styles.sfLine}>
          <button type="button" className={styles.sourceTrigger} data-source-button onClick={p.onSources} aria-label={`${view.title} 출처·기준일 열기`}>
            <span className={styles.sfSrc} title={stripText(view.sourceLine, false)}>{stripText(view.sourceLine, false)}</span>
            <span className={styles.sourceCount} aria-label={`출처 ${view.sourceRefs.length}개`}>출처 {view.sourceRefs.length}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function TileCard(p: TileCardProps) {
  const { view, phase } = p;
  const id = view.tileId;
  const [back, setBack] = useState(false);
  const cardRef = useRef<HTMLElement>(null);
  const roving = useCardRoving(cardRef);
  const focusFace = useRef<CardFace | null>(null);
  const waiting = phase === "pending" || phase === "running";
  const noResult = !waiting && view.headline === null;
  const state = waiting || noResult;
  // 결과 없음·계산 중에는 요약면만 (지도면에 보여 줄 것이 없다)
  const shown: CardFace = state ? "summary" : p.cardFace;
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
  const resize = useTileResize({ size: p.size, cellW: p.cellW, rowH: p.rowH, onCommit: onResize });
  const onOpen = useCallback(() => p.onAction(id, { type: "open" }), [id, p.onAction]);
  const onSources = useCallback(() => p.onAction(id, { type: "sources" }), [id, p.onAction]);
  const onInclude = useCallback((value: boolean) => p.onAction(id, { type: "include", value }), [id, p.onAction]);
  const onFace = useCallback((face: OutputFace) => p.onAction(id, { type: "face", face }), [id, p.onAction]);
  const onCut = useCallback((cut: CutSpec) => p.onAction(id, { type: "cut", cut }), [id, p.onAction]);
  const onRemove = useCallback(() => p.onAction(id, { type: "remove" }), [id, p.onAction]);
  const onDuplicate = useCallback(() => p.onAction(id, { type: "duplicate" }), [id, p.onAction]);
  const onMove = useCallback((dir: -1 | 1) => p.onAction(id, { type: "move", dir }), [id, p.onAction]);
  const onRetry = useCallback(() => p.onAction(id, { type: "retry" }), [id, p.onAction]);
  const onToggleLabel = useCallback((key: string) => p.onAction(id, { type: "toggleLabel", key }), [id, p.onAction]);
  const onSetAllLabels = useCallback((on: boolean) => p.onAction(id, { type: "setAllLabels", on }), [id, p.onAction]);
  const onMapLabels = useCallback((show: boolean) => p.onAction(id, { type: "mapLabels", show }), [id, p.onAction]);
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
    onDuplicate,
    onMove,
    onRetry,
    onStackToggle,
    onUnstack,
    onSheetToggle,
    onUnsheet,
    onToggleLabel,
    onSetAllLabels,
    onMapLabels,
  };
  const cls = [styles.tile, p.size === 2 && styles.span2, p.size === 4 && styles.span4, p.dragging && styles.tileDrag, p.highlighted && styles.tileAdded, state && styles.tileState, !waiting && view.status === "failed" && styles.tileFail]
    .filter(Boolean)
    .join(" ");
  const openable = !waiting;
  // 결과가 빈 상태여도 T34 상세 API는 분석 ID로 요약/결측을 보여 줄 수 있다.
  // 지도 모델이 없는 타일(D19/D20/D22/D28/D29)도 현재 분석 URL을 사용해 상세를 연다.
  const hasAnalysisContext = !!p.analysisId || !!view.map?.analysisId;
  const detailable = openable && hasDetail(view.code) && hasAnalysisContext;
  const [detailOpen, setDetailOpen] = useState(false);
  const resizePreview = resize.preview;
  const previewColumns = resizePreview?.size === 1 ? 1 : 2;
  const previewRows = resizePreview?.size === 4 ? 2 : 1;
  const currentColumns = p.size === 1 ? 1 : 2;
  const previewWidth = p.cellW > 0 ? p.cellW * previewColumns + BOARD_GRID_GAP * (previewColumns - 1) : 0;
  const previewHeight = p.rowH > 0 ? p.rowH * previewRows + BOARD_GRID_GAP * (previewRows - 1) : 0;
  const currentWidth = p.cellW > 0 ? p.cellW * currentColumns + BOARD_GRID_GAP * (currentColumns - 1) : 0;
  const previewLeft = resizePreview?.side === "left" ? currentWidth - previewWidth : 0;
  const onClick = (e: MouseEvent<HTMLElement>) => {
    if (openable && !(e.target as HTMLElement).closest(INTERACTIVE)) onOpen();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget) return;
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) {
      p.onRovingMove(id, e.key, e);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (!roving.enterControls() && openable) onOpen();
      return;
    }
    if (openable && e.key === " ") {
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
      data-v2-roving-id={id}
      data-v2-roving-card
      style={resizePreview ? { ...p.floatStyle, zIndex: 40 } : p.floatStyle}
      tabIndex={roving.controlsEntered ? -1 : p.rovingTabIndex}
      onFocus={(event) => {
        if (event.target === event.currentTarget) p.onRovingFocus(id);
      }}
      onBlur={roving.onBlur}
      onKeyDownCapture={roving.onKeyDownCapture}
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
      <DragHandle p={renderProps} />
      {resizePreview && previewWidth > 0 && previewHeight > 0 && (
        <div
          className={styles.resizePreview}
          data-resize-preview
          data-resize-target-size={resizePreview.size}
          aria-hidden
          style={{ width: previewWidth, height: previewHeight, left: previewLeft, top: 0 }}
        >
          <span className={styles.resizePreviewBadge} data-resize-preview-badge>{resizePreview.size}칸</span>
        </div>
      )}
      <button
        {...resize.handleProps("left")}
        className={`${styles.resizeHandle} ${styles.resizeHandleLeft}`}
        data-resize-handle="left"
        title="왼쪽 크기 조정"
      />
      <button
        {...resize.handleProps("right")}
        className={`${styles.resizeHandle} ${styles.resizeHandleRight}`}
        data-resize-handle="right"
        title="오른쪽 크기 조정"
      />
      {detailOpen && detailable && <DetailWindow view={view} layer={p.layer} onLayer={p.onLayer} onClose={() => setDetailOpen(false)} terrainSection={p.terrainSection} onTerrainSection={p.onTerrainSection} />}
    </article>
  );
}

export default memo(TileCard);
