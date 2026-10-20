/** Task 9 전반부: 이미지 PDF·내보내기 전 확인·쪽 단위 래스터 회귀 테스트. */
import assert from "node:assert/strict";

const { writeImagePdf } = await import("../../lib/v2/report/pdf-writer.ts");
const { preflightReport } = await import("../../lib/v2/report/preflight.ts");
const { captureOptionsForNode, rasterizePages } = await import("../../lib/v2/report/raster-export.ts");
const { isRectOutsideBounds } = await import("../../lib/v2/report/export-runner.ts");
const { defaultFrame } = await import("../../lib/v2/report/report-doc.ts");

// ── 캡처 guard: 화면 밖 export host의 위치가 html-to-image clone에 전달되지 않아야 한다 ──
{
  const options = captureOptionsForNode({ offsetWidth: 1200, offsetHeight: 675 }, { pixelRatio: 1.5 });
  assert.equal(options.width, 1200, "capture width is explicit");
  assert.equal(options.height, 675, "capture height is explicit");
  assert.equal(options.style.position, "relative", "clone position is inside the capture box");
  assert.equal(options.style.left, "0px", "clone left offset is neutralized");
  assert.equal(options.style.top, "0px", "clone top offset is neutralized");
  assert.equal(options.style.opacity, "1", "clone is painted");
}

// ── 범례 비교: 페이지 안쪽은 통과하고 1px 초과만 넘침으로 판정한다 ──
{
  const page = { left: 100, top: 50, right: 500, bottom: 350 };
  assert.equal(isRectOutsideBounds({ left: 101, top: 51, right: 499, bottom: 349 }, page), false, "페이지 안쪽 범례");
  assert.equal(isRectOutsideBounds({ left: 100, top: 50, right: 501, bottom: 350 }, page), false, "1px 이내 tolerance");
  assert.equal(isRectOutsideBounds({ left: 100, top: 50, right: 501.01, bottom: 350 }, page), true, "페이지 밖 범례");
}

const onePixelJpeg = Uint8Array.from(Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/AP/EABQQAQAAAAAAAAAAAAAAAAAAADD/2gAIAQEAAQUCkf/EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8Bqf/EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8Bqf/EABQQAQAAAAAAAAAAAAAAAAAAADD/2gAIAQEABj8Ckf/Z",
  "base64",
));

// ── PDF: 페이지마다 JPEG XObject 하나, 판형 MediaBox, xref byte offset ──
{
  const bytes = writeImagePdf([
    { jpeg: onePixelJpeg, widthPx: 1, heightPx: 1 },
    { jpeg: onePixelJpeg, widthPx: 1, heightPx: 1 },
  ], "a3");
  const pdf = new TextDecoder("latin1").decode(bytes);
  assert.ok(pdf.startsWith("%PDF-1.4"), "PDF 1.4 header");
  assert.equal((pdf.match(/\/Type \/Page\b/g) ?? []).length, 2, "페이지 객체 수");
  assert.equal((pdf.match(/\/Subtype \/Image\b/g) ?? []).length, 2, "쪽마다 이미지 XObject 하나");
  assert.equal((pdf.match(/\/DCTDecode\b/g) ?? []).length, 2, "쪽마다 JPEG 필터 하나");
  assert.match(pdf, /\/MediaBox \[0 0 1190\.55 841\.89\]/, "A3 가로 MediaBox");
  assert.match(pdf, /startxref\n\d+\n%%EOF\s*$/, "startxref와 EOF");

  const xrefOffset = Number(pdf.match(/startxref\n(\d+)/)?.[1]);
  assert.equal(pdf.slice(xrefOffset, xrefOffset + 4), "xref", "xref 위치");
  const xrefLines = pdf.slice(xrefOffset).split("\n");
  const count = Number(xrefLines[1].split(" ")[1]);
  for (let objectNo = 1; objectNo < count; objectNo += 1) {
    const offset = Number(xrefLines[2 + objectNo].slice(0, 10));
    assert.equal(pdf.slice(offset, offset + `${objectNo} 0 obj`.length), `${objectNo} 0 obj`, `object ${objectNo} xref`);
  }
}

const page = (id, no, overrides = {}) => ({
  id,
  layout: "map-summary",
  panels: {},
  textBoxes: [],
  notes: "",
  kind: "tile",
  tileId: "t-A01",
  body: { kind: "result", face: "single" },
  view: { title: "철길 접근성" },
  map: {},
  muted: false,
  style: {},
  key: id,
  footer: "",
  no,
  total: 1,
  page: {
    id,
    layout: "map-summary",
    panels: {},
    textBoxes: [],
    notes: "",
    kind: "tile",
    tileId: "t-A01",
    part: { type: "single" },
    settings: { face: "front", callout: "overview" },
    frame: defaultFrame(),
  },
  ...overrides,
});

// ── preflight: 고정 문구·쪽 번호·정상 시 두 개의 ok ──
{
  const disabled = page("p2", 2, {
    page: {
      ...page("p2", 2).page,
      frame: { ...defaultFrame(), decorations: { north: false, scaleBar: true, locator: false } },
    },
  });
  const warning = preflightReport([disabled], new Map());
  assert.equal(warning.length, 2, "축척/방위 경고와 출처 없음 경고");
  assert.deepEqual(warning[0], {
    pageNo: 2,
    pageId: "p2",
    level: "warn",
    text: "2쪽 지도에 축척 막대나 방위표가 없습니다",
  });
  assert.equal(warning[1].text, "출처 페이지가 없습니다");

  const healthy = preflightReport([
    page("p1", 1),
    { ...page("sources", 2), kind: "sources", page: undefined, map: null },
  ], new Map([["p1", { legendOverflow: false }]]));
  assert.deepEqual(healthy.map((issue) => [issue.level, issue.text]), [
    ["ok", "모든 지도에 축척·방위표가 있습니다"],
    ["ok", "출처 페이지가 들어 있습니다"],
  ], "정상 preflight는 ok 두 개");

  const detailed = preflightReport([
    page("missing", 1, { body: { kind: "state", face: "single" }, view: { title: "대지 높이" }, missing: true }),
    page("overflow", 2),
  ], new Map([["overflow", { legendOverflow: true }]]));
  assert.ok(detailed.some((issue) => issue.text === "1쪽 대지 높이의 분석 결과가 없습니다"));
  assert.ok(detailed.some((issue) => issue.text === "2쪽 범례 한 줄이 페이지 밖으로 넘칩니다"));
}

// ── raster: 한 장씩 생성·즉시 DOM 비우기·진행률·취소 후 render 금지 ──
{
  const plan = [page("p1", 1), page("p2", 2), page("p3", 3)];
  const controller = new AbortController();
  const rendered = [];
  const renderCalls = [];
  const progress = [];
  const output = [];
  const render = async (slide) => {
    renderCalls.push(slide.key);
    const node = {
      children: [slide.key],
      cleared: false,
      replaceChildren() {
        this.children = [];
        this.cleared = true;
      },
    };
    rendered.push(node);
    return node;
  };
  const toBlob = async (node, options) => {
    assert.equal(options.pixelRatio, 150 / 96, "dpi를 pixelRatio로 전달");
    assert.equal(node.cleared, false, "이미지 생성 전 DOM 보존");
    return new Blob([node.children[0]], { type: "image/png" });
  };
  for await (const item of rasterizePages(plan, {
    dpi: 150,
    format: "wide",
    signal: controller.signal,
    render,
    toBlob,
    onProgress(done, total) {
      progress.push([done, total]);
      if (done === 2) controller.abort();
    },
  })) output.push(item);

  assert.equal(output.length, 2, "취소 전 두 쪽만 생성");
  assert.deepEqual(renderCalls, ["p1", "p2"], "취소 뒤 세 번째 render 금지");
  assert.deepEqual(progress, [[1, 3], [2, 3]], "쪽 단위 진행률");
  assert.ok(rendered.every((node) => node.cleared && node.children.length === 0), "각 쪽 직후 DOM 비우기");
}

console.log("v2 report export tests passed");
