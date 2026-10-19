import type { ReportFormat } from "./report-doc";
import type { PlannedSlide } from "./report-plan";

export type RasterToBlob = (node: HTMLElement, options: { pixelRatio: number }) => Promise<Blob | null>;

export type RasterizePagesOptions = {
  dpi: 150 | 300;
  format: ReportFormat;
  signal?: AbortSignal;
  onProgress?(done: number, total: number): void;
  render(slide: PlannedSlide): Promise<HTMLElement>;
  toBlob?: RasterToBlob;
  dispose?(node: HTMLElement): void;
};

async function defaultToBlob(node: HTMLElement, options: { pixelRatio: number }): Promise<Blob | null> {
  const { toBlob } = await import("html-to-image");
  return toBlob(node, options);
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
      png = await toBlob(node, { pixelRatio });
    } finally {
      emptyDom(node);
      opts.dispose?.(node);
    }
    if (opts.signal?.aborted) return;
    if (!png) throw new Error(`${index + 1}쪽 이미지 생성에 실패했습니다`);
    opts.onProgress?.(index + 1, total);
    yield { index, png };
  }
}
