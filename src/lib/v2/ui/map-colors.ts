/** 지도 색 선택(바탕 테마·다이어그램 팔레트·끈 바탕 레이어)의 검증·우선순위·모델 적용. 순수 함수. */
import type { MapColorChoice, ReportDoc, ReportPage } from "../report/report-doc";
import type { BoardState } from "./board-state";
import type { MapModel } from "./map-layers";
import { isPaletteRef, type DiagramPaletteRef } from "./map-palette";
import { COLOR_KEYS, DEFAULT_BASE_THEME, isBaseThemeRef, isBaseToggleLayer, type BaseThemeColors, type BaseThemeRef, type BaseToggleLayer } from "./map-theme";

/** 검증을 통과한 바탕 색 참조의 복사본. 모르는 값이면 undefined. */
export function normalizeBaseRef(value: unknown): BaseThemeRef | undefined {
  if (!isBaseThemeRef(value)) return undefined;
  if (typeof value === "string") return value;
  return { name: value.name, colors: Object.fromEntries(COLOR_KEYS.map((k) => [k, value.colors[k]])) as BaseThemeColors };
}

/** 검증을 통과한 팔레트 참조의 복사본. 모르는 값이면 undefined. */
export function normalizePaletteRef(value: unknown): DiagramPaletteRef | undefined {
  if (!isPaletteRef(value)) return undefined;
  if (typeof value === "string") return value;
  return { name: value.name, colors: { cat: [...value.colors.cat], seq: [...value.colors.seq] } };
}

/** 알려진 레이어만, 중복 없이. 배열이 아니거나 항목이 있는데 하나도 알 수 없으면 undefined(빈 배열 [] = 모두 켬은 유효). */
export function normalizeHide(value: unknown): BaseToggleLayer[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const layers = [...new Set(value.filter(isBaseToggleLayer))];
  return layers.length === 0 && value.length > 0 ? undefined : layers;
}

/** 저장된 선택을 읽는다: 유효한 필드만 남기고, 아무것도 없으면 undefined. */
export function normalizeMapColors(value: unknown): MapColorChoice | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const base = normalizeBaseRef(raw.base);
  const palette = normalizePaletteRef(raw.palette);
  const hide = normalizeHide(raw.hide);
  const out: MapColorChoice = { ...(base !== undefined ? { base } : {}), ...(palette !== undefined ? { palette } : {}), ...(hide !== undefined ? { hide } : {}) };
  return Object.keys(out).length > 0 ? out : undefined;
}

/** 이 쪽에 적용할 색: 쪽 > 보고서 > 보드 > 기본(warm·app·모두 켬). 필드마다 따로 정한다. */
export function resolveMapColors(
  board: Pick<BoardState, "baseTheme" | "palette" | "baseHide">,
  doc: Pick<ReportDoc, "mapColors">,
  page?: Pick<ReportPage, "mapColors">,
): Required<MapColorChoice> {
  return {
    base: page?.mapColors?.base ?? doc.mapColors?.base ?? board.baseTheme ?? DEFAULT_BASE_THEME,
    palette: page?.mapColors?.palette ?? doc.mapColors?.palette ?? board.palette ?? "app",
    hide: page?.mapColors?.hide ?? doc.mapColors?.hide ?? board.baseHide ?? [],
  };
}

/** 지도 모델에 고른 색을 붙인 새 모델. 고른 것이 없으면 같은 객체. 프리셋 객체는 바꾸지 않는다. */
export function withMapColors(model: MapModel, colors: MapColorChoice): MapModel;
export function withMapColors(model: MapModel | null | undefined, colors: MapColorChoice): MapModel | null | undefined;
export function withMapColors(model: MapModel | null | undefined, colors: MapColorChoice): MapModel | null | undefined {
  if (!model) return model;
  // 끈 레이어가 없고 모델에도 없으면 키를 붙이지 않는다(기본 출력과 같게).
  const hide = colors.hide && (colors.hide.length > 0 || model.baseHide) ? colors.hide : undefined;
  if (colors.base === undefined && colors.palette === undefined && hide === undefined) return model;
  return {
    ...model,
    ...(colors.base !== undefined ? { baseTheme: colors.base } : {}),
    ...(colors.palette !== undefined ? { palette: colors.palette } : {}),
    ...(hide !== undefined ? { baseHide: [...hide] } : {}),
  };
}

/** 쪽·보고서 선택을 한 겹으로 합친다(쪽 필드가 이긴다). 고른 것이 없으면 undefined. 보드 값은 view에 이미 붙어 있다. */
export function mergeMapColors(doc: Pick<ReportDoc, "mapColors">, page?: Pick<ReportPage, "mapColors">): MapColorChoice | undefined {
  const merged = { ...doc.mapColors, ...page?.mapColors };
  return Object.keys(merged).length > 0 ? merged : undefined;
}
