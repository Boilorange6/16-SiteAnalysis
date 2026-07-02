# PPT 내보내기 미리보기 (공유 슬라이드 모델) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PPT 내보내기 전에 슬라이드를 HTML로 미리보고(포함/제외 선택), 같은 데이터 모델(SlideSpec)로 지도만 이미지·나머지 전부 네이티브 요소인 .pptx를 생성한다.

**Architecture:** 슬라이드를 `SlideSpec` 데이터로 정의하는 단일 소스 구조. `slide-builder.ts`가 분석 데이터로 SlideSpec 7장을 만들고, `slide-renderer.tsx`(HTML)와 `ppt-generator.ts`(pptxgenjs 매퍼)가 같은 spec을 각자 그린다. 좌표는 0~1 정규화 값 — HTML은 1280×720 논리 캔버스(13.333in×96dpi)에 렌더 후 CSS scale, PPT는 13.333×7.5인치로 환산.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind 4, pptxgenjs 3.12, vitest(신규, 단위 테스트), @testing-library/react + jsdom(신규, 컴포넌트 테스트), adm-zip(신규, pptx XML 검증)

## Global Constraints

- 스펙 문서: `docs/superpowers/specs/2026-07-02-ppt-export-preview-design.md`
- 디자인은 PPT 표현 가능 부분집합만: 투명도 있는 단색 채움, 그림자, 둥근 모서리, 실선/점선. CSS 그라데이션·backdrop-blur 금지 (미리보기에도 사용 금지)
- PPT에서 이미지는 슬라이드당 베이스맵 1장만. 텍스트·도형·표·차트는 전부 네이티브
- 폰트: `Noto Sans KR` (PPT `fontFace`와 HTML `font-family` 동일)
- 슬라이드 7장 고정: 표지 / 입지 현황 종합 / 교통 / 교육 / 자연 / 분양 현황 / 종합 시사점
- 색상 토큰: NAVY `#1E3A8A`, BLUE `#3B82F6`, INK `#0F172A`, BODY `#334155`, SUB `#64748B`, LIGHT `#F8FAFC`, LINE `#E2E8F0`
- 좌표는 항상 0~1 정규화(슬라이드 비율 기준). 크기 단위: fontSize=pt, 테두리 두께=pt, rectRadius=인치
- 커밋 메시지 끝에 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` 포함 (기존 관례)
- 테스트 실행: `npx vitest run` (watch 금지)

## File Structure

| 파일 | 작업 | 책임 |
|---|---|---|
| `src/lib/slide-spec.ts` | 생성 | SlideSpec/SlideElement 타입, 상수, 좌표 변환 헬퍼 |
| `src/lib/slide-builder.ts` | 생성 | 분석 데이터 → SlideSpec 7장 (모든 디자인 결정) |
| `src/lib/ppt-generator.ts` | 재작성 | SlideSpec → pptxgenjs 범용 매퍼 |
| `src/lib/types.ts` | 수정 | `RouteNormalizedPosition` 이동 |
| `src/components/slide-renderer.tsx` | 생성 | SlideSpec 1장 → HTML (썸네일/대형 공용) |
| `src/components/export-preview.tsx` | 생성 | 미리보기 모달 (썸네일 레일·선택·다운로드) |
| `src/components/site-analysis-app.tsx` | 수정 | 내보내기 → 모달 열기로 변경 |
| `src/app/layout.tsx` | 수정 | Noto Sans KR 폰트 로드 |
| `vitest.config.ts` | 생성 | 테스트 설정 |

---

### Task 1: 테스트 인프라 + SlideSpec 타입/헬퍼

**Files:**
- Create: `vitest.config.ts`
- Create: `src/lib/slide-spec.ts`
- Modify: `src/lib/types.ts` (RouteNormalizedPosition 추가)
- Modify: `package.json` (scripts.test, devDependencies)
- Test: `src/lib/__tests__/slide-spec.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: 아래 타입 전부 + `SLIDE_W=13.333`, `SLIDE_H=7.5`, `PX_W=1280`, `PX_H=720`, `ptToPx(pt): number`, `inToPx(inches): number`. `types.ts`에 `RouteNormalizedPosition` 추가.

- [ ] **Step 1: 의존성 설치**

```powershell
npm install -D vitest @testing-library/react @testing-library/user-event jsdom adm-zip @types/adm-zip
```

- [ ] **Step 2: vitest.config.ts 작성 + test 스크립트 추가**

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "jsdom",
  },
});
```

`package.json` scripts에 추가: `"test": "vitest run"`

- [ ] **Step 3: types.ts에 RouteNormalizedPosition 추가**

`src/lib/types.ts` 끝에 추가 (현재 `ppt-generator.ts`에 있는 것을 이동 — Task 4에서 원본 제거):

```ts
export interface RouteNormalizedPosition {
  readonly line: string;
  readonly lineColor: string;
  readonly points: readonly { readonly nx: number; readonly ny: number }[];
}
```

- [ ] **Step 4: 실패하는 테스트 작성**

```ts
// src/lib/__tests__/slide-spec.test.ts
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
```

- [ ] **Step 5: 테스트 실패 확인**

Run: `npx vitest run src/lib/__tests__/slide-spec.test.ts`
Expected: FAIL — `Cannot find module '@/lib/slide-spec'`

- [ ] **Step 6: slide-spec.ts 구현**

```ts
// src/lib/slide-spec.ts
// SlideSpec: HTML 미리보기와 PPT 내보내기가 공유하는 슬라이드 정의.
// 좌표(x,y,w,h,cx,cy 등)는 전부 슬라이드 기준 0~1 정규화 값.
// fontSize·테두리 두께는 pt, radius는 인치 — PPT 단위를 기준으로 하고 HTML이 환산한다.

export const SLIDE_W = 13.333; // inches
export const SLIDE_H = 7.5;
export const PX_W = 1280; // 논리 캔버스(px) = 13.333in × 96dpi
export const PX_H = 720;

export function ptToPx(pt: number): number {
  return (pt * 96) / 72;
}

export function inToPx(inches: number): number {
  return inches * 96;
}

export interface Fill {
  readonly color: string; // "#RRGGBB"
  readonly alpha?: number; // 0~1 불투명도, 생략 시 1
}

export interface Stroke {
  readonly color: string;
  readonly widthPt: number;
  readonly dash?: "solid" | "dash";
}

export interface ImageElement {
  readonly kind: "image";
  readonly x: number; readonly y: number; readonly w: number; readonly h: number;
  readonly dataUrl: string;
}

export interface RectElement {
  readonly kind: "rect";
  readonly x: number; readonly y: number; readonly w: number; readonly h: number;
  readonly fill: Fill;
  readonly stroke?: Stroke;
  readonly radiusIn?: number; // 인치
  readonly shadow?: boolean; // outer, blur 8pt, offset 3pt, 25%
}

export interface EllipseElement {
  readonly kind: "ellipse";
  readonly cx: number; readonly cy: number;
  readonly rx: number; readonly ry: number; // 정규화 반지름
  readonly fill: Fill;
  readonly stroke?: Stroke;
  readonly shadow?: boolean;
}

export interface LineElement {
  readonly kind: "line";
  readonly x1: number; readonly y1: number;
  readonly x2: number; readonly y2: number;
  readonly stroke: Stroke;
}

export interface TextElement {
  readonly kind: "text";
  readonly x: number; readonly y: number; readonly w: number; readonly h: number;
  readonly text: string;
  readonly fontSizePt: number;
  readonly color: string;
  readonly bold?: boolean;
  readonly align?: "left" | "center" | "right";
  readonly valign?: "top" | "middle" | "bottom";
  readonly charSpacingPt?: number; // 자간(pt)
  readonly fill?: Fill; // 텍스트 배경 박스
  readonly radiusIn?: number;
}

export interface TableColumn {
  readonly label: string;
  readonly wFrac: number; // 표 폭 대비 비율, 합=1
  readonly align?: "left" | "right";
}

export interface TableElement {
  readonly kind: "table";
  readonly x: number; readonly y: number; readonly w: number;
  readonly columns: readonly TableColumn[];
  readonly rows: readonly (readonly string[])[];
  readonly fontSizePt: number;
  readonly rowHIn: number; // 행 높이(인치)
  readonly headerFill: string; // "#RRGGBB"
  readonly headerColor: string;
  readonly zebraFill?: string; // 짝수 행 배경
}

export interface ChartElement {
  readonly kind: "chart";
  readonly x: number; readonly y: number; readonly w: number; readonly h: number;
  readonly title: string;
  readonly categories: readonly string[];
  readonly values: readonly number[];
  readonly color: string; // 막대 색
}

export type SlideElement =
  | ImageElement
  | RectElement
  | EllipseElement
  | LineElement
  | TextElement
  | TableElement
  | ChartElement;

export interface SlideSpec {
  readonly id: string;
  readonly title: string; // 썸네일 캡션용
  readonly warning?: string; // 예: 지도 캡처 실패
  readonly elements: readonly SlideElement[];
}
```

- [ ] **Step 7: 테스트 통과 확인**

Run: `npx vitest run src/lib/__tests__/slide-spec.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 8: 커밋**

```powershell
git add vitest.config.ts src/lib/slide-spec.ts src/lib/types.ts src/lib/__tests__/slide-spec.test.ts package.json package-lock.json
git commit -m "feat: SlideSpec 타입·좌표 체계 + vitest 테스트 인프라"
```

---

### Task 2: slide-builder — 디자인 토큰과 공통 크롬(헤더·푸터·범례·KPI칩·지도 레이어)

**Files:**
- Create: `src/lib/slide-builder.ts`
- Test: `src/lib/__tests__/slide-builder-chrome.test.ts`

**Interfaces:**
- Consumes: Task 1의 slide-spec 타입 전부, `types.ts`의 `AnalysisConfig`/`PoiPosition`/`RadiusPosition`/`RouteNormalizedPosition`/`CATEGORY_COLORS`/`CATEGORY_LABELS`
- Produces (Task 3·4·5가 사용, 모두 `slide-builder.ts` 내부 export):
  - `TOKENS` — 색상·폰트 상수 객체
  - `buildHeader(indexLabel: string, title: string, config: AnalysisConfig): SlideElement[]`
  - `buildKpiChips(chips: readonly { value: string; label: string }[]): SlideElement[]`
  - `buildFooter(pageNum: number, total: number): SlideElement[]`
  - `buildLegend(categories: readonly PoiCategory[]): SlideElement[]`
  - `buildMapLayer(input: SlideBuildInput, opts: { categories: readonly PoiCategory[]; showLabels: boolean; markerSize?: number; showRoutes?: boolean }): SlideElement[]` — 베이스맵 이미지(또는 플레이스홀더)+반경 원+노선+마커
  - `SlideBuildInput` 인터페이스

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// src/lib/__tests__/slide-builder-chrome.test.ts
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
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/lib/__tests__/slide-builder-chrome.test.ts`
Expected: FAIL — `Cannot find module '@/lib/slide-builder'`

- [ ] **Step 3: slide-builder.ts 크롬 부분 구현**

```ts
// src/lib/slide-builder.ts
// 슬라이드 디자인의 단일 소스. 모든 레이아웃·색·크기 결정은 이 파일 안에서만 한다.
import type {
  AnalysisConfig, Poi, PoiCategory, PoiPosition, RadiusPosition,
  RouteNormalizedPosition, SubwayStation,
} from "./types";
import { CATEGORY_COLORS, CATEGORY_LABELS } from "./types";
import type { SlideElement, SlideSpec } from "./slide-spec";

export interface SlideBuildInput {
  readonly config: AnalysisConfig;
  readonly pois: readonly Poi[];
  readonly baseMapImage: string; // ""이면 캡처 실패 → 플레이스홀더
  readonly poiPositions: readonly PoiPosition[];
  readonly radiusPosition: RadiusPosition | null;
  readonly routePositions: readonly RouteNormalizedPosition[];
}

export const TOKENS = {
  font: "Noto Sans KR",
  navy: "#1E3A8A",
  blue: "#3B82F6",
  ink: "#0F172A",
  body: "#334155",
  sub: "#64748B",
  light: "#F8FAFC",
  line: "#E2E8F0",
  white: "#FFFFFF",
  radius: "#0EA5E9",
} as const;

// ── 공통 크롬 ────────────────────────────────────────────────────────────────

export function buildHeader(indexLabel: string, title: string, config: AnalysisConfig): SlideElement[] {
  const refDate = new Date().toLocaleDateString("ko-KR");
  return [
    // 타이틀 카드
    { kind: "rect", x: 0.03, y: 0.05, w: 0.4, h: 0.16, fill: { color: TOKENS.white, alpha: 0.92 }, radiusIn: 0.06, shadow: true },
    // 좌측 액센트 바
    { kind: "rect", x: 0.03, y: 0.05, w: 0.006, h: 0.16, fill: { color: TOKENS.blue } },
    { kind: "text", x: 0.048, y: 0.062, w: 0.36, h: 0.035, text: `SITE ANALYSIS · ${indexLabel}`, fontSizePt: 10, color: TOKENS.blue, bold: true, charSpacingPt: 2 },
    { kind: "text", x: 0.048, y: 0.098, w: 0.36, h: 0.065, text: title, fontSizePt: 24, color: TOKENS.navy, bold: true },
    { kind: "text", x: 0.048, y: 0.168, w: 0.36, h: 0.03, text: `${refDate} · 기준반경 ${config.radiusKm}km · ${config.centerName}`, fontSizePt: 9, color: TOKENS.sub },
  ];
}

export function buildKpiChips(chips: readonly { value: string; label: string }[]): SlideElement[] {
  const els: SlideElement[] = [];
  const chipW = 0.115;
  const chipH = 0.075;
  const gap = 0.012;
  chips.forEach((chip, i) => {
    const x = 0.03 + i * (chipW + gap);
    const y = 0.225;
    els.push(
      { kind: "rect", x, y, w: chipW, h: chipH, fill: { color: TOKENS.white, alpha: 0.88 }, radiusIn: 0.05, shadow: true },
      { kind: "text", x: x + 0.008, y: y + 0.006, w: chipW - 0.016, h: 0.04, text: chip.value, fontSizePt: 13, color: TOKENS.navy, bold: true },
      { kind: "text", x: x + 0.008, y: y + 0.044, w: chipW - 0.016, h: 0.026, text: chip.label, fontSizePt: 8, color: TOKENS.sub },
    );
  });
  return els;
}

export function buildFooter(pageNum: number, total: number): SlideElement[] {
  const page = `${String(pageNum).padStart(2, "0")} / ${String(total).padStart(2, "0")}`;
  return [
    { kind: "rect", x: 0, y: 0.955, w: 1, h: 0.045, fill: { color: TOKENS.ink, alpha: 0.55 } },
    { kind: "text", x: 0.03, y: 0.958, w: 0.5, h: 0.038, text: "지도 데이터: OpenStreetMap/ESRI · 시설 데이터: 공공데이터포털", fontSizePt: 8, color: "#CBD5E1", valign: "middle" },
    { kind: "text", x: 0.9, y: 0.958, w: 0.07, h: 0.038, text: page, fontSizePt: 9, color: "#CBD5E1", align: "right", valign: "middle" },
  ];
}

export function buildLegend(categories: readonly PoiCategory[]): SlideElement[] {
  const rowH = 0.036;
  const w = 0.135;
  const h = categories.length * rowH + 0.028;
  const x = 1 - w - 0.03;
  const y = 1 - h - 0.065;
  const els: SlideElement[] = [
    { kind: "rect", x, y, w, h, fill: { color: TOKENS.white, alpha: 0.92 }, radiusIn: 0.05, shadow: true },
  ];
  categories.forEach((cat, i) => {
    const rowY = y + 0.016 + i * rowH;
    els.push(
      { kind: "ellipse", cx: x + 0.014, cy: rowY + rowH / 2 - 0.004, rx: 0.0045, ry: 0.008, fill: { color: CATEGORY_COLORS[cat] }, stroke: { color: TOKENS.white, widthPt: 1 } },
      { kind: "text", x: x + 0.026, y: rowY - 0.004, w: w - 0.032, h: rowH, text: CATEGORY_LABELS[cat], fontSizePt: 9, color: TOKENS.body, valign: "middle" },
    );
  });
  return els;
}

const MARKER_R = 0.0085; // 정규화(가로 기준) 반지름

export function buildMapLayer(
  input: SlideBuildInput,
  opts: {
    categories: readonly PoiCategory[];
    showLabels: boolean;
    markerSize?: number;
    showRoutes?: boolean;
  }
): SlideElement[] {
  const els: SlideElement[] = [];

  if (input.baseMapImage) {
    els.push({ kind: "image", x: 0, y: 0, w: 1, h: 1, dataUrl: input.baseMapImage });
  } else {
    els.push(
      { kind: "rect", x: 0, y: 0, w: 1, h: 1, fill: { color: "#DBEAFE" } },
      { kind: "text", x: 0.25, y: 0.45, w: 0.5, h: 0.1, text: "지도 이미지를 불러오지 못했습니다", fontSizePt: 14, color: TOKENS.sub, align: "center", valign: "middle" },
    );
  }

  if (input.radiusPosition) {
    const { centerNx, centerNy, radiusNx, radiusNy } = input.radiusPosition;
    els.push(
      { kind: "ellipse", cx: centerNx, cy: centerNy, rx: radiusNx, ry: radiusNy, fill: { color: TOKENS.radius, alpha: 0.12 }, stroke: { color: TOKENS.radius, widthPt: 2, dash: "dash" } },
      { kind: "ellipse", cx: centerNx, cy: centerNy, rx: 0.0075, ry: 0.0133, fill: { color: TOKENS.blue }, stroke: { color: TOKENS.white, widthPt: 2 }, shadow: true },
    );
  }

  if (opts.showRoutes) {
    input.routePositions.forEach((route) => {
      for (let i = 0; i < route.points.length - 1; i++) {
        const from = route.points[i];
        const to = route.points[i + 1];
        els.push({ kind: "line", x1: from.nx, y1: from.ny, x2: to.nx, y2: to.ny, stroke: { color: route.lineColor, widthPt: 3 } });
      }
    });
  }

  const r = opts.markerSize ?? MARKER_R;
  input.poiPositions
    .filter((p) => opts.categories.includes(p.poi.category))
    .forEach(({ poi, nx, ny }) => {
      const color = poi.category === "subway" ? (poi as SubwayStation).lineColor : CATEGORY_COLORS[poi.category];
      els.push({
        kind: "ellipse", cx: nx, cy: ny, rx: r, ry: r * (16 / 9),
        fill: { color }, stroke: { color: TOKENS.white, widthPt: 1.5 }, shadow: true,
      });
      if (opts.showLabels) {
        const labelW = Math.max(0.05, poi.name.length * 0.0095 + 0.012);
        els.push({
          kind: "text", x: nx + r + 0.004, y: ny - 0.017, w: labelW, h: 0.034,
          text: poi.name, fontSizePt: 8, color: TOKENS.navy, bold: true, align: "center", valign: "middle",
          fill: { color: TOKENS.white, alpha: 0.85 }, radiusIn: 0.03,
        });
      }
    });

  return els;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/lib/__tests__/slide-builder-chrome.test.ts`
Expected: PASS (전체)

- [ ] **Step 5: 커밋**

```powershell
git add src/lib/slide-builder.ts src/lib/__tests__/slide-builder-chrome.test.ts
git commit -m "feat: slide-builder 공통 크롬(헤더·KPI칩·푸터·범례·지도 레이어)"
```

---

### Task 3: slide-builder — buildSlides() 7장 완성

**Files:**
- Modify: `src/lib/slide-builder.ts` (buildSlides + 슬라이드별 빌더 추가)
- Test: `src/lib/__tests__/slide-builder-slides.test.ts`

**Interfaces:**
- Consumes: Task 2의 크롬 빌더 전부
- Produces: `buildSlides(input: SlideBuildInput): SlideSpec[]` — 순서 고정: `cover`, `overview`, `subway`, `school`, `nature`, `apartment`, `summary` (id 값). 각 SlideSpec의 `title`은 순서대로: "표지", "입지 현황 종합", "교통 분석", "교육 환경", "자연 환경", "주변 분양 현황", "종합 분석 및 시사점".

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// src/lib/__tests__/slide-builder-slides.test.ts
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
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/lib/__tests__/slide-builder-slides.test.ts`
Expected: FAIL — `buildSlides is not a function` (또는 import 오류)

- [ ] **Step 3: buildSlides 구현**

`src/lib/slide-builder.ts`에 추가:

```ts
// ── 슬라이드별 빌더 ──────────────────────────────────────────────────────────

import type { Apartment, School as SchoolPoi } from "./types"; // 파일 상단 import에 병합

const TOTAL = 7;

function distanceLabel(input: SlideBuildInput, poi: Poi): string {
  // 정규화 좌표 기반 근사 거리 대신, 반경 대비 상대 위치를 쓰지 않고 이름만 사용.
  // (좌표→미터 변환은 이 스펙 범위 외 — 목록에는 노선/급 정보만 표기)
  return poi.name;
}

function buildPanelCard(x: number, y: number, w: number, h: number, title: string): SlideElement[] {
  return [
    { kind: "rect", x, y, w, h, fill: { color: TOKENS.white, alpha: 0.92 }, radiusIn: 0.06, shadow: true },
    { kind: "rect", x, y, w: 0.005, h, fill: { color: TOKENS.navy } },
    { kind: "text", x: x + 0.016, y: y + 0.018, w: w - 0.03, h: 0.04, text: title, fontSizePt: 12, color: TOKENS.navy, bold: true, charSpacingPt: 1 },
    { kind: "line", x1: x + 0.016, y1: y + 0.062, x2: x + w - 0.016, y2: y + 0.062, stroke: { color: TOKENS.line, widthPt: 1 } },
  ];
}

function buildListPanel(x: number, y: number, w: number, title: string, items: readonly string[]): SlideElement[] {
  const rowH = 0.042;
  const h = 0.08 + Math.max(items.length, 1) * rowH + 0.02;
  const els = buildPanelCard(x, y, w, h, title);
  if (items.length === 0) {
    els.push({ kind: "text", x: x + 0.016, y: y + 0.08, w: w - 0.03, h: rowH, text: "반경 내 해당 시설 없음", fontSizePt: 11, color: TOKENS.sub, valign: "middle" });
    return els;
  }
  items.forEach((text, i) => {
    els.push({ kind: "text", x: x + 0.016, y: y + 0.08 + i * rowH, w: w - 0.03, h: rowH, text: `·  ${text}`, fontSizePt: 11, color: TOKENS.body, valign: "middle" });
  });
  return els;
}

function coverSlide(input: SlideBuildInput): SlideSpec {
  const { config, pois } = input;
  const counts = {
    subway: pois.filter((p) => p.category === "subway").length,
    school: pois.filter((p) => p.category === "school").length,
    nature: pois.filter((p) => p.category === "park" || p.category === "mountain").length,
    apartment: pois.filter((p) => p.category === "apartment").length,
  };
  const refDate = new Date().toLocaleDateString("ko-KR");
  const elements: SlideElement[] = [
    ...buildMapLayer(input, { categories: [], showLabels: false }),
    { kind: "rect", x: 0, y: 0, w: 1, h: 1, fill: { color: TOKENS.ink, alpha: 0.55 } },
    { kind: "text", x: 0.08, y: 0.3, w: 0.6, h: 0.045, text: "SITE ANALYSIS REPORT", fontSizePt: 13, color: TOKENS.blue, bold: true, charSpacingPt: 4 },
    { kind: "text", x: 0.08, y: 0.36, w: 0.84, h: 0.13, text: config.centerName, fontSizePt: 44, color: TOKENS.white, bold: true },
    { kind: "rect", x: 0.082, y: 0.51, w: 0.09, h: 0.007, fill: { color: TOKENS.blue } },
    { kind: "text", x: 0.08, y: 0.545, w: 0.6, h: 0.06, text: "사이트 입지 분석 보고서", fontSizePt: 20, color: "#E2E8F0" },
    { kind: "text", x: 0.08, y: 0.64, w: 0.84, h: 0.04, text: `지하철 ${counts.subway}개소 · 학교 ${counts.school}개교 · 공원/산 ${counts.nature}개소 · 분양 ${counts.apartment}단지`, fontSizePt: 13, color: "#CBD5E1" },
    { kind: "text", x: 0.08, y: 0.69, w: 0.84, h: 0.035, text: `${refDate} · 반경 ${config.radiusKm}km 분석`, fontSizePt: 11, color: "#94A3B8" },
  ];
  return withWarning(input, { id: "cover", title: "표지", elements });
}

function withWarning(input: SlideBuildInput, spec: SlideSpec): SlideSpec {
  return input.baseMapImage ? spec : { ...spec, warning: "지도 캡처 실패 — 플레이스홀더 배경으로 표시됩니다" };
}

function overviewSlide(input: SlideBuildInput): SlideSpec {
  const cats: PoiCategory[] = ["subway", "school", "park", "mountain", "apartment"];
  const chips = [
    { value: `${input.pois.filter((p) => p.category === "subway").length}개소`, label: "지하철역" },
    { value: `${input.pois.filter((p) => p.category === "school").length}개교`, label: "학교" },
    { value: `${input.pois.filter((p) => p.category === "apartment").length}단지`, label: "분양" },
  ];
  return withWarning(input, {
    id: "overview",
    title: "입지 현황 종합",
    elements: [
      ...buildMapLayer(input, { categories: cats, showLabels: false, markerSize: 0.006, showRoutes: true }),
      ...buildHeader("02", "입지 현황 종합", input.config),
      ...buildKpiChips(chips),
      ...buildLegend(cats),
      ...buildFooter(2, TOTAL),
    ],
  });
}

function subwaySlide(input: SlideBuildInput): SlideSpec {
  const subways = input.pois.filter((p): p is SubwayStation => p.category === "subway");
  const lines = [...new Set(subways.map((s) => s.line))];
  return withWarning(input, {
    id: "subway",
    title: "교통 분석",
    elements: [
      ...buildMapLayer(input, { categories: ["subway"], showLabels: true, showRoutes: true }),
      ...buildHeader("03", "교통 분석", input.config),
      ...buildKpiChips([
        { value: `${subways.length}개소`, label: "지하철역" },
        { value: `${lines.length}개`, label: "지나는 노선" },
      ]),
      ...buildListPanel(0.03, 0.33, 0.27, "반경 내 지하철역", subways.slice(0, 8).map((s) => `${s.name} (${s.line})`)),
      ...buildFooter(3, TOTAL),
    ],
  });
}

function schoolSlide(input: SlideBuildInput): SlideSpec {
  const schools = input.pois.filter((p): p is SchoolPoi => p.category === "school");
  const levelLabel = { elementary: "초", middle: "중", high: "고" } as const;
  const byLevel = (lv: SchoolPoi["level"]) => schools.filter((s) => s.level === lv).length;
  return withWarning(input, {
    id: "school",
    title: "교육 환경",
    elements: [
      ...buildMapLayer(input, { categories: ["school"], showLabels: true }),
      ...buildHeader("04", "교육 환경", input.config),
      ...buildKpiChips([
        { value: `${schools.length}개교`, label: "학교 합계" },
        { value: `${byLevel("elementary")}·${byLevel("middle")}·${byLevel("high")}`, label: "초·중·고" },
      ]),
      ...buildListPanel(0.03, 0.33, 0.27, "반경 내 학교", schools.slice(0, 8).map((s) => `${s.name} (${levelLabel[s.level]})`)),
      ...buildFooter(4, TOTAL),
    ],
  });
}

function natureSlide(input: SlideBuildInput): SlideSpec {
  const nature = input.pois.filter((p) => p.category === "park" || p.category === "mountain");
  return withWarning(input, {
    id: "nature",
    title: "자연 환경",
    elements: [
      ...buildMapLayer(input, { categories: ["park", "mountain"], showLabels: true }),
      ...buildHeader("05", "자연 환경", input.config),
      ...buildKpiChips([{ value: `${nature.length}개소`, label: "공원·산" }]),
      ...buildListPanel(0.03, 0.33, 0.27, "반경 내 공원·산", nature.slice(0, 8).map((p) => p.name)),
      ...buildFooter(5, TOTAL),
    ],
  });
}

function apartmentSlide(input: SlideBuildInput): SlideSpec {
  const apartments = input.pois.filter((p): p is Apartment => p.category === "apartment");
  const top = [...apartments].sort((a, b) => b.units - a.units).slice(0, 8);
  const chartTop = [...apartments].sort((a, b) => b.price_per_pyeong - a.price_per_pyeong).slice(0, 5);
  const avgPrice = apartments.length ? Math.round(apartments.reduce((s, a) => s + a.price_per_pyeong, 0) / apartments.length) : 0;

  const elements: SlideElement[] = [
    ...buildMapLayer(input, { categories: ["apartment"], showLabels: true }),
    ...buildHeader("06", "주변 분양 현황", input.config),
    ...buildKpiChips([
      { value: `${apartments.length}단지`, label: "분양 단지" },
      { value: `${avgPrice.toLocaleString()}`, label: "평균 평당가(만원)" },
    ]),
    ...buildFooter(6, TOTAL),
  ];

  if (apartments.length === 0) {
    elements.push(...buildListPanel(0.03, 0.33, 0.42, "분양 단지", []));
  } else {
    // 표 카드
    elements.push(...buildPanelCard(0.03, 0.33, 0.42, 0.36, "분양 단지 목록"));
    elements.push({
      kind: "table", x: 0.046, y: 0.41, w: 0.39,
      columns: [
        { label: "단지명", wFrac: 0.4 },
        { label: "세대수", wFrac: 0.18, align: "right" },
        { label: "평당가", wFrac: 0.2, align: "right" },
        { label: "분양일", wFrac: 0.22 },
      ],
      rows: top.map((a) => [a.name, a.units.toLocaleString(), a.price_per_pyeong.toLocaleString(), a.sale_date]),
      fontSizePt: 9, rowHIn: 0.26, headerFill: TOKENS.navy, headerColor: TOKENS.white, zebraFill: "#F1F5F9",
    });
    // 차트 카드
    elements.push(...buildPanelCard(0.03, 0.71, 0.42, 0.23, "평당가 비교 (상위 5)"));
    elements.push({
      kind: "chart", x: 0.046, y: 0.775, w: 0.39, h: 0.15,
      title: "평당가(만원/평)",
      categories: chartTop.map((a) => a.name),
      values: chartTop.map((a) => a.price_per_pyeong),
      color: TOKENS.blue,
    });
  }

  return withWarning(input, { id: "apartment", title: "주변 분양 현황", elements });
}

function summarySlide(input: SlideBuildInput): SlideSpec {
  const { pois } = input;
  const subways = pois.filter((p) => p.category === "subway").length;
  const schools = pois.filter((p) => p.category === "school").length;
  const apartments = pois.filter((p): p is Apartment => p.category === "apartment");
  const avgPrice = apartments.length ? Math.round(apartments.reduce((s, a) => s + a.price_per_pyeong, 0) / apartments.length) : 0;

  const points = [
    ["교통 환경", `반경 내 지하철역 ${subways}개소 위치`],
    ["교육 여건", `초·중·고 총 ${schools}개교 인접`],
    ["공급 현황", `인근 ${apartments.length}개 단지 분양 진행 중`],
    ["가격 수준", `평균 분양가 ${avgPrice.toLocaleString()}만원/평 형성`],
    ["종합 평가", "대상지는 우수한 생활 인프라를 갖춘 입지로 판단됨"],
  ] as const;

  const cardX = 0.03, cardY = 0.31, cardW = 0.46;
  const rowH = 0.095;
  const cardH = 0.09 + points.length * rowH;
  const elements: SlideElement[] = [
    ...buildMapLayer(input, { categories: [], showLabels: false }),
    ...buildHeader("07", "종합 분석 및 시사점", input.config),
    ...buildPanelCard(cardX, cardY, cardW, cardH, "핵심 요약"),
    ...buildFooter(7, TOTAL),
  ];
  points.forEach(([label, text], i) => {
    const y = cardY + 0.085 + i * rowH;
    const isLast = i === points.length - 1;
    elements.push(
      { kind: "rect", x: cardX + 0.016, y: y + 0.008, w: 0.075, h: 0.05, fill: { color: isLast ? TOKENS.navy : "#EFF6FF" }, radiusIn: 0.04 },
      { kind: "text", x: cardX + 0.016, y: y + 0.008, w: 0.075, h: 0.05, text: label, fontSizePt: 9, color: isLast ? TOKENS.white : TOKENS.navy, bold: true, align: "center", valign: "middle" },
      { kind: "text", x: cardX + 0.102, y: y, w: cardW - 0.12, h: 0.066, text, fontSizePt: 13, color: TOKENS.body, bold: isLast, valign: "middle" },
    );
  });
  return withWarning(input, { id: "summary", title: "종합 분석 및 시사점", elements });
}

export function buildSlides(input: SlideBuildInput): SlideSpec[] {
  return [
    coverSlide(input),
    overviewSlide(input),
    subwaySlide(input),
    schoolSlide(input),
    natureSlide(input),
    apartmentSlide(input),
    summarySlide(input),
  ];
}
```

주의: `distanceLabel` 헬퍼는 사용하지 않으면 넣지 말 것 (YAGNI — 위 코드에서 실제로 안 쓰면 삭제).

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/lib/__tests__/slide-builder-slides.test.ts`
Expected: PASS. 실패 시 seed-data의 실제 필드명(`DEFAULT_CONFIG` 등)이 테스트 가정과 맞는지 `src/lib/seed-data.ts`를 열어 확인 후 테스트 쪽을 수정.

- [ ] **Step 5: 전체 테스트 회귀 확인**

Run: `npx vitest run`
Expected: 전부 PASS

- [ ] **Step 6: 커밋**

```powershell
git add src/lib/slide-builder.ts src/lib/__tests__/slide-builder-slides.test.ts
git commit -m "feat: buildSlides 7장 — 표지·종합·교통·교육·자연·분양(표+차트)·시사점"
```

---

### Task 4: ppt-generator 재작성 — SlideSpec → pptxgenjs 매퍼

**Files:**
- Rewrite: `src/lib/ppt-generator.ts` (기존 내용 전부 교체)
- Test: `src/lib/__tests__/ppt-generator.test.ts`

**Interfaces:**
- Consumes: Task 1 slide-spec 타입, Task 3 `buildSlides`(테스트에서)
- Produces:
  - `applyElement(slide: SlideLike, el: SlideElement, chartType: unknown): void` — 요소 1개 매핑 (테스트용 export)
  - `createPptx(specs: readonly SlideSpec[], title: string): PptxGenJS`
  - `generatePptFromSlides(specs: readonly SlideSpec[], fileName: string): Promise<void>` — 브라우저에서 writeFile
  - `SlideLike` 인터페이스: `{ addImage(o): void; addShape(t, o): void; addText(t, o): void; addTable(rows, o): void; addChart(type, data, o): void; background?: unknown }`

- [ ] **Step 1: 실패하는 테스트 작성**

레코더(fake slide)로 매핑 결과를 검증한다. 파일 쓰기 없이 순수 로직만.

```ts
// src/lib/__tests__/ppt-generator.test.ts
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
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/lib/__tests__/ppt-generator.test.ts`
Expected: FAIL — `applyElement`가 export되지 않음

- [ ] **Step 3: ppt-generator.ts 전면 재작성**

```ts
// src/lib/ppt-generator.ts
// SlideSpec → pptxgenjs 얇은 매퍼. 디자인 결정은 전부 slide-builder.ts에 있다.
import PptxGenJS from "pptxgenjs";
import type { SlideElement, SlideSpec, Fill, Stroke } from "./slide-spec";
import { SLIDE_W, SLIDE_H } from "./slide-spec";

const FONT = "Noto Sans KR";

export interface SlideLike {
  addImage(opts: object): void;
  addShape(type: string, opts: object): void;
  addText(text: string, opts: object): void;
  addTable(rows: unknown[][], opts: object): void;
  addChart(type: unknown, data: unknown[], opts: object): void;
}

const hex = (c: string) => c.replace("#", "");

function fillOf(fill: Fill) {
  const transparency = Math.round((1 - (fill.alpha ?? 1)) * 100);
  return transparency > 0 ? { color: hex(fill.color), transparency } : { color: hex(fill.color) };
}

function lineOf(stroke: Stroke) {
  return {
    color: hex(stroke.color),
    width: stroke.widthPt,
    ...(stroke.dash === "dash" ? { dashType: "dash" as const } : {}),
  };
}

const SHADOW = { type: "outer" as const, blur: 8, offset: 3, color: "000000", opacity: 0.25 };

export function applyElement(slide: SlideLike, el: SlideElement, barChartType: unknown): void {
  switch (el.kind) {
    case "image":
      slide.addImage({ data: el.dataUrl, x: el.x * SLIDE_W, y: el.y * SLIDE_H, w: el.w * SLIDE_W, h: el.h * SLIDE_H });
      return;

    case "rect":
      slide.addShape(el.radiusIn ? "roundRect" : "rect", {
        x: el.x * SLIDE_W, y: el.y * SLIDE_H, w: el.w * SLIDE_W, h: el.h * SLIDE_H,
        fill: fillOf(el.fill),
        ...(el.stroke ? { line: lineOf(el.stroke) } : {}),
        ...(el.radiusIn ? { rectRadius: el.radiusIn } : {}),
        ...(el.shadow ? { shadow: SHADOW } : {}),
      });
      return;

    case "ellipse":
      slide.addShape("ellipse", {
        x: (el.cx - el.rx) * SLIDE_W, y: (el.cy - el.ry) * SLIDE_H,
        w: el.rx * 2 * SLIDE_W, h: el.ry * 2 * SLIDE_H,
        fill: fillOf(el.fill),
        ...(el.stroke ? { line: lineOf(el.stroke) } : {}),
        ...(el.shadow ? { shadow: SHADOW } : {}),
      });
      return;

    case "line": {
      const x = Math.min(el.x1, el.x2) * SLIDE_W;
      const y = Math.min(el.y1, el.y2) * SLIDE_H;
      const w = Math.max(Math.abs(el.x2 - el.x1) * SLIDE_W, 0.005);
      const h = Math.max(Math.abs(el.y2 - el.y1) * SLIDE_H, 0.005);
      const goesRight = el.x2 >= el.x1;
      const goesDown = el.y2 >= el.y1;
      slide.addShape("line", { x, y, w, h, line: lineOf(el.stroke), flipV: goesRight !== goesDown });
      return;
    }

    case "text":
      slide.addText(el.text, {
        x: el.x * SLIDE_W, y: el.y * SLIDE_H, w: el.w * SLIDE_W, h: el.h * SLIDE_H,
        fontSize: el.fontSizePt, fontFace: FONT, color: hex(el.color),
        bold: el.bold ?? false,
        align: el.align ?? "left",
        valign: el.valign ?? "top",
        ...(el.charSpacingPt ? { charSpacing: el.charSpacingPt } : {}),
        ...(el.fill ? { fill: fillOf(el.fill) } : {}),
        ...(el.radiusIn ? { rectRadius: el.radiusIn } : {}),
      });
      return;

    case "table": {
      const header = el.columns.map((c) => ({
        text: c.label,
        options: { bold: true, color: hex(el.headerColor), fill: { color: hex(el.headerFill) }, align: c.align ?? "left" },
      }));
      const body = el.rows.map((row, ri) =>
        row.map((cell, ci) => ({
          text: cell,
          options: {
            align: el.columns[ci].align ?? "left",
            ...(el.zebraFill && ri % 2 === 1 ? { fill: { color: hex(el.zebraFill) } } : {}),
          },
        }))
      );
      slide.addTable([header, ...body], {
        x: el.x * SLIDE_W, y: el.y * SLIDE_H, w: el.w * SLIDE_W,
        colW: el.columns.map((c) => c.wFrac * el.w * SLIDE_W),
        fontSize: el.fontSizePt, fontFace: FONT, rowH: el.rowHIn,
        border: { type: "solid", pt: 0.5, color: "E2E8F0" },
        color: "334155",
      });
      return;
    }

    case "chart":
      slide.addChart(
        barChartType,
        [{ name: el.title, labels: [...el.categories], values: [...el.values] }],
        {
          x: el.x * SLIDE_W, y: el.y * SLIDE_H, w: el.w * SLIDE_W, h: el.h * SLIDE_H,
          barDir: "col",
          chartColors: [hex(el.color)],
          catAxisLabelFontSize: 8, valAxisLabelFontSize: 8,
          dataLabelFontSize: 8, showValue: true,
          fontFace: FONT,
          valGridLine: { style: "none" },
          showLegend: false, showTitle: false,
        }
      );
      return;
  }
}

export function createPptx(specs: readonly SlideSpec[], title: string): PptxGenJS {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = title;
  specs.forEach((spec) => {
    const slide = pptx.addSlide();
    spec.elements.forEach((el) => applyElement(slide as unknown as SlideLike, el, pptx.ChartType.bar));
  });
  return pptx;
}

export async function generatePptFromSlides(specs: readonly SlideSpec[], fileName: string): Promise<void> {
  const pptx = createPptx(specs, fileName.replace(/\.pptx$/, ""));
  await pptx.writeFile({ fileName });
}
```

기존 `generateSiteAnalysisPpt`와 `RouteNormalizedPosition` export는 삭제한다 (호출부는 Task 7에서 교체 — 이 시점에 `site-analysis-app.tsx`가 깨지므로 같은 커밋에서 임시로 빌드하지 말고 테스트만 실행).

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/lib/__tests__/ppt-generator.test.ts`
Expected: PASS. `pptx.ChartType.bar` 타입 오류가 나면 `(pptx as any).ChartType?.bar ?? "bar"` 대신 pptxgenjs 3.12의 실제 API를 확인: `import PptxGenJS from "pptxgenjs"` 후 `PptxGenJS.ChartType.bar` (정적) 또는 인스턴스 `pptx.ChartType.bar` 둘 다 지원됨 — 타입 정의에 있는 쪽 사용.

- [ ] **Step 5: .pptx 네이티브 요소 통합 테스트 추가**

```ts
// src/lib/__tests__/pptx-native.test.ts (같은 Task에서 추가)
import { describe, it, expect } from "vitest";
import AdmZip from "adm-zip";
import { buildSlides } from "@/lib/slide-builder";
import { createPptx } from "@/lib/ppt-generator";
import { SUBWAY_STATIONS, SCHOOLS, PARKS, MOUNTAINS, APARTMENTS, DEFAULT_CONFIG } from "@/lib/seed-data";

const ALL_POIS = [...SUBWAY_STATIONS, ...SCHOOLS, ...PARKS, ...MOUNTAINS, ...APARTMENTS];

describe("생성된 .pptx의 네이티브 요소", () => {
  it("슬라이드 7장, 텍스트/도형은 XML 네이티브, 차트 파트 존재, 이미지 없음(베이스맵 미제공 시)", async () => {
    const specs = buildSlides({
      config: DEFAULT_CONFIG,
      pois: ALL_POIS,
      baseMapImage: "", // 이미지 없이 생성 → media 폴더가 비어야 함
      poiPositions: ALL_POIS.map((poi, i) => ({ poi, nx: (i % 10) / 10 + 0.05, ny: ((i * 7) % 10) / 10 + 0.05 })),
      radiusPosition: { centerNx: 0.5, centerNy: 0.5, radiusNx: 0.3, radiusNy: 0.35 },
      routePositions: [],
    });
    const pptx = createPptx(specs, "test");
    const buf = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
    const zip = new AdmZip(buf);
    const names = zip.getEntries().map((e) => e.entryName);

    for (let i = 1; i <= 7; i++) {
      expect(names).toContain(`ppt/slides/slide${i}.xml`);
    }
    // 차트 파트 (분양 슬라이드의 네이티브 차트)
    expect(names.some((n) => /^ppt\/charts\/chart\d+\.xml$/.test(n))).toBe(true);
    // 이미지 미디어 없음 → 전부 네이티브 (차트 제외 워크북 xlsx는 embeddings에 있음)
    expect(names.filter((n) => n.startsWith("ppt/media/") && /\.(png|jpe?g)$/i.test(n))).toHaveLength(0);

    // 표지 슬라이드 XML에 텍스트 런이 존재
    const slide1 = zip.readAsText("ppt/slides/slide1.xml");
    expect(slide1).toContain("<a:t>");
    expect(slide1).toContain(DEFAULT_CONFIG.centerName);
  });
});
```

Run: `npx vitest run src/lib/__tests__/pptx-native.test.ts`
Expected: PASS. `pptx.write` 시그니처 오류가 나면 pptxgenjs 3.12는 `pptx.write("nodebuffer")` (문자열 인자) — 두 형태 중 타입이 허용하는 쪽 사용.

- [ ] **Step 6: 전체 테스트 회귀**

Run: `npx vitest run`
Expected: 전부 PASS

- [ ] **Step 7: 커밋**

```powershell
git add src/lib/ppt-generator.ts src/lib/__tests__/ppt-generator.test.ts src/lib/__tests__/pptx-native.test.ts
git commit -m "feat: ppt-generator를 SlideSpec 범용 매퍼로 재작성 + pptx 네이티브 요소 검증"
```

참고: 이 시점에서 `site-analysis-app.tsx`가 삭제된 `generateSiteAnalysisPpt`를 import하므로 `next build`는 깨진 상태다. Task 7에서 복구된다 — 중간 커밋은 테스트 통과 기준으로 진행.

---

### Task 5: slide-renderer — SlideSpec → HTML

**Files:**
- Create: `src/components/slide-renderer.tsx`
- Modify: `src/app/layout.tsx` (Noto Sans KR 로드)
- Test: `src/components/__tests__/slide-renderer.test.tsx`

**Interfaces:**
- Consumes: Task 1 slide-spec 타입 (`PX_W`, `PX_H`, `ptToPx`, `inToPx` 포함)
- Produces: `export default function SlideRenderer({ spec, width }: { spec: SlideSpec; width: number })` — 논리 1280×720 캔버스를 `transform: scale(width/1280)`로 축소 렌더. 컨테이너 실제 크기는 `width × width*(720/1280)`.

- [ ] **Step 1: 실패하는 테스트 작성**

```tsx
// src/components/__tests__/slide-renderer.test.tsx
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
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/components/__tests__/slide-renderer.test.tsx`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: slide-renderer.tsx 구현**

```tsx
// src/components/slide-renderer.tsx
// SlideSpec 1장을 HTML로 렌더한다. 논리 캔버스 1280×720px 위에 절대배치 후
// transform: scale로 요청 폭에 맞춘다. PPT 매퍼와 시각 결과가 일치해야 하므로
// 여기서 디자인을 추가하지 말 것 — 디자인은 slide-builder.ts에서만.
import type { CSSProperties } from "react";
import type { SlideSpec, SlideElement, Fill, Stroke } from "@/lib/slide-spec";
import { PX_W, PX_H, ptToPx, inToPx } from "@/lib/slide-spec";

const FONT = "'Noto Sans KR', sans-serif";
const SHADOW_CSS = "0 4px 10.5px rgba(0,0,0,0.25)"; // PPT outer shadow(blur 8pt, offset 3pt) 근사

function rgba(fill: Fill): string {
  const c = fill.color.replace("#", "");
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${fill.alpha ?? 1})`;
}

function borderOf(stroke: Stroke): string {
  return `${ptToPx(stroke.widthPt)}px ${stroke.dash === "dash" ? "dashed" : "solid"} ${stroke.color}`;
}

function box(x: number, y: number, w: number, h: number): CSSProperties {
  return {
    position: "absolute",
    left: x * PX_W,
    top: y * PX_H,
    width: w * PX_W,
    height: h * PX_H,
  };
}

function ElementView({ el }: { readonly el: SlideElement }) {
  switch (el.kind) {
    case "image":
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={el.dataUrl} alt="" style={{ ...box(el.x, el.y, el.w, el.h), objectFit: "fill" }} />;

    case "rect":
      return (
        <div
          style={{
            ...box(el.x, el.y, el.w, el.h),
            backgroundColor: rgba(el.fill),
            borderRadius: el.radiusIn ? inToPx(el.radiusIn) : 0,
            border: el.stroke ? borderOf(el.stroke) : undefined,
            boxShadow: el.shadow ? SHADOW_CSS : undefined,
          }}
        />
      );

    case "ellipse":
      return (
        <div
          style={{
            ...box(el.cx - el.rx, el.cy - el.ry, el.rx * 2, el.ry * 2),
            backgroundColor: rgba(el.fill),
            borderRadius: "50%",
            border: el.stroke ? borderOf(el.stroke) : undefined,
            boxShadow: el.shadow ? SHADOW_CSS : undefined,
          }}
        />
      );

    case "line": {
      const x1 = el.x1 * PX_W, y1 = el.y1 * PX_H;
      const x2 = el.x2 * PX_W, y2 = el.y2 * PX_H;
      const len = Math.hypot(x2 - x1, y2 - y1);
      const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
      return (
        <div
          style={{
            position: "absolute",
            left: x1,
            top: y1 - ptToPx(el.stroke.widthPt) / 2,
            width: len,
            height: 0,
            borderTop: borderOf(el.stroke),
            transform: `rotate(${angle}deg)`,
            transformOrigin: "0 50%",
          }}
        />
      );
    }

    case "text": {
      const valign = el.valign ?? "top";
      return (
        <div
          style={{
            ...box(el.x, el.y, el.w, el.h),
            display: "flex",
            flexDirection: "column",
            justifyContent: valign === "middle" ? "center" : valign === "bottom" ? "flex-end" : "flex-start",
            fontSize: ptToPx(el.fontSizePt),
            fontFamily: FONT,
            color: el.color,
            fontWeight: el.bold ? 700 : 400,
            textAlign: el.align ?? "left",
            letterSpacing: el.charSpacingPt ? ptToPx(el.charSpacingPt) : undefined,
            backgroundColor: el.fill ? rgba(el.fill) : undefined,
            borderRadius: el.radiusIn ? inToPx(el.radiusIn) : undefined,
            lineHeight: 1.2,
            whiteSpace: "pre-wrap",
            overflow: "hidden",
          }}
        >
          {el.text}
        </div>
      );
    }

    case "table": {
      const cellPad = "3px 6px";
      return (
        <table
          style={{
            position: "absolute",
            left: el.x * PX_W,
            top: el.y * PX_H,
            width: el.w * PX_W,
            borderCollapse: "collapse",
            fontSize: ptToPx(el.fontSizePt),
            fontFamily: FONT,
            color: "#334155",
            tableLayout: "fixed",
          }}
        >
          <colgroup>
            {el.columns.map((c, i) => (
              <col key={i} style={{ width: `${c.wFrac * 100}%` }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {el.columns.map((c, i) => (
                <th
                  key={i}
                  style={{
                    backgroundColor: el.headerFill,
                    color: el.headerColor,
                    textAlign: c.align ?? "left",
                    padding: cellPad,
                    height: inToPx(el.rowHIn),
                    border: "0.7px solid #E2E8F0",
                    fontWeight: 700,
                  }}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {el.rows.map((row, ri) => (
              <tr key={ri} style={el.zebraFill && ri % 2 === 1 ? { backgroundColor: el.zebraFill } : undefined}>
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    style={{
                      textAlign: el.columns[ci].align ?? "left",
                      padding: cellPad,
                      height: inToPx(el.rowHIn),
                      border: "0.7px solid #E2E8F0",
                    }}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    }

    case "chart": {
      const max = Math.max(...el.values, 1);
      const areaH = el.h * PX_H;
      const labelH = 16;
      const valueH = 12;
      const plotH = areaH - labelH - valueH;
      return (
        <div style={{ ...box(el.x, el.y, el.w, el.h), display: "flex", alignItems: "flex-end", gap: 8, fontFamily: FONT }}>
          {el.values.map((v, i) => (
            <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%" }}>
              <div style={{ fontSize: valueH - 2, color: "#334155", marginBottom: 2 }}>{v.toLocaleString()}</div>
              <div data-testid={`chart-bar-${i}`} style={{ width: "60%", height: (v / max) * plotH, backgroundColor: el.color }} />
              <div style={{ fontSize: labelH - 6, color: "#64748B", marginTop: 2, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {el.categories[i]}
              </div>
            </div>
          ))}
        </div>
      );
    }
  }
}

export default function SlideRenderer({ spec, width }: { readonly spec: SlideSpec; readonly width: number }) {
  const scale = width / PX_W;
  return (
    <div style={{ width, height: width * (PX_H / PX_W), overflow: "hidden", position: "relative" }}>
      <div
        data-testid="slide-canvas"
        style={{
          width: PX_W,
          height: PX_H,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          position: "relative",
          backgroundColor: "#FFFFFF",
          overflow: "hidden",
        }}
      >
        {spec.elements.map((el, i) => (
          <ElementView key={i} el={el} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: layout.tsx에 Noto Sans KR 로드**

```tsx
// src/app/layout.tsx — 기존 내용에서 폰트 부분만 추가
import type { Metadata, Viewport } from "next";
import { Noto_Sans_KR } from "next/font/google";
import "./globals.css";

const notoSansKr = Noto_Sans_KR({
  subsets: ["latin"],
  weight: ["400", "700", "900"],
  display: "swap",
});

// metadata/viewport는 기존 그대로 유지

export default function RootLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <head>
        <meta charSet="utf-8" />
      </head>
      <body className={`${notoSansKr.className} antialiased`} suppressHydrationWarning>{children}</body>
    </html>
  );
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run src/components/__tests__/slide-renderer.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 6: 커밋**

```powershell
git add src/components/slide-renderer.tsx src/components/__tests__/slide-renderer.test.tsx src/app/layout.tsx
git commit -m "feat: SlideSpec HTML 렌더러 + Noto Sans KR 폰트 로드"
```

---

### Task 6: export-preview 모달 — 썸네일 레일·선택·다운로드

**Files:**
- Create: `src/components/export-preview.tsx`
- Test: `src/components/__tests__/export-preview.test.tsx`

**Interfaces:**
- Consumes: Task 5 `SlideRenderer`, Task 4 `generatePptFromSlides`, Task 1 `SlideSpec`
- Produces:
  ```tsx
  interface ExportPreviewProps {
    readonly specs: readonly SlideSpec[];
    readonly fileName: string; // 예: "청와대_사이트분석.pptx"
    readonly onClose: () => void;
  }
  export default function ExportPreview(props: ExportPreviewProps)
  ```

- [ ] **Step 1: 실패하는 테스트 작성**

```tsx
// src/components/__tests__/export-preview.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ExportPreview from "@/components/export-preview";
import type { SlideSpec } from "@/lib/slide-spec";

vi.mock("@/lib/ppt-generator", () => ({
  generatePptFromSlides: vi.fn().mockResolvedValue(undefined),
}));
import { generatePptFromSlides } from "@/lib/ppt-generator";

function spec(id: string, title: string, warning?: string): SlideSpec {
  return { id, title, warning, elements: [{ kind: "text", x: 0, y: 0, w: 1, h: 0.1, text: title, fontSizePt: 20, color: "#1E3A8A" }] };
}

const SPECS = [spec("cover", "표지"), spec("overview", "입지 현황 종합"), spec("subway", "교통 분석")];

beforeEach(() => vi.clearAllMocks());

describe("ExportPreview", () => {
  it("썸네일을 슬라이드 수만큼 렌더하고 다운로드 버튼에 선택 수를 표시한다", () => {
    render(<ExportPreview specs={SPECS} fileName="test.pptx" onClose={() => {}} />);
    expect(screen.getAllByTestId(/thumb-/)).toHaveLength(3);
    expect(screen.getByRole("button", { name: /PPT 다운로드 \(3장\)/ })).toBeTruthy();
  });

  it("체크 해제한 슬라이드는 다운로드에서 제외된다", async () => {
    const user = userEvent.setup();
    render(<ExportPreview specs={SPECS} fileName="test.pptx" onClose={() => {}} />);
    await user.click(screen.getByTestId("thumb-check-overview"));
    const btn = screen.getByRole("button", { name: /PPT 다운로드 \(2장\)/ });
    await user.click(btn);
    expect(generatePptFromSlides).toHaveBeenCalledonce();
    const passed = vi.mocked(generatePptFromSlides).mock.calls[0][0] as SlideSpec[];
    expect(passed.map((s) => s.id)).toEqual(["cover", "subway"]);
  });

  it("전체 해제 시 다운로드 버튼이 비활성화된다", async () => {
    const user = userEvent.setup();
    render(<ExportPreview specs={SPECS} fileName="test.pptx" onClose={() => {}} />);
    for (const s of SPECS) await user.click(screen.getByTestId(`thumb-check-${s.id}`));
    expect(screen.getByRole("button", { name: /PPT 다운로드/ })).toHaveProperty("disabled", true);
  });

  it("썸네일 클릭으로 메인 미리보기 슬라이드를 바꾼다", async () => {
    const user = userEvent.setup();
    render(<ExportPreview specs={SPECS} fileName="test.pptx" onClose={() => {}} />);
    await user.click(screen.getByTestId("thumb-subway"));
    expect(screen.getByTestId("main-slide").textContent).toContain("교통 분석");
  });

  it("warning이 있는 슬라이드는 경고 배지를 표시한다", () => {
    render(<ExportPreview specs={[spec("cover", "표지", "지도 캡처 실패")]} fileName="t.pptx" onClose={() => {}} />);
    expect(screen.getByText(/지도 캡처 실패/)).toBeTruthy();
  });

  it("닫기 버튼이 onClose를 호출한다", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ExportPreview specs={SPECS} fileName="test.pptx" onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "닫기" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("생성 실패 시 에러 메시지를 모달 안에 표시하고 모달은 유지한다", async () => {
    vi.mocked(generatePptFromSlides).mockRejectedValueOnce(new Error("boom"));
    const user = userEvent.setup();
    render(<ExportPreview specs={SPECS} fileName="test.pptx" onClose={() => {}} />);
    await user.click(screen.getByRole("button", { name: /PPT 다운로드/ }));
    expect(await screen.findByText(/PPT 생성에 실패했습니다/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/components/__tests__/export-preview.test.tsx`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: export-preview.tsx 구현**

```tsx
// src/components/export-preview.tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import type { SlideSpec } from "@/lib/slide-spec";
import SlideRenderer from "./slide-renderer";
import { generatePptFromSlides } from "@/lib/ppt-generator";

interface ExportPreviewProps {
  readonly specs: readonly SlideSpec[];
  readonly fileName: string;
  readonly onClose: () => void;
}

export default function ExportPreview({ specs, fileName, onClose }: ExportPreviewProps) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set(specs.map((s) => s.id)));
  const [activeId, setActiveId] = useState(specs[0]?.id);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = specs.find((s) => s.id === activeId) ?? specs[0];
  const selectedSpecs = specs.filter((s) => selected.has(s.id));

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const move = useCallback(
    (dir: 1 | -1) => {
      const idx = specs.findIndex((s) => s.id === activeId);
      const next = specs[idx + dir];
      if (next) setActiveId(next.id);
    },
    [specs, activeId]
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") move(1);
      else if (e.key === "ArrowLeft") move(-1);
      else if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move, onClose]);

  async function handleDownload() {
    setGenerating(true);
    setError(null);
    try {
      await generatePptFromSlides(selectedSpecs, fileName);
    } catch (err) {
      console.error("PPT generation failed:", err);
      setError("PPT 생성에 실패했습니다. 다시 시도해 주세요.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0F172A]/95">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
        <div>
          <h2 className="text-white text-lg font-bold">PPT 내보내기 미리보기</h2>
          <p className="text-blue-200/50 text-xs mt-0.5">슬라이드를 확인하고 포함할 장을 선택하세요</p>
        </div>
        <button
          onClick={onClose}
          aria-label="닫기"
          className="text-white/60 hover:text-white px-3 py-1.5 rounded-lg hover:bg-white/10 transition-all text-sm font-medium"
        >
          닫기
        </button>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* 썸네일 레일 */}
        <div className="w-56 shrink-0 overflow-y-auto p-4 space-y-3 border-r border-white/10">
          {specs.map((spec, i) => (
            <div key={spec.id} data-testid={`thumb-${spec.id}`} className="relative">
              <button
                onClick={() => setActiveId(spec.id)}
                className={`block w-full rounded-lg overflow-hidden border-2 transition-all ${
                  spec.id === active?.id ? "border-[#3B82F6]" : "border-white/10 hover:border-white/30"
                } ${selected.has(spec.id) ? "" : "opacity-40"}`}
              >
                <SlideRenderer spec={spec} width={192} />
              </button>
              <div className="flex items-center gap-2 mt-1.5 px-1">
                <input
                  type="checkbox"
                  data-testid={`thumb-check-${spec.id}`}
                  checked={selected.has(spec.id)}
                  onChange={() => toggle(spec.id)}
                  className="w-3.5 h-3.5 accent-[#3B82F6]"
                />
                <span className="text-[11px] text-white/70 font-medium truncate">
                  {String(i + 1).padStart(2, "0")} {spec.title}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* 메인 미리보기 */}
        <div className="flex-1 flex flex-col items-center justify-center p-8 min-w-0">
          {active?.warning && (
            <div className="mb-3 px-3 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-300 text-xs font-medium">
              ⚠ {active.warning}
            </div>
          )}
          <div data-testid="main-slide" className="rounded-xl overflow-hidden shadow-2xl max-w-full">
            <SlideRenderer spec={active} width={880} />
          </div>
          <div className="flex items-center gap-4 mt-4">
            <button onClick={() => move(-1)} aria-label="이전 슬라이드" className="text-white/50 hover:text-white text-xl px-3 py-1 rounded hover:bg-white/10">←</button>
            <span className="text-white/50 text-sm font-mono">
              {specs.findIndex((s) => s.id === active?.id) + 1} / {specs.length}
            </span>
            <button onClick={() => move(1)} aria-label="다음 슬라이드" className="text-white/50 hover:text-white text-xl px-3 py-1 rounded hover:bg-white/10">→</button>
          </div>
        </div>
      </div>

      {/* 푸터 */}
      <div className="flex items-center justify-between px-6 py-4 border-t border-white/10">
        <p className="text-xs text-white/40">{error ?? `${selectedSpecs.length}장 선택됨 · 지도만 이미지, 나머지는 PPT에서 편집 가능`}</p>
        <button
          onClick={handleDownload}
          disabled={generating || selectedSpecs.length === 0}
          className="py-3 px-8 rounded-xl font-bold text-sm bg-[#3B82F6] hover:bg-[#2563EB] disabled:bg-gray-600 disabled:cursor-not-allowed text-white shadow-xl shadow-blue-900/40 flex items-center gap-2 transition-all active:scale-[0.98]"
        >
          {generating ? (
            <>
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              생성 중...
            </>
          ) : (
            `PPT 다운로드 (${selectedSpecs.length}장)`
          )}
        </button>
      </div>
    </div>
  );
}
```

에러 메시지 위치: 푸터의 `<p>`에 error가 있으면 에러 텍스트가 표시된다. 테스트의 `findByText(/PPT 생성에 실패했습니다/)`와 일치.

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/components/__tests__/export-preview.test.tsx`
Expected: PASS (7 tests)

- [ ] **Step 5: 커밋**

```powershell
git add src/components/export-preview.tsx src/components/__tests__/export-preview.test.tsx
git commit -m "feat: PPT 내보내기 미리보기 모달 — 썸네일 레일·슬라이드 선택·다운로드"
```

---

### Task 7: site-analysis-app 통합 — 내보내기 → 미리보기 흐름

**Files:**
- Modify: `src/components/site-analysis-app.tsx`

**Interfaces:**
- Consumes: Task 3 `buildSlides`, Task 6 `ExportPreview`, 기존 `MapViewHandle`
- Produces: 사용자 흐름 — "PPT 보고서 다운로드" 버튼 → 캡처+빌드 → 미리보기 모달 → 다운로드

- [ ] **Step 1: site-analysis-app.tsx 수정**

`handleExport`와 렌더 부분을 다음으로 교체 (import 정리 포함):

```tsx
"use client";

import { useState, useRef, useCallback } from "react";
import type { AnalysisConfig, LayerVisibility, Poi } from "@/lib/types";
import { THEME_COLORS } from "@/lib/types";
import type { MapViewHandle } from "./map-view";
import type { SlideSpec } from "@/lib/slide-spec";
import MapView from "./map-view";
import Sidebar from "./sidebar";
import ExportPreview from "./export-preview";
import {
  DEFAULT_CONFIG,
  SUBWAY_STATIONS,
  SCHOOLS,
  PARKS,
  MOUNTAINS,
  APARTMENTS,
  SUBWAY_ROUTES,
} from "@/lib/seed-data";

const ALL_POIS: readonly Poi[] = [
  ...SUBWAY_STATIONS,
  ...SCHOOLS,
  ...PARKS,
  ...MOUNTAINS,
  ...APARTMENTS,
];

export default function SiteAnalysisApp() {
  const mapRef = useRef<MapViewHandle>(null);
  const [config, setConfig] = useState<AnalysisConfig>(DEFAULT_CONFIG);
  const [layers, setLayers] = useState<LayerVisibility>({
    subway: true,
    school: true,
    park: true,
    mountain: true,
    apartment: true,
  });
  const [exporting, setExporting] = useState(false);
  const [previewSpecs, setPreviewSpecs] = useState<readonly SlideSpec[] | null>(null);

  const handleToggleLayer = useCallback((category: keyof LayerVisibility) => {
    setLayers((prev) => ({ ...prev, [category]: !prev[category] }));
  }, []);

  const handleConfigChange = useCallback((newConfig: AnalysisConfig) => {
    setConfig(newConfig);
  }, []);

  const handleExport = useCallback(async () => {
    if (!mapRef.current) return;
    setExporting(true);
    try {
      const radiusPosition = mapRef.current.getRadiusPosition();
      let baseMapImage = "";
      try {
        baseMapImage = await mapRef.current.captureBaseMap();
      } catch (err) {
        console.error("Base map capture failed:", err);
      }
      const visiblePois = ALL_POIS.filter((p) => layers[p.category]);
      const poiPositions = mapRef.current.getPoiPositions(visiblePois);
      const routePositions = mapRef.current.getRouteNormalizedPositions(SUBWAY_ROUTES);
      const { buildSlides } = await import("@/lib/slide-builder");
      setPreviewSpecs(
        buildSlides({
          config,
          pois: visiblePois,
          baseMapImage,
          poiPositions,
          radiusPosition,
          routePositions,
        })
      );
    } catch (err) {
      console.error("Slide build failed:", err);
    } finally {
      setExporting(false);
    }
  }, [layers, config]);

  return (
    <div
      className="flex h-screen w-screen flex-col overflow-hidden md:flex-row"
      style={{ backgroundColor: THEME_COLORS.overlayDark }}
    >
      <Sidebar
        config={config}
        layers={layers}
        pois={ALL_POIS}
        exporting={exporting}
        onToggleLayer={handleToggleLayer}
        onConfigChange={handleConfigChange}
        onExport={handleExport}
      />
      <main className="relative min-h-0 flex-1">
        <MapView
          ref={mapRef}
          config={config}
          pois={ALL_POIS}
          layers={layers}
          subwayRoutes={SUBWAY_ROUTES}
        />
        {exporting && (
          <div className="absolute inset-0 bg-[#0F172A]/80 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-[#1E3A8A] rounded-2xl p-10 text-center shadow-2xl border border-white/10">
              <div className="w-12 h-12 border-4 border-blue-400 border-t-white rounded-full animate-spin mx-auto mb-6" />
              <p className="text-white text-lg font-bold">미리보기 준비 중</p>
              <p className="text-blue-200/60 text-sm mt-2 font-medium">위성지도 캡처 및 슬라이드 구성 중...</p>
            </div>
          </div>
        )}
      </main>
      {previewSpecs && (
        <ExportPreview
          specs={previewSpecs}
          fileName={`${config.centerName}_사이트분석.pptx`}
          onClose={() => setPreviewSpecs(null)}
        />
      )}
    </div>
  );
}
```

변경 포인트: 캡처 실패해도 `baseMapImage=""`로 계속 진행(빌더가 warning 처리), 사이드바 버튼 문구는 그대로 두되 로딩 문구를 "미리보기 준비 중"으로 변경.

- [ ] **Step 2: 전체 테스트 + 빌드 확인**

Run: `npx vitest run && npm run build`
Expected: 테스트 전부 PASS, 빌드 성공 (Task 4에서 깨졌던 import가 이 시점에 해소됨)

- [ ] **Step 3: 커밋**

```powershell
git add src/components/site-analysis-app.tsx
git commit -m "feat: 내보내기 버튼을 미리보기 모달 흐름으로 전환"
```

---

### Task 8: 라이브 QA + 육안 대조

**Files:**
- 없음 (검증만; 발견된 버그는 수정 후 개별 커밋)

- [ ] **Step 1: 개발 서버 기동**

```powershell
npm run dev
```
(백그라운드 실행, http://localhost:3000)

- [ ] **Step 2: 헤드리스 브라우저 QA**

gstack `/browse` 스킬로 다음 시나리오 확인:

1. 페이지 로드 → 지도 표시
2. "PPT 보고서 다운로드" 클릭 → 미리보기 모달 열림 (즉시 다운로드되지 않음)
3. 썸네일 7장 표시, 각 슬라이드 제목 확인
4. 썸네일 클릭 → 메인 미리보기 전환
5. 체크박스 해제 → 버튼 카운트 감소, 전체 해제 시 버튼 비활성
6. 각 슬라이드 스크린샷 촬영 — 텍스트 겹침·잘림·대비 문제 확인
7. "PPT 다운로드" 클릭 → .pptx 다운로드 성공
8. 닫기/ESC → 모달 닫힘

- [ ] **Step 3: 디자인 결함 수정**

스크린샷에서 발견된 겹침·정렬·크기 문제를 `slide-builder.ts` 좌표/크기 조정으로 수정 (renderer/mapper는 건드리지 않는다). 수정 후 `npx vitest run` 회귀 확인.

- [ ] **Step 4: 다운로드된 .pptx 육안 검증**

다운로드된 파일을 PowerShell로 압축 해제해 슬라이드 XML에 `<a:t>`(텍스트 런), `<p:graphicFrame>`(표/차트)이 존재하는지 확인:

```powershell
Copy-Item "$env:USERPROFILE\Downloads\*사이트분석.pptx" "$env:TEMP\check.zip"
Expand-Archive "$env:TEMP\check.zip" "$env:TEMP\pptx-check" -Force
Select-String -Path "$env:TEMP\pptx-check\ppt\slides\slide3.xml" -Pattern "<a:t>" -Quiet
Get-ChildItem "$env:TEMP\pptx-check\ppt\charts"
```
Expected: `True`, chart1.xml 존재

- [ ] **Step 5: 최종 커밋**

```powershell
git add -A
git commit -m "fix: 미리보기 QA에서 발견된 디자인 조정"
```
(수정 사항이 없으면 커밋 생략)

---

## Self-Review 체크 결과

- **스펙 커버리지**: 미리보기 모달(Task 6·7), 슬라이드 선택(Task 6), 공유 모델(Task 1~5), 네이티브 요소 검증(Task 4 Step 5, Task 8 Step 4), 캡처 실패 처리(Task 2 buildMapLayer + Task 3 withWarning + Task 7), POI 0건 처리(Task 3 buildListPanel), 폰트 통일(Task 5) — 전부 매핑됨.
- **타입 일관성**: `SlideBuildInput`/`buildSlides`/`applyElement`/`createPptx`/`generatePptFromSlides`/`SlideRenderer{spec,width}`/`ExportPreviewProps` — 태스크 간 시그니처 일치 확인.
- **알려진 리스크**: pptxgenjs 3.12의 `write()` 인자 형식과 `ChartType` 접근 방식은 버전에 따라 다를 수 있음 — Task 4 Step 4·5에 대체 경로 명시. seed-data 필드명이 테스트 가정과 다르면 테스트를 데이터에 맞춰 수정(Task 3 Step 4).
