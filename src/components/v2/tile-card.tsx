"use client";

import { useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import type { DemoPhase, TileSize } from "@/lib/v2/ui/board-state";
import { faceLabel, type Badge, type OutputFace, type TileView } from "@/lib/v2/ui/tile-view";
import MapBox from "./map-box";
import styles from "./board.module.css";

const BADGE_CLASS = { status: styles.badgeStatus, limit: styles.badgeLimit, model: styles.badgeModel } as const;
const FACES: OutputFace[] = ["front", "back", "both"];
const STRIP_COLORS = ["#7a4a2b", "#a0522d", "#c97b4a", "#e0a37a", "#efc9a8", "#f7e3d0", "#cfd2d8"];

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

export function Strip({ view }: { view: TileView }) {
  const chart = view.chart ?? [];
  return (
    <>
      <div className={styles.strip} role="img" aria-label={`${view.title} 도판: ${chart.map((c) => `${c.label} ${c.value}%`).join(", ")}`}>
        {chart.map((c, i) => (
          <i key={c.label} style={{ flexGrow: Math.max(c.value, 1), background: STRIP_COLORS[i % STRIP_COLORS.length] }} title={`${c.label} ${c.value}%`} />
        ))}
      </div>
      <div className={styles.legend}>
        {chart.map((c, i) => (
          <span key={c.label}>
            <b style={{ background: STRIP_COLORS[i % STRIP_COLORS.length] }} />
            {c.label}
          </span>
        ))}
      </div>
    </>
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

export default function TileCard(p: TileCardProps) {
  const { view, phase } = p;
  const [back, setBack] = useState(false);
  const waiting = phase === "pending" || phase === "running";
  const noResult = !waiting && view.headline === null;
  const cls = [styles.tile, p.size === 2 && styles.span2, p.editing && styles.tileEdit, p.dragging && styles.tileDrag, noResult && view.status !== "failed" && styles.tileEmpty, !waiting && view.status === "failed" && styles.tileFail]
    .filter(Boolean)
    .join(" ");
  const rows = view.headline ? view.rows.filter((r) => r.label !== view.headline!.label).slice(0, 2) : [];

  return (
    <article className={cls} aria-label={view.title} data-tile={view.code} data-tile-id={view.tileId} style={p.floatStyle}>
      <div className={styles.tileHead}>
        {p.editing && (
          <span className={styles.handle} data-handle onPointerDown={p.onHandleDown} title="끌어서 옮기기 (키보드는 위로·아래로 버튼)" aria-hidden>
            ⠿
          </span>
        )}
        <span className={styles.dot} style={{ background: view.color }} />
        <h3 className={styles.title}>{view.title}</h3>
        {phase === "running" && <span className={styles.spinner} role="status" aria-label={`${view.title} 계산 중`} />}
        {!waiting && (
          <label className={styles.check}>
            <input type="checkbox" checked={p.included} onChange={(e) => p.onInclude(e.target.checked)} aria-label={`${view.title} 보고서 포함`} />
            보고서
          </label>
        )}
      </div>

      {p.editing && (
        <div className={styles.editRow}>
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
      )}

      {waiting ? (
        <div className={styles.tileBody}>
          <div className={styles.skel} aria-hidden>
            <span className={styles.skelDisc} />
            <span className={styles.skelBars}>
              <i />
              <i />
            </span>
          </div>
          <span className={styles.pendingLabel}>{phase === "running" ? "계산 중" : "대기"}</span>
        </div>
      ) : (
        <>
          <div className={styles.tileBody}>
            {view.hasFace ? (
              <>
                <div className={styles.seg} role="group" aria-label={`${view.title} 보기`}>
                  보기
                  <button type="button" aria-pressed={!back} onClick={() => setBack(false)}>
                    도판
                  </button>
                  <button type="button" aria-pressed={back} onClick={() => setBack(true)}>
                    구성비
                  </button>
                </div>
                {back ? <RowList rows={view.rows} /> : <Strip view={view} />}
                <FaceSelect view={view} value={p.face} onChange={p.onFace} />
              </>
            ) : (
              <>
                {view.map && (
                  <div className={styles.mapBox}>
                    <MapBox model={view.map} label={`${view.title} 지도`} />
                  </div>
                )}
                <div className={styles.headline}>
                  {view.headline && !view.map && (
                    <span className={styles.disc} style={{ background: `${view.color}22`, color: view.color }} aria-hidden>
                      {view.code}
                    </span>
                  )}
                  <Headline view={view} />
                </div>
                <RowList rows={rows} />
              </>
            )}
            <BadgeList badges={view.badges} extra={view.hasFace ? `보고서: ${faceLabel(p.face)}` : undefined} />
            {view.grade && (
              <div className={styles.grade}>
                <b>{view.grade.label}</b>
                {view.grade.criteria}
              </div>
            )}
            {view.sentence && <p className={styles.sentence}>{view.sentence}</p>}
            {view.caveats.map((c) => (
              <p key={c} className={styles.caveat}>
                {c}
              </p>
            ))}
            {view.retryable && (
              <button type="button" className={styles.retry} onClick={p.onRetry}>
                이 타일 다시 계산
              </button>
            )}
          </div>
          <div className={styles.tileFoot}>
            <span className={styles.source}>{view.sourceLine}</span>
            <button type="button" className={styles.open} onClick={p.onOpen} aria-label={`${view.title} 펼치기`}>
              펼치기 ↗
            </button>
          </div>
        </>
      )}
    </article>
  );
}
