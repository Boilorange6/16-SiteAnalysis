import { toLngLat, type LngLat } from "../crs";
import type { GreenKind, Scene } from "../scene";
import { publicRailLine, railLineColor } from "../tile/rail-presentation";
import type { BasemapChoice } from "./map-projection";

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
  const base: MapBase = {
    buildings: scene.buildings.map((building) => rings(building.rings)),
    parcels: scene.parcels.map((parcel) => rings(parcel.rings)),
    water: (context?.water ?? []).map(rings),
    // 분류가 없는 옛 장면의 녹지는 공원으로 본다.
    green: green.map((list, index) => ({ kind: context?.greenKinds?.[index] ?? "park", rings: rings(list) })),
    roads: (context?.roads ?? []).map((road) => ({ hierarchy: road.hierarchy, widthM: road.widthM, name: road.name ?? null, points: road.points.map(ll) })),
    // A01 타일과 같은 공식 노선색으로 맞추고, 셔틀 등 비공용 노선은 뺀다.
    rail: (context?.rail ?? [])
      .filter((line) => publicRailLine(line.lineRef, line.name))
      .map((line) => ({ color: railLineColor(line.lineRef, line.name), points: line.points.map(ll) })),
    stations: (context?.stations ?? []).map((station) => ({ name: station.name, p: ll([station.x, station.y]), color: station.color })),
    places: (context?.places ?? []).map((place) => ({ name: place.name, kind: place.kind, p: ll([place.x, place.y]) })),
  };
  memo.set(scene, base);
  return base;
}

/** 도로 맥락이 하나라도 있어야 벡터 바탕으로 쓴다. 맥락 없이 건물·필지만 그리면 깨져 보인다. */
export const baseUsable = (base: MapBase | null | undefined): base is MapBase => !!base && base.roads.length > 0;

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
