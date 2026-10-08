import type { EngineContext } from "../engine/context";
import type { MergeOptions } from "../engine/tiles/merge";
import type { MapModel } from "../ui/map-layers";
import type { MassModel } from "../ui/mass-projection";
import type { TileView } from "../ui/tile-view";
import type { RoseModel } from "../ui/wind-rose";
import type { RasterRef, RoseSeason, TileResult } from "../tile-result";

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

export type TileLayerOption = { id: string; label: string };

export type TileLayerOptions = readonly TileLayerOption[] | ((result: TileResult) => readonly TileLayerOption[]);

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
  /** 카드에 표시할 모델·법적 사용 한계 문구다. */
  caveat?: string;
  /** 카드 배지에 표시할 계산 모델 요약이다. */
  modelBadge?: string;
  /** 공용 TileView를 타일 고유 표시 규칙으로 보정한다. */
  view?: (base: TileView, result?: TileResult) => TileView;
  /** 타일이 소유한 보드 레이어 선택지와 레이어 필터다. */
  layers?: TileClientLayers;
  /** 타일의 저장 컷·후보·보고서 조판 동작이다. */
  cut?: TileCutModule;
}
