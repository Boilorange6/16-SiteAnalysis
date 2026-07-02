import { describe, it, expect } from "vitest";
import { applyElement, type SlideLike } from "@/lib/ppt-generator";
import { SLIDE_W, SLIDE_H } from "@/lib/slide-spec";

type Call = { method: string; args: unknown[] };

function recorder(): { slide: SlideLike; calls: Call[] } {
  const calls: Call[] = [];
  const push = (method: string) => (...args: unknown[]) => { calls.push({ method, args }); };
  return {
    calls,
    slide: {
      addImage: push("addImage"),
      addShape: push("addShape"),
      addText: push("addText"),
      addTable: push("addTable"),
      addChart: push("addChart"),
    },
  };
}

describe("applyElement", () => {
  it("image: 정규화 좌표를 인치로 환산한다", () => {
    const { slide, calls } = recorder();
    applyElement(slide, { kind: "image", x: 0, y: 0, w: 1, h: 1, dataUrl: "data:image/jpeg;base64,x" }, "bar");
    const opts = calls[0].args[0] as Record<string, number>;
    expect(calls[0].method).toBe("addImage");
    expect(opts.w).toBeCloseTo(SLIDE_W);
    expect(opts.h).toBeCloseTo(SLIDE_H);
  });

  it("rect: alpha를 pptxgenjs transparency(0~100)로 변환하고 #을 제거한다", () => {
    const { slide, calls } = recorder();
    applyElement(slide, { kind: "rect", x: 0.1, y: 0.1, w: 0.5, h: 0.2, fill: { color: "#F8FAFC", alpha: 0.92 }, radiusIn: 0.06, shadow: true }, "bar");
    expect(calls[0].method).toBe("addShape");
    expect(calls[0].args[0]).toBe("roundRect");
    const opts = calls[0].args[1] as { fill: { color: string; transparency: number }; rectRadius: number };
    expect(opts.fill.color).toBe("F8FAFC");
    expect(opts.fill.transparency).toBeCloseTo(8);
    expect(opts.rectRadius).toBeCloseTo(0.06);
  });

  it("ellipse: 중심/반지름을 x,y,w,h 바운딩박스로 변환한다", () => {
    const { slide, calls } = recorder();
    applyElement(slide, { kind: "ellipse", cx: 0.5, cy: 0.5, rx: 0.1, ry: 0.2, fill: { color: "#3B82F6" } }, "bar");
    const opts = calls[0].args[1] as Record<string, number>;
    expect(opts.x).toBeCloseTo(0.4 * SLIDE_W);
    expect(opts.y).toBeCloseTo(0.3 * SLIDE_H);
    expect(opts.w).toBeCloseTo(0.2 * SLIDE_W);
    expect(opts.h).toBeCloseTo(0.4 * SLIDE_H);
  });

  it("line: flipV를 방향에 따라 설정한다", () => {
    const { slide, calls } = recorder();
    // 오른쪽 위로 가는 선 → flipV true
    applyElement(slide, { kind: "line", x1: 0.1, y1: 0.5, x2: 0.4, y2: 0.2, stroke: { color: "#EF7C1C", widthPt: 3 } }, "bar");
    const opts = calls[0].args[1] as { flipV: boolean };
    expect(opts.flipV).toBe(true);
  });

  it("text: pt·자간·정렬·배경 fill을 매핑한다", () => {
    const { slide, calls } = recorder();
    applyElement(slide, { kind: "text", x: 0, y: 0, w: 0.3, h: 0.05, text: "교통 분석", fontSizePt: 24, color: "#1E3A8A", bold: true, charSpacingPt: 2, align: "left" }, "bar");
    const opts = calls[0].args[1] as Record<string, unknown>;
    expect(calls[0].args[0]).toBe("교통 분석");
    expect(opts.fontSize).toBe(24);
    expect(opts.color).toBe("1E3A8A");
    expect(opts.charSpacing).toBe(2);
    expect(opts.fontFace).toBe("Noto Sans KR");
  });

  it("table: 헤더 행 + zebra 행 스타일을 만든다", () => {
    const { slide, calls } = recorder();
    applyElement(slide, {
      kind: "table", x: 0.05, y: 0.4, w: 0.4,
      columns: [{ label: "단지명", wFrac: 0.6 }, { label: "세대수", wFrac: 0.4, align: "right" }],
      rows: [["A단지", "1,000"], ["B단지", "2,000"]],
      fontSizePt: 9, rowHIn: 0.26, headerFill: "#1E3A8A", headerColor: "#FFFFFF", zebraFill: "#F1F5F9",
    }, "bar");
    expect(calls[0].method).toBe("addTable");
    const rows = calls[0].args[0] as { text: string; options: { fill?: { color: string } } }[][];
    expect(rows).toHaveLength(3); // 헤더 + 2행
    expect(rows[0][0].options.fill?.color).toBe("1E3A8A");
    expect(rows[2][0].options.fill?.color).toBe("F1F5F9"); // zebra는 두 번째 데이터 행
    const opts = calls[0].args[1] as { colW: number[] };
    expect(opts.colW[0]).toBeCloseTo(0.4 * SLIDE_W * 0.6);
  });

  it("chart: 카테고리/값과 색을 네이티브 차트 데이터로 매핑한다", () => {
    const { slide, calls } = recorder();
    applyElement(slide, {
      kind: "chart", x: 0.05, y: 0.7, w: 0.4, h: 0.2,
      title: "평당가", categories: ["A", "B"], values: [3000, 2500], color: "#3B82F6",
    }, "BAR_TYPE_TOKEN");
    expect(calls[0].method).toBe("addChart");
    expect(calls[0].args[0]).toBe("BAR_TYPE_TOKEN");
    const data = calls[0].args[1] as { labels: string[]; values: number[] }[];
    expect(data[0].labels).toEqual(["A", "B"]);
    expect(data[0].values).toEqual([3000, 2500]);
  });
});
