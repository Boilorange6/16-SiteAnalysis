import { toLngLat, type LngLat } from "../crs";
import { isPreBasemapScene, type GreenKind, type Scene } from "../scene";
import { publicRailLine, railLineColor } from "../tile/rail-presentation";
import type { MapFrameState } from "../report/report-doc";
import type { BasemapChoice } from "./map-projection";
import { mergeOverlapping } from "./poly-overlap";

/** 벡터 바탕이 그리는 층. 묶음(`MapSceneBaseBucket.layer`)과 타일별 생략(`BASE_SUPPRESS`)이 같은 이름을 쓴다. */
export type BaseLayerKind = "water" | "green" | "parcel" | "road" | "rail" | "building" | "station";

/** 분석 장면(`Scene`)을 WGS84로 옮긴 바탕지도 자료. 카드·펼침·보고서가 같은 객체를 공유한다. */
export type MapBase = {
  buildings: LngLat[][][];
  parcels: LngLat[][][];
  water: LngLat[][][];
  green: { kind: GreenKind; rings: LngLat[][] }[];
  roads: { hierarchy: string; widthM: number; name: string | null; points: LngLat[] }[];
  rail: { color: string; points: LngLat[] }[];
  stations: { name: string; p: LngLat; color: string }[];
  places: { name: string; kind: "dong" | "park"; p: LngLat }[];
  /**
   * 벡터 바탕으로 쓰면 안 되는 장면. legacy = 1단계 이전 장면(이름·철도·녹지 분류 없음),
   * truncated = 건물·필지가 장면 상한에 잘려 바깥 고리가 빈다. 없으면 쓸 수 있음.
   */
  flaw?: "legacy" | "truncated";
};

/** 타일이 같은 내용을 주제 레이어로 직접 그리는 경우 바탕에서는 뺀다. */
export const BASE_SUPPRESS: Readonly<Record<string, readonly BaseLayerKind[]>> = {
  A01: ["rail", "station"],
  A10: ["rail", "station"],
  D13: ["road"],
  D19: ["parcel"],
};

const memo = new WeakMap<Scene, MapBase>();

/** 같은 scene 객체는 같은 결과 객체를 돌려준다(33개 타일이 한 번만 변환). */
export function mapBaseFromScene(scene: Scene): MapBase {
  const cached = memo.get(scene);
  if (cached) return cached;
  const { x: ox, y: oy } = scene.origin;
  const ll = ([x, y]: readonly [number, number]): LngLat => toLngLat([x + ox, y + oy]);
  const rings = (list: readonly (readonly (readonly [number, number])[])[]): LngLat[][] => list.map((ring) => ring.map(ll));
  const context = scene.context;
  const green = context?.green ?? [];
  // 층마다 겹친 면을 합친다(층당 경로 하나를 even-odd로 칠하면 겹친 곳이 구멍이 된다). 바탕 지물은 선택·라벨 대상이 아니라 합쳐도 잃는 것이 없다.
  // 분류가 없는 옛 장면의 녹지는 공원으로 본다. 과수원은 화면에서 잔디와 같은 층으로 그리므로 잔디로 묶는다.
  const greenByKind = new Map<GreenKind, (typeof green)[number][]>();
  green.forEach((list, index) => {
    const kind = context?.greenKinds?.[index] ?? "park";
    const key = kind === "orchard" ? "grass" : kind;
    greenByKind.set(key, [...(greenByKind.get(key) ?? []), list]);
  });
  const base: MapBase = {
    buildings: mergeOverlapping(scene.buildings.map((building) => building.rings)).map(rings),
    parcels: scene.parcels.map((parcel) => rings(parcel.rings)),
    water: mergeOverlapping(context?.water ?? []).map(rings),
    green: [...greenByKind].flatMap(([kind, lists]) => mergeOverlapping(lists).map((list) => ({ kind, rings: rings(list) }))),
    roads: (context?.roads ?? []).map((road) => ({ hierarchy: road.hierarchy, widthM: road.widthM, name: road.name ?? null, points: road.points.map(ll) })),
    // A01 타일과 같은 공식 노선색으로 맞추고, 셔틀 등 비공용 노선은 뺀다.
    rail: (context?.rail ?? [])
      .filter((line) => publicRailLine(line.lineRef, line.name))
      .map((line) => ({ color: railLineColor(line.lineRef, line.name), points: line.points.map(ll) })),
    stations: (context?.stations ?? []).map((station) => ({ name: station.name, p: ll([station.x, station.y]), color: station.color })),
    places: (context?.places ?? []).map((place) => ({ name: place.name, kind: place.kind, p: ll([place.x, place.y]) })),
  };
  const { buildingsTotal, buildingsIncluded, parcelsTotal, parcelsIncluded } = scene.counts;
  if (isPreBasemapScene(scene)) base.flaw = "legacy";
  else if (buildingsTotal > buildingsIncluded || parcelsTotal > parcelsIncluded) base.flaw = "truncated";
  memo.set(scene, base);
  return base;
}

/**
 * 도로 맥락이 하나라도 있어야 벡터 바탕으로 쓴다. 맥락 없이 건물·필지만 그리면 깨져 보인다.
 * 1단계 이전 장면(이름·철도 없음)과 상한에 잘린 장면(바깥 고리가 빔)도 쓰지 않고 일반지도로 돌아간다.
 */
export const baseUsable = (base: MapBase | null | undefined): base is MapBase => !!base && base.roads.length > 0 && !base.flaw;

/**
 * 「기본 지도」를 쓸 수 없는 이유를 사용자 말로. 쓸 수 있으면 null.
 * refreshable: 지금 새로고침 띠가 보일 때만 새로고침을 권한다(낡은 타일이 없으면 새로고침이 장면을 다시 만들지 않는다).
 */
export function basemapUnavailableText(base: MapBase | null | undefined, refreshable = false): string | null {
  const flaw = base?.flaw;
  if (flaw === "legacy") return refreshable ? "새로고침하면 기본 지도를 쓸 수 있습니다" : "예전 분석이라 기본 지도 자료가 없습니다";
  if (flaw === "truncated") return "반경이 넓어 기본 지도를 그리지 않습니다";
  return baseUsable(base) ? null : "이 분석에는 기본 지도 자료가 없습니다";
}

/**
 * 바탕 결정: 결과가 지정한 바탕(D01·D10 위성) > 사용자가 고른 바탕 > 쓸 수 있는 바탕 자료가 있으면 벡터 > 일반지도.
 * 벡터를 골랐어도 바탕 자료가 없거나 도로 맥락이 없는 분석은 일반지도로 돌아간다.
 */
export function resolveBasemap(model: { basemap?: BasemapChoice; base?: MapBase | null }, chosen?: BasemapChoice): BasemapChoice {
  if (model.basemap) return model.basemap;
  const usable = baseUsable(model.base);
  if (chosen && (chosen !== "vector" || usable)) return chosen;
  return usable ? "vector" : "white";
}

/**
 * 보고서 지도 프레임의 배경 선택 -> 실제 바탕. 화면(SlideSurface)과 PPT·그림이 같은 함수를 쓴다.
 * 결과가 지정한 바탕(model.basemap, D01·D10 위성)이 프레임 선택보다 먼저다(`resolveBasemap`과 같은 규칙).
 * "base"는 쓸 수 있는 바탕 자료가 있으면 벡터, 없으면 VWorld 기본 지도.
 */
export function frameBasemap(frame: { basemap: MapFrameState["basemap"] }, model: { basemap?: BasemapChoice; base?: MapBase | null }): BasemapChoice {
  if (model.basemap) return model.basemap;
  if (frame.basemap === "air") return "Satellite";
  if (frame.basemap === "none") return "white";
  if (frame.basemap === "base" && baseUsable(model.base)) return "vector";
  return "Base";
}

/** 내보내기(PPT·그림)의 바탕: 결과 지정 > (프레임이 있으면 프레임 선택, 없으면 보드 선택) > 벡터 > 일반지도. */
export const exportBasemap = (model: { basemap?: BasemapChoice; base?: MapBase | null }, chosen?: BasemapChoice, frame?: { basemap: MapFrameState["basemap"] }): BasemapChoice =>
  frame ? frameBasemap(frame, model) : resolveBasemap(model, chosen);
