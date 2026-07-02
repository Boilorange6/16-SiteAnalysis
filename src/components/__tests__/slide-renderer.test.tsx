import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import SlideRenderer from "@/components/slide-renderer";
import type { SlideSpec } from "@/lib/slide-spec";

const SPEC: SlideSpec = {
  id: "t",
  title: "테스트",
  elements: [
    { kind: "rect", x: 0.1, y: 0.2, w: 0.5, h: 0.3, fill: { color: "#F8FAFC", alpha: 0.92 }, radiusIn: 0.06 },
    { kind: "text", x: 0.1, y: 0.2, w: 0.5, h: 0.1, text: "교통 분석", fontSizePt: 24, color: "#1E3A8A", bold: true },
    { kind: "ellipse", cx: 0.5, cy: 0.5, rx: 0.01, ry: 0.0178, fill: { color: "#EF7C1C" } },
    { kind: "line", x1: 0.1, y1: 0.1, x2: 0.4, y2: 0.3, stroke: { color: "#EF7C1C", widthPt: 3 } },
    {
      kind: "table", x: 0.05, y: 0.5, w: 0.4,
      columns: [{ label: "단지명", wFrac: 0.6 }, { label: "세대수", wFrac: 0.4, align: "right" }],
      rows: [["A단지", "1,000"]],
      fontSizePt: 9, rowHIn: 0.26, headerFill: "#1E3A8A", headerColor: "#FFFFFF",
    },
    { kind: "chart", x: 0.05, y: 0.7, w: 0.4, h: 0.2, title: "평당가", categories: ["A", "B"], values: [3000, 1500], color: "#3B82F6" },
  ],
};

describe("SlideRenderer", () => {
  it("텍스트를 pt→px 환산 크기로 렌더한다 (24pt = 32px)", () => {
    const { getByText } = render(<SlideRenderer spec={SPEC} width={640} />);
    const el = getByText("교통 분석");
    expect(el.style.fontSize).toBe("32px");
    expect(el.style.left).toBe("128px"); // 0.1 × 1280
  });

  it("표 헤더와 데이터 셀을 렌더한다", () => {
    const { getByText } = render(<SlideRenderer spec={SPEC} width={640} />);
    expect(getByText("단지명")).toBeTruthy();
    expect(getByText("A단지")).toBeTruthy();
  });

  it("차트 막대를 값 비례 높이로 렌더한다", () => {
    const { getByTestId } = render(<SlideRenderer spec={SPEC} width={640} />);
    const barA = getByTestId("chart-bar-0");
    const barB = getByTestId("chart-bar-1");
    expect(parseFloat(barB.style.height) / parseFloat(barA.style.height)).toBeCloseTo(0.5, 1);
  });

  it("스케일 래퍼가 width에 맞게 transform scale된다", () => {
    const { getByTestId } = render(<SlideRenderer spec={SPEC} width={640} />);
    expect(getByTestId("slide-canvas").style.transform).toBe("scale(0.5)");
  });
});
