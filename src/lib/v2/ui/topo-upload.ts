import type { TopoSummary } from "../topo/build";
import { TOPO_UPLOAD_KEEP } from "../topo/layers";

export type TopoErrorCopyCode =
  | "topo_not_topo"
  | "topo_crs"
  | "topo_outside"
  | "topo_too_large"
  | "topo_bad_zip";

export const TOPO_ERROR_COPY: Record<TopoErrorCopyCode, { title: string; body: string }> = {
  topo_not_topo: {
    title: "수치지형도 레이어를 찾지 못했습니다",
    body: "zip 안에 등고선·도로·건물 SHP가 없습니다. 국토정보플랫폼에서 연속수치지도를 SHP 형식으로 받아 압축을 풀지 않은 채 넣어 주세요. 추가 자료 없이도 분석할 수 있습니다.",
  },
  topo_crs: {
    title: "지도 위치를 읽을 수 없습니다",
    body: "좌표 정보(.prj)가 없거나 지원하지 않는 좌표계입니다. 받은 zip을 고치지 않고 그대로 넣어 주세요. 추가 자료 없이도 분석할 수 있습니다.",
  },
  topo_outside: {
    title: "이 대지 둘레의 자료가 아닙니다",
    body: "파일 범위가 대지와 분석 반경에 전혀 겹치지 않습니다. 대지를 가운데 두고 다시 받아 주세요. 추가 자료 없이도 분석할 수 있습니다.",
  },
  topo_too_large: {
    title: "파일이 너무 큽니다",
    body: "필요한 레이어만 남겨도 64 MB를 넘습니다. 범위를 줄여 다시 받아 주세요. 추가 자료 없이도 분석할 수 있습니다.",
  },
  topo_bad_zip: {
    title: "zip 파일을 열 수 없습니다",
    body: "파일이 손상됐거나 zip이 아닙니다. 다시 받아 넣어 주세요. 추가 자료 없이도 분석할 수 있습니다.",
  },
};

const GENERIC_TOPO_ERROR_MESSAGE = "수치지형도 추가 자료를 업로드하지 못했습니다. 추가 자료 없이도 분석할 수 있습니다.";

export class TopoClientError extends Error {
  readonly code: string;

  constructor(code: string, message = code) {
    super(message);
    this.name = "TopoClientError";
    this.code = code;
  }
}

type ZipEntry = {
  name: string;
  dir: boolean;
  unsafeOriginalName?: string;
  async(type: "uint8array"): Promise<Uint8Array>;
  _data?: { uncompressedSize?: unknown };
};

function entryLayerName(entryName: string): string {
  const baseName = entryName.split(/[\\/]/).pop() ?? entryName;
  const extensionIndex = baseName.lastIndexOf(".");
  return extensionIndex > 0 ? baseName.slice(0, extensionIndex) : baseName;
}

async function uncompressedSize(entry: ZipEntry): Promise<number> {
  const declared = entry._data?.uncompressedSize;
  if (typeof declared === "number" && Number.isSafeInteger(declared) && declared >= 0) return declared;
  return (await entry.async("uint8array")).byteLength;
}

/** Keep only the NGII layers used by the server and rebuild the archive in the browser. */
export async function prepareTopoZip(file: Blob): Promise<{ blob: Blob; keptLayers: string[]; droppedBytes: number }> {
  try {
    const JSZip = (await import("jszip")).default;
    const input = await JSZip.loadAsync(await file.arrayBuffer(), { checkCRC32: true });
    const entries = Object.values(input.files) as unknown as ZipEntry[];
    const output = new JSZip();
    const keptLayers: string[] = [];
    const layerNames = new Set<string>();
    let droppedBytes = 0;
    let keptCount = 0;

    for (const entry of entries) {
      if (entry.dir) continue;
      if (!TOPO_UPLOAD_KEEP(entry.name)) {
        droppedBytes += await uncompressedSize(entry);
        continue;
      }

      const content = await entry.async("uint8array");
      output.file(entry.name, content, { binary: true, compression: "DEFLATE" });
      keptCount += 1;
      const layerName = entryLayerName(entry.name);
      if (!layerNames.has(layerName)) {
        layerNames.add(layerName);
        keptLayers.push(layerName);
      }
    }

    if (keptCount === 0) throw new TopoClientError("topo_not_topo");

    const blob = await output.generateAsync({ type: "blob", compression: "DEFLATE" });
    return { blob, keptLayers, droppedBytes };
  } catch (error) {
    if (error instanceof TopoClientError) throw error;
    throw new TopoClientError("topo_bad_zip");
  }
}

function abortError(): Error {
  if (typeof DOMException !== "undefined") return new DOMException("업로드가 취소되었습니다", "AbortError");
  const error = new Error("업로드가 취소되었습니다");
  error.name = "AbortError";
  return error;
}

function responseValue(xhr: XMLHttpRequest): unknown {
  const text = typeof xhr.responseText === "string" ? xhr.responseText : "";
  if (text !== "") {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return null;
    }
  }
  return xhr.response && typeof xhr.response === "object" ? xhr.response : null;
}

function genericClientError(code: string): TopoClientError {
  return new TopoClientError(code, GENERIC_TOPO_ERROR_MESSAGE);
}

function serverError(status: number, value: unknown): TopoClientError {
  const serverCode = value && typeof value === "object" && typeof (value as { error?: unknown }).error === "string"
    ? (value as { error: string }).error
    : `topo_http_${status}`;
  if (!Object.prototype.hasOwnProperty.call(TOPO_ERROR_COPY, serverCode)) return genericClientError(serverCode);
  const copy = TOPO_ERROR_COPY[serverCode as TopoErrorCopyCode];
  return new TopoClientError(serverCode, `${copy.title}: ${copy.body}`);
}

type XhrResult = { status: number; value: unknown };

function sendTopoXhr(
  blob: Blob,
  onProgress: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<XhrResult> {
  return new Promise<XhrResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;

    const cleanup = () => {
      signal?.removeEventListener("abort", onSignalAbort);
    };
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onSignalAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        xhr.abort();
      } catch {
        // The request may have completed between the signal event and abort().
      }
      reject(abortError());
    };

    xhr.open("POST", "/site/api/v2/topo");
    xhr.withCredentials = true;
    xhr.upload.onprogress = (event) => onProgress(event.loaded, event.total);
    xhr.onload = () => finish(() => resolve({ status: xhr.status, value: responseValue(xhr) }));
    xhr.onerror = () => finish(() => reject(genericClientError("topo_network")));
    xhr.ontimeout = () => finish(() => reject(genericClientError("topo_timeout")));
    xhr.onabort = () => finish(() => reject(signal?.aborted ? abortError() : genericClientError("topo_network")));
    signal?.addEventListener("abort", onSignalAbort, { once: true });

    if (signal?.aborted) {
      onSignalAbort();
      return;
    }

    try {
      xhr.send(blob);
    } catch {
      finish(() => reject(genericClientError("topo_network")));
    }
  });
}

async function refreshSession(): Promise<boolean> {
  try {
    const response = await fetch("/site/api/auth/refresh", { method: "POST", credentials: "include" });
    return response.ok;
  } catch {
    return false;
  }
}

export async function uploadTopo(
  blob: Blob,
  onProgress: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<{ topoId: string; summary: TopoSummary }> {
  let retried = false;
  while (true) {
    if (signal?.aborted) throw abortError();
    const response = await sendTopoXhr(blob, onProgress, signal);
    if (response.status === 401 && !retried) {
      retried = true;
      if (await refreshSession()) {
        if (signal?.aborted) throw abortError();
        continue;
      }
    }
    if (response.status < 200 || response.status >= 300) throw serverError(response.status, response.value);

    if (!response.value || typeof response.value !== "object") throw genericClientError("topo_invalid_response");
    const body = response.value as { topoId?: unknown; summary?: unknown };
    if (typeof body.topoId !== "string" || body.summary === undefined) throw genericClientError("topo_invalid_response");
    return { topoId: body.topoId, summary: body.summary as TopoSummary };
  }
}
