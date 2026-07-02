import { describe, it, expect } from "vitest";
import { SLIDE_W, SLIDE_H, PX_W, PX_H, ptToPx, inToPx } from "@/lib/slide-spec";

describe("slide-spec 좌표 체계", () => {
  it("슬라이드 크기는 16:9 와이드(13.333×7.5in), 논리 캔버스는 1280×720px", () => {
    expect(SLIDE_W).toBeCloseTo(13.333, 3);
    expect(SLIDE_H).toBe(7.5);
    expect(PX_W).toBe(1280);
    expect(PX_H).toBe(720);
  });

  it("1pt = 96/72px", () => {
    expect(ptToPx(12)).toBeCloseTo(16);
    expect(ptToPx(30)).toBeCloseTo(40);
  });

  it("1in = 96px", () => {
    expect(inToPx(0.08)).toBeCloseTo(7.68);
  });
});
