import { describe, it, expect } from "vitest";
import {
  buildHeader, buildKpiChips, buildFooter, buildLegend, buildMapLayer, TOKENS,
  type SlideBuildInput,
} from "@/lib/slide-builder";
import type { TextElement, RectElement, EllipseElement, ImageElement } from "@/lib/slide-spec";

const CONFIG = { centerName: "청와대", centerLat: 37.5866, centerLng: 126.9748, radiusKm: 2 };

function makeInput(overrides: Partial<SlideBuildInput> = {}): SlideBuildInput {
  return {
    config: CONFIG,
    pois: [],
    baseMapImage: "data:image/jpeg;base64,xxxx",
    poiPositions: [],
    radiusPosition: { centerNx: 0.5, centerNy: 0.5, radiusNx: 0.3, radiusNy: 0.35 },
    routePositions: [],
    ...overrides,
  };
}

describe("buildHeader", () => {
  it("인덱스 라벨·제목·기준정보 텍스트와 카드 배경, 액센트 바를 만든다", () => {
    const els = buildHeader("02", "교통 분석", CONFIG);
    const texts = els.filter((e): e is TextElement => e.kind === "text");
    expect(texts.some((t) => t.text.includes("SITE ANALYSIS") && t.text.includes("02"))).toBe(true);
    expect(texts.some((t) => t.text === "교통 분석" && t.color === TOKENS.navy && t.bold)).toBe(true);
    expect(texts.some((t) => t.text.includes("기준반경 2km"))).toBe(true);
    const rects = els.filter((e): e is RectElement => e.kind === "rect");
    expect(rects.length).toBeGreaterThanOrEqual(2); // 카드 + 액센트 바
  });
});

describe("buildKpiChips", () => {
  it("칩마다 배경 rect 1개 + 값/라벨 텍스트를 만든다", () => {
    const els = buildKpiChips([
      { value: "4개소", label: "지하철역" },
      { value: "800m", label: "최근접역" },
    ]);
    expect(els.filter((e) => e.kind === "rect")).toHaveLength(2);
    const texts = els.filter((e): e is TextElement => e.kind === "text");
    expect(texts.some((t) => t.text === "4개소")).toBe(true);
    expect(texts.some((t) => t.text === "지하철역")).toBe(true);
  });
});

describe("buildFooter", () => {
  it("출처와 페이지 번호(02 / 07)를 만든다", () => {
    const els = buildFooter(2, 7);
    const texts = els.filter((e): e is TextElement => e.kind === "text");
    expect(texts.some((t) => t.text.includes("공공데이터포털"))).toBe(true);
    expect(texts.some((t) => t.text === "02 / 07")).toBe(true);
  });
});

describe("buildLegend", () => {
  it("카테고리 수만큼 도트와 라벨을 만든다", () => {
    const els = buildLegend(["subway", "school"]);
    expect(els.filter((e) => e.kind === "ellipse")).toHaveLength(2);
    const texts = els.filter((e): e is TextElement => e.kind === "text");
    expect(texts.some((t) => t.text === "지하철역")).toBe(true);
    expect(texts.some((t) => t.text === "학교")).toBe(true);
  });
});

describe("buildMapLayer", () => {
  it("베이스맵 이미지는 풀블리드, 반경 원과 중심점을 그린다", () => {
    const els = buildMapLayer(makeInput(), { categories: [], showLabels: false });
    const img = els.find((e): e is ImageElement => e.kind === "image");
    expect(img).toMatchObject({ x: 0, y: 0, w: 1, h: 1 });
    const ellipses = els.filter((e): e is EllipseElement => e.kind === "ellipse");
    expect(ellipses.length).toBeGreaterThanOrEqual(2); // 반경 원 + 중심점
  });

  it("베이스맵이 없으면 이미지 대신 플레이스홀더 rect를 그린다", () => {
    const els = buildMapLayer(makeInput({ baseMapImage: "" }), { categories: [], showLabels: false });
    expect(els.find((e) => e.kind === "image")).toBeUndefined();
    const rect = els.find((e): e is RectElement => e.kind === "rect");
    expect(rect).toMatchObject({ x: 0, y: 0, w: 1, h: 1 });
  });

  it("카테고리 필터에 맞는 마커만 그리고, 라벨 표시 시 텍스트를 추가한다", () => {
    const subway = { id: "s1", name: "안국역", lat: 0, lng: 0, category: "subway" as const, line: "3호선", lineColor: "#EF7C1C" };
    const school = { id: "sc1", name: "재동초", lat: 0, lng: 0, category: "school" as const, level: "elementary" as const };
    const input = makeInput({
      poiPositions: [
        { poi: subway, nx: 0.4, ny: 0.4 },
        { poi: school, nx: 0.6, ny: 0.6 },
      ],
    });
    const els = buildMapLayer(input, { categories: ["subway"], showLabels: true });
    const markerFills = els
      .filter((e): e is EllipseElement => e.kind === "ellipse")
      .map((e) => e.fill.color);
    expect(markerFills).toContain("#EF7C1C"); // 지하철은 노선 색
    const texts = els.filter((e): e is TextElement => e.kind === "text");
    expect(texts.some((t) => t.text === "안국역")).toBe(true);
    expect(texts.some((t) => t.text === "재동초")).toBe(false); // school 제외됨
  });

  it("showRoutes면 노선 세그먼트 line을 그린다", () => {
    const input = makeInput({
      routePositions: [
        { line: "3호선", lineColor: "#EF7C1C", points: [{ nx: 0.1, ny: 0.1 }, { nx: 0.2, ny: 0.2 }, { nx: 0.3, ny: 0.25 }] },
      ],
    });
    const els = buildMapLayer(input, { categories: ["subway"], showLabels: false, showRoutes: true });
    const lines = els.filter((e) => e.kind === "line");
    expect(lines).toHaveLength(2); // 점 3개 = 세그먼트 2개
  });
});
