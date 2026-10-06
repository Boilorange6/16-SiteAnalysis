import { d3q19KernelWgsl, d3q19RolloverWgsl } from "./kernels.wgsl";
import { D3Q19_VELOCITIES, type Lbm3dCase } from "./plan";
import { equilibriumDistribution, inflowProfile, type Lbm3dConvergenceReport, type Lbm3dField, type Lbm3dLayer } from "./cpu-ref";

export type { Lbm3dConvergenceReport, Lbm3dField, Lbm3dLayer } from "./cpu-ref";

export interface WebGpuAvailability {
  ok: boolean;
  reason: string | null;
  adapter?: string;
  limits?: {
    maxBufferSize: number;
    maxStorageBufferBindingSize: number;
    maxStorageBuffersPerShaderStage: number;
    maxComputeWorkgroupsPerDimension: number;
  };
  f16?: boolean;
}

/**
 * Convergence-based early stop of the time average. The averaging window is
 * cut into blocks of {@link AVERAGE_BLOCK_STEPS} steps; after every block the
 * relative L2 change of the mean field over the requested output layers is
 * computed on the GPU. The run stops when `consecutive` successive residuals
 * are below `epsilon` and at least `minBlocks` blocks are averaged.
 */
export interface Lbm3dConvergence {
  /** Relative L2 change of the running window mean that counts as converged. */
  epsilon: number;
  /**
   * Spin-up detector: the averaging window opens once the change between
   * consecutive block means stays below this for `consecutive` blocks (or
   * when `averageFrom` is reached, whichever comes first). Default 5 x epsilon.
   */
  spinupEpsilon?: number;
  /** Minimum blocks in the averaging window before stopping is allowed (default 3). */
  minBlocks?: number;
  /** Successive residuals below the threshold required (default 2). */
  consecutive?: number;
  /** Record the residual curves but never stop. */
  trace?: boolean;
}

export interface Lbm3dRunOptions {
  onProgress?: (p: { step: number; steps: number; mlups: number; elapsedMs: number }) => void;
  signal?: AbortSignal;
  /** Defaults to auto: use shader-f16 when the adapter exposes it. */
  precision?: "auto" | "f16" | "f32";
  convergence?: Lbm3dConvergence;
  workgroupSize?: 32 | 64 | 128 | 256;
  /** Upper bound of steps recorded into one GPU submission (default scales with the grid). */
  maxStepsPerSubmit?: number;
}

interface GpuAdapterLike {
  name?: string;
  info?: { vendor?: string; architecture?: string; device?: string; description?: string };
  features?: { has: (feature: string) => boolean };
  limits: Record<string, number>;
  requestDevice: (descriptor?: Record<string, unknown>) => Promise<GpuDeviceLike>;
}

interface GpuDeviceLostInfo {
  reason?: string;
  message?: string;
}

interface GpuBindEntry {
  binding: number;
  resource: { buffer: GpuBufferLike; offset?: number; size?: number };
}

interface GpuDeviceLike {
  limits: Record<string, number>;
  lost: Promise<GpuDeviceLostInfo>;
  createShaderModule: (descriptor: { code: string }) => unknown;
  createBindGroupLayout: (descriptor: { entries: Array<Record<string, unknown>> }) => unknown;
  createPipelineLayout: (descriptor: { bindGroupLayouts: unknown[] }) => unknown;
  createComputePipeline: (descriptor: Record<string, unknown>) => GpuPipelineLike;
  createBuffer: (descriptor: { size: number; usage: number; mappedAtCreation?: boolean }) => GpuBufferLike;
  createBindGroup: (descriptor: { layout: unknown; entries: GpuBindEntry[] }) => unknown;
  createCommandEncoder: () => GpuCommandEncoderLike;
  queue: GpuQueueLike;
  pushErrorScope: (filter: "out-of-memory" | "validation" | "internal") => void;
  popErrorScope: () => Promise<{ message?: string } | null>;
}

interface GpuPipelineLike {
  getBindGroupLayout: (index: number) => unknown;
}

interface GpuBufferLike {
  mapAsync: (mode: number) => Promise<void>;
  getMappedRange: () => ArrayBuffer;
  unmap: () => void;
  destroy: () => void;
}

interface GpuCommandEncoderLike {
  beginComputePass: () => GpuComputePassLike;
  copyBufferToBuffer: (source: GpuBufferLike, sourceOffset: number, destination: GpuBufferLike, destinationOffset: number, size: number) => void;
  clearBuffer: (buffer: GpuBufferLike, offset: number, size: number) => void;
  finish: () => unknown;
}

interface GpuComputePassLike {
  setPipeline: (pipeline: GpuPipelineLike) => void;
  setBindGroup: (index: number, bindGroup: unknown, dynamicOffsets?: number[]) => void;
  dispatchWorkgroups: (x: number, y?: number, z?: number) => void;
  end: () => void;
}

interface GpuQueueLike {
  writeBuffer: (buffer: GpuBufferLike, bufferOffset: number, data: ArrayBuffer | ArrayBufferView) => void;
  submit: (commands: unknown[]) => void;
  onSubmittedWorkDone: () => Promise<void>;
}

interface NavigatorWithGpu {
  gpu?: {
    requestAdapter: () => Promise<GpuAdapterLike | null>;
  };
}

const BUFFER_MAP_READ = 1;
const BUFFER_COPY_SRC = 4;
const BUFFER_COPY_DST = 8;
const BUFFER_UNIFORM = 64;
const BUFFER_STORAGE = 128;
const SHADER_STAGE_COMPUTE = 4;
const Q = D3Q19_VELOCITIES.length;
const AVERAGE_EVERY = 64;
/** Samples (every AVERAGE_EVERY steps) per convergence block. */
const SAMPLES_PER_BLOCK = 16;
export const AVERAGE_BLOCK_STEPS = AVERAGE_EVERY * SAMPLES_PER_BLOCK;
const DENSITY_CHECK_EVERY = 2048;
/** Per-step mass change allowed before the global correction (inflow/outflow imbalance of one step). */
const MAX_DENSITY_DRIFT = 5e-3;
const PARAMS_STRIDE = 256;
const PARAMS_BYTES = 64;
const ROLLOVER_BYTES = 32;
/** Target cell updates recorded per submit; keeps one submit around a quarter second so abort and progress stay responsive. */
const CELL_UPDATES_PER_SUBMIT = 2.5e8;

function navigatorGpu(): NavigatorWithGpu["gpu"] | undefined {
  return (globalThis as typeof globalThis & { navigator?: NavigatorWithGpu }).navigator?.gpu;
}

function limit(source: { limits: Record<string, number> }, key: string, fallback: number): number {
  const value = Number(source.limits[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function adapterLabel(adapter: GpuAdapterLike): string {
  const labels: string[] = [];
  for (const value of [adapter.name, adapter.info?.description, adapter.info?.device, adapter.info?.vendor, adapter.info?.architecture]) {
    if (typeof value === "string" && value.trim().length > 0 && !labels.includes(value.trim())) labels.push(value.trim());
  }
  return labels.length > 0 ? labels.join(" · ") : "WebGPU adapter (name unavailable)";
}

type GpuErrorFilter = "out-of-memory" | "validation" | "internal";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function withGpuErrorScopes<T>(
  device: GpuDeviceLike,
  label: string,
  work: () => T | Promise<T>,
  assertAlive: () => void,
): Promise<T> {
  const filters: GpuErrorFilter[] = ["validation", "internal", "out-of-memory"];
  for (const filter of filters) device.pushErrorScope(filter);
  let result: T | undefined;
  let thrown: unknown = null;
  try {
    assertAlive();
    result = await work();
    assertAlive();
  } catch (error) {
    thrown = error;
  }
  const errors: string[] = [];
  for (let index = filters.length - 1; index >= 0; index -= 1) {
    try {
      const error = await device.popErrorScope();
      if (error) errors.push(error.message ?? "알 수 없는 WebGPU 오류");
    } catch (error) {
      errors.push(errorText(error));
    }
  }
  if (thrown !== null) throw thrown;
  if (errors.length > 0) throw new Error(`${label}: ${errors.join("; ")}`);
  return result as T;
}

async function submitAndWait(
  device: GpuDeviceLike,
  commands: unknown[],
  label: string,
  assertAlive: () => void,
): Promise<void> {
  await withGpuErrorScopes(device, label, async () => {
    device.queue.submit(commands);
    await device.queue.onSubmittedWorkDone();
    // Let GPUDevice.lost's fulfillment callback run before the next command.
    await Promise.resolve();
  }, assertAlive);
}

export async function webgpuAvailable(): Promise<WebGpuAvailability> {
  const gpu = navigatorGpu();
  if (!gpu) return { ok: false, reason: "navigator.gpu is unavailable" };
  let adapter: GpuAdapterLike | null;
  try {
    adapter = await gpu.requestAdapter();
  } catch (error) {
    return { ok: false, reason: `adapter request failed: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!adapter) return { ok: false, reason: "no WebGPU adapter" };
  return {
    ok: true,
    reason: null,
    adapter: adapterLabel(adapter),
    limits: {
      maxBufferSize: limit(adapter, "maxBufferSize", 256 * 1024 * 1024),
      maxStorageBufferBindingSize: limit(adapter, "maxStorageBufferBindingSize", 128 * 1024 * 1024),
      maxStorageBuffersPerShaderStage: limit(adapter, "maxStorageBuffersPerShaderStage", 8),
      maxComputeWorkgroupsPerDimension: limit(adapter, "maxComputeWorkgroupsPerDimension", 65_535),
    },
    f16: Boolean(adapter.features?.has("shader-f16")),
  };
}

function validateCase(c: Lbm3dCase): void {
  const dimensions: Array<[string, number]> = [["nx", c.nx], ["ny", c.ny], ["nz", c.nz], ["steps", c.steps]];
  for (const [name, value] of dimensions) {
    if (!Number.isInteger(value) || value < 1) throw new RangeError(`${name} must be a positive integer`);
  }
  if (!Number.isFinite(c.cellM) || c.cellM <= 0) throw new RangeError("cellM must be positive");
  if (!Number.isFinite(c.uLattice) || c.uLattice <= 0 || c.uLattice >= 0.3) throw new RangeError("uLattice must be in (0, 0.3)");
  if (!Number.isFinite(c.profileAlpha) || c.profileAlpha < 0) throw new RangeError("profileAlpha must be non-negative");
  if (!Number.isFinite(c.zRefM) || c.zRefM <= 0) throw new RangeError("zRefM must be positive");
  if (!Number.isFinite(c.cs) || c.cs < 0) throw new RangeError("cs must be non-negative");
  if (!Number.isFinite(c.tau0) || c.tau0 <= 0.5) throw new RangeError("tau0 must be greater than 0.5");
  if (c.solid.length !== c.nx * c.ny * c.nz) throw new RangeError("solid length must equal nx * ny * nz");
}

function align4(value: number): number {
  return Math.max(4, (value + 3) & ~3);
}

function floatToHalf(value: number): number {
  if (Number.isNaN(value)) return 0x7e00;
  if (value === Infinity) return 0x7c00;
  if (value === -Infinity) return 0xfc00;
  const sign = value < 0 ? 0x8000 : 0;
  const absolute = Math.abs(value);
  if (absolute === 0) return sign;
  if (absolute >= 65504) return sign | 0x7bff;
  if (absolute < 2 ** -24) return sign;
  let exponent = Math.floor(Math.log2(absolute));
  let mantissa = absolute / 2 ** exponent - 1;
  if (exponent < -14) {
    return sign | Math.round(absolute / 2 ** -24);
  }
  exponent += 15;
  mantissa = Math.round(mantissa * 1024);
  if (mantissa === 1024) {
    exponent += 1;
    mantissa = 0;
  }
  return sign | (Math.min(exponent, 30) << 10) | (mantissa & 0x3ff);
}

/**
 * Initial distributions: equilibrium of the inflow profile, one value per
 * (direction, z) slab. Solid cells get the same values; they are never read
 * (a fluid cell only loads its own cell and non-solid neighbours).
 */
function packInitialState(c: Lbm3dCase, startQ: number, countQ: number, precision: "f16" | "f32"): ArrayBuffer {
  const nxy = c.nx * c.ny;
  const cells = nxy * c.nz;
  if (precision === "f16") {
    const values = new Uint16Array(countQ * cells);
    for (let q = 0; q < countQ; q++) {
      for (let z = 0; z < c.nz; z++) {
        const half = floatToHalf(equilibriumDistribution(startQ + q, 1, inflowProfile(c, z), 0, 0));
        values.fill(half, q * cells + z * nxy, q * cells + (z + 1) * nxy);
      }
    }
    const padded = new ArrayBuffer(align4(values.byteLength));
    new Uint16Array(padded).set(values);
    return padded;
  }
  const values = new Float32Array(countQ * cells);
  for (let q = 0; q < countQ; q++) {
    for (let z = 0; z < c.nz; z++) {
      values.fill(Math.fround(equilibriumDistribution(startQ + q, 1, inflowProfile(c, z), 0, 0)), q * cells + z * nxy, q * cells + (z + 1) * nxy);
    }
  }
  return values.buffer;
}

function balancedGroups(cells: number, bytesPerValue: number, limits: { maxBufferSize: number; maxStorageBufferBindingSize: number; maxStorageBuffersPerShaderStage: number }): number[] {
  const perDirectionBytes = cells * bytesPerValue;
  const perGroupLimit = Math.min(limits.maxBufferSize, limits.maxStorageBufferBindingSize);
  const required = Math.max(1, Math.ceil((Q * perDirectionBytes) / perGroupLimit));
  // 2 bindings per direction group + solid, average, density, mass, layer map.
  const maxGroups = Math.max(1, Math.floor((limits.maxStorageBuffersPerShaderStage - 5) / 2));
  if (required > maxGroups) {
    throw new Error(`WebGPU storage binding limit needs ${required} direction groups but only ${maxGroups} fit`);
  }
  // Some drivers advertise a large maxStorageBufferBindingSize but reject a
  // single several-hundred-MB allocation. Keep the full-resolution model and
  // split only those large direction arrays into smaller compatible bindings.
  const preferred = Q * perDirectionBytes >= 128 * 1024 * 1024 ? Math.min(4, maxGroups, Q) : required;
  const groups = Math.min(Math.max(required, preferred), Q);
  const sizes: number[] = [];
  let remaining = Q;
  for (let group = 0; group < groups; group++) {
    const size = Math.ceil(remaining / (groups - group));
    sizes.push(size);
    remaining -= size;
  }
  return sizes;
}

function abortError(): Error {
  const error = new Error("D3Q19 WebGPU run aborted");
  error.name = "AbortError";
  return error;
}

function isSampleStep(step: number, averageFrom: number): boolean {
  return step >= averageFrom && step % AVERAGE_EVERY === 0;
}

/** Unique z indices of the requested output layers and the layer slot of each request. */
function planLayers(c: Lbm3dCase): { zIndices: number[]; slotOfRequest: number[] } {
  const zIndices: number[] = [];
  const slotOfRequest: number[] = [];
  for (const zM of c.layersZm) {
    const z = Math.min(c.nz - 1, Math.max(0, Math.round(zM / c.cellM - 0.5)));
    let slot = zIndices.indexOf(z);
    if (slot < 0) {
      slot = zIndices.length;
      zIndices.push(z);
    }
    slotOfRequest.push(slot);
  }
  return { zIndices, slotOfRequest };
}

function buildLayers(c: Lbm3dCase, total: Float32Array, samples: number, zIndices: number[], slotOfRequest: number[]): Lbm3dLayer[] {
  const nxy = c.nx * c.ny;
  const layers: Lbm3dLayer[] = [];
  c.layersZm.forEach((zM, request) => {
    const slot = slotOfRequest[request];
    const z = zIndices[slot];
    const u = new Float32Array(nxy);
    const v = new Float32Array(nxy);
    for (let xy = 0; xy < nxy; xy++) {
      if (c.solid[z * nxy + xy]) {
        u[xy] = Number.NaN;
        v[xy] = Number.NaN;
      } else if (samples > 0) {
        const at = (slot * nxy + xy) * 2;
        u[xy] = Math.fround(total[at] / samples);
        v[xy] = Math.fround(total[at + 1] / samples);
      }
    }
    layers.push({ zM, u, v });
  });
  return layers;
}

function initialFluidMass(c: Lbm3dCase): number {
  let mass = 0;
  for (let index = 0; index < c.solid.length; index += 1) if (c.solid[index] === 0) mass += 1;
  return mass;
}

function sumDensity(values: Float32Array): number {
  let sum = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) return Number.NaN;
    sum += value;
  }
  return sum;
}

function checksum(values: Float32Array): number {
  let result = 0;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!Number.isFinite(value)) return Number.NaN;
    result += value * ((index % 4096) + 1);
  }
  return result;
}

function velocityDeltaFromInitial(total: Float32Array, samples: number): number {
  if (samples <= 0) return 0;
  let maximum = 0;
  for (let index = 0; index + 1 < total.length; index += 2) {
    const u = total[index] / samples;
    const v = total[index + 1] / samples;
    if (!Number.isFinite(u) || !Number.isFinite(v)) continue;
    // Solid cells keep 0/0 in the accumulators; they are not part of the flow.
    if (u === 0 && v === 0) continue;
    maximum = Math.max(maximum, Math.hypot(u - 1, v));
  }
  return maximum;
}

async function readBuffer(
  device: GpuDeviceLike,
  source: GpuBufferLike,
  destination: GpuBufferLike,
  byteLength: number,
  label: string,
  assertAlive: () => void,
): Promise<ArrayBuffer> {
  const encoder = device.createCommandEncoder();
  encoder.copyBufferToBuffer(source, 0, destination, 0, align4(byteLength));
  await submitAndWait(device, [encoder.finish()], `${label} readback submit`, assertAlive);
  return mapAndCopy(destination, byteLength, assertAlive);
}

async function mapAndCopy(destination: GpuBufferLike, byteLength: number, assertAlive: () => void): Promise<ArrayBuffer> {
  await destination.mapAsync(BUFFER_MAP_READ);
  assertAlive();
  const copy = destination.getMappedRange().slice(0, align4(byteLength));
  destination.unmap();
  return copy;
}

/** Execute the D3Q19 WGSL kernel. This deliberately does not fall back to CPU. */
export async function runLbm3d(c: Lbm3dCase, options: Lbm3dRunOptions = {}): Promise<Lbm3dField> {
  validateCase(c);
  const started = globalThis.performance?.now() ?? Date.now();
  const now = (): number => globalThis.performance?.now() ?? Date.now();
  const gpu = navigatorGpu();
  if (!gpu) throw new Error("WebGPU unavailable: navigator.gpu is unavailable");
  const adapter = await gpu.requestAdapter();
  if (!adapter) throw new Error("WebGPU unavailable: no adapter");
  const useF16 = options.precision !== "f32" && Boolean(adapter.features?.has("shader-f16"));
  const adapterLimits = {
    maxBufferSize: limit(adapter, "maxBufferSize", 256 * 1024 * 1024),
    maxStorageBufferBindingSize: limit(adapter, "maxStorageBufferBindingSize", 128 * 1024 * 1024),
    maxStorageBuffersPerShaderStage: limit(adapter, "maxStorageBuffersPerShaderStage", 8),
    maxComputeWorkgroupsPerDimension: limit(adapter, "maxComputeWorkgroupsPerDimension", 65_535),
  };
  const device = await adapter.requestDevice({
    ...(useF16 ? { requiredFeatures: ["shader-f16"] } : {}),
    requiredLimits: {
      maxBufferSize: adapterLimits.maxBufferSize,
      maxStorageBufferBindingSize: adapterLimits.maxStorageBufferBindingSize,
      maxStorageBuffersPerShaderStage: adapterLimits.maxStorageBuffersPerShaderStage,
      maxComputeWorkgroupsPerDimension: adapterLimits.maxComputeWorkgroupsPerDimension,
    },
  });
  let lostInfo: GpuDeviceLostInfo | null = null;
  void device.lost.then((info) => { lostInfo = info; });
  const assertAlive = () => {
    if (lostInfo) throw new Error(`WebGPU device lost: ${lostInfo.reason ?? "unknown"}${lostInfo.message ? ` — ${lostInfo.message}` : ""}`);
  };
  const limits = {
    maxBufferSize: limit(device, "maxBufferSize", 256 * 1024 * 1024),
    maxStorageBufferBindingSize: limit(device, "maxStorageBufferBindingSize", 128 * 1024 * 1024),
    maxStorageBuffersPerShaderStage: limit(device, "maxStorageBuffersPerShaderStage", 8),
    maxComputeWorkgroupsPerDimension: limit(device, "maxComputeWorkgroupsPerDimension", 65_535),
  };
  const nxy = c.nx * c.ny;
  const cells = nxy * c.nz;
  const precision = useF16 ? "f16" : "f32";
  const groups = balancedGroups(cells, useF16 ? 2 : 4, limits);
  const workgroupSize = options.workgroupSize ?? 64;
  const workgroups = Math.ceil(cells / workgroupSize);
  const dispatchX = Math.min(workgroups, limits.maxComputeWorkgroupsPerDimension);
  const remainingYz = Math.ceil(workgroups / dispatchX);
  const dispatchY = Math.min(remainingYz, limits.maxComputeWorkgroupsPerDimension);
  const dispatchZ = Math.ceil(remainingYz / dispatchY);
  if (dispatchZ > limits.maxComputeWorkgroupsPerDimension) {
    throw new Error(`D3Q19 dispatch exceeds adapter limit: ${dispatchX}×${dispatchY}×${dispatchZ}`);
  }
  const dispatchStrideX = dispatchX * workgroupSize;
  const dispatchStrideXY = dispatchStrideX * dispatchY;

  const { zIndices, slotOfRequest } = planLayers(c);
  const layerCells = zIndices.length * nxy;
  const rolloverWorkgroups = Math.ceil(layerCells / 64);
  const rolloverX = Math.min(rolloverWorkgroups, limits.maxComputeWorkgroupsPerDimension);
  const rolloverY = Math.ceil(rolloverWorkgroups / rolloverX);
  if (rolloverY > limits.maxComputeWorkgroupsPerDimension) throw new Error("D3Q19 roll-over dispatch exceeds adapter limit");

  const pipelines = await withGpuErrorScopes(device, "D3Q19 pipeline creation", () => {
    const module = device.createShaderModule({ code: d3q19KernelWgsl({ precision, groupSizes: groups, dispatchStrideX, dispatchStrideXY, workgroupSize }) });
    const bindingEntries: Array<Record<string, unknown>> = [];
    for (let binding = 0; binding < groups.length; binding += 1) {
      bindingEntries.push({ binding, visibility: SHADER_STAGE_COMPUTE, buffer: { type: "read-only-storage" } });
      bindingEntries.push({ binding: groups.length + binding, visibility: SHADER_STAGE_COMPUTE, buffer: { type: "storage" } });
    }
    const base = groups.length * 2;
    bindingEntries.push({ binding: base, visibility: SHADER_STAGE_COMPUTE, buffer: { type: "read-only-storage" } });
    bindingEntries.push({ binding: base + 1, visibility: SHADER_STAGE_COMPUTE, buffer: { type: "storage" } });
    bindingEntries.push({ binding: base + 2, visibility: SHADER_STAGE_COMPUTE, buffer: { type: "uniform", hasDynamicOffset: true, minBindingSize: PARAMS_BYTES } });
    bindingEntries.push({ binding: base + 3, visibility: SHADER_STAGE_COMPUTE, buffer: { type: "storage" } });
    bindingEntries.push({ binding: base + 4, visibility: SHADER_STAGE_COMPUTE, buffer: { type: "storage" } });
    bindingEntries.push({ binding: base + 5, visibility: SHADER_STAGE_COMPUTE, buffer: { type: "read-only-storage" } });
    const bindGroupLayout = device.createBindGroupLayout({ entries: bindingEntries });
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
    const pipeline = device.createComputePipeline({ layout: pipelineLayout, compute: { module, entryPoint: "main" } });

    const rolloverModule = device.createShaderModule({ code: d3q19RolloverWgsl(rolloverX * 64) });
    const rolloverLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: SHADER_STAGE_COMPUTE, buffer: { type: "storage" } },
        { binding: 1, visibility: SHADER_STAGE_COMPUTE, buffer: { type: "storage" } },
        { binding: 2, visibility: SHADER_STAGE_COMPUTE, buffer: { type: "storage" } },
        { binding: 3, visibility: SHADER_STAGE_COMPUTE, buffer: { type: "storage" } },
        { binding: 4, visibility: SHADER_STAGE_COMPUTE, buffer: { type: "storage" } },
        { binding: 5, visibility: SHADER_STAGE_COMPUTE, buffer: { type: "uniform" } },
      ],
    });
    const rolloverPipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [rolloverLayout] }),
      compute: { module: rolloverModule, entryPoint: "rollover" },
    });
    return { pipeline, bindGroupLayout, rolloverPipeline, rolloverLayout };
  }, assertAlive);

  const averageFrom = Math.min(Math.max(0, Math.floor(c.averageFrom)), Math.max(0, c.steps - 1));
  const initialMass = initialFluidMass(c);
  if (!(initialMass > 0)) throw new Error("D3Q19 case has no fluid cells");
  // Fixed-point mass accumulator must not overflow u32 (sum of ~1.0 per fluid cell).
  const massScale = Math.min(256, Math.floor(3.9e9 / initialMass));
  if (massScale < 1) throw new Error("D3Q19 grid is too large for the 32-bit mass accumulator");
  const maxSubmitSteps = Math.max(1, Math.min(256, Math.floor(options.maxStepsPerSubmit ?? Math.max(4, CELL_UPDATES_PER_SUBMIT / cells))));
  // Adaptive window only pays off (and only has room for spin-up + window blocks) on long runs.
  const convergence = c.steps >= 6 * AVERAGE_BLOCK_STEPS ? options.convergence : undefined;
  const adaptive = convergence !== undefined;
  const spinupEpsilon = convergence?.spinupEpsilon ?? (convergence ? 5 * convergence.epsilon : 0);
  const minBlocks = Math.max(2, convergence?.minBlocks ?? 3);
  const consecutive = Math.max(1, convergence?.consecutive ?? 2);
  // Legacy (non-adaptive) sampling starts at averageFrom; the adaptive run samples from step 0 and opens the window later.
  const sampleStart = adaptive ? 0 : averageFrom;

  const buffers: GpuBufferLike[] = [];
  const createBuffer = (size: number, usage: number): GpuBufferLike => {
    const buffer = device.createBuffer({ size: align4(size), usage });
    buffers.push(buffer);
    return buffer;
  };
  const writeBuffer = async (buffer: GpuBufferLike, data: ArrayBuffer | ArrayBufferView, label: string): Promise<void> => {
    await withGpuErrorScopes(device, label, () => device.queue.writeBuffer(buffer, 0, data), assertAlive);
  };
  try {
    const makeState = async (): Promise<GpuBufferLike[]> => {
      const state: GpuBufferLike[] = [];
      let startQ = 0;
      for (const countQ of groups) {
        const bytes = createBuffer(cells * countQ * (useF16 ? 2 : 4), BUFFER_STORAGE | BUFFER_COPY_DST);
        await writeBuffer(bytes, packInitialState(c, startQ, countQ, precision), `D3Q19 initial state ${startQ}`);
        state.push(bytes);
        startQ += countQ;
      }
      return state;
    };
    const stateA = await makeState();
    const stateB = await makeState();
    // One byte per cell; the kernel reads it as packed u32 words.
    const solidBytes = new Uint8Array(align4(cells));
    solidBytes.set(c.solid);
    const solid = createBuffer(solidBytes.byteLength, BUFFER_STORAGE | BUFFER_COPY_DST);
    await writeBuffer(solid, solidBytes, "D3Q19 solid mask");
    // Zero-initialised by the WebGPU spec.
    const blockSum = createBuffer(layerCells * 8, BUFFER_STORAGE);
    const totalSum = createBuffer(layerCells * 8, BUFFER_STORAGE | BUFFER_COPY_SRC);
    const previousBlockMean = createBuffer(layerCells * 8, BUFFER_STORAGE);
    const previousRunMean = createBuffer(layerCells * 8, BUFFER_STORAGE);
    const partial = createBuffer(rolloverX * rolloverY * 16, BUFFER_STORAGE | BUFFER_COPY_SRC);
    const partialReadback = createBuffer(rolloverX * rolloverY * 16, BUFFER_MAP_READ | BUFFER_COPY_DST);
    const totalReadback = createBuffer(layerCells * 8, BUFFER_MAP_READ | BUFFER_COPY_DST);
    const density = createBuffer(cells * 4, BUFFER_STORAGE | BUFFER_COPY_SRC);
    const densityReadback = createBuffer(cells * 4, BUFFER_MAP_READ | BUFFER_COPY_DST);
    const mass = createBuffer(8, BUFFER_STORAGE | BUFFER_COPY_SRC | BUFFER_COPY_DST);
    const massReadback = createBuffer(4, BUFFER_MAP_READ | BUFFER_COPY_DST);
    const layerMapValues = new Int32Array(c.nz).fill(-1);
    zIndices.forEach((z, slot) => { layerMapValues[z] = slot; });
    const layerMap = createBuffer(c.nz * 4, BUFFER_STORAGE | BUFFER_COPY_DST);
    await writeBuffer(layerMap, layerMapValues, "D3Q19 layer map");
    const params = createBuffer(PARAMS_STRIDE * maxSubmitSteps, BUFFER_UNIFORM | BUFFER_COPY_DST);
    const rolloverParams = createBuffer(ROLLOVER_BYTES, BUFFER_UNIFORM | BUFFER_COPY_DST);

    const layout = pipelines.bindGroupLayout;
    const base = groups.length * 2;
    const makeBindGroup = (input: GpuBufferLike[], output: GpuBufferLike[]): unknown => {
      const entries: GpuBindEntry[] = [];
      input.forEach((buffer, index) => entries.push({ binding: index, resource: { buffer } }));
      output.forEach((buffer, index) => entries.push({ binding: groups.length + index, resource: { buffer } }));
      entries.push({ binding: base, resource: { buffer: solid } });
      entries.push({ binding: base + 1, resource: { buffer: blockSum } });
      entries.push({ binding: base + 2, resource: { buffer: params, offset: 0, size: PARAMS_BYTES } });
      entries.push({ binding: base + 3, resource: { buffer: density } });
      entries.push({ binding: base + 4, resource: { buffer: mass } });
      entries.push({ binding: base + 5, resource: { buffer: layerMap } });
      return device.createBindGroup({ layout, entries });
    };
    const bindAtoB = makeBindGroup(stateA, stateB);
    const bindBtoA = makeBindGroup(stateB, stateA);
    const rolloverBind = device.createBindGroup({
      layout: pipelines.rolloverLayout,
      entries: [
        { binding: 0, resource: { buffer: blockSum } },
        { binding: 1, resource: { buffer: totalSum } },
        { binding: 2, resource: { buffer: previousBlockMean } },
        { binding: 3, resource: { buffer: previousRunMean } },
        { binding: 4, resource: { buffer: partial } },
        { binding: 5, resource: { buffer: rolloverParams } },
      ],
    });

    const staticParams = new ArrayBuffer(PARAMS_STRIDE * maxSubmitSteps);
    const paramsView = new DataView(staticParams);
    const writeStepParams = (slot: number, step: number, flags: number): void => {
      const o = slot * PARAMS_STRIDE;
      paramsView.setUint32(o, c.nx, true);
      paramsView.setUint32(o + 4, c.ny, true);
      paramsView.setUint32(o + 8, c.nz, true);
      paramsView.setUint32(o + 12, step, true);
      paramsView.setFloat32(o + 16, c.cellM, true);
      paramsView.setFloat32(o + 20, c.uLattice, true);
      paramsView.setFloat32(o + 24, c.profileAlpha, true);
      paramsView.setFloat32(o + 28, c.zRefM, true);
      paramsView.setFloat32(o + 32, c.cs, true);
      paramsView.setFloat32(o + 36, c.tau0, true);
      paramsView.setUint32(o + 40, cells, true);
      paramsView.setUint32(o + 44, flags, true);
      paramsView.setFloat32(o + 48, initialMass, true);
      paramsView.setFloat32(o + 52, massScale, true);
    };
    const rolloverData = new ArrayBuffer(ROLLOVER_BYTES);
    const rolloverView = new DataView(rolloverData);
    const writeRolloverParams = (active: number, invBlock: number, invTotal: number): void => {
      rolloverView.setUint32(0, layerCells, true);
      rolloverView.setUint32(4, active, true);
      rolloverView.setFloat32(16, invBlock, true);
      rolloverView.setFloat32(20, invTotal, true);
    };

    let densityValues: Float32Array<ArrayBufferLike> = new Float32Array(0);
    let densityDrift = 0;
    let densityDriftMax = 0;
    let massRawDriftMax = 0;
    let massFactorMax = 0;
    const checkDensity = (step: number, bytes: ArrayBuffer): void => {
      densityValues = new Float32Array(bytes);
      const total = sumDensity(densityValues);
      if (!Number.isFinite(total)) throw new Error(`D3Q19 density checksum is not finite at step ${step}`);
      densityDrift = Math.abs(total / initialMass - 1);
      densityDriftMax = Math.max(densityDriftMax, densityDrift);
      if (densityDrift > MAX_DENSITY_DRIFT) {
        throw new Error(`D3Q19 density drift ${densityDrift.toExponential(3)} exceeds ${MAX_DENSITY_DRIFT.toExponential(1)} at step ${step}`);
      }
    };
    const noteRawMass = (step: number, bytes: ArrayBuffer): void => {
      const raw = new Uint32Array(bytes)[0] / massScale;
      if (!Number.isFinite(raw) || raw <= 0) throw new Error(`D3Q19 mass accumulator is empty at step ${step}`);
      const drift = Math.abs(raw / initialMass - 1);
      massRawDriftMax = Math.max(massRawDriftMax, drift);
      massFactorMax = Math.max(massFactorMax, Math.abs(initialMass / raw - 1));
    };

    const blockResiduals: number[] = [];
    const windowResiduals: number[] = [];
    let blocks = 0;
    let blockSamples = 0;
    let totalSamples = 0;
    // Legacy runs average from averageFrom on; adaptive runs open the window after spin-up is detected.
    let windowActive = !adaptive;
    let windowStartBlock = adaptive ? 0 : 1;
    let windowBlocks = 0;
    let spinupStreak = 0;
    let windowStreak = 0;
    let stoppedEarly = false;
    let step = 0;
    let stepsRun = 0;
    let computeMs = 0;

    while (step < c.steps) {
      if (options.signal?.aborted) throw abortError();
      const submitStarted = now();
      const encoder = device.createCommandEncoder();
      let recorded = 0;
      let blockEnd = false;
      let densityEnd = false;
      while (step < c.steps && recorded < maxSubmitSteps) {
        const sample = isSampleStep(step, sampleStart);
        const lastOfRun = step === c.steps - 1;
        densityEnd = (step + 1) % DENSITY_CHECK_EVERY === 0 || lastOfRun;
        writeStepParams(recorded, step, (sample ? 1 : 0) | (densityEnd ? 2 : 0));
        const pass = encoder.beginComputePass();
        pass.setPipeline(pipelines.pipeline);
        pass.setBindGroup(0, step % 2 === 0 ? bindAtoB : bindBtoA, [recorded * PARAMS_STRIDE]);
        pass.dispatchWorkgroups(dispatchX, dispatchY, dispatchZ);
        pass.end();
        // This step has read the other slot's mass; clear it so the next step can accumulate into it.
        encoder.clearBuffer(mass, ((step + 1) % 2) * 4, 4);
        if (sample) {
          blockSamples += 1;
          if (blockSamples === SAMPLES_PER_BLOCK) blockEnd = true;
        }
        step += 1;
        recorded += 1;
        if (blockEnd || densityEnd) break;
      }
      const lastStep = step - 1;
      const finished = step >= c.steps;
      const flushPartial = finished && !blockEnd && blockSamples > 0;
      const rollover = blockEnd || flushPartial;
      // The last block of a run always joins the average, even if the window never opened.
      const addToWindow = windowActive || finished;
      if (rollover) {
        const samplesInBlock = blockEnd ? SAMPLES_PER_BLOCK : blockSamples;
        const totalAfter = totalSamples + samplesInBlock;
        writeRolloverParams(addToWindow ? 1 : 0, 1 / samplesInBlock, 1 / totalAfter);
        const pass = encoder.beginComputePass();
        pass.setPipeline(pipelines.rolloverPipeline);
        pass.setBindGroup(0, rolloverBind);
        pass.dispatchWorkgroups(rolloverX, rolloverY, 1);
        pass.end();
        encoder.copyBufferToBuffer(partial, 0, partialReadback, 0, rolloverX * rolloverY * 16);
      }
      const wantMass = rollover || densityEnd || finished;
      if (wantMass) encoder.copyBufferToBuffer(mass, (lastStep % 2) * 4, massReadback, 0, 4);
      if (densityEnd) encoder.copyBufferToBuffer(density, 0, densityReadback, 0, cells * 4);
      await withGpuErrorScopes(device, `D3Q19 params ${step}`, () => {
        device.queue.writeBuffer(params, 0, new Uint8Array(staticParams, 0, recorded * PARAMS_STRIDE));
        if (rollover) device.queue.writeBuffer(rolloverParams, 0, rolloverData);
      }, assertAlive);
      await submitAndWait(device, [encoder.finish()], `D3Q19 compute steps ${lastStep + 1 - recorded + 1}-${lastStep + 1}`, assertAlive);
      computeMs += now() - submitStarted;
      stepsRun = step;

      if (wantMass) noteRawMass(step, await mapAndCopy(massReadback, 4, assertAlive));
      if (densityEnd) checkDensity(step, await mapAndCopy(densityReadback, cells * 4, assertAlive));
      if (rollover) {
        const parts = new Float32Array(await mapAndCopy(partialReadback, rolloverX * rolloverY * 16, assertAlive));
        let blockChange = 0, blockMean = 0, runChange = 0, runMean = 0;
        for (let i = 0; i + 3 < parts.length; i += 4) {
          blockChange += parts[i];
          blockMean += parts[i + 1];
          runChange += parts[i + 2];
          runMean += parts[i + 3];
        }
        if (addToWindow) totalSamples += blockEnd ? SAMPLES_PER_BLOCK : blockSamples;
        blockSamples = 0;
        if (blockEnd) {
          blocks += 1;
          const blockResidual = blocks >= 2 && blockMean > 0 ? Math.sqrt(blockChange / blockMean) : Number.NaN;
          blockResiduals.push(blockResidual);
          if (addToWindow) {
            if (windowStartBlock === 0) windowStartBlock = blocks;
            windowBlocks += 1;
          }
          const windowResidual = addToWindow && windowBlocks >= 2 && runMean > 0 ? Math.sqrt(runChange / runMean) : Number.NaN;
          windowResiduals.push(windowResidual);
          if (convergence && !windowActive) {
            // Spin-up detector: consecutive block means agree, or the legacy averaging start is reached.
            spinupStreak = Number.isFinite(blockResidual) && blockResidual < spinupEpsilon ? spinupStreak + 1 : 0;
            if (spinupStreak >= consecutive || step >= averageFrom) windowActive = true;
          } else if (convergence) {
            windowStreak = Number.isFinite(windowResidual) && windowResidual < convergence.epsilon ? windowStreak + 1 : 0;
            if (!convergence.trace && windowBlocks >= minBlocks && windowStreak >= consecutive && !finished) stoppedEarly = true;
          }
        }
      }
      const elapsedMs = now() - started;
      options.onProgress?.({ step: stoppedEarly ? c.steps : step, steps: c.steps, mlups: (cells * step) / Math.max(elapsedMs, 0.001) / 1000, elapsedMs });
      if (stoppedEarly) break;
    }

    const totalBytes = await readBuffer(device, totalSum, totalReadback, layerCells * 8, "D3Q19 average", assertAlive);
    const totalValues = new Float32Array(totalBytes);
    const fieldChecksum = checksum(totalValues);
    if (!Number.isFinite(fieldChecksum) || Math.abs(fieldChecksum) <= 1e-6) throw new Error("D3Q19 velocity field checksum is empty");
    const velocityDelta = velocityDeltaFromInitial(totalValues, totalSamples);
    if (!(velocityDelta > 1e-3)) throw new Error(`D3Q19 velocity field did not change from its initial state (${velocityDelta.toExponential(3)})`);
    const elapsedMs = now() - started;
    const report: Lbm3dConvergenceReport | undefined = convergence
      ? { blocks, blockSteps: AVERAGE_BLOCK_STEPS, windowStartBlock, blockResiduals, windowResiduals, stoppedEarly, epsilon: convergence.epsilon, spinupEpsilon }
      : undefined;
    const lastWindowResidual = windowResiduals.filter(Number.isFinite).pop();
    return {
      cellM: c.cellM,
      nx: c.nx,
      ny: c.ny,
      layers: buildLayers(c, totalValues, totalSamples, zIndices, slotOfRequest),
      steps: stepsRun,
      stepsPlanned: c.steps,
      elapsedMs,
      adapter: adapterLabel(adapter),
      precision,
      mlups: ((cells * stepsRun) / Math.max(elapsedMs, 0.001)) / 1000,
      kernelMlups: ((cells * stepsRun) / Math.max(computeMs, 0.001)) / 1000,
      residual: lastWindowResidual ?? 1 / Math.max(stepsRun, 1),
      fieldChecksum,
      densityChecksum: checksum(densityValues),
      densityDrift,
      densityDriftMax,
      massRawDriftMax,
      massFactorMax,
      convergence: report,
      velocityDelta,
      dispatch: { x: dispatchX, y: dispatchY, z: dispatchZ, limit: limits.maxComputeWorkgroupsPerDimension, strideX: dispatchStrideX, strideXY: dispatchStrideXY },
    };
  } finally {
    for (const buffer of buffers) {
      try { buffer.destroy(); } catch { /* device loss cleanup */ }
    }
  }
}
