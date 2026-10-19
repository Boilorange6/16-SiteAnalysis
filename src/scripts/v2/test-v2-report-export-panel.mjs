/** Task 9 후반부: pure report export runner 계약 회귀 테스트. */
import assert from "node:assert/strict";
import JSZip from "jszip";

const { exportFileNames, selectReportPlan, runReportExport } = await import("../../lib/v2/report/export-runner.ts");

const makeSlide = (key, pageId, no = 0, total = 0) => ({
  key,
  page: { id: pageId },
  no,
  total,
});

const planSummary = (plan) => plan.map((slide) => [slide.page.id, slide.no, slide.total]);

// ── 파일명: 목적별 단일 파일·PNG 폴더·all 묶음 이름 ──
{
  const names = (purpose, pageCount) => {
    const { downloadName, entries } = exportFileNames("site-report.pptx", purpose, pageCount);
    return { downloadName, entries };
  };

  assert.deepEqual(names("ppt", 3), {
    downloadName: "site-report.pptx",
    entries: ["site-report.pptx"],
  }, "PPT는 pptx 하나를 내려받는다");
  assert.deepEqual(names("pdf", 3), {
    downloadName: "site-report.pdf",
    entries: ["site-report.pdf"],
  }, "PDF는 pdf 하나를 내려받는다");
  assert.deepEqual(names("png", 1), {
    downloadName: "site-report.png",
    entries: ["site-report.png"],
  }, "PNG 한 쪽은 단일 png다");
  assert.deepEqual(names("png", 2), {
    downloadName: "site-report.zip",
    entries: ["png/site-report_01.png", "png/site-report_02.png"],
  }, "PNG 여러 쪽은 png 폴더 ZIP이다");
  assert.deepEqual(names("all", 3), {
    downloadName: "site-report.zip",
    entries: [
      "site-report.pptx",
      "site-report.pdf",
      "png/site-report_01.png",
      "png/site-report_02.png",
      "png/site-report_03.png",
    ],
  }, "all은 PPT·PDF·PNG 엔트리를 한 ZIP에 담는다");
}

// ── 선택: page.id 기준 필터 후 출력 쪽 번호를 1..n으로 재번호 ──
{
  const plan = [
    makeSlide("key-a", "page-a"),
    makeSlide("key-b", "page-b"),
    makeSlide("key-c", "page-c"),
  ];

  assert.deepEqual(planSummary(selectReportPlan(plan, "all", null, new Set())), [
    ["page-a", 1, 3],
    ["page-b", 2, 3],
    ["page-c", 3, 3],
  ], "all은 전체 순서를 유지하고 재번호한다");
  assert.deepEqual(planSummary(selectReportPlan(plan, "current", "page-b", new Set())), [
    ["page-b", 1, 1],
  ], "current는 page.id 하나만 남긴다");
  assert.deepEqual(planSummary(selectReportPlan(plan, "selected", null, new Set(["page-c", "page-a"]))), [
    ["page-a", 1, 2],
    ["page-c", 2, 2],
  ], "selected는 page.id로 고르고 원래 순서를 유지한다");
}

// ── ZIP + PDF: all 결과를 실제 JSZip으로 읽고 PDF에 고유 JPEG 바이트가 전달되는지 확인 ──
{
  const plan = [makeSlide("key-1", "page-1"), makeSlide("key-2", "page-2"), makeSlide("key-3", "page-3")];
  const expectedPptx = Uint8Array.from([0x50, 0x50, 0x54]);
  const expectedPdf = Uint8Array.from([0x25, 0x50, 0x44, 0x46]);
  const expectedJpegs = [
    Uint8Array.from([0xff, 0xd8, 0x11]),
    Uint8Array.from([0xff, 0xd8, 0x22]),
    Uint8Array.from([0xff, 0xd8, 0x33]),
  ];
  const expectedNames = [
    "site-report.pptx",
    "site-report.pdf",
    "png/site-report_01.png",
    "png/site-report_02.png",
    "png/site-report_03.png",
  ];
  const zipCalls = [];
  let downloaded = null;
  let conversionCount = 0;

  const result = await runReportExport({
    purpose: "all",
    plan,
    format: "wide",
    fileName: "site-report.pptx",
    mapDrawing: "editable",
  }, {
    renderPptx: async (slides, mapDrawing) => {
      assert.equal(slides.length, 3, "PPT renderer receives all selected pages");
      assert.equal(mapDrawing, "editable", "PPT renderer receives map drawing mode");
      return expectedPptx;
    },
    rasterize: async function* (slides, options) {
      assert.equal(options.dpi, 300, "all uses PDF-quality rasterization");
      for (const [index] of slides.entries()) {
        options.onProgress?.(index + 1, slides.length);
        yield { index, png: new Blob([Uint8Array.of([0x11, 0x22, 0x33][index])], { type: "image/png" }) };
      }
    },
    pngToJpeg: async (png) => {
      const marker = new Uint8Array(await png.arrayBuffer())[0];
      const jpeg = Uint8Array.from([0xff, 0xd8, marker]);
      conversionCount += 1;
      return { jpeg, widthPx: 1, heightPx: 1 };
    },
    writePdf: (pages, format) => {
      assert.equal(format, "wide", "PDF writer receives the report format");
      assert.deepEqual(pages.map(({ jpeg }) => Array.from(jpeg)), expectedJpegs.map((jpeg) => Array.from(jpeg)), "PDF writer receives converted JPEG bytes in page order");
      return expectedPdf;
    },
    zip: async (entries) => {
      zipCalls.push(entries.map(({ name }) => name));
      const archive = new JSZip();
      for (const entry of entries) archive.file(entry.name, entry.bytes);
      return archive.generateAsync({ type: "uint8array" });
    },
    download: (name, bytes, mime) => {
      downloaded = { name, bytes: new Uint8Array(bytes), mime };
    },
  });

  assert.deepEqual(result, { downloaded: true, cancelled: false, fileName: "site-report.zip" }, "all export completes once");
  assert.equal(conversionCount, 3, "각 PNG가 한 번씩 JPEG로 변환된다");
  assert.deepEqual(zipCalls, [expectedNames], "ZIP writer receives the PPTX/PDF/png entry names");
  assert.deepEqual(downloaded && { name: downloaded.name, mime: downloaded.mime }, {
    name: "site-report.zip",
    mime: "application/zip",
  }, "all은 ZIP으로 다운로드한다");

  assert.ok(downloaded, "all 다운로드 바이트");
  const archive = await JSZip.loadAsync(downloaded.bytes);
  const actualNames = Object.values(archive.files)
    .filter((entry) => !entry.dir)
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(actualNames, [...expectedNames].sort(), "JSZip으로 읽은 all ZIP 엔트리 이름");
}

// ── 취소: 3쪽 중 done=2에서 abort하면 세 번째 raster render와 download를 하지 않는다 ──
{
  const plan = [makeSlide("key-1", "page-1"), makeSlide("key-2", "page-2"), makeSlide("key-3", "page-3")];
  const controller = new AbortController();
  const renderCalls = [];
  const progress = [];
  let downloadCalls = 0;

  const result = await runReportExport({
    purpose: "png",
    plan,
    format: "wide",
    fileName: "cancelled-report",
    signal: controller.signal,
    onProgress(done, total) {
      progress.push([done, total]);
      if (done === 2) controller.abort();
    },
  }, {
    renderPptx: async () => { throw new Error("취소된 PNG export는 PPT를 렌더하지 않아야 한다"); },
    rasterize: async function* (slides, options) {
      for (const [index, slide] of slides.entries()) {
        if (options.signal?.aborted) return;
        renderCalls.push(slide.page.id);
        options.onProgress?.(index + 1, slides.length);
        yield { index, png: new Blob([Uint8Array.of(index + 1)], { type: "image/png" }) };
      }
    },
    pngToJpeg: async () => { throw new Error("PNG export는 PDF 변환을 호출하지 않아야 한다"); },
    writePdf: () => { throw new Error("취소된 PNG export는 PDF를 쓰지 않아야 한다"); },
    zip: async () => { throw new Error("취소된 export는 ZIP을 쓰지 않아야 한다"); },
    download: () => { downloadCalls += 1; },
  });

  assert.deepEqual(result, { downloaded: false, cancelled: true }, "취소된 export는 산출물을 내려받지 않는다");
  assert.deepEqual(renderCalls, ["page-1", "page-2"], "done=2 취소 뒤 세 번째 raster render 금지");
  assert.deepEqual(progress, [[1, 3], [2, 3]], "3쪽 진행률이 두 쪽까지만 보고된다");
  assert.equal(downloadCalls, 0, "취소 뒤 download 금지");
}

console.log("v2 report export panel tests passed");
