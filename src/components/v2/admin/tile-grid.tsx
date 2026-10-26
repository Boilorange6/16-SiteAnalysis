"use client";

import { useEffect, useRef, useState } from "react";
import { tileSvgForView } from "@/lib/v2/export/tile-image";
import { toTileView } from "@/lib/v2/ui/tile-view";
import type { TileResult } from "@/lib/v2/tile-result";
import type { AdminTile } from "@/lib/v2/admin/overview";
import styles from "@/app/v2/admin/admin.module.css";

const FORM_LABELS: Record<string, string> = {
  vector: "벡터 지도",
  raster: "래스터",
  chart: "차트",
  "3d": "3D",
  section: "단면",
  aerial: "항공영상",
};

const RESULT_LABELS: Record<string, string> = {
  pending: "계산 대기",
  running: "계산 중",
  no_data: "빈 결과",
  failed: "실패",
  cancelled: "계산 취소",
  not_provided: "제공 안 됨",
};

type TileGridProps = {
  tiles: AdminTile[];
  results: TileResult[];
  selectedCode: string | null;
  sourceTileCodes: Set<string> | null;
  pendingByTile: Record<string, number>;
  onSelect: (tile: AdminTile, trigger: HTMLButtonElement) => void;
};

function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function TileThumbnail({ tile, result }: { tile: AdminTile; result: TileResult | undefined }) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: "240px" });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !result || tile.code === "S01" || tile.actualSources === null) return;
    if (tile.resultStatus && ["pending", "running", "no_data", "failed", "cancelled", "not_provided"].includes(tile.resultStatus)) return;
    let cancelled = false;
    setFailed(false);
    void (async () => {
      try {
        const svg = await tileSvgForView(toTileView(result), { width: 800, height: 600, withFrame: false, layer: "white" });
        if (!cancelled) setSrc(svgDataUrl(svg));
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [result, tile.actualSources, tile.code, tile.resultStatus, visible]);

  const statusLabel = tile.code === "S01"
    ? "3D는 보드에서 확인"
    : tile.actualSources === null
      ? "확인 불가"
      : tile.resultStatus
        ? RESULT_LABELS[tile.resultStatus] ?? tile.resultStatus
        : failed
          ? "그림을 불러오지 못했습니다"
          : src
            ? null
            : "그림 준비 중";

  return (
    <span ref={hostRef} className={styles.tileThumb}>
      {src && !statusLabel ? <img src={src} alt={`${tile.title} 미리보기`} className={styles.tileImage} /> : (
        <span className={`${styles.tilePlaceholder} ${tile.actualSources === null ? styles.tilePlaceholderUnknown : ""}`}>
          <span>{statusLabel}</span>
        </span>
      )}
    </span>
  );
}

function kindLabel(kind: AdminTile["kind"]): string {
  if (kind === "analysis") return "분석";
  if (kind === "diagram") return "도판";
  if (kind === "simulation") return "시뮬레이션";
  return kind;
}

export default function TileGrid({ tiles, results, selectedCode, sourceTileCodes, pendingByTile, onSelect }: TileGridProps) {
  const resultByCode = new Map(results.map((result) => [result.tileCode, result]));
  return (
    <section className={styles.tileSection} aria-labelledby="admin-tiles-title">
      <div className={styles.tileSectionHeading}>
        <div>
          <p className={styles.eyebrow}>TILE MAP</p>
          <h2 id="admin-tiles-title">타일 다이어그램</h2>
        </div>
        <span className={styles.tileSectionHint}>타일을 누르면 상세 서랍이 열립니다.</span>
      </div>
      <div className={styles.tileGrid} data-admin-grid role="list" aria-label="관리 타일 격자">
        {tiles.map((tile) => {
          const dimmed = sourceTileCodes !== null && !sourceTileCodes.has(tile.code);
          const pending = pendingByTile[tile.code] ?? 0;
          const statusText = tile.actualSources === null
            ? "확인 불가"
            : tile.resultStatus
              ? RESULT_LABELS[tile.resultStatus] ?? tile.resultStatus
              : null;
          return (
            <div key={tile.code} role="listitem" className={styles.tileGridItem}>
              <button
                type="button"
                className={`${styles.tileCard} ${selectedCode === tile.code ? styles.tileCardSelected : ""} ${dimmed ? styles.tileCardDimmed : ""}`}
                aria-label={`${tile.code} ${tile.title} 상세 열기`}
                data-admin-tile={tile.code}
                data-admin-status={statusText ?? "준비됨"}
                onClick={(event) => onSelect(tile, event.currentTarget)}
              >
                <TileThumbnail tile={tile} result={resultByCode.get(tile.code)} />
                <span className={styles.tileTitleLine}>
                  <span className={styles.tileCode}>{tile.code}</span>
                  <span className={styles.tileTitle}>{tile.title}</span>
                </span>
                <span className={styles.tileBadges}>
                  <span className={styles.formText}>{tile.forms.map((form) => FORM_LABELS[form] ?? form).join(" · ")}</span>
                  <span className={styles.kindText}>{kindLabel(tile.kind)}</span>
                  {tile.check.status === "mismatch" && <span className={styles.warningTag}>원천 불일치</span>}
                  {tile.check.status === "unknown" && <span className={styles.statusTag}>확인 불가</span>}
                  {statusText && statusText !== "확인 불가" && <span className={styles.statusTag}>{statusText}</span>}
                  {pending > 0 && <span className={styles.requestTag}>요청 {pending}</span>}
                </span>
              </button>
            </div>
          );
        })}
        {tiles.length === 0 && <p className={styles.emptyGrid}>이 조건에 맞는 타일이 없습니다.</p>}
      </div>
    </section>
  );
}
