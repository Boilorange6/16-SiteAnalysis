"use client";

/** 「색 만들기」 카드: 분위기로 바탕 색 7개·다이어그램 팔레트를 만들고, 고친 색은 바로 지도에 적용한다. */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { saveMyColor, SAVE_FAILED_MESSAGE, type SavedBase, type SavedPalette } from "@/lib/v2/ui/my-map-colors";
import { baseThemeWarnings, generateBaseColors, generatePaletteColors, lum, MOODS, paletteWarnings, shiftL, type Mood } from "@/lib/v2/ui/map-color";
import { baseTheme, BASE_TOGGLE_LAYERS, themeFromColors, type BaseThemeColors, type BaseToggleLayer } from "@/lib/v2/ui/map-theme";
import { paletteColors, type DiagramPaletteColors } from "@/lib/v2/ui/map-palette";
import type { MapColorChoice } from "@/lib/v2/report/report-doc";
import { appPaletteColors } from "./app-palette";
import styles from "./map-colors.module.css";

export type MapColorKind = "base" | "palette";
type Colors = BaseThemeColors | DiagramPaletteColors;
type MakerState = { colors: Colors; undo: Colors[]; redo: Colors[] };

export type MapColorMakerProps = {
  kind: MapColorKind;
  /** 지금 적용된 색. 이 값에서 시작한다. */
  value: Required<MapColorChoice>;
  /** group: 같은 입력이 이어지는 편집(색 고르개 끌기)의 묶음 이름. 받는 쪽이 되돌리기 한 단계로 합칠 수 있다. */
  onApply(patch: MapColorChoice, group?: string): void;
  /** 계정에 저장이 끝났을 때. 저장된 테마를 목록에 올리고 적용하는 일은 부른 쪽이 한다. */
  onSaved(kind: MapColorKind, saved: SavedBase | SavedPalette): void;
  onClose(): void;
};

const UNDO_LIMIT = 40;
/** 같은 입력(색 고르개 끌기)이 이 시간 안에 이어지면 되돌리기 한 단계로 묶는다. */
const COALESCE_MS = 600;

const BASE_ROWS: ReadonlyArray<readonly [keyof BaseThemeColors, string, BaseToggleLayer | null]> = [
  ["bg", "바탕", null],
  ["building", "건물", "building"],
  ["parcel", "필지선", "parcel"],
  ["road", "도로", "road"],
  ["green", "녹지", "green"],
  ["water", "물", "water"],
  ["site", "대지", null],
];

const ICONS: Record<string, string> = {
  x: "M6 6l12 12M18 6L6 18",
  lock: "M5 11h14v9H5zM8 11V8a4 4 0 0 1 8 0v3",
  unlock: "M5 11h14v9H5zM8 11V8a4 4 0 0 1 7.5-2",
  shuffle: "M3 7h3.5c2 0 3.2 1 4.3 2.7l2.4 4.6C14.3 16 15.5 17 17.5 17H21M18 4l3 3-3 3M18 14l3 3-3 3M3 17h3.5c1.4 0 2.4-.5 3.2-1.4M14.3 8.4C15.1 7.5 16.1 7 17.5 7H21",
  minus: "M6 12h12",
  plus: "M12 6v12M6 12h12",
  pen: "M4 20h4L19 9l-4-4L4 16z",
  undo: "M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3",
  redo: "M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3",
  check: "M5 12l5 5 9-10",
  eye: "M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z",
  eyeOff: "M3 3l18 18M10.6 6.1c.4 0 .9-.1 1.4-.1 6.4 0 10 6 10 6a17 17 0 0 1-3.2 3.8M6.6 7.3A16.5 16.5 0 0 0 2 12s3.6 6.5 10 6.5c1.6 0 3-.4 4.3-1M9.9 9.9a2.5 2.5 0 0 0 3.2 3.2",
  trash: "M4 7h16M10 7V4h4v3M6 7l1 13h10l1-13M10 11v6M14 11v6",
};

export function MapColorIcon({ name, size = 14 }: { name: keyof typeof ICONS; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={ICONS[name]} />
    </svg>
  );
}

const inkOn = (hex: string) => (lum(hex) > 0.36 ? "#1d1d1b" : "#ffffff");
const FADED_INK = "#1d1d1b";

/** 지금 적용된 바탕 테마에서 색 7개를 읽는다. */
export function baseColorsOf(ref: Required<MapColorChoice>["base"]): BaseThemeColors {
  const t = baseTheme(ref);
  return { bg: t.bg, building: t.building.fill, parcel: t.parcel.line, road: t.road.fill, green: t.green.park, water: t.water, site: t.site.fill };
}

/** 지금 적용된 팔레트에서 범주 8색·순서 5색을 읽는다. 「지금 앱 색」은 앱의 용도 색에서 읽는다. */
export function paletteColorsOf(ref: Required<MapColorChoice>["palette"]): DiagramPaletteColors {
  const c = paletteColors(ref) ?? appPaletteColors();
  return { cat: [...c.cat], seq: [...c.seq] };
}

export default function MapColorMaker({ kind, value, onApply, onSaved, onClose }: MapColorMakerProps) {
  const [state, setState] = useState<MakerState>(() => ({ colors: kind === "base" ? baseColorsOf(value.base) : paletteColorsOf(value.palette), undo: [], redo: [] }));
  const stateRef = useRef(state);
  const [locks, setLocks] = useState<Record<string, boolean>>({});
  const [mood, setMood] = useState<Mood>("자동");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const lastGroup = useRef<{ key: string; at: number } | null>(null);
  // 저장은 서버를 기다리는 동안 화면이 바뀔 수 있다. 끝난 뒤에는 늘 최신 콜백을 부르고, 카드가 이미 닫혔으면 아무것도 하지 않는다.
  const latest = useRef({ onApply, onSaved });
  latest.current = { onApply, onSaved };
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const apply = (colors: Colors, group?: string) => onApply(kind === "base" ? { base: { name: "만든 색", colors: colors as BaseThemeColors } } : { palette: { name: "만든 색", colors: colors as DiagramPaletteColors } }, group);
  const set = (next: MakerState) => {
    stateRef.current = next;
    setState(next);
  };
  /** 새 색을 적용한다. group이 같은 입력이 이어지면 되돌리기 한 단계로 묶는다. */
  const commit = (colors: Colors, group?: string) => {
    const now = Date.now();
    const joined = !!group && lastGroup.current?.key === group && now - lastGroup.current.at < COALESCE_MS;
    lastGroup.current = group ? { key: group, at: now } : null;
    const cur = stateRef.current;
    set({ colors, undo: joined ? cur.undo : [...cur.undo, cur.colors].slice(-UNDO_LIMIT), redo: [] });
    apply(colors, group);
  };
  const undo = () => {
    const cur = stateRef.current;
    const prev = cur.undo[cur.undo.length - 1];
    if (!prev) return;
    lastGroup.current = null;
    set({ colors: prev, undo: cur.undo.slice(0, -1), redo: [...cur.redo, cur.colors] });
    apply(prev);
  };
  const redo = () => {
    const cur = stateRef.current;
    const next = cur.redo[cur.redo.length - 1];
    if (!next) return;
    lastGroup.current = null;
    set({ colors: next, undo: [...cur.undo, cur.colors].slice(-UNDO_LIMIT), redo: cur.redo.slice(0, -1) });
    apply(next);
  };

  const colors = state.colors;
  const warnings = useMemo(() => (kind === "base" ? baseThemeWarnings(themeFromColors("만든 색", colors as BaseThemeColors)) : paletteWarnings(colors as DiagramPaletteColors)), [colors, kind]);

  const generate = (only?: string | number) => {
    if (kind === "base") {
      const next = generateBaseColors(mood, colors as BaseThemeColors, only === undefined ? (locks as Partial<Record<keyof BaseThemeColors, boolean>>) : {}, only as keyof BaseThemeColors | undefined);
      commit(next);
    } else {
      const next = generatePaletteColors(mood, colors as DiagramPaletteColors, only === undefined ? locks : {}, only as number | "seq" | undefined);
      commit(next);
    }
  };
  const shade = (key: string | number, dl: number) => {
    if (kind === "base") commit({ ...(colors as BaseThemeColors), [key]: shiftL((colors as BaseThemeColors)[key as keyof BaseThemeColors], dl) });
    else {
      const p = colors as DiagramPaletteColors;
      commit(key === "seq" ? { ...p, seq: p.seq.map((c) => shiftL(c, dl)) } : { ...p, cat: p.cat.map((c, i) => (i === key ? shiftL(c, dl) : c)) });
    }
  };
  const pick = (key: string | number, hex: string) => {
    if (kind === "base") commit({ ...(colors as BaseThemeColors), [key]: hex }, `pick:${key}`);
    else {
      const p = colors as DiagramPaletteColors;
      commit({ ...p, cat: p.cat.map((c, i) => (i === key ? hex : c)) }, `pick:${key}`);
    }
  };
  const toggleLock = (key: string | number) => setLocks((cur) => ({ ...cur, [key]: !cur[key] }));
  const toggleHide = (layer: BaseToggleLayer) => {
    const hidden = new Set(value.hide);
    if (hidden.has(layer)) hidden.delete(layer);
    else hidden.add(layer);
    onApply({ hide: BASE_TOGGLE_LAYERS.filter((l) => hidden.has(l)) });
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const saved = kind === "base" ? await saveMyColor("base", colors as BaseThemeColors) : await saveMyColor("palette", colors as DiagramPaletteColors);
      if (!mounted.current) return;
      latest.current.onSaved(kind, saved);
    } catch {
      if (mounted.current) setSaveError(SAVE_FAILED_MESSAGE);
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  const title = kind === "base" ? "바탕 색 만들기" : "다이어그램 색 만들기";
  /** 줄마다 같은 다섯 버튼: 고정 · 섞기 · 어둡게 · 밝게 · 직접 고르기. */
  const buttons = (key: string | number, name: string, hex: string | null) => (
    <>
      <button type="button" aria-pressed={!!locks[key]} aria-label={`${name} 고정`} title={`${name} 고정`} onClick={() => toggleLock(key)}><MapColorIcon name={locks[key] ? "lock" : "unlock"} /></button>
      <button type="button" aria-label={`${name} 섞기`} title={`${name} 섞기`} onClick={() => generate(key)}><MapColorIcon name="shuffle" /></button>
      <button type="button" aria-label={`${name} 어둡게`} title={`${name} 어둡게`} onClick={() => shade(key, -4)}><MapColorIcon name="minus" /></button>
      <button type="button" aria-label={`${name} 밝게`} title={`${name} 밝게`} onClick={() => shade(key, 4)}><MapColorIcon name="plus" /></button>
      {hex !== null ? (
        <span className={styles.pick}>
          <input type="color" tabIndex={-1} aria-hidden="true" value={hex} onChange={(e) => pick(key, e.target.value)} />
          <button type="button" aria-label={`${name} 직접 고르기`} title={`${name} 직접 고르기`} onClick={(e) => {
            const input = e.currentTarget.previousElementSibling as HTMLInputElement | null;
            if (input?.showPicker) input.showPicker();
            else input?.click();
          }}><MapColorIcon name="pen" /></button>
        </span>
      ) : null}
    </>
  );

  return (
    <section className={styles.maker} role="dialog" aria-label={title} data-maker={kind}>
      <header className={styles.makerHead}>
        <h3>{title}</h3>
        <button type="button" className={styles.iconBtn} aria-label="만들기 닫기" title="만들기 닫기" onClick={onClose}><MapColorIcon name="x" size={18} /></button>
      </header>
      <div className={styles.makerBody}>
        <div className={styles.chips} role="group" aria-label="분위기">
          {MOODS.map((m) => (
            <button key={m} type="button" data-mood={m} aria-pressed={mood === m} onClick={() => setMood(m)}>{m}</button>
          ))}
        </div>
        <div className={styles.rows}>
          {kind === "base"
            ? BASE_ROWS.map(([key, name, layer]) => {
                const hex = (colors as BaseThemeColors)[key];
                const hidden = layer !== null && value.hide.includes(layer);
                return (
                  <div key={key} className={styles.crow} data-color-row={key} data-eyes="" style={{ color: hidden ? FADED_INK : inkOn(hex) }}>
                    <span className={styles.crowFill} style={{ background: hex, opacity: hidden ? 0.45 : 1 } as CSSProperties} aria-hidden="true" />
                    {layer !== null ? (
                      <button type="button" data-eye={layer} aria-pressed={hidden} aria-label={`${name} ${hidden ? "보이기" : "숨기기"}`} title={`${name} ${hidden ? "보이기" : "숨기기"}`} onClick={() => toggleHide(layer)}><MapColorIcon name={hidden ? "eyeOff" : "eye"} /></button>
                    ) : <span aria-hidden="true" />}
                    <span className={styles.cn}>{name}</span>
                    <span className={styles.hx}>{hex.toUpperCase()}</span>
                    {buttons(key, name, hex)}
                  </div>
                );
              })
            : (
              <>
                {(colors as DiagramPaletteColors).cat.map((hex, i) => (
                  <div key={i} className={styles.crow} data-color-row={`cat-${i}`} style={{ color: inkOn(hex) }}>
                    <span className={styles.crowFill} style={{ background: hex }} aria-hidden="true" />
                    <span className={styles.cn}>{i + 1}번</span>
                    <span className={styles.hx}>{hex.toUpperCase()}</span>
                    {buttons(i, `${i + 1}번`, hex)}
                  </div>
                ))}
                <div className={styles.crow} data-color-row="seq" data-seq="" style={{ color: "#1d1d1b" }}>
                  <span className={styles.cn}>순서형</span>
                  <span className={styles.seqSw} aria-hidden="true">{(colors as DiagramPaletteColors).seq.map((c, i) => <i key={i} style={{ background: c }} />)}</span>
                  {buttons("seq", "순서형", null)}
                </div>
              </>
            )}
        </div>
        <div className={styles.warn}>
          {warnings.map((w) => (
            <span key={w.text} className={w.level === "ok" ? styles.ok : styles.bad}>{w.level === "ok" ? "✓ " : "! "}{w.text}</span>
          ))}
        </div>
        <div className={styles.ga}>
          <button type="button" className={styles.go} onClick={() => generate()}>만들기</button>
          <button type="button" className={styles.sq} aria-label="되돌리기" title="되돌리기" disabled={state.undo.length === 0} onClick={undo}><MapColorIcon name="undo" size={16} /></button>
          <button type="button" className={styles.sq} aria-label="다시" title="다시" disabled={state.redo.length === 0} onClick={redo}><MapColorIcon name="redo" size={16} /></button>
        </div>
        <button type="button" className={styles.save} disabled={saving} onClick={() => void save()}>내 테마로 저장</button>
        {saveError && <p className={styles.error} role="alert">{saveError}</p>}
      </div>
    </section>
  );
}
