"use client";

import { useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { DemoPhase, TileSize } from "@/lib/v2/ui/board-state";
import { STRIP_COLORS } from "@/lib/v2/ui/map-layers";
import { OV, badgesToShow, cardReserved, stripText } from "@/lib/v2/ui/overlay-layout";
import { faceLabel, type Badge, type OutputFace, type TileView } from "@/lib/v2/ui/tile-view";
import CalloutMap, { CalloutPill } from "./callout-map";
import MapBox from "./map-box";
import styles from "./board.module.css";

const BADGE_CLASS = { status: styles.badgeStatus, limit: styles.badgeLimit, model: styles.badgeModel } as const;
const FACES: OutputFace[] = ["front", "back", "both"];

export function BadgeList({ badges, extra }: { badges: Badge[]; extra?: string }) {
  if (badges.length === 0 && !extra) return null;
  return (
    <div className={styles.badges}>
      {badges.map((b, i) => (
        <span key={`${b.text}-${i}`} className={`${styles.badge} ${BADGE_CLASS[b.tone]}`} title={b.note}>
          {b.text}
        </span>
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
        <span key={`${b.text}-${i}`} className={`${styles.badge} ${BADGE_CLASS[b.tone]}`} title={b.note}>
          {b.text}
        </span>
      ))}
      {more > 0 && (
        <span className={styles.badge} title={hidden.map((b) => b.text).join(" · ")}>
          +{more}
        </span>
      )}
    </div>
  );
}

export function Headline({ view, small }: { view: TileView; small?: boolean }) {
  const h = view.headline;
  if (!h) return <div className={styles.sub}>표시할 결과가 없습니다</div>;
  const longAux = !!h.aux && h.aux.length > 4; // "직선" 같은 짧은 보조어만 숫자 옆에 둔다
  return (
    <div className={styles.bigWrap}>
      <div>
        <span className={`${styles.display} ${styles.big} ${small || h.value.length > 5 ? styles.bigSmall : ""}`}>{h.value}</span>
        {h.aux && !longAux && <span className={styles.aux}>{h.aux}</span>}
        {h.tag && <span className={styles.tag}>{h.tag}</span>}
      </div>
      <div className={styles.sub}>
        {h.label}
        {longAux && ` · ${h.aux}`}
      </div>
    </div>
  );
}

export function RowList({ rows, className }: { rows: TileView["rows"]; className?: string }) {
  return (
    <ul className={className ?? styles.rows}>
      {rows.map((r) => (
        <li key={r.label}>
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

/** D04 뒤집은 면: 연한 타일색 바탕에 구성비 막대가 가득 (카드·펼침 공통) */
export function FaceChart({ view }: { view: TileView }) {
  const chart = view.chart ?? [];
  const max = Math.max(1, ...chart.map((c) => c.value));
  return (
    <div className={styles.faceChart} style={{ background: `${view.color}10` }} role="img" aria-label={`${view.title} 구성비: ${chart.map((c) => `${c.label} ${c.value}%`).join(", ")}`}>
      {chart.map((c, i) => (
        <div key={c.label} className={styles.fcRow}>
          <span className={styles.fcLabel}>{c.label}</span>
          <span className={styles.fcTrack}>
            <i style={{ width: `${(c.value / max) * 100}%`, background: STRIP_COLORS[i % STRIP_COLORS.length] }} />
          </span>
          <b className={styles.fcVal}>{c.value}%</b>
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
export function StatusPlate({ view, phase, onRetry }: { view: TileView; phase: DemoPhase | null; onRetry?: () => void }) {
  const waiting = phase === "pending" || phase === "running";
  const head = waiting ? (phase === "running" ? "계산 중" : "대기") : (view.badges.find((b) => b.tone === "status")?.text ?? "표시할 결과가 없습니다");
  const rest = view.badges.filter((b) => b.tone !== "status");
  return (
    <div className={styles.statusWrap}>
      <div className={`${styles.plate} ${styles.statusPlate}`}>
        {waiting && <span className={styles.spinner} role="status" aria-label={`${view.title} ${head}`} />}
        <b className={styles.statusHead}>{head}</b>
        {!waiting && view.notes[0] && <p className={styles.statusNote}>{view.notes[0]}</p>}
        {!waiting && rest.length > 0 && <ValueBadges badges={rest} />}
        {!waiting && view.retryable && onRetry && (
          <button type="button" className={styles.retry} onClick={onRetry}>
            이 타일 다시 계산
          </button>
        )}
      </div>
    </div>
  );
}

/** 전면 시각물: 지도(또는 흐린 대지 지도, 또는 D04 구성비 차트) */
export function Stage({ view, state, chart, frame, siteX, rightInset, legendY, page, onPage }: { view: TileView; state: boolean; chart: boolean; frame: "card" | "detail"; siteX?: number | ((w: number) => number); rightInset?: number | ((w: number) => number); legendY?: number; page?: number; onPage?: (p: number) => void }) {
  if (chart) return <FaceChart view={view} />;
  const card = frame === "card";
  const label = `${view.title} 지도`;
  if (state) return <MapBox model={view.backdrop} muted legend={false} north={false} scale={false} credit={false} label={label} siteX={siteX} />;
  if (view.callout) return <CalloutMap model={view.callout} kind={frame} page={page} onPage={onPage} label={label} />;
  return (
    <MapBox
      model={view.map ?? view.backdrop}
      label={label}
      legend={!card}
      legendY={legendY}
      north={card ? OV.edge + 38 + 8 + 13 : 22}
      credit={false}
      bottomInset={OV.stripH}
      avoid={(w, h) => {
        const inset = typeof rightInset === "function" ? rightInset(w) : (rightInset ?? 0);
        return [...cardReserved(w, h, card ? { valueH: view.headline ? 104 : 0 } : { valueH: 0, right: 0 }), ...(inset ? [{ x0: w - inset, y0: 0, x1: w, y1: h }] : [])];
      }}
      siteX={siteX}
      rightInset={rightInset}
      scaleLeft={!card}
    />
  );
}

export type TileCardProps = {
  view: TileView;
  phase: DemoPhase | null;
  included: boolean;
  face: OutputFace;
  editing: boolean;
  canUp: boolean;
  canDown: boolean;
  size: TileSize;
  dragging: boolean;
  floatStyle?: CSSProperties;
  onHandleDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onResize: (size: TileSize) => void;
  onOpen: () => void;
  onInclude: (v: boolean) => void;
  onFace: (f: OutputFace) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  onRetry: () => void;
};

const INTERACTIVE = "button,input,label,a,select,[data-handle]";

export default function TileCard(p: TileCardProps) {
  const { view, phase } = p;
  const [back, setBack] = useState(false);
  const waiting = phase === "pending" || phase === "running";
  const noResult = !waiting && view.headline === null;
  const state = waiting || noResult;
  const cls = [styles.tile, p.size === 2 && styles.span2, p.editing && styles.tileEdit, p.dragging && styles.tileDrag, state && styles.tileState, !waiting && view.status === "failed" && styles.tileFail]
    .filter(Boolean)
    .join(" ");
  const openable = !p.editing && !waiting;
  const onClick = (e: MouseEvent<HTMLElement>) => {
    if (openable && !(e.target as HTMLElement).closest(INTERACTIVE)) p.onOpen();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (openable && e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      p.onOpen();
    }
  };

  return (
    <article
      className={cls}
      aria-label={view.title}
      data-tile={view.code}
      data-tile-id={view.tileId}
      style={p.floatStyle}
      tabIndex={openable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      <div className={styles.stage}>
        <Stage view={view} state={state} chart={view.hasFace && back && !state} frame="card" />
      </div>

      <TitleChip
        view={view}
        lead={
          p.editing && (
            <span className={styles.handle} data-handle onPointerDown={p.onHandleDown} title="끌어서 옮기기 (키보드는 위로·아래로 버튼)" aria-hidden>
              ⠿
            </span>
          )
        }
      />

      {!waiting && (
        <div className={styles.ovTR}>
          <div className={`${styles.plate} ${styles.reportChip}`}>
            <label className={styles.check}>
              <input type="checkbox" checked={p.included} onChange={(e) => p.onInclude(e.target.checked)} aria-label={`${view.title} 보고서 포함`} />
              보고서
            </label>
            {!p.editing && (
              <button type="button" className={styles.open} onClick={p.onOpen} aria-label={`${view.title} 펼치기`} title="펼치기">
                ↗
              </button>
            )}
          </div>
        </div>
      )}

      <div className={styles.ovBL}>
        {p.editing ? (
          <div className={`${styles.plate} ${styles.editRow}`}>
            <button type="button" className={styles.iconBtn} onClick={() => p.onMove(-1)} disabled={!p.canUp} aria-label={`${view.title} 위로 이동`}>
              위로
            </button>
            <button type="button" className={styles.iconBtn} onClick={() => p.onMove(1)} disabled={!p.canDown} aria-label={`${view.title} 아래로 이동`}>
              아래로
            </button>
            <span className={styles.seg} role="group" aria-label={`${view.title} 크기`}>
              {([1, 2] as const).map((n) => (
                <button key={n} type="button" aria-pressed={p.size === n} onClick={() => p.onResize(n)} aria-label={`${view.title} ${n}칸`}>
                  {n}칸
                </button>
              ))}
            </span>
            <button type="button" className={styles.iconBtn} onClick={p.onRemove} aria-label={`${view.title} 제거`}>
              ×
            </button>
          </div>
        ) : (
          <>
            {view.hasFace && !state && (
              <div className={`${styles.plate} ${styles.faceCtl}`}>
                <div className={styles.seg} role="group" aria-label={`${view.title} 보기`}>
                  보기
                  <button type="button" aria-pressed={!back} onClick={() => setBack(false)}>
                    도판
                  </button>
                  <button type="button" aria-pressed={back} onClick={() => setBack(true)}>
                    구성비
                  </button>
                </div>
                <FaceSelect view={view} value={p.face} onChange={p.onFace} />
              </div>
            )}
            {!state && !(view.hasFace && back) && (view.callout ? <CalloutPill model={view.callout} /> : <ValueCard view={view} />)}
          </>
        )}
      </div>

      {state && <StatusPlate view={view} phase={phase} onRetry={p.onRetry} />}
      <SourceStrip view={view} />
    </article>
  );
}
