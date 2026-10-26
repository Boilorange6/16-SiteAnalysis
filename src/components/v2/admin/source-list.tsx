"use client";

import type { SourceRow } from "@/lib/v2/admin/admin-view";
import { sourceLinkForTile } from "@/lib/v2/admin/admin-view";
import type { AdminTile } from "@/lib/v2/admin/overview";
import styles from "@/app/v2/admin/admin.module.css";

type SourceListProps = {
  rows: SourceRow[];
  tiles: AdminTile[];
  selectedKey: string | null;
  selectedTile: AdminTile | null;
  onSelect: (row: SourceRow) => void;
};

function dateLabel(value: string | null): string {
  return value ? value.slice(0, 10) : "기준일 미기록";
}

function warningLabel(warn: SourceRow["warn"]): string | null {
  if (warn === "stale") return "오래됨";
  if (warn === "missing") return "미기록";
  return null;
}

function linkLabel(link: ReturnType<typeof sourceLinkForTile>): string | null {
  if (link === "used") return "사용";
  if (link === "missingFromCatalog") return "선언 누락";
  if (link === "unusedInCatalog") return "쓰지 않는데 선언";
  return null;
}

export default function SourceList({ rows, tiles, selectedKey, selectedTile, onSelect }: SourceListProps) {
  return (
    <section className={styles.sourcePanel} aria-labelledby="admin-sources-title" data-admin-source-list>
      <div className={styles.panelHeading}>
        <div>
          <p className={styles.eyebrow}>PROVENANCE</p>
          <h2 id="admin-sources-title">원천 목록</h2>
        </div>
        <span className={styles.panelCount}>{rows.length}줄</span>
      </div>
      <p className={styles.panelHint}>
        {selectedTile ? `${selectedTile.code} 타일과 연결된 원천을 표시합니다.` : "원천을 누르면 연결된 타일만 선명하게 보입니다."}
      </p>
      <div className={styles.sourceRows}>
        {rows.map((row) => {
          const warning = warningLabel(row.warn);
          const link = selectedTile ? linkLabel(sourceLinkForTile(row, selectedTile)) : null;
          const active = row.key === selectedKey;
          return (
            <button
              key={row.key}
              type="button"
              className={`${styles.sourceRow} ${active ? styles.sourceRowSelected : ""}`}
              aria-pressed={active}
              data-admin-source={row.key}
              onClick={() => onSelect(row)}
            >
              <span className={styles.sourceRowCopy}>
                <strong>{row.label}</strong>
                <span>{dateLabel(row.asOf)} · {row.license}</span>
              </span>
              <span className={styles.sourceRowMeta}>
                {link && <span className={`${styles.linkTag} ${link === "선언 누락" || link === "쓰지 않는데 선언" ? styles.linkTagWarning : ""}`}>{link}</span>}
                {warning && <span className={styles.warningTag}>{warning}</span>}
                <span className={styles.sourceCount}>{row.tileCodes.length}</span>
              </span>
            </button>
          );
        })}
      </div>
      {rows.length === 0 && <p className={styles.emptyHint}>표시할 원천이 없습니다.</p>}
      <p className={styles.sourceFootnote}>숫자는 이 원천을 선언하거나 사용한 타일 수입니다.</p>
    </section>
  );
}
