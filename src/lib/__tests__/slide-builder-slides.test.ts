import { describe, it, expect } from "vitest";
import { buildSlides, type SlideBuildInput } from "@/lib/slide-builder";
import type { ChartElement, TableElement, TextElement } from "@/lib/slide-spec";
import { SUBWAY_STATIONS, SCHOOLS, PARKS, MOUNTAINS, APARTMENTS, DEFAULT_CONFIG } from "@/lib/seed-data";

const ALL_POIS = [...SUBWAY_STATIONS, ...SCHOOLS, ...PARKS, ...MOUNTAINS, ...APARTMENTS];

function makeInput(overrides: Partial<SlideBuildInput> = {}): SlideBuildInput {
  return {
    config: DEFAULT_CONFIG,
    pois: ALL_POIS,
    baseMapImage: "data:image/jpeg;base64,xxxx",
    poiPositions: ALL_POIS.map((poi, i) => ({ poi, nx: (i % 10) / 10 + 0.05, ny: ((i * 7) % 10) / 10 + 0.05 })),
    radiusPosition: { centerNx: 0.5, centerNy: 0.5, radiusNx: 0.3, radiusNy: 0.35 },
    routePositions: [{ line: "3호선", lineColor: "#EF7C1C", points: [{ nx: 0.1, ny: 0.1 }, { nx: 0.9, ny: 0.9 }] }],
    ...overrides,
  };
}

describe("buildSlides", () => {
  it("7장을 고정 순서/id로 만든다", () => {
    const slides = buildSlides(makeInput());
    expect(slides.map((s) => s.id)).toEqual(["cover", "overview", "subway", "school", "nature", "apartment", "summary"]);
  });

  it("표지: 센터명 대형 타이틀과 다크 스크림이 있다", () => {
    const cover = buildSlides(makeInput())[0];
    const texts = cover.elements.filter((e): e is TextElement => e.kind === "text");
    expect(texts.some((t) => t.text === DEFAULT_CONFIG.centerName && t.fontSizePt >= 40)).toBe(true);
    expect(texts.some((t) => t.text.includes("사이트 입지 분석 보고서"))).toBe(true);
    // 지표 요약 라인 (지하철·학교·분양 수)
    expect(texts.some((t) => t.text.includes("지하철") && t.text.includes("학교"))).toBe(true);
  });

  it("교통 슬라이드: KPI 칩과 역 목록 패널이 있다", () => {
    const subway = buildSlides(makeInput()).find((s) => s.id === "subway")!;
    const texts = subway.elements.filter((e): e is TextElement => e.kind === "text");
    expect(texts.some((t) => t.text.includes("호선"))).toBe(true); // 역 목록
    expect(texts.some((t) => t.text.includes("개소"))).toBe(true); // KPI
  });

  it("분양 슬라이드: 표와 네이티브 차트가 있다", () => {
    const apt = buildSlides(makeInput()).find((s) => s.id === "apartment")!;
    const table = apt.elements.find((e): e is TableElement => e.kind === "table");
    expect(table).toBeDefined();
    expect(table!.columns.map((c) => c.label)).toEqual(["단지명", "세대수", "평당가", "분양일"]);
    const chart = apt.elements.find((e): e is ChartElement => e.kind === "chart");
    expect(chart).toBeDefined();
    expect(chart!.categories.length).toBe(chart!.values.length);
    expect(chart!.categories.length).toBeGreaterThan(0);
  });

  it("카테고리 POI가 0건이면 '해당 시설 없음' 안내를 넣는다", () => {
    const noSchool = makeInput({
      pois: ALL_POIS.filter((p) => p.category !== "school"),
      poiPositions: [],
    });
    const school = buildSlides(noSchool).find((s) => s.id === "school")!;
    const texts = school.elements.filter((e): e is TextElement => e.kind === "text");
    expect(texts.some((t) => t.text.includes("반경 내 해당 시설 없음"))).toBe(true);
  });

  it("베이스맵이 없으면 모든 지도 슬라이드에 warning을 표시한다", () => {
    const slides = buildSlides(makeInput({ baseMapImage: "" }));
    const overview = slides.find((s) => s.id === "overview")!;
    expect(overview.warning).toBeTruthy();
  });

  it("요약 슬라이드: 평균 평당가 계산이 들어간다", () => {
    const summary = buildSlides(makeInput()).find((s) => s.id === "summary")!;
    const texts = summary.elements.filter((e): e is TextElement => e.kind === "text");
    const avg = Math.round(APARTMENTS.reduce((s, a) => s + a.price_per_pyeong, 0) / APARTMENTS.length);
    expect(texts.some((t) => t.text.includes(avg.toLocaleString()))).toBe(true);
  });
});
