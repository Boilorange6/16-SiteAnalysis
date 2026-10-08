import type { EngineContext } from "../engine/context";
import type { MergeOptions } from "../engine/tiles/merge";
import type { A05Counts } from "../engine/a05-filter";
import type { CalloutMode } from "../ui/callout-layout";
import type { MapModel } from "../ui/map-layers";
import type { MassModel } from "../ui/mass-projection";
import type { Badge, CalloutModel, TileView } from "../ui/tile-view";
import type { RoseModel } from "../ui/wind-rose";
import type { RasterRef, RoseSeason, TileResult } from "../tile-result";
import type { TileReportHook } from "../report/types";

export type TileCompute = (ctx: EngineContext) => TileResult;

export interface TileServerModule {
  code: string;
  compute: TileCompute;
  absorbs?: readonly string[];
  mergeOptions?: MergeOptions;
}

export type TileHeadlinePolicy = {
  ids?: readonly string[];
  maxPrefix?: string;
};

export type Metric = TileResult["metrics"][number];

export type TileHeadlineHelpers = {
  policyMetric: () => Metric | null;
  metricRow: (metric: Metric) => { value: string; label: string; aux?: string; tag?: string };
};

export type TileLayerOption = { id: string; label: string };

export type TileLayerOptions = readonly TileLayerOption[] | ((result: TileResult) => readonly TileLayerOption[]);

/** 타일 결과를 화면용 파생 결과로 바꾸는 타일 소유 전처리 계약이다. */
export type TileViewPreparation = {
  result: TileResult;
  filterChip?: string | null;
  filterLine?: string | null;
  /** 현재는 A05 재집계 패널의 필드별 건수이며, 저장 결과에는 포함되지 않는다. */
  a05Counts?: A05Counts | null;
};

export type TileClientViewContext = { filter?: unknown };

/** 타일 고유 보드 기본값. 저장본의 필드·직렬화 형식은 board-state가 계속 소유한다. */
export type TileBoardModule = {
  size?: (result: TileResult) => 1 | 2 | 4;
  callout?: (result: TileResult) => CalloutMode;
};

export type TileClientLayers = {
  /** 타일이 보드 레이어 선택지(정적 또는 결과 기반)를 제공한다. */
  options: TileLayerOptions;
  /** 기본 보기에서 타일 모듈이 숨길 흡수 레이어 id다. */
  baseExcludes?: readonly string[];
  /** 타일 고유 레이어 id를 처리하며, 미처리 시 undefined를 반환한다. */
  filter?: (model: MapModel | null, layerId: string) => MapModel | null | undefined;
};

export type TileCutCandidate = { cut: object; label: string; disabled: boolean };

export type TileCutCell = {
  view: TileView;
  mapKey: string;
  rasterName?: string;
  rose?: RoseModel;
  roseSeason?: RoseSeason;
};

export type TileCutPlan = {
  sheets: Array<{ grid: "2x2" | "3x2" | "3x1"; cells: TileCutCell[] }>;
  single?: TileCutCell & { mass?: MassModel };
};

export type TileCutModule = {
  /** 저장 보드에 새로 쓸 타일의 기본 컷을 만든다. */
  default?: () => unknown;
  /** 저장·액션 입력이 이 타일의 컷 직렬화 형태인지 검사한다. */
  isValid?: (value: unknown) => boolean;
  /** 구버전 숫자 컷을 현재 타일 컷으로 승격하며, 없으면 null이다. */
  legacyForCount?: (value: 1 | 3) => unknown | null;
  /** 계산 결과에 컷을 그릴 수 있는지 판정한다. */
  ready?: (view: TileView, cut: unknown) => boolean;
  /** 보드의 컷 선택지 후보를 만든다. */
  candidates?: (view: TileView, current?: unknown) => readonly TileCutCandidate[];
  /** 컷의 화면·보고서용 짧은 메모를 만든다. */
  note?: (cut: unknown, rasterName?: string) => string | undefined;
  /** 컷을 대표하는 첫 래스터 이름을 선택한다. */
  firstRaster?: (view: TileView, cut: unknown) => string | null;
  /** 컷 선택을 반영한 파생 TileView를 만든다. */
  view?: (view: TileView, cut: unknown) => TileView;
  /** 컷이 지도 표현을 직접 소유하는지 판정한다. */
  ownsRaster?: (view: TileView, cut: unknown) => boolean;
  /** 보드 장수 계산에 필요한 타일 고유 컷 장수를 계산한다. */
  pages?: (result: TileResult, cut: unknown) => number;
  /** 보고서 컷 조판을 만든다. */
  plan?: (view: TileView, cut: unknown) => TileCutPlan;
};

export interface TileClientModule {
  code: string;
  /** 카드 헤드라인으로 우선 선택할 결과 지표 정책이다. */
  headline?: TileHeadlinePolicy;
  /** 지도 아래에 표시할 타일 고유 설명이다. */
  mapNote?: string;
  /** 결과 지표 조건에 따라 지도 메모 뒤에 덧붙일 문장들(예: 자료 누락 안내). */
  mapNotesFor?: (result: TileResult) => readonly string[];
  /** 설정값·보조 지표를 배지로 보여 줄 지표 목록(값은 공용 metricRow 서식). */
  parameterBadges?: readonly { metricId: string; prefix: string; note: string }[];
  /** 공용 정책 대신 헤드라인을 직접 정한다. null이면 공용 정책(headline 필드)으로 넘어간다. */
  headlineFor?: (result: TileResult, helpers: TileHeadlineHelpers) => { headline: NonNullable<TileView["headline"]>; metricId: string } | null;
  /** 헤드라인이 대신 보여 주므로 행 목록에서 뺄 지표 id. */
  rowsExclude?: readonly string[];
  /** 캐시된 옛 판단 문장을 현재 표기와 맞춘다(필터 꼬리표 붙이기 전). */
  sentenceFor?: (result: TileResult, sentence: string, rows: readonly { label: string; value: string }[]) => string;
  /** 카드에 표시할 모델·법적 사용 한계 문구다. */
  caveat?: string;
  /** 카드 배지에 표시할 계산 모델 요약이다. */
  modelBadge?: string;
  /** 결과를 화면에 투영하기 전에 타일 고유 필터·파생 결과를 만든다. */
  prepare?: (result: TileResult, context: TileClientViewContext) => TileViewPreparation;
  /** 공용 행·헤드라인 계산 전에 남길 지표를 고른다. */
  metricFilter?: (metric: TileResult["metrics"][number]) => boolean;
  /** 제한사항을 읽어 타일 고유 배지를 추가한다. */
  limitationBadges?: (limitation: TileResult["limitations"][number]) => readonly Badge[];
  /** 타일 고유 설명선 모델을 만든다. */
  callout?: (result: TileResult, sourceLine: string, filterLine?: string | null) => CalloutModel | null;
  /** 공용 TileView를 타일 고유 표시 규칙으로 보정한다. */
  view?: (base: TileView, result?: TileResult) => TileView;
  /** 타일이 소유한 보드 레이어 선택지와 레이어 필터다. */
  layers?: TileClientLayers;
  /** 저장하지 않는 보드 초기 기본값을 제공한다. */
  board?: TileBoardModule;
  /** 타일의 저장 컷·후보·보고서 조판 동작이다. */
  cut?: TileCutModule;
}

/** 보고서 전용 레지스트리(tile/report.ts) 항목 — pptxgenjs가 클라이언트 그래프에 들어가지 않게 TileClientModule과 분리한다. */
export interface TileReportModule {
  code: string;
  /** 타일 고유 PPT 장 조판 훅이다. */
  report: TileReportHook;
}
