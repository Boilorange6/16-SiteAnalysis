import type { RasterRef } from "../tile-result";
import { maxOf } from "../extent";
import { rotateFromWindFrame } from "../sim/wind-frame";
import { webgpuAvailable, type WebGpuAvailability } from "../sim/lbm3d/gpu";
import { planGrid, voxelize, type Lbm3dCase } from "../sim/lbm3d/plan";
import type { Lbm3dField } from "../sim/lbm3d/cpu-ref";
import type { Lbm3dWorkerMessage } from "../sim/lbm3d/worker";
import { inflateRaster } from "./raster-image";
import type { TileView } from "./tile-view";

export const WIND_SEASONS = ["annual", "spring", "summer", "autumn", "winter"] as const;
export type WindSeason = (typeof WIND_SEASONS)[number];
export const WIND_LAYER_HEIGHTS = [2, 6, 10, 14, 22, 30] as const;
export const WIND_RAW_SCALE = 0.001;
export const WIND_BUFFER_M = 200;

type WindMap = NonNullable<TileView["map"]> & { rasterOptions?: RasterRef[] };

export type WindUploadProgress = {
  phase: "case" | "gpu" | "rotate" | "compress" | "upload";
  step?: number;
  steps?: number;
  mlups?: number;
  elapsedMs?: number;
};

export type WindUploadResult = {
  season: WindSeason;
  field: Lbm3dField;
  planReason: string | null;
  response: Record<string, unknown>;
};

const DEFAULT_LIMITS = {
  maxBufferSize: 2 * 1024 ** 3,
  maxStorageBufferBindingSize: 1 * 1024 ** 3,
  maxStorageBuffersPerShaderStage: 8,
};

function windMapOf(view: TileView): WindMap | null {
  return view.map as WindMap | null;
}

export function windRasterName(view: TileView, layerZ: number): string | null {
  const map = windMapOf(view);
  if (!map) return null;
  const refs = map.rasterOptions ?? map.rasters ?? [];
  const suffix = `_z${String(Math.round(layerZ)).padStart(2, "0")}`;
  const preferred = refs.find((ref) => ref.name === `wind_annual${suffix}`);
  return preferred?.name ?? refs.find((ref) => ref.name.startsWith("wind_") && ref.name.endsWith(suffix))?.name ?? null;
}

function obstacleRefOf(view: TileView): RasterRef | null {
  const map = windMapOf(view);
  if (!map) return null;
  const refs = map.rasterOptions ?? map.rasters ?? [];
  return refs.find((ref) => ref.name === "obstacle_height") ?? null;
}

function normalizedDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

const DIRECTION_NAMES = [
  "북(N)", "북북동(NNE)", "북동(NE)", "동북동(ENE)",
  "동(E)", "동남동(ESE)", "남동(SE)", "남남동(SSE)",
  "남(S)", "남남서(SSW)", "남서(SW)", "서남서(WSW)",
  "서(W)", "서북서(WNW)", "북서(NW)", "북북서(NNW)",
] as const;

export function windDirectionLabel(degrees: number | null): string {
  if (degrees === null || !Number.isFinite(degrees)) return "풍향 미상";
  const index = Math.round(normalizedDegrees(degrees) / 22.5) % DIRECTION_NAMES.length;
  return DIRECTION_NAMES[index] ?? "풍향 미상";
}

/** S03 작업/결과 조건을 우선 읽고, 구형 결과에서는 계절 지표를 보조로 읽는다. */
export function windDirectionFromView(view: TileView, season: WindSeason, fallback: number | null = null): number | null {
  const declared = view.windDirections?.[season];
  if (typeof declared === "number" && Number.isFinite(declared)) return normalizedDegrees(declared);
  const row = view.rows.find((candidate) => candidate.label.toLowerCase().includes(season) && candidate.label.includes("유입 풍향"));
  if (!row) return fallback;
  const match = row.value.match(/-?\d+(?:\.\d+)?/);
  const degrees = match ? Number(match[0]) : Number.NaN;
  return Number.isFinite(degrees) ? normalizedDegrees(degrees) : fallback;
}

function obstacleMaxM(values: Uint16Array, ref: RasterRef): number {
  const maximum = maxOf(values);
  return Math.max(0, maximum * ref.scale + ref.offset);
}

function caseFor(
  obstacle: Uint16Array,
  ref: RasterRef,
  availability: WebGpuAvailability,
  inflowFromDeg: number,
  onProgress?: (progress: WindUploadProgress) => void,
): { simulation: Lbm3dCase; planReason: string | null } {
  const limits = availability.limits ?? DEFAULT_LIMITS;
  const plan = planGrid({
    radiusM: Math.max(ref.cellM, ref.cols * ref.cellM / 2 - WIND_BUFFER_M),
    bufferM: WIND_BUFFER_M,
    maxObstacleM: obstacleMaxM(obstacle, ref),
    limits,
    f16: availability.f16 === true,
  });
  if (plan.cellM !== ref.cellM || plan.nx !== ref.cols || plan.ny !== ref.rows) {
    throw new Error(`WebGPU 사례 격자와 장애물 래스터가 맞지 않습니다(${plan.cellM}m ${plan.nx}×${plan.ny} / ${ref.cellM}m ${ref.cols}×${ref.rows})`);
  }
  const solid = voxelize(
    obstacle,
    { nx: ref.cols, ny: ref.rows, nz: plan.nz, cellM: ref.cellM },
    normalizedDegrees(inflowFromDeg),
    plan,
  );
  const steps = Math.max(1, Math.ceil((plan.nx / 0.06) * 1.6));
  onProgress?.({ phase: "case" });
  return {
    planReason: plan.reason,
    simulation: {
      nx: plan.nx,
      ny: plan.ny,
      nz: plan.nz,
      cellM: plan.cellM,
      solid,
      uLattice: 0.06,
      profileAlpha: 0.25,
      zRefM: 10,
      cs: 0.16,
      tau0: 0.8,
      steps,
      averageFrom: Math.floor(steps * 0.6),
      layersZm: [...WIND_LAYER_HEIGHTS],
    },
  };
}

function abortError(): Error {
  const error = new Error("WebGPU wind run aborted");
  error.name = "AbortError";
  return error;
}

function runWorker(
  simulation: Lbm3dCase,
  signal: AbortSignal | undefined,
  onProgress: (progress: WindUploadProgress) => void,
): Promise<Lbm3dField> {
  if (typeof Worker === "undefined") return Promise.reject(new Error("Web Worker를 사용할 수 없습니다"));
  const worker = new Worker(new URL("../sim/lbm3d/worker.ts", import.meta.url), { type: "module" });
  const id = `wind-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return new Promise<Lbm3dField>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      worker.terminate();
      callback();
    };
    const onAbort = () => {
      worker.postMessage({ type: "cancel", id });
      finish(() => reject(abortError()));
    };
    worker.onmessage = (event: MessageEvent<Lbm3dWorkerMessage>) => {
      const message = event.data;
      if (message.id !== id) return;
      if (message.type === "progress") {
        onProgress({ phase: "gpu", step: message.step, steps: message.steps, mlups: message.mlups, elapsedMs: message.elapsedMs });
      } else if (message.type === "result") {
        finish(() => resolve(message.field));
      } else {
        const error = new Error(message.message);
        error.name = message.name;
        finish(() => reject(error));
      }
    };
    worker.onerror = (event) => finish(() => reject(new Error(event.message || "WebGPU worker 실행에 실패했습니다")));
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    worker.postMessage({ type: "run", id, case: simulation }, [simulation.solid.buffer]);
  });
}

function interleaveAndRotate(field: Lbm3dField, ref: RasterRef, inflowFromDeg: number, onProgress?: (progress: WindUploadProgress) => void): Int16Array {
  const cells = ref.cols * ref.rows;
  const values = new Int16Array(cells * field.layers.length * 2);
  for (let layerIndex = 0; layerIndex < field.layers.length; layerIndex += 1) {
    const layer = field.layers[layerIndex];
    const rotated = rotateFromWindFrame({
      nx: field.nx,
      ny: field.ny,
      u: layer.u,
      v: layer.v,
      cellM: field.cellM,
      originX: ref.x0,
      originY: ref.y0,
    }, normalizedDegrees(inflowFromDeg));
    for (let cell = 0; cell < cells; cell += 1) {
      const u = rotated.u[cell] ?? Number.NaN;
      const v = rotated.v[cell] ?? Number.NaN;
      const target = (layerIndex * cells + cell) * 2;
      if (!Number.isFinite(u) || !Number.isFinite(v)) continue;
      if (Math.hypot(u, v) > 5) throw new Error("WebGPU 바람 결과가 허용된 상대풍속 범위를 벗어났습니다");
      values[target] = Math.max(-5000, Math.min(5000, Math.round(u / WIND_RAW_SCALE)));
      values[target + 1] = Math.max(-5000, Math.min(5000, Math.round(v / WIND_RAW_SCALE)));
    }
    onProgress?.({ phase: "rotate", step: layerIndex + 1, steps: field.layers.length });
  }
  return values;
}

async function deflate(values: Int16Array): Promise<Uint8Array> {
  if (typeof CompressionStream === "undefined") throw new Error("deflate-raw 압축을 지원하지 않는 브라우저입니다");
  const source = new Uint8Array(values.slice().buffer);
  const stream = new Blob([source]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function uploadBody(header: Record<string, unknown>, values: Int16Array): Promise<Uint8Array> {
  const compressed = await deflate(values);
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const body = new Uint8Array(4 + headerBytes.length + compressed.length);
  new DataView(body.buffer).setUint32(0, headerBytes.length, true);
  body.set(headerBytes, 4);
  body.set(compressed, 4 + headerBytes.length);
  return body;
}

async function obstacleValuesFor(view: TileView, fetchImpl: typeof fetch): Promise<{ ref: RasterRef; values: Uint16Array }> {
  const ref = obstacleRefOf(view);
  const analysisId = view.map?.analysisId;
  const tileCode = view.map?.tileCode ?? view.code;
  if (!ref || !analysisId) throw new Error("실제 분석의 S03 장애물 사례가 필요합니다");
  const response = await fetchImpl(`/site/api/v2/analyses/${encodeURIComponent(analysisId)}/tiles/${encodeURIComponent(tileCode)}/rasters/${encodeURIComponent(ref.name)}`, { credentials: "same-origin" });
  if (!response.ok) throw new Error(`S03 장애물 사례를 받지 못했습니다(${response.status})`);
  const values = await inflateRaster(ref, await response.arrayBuffer());
  if (!(values instanceof Uint16Array)) throw new Error("S03 장애물 사례 형식이 u16이 아닙니다");
  return { ref, values };
}

export async function runWindUpload(options: {
  view: TileView;
  season: WindSeason;
  inflowFromDeg?: number;
  availability?: WebGpuAvailability;
  signal?: AbortSignal;
  onProgress?: (progress: WindUploadProgress) => void;
  fetchImpl?: typeof fetch;
}): Promise<WindUploadResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const availability = options.availability ?? await webgpuAvailable();
  if (!availability.ok) throw new Error(availability.reason ?? "이 브라우저는 WebGPU를 지원하지 않습니다");
  const requestedDirection = options.inflowFromDeg ?? windDirectionFromView(options.view, options.season);
  if (requestedDirection === null || !Number.isFinite(requestedDirection)) {
    throw new Error(`S03 ${options.season} 유입 풍향을 확인할 수 없습니다`);
  }
  const inflowFromDeg = normalizedDegrees(requestedDirection);
  const { ref, values: obstacle } = await obstacleValuesFor(options.view, fetchImpl);
  const { simulation, planReason } = caseFor(obstacle, ref, availability, inflowFromDeg, options.onProgress);
  const field = await runWorker(simulation, options.signal, options.onProgress ?? (() => undefined));
  const northAligned = interleaveAndRotate(field, ref, inflowFromDeg, options.onProgress);
  options.onProgress?.({ phase: "compress" });
  const header = {
    season: options.season,
    model: "lbm-d3q19-les@1",
    cellM: field.cellM,
    cols: field.nx,
    rows: field.ny,
    layersZm: field.layers.map((layer) => layer.zM),
    dtype: "i16",
    scale: WIND_RAW_SCALE,
    steps: field.steps,
    elapsedMs: field.elapsedMs,
    adapter: field.adapter.slice(0, 200),
    precision: field.precision,
    mlups: field.mlups,
    planReason,
    caseSha256: ref.sha256,
  } satisfies Record<string, unknown>;
  const body = await uploadBody(header, northAligned);
  options.onProgress?.({ phase: "upload" });
  const analysisId = options.view.map?.analysisId;
  if (!analysisId) throw new Error("실제 분석 ID가 없어 바람 결과를 업로드할 수 없습니다");
  const response = await fetchImpl(`/site/api/v2/analyses/${encodeURIComponent(analysisId)}/wind/${options.season}`, {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/octet-stream" },
    body: body.buffer as ArrayBuffer,
    signal: options.signal,
  });
  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : `바람 결과 업로드 실패(${response.status})`);
  return { season: options.season, field, planReason, response: result };
}

export async function requestWindFallback(
  analysisId: string,
  reason: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(`/site/api/v2/analyses/${encodeURIComponent(analysisId)}/wind/fallback`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason: reason.slice(0, 200) }),
  });
  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : `2D 대체 계산 요청 실패(${response.status})`);
  return result;
}
