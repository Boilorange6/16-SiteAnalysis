export const EXPORT_MIME = {
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  dxf: "application/dxf",
  glb: "model/gltf-binary",
  "3dm": "application/octet-stream",
  png: "image/png",
  svg: "image/svg+xml",
} as const;

/** Collada is kept separate so existing callers that enumerate EXPORT_MIME remain stable. */
export const DAE_MIME = "model/vnd.collada+xml";

export type ExportFormat = keyof typeof EXPORT_MIME | "dae";

export function safeFilePart(value: string): string {
  const safe = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, "_")
    // Windows strips trailing dots/spaces from a path component, so do it before composing the name.
    .replace(/[. ]+$/g, "")
    .replace(/^_+|_+$/g, "");
  return safe || "미상";
}

export function compactDate(value: string): string {
  const match = value.trim().match(/^(\d{4})[-/]?(\d{2})[-/]?(\d{2})/);
  if (!match) throw new TypeError(`analysisDate must start with YYYYMMDD or YYYY-MM-DD, got ${value}`);
  return `${match[1]}${match[2]}${match[3]}`;
}

export function mimeFor(format: string): string {
  const key = format.toLowerCase() as ExportFormat;
  const mime = key === "dae" ? DAE_MIME : EXPORT_MIME[key];
  if (!mime) throw new RangeError(`지원하지 않는 내보내기 형식: ${format}`);
  return mime;
}

export function exportFileName(format: ExportFormat, address: string, analysisDate: string): string {
  return `사이트분석_${safeFilePart(address)}_${compactDate(analysisDate)}.${format}`;
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
