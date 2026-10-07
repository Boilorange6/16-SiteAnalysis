"use client";

import { useEffect, useMemo, useState } from "react";
import type { SourceDetailRow, SourceMeta } from "@/lib/v2/ui/source-details";
import { sourceIdsForRefs, sourceMetaMap, type SourceApiBody } from "@/lib/v2/ui/source-api";
import type { TileView } from "@/lib/v2/ui/tile-view";
import { sourcePanelDetails, sourceCitationText, sourceCitationsText } from "@/lib/v2/ui/source-panel";
import styles from "./board.module.css";

type Props = { view: TileView };

export { sourcePanelDetails, sourceCitationText, sourceCitationsText } from "@/lib/v2/ui/source-panel";
export type { SourcePanelDetails } from "@/lib/v2/ui/source-panel";

function sourceKey(row: SourceDetailRow): string {
  return `${row.sourceId}:${row.asOf}:${row.url}`;
}

async function readSourceMeta(ids: readonly string[]): Promise<ReadonlyMap<string, SourceMeta>> {
  if (ids.length === 0) return new Map();
  const query = new URLSearchParams();
  for (const id of ids) query.append("ids", id);
  let response = await fetch(`/site/api/v2/sources?${query.toString()}`, { credentials: "include", cache: "no-store" });
  if (response.status === 401) {
    const refreshed = await fetch("/site/api/auth/refresh", { method: "POST", credentials: "include" }).then((res) => res.ok, () => false);
    if (refreshed) response = await fetch(`/site/api/v2/sources?${query.toString()}`, { credentials: "include", cache: "no-store" });
  }
  if (!response.ok) throw new Error(`sources ${response.status}`);
  const body = (await response.json()) as Partial<SourceApiBody>;
  return sourceMetaMap(Array.isArray(body.sources) ? body.sources : []);
}

function CopyButton({ label, text, onCopy, status }: { label: string; text: string; onCopy: (text: string, key: string) => void; status?: string }) {
  const key = label;
  return (
    <span className={styles.sourceCopyWrap}>
      <button type="button" className={styles.sourceCopy} onClick={() => onCopy(text, key)} aria-label={`${label} 인용문 복사`}>
        {label}
      </button>
      {status && <span className={styles.sourceCopyStatus} aria-live="polite">{status}</span>}
    </span>
  );
}

export default function SourcePanel({ view }: Props) {
  const ids = useMemo(() => sourceIdsForRefs(view.sourceRefs), [view.sourceRefs]);
  const requestKey = ids.join(",");
  const [meta, setMeta] = useState<ReadonlyMap<string, SourceMeta>>(() => new Map());
  const [loading, setLoading] = useState(ids.length > 0);
  const [loadError, setLoadError] = useState(false);
  const [copyStatus, setCopyStatus] = useState<{ key: string; text: string } | null>(null);
  const [fallbackQuote, setFallbackQuote] = useState<{ key: string; text: string } | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(ids.length > 0);
    setLoadError(false);
    setMeta(new Map());
    if (ids.length === 0) return () => { active = false; };
    readSourceMeta(ids).then((next) => {
      if (!active) return;
      setMeta(next);
      setLoading(false);
    }).catch(() => {
      if (!active) return;
      setLoadError(true);
      setLoading(false);
    });
    return () => { active = false; };
  }, [requestKey, ids]);

  const details = sourcePanelDetails(view, meta);
  const allCitation = sourceCitationsText(details.rows);

  const copy = async (text: string, key: string) => {
    setFallbackQuote(null);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(text);
      setCopyStatus({ key, text: "복사됨" });
    } catch {
      setCopyStatus({ key, text: "복사 실패" });
      setFallbackQuote({ key, text });
    }
  };

  return (
    <section className={styles.sourcePanel} aria-labelledby={`source-panel-${view.tileId}`}>
      <div className={styles.sourcePanelHead}>
        <div>
          <h3 id={`source-panel-${view.tileId}`}>{details.calcMethod ? "입력 원천" : "출처·기준일"}</h3>
          <p>{details.rows.length}개 원천</p>
        </div>
        <CopyButton label="모두 복사" text={allCitation} onCopy={copy} status={copyStatus?.key === "모두 복사" ? copyStatus.text : undefined} />
      </div>

      {details.calcMethod && (
        <div className={styles.sourceCalc}>
          <b>계산 방법</b>
          <span>{details.calcMethod}</span>
        </div>
      )}
      {loading && <p className={styles.sourceState} role="status">원천 정보를 불러오는 중입니다.</p>}
      {loadError && <p className={styles.sourceState} role="status">원천 정보를 불러오지 못했습니다</p>}
      {details.rows.length === 0 ? (
        <p className={styles.sourceState}>등록된 원천이 없습니다.</p>
      ) : (
        <div className={styles.sourceTableWrap}>
          <table className={styles.sourceTable}>
            <caption className={styles.visuallyHidden}>{view.title}의 출처와 기준일</caption>
            <thead>
              <tr>
                <th scope="col">자료</th>
                <th scope="col">제공처</th>
                <th scope="col">기준일</th>
                <th scope="col">이용조건</th>
                <th scope="col">쓰인 곳</th>
                <th scope="col">원문</th>
              </tr>
            </thead>
            <tbody>
              {details.rows.map((row) => {
                const key = sourceKey(row);
                const citation = sourceCitationText(row);
                return (
                  <tr key={key}>
                    <td data-label="자료">
                      <span className={styles.sourceMaterial}>{row.name}</span>
                      <span className={styles.sourceRole}>{row.role}</span>
                    </td>
                    <td data-label="제공처">{row.provider}</td>
                    <td data-label="기준일">{row.asOf}</td>
                    <td data-label="이용조건">{row.license}</td>
                    <td data-label="쓰인 곳">{row.usedFor ?? "사용처 미기록"}</td>
                    <td data-label="원문" className={styles.sourceOriginal}>
                      {row.url ? <a href={row.url} target="_blank" rel="noreferrer">원문 확인</a> : <span>원문 링크 미기록</span>}
                      <CopyButton label="인용문 복사" text={citation} onCopy={copy} status={copyStatus?.key === key ? copyStatus.text : undefined} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {fallbackQuote && (
        <div className={styles.sourceFallback}>
          <p>복사에 실패했습니다. 아래 인용문을 직접 선택해 복사하세요.</p>
          <textarea value={fallbackQuote.text} readOnly rows={3} onFocus={(event) => event.currentTarget.select()} aria-label="복사 실패 인용문" />
        </div>
      )}
    </section>
  );
}
