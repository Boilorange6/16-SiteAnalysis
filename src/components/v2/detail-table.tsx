"use client";

import { useMemo, useState, type KeyboardEvent } from "react";
import { formatDetailValue, rowTitle, sanitizeDetailText, tableColumns, type DetailPayload, type DetailRow } from "@/lib/v2/ui/detail-state";

export type DetailTableProps = {
  payload: DetailPayload;
  rows: DetailRow[];
  selectedFids: readonly string[];
  onSelectRow: (row: DetailRow) => void;
  sortKey: string | null;
  sortDirection: "asc" | "desc";
  onSort: (key: string) => void;
};

function rowFids(row: DetailRow): string[] {
  return row.fids?.length ? row.fids : [row.fid];
}

function isSelected(row: DetailRow, selectedFids: readonly string[]): boolean {
  return rowFids(row).some((fid) => selectedFids.includes(fid));
}

function rowAddress(row: DetailRow, columns: ReturnType<typeof tableColumns>): string | null {
  const column = columns.find((candidate) => candidate.key === "address");
  if (!column) return null;
  const address = formatDetailValue(row.cells.address ?? null, column, row);
  return address === "—" ? null : sanitizeDetailText(address);
}

function selectWithKeyboard(event: KeyboardEvent<HTMLElement>, row: DetailRow, onSelectRow: (row: DetailRow) => void): void {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  onSelectRow(row);
}

const VIRTUAL_THRESHOLD = 80;
const DETAIL_ROW_HEIGHT = 32;
const DETAIL_OVERSCAN = 8;

function renderRow(row: DetailRow, columns: ReturnType<typeof tableColumns>, selectedFids: readonly string[], onSelectRow: (row: DetailRow) => void) {
  const selected = isSelected(row, selectedFids);
  return (
    <tr
      key={row.fid}
      data-detail-row={row.fid}
      tabIndex={0}
      aria-selected={selected}
      className={selected ? "detail-row detail-row-selected" : "detail-row"}
      onClick={() => onSelectRow(row)}
      onKeyDown={(event) => selectWithKeyboard(event, row, onSelectRow)}
    >
      {columns.map((column) => (
        <td key={column.key} className={column.kind === "number" ? "detail-cell-number" : undefined} title={formatDetailValue(row.cells[column.key] ?? null, column, row)}>
          {formatDetailValue(row.cells[column.key] ?? null, column, row)}
        </td>
      ))}
    </tr>
  );
}

export default function DetailTable({ payload, rows, selectedFids, onSelectRow, sortKey, sortDirection, onSort }: DetailTableProps) {
  const columns = useMemo(() => tableColumns(payload), [payload]);
  const mobileValueColumns = useMemo(
    () => columns.filter((column) => column.key !== "name" && column.key !== "address").slice(0, 2),
    [columns],
  );
  const count = payload.total ?? rows.length;
  const rowCountText = count.toLocaleString("ko-KR");
  const [scrollTop, setScrollTop] = useState(0);
  const virtualized = rows.length > VIRTUAL_THRESHOLD;
  const virtualStart = virtualized ? Math.max(0, Math.floor(scrollTop / DETAIL_ROW_HEIGHT) - DETAIL_OVERSCAN) : 0;
  const virtualCount = virtualized ? 32 : rows.length;
  const virtualEnd = virtualized ? Math.min(rows.length, virtualStart + virtualCount) : rows.length;
  const renderedRows = virtualized ? rows.slice(virtualStart, virtualEnd) : rows;
  const topSpacer = virtualized ? virtualStart * DETAIL_ROW_HEIGHT : 0;
  const bottomSpacer = virtualized ? Math.max(0, (rows.length - virtualEnd) * DETAIL_ROW_HEIGHT) : 0;

  return (
    <div className="detail-table-root">
      <div className="detail-table-desktop" role="region" aria-label={`${payload.title} 상세 표`} tabIndex={0} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
        <table className="detail-table" aria-rowcount={rows.length + 1}>
          <caption className="detail-sr-only">{rowCountText}개 상세 목록. 행을 Enter로 선택할 수 있습니다.</caption>
          <thead>
            <tr>
              {columns.map((column) => {
                const active = sortKey === column.key;
                return (
                  <th key={column.key} scope="col" aria-sort={active ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}>
                    <button type="button" className="detail-sort" onClick={() => onSort(column.key)} aria-label={`${column.label} 기준 ${active && sortDirection === "asc" ? "내림차순" : "오름차순"} 정렬`}>
                      <span>{column.label}</span>
                      <span className="detail-sort-icon" aria-hidden="true">{active ? (sortDirection === "asc" ? "↑" : "↓") : "↕"}</span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {topSpacer > 0 && <tr className="detail-virtual-spacer" aria-hidden="true"><td colSpan={columns.length} style={{ height: topSpacer }} /></tr>}
            {renderedRows.map((row) => renderRow(row, columns, selectedFids, onSelectRow))}
            {bottomSpacer > 0 && <tr className="detail-virtual-spacer" aria-hidden="true"><td colSpan={columns.length} style={{ height: bottomSpacer }} /></tr>}
          </tbody>
        </table>
      </div>

      <div className="detail-table-mobile" role="list" aria-label={`${payload.title} 상세 카드 목록`}>
        {rows.map((row) => {
          const selected = isSelected(row, selectedFids);
          const title = rowTitle(row, columns);
          const address = rowAddress(row, columns);
          return (
            <button
              key={row.fid}
              type="button"
              role="listitem"
              data-detail-row={row.fid}
              aria-current={selected ? "true" : undefined}
              className={selected ? "detail-mobile-card detail-mobile-card-selected" : "detail-mobile-card"}
              onClick={() => onSelectRow(row)}
            >
              <span className="detail-mobile-card-copy">
                <strong>{title}</strong>
                {address && <small>{address}</small>}
                <span className="detail-mobile-card-values">
                  {mobileValueColumns.map((column) => (
                    <span key={column.key}><em>{column.label}</em> {formatDetailValue(row.cells[column.key] ?? null, column, row)}</span>
                  ))}
                </span>
              </span>
              <span className="detail-mobile-chevron" aria-hidden="true">›</span>
            </button>
          );
        })}
      </div>

      {rows.length === 0 && <p className="detail-table-empty">조건에 맞는 상세 행이 없습니다.</p>}
    </div>
  );
}
