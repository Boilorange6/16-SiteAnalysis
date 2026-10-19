import JSZip from "jszip";
import type { ReportFormat } from "./report-doc";
import type { PlannedSlide } from "./report-plan";
import type { ImagePdfPage } from "./pdf-writer";
import { writeImagePdf } from "./pdf-writer";
import { EXPORT_MIME, safeFilePart } from "../export/download";

export type ExportPurpose = "ppt" | "pdf" | "png" | "all";
export type ExportPageScope = "all" | "current" | "selected";
export type MapDrawingMode = "editable" | "image";

export type ExportFileNames = {
  downloadName: string;
  entries: string[];
  zip: boolean;
};

export type ExportProgress = (done: number, total: number) => void;

export type RasterPage = { index: number; png: Blob };

export type RasterizeForExport = (
  plan: PlannedSlide[],
  options: {
    dpi: 150 | 300;
    format: ReportFormat;
    signal?: AbortSignal;
    onProgress?: ExportProgress;
  },
) => AsyncGenerator<RasterPage>;

export type ZipEntry = { name: string; bytes: Uint8Array };

export type ExportRunnerRequest = {
  purpose: ExportPurpose;
  plan: PlannedSlide[];
  format: ReportFormat;
  fileName: string;
  mapDrawing?: MapDrawingMode;
  signal?: AbortSignal;
  onProgress?: ExportProgress;
};

export type ExportRunnerDependencies = {
  renderPptx(plan: PlannedSlide[], mapDrawing: MapDrawingMode): Promise<Uint8Array>;
  rasterize: RasterizeForExport;
  pngToJpeg(png: Blob): Promise<ImagePdfPage>;
  writePdf(pages: ImagePdfPage[], format: ReportFormat): Uint8Array;
  zip(entries: ZipEntry[]): Promise<Uint8Array>;
  download(name: string, bytes: Uint8Array | Blob, mime: string): void;
};

export type ExportRunnerResult = {
  downloaded: boolean;
  cancelled: boolean;
  fileName?: string;
};

function normalizedStem(fileName: string): string {
  const withoutExtension = fileName.trim().replace(/\.(?:pptx|pdf|png|zip)$/i, "");
  return safeFilePart(withoutExtension || "보고서");
}

function pngEntryNames(stem: string, pageCount: number): string[] {
  return Array.from({ length: pageCount }, (_, index) => `png/${stem}_${String(index + 1).padStart(2, "0")}.png`);
}

/** 목적별로 내려받을 파일과 zip 내부 이름을 결정한다. */
export function exportFileNames(fileName: string, purpose: ExportPurpose, pageCount: number): ExportFileNames {
  const stem = normalizedStem(fileName);
  const ppt = `${stem}.pptx`;
  const pdf = `${stem}.pdf`;
  const pngs = pngEntryNames(stem, pageCount);
  if (purpose === "ppt") return { downloadName: ppt, entries: [ppt], zip: false };
  if (purpose === "pdf") return { downloadName: pdf, entries: [pdf], zip: false };
  if (purpose === "png") {
    if (pageCount === 1) {
      const png = `${stem}.png`;
      return { downloadName: png, entries: [png], zip: false };
    }
    return { downloadName: `${stem}.zip`, entries: pngs, zip: true };
  }
  return { downloadName: `${stem}.zip`, entries: [ppt, pdf, ...pngs], zip: true };
}

function pageIdOf(slide: PlannedSlide): string | undefined {
  return slide.page?.id ?? slide.key;
}

function renumber(plan: PlannedSlide[]): PlannedSlide[] {
  return plan.map((slide, index) => ({ ...slide, no: index + 1, total: plan.length }));
}

/** 보고서 페이지 줄의 선택을 출력 계획으로 바꾸고, 출력 쪽 번호를 다시 매긴다. */
export function selectReportPlan(
  plan: PlannedSlide[],
  scope: ExportPageScope,
  currentPageId: string | null,
  selectedPageIds: ReadonlySet<string>,
): PlannedSlide[] {
  if (scope === "all") return renumber([...plan]);
  if (scope === "current") return renumber(plan.filter((slide) => pageIdOf(slide) === currentPageId));
  return renumber(plan.filter((slide) => {
    const pageId = pageIdOf(slide);
    return pageId !== undefined && selectedPageIds.has(pageId);
  }));
}

function aborted(signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}

export async function createZip(entries: ZipEntry[]): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const entry of entries) zip.file(entry.name, entry.bytes);
  return zip.generateAsync({ type: "uint8array" });
}

async function collectRaster(
  request: ExportRunnerRequest,
  deps: ExportRunnerDependencies,
): Promise<{ pngs: Blob[]; jpegs: ImagePdfPage[] } | null> {
  const pngs: Blob[] = [];
  const dpi: 150 | 300 = request.purpose === "pdf" || request.purpose === "all" ? 300 : 150;
  for await (const page of deps.rasterize(request.plan, {
    dpi,
    format: request.format,
    signal: request.signal,
    onProgress: request.onProgress,
  })) {
    if (aborted(request.signal)) return null;
    pngs.push(page.png);
  }
  if (aborted(request.signal) || pngs.length !== request.plan.length) return null;

  const jpegs: ImagePdfPage[] = [];
  if (request.purpose === "pdf" || request.purpose === "all") {
    for (const png of pngs) {
      if (aborted(request.signal)) return null;
      jpegs.push(await deps.pngToJpeg(png));
    }
  }
  return { pngs, jpegs };
}

async function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

/** PPT·PDF·PNG·zip 공통 실행기. 결과를 모두 만든 뒤에만 다운로드한다. */
export async function runReportExport(request: ExportRunnerRequest, deps: ExportRunnerDependencies): Promise<ExportRunnerResult> {
  if (request.plan.length === 0 || aborted(request.signal)) return { downloaded: false, cancelled: aborted(request.signal) };
  const names = exportFileNames(request.fileName, request.purpose, request.plan.length);
  const stem = normalizedStem(request.fileName);
  const mapDrawing = request.mapDrawing ?? "editable";
  let pptx: Uint8Array | null = null;
  if (request.purpose === "ppt" || request.purpose === "all") {
    request.onProgress?.(0, request.plan.length);
    pptx = await deps.renderPptx(request.plan, mapDrawing);
    if (aborted(request.signal)) return { downloaded: false, cancelled: true };
    if (request.purpose === "ppt") request.onProgress?.(request.plan.length, request.plan.length);
  }

  const raster = request.purpose === "ppt" ? null : await collectRaster(request, deps);
  if (raster === null && request.purpose !== "ppt") return { downloaded: false, cancelled: aborted(request.signal) };
  if (aborted(request.signal)) return { downloaded: false, cancelled: true };

  if (request.purpose === "ppt") {
    deps.download(names.downloadName, pptx!, EXPORT_MIME.pptx);
    return { downloaded: true, cancelled: false, fileName: names.downloadName };
  }

  const pdfBytes = request.purpose === "pdf" || request.purpose === "all"
    ? deps.writePdf(raster!.jpegs, request.format)
    : null;
  if (aborted(request.signal)) return { downloaded: false, cancelled: true };

  if (request.purpose === "pdf") {
    deps.download(names.downloadName, pdfBytes!, "application/pdf");
    return { downloaded: true, cancelled: false, fileName: names.downloadName };
  }

  const pngBytes = await Promise.all(raster!.pngs.map(blobBytes));
  if (aborted(request.signal)) return { downloaded: false, cancelled: true };
  const pngNames = pngEntryNames(stem, request.plan.length);
  if (request.purpose === "png" && request.plan.length === 1) {
    deps.download(names.downloadName, pngBytes[0]!, EXPORT_MIME.png);
    return { downloaded: true, cancelled: false, fileName: names.downloadName };
  }

  const entries: ZipEntry[] = pngNames.map((name, index) => ({ name, bytes: pngBytes[index]! }));
  if (request.purpose === "all") {
    entries.unshift({ name: `${stem}.pdf`, bytes: pdfBytes! });
    entries.unshift({ name: `${stem}.pptx`, bytes: pptx! });
  }
  const zipBytes = await deps.zip(entries);
  if (aborted(request.signal)) return { downloaded: false, cancelled: true };
  deps.download(names.downloadName, zipBytes, "application/zip");
  return { downloaded: true, cancelled: false, fileName: names.downloadName };
}

/** PNG Blob을 PDF가 요구하는 JPEG 바이트로 바꾼다. */
export async function pngBlobToJpeg(blob: Blob, quality = 0.92): Promise<ImagePdfPage> {
  let width = 0;
  let height = 0;
  let bitmap: ImageBitmap | null = null;
  let image: HTMLImageElement | null = null;
  let objectUrl: string | null = null;
  try {
    if (typeof createImageBitmap === "function") {
      bitmap = await createImageBitmap(blob);
      width = bitmap.width;
      height = bitmap.height;
    } else {
      objectUrl = URL.createObjectURL(blob);
      image = new Image();
      image.decoding = "async";
      image.src = objectUrl;
      await image.decode();
      width = image.naturalWidth;
      height = image.naturalHeight;
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("이미지 변환용 캔버스를 만들지 못했습니다");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap ?? image!, 0, 0, width, height);
    const jpeg = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((output) => output ? resolve(output) : reject(new Error("JPEG 변환에 실패했습니다")), "image/jpeg", quality);
    });
    return { jpeg: new Uint8Array(await jpeg.arrayBuffer()), widthPx: width, heightPx: height };
  } finally {
    bitmap?.close();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

/** export surface의 실제 범례 plate가 페이지 bounds를 벗어나는지 잰다. */
export function measureLegendOverflow(node: HTMLElement): boolean {
  const page = node.querySelector<HTMLElement>('[data-slide-canvas="true"]') ?? node;
  const pageRect = page.getBoundingClientRect();
  const legends = Array.from(node.querySelectorAll<HTMLElement>('[data-report-panel="legend"]'));
  const epsilon = 1;
  return legends.some((legend) => {
    const rect = legend.getBoundingClientRect();
    return rect.left < pageRect.left - epsilon || rect.right > pageRect.right + epsilon || rect.top < pageRect.top - epsilon || rect.bottom > pageRect.bottom + epsilon;
  });
}

export function defaultExportDependencies(overrides: Partial<ExportRunnerDependencies>): ExportRunnerDependencies {
  return {
    renderPptx: async () => { throw new Error("renderPptx dependency is required"); },
    rasterize: async function* () { throw new Error("rasterize dependency is required"); },
    pngToJpeg: pngBlobToJpeg,
    writePdf: writeImagePdf,
    zip: createZip,
    download: () => undefined,
    ...overrides,
  };
}
