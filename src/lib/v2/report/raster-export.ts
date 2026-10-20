import type { ReportFormat } from "./report-doc";
import type { PlannedSlide } from "./report-plan";

export type RasterToBlob = (node: HTMLElement, options: { pixelRatio: number }) => Promise<Blob | null>;

type CaptureNodeSize = Pick<HTMLElement, "offsetWidth" | "offsetHeight"> & {
  getBoundingClientRect?: () => { width: number; height: number };
};

export type RasterCaptureOptions = {
  pixelRatio: number;
  width: number;
  height: number;
  style: Partial<CSSStyleDeclaration>;
};

export type RasterizePagesOptions = {
  dpi: 150 | 300;
  format: ReportFormat;
  signal?: AbortSignal;
  onProgress?(done: number, total: number): void;
  render(slide: PlannedSlide): Promise<HTMLElement>;
  toBlob?: RasterToBlob;
  dispose?(node: HTMLElement): void;
};

/** html-to-image clone이 화면 밖 host의 inline 위치를 이어받지 않게 한다. */
export function captureOptionsForNode(node: CaptureNodeSize, options: { pixelRatio: number }): RasterCaptureOptions {
  const measured = node.getBoundingClientRect?.();
  const width = Math.max(1, Math.round(node.offsetWidth || measured?.width || 1));
  const height = Math.max(1, Math.round(node.offsetHeight || measured?.height || 1));
  return {
    ...options,
    width,
    height,
    style: {
      position: "relative",
      left: "0px",
      top: "0px",
      right: "auto",
      bottom: "auto",
      margin: "0px",
      width: `${width}px`,
      height: `${height}px`,
      opacity: "1",
    },
  };
}

const EXPORT_READY_TIMEOUT_MS = 4000;

function nextFrame(): Promise<void> {
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  if (timeoutMs <= 0) return undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function waitForHtmlImage(image: HTMLImageElement, deadline: number): Promise<void> {
  if (image.complete) return Promise.resolve();
  const remaining = deadline - Date.now();
  if (remaining <= 0) return Promise.resolve();
  const settled = new Promise<void>((resolve) => {
    const finish = () => {
      image.removeEventListener("load", finish);
      image.removeEventListener("error", finish);
      resolve();
    };
    image.addEventListener("load", finish, { once: true });
    image.addEventListener("error", finish, { once: true });
  });
  const decoded = typeof image.decode === "function"
    ? image.decode().catch(() => undefined)
    : Promise.resolve();
  return waitWithTimeout(Promise.race([decoded, settled]), remaining).then(() => undefined);
}

function waitForSvgImage(image: SVGImageElement, deadline: number): Promise<void> {
  const href = image.getAttribute("href") ?? image.getAttributeNS("http://www.w3.org/1999/xlink", "href");
  if (!href) return Promise.resolve();
  const remaining = deadline - Date.now();
  if (remaining <= 0) return Promise.resolve();
  const settled = new Promise<void>((resolve) => {
    const finish = () => {
      image.removeEventListener("load", finish);
      image.removeEventListener("error", finish);
      resolve();
    };
    image.addEventListener("load", finish, { once: true });
    image.addEventListener("error", finish, { once: true });
  });
  // SVGImageElement has no cross-browser decode() contract. A same-document
  // probe still decodes data URLs and same-origin/proxy tiles, while the
  // original load/error event covers the SVG resource itself.
  const probe = new Image();
  probe.decoding = "async";
  probe.src = href;
  const decoded = typeof probe.decode === "function"
    ? probe.decode().catch(() => undefined)
    : new Promise<void>((resolve) => {
        probe.addEventListener("load", () => resolve(), { once: true });
        probe.addEventListener("error", () => resolve(), { once: true });
      });
  return waitWithTimeout(Promise.race([decoded, settled]), remaining).then(() => undefined);
}

async function waitForImages(node: HTMLElement, deadline: number): Promise<void> {
  if (typeof node.querySelectorAll !== "function" || typeof Image === "undefined") return;
  const htmlImages = Array.from(node.querySelectorAll<HTMLImageElement>("img"));
  const svgImages = Array.from(node.querySelectorAll<SVGImageElement>("image"));
  await Promise.all([
    ...htmlImages.map((image) => waitForHtmlImage(image, deadline)),
    ...svgImages.map((image) => waitForSvgImage(image, deadline)),
  ]);
}

async function waitForFonts(deadline: number): Promise<void> {
  if (typeof document === "undefined" || !document.fonts?.ready) return;
  await waitWithTimeout(document.fonts.ready, deadline - Date.now());
}

async function waitForFrameLayout(node: HTMLElement, deadline: number): Promise<void> {
  const frame = node.querySelector<HTMLElement>('[data-preview-frame="true"]');
  if (!frame || typeof frame.getBoundingClientRect !== "function") return;
  while (Date.now() < deadline) {
    const rect = frame.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return;
    await nextFrame();
  }
  throw new Error("내보낼 쪽의 크기를 계산하지 못했습니다");
}

/** 캡처 전 폰트·이미지·SlideSurface frame 레이아웃을 안정시킨다. */
export async function waitForExportSurface(node: HTMLElement, timeoutMs = EXPORT_READY_TIMEOUT_MS): Promise<void> {
  if (typeof document === "undefined") return;
  const deadline = Date.now() + timeoutMs;
  await waitForFonts(deadline);
  await waitForFrameLayout(node, deadline);
  await waitForImages(node, deadline);
  await nextFrame();
}

async function defaultToBlob(node: HTMLElement, options: { pixelRatio: number }): Promise<Blob | null> {
  const { toBlob } = await import("html-to-image");
  return toBlob(node, captureOptionsForNode(node, options));
}

function emptyDom(node: HTMLElement): void {
  if (typeof node.replaceChildren === "function") node.replaceChildren();
  else node.innerHTML = "";
}

/** 화면 밖에서 쪽을 하나씩 이미지로 만들고, 완료한 쪽의 DOM을 즉시 비운다. */
export async function* rasterizePages(
  plan: PlannedSlide[],
  opts: RasterizePagesOptions,
): AsyncGenerator<{ index: number; png: Blob }> {
  const total = plan.length;
  const toBlob = opts.toBlob ?? defaultToBlob;
  const pixelRatio = opts.dpi / 96;

  for (const [index, slide] of plan.entries()) {
    if (opts.signal?.aborted) return;
    const node = await opts.render(slide);
    let png: Blob | null = null;
    try {
      if (opts.signal?.aborted) return;
      await waitForExportSurface(node);
      if (opts.signal?.aborted) return;
      png = await toBlob(node, { pixelRatio });
    } finally {
      // React 루트가 그린 노드는 루트를 먼저 내려야 한다. 직접 비우면 해제 중 removeChild 오류가 난다.
      if (opts.dispose) opts.dispose(node);
      else emptyDom(node);
    }
    if (opts.signal?.aborted) return;
    if (!png) throw new Error(`${index + 1}쪽 이미지 생성에 실패했습니다`);
    opts.onProgress?.(index + 1, total);
    yield { index, png };
  }
}
