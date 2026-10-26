"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { authFetch } from "@/lib/auth-fetch";
import { tilePng, tileSvgForView } from "@/lib/v2/export/tile-image";
import { pinFromClick, requestContext } from "@/lib/v2/admin/admin-view";
import type { AdminOverview, AdminTile } from "@/lib/v2/admin/overview";
import type { TileRequest, TileRequestPin } from "@/lib/v2/admin/requests";
import { toTileView, type TileView } from "@/lib/v2/ui/tile-view";
import type { TileResult } from "@/lib/v2/tile-result";
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
  complete: "계산 완료",
  partial: "일부 계산",
  pending: "계산 대기",
  running: "계산 중",
  no_data: "빈 결과",
  failed: "실패",
  cancelled: "계산 취소",
  not_provided: "제공 안 됨",
};

type TileDrawerProps = {
  tile: AdminTile;
  result: TileResult | undefined;
  overview: AdminOverview;
  requests: TileRequest[];
  compareOpen: boolean;
  onImageReady: (src: string | null) => void;
  onClose: () => void;
  onRequestCreated: (request: TileRequest) => void;
  onRequestUpdated: (request: TileRequest) => void;
  onOpenCompare: (request: TileRequest, trigger: HTMLButtonElement) => void;
};

function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function dateTimeLabel(value: string | null): string {
  if (!value) return "날짜 미확인";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 16).replace("T", " ");
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(parsed);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

function sourceNames(ids: string[] | null, overview: AdminOverview): string {
  if (ids === null) return "확인 불가";
  if (ids.length === 0) return "없음";
  return ids.map((id) => overview.sources.find((source) => source.sourceId === id)?.name ?? "원천 미등록").join(" · ");
}

function checkLabel(tile: AdminTile): string {
  if (tile.check.status === "ok") return "정상";
  if (tile.check.status === "unknown") return "확인 불가";
  const details = [
    tile.check.missingFromCatalog.length > 0 ? `선언 누락 ${tile.check.missingFromCatalog.length}개` : "",
    tile.check.unusedInCatalog.length > 0 ? `미사용 선언 ${tile.check.unusedInCatalog.length}개` : "",
  ].filter(Boolean);
  return details.length > 0 ? `원천 불일치 · ${details.join(" · ")}` : "원천 불일치";
}

function engineLabel(tile: AdminTile): string {
  const flags = [
    tile.heavy ? "무거운 계산" : "일반 계산",
    tile.dateIndependent ? "날짜 무관" : "기준일 사용",
    tile.siteDependent ? "대지 의존" : "공통 결과",
    tile.cut ? "컷" : "",
    tile.detail ? "상세" : "",
    tile.reportHook ? "PPT 연결" : "",
  ].filter(Boolean);
  return `${flags.join(" · ")} · ${tile.cacheVersion}`;
}

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("button, textarea, input, [href]")].filter((element) => !element.hasAttribute("disabled") && !element.getAttribute("aria-hidden"));
}

function requestStatusClass(request: TileRequest): string {
  return request.status === "완료" ? styles.statusDone : request.status === "보류" ? styles.statusHold : styles.statusPending;
}

function RequestCard({ request, onOpenCompare, onReopen }: { request: TileRequest; onOpenCompare: (request: TileRequest, trigger: HTMLButtonElement) => void; onReopen: (request: TileRequest) => void }) {
  return (
    <article className={styles.requestCard} data-admin-request={request.id}>
      <div className={styles.requestHeading}>
        <strong>요청 {request.id}</strong>
        <span className={requestStatusClass(request)}>{request.status}</span>
      </div>
      <p className={styles.requestMemo}>{request.memo || "핀으로 표시한 위치를 확인해 주세요."}</p>
      <div className={styles.requestMeta}>
        <span>등록 {dateTimeLabel(request.createdAt)}</span>
        {request.imagePath ? <span>요청 그림 있음</span> : <span>그림 없음</span>}
        {request.status === "완료" && request.resolvedNote && <span>처리 메모 · {request.resolvedNote}</span>}
        {request.status === "보류" && request.resolvedNote && <span>보류 이유 · {request.resolvedNote}</span>}
        {request.resolvedCommit && <span>커밋 · {request.resolvedCommit}</span>}
        {request.resolvedAt && <span>처리일 · {dateTimeLabel(request.resolvedAt)}</span>}
      </div>
      <div className={styles.requestActionRow}>
        {request.status === "완료" && (
          <button type="button" className={styles.miniButton} onClick={(event) => onOpenCompare(request, event.currentTarget)}>전·후 비교</button>
        )}
        {(request.status === "완료" || request.status === "보류") && (
          <button type="button" className={styles.miniButton} onClick={() => onReopen(request)}>다시 열기</button>
        )}
      </div>
    </article>
  );
}

export default function TileDrawer({ tile, result, overview, requests, compareOpen, onImageReady, onClose, onRequestCreated, onRequestUpdated, onOpenCompare }: TileDrawerProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const imageRef = useRef<HTMLButtonElement>(null);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [view, setView] = useState<TileView | null>(null);
  const [imageError, setImageError] = useState(false);
  const [pins, setPins] = useState<TileRequestPin[]>([]);
  const [memo, setMemo] = useState("");
  const [saving, setSaving] = useState(false);
  const [reopenId, setReopenId] = useState<number | null>(null);
  const [reopenNote, setReopenNote] = useState("");
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean } | null>(null);

  useEffect(() => {
    setPins([]);
    setMemo("");
    setReopenId(null);
    setReopenNote("");
    setFeedback(null);
  }, [tile.code]);

  useEffect(() => {
    let cancelled = false;
    setImageSrc(null);
    onImageReady(null);
    setView(null);
    setImageError(false);
    if (!result || tile.code === "S01" || tile.actualSources === null || ["pending", "running", "no_data", "failed", "cancelled", "not_provided"].includes(tile.resultStatus ?? "")) return;
    try {
      const nextView = toTileView(result);
      setView(nextView);
      void tileSvgForView(nextView, { width: 1600, height: 1200, withFrame: true, layer: "white" }).then((svg) => {
        if (!cancelled) {
          const dataUrl = svgDataUrl(svg);
          setImageSrc(dataUrl);
          onImageReady(dataUrl);
        }
      }).catch(() => {
        if (!cancelled) {
          setImageError(true);
          onImageReady(null);
        }
      });
    } catch {
      setImageError(true);
      onImageReady(null);
    }
    return () => { cancelled = true; };
  }, [onImageReady, result, tile.actualSources, tile.code, tile.resultStatus]);

  useEffect(() => {
    window.requestAnimationFrame(() => closeRef.current?.focus());
  }, []);

  const onDrawerKeyDown = (event: KeyboardEvent) => {
    if (compareOpen || event.key !== "Tab") return;
    const root = drawerRef.current;
    if (!root) return;
    const elements = focusables(root);
    if (elements.length === 0) return;
    const current = document.activeElement;
    const index = elements.indexOf(current as HTMLElement);
    const next = event.shiftKey
      ? index <= 0 ? elements.length - 1 : index - 1
      : index < 0 || index === elements.length - 1 ? 0 : index + 1;
    if (index < 0 || (event.shiftKey && index === 0) || (!event.shiftKey && index === elements.length - 1)) {
      event.preventDefault();
      elements[next]?.focus();
    }
  };

  const addPin = (event: MouseEvent<HTMLButtonElement>) => {
    if (pins.length >= 9) {
      setFeedback({ text: "핀은 9개까지 찍을 수 있습니다", error: true });
      return;
    }
    const element = imageRef.current;
    if (!element) return;
    const pin = pinFromClick(element.getBoundingClientRect(), event.clientX, event.clientY);
    if (!pin) return;
    setPins((current) => [...current, pin]);
    setFeedback(null);
  };

  const addRequest = async () => {
    if (saving) return;
    setSaving(true);
    setFeedback(null);
    let png: Uint8Array | null = null;
    let imageNote = "";
    if (view) {
      try {
        const generated = await tilePng(view, { width: 1600, height: 1200, withFrame: true, scale: 1, layer: "white" });
        if (generated.length <= 5 * 1024 * 1024) png = generated;
        else imageNote = "그림이 5 MB를 넘어 그림 없이 저장했습니다.";
      } catch {
        imageNote = "그림을 만들지 못해 그림 없이 저장했습니다.";
      }
    }
    const form = new FormData();
    form.set("tileCode", tile.code);
    form.set("analysisId", overview.analysis?.id ?? "");
    form.set("memo", memo);
    form.set("pins", JSON.stringify(pins));
    form.set("context", JSON.stringify(requestContext(tile, overview)));
    if (png) {
      const imageBytes = new Uint8Array(png);
      form.set("image", new Blob([imageBytes.buffer as ArrayBuffer], { type: "image/png" }), `${tile.code}.png`);
    }
    try {
      const response = await authFetch("/site/api/v2/admin/requests", { method: "POST", body: form });
      const body = await response.json().catch(() => ({})) as { request?: TileRequest; error?: string };
      if (!response.ok || !body.request) throw new Error(body.error ?? "요청을 저장하지 못했습니다");
      onRequestCreated(body.request);
      setMemo("");
      setPins([]);
      setFeedback({ text: imageNote || "수정 요청을 저장했습니다." });
    } catch (error) {
      setFeedback({ text: error instanceof Error ? error.message : "요청을 저장하지 못했습니다", error: true });
    } finally {
      setSaving(false);
    }
  };

  const reopen = async (request: TileRequest) => {
    try {
      const response = await authFetch(`/site/api/v2/admin/requests/${request.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reopen", note: reopenNote }),
      });
      const body = await response.json().catch(() => ({})) as { request?: TileRequest; error?: string };
      if (!response.ok || !body.request) throw new Error(body.error ?? "요청을 다시 열지 못했습니다");
      onRequestUpdated(body.request);
      setReopenId(null);
      setReopenNote("");
      setFeedback({ text: "요청을 대기로 되돌렸습니다." });
    } catch (error) {
      setFeedback({ text: error instanceof Error ? error.message : "요청을 다시 열지 못했습니다", error: true });
    }
  };

  const statusLabel = tile.code === "S01"
    ? "3D는 보드에서 확인"
    : tile.actualSources === null
      ? "확인 불가"
      : tile.resultStatus
        ? RESULT_LABELS[tile.resultStatus] ?? tile.resultStatus
        : imageError
          ? "그림을 불러오지 못했습니다"
          : "그림 준비 중";
  const tileRequests = requests.filter((request) => request.tileCode === tile.code);
  const requestImage = imageSrc ? (
    <button ref={imageRef} type="button" className={styles.drawerImageButton} aria-label="그림을 눌러 고칠 위치에 번호 핀 찍기" onClick={addPin}>
      <img src={imageSrc} alt={`${tile.title} 상세 그림`} className={styles.drawerImage} />
      {pins.map((pin, index) => <span key={`${pin.x}:${pin.y}:${index}`} className={styles.pin} style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%` }} aria-hidden="true">{index + 1}</span>)}
    </button>
  ) : <div className={styles.drawerPlaceholder}>{statusLabel}</div>;

  if (typeof document === "undefined") return null;
  return createPortal(
    <aside ref={drawerRef} className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby="admin-drawer-title" data-admin-drawer inert={compareOpen ? true : undefined} onKeyDown={onDrawerKeyDown}>
      <div className={styles.drawerHeading}>
        <span className={styles.drawerCode}>{tile.code}</span>
        <h2 id="admin-drawer-title">{tile.title}</h2>
        <button ref={closeRef} type="button" className={styles.closeButton} aria-label="상세 닫기" onClick={onClose}>×</button>
      </div>
      {requestImage}
      <div className={styles.drawerActions}>
        <span className={styles.requestHint}>그림을 누르면 위치 핀이 생깁니다. {pins.length}/9</span>
        <button type="button" className={styles.miniButton} onClick={() => setPins([])} disabled={pins.length === 0}>핀 지우기</button>
      </div>
      <dl className={styles.drawerMeta}>
        <dt>형태</dt><dd>{tile.forms.map((form) => FORM_LABELS[form] ?? form).join(" · ")}</dd>
        <dt>선언 원천</dt><dd>{sourceNames(tile.declaredSources, overview)}</dd>
        <dt>실제 원천</dt><dd>{sourceNames(tile.actualSources, overview)}</dd>
        <dt>원천 점검</dt><dd>{checkLabel(tile)}</dd>
        <dt>엔진</dt><dd>{engineLabel(tile)}</dd>
        <dt>상태</dt><dd>{statusLabel}</dd>
        <dt>관련 파일</dt><dd className={styles.mono}>{tile.files.length > 0 ? tile.files.join("\n") : "관련 파일 없음"}</dd>
      </dl>

      <section className={styles.requestSection} aria-labelledby="admin-request-add-title">
        <h3 id="admin-request-add-title">수정 요청 추가</h3>
        <div className={styles.requestForm}>
          <label htmlFor="admin-request-memo">메모(선택)</label>
          <textarea id="admin-request-memo" value={memo} maxLength={2000} onChange={(event) => setMemo(event.target.value)} placeholder="고칠 점을 적거나 그림에 핀을 찍어 주세요." />
          <div className={styles.drawerActions}>
            <span className={styles.requestHint}>{memo.length}/2,000자</span>
            <button type="button" className={`${styles.miniButton} ${styles.miniButtonPrimary}`} onClick={() => void addRequest()} disabled={saving || (!memo.trim() && pins.length === 0)} aria-busy={saving}>
              {saving ? "저장 중…" : "요청 추가"}
            </button>
          </div>
        </div>
        {feedback && <p className={`${styles.inlineNotice} ${feedback.error ? styles.inlineNoticeError : ""}`} role={feedback.error ? "alert" : "status"}>{feedback.text}</p>}
      </section>

      <section className={styles.requestSection} aria-labelledby="admin-request-list-title">
        <div className={styles.requestHeading}><h3 id="admin-request-list-title">이 타일의 요청</h3><span className={styles.requestHint}>{tileRequests.length}건</span></div>
        {tileRequests.length > 0 ? (
          <div className={styles.requestList}>
            {tileRequests.map((request) => (
              <div key={request.id}>
                <RequestCard request={request} onOpenCompare={onOpenCompare} onReopen={(item) => { setReopenId(item.id); setReopenNote(""); }} />
                {reopenId === request.id && (
                  <div className={styles.reopenForm}>
                    <label htmlFor={`reopen-note-${request.id}`}>아직 아쉬운 점(선택)</label>
                    <textarea id={`reopen-note-${request.id}`} value={reopenNote} onChange={(event) => setReopenNote(event.target.value)} maxLength={2000} />
                    <div className={styles.requestActionRow}>
                      <button type="button" className={`${styles.miniButton} ${styles.miniButtonPrimary}`} onClick={() => void reopen(request)}>대기로 되돌리기</button>
                      <button type="button" className={styles.miniButton} onClick={() => setReopenId(null)}>취소</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : <p className={styles.emptyHint}>아직 요청이 없습니다.</p>}
        <p className={styles.inlineNotice}>대기 요청은 AI가 관련 파일·원천·저장된 그림과 핀을 함께 읽고 처리할 수 있습니다.</p>
      </section>
    </aside>,
    document.body,
  );
}
