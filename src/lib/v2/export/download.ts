export const EXPORT_MIME = {
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  dxf: "application/dxf",
  glb: "model/gltf-binary",
  "3dm": "application/octet-stream",
} as const;

/** Collada is kept separate so existing callers that enumerate EXPORT_MIME remain stable. */
export const DAE_MIME = "model/vnd.collada+xml";

export type ExportFormat = keyof typeof EXPORT_MIME | "dae";

export function mimeFor(format: string): string {
  const key = format.toLowerCase() as ExportFormat;
  const mime = key === "dae" ? DAE_MIME : EXPORT_MIME[key];
  if (!mime) throw new RangeError(`지원하지 않는 내보내기 형식: ${format}`);
  return mime;
}

function safeAddress(address: string): string {
  return address.replace(/[\\/:*?"<>|\s]+/g, "_").replace(/^_+|_+$/g, "") || "미상";
}

export function exportFileName(format: ExportFormat, address: string, analysisDate: string): string {
  return `사이트분석_${safeAddress(address)}_${analysisDate.replace(/-/g, "")}.${format}`;
}

/** 브라우저 다운로드 동작만 담당한다. 변환기나 서버 상태를 조회하지 않는다. */
export function downloadBytes(name: string, bytes: Uint8Array | string, mime: string): void {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
