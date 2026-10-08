import type { RasterRef, TileResult } from "../../tile-result";
import type { MapModel } from "../../ui/map-layers";
import type { TileView } from "../../ui/tile-view";
import type { TileClientModule, TileLayerOption } from "../types";

const S02_DATE_LABEL = {
  spring: "춘분",
  summer: "하지",
  autumn: "추분",
  winter: "동지",
  analysis: "분석일",
} as const;

type S02RasterDate = keyof typeof S02_DATE_LABEL;

type RasterMapModel = MapModel & {
  legend?: TileResult["presentation"]["legend"];
  defaultRaster?: string;
  rasterOptions?: RasterRef[];
};

function s02RasterDate(name: string): S02RasterDate | null {
  const match = /^(?:sun_hours|shade)_(spring|summer|autumn|winter|analysis)(?:_|$)/.exec(name);
  return match?.[1] && match[1] in S02_DATE_LABEL ? match[1] as S02RasterDate : null;
}

function extendSunHoursLegend(legend: TileResult["presentation"]["legend"]): TileResult["presentation"]["legend"] {
  const sunEntries = legend.filter((entry) => entry.label.includes("일조시간") && (entry.min !== null || entry.max !== null));
  if (sunEntries.length === 0) return legend;
  const prefix = sunEntries[0]!.label.split(" · ")[0] ?? "일조시간";
  const hourly = Array.from({ length: 16 }, (_, index) => ({
    label: index === 15 ? `${prefix} · 15시간 이상` : `${prefix} · ${index}시간`,
    min: index,
    max: index === 15 ? null : index + 1,
  }));
  return [...legend.filter((entry) => !entry.label.includes("일조시간")), ...hourly];
}

function s02MapNote(selected: RasterRef): string | null {
  const date = s02RasterDate(selected.name);
  if (!date) return null;
  return `${S02_DATE_LABEL[date]}${selected.palette === "shade_flow" ? " 그림자 흐름" : " 일조시간"} · 계절 레이어 · 건물·지형 그림자 반영`;
}

function selectedRaster(model: RasterMapModel, result?: TileResult): RasterRef | undefined {
  const options = model.rasterOptions ?? model.rasters ?? [];
  if (result) return options.find((ref) => ref.name === "sun_hours_winter") ?? options[0];
  return (model.defaultRaster ? options.find((ref) => ref.name === model.defaultRaster) : undefined) ?? model.rasters?.[0] ?? options[0];
}

/** S02의 계절 래스터 선택지와 카드의 동지 기본 상태를 공용 view에 덧붙인다. */
export function applyS02View(base: TileView, result?: TileResult): TileView {
  if (!base.map) return base;
  const model = base.map as RasterMapModel;
  const selected = selectedRaster(model, result);
  const note = selected ? s02MapNote(selected) : null;
  const nextMap: RasterMapModel = {
    ...model,
    ...(model.legend ? { legend: extendSunHoursLegend(model.legend) } : {}),
    ...(selected ? { rasters: [selected], defaultRaster: selected.name } : {}),
    ...(note && !result
      ? { notes: model.notes.map((existing) => existing.startsWith("동지 기본 일조시간 ·") ? note : existing) }
      : {}),
  };
  const date = selected ? s02RasterDate(selected.name) : null;
  const label = date ? S02_DATE_LABEL[date] : null;
  const metric = label ? base.rows.find((row) => row.label === `${label} 평균 일조시간`) : undefined;
  const nextNotes = !result && note ? [note, ...base.notes.filter((existing) => existing !== note)] : base.notes;
  return {
    ...base,
    ...(note && metric
      ? {
          headline: { value: metric.value, label: metric.label, aux: metric.aux, tag: metric.tag },
          headlineMetricId: `mean_sun_h_${date}`,
        }
      : {}),
    notes: nextNotes,
    map: nextMap,
  };
}

/** 컷 plan이 공용 ui 함수를 값으로 import하지 않고 S02 래스터 view를 만든다. */
export function viewWithOnlyRasterForS02(view: TileView, rasterName: string, note: string): TileView {
  if (!view.map) return view;
  const model = view.map as RasterMapModel;
  const options = model.rasterOptions ?? model.rasters ?? [];
  const selected = options.find((ref) => ref.name === rasterName);
  if (!selected) return view;
  const next = applyS02View({
    ...view,
    map: { ...model, rasters: [selected], defaultRaster: selected.name } as RasterMapModel,
  });
  return { ...next, notes: [note, ...next.notes.filter((existing) => existing !== note)] };
}

function rasterOptionsForResult(result: TileResult): TileLayerOption[] {
  const labels: Record<string, string> = {
    winter: "동지 기본",
    spring: "춘분",
    summer: "하지",
    autumn: "추분",
    analysis: "분석일",
  };
  return (result.presentation.rasters ?? [])
    .map((ref) => {
      const match = /^sun_hours_(spring|summer|autumn|winter|analysis)$/.exec(ref.name);
      return match ? { id: ref.name, label: labels[match[1]!] ?? ref.label ?? ref.name } : null;
    })
    .filter((option): option is TileLayerOption => option !== null)
    .sort((a, b) => (a.id === "sun_hours_winter" ? -1 : b.id === "sun_hours_winter" ? 1 : a.label.localeCompare(b.label, "ko")));
}

function filterS02Layer(model: MapModel | null, layerId: string): MapModel | null | undefined {
  if (!model || !layerId.startsWith("sun_hours_")) return undefined;
  const layered = model as RasterMapModel;
  const ref = (layered.rasterOptions ?? layered.rasters ?? []).find((candidate) => candidate.name === layerId);
  return ref ? { ...layered, rasters: [ref], defaultRaster: ref.name } as RasterMapModel : model;
}

export const s02ClientModule = {
  code: "S02",
  headline: { ids: ["mean_sun_h_winter"] },
  mapNote: "동지 기본 일조시간 · 계절 레이어 · 건물·지형 그림자 반영",
  caveat: "건물·지형 모델에 의한 기하학적 일조 추정입니다. 구름·실제 기상·창면 조건 및 법적 일조 판정을 포함하지 않습니다.",
  modelBadge: "그림자 추정 · 법적 판정 아님",
  view: applyS02View,
  layers: {
    options: rasterOptionsForResult,
    filter: filterS02Layer,
  },
} satisfies TileClientModule;
