"use client";

/** 지도 색 팝오버(C안): 바탕 테마·다이어그램 팔레트를 이름+색 띠 목록에서 고른다. 올려 두면 미리 보고, 누르면 적용한다. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { MapColorChoice } from "@/lib/v2/report/report-doc";
import { loadMyColors, removeMyColor, type MyColors, type SavedBase, type SavedPalette } from "@/lib/v2/ui/my-map-colors";
import { BASE_THEME_IDS, baseTheme, COLOR_KEYS, type BaseThemeRef } from "@/lib/v2/ui/map-theme";
import { PALETTE_IDS, paletteColors, paletteName, type DiagramPaletteRef } from "@/lib/v2/ui/map-palette";
import { appPaletteColors } from "./app-palette";
import MapColorMaker, { MapColorIcon, type MapColorKind } from "./map-color-maker";
import styles from "./map-colors.module.css";

export { appPaletteColors };

export type MapColorScopeProps = {
  value: "document" | "page";
  /** 선택한 쪽에 지도가 있는가(출처·빈 쪽은 없음) */
  pageAvailable: boolean;
  /** 그 쪽이 보고서 전체와 다른 색을 따로 갖고 있는가 */
  pageOverridden: boolean;
  onChange(scope: "document" | "page"): void;
  onClearPage(): void;
};

export type MapColorPopoverProps = {
  value: Required<MapColorChoice>;
  /** 보고서에서만 준다. 없으면 보드. */
  scope?: MapColorScopeProps;
  /** 줄 위에 150 ms 머물면 그 줄을, 목록을 떠나거나 닫으면 null을 알린다. 저장된 값을 바꾸지 않는다. */
  onPreview(choice: MapColorChoice | null): void;
  onApply(patch: MapColorChoice): void;
  onClose(): void;
  /** 「색 만들기」 카드가 팝오버 어느 쪽에 뜨는가 */
  makerSide: "left" | "right";
  /** 시험용: 있으면 내 테마를 서버에서 부르지 않고 이 값을 쓴다. */
  initialMine?: MyColors;
  /** 시험용: 처음 보일 탭 */
  initialTab?: MapColorKind;
};

const PREVIEW_DELAY_MS = 150;
const MAKER_MARGIN = 8;

type Row = { key: string; kind: "mine" | "preset"; name: string; ref: BaseThemeRef | DiagramPaletteRef; strip: string[]; savedId?: number };

const sameHex = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((c, i) => sameHex(c, b[i]));

/** 같은 바탕 테마인가. 프리셋은 id로, 만든 색은 색 값으로(이름은 보지 않는다). */
export function sameBaseRef(a: BaseThemeRef, b: BaseThemeRef): boolean {
  if (typeof a === "string" || typeof b === "string") return a === b;
  return COLOR_KEYS.every((k) => sameHex(a.colors[k], b.colors[k]));
}

/** 같은 팔레트인가. 프리셋은 id로, 만든 색은 색 값으로. */
export function samePaletteRef(a: DiagramPaletteRef, b: DiagramPaletteRef): boolean {
  if (typeof a === "string" || typeof b === "string") return a === b;
  return sameList(a.colors.cat, b.colors.cat) && sameList(a.colors.seq, b.colors.seq);
}

/** 바탕 색 띠: 바탕 · 건물 · 도로 · 녹지 · 물 · 대지 */
const baseStrip = (ref: BaseThemeRef): string[] => {
  const t = baseTheme(ref);
  return [t.bg, t.building.fill, t.road.fill, t.green.park, t.water, t.site.fill];
};
/** 다이어그램 색 띠: 범주 앞 5칸 */
const paletteStrip = (ref: DiagramPaletteRef): string[] => (paletteColors(ref) ?? appPaletteColors()).cat.slice(0, 5);

function buildRows(tab: MapColorKind, mine: MyColors | null): Row[] {
  if (tab === "base") {
    const own = (mine?.base ?? []).map((s: SavedBase): Row => {
      const ref: BaseThemeRef = { name: s.name, colors: { ...s.colors } };
      return { key: `mine-${s.id}`, kind: "mine", name: s.name, ref, strip: baseStrip(ref), savedId: s.id };
    });
    const presets = BASE_THEME_IDS.map((id): Row => ({ key: id, kind: "preset", name: baseTheme(id).name, ref: id, strip: baseStrip(id) }));
    return [...own, ...presets];
  }
  const own = (mine?.palette ?? []).map((s: SavedPalette): Row => {
    const ref: DiagramPaletteRef = { name: s.name, colors: { cat: [...s.colors.cat], seq: [...s.colors.seq] } };
    return { key: `mine-${s.id}`, kind: "mine", name: s.name, ref, strip: paletteStrip(ref), savedId: s.id };
  });
  const presets = PALETTE_IDS.map((id): Row => ({ key: id, kind: "preset", name: paletteName(id), ref: id, strip: paletteStrip(id) }));
  return [...own, ...presets];
}

export default function MapColorPopover({ value, scope, onPreview, onApply, onClose, makerSide, initialMine, initialTab = "base" }: MapColorPopoverProps) {
  const [tab, setTab] = useState<MapColorKind>(initialTab);
  const [mine, setMine] = useState<MyColors | null>(initialMine ?? null);
  const [makerOpen, setMakerOpen] = useState(false);
  /** 줄을 눌러 값이 바뀌면 열려 있는 만들기 카드를 새 값에서 다시 시작한다. */
  const [makerEpoch, setMakerEpoch] = useState(0);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const makerToggleRef = useRef<HTMLButtonElement>(null);
  const makerSlotRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);
  const previewingRef = useRef(false);
  // 이벤트·정리 함수가 늘 최신 콜백을 부르게 한다.
  const callbacks = useRef({ onPreview, onClose });
  callbacks.current = { onPreview, onClose };
  const makerOpenRef = useRef(false);
  makerOpenRef.current = makerOpen;

  // 내 테마는 열 때 한 번만 불러온다.
  useEffect(() => {
    if (initialMine) return;
    let alive = true;
    void loadMyColors().then((m) => alive && setMine(m));
    return () => {
      alive = false;
    };
    // 한 번만: 열 때 부른다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const endPreview = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    if (previewingRef.current) {
      previewingRef.current = false;
      callbacks.current.onPreview(null);
    }
  }, []);
  useEffect(() => endPreview, [endPreview]);

  // Esc는 만들기 카드부터, 다음에 팝오버를 닫는다. 바깥(보고서의 Esc 처리)보다 먼저 받는다.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (makerOpenRef.current) {
        setMakerOpen(false);
        makerToggleRef.current?.focus();
      } else {
        callbacks.current.onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // 만들기 카드가 화면 아래로 넘치면 위로 올린다(위쪽 끝은 넘기지 않는다).
  useLayoutEffect(() => {
    const slot = makerSlotRef.current;
    if (!slot || !makerOpen) return;
    const fit = () => {
      slot.style.translate = "";
      const rect = slot.getBoundingClientRect();
      const over = rect.bottom - (window.innerHeight - MAKER_MARGIN);
      const dy = over > 0 ? -Math.min(over, Math.max(0, rect.top - MAKER_MARGIN)) : 0;
      if (dy !== 0) slot.style.translate = `0 ${dy}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [makerOpen, tab, makerEpoch]);

  const rows = useMemo(() => buildRows(tab, mine), [tab, mine]);
  const choiceOf = (row: Row): MapColorChoice => (tab === "base" ? { base: row.ref as BaseThemeRef } : { palette: row.ref as DiagramPaletteRef });
  const isCurrent = (row: Row) => (tab === "base" ? sameBaseRef(row.ref as BaseThemeRef, value.base) : samePaletteRef(row.ref as DiagramPaletteRef, value.palette));

  const schedulePreview = (row: Row) => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      previewingRef.current = true;
      callbacks.current.onPreview(choiceOf(row));
    }, PREVIEW_DELAY_MS);
  };
  const choose = (row: Row) => {
    onApply(choiceOf(row));
    endPreview();
    setMakerEpoch((n) => n + 1);
  };
  const switchTab = (next: MapColorKind) => {
    endPreview();
    setConfirmId(null);
    setTab(next);
  };

  const remove = async (row: Row) => {
    if (row.savedId === undefined) return;
    setListError(null);
    try {
      await removeMyColor(row.savedId);
      setMine((cur) => (cur ? { base: cur.base.filter((s) => s.id !== row.savedId), palette: cur.palette.filter((s) => s.id !== row.savedId) } : cur));
      setConfirmId(null);
    } catch (error) {
      setConfirmId(null);
      setListError(error instanceof Error ? error.message : "내 테마를 지우지 못했습니다");
    }
  };

  // 저장하면 그 테마를 적용하고 목록 맨 위에 올린다.
  const saved = (kind: MapColorKind, item: SavedBase | SavedPalette) => {
    if (kind === "base") {
      const s = item as SavedBase;
      setMine((cur) => ({ base: [s, ...(cur?.base ?? [])], palette: cur?.palette ?? [] }));
      onApply({ base: { name: s.name, colors: { ...s.colors } } });
    } else {
      const s = item as SavedPalette;
      setMine((cur) => ({ base: cur?.base ?? [], palette: [s, ...(cur?.palette ?? [])] }));
      onApply({ palette: { name: s.name, colors: { cat: [...s.colors.cat], seq: [...s.colors.seq] }} });
    }
  };

  const ownRows = rows.filter((r) => r.kind === "mine");
  const presetRows = rows.filter((r) => r.kind === "preset");
  const renderRow = (row: Row) => {
    const current = isCurrent(row);
    if (row.kind === "mine" && confirmId === row.savedId) {
      return (
        <div key={row.key} className={styles.confirm} role="group" aria-label={`${row.name} 지우기 확인`}>
          <span>지울까요?</span>
          <button type="button" data-danger="" onClick={() => void remove(row)}>지우기</button>
          <button type="button" onClick={() => setConfirmId(null)}>취소</button>
        </div>
      );
    }
    return (
      <div key={row.key} className={styles.rowWrap} role="listitem">
        <button
          type="button"
          className={styles.row}
          data-row={row.kind}
          data-name={row.name}
          aria-pressed={current}
          onClick={() => choose(row)}
          onMouseEnter={() => schedulePreview(row)}
          onFocus={() => schedulePreview(row)}
        >
          <span className={styles.ck} aria-hidden="true">{current && <MapColorIcon name="check" />}</span>
          <span className={styles.nm}>{row.name}</span>
          <span className={styles.sw} data-strip="">{row.strip.map((c, i) => <i key={i} style={{ background: c }} />)}</span>
        </button>
        {row.kind === "mine" && (
          <button type="button" className={styles.trash} aria-label={`${row.name} 지우기`} title="지우기" onClick={() => setConfirmId(row.savedId ?? null)}>
            <MapColorIcon name="trash" />
          </button>
        )}
      </div>
    );
  };

  return (
    <div className={styles.pop} data-map-color-popover="">
      <div className={styles.seg} role="group" aria-label="고를 색">
        <button type="button" data-tab="base" aria-pressed={tab === "base"} onClick={() => switchTab("base")}>바탕</button>
        <button type="button" data-tab="palette" aria-pressed={tab === "palette"} onClick={() => switchTab("palette")}>다이어그램</button>
      </div>
      {scope && (
        <div className={styles.seg} role="group" aria-label="적용 범위">
          <button type="button" data-scope="document" aria-pressed={scope.value === "document"} onClick={() => scope.onChange("document")}>보고서 전체</button>
          <button
            type="button"
            data-scope="page"
            aria-pressed={scope.value === "page"}
            aria-disabled={scope.pageAvailable ? undefined : true}
            title={scope.pageAvailable ? undefined : "이 쪽에는 지도가 없습니다"}
            onClick={() => scope.pageAvailable && scope.onChange("page")}
          >
            이 쪽만
          </button>
        </div>
      )}
      {!scope && tab === "palette" && <p className={styles.note}>타일 카드의 주제 색에 적용됩니다.</p>}
      <div className={styles.list} role="list" aria-label={tab === "base" ? "바탕 테마" : "다이어그램 팔레트"} aria-busy={mine === null} onMouseLeave={endPreview} onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && endPreview()}>
        {mine === null && <div className={styles.skeleton} data-loading="mine" aria-hidden="true" />}
        {ownRows.length > 0 && <div className={styles.groupLabel}>내 테마</div>}
        {ownRows.map(renderRow)}
        {ownRows.length > 0 && <div className={styles.divider} role="separator" />}
        {presetRows.map(renderRow)}
      </div>
      {listError && <p className={styles.error} role="alert">{listError}</p>}
      <button
        ref={makerToggleRef}
        type="button"
        className={styles.secondary}
        aria-expanded={makerOpen}
        aria-haspopup="dialog"
        onClick={() => {
          endPreview();
          setMakerOpen((open) => !open);
        }}
      >
        색 만들기…
      </button>
      {scope?.pageOverridden && (
        <button type="button" className={styles.secondary} onClick={scope.onClearPage}>보고서 전체 색으로</button>
      )}
      {makerOpen && (
        <div ref={makerSlotRef} className={styles.makerSlot} data-side={makerSide}>
          <MapColorMaker
            key={`${tab}-${makerEpoch}`}
            kind={tab}
            value={value}
            onApply={onApply}
            onSaved={saved}
            onClose={() => {
              setMakerOpen(false);
              makerToggleRef.current?.focus();
            }}
          />
        </div>
      )}
    </div>
  );
}

export type MapColorBoardPopoverProps = Omit<MapColorPopoverProps, "makerSide"> & {
  /** 이 팝오버를 연 버튼. 아래 8 px에 꼬리로 붙고, 닫으면 포커스가 돌아간다. */
  triggerRef: RefObject<HTMLElement | null>;
};

const BOARD_WIDTH = 288;
const BOARD_GAP = 8;
const SCREEN_MARGIN = 12;
const MAKER_GAP = 12;

/** 보드용 자리: 버튼 아래에 꼬리로 붙는 고정 위치 창. 바깥을 누르면 닫는다. */
export function MapColorBoardPopover({ triggerRef, ...props }: MapColorBoardPopoverProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; tail: number; side: "left" | "right" } | null>(null);
  const { onClose } = props;

  const close = useCallback(() => {
    onClose();
    const trigger = triggerRef.current;
    window.requestAnimationFrame(() => trigger?.focus());
  }, [onClose, triggerRef]);

  useLayoutEffect(() => {
    const place = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const center = rect.left + rect.width / 2;
      const left = Math.max(SCREEN_MARGIN, Math.min(center - BOARD_WIDTH / 2, window.innerWidth - BOARD_WIDTH - SCREEN_MARGIN));
      setPos({ left, top: rect.bottom + BOARD_GAP, tail: center - left - 6.5, side: left - MAKER_GAP - BOARD_WIDTH >= MAKER_MARGIN ? "left" : "right" });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [triggerRef]);

  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (hostRef.current?.contains(event.target) || triggerRef.current?.contains(event.target)) return;
      close();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [close, triggerRef]);

  // 창은 문서 끝에 붙으므로 Tab 순서로는 닿지 않는다. 열 때 현재 탭으로 포커스를 옮긴다.
  useEffect(() => {
    hostRef.current?.querySelector<HTMLElement>('[data-tab][aria-pressed="true"]')?.focus();
  }, []);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={hostRef}
      className={styles.host}
      role="dialog"
      aria-label="지도 색"
      style={pos ? { left: pos.left, top: pos.top } : { visibility: "hidden", left: 0, top: 0 }}
    >
      <span className={styles.hostTail} style={{ left: pos?.tail ?? 0 }} aria-hidden="true" />
      <MapColorPopover {...props} onClose={close} makerSide={pos?.side ?? "left"} />
    </div>,
    document.body,
  );
}
