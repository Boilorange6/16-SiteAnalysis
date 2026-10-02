import { d3q19KernelWgsl } from "./kernels.wgsl";
import { D3Q19_VELOCITIES, D3Q19_WEIGHTS, type Lbm3dCase } from "./plan";
import { equilibriumDistribution, inflowProfile, type Lbm3dField, type Lbm3dLayer } from "./cpu-ref";

export type { Lbm3dField, Lbm3dLayer } from "./cpu-ref";

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

export interface Lbm3dRunOptions {
  onProgress?: (p: { step: number; steps: number; mlups: number; elapsedMs: number }) => void;
  signal?: AbortSignal;
  /** Defaults to auto: use shader-f16 when the adapter exposes it. */
  precision?: "auto" | "f16" | "f32";
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

interface GpuDeviceLike {
  limits: Record<string, number>;
  lost: Promise<GpuDeviceLostInfo>;
  createShaderModule: (descriptor: { code: string }) => unknown;
  createBindGroupLayout: (descriptor: { entries: Array<Record<string, unknown>> }) => unknown;
  createPipelineLayout: (descriptor: { bindGroupLayouts: unknown[] }) => unknown;
  createComputePipeline: (descriptor: Record<string, unknown>) => GpuPipelineLike;
  createBuffer: (descriptor: { size: number; usage: number; mappedAtCreation?: boolean }) => GpuBufferLike;
  createBindGroup: (descriptor: { layout: unknown; entries: Array<{ binding: number; resource: { buffer: GpuBufferLike } }> }) => unknown;
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
  finish: () => unknown;
}

interface GpuComputePassLike {
  setPipeline: (pipeline: GpuPipelineLike) => void;
  setBindGroup: (index: number, bindGroup: unknown) => void;
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
const WORKGROUP_SIZE = 64;
const AVERAGE_EVERY = 64;
const MASS_CHECK_EVERY = 256;
const MASS_SCALE = 256;
const MAX_DENSITY_DRIFT = 1e-3;

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

function packInitialState(c: Lbm3dCase, startQ: number, countQ: number, precision: "f16" | "f32"): ArrayBuffer {
  const cells = c.nx * c.ny * c.nz;
  if (precision === "f16") {
    const values = new Uint16Array(countQ * cells);
    for (let q = 0; q < countQ; q++) {
      const direction = startQ + q;
      for (let z = 0; z < c.nz; z++) {
        const ux = inflowProfile(c, z);
        for (let y = 0; y < c.ny; y++) {
          for (let x = 0; x < c.nx; x++) {
            const i = x + c.nx * (y + c.ny * z);
            const localUx = c.solid[i] ? 0 : ux;
            values[q * cells + i] = floatToHalf(equilibriumDistribution(direction, 1, localUx, 0, 0));
          }
        }
      }
    }
    const padded = new ArrayBuffer(align4(values.byteLength));
    new Uint16Array(padded).set(values);
    return padded;
  }
  const values = new Float32Array(countQ * cells);
  for (let q = 0; q < countQ; q++) {
    const direction = startQ + q;
    for (let z = 0; z < c.nz; z++) {
      const ux = inflowProfile(c, z);
      for (let y = 0; y < c.ny; y++) {
        for (let x = 0; x < c.nx; x++) {
          const i = x + c.nx * (y + c.ny * z);
          const localUx = c.solid[i] ? 0 : ux;
          values[q * cells + i] = Math.fround(equilibriumDistribution(direction, 1, localUx, 0, 0));
        }
      }
    }
  }
  return values.buffer;
}

function balancedGroups(cells: number, bytesPerValue: number, limits: { maxBufferSize: number; maxStorageBufferBindingSize: number; maxStorageBuffersPerShaderStage: number }): number[] {
  const perDirectionBytes = cells * bytesPerValue;
  const perGroupLimit = Math.min(limits.maxBufferSize, limits.maxStorageBufferBindingSize);
  const required = Math.max(1, Math.ceil((Q * perDirectionBytes) / perGroupLimit));
  const maxGroups = Math.max(1, Math.floor((limits.maxStorageBuffersPerShaderStage - 4) / 2));
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

function writeParams(c: Lbm3dCase, step: number, averageFrom: number, initialMass: number): ArrayBuffer {
  const bytes = new ArrayBuffer(64);
  const view = new DataView(bytes);
  view.setUint32(0, c.nx, true);
  view.setUint32(4, c.ny, true);
  view.setUint32(8, c.nz, true);
  view.setUint32(12, step, true);
  view.setFloat32(16, c.cellM, true);
  view.setFloat32(20, c.uLattice, true);
  view.setFloat32(24, c.profileAlpha, true);
  view.setFloat32(28, c.zRefM, true);
  view.setFloat32(32, c.cs, true);
  view.setFloat32(36, c.tau0, true);
  view.setUint32(40, averageFrom, true);
  view.setUint32(44, AVERAGE_EVERY, true);
  view.setFloat32(48, initialMass, true);
  view.setFloat32(52, MASS_SCALE, true);
  return bytes;
}

function abortError(): Error {
  const error = new Error("D3Q19 WebGPU run aborted");
  error.name = "AbortError";
  return error;
}

function averageSampleCount(steps: number, averageFrom: number): number {
  let count = 0;
  for (let step = averageFrom; step < steps; step += 1) if (step % AVERAGE_EVERY === 0) count++;
  return count;
}

function buildLayers(c: Lbm3dCase, average: Float32Array, samples: number): Lbm3dLayer[] {
  const layers: Lbm3dLayer[] = [];
  const source = new Float32Array(average.length);
  if (samples > 0) {
    for (let i = 0; i < average.length; i++) source[i] = Math.fround(average[i] / samples);
  }
  for (const zM of c.layersZm) {
    const z = Math.min(c.nz - 1, Math.max(0, Math.round(zM / c.cellM - 0.5)));
    const u = new Float32Array(c.nx * c.ny);
    const v = new Float32Array(c.nx * c.ny);
    for (let y = 0; y < c.ny; y++) {
      for (let x = 0; x < c.nx; x++) {
        const xy = x + c.nx * y;
        const index = x + c.nx * (y + c.ny * z);
        if (c.solid[index]) {
          u[xy] = Number.NaN;
          v[xy] = Number.NaN;
        } else {
          u[xy] = source[index * 2];
          v[xy] = source[index * 2 + 1];
        }
      }
    }
    layers.push({ zM, u, v });
  }
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

function velocityDeltaFromInitial(c: Lbm3dCase, average: Float32Array, samples: number): number {
  if (samples <= 0) return 0;
  let maximum = 0;
  for (let index = 0; index < c.solid.length; index += 1) {
    if (c.solid[index] !== 0) continue;
    const u = average[index * 2] / samples;
    const v = average[index * 2 + 1] / samples;
    if (!Number.isFinite(u) || !Number.isFinite(v)) continue;
    maximum = Math.max(maximum, Math.hypot(u - 1, v));
  }
  return maximum;
}

async function readFloatBuffer(
  device: GpuDeviceLike,
  source: GpuBufferLike,
  destination: GpuBufferLike,
  byteLength: number,
  label: string,
  assertAlive: () => void,
): Promise<Float32Array> {
  const encoder = device.createCommandEncoder();
  encoder.copyBufferToBuffer(source, 0, destination, 0, align4(byteLength));
  await submitAndWait(device, [encoder.finish()], `${label} readback submit`, assertAlive);
  await destination.mapAsync(BUFFER_MAP_READ);
  assertAlive();
  const values = new Float32Array(destination.getMappedRange().slice(0));
  destination.unmap();
  return values;
}

/** Execute the D3Q19 WGSL kernel. This deliberately does not fall back to CPU. */
export async function runLbm3d(c: Lbm3dCase, options: Lbm3dRunOptions = {}): Promise<Lbm3dField> {
  validateCase(c);
  const started = globalThis.performance?.now() ?? Date.now();
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
  const cells = c.nx * c.ny * c.nz;
  const precision = useF16 ? "f16" : "f32";
  const groups = balancedGroups(cells, useF16 ? 2 : 4, limits);
  const workgroups = Math.ceil(cells / WORKGROUP_SIZE);
  const dispatchX = Math.min(workgroups, limits.maxComputeWorkgroupsPerDimension);
  const remainingYz = Math.ceil(workgroups / dispatchX);
  const dispatchY = Math.min(remainingYz, limits.maxComputeWorkgroupsPerDimension);
  const dispatchZ = Math.ceil(remainingYz / dispatchY);
  if (dispatchZ > limits.maxComputeWorkgroupsPerDimension) {
    throw new Error(`D3Q19 dispatch exceeds adapter limit: ${dispatchX}×${dispatchY}×${dispatchZ}`);
  }
  const dispatchStrideX = dispatchX * WORKGROUP_SIZE;
  const dispatchStrideXY = dispatchStrideX * dispatchY;
  const pipelines = await withGpuErrorScopes(device, "D3Q19 pipeline creation", () => {
    const module = device.createShaderModule({ code: d3q19KernelWgsl({ precision, groupSizes: groups, dispatchStrideX, dispatchStrideXY }) });
    const bindingEntries: Array<Record<string, unknown>> = [];
    for (let binding = 0; binding < groups.length; binding += 1) {
      bindingEntries.push({ binding, visibility: SHADER_STAGE_COMPUTE, buffer: { type: "read-only-storage" } });
      bindingEntries.push({ binding: groups.length + binding, visibility: SHADER_STAGE_COMPUTE, buffer: { type: "storage" } });
    }
    bindingEntries.push({ binding: groups.length * 2, visibility: SHADER_STAGE_COMPUTE, buffer: { type: "read-only-storage" } });
    bindingEntries.push({ binding: groups.length * 2 + 1, visibility: SHADER_STAGE_COMPUTE, buffer: { type: "storage" } });
    bindingEntries.push({ binding: groups.length * 2 + 2, visibility: SHADER_STAGE_COMPUTE, buffer: { type: "uniform" } });
    bindingEntries.push({ binding: groups.length * 2 + 3, visibility: SHADER_STAGE_COMPUTE, buffer: { type: "storage" } });
    bindingEntries.push({ binding: groups.length * 2 + 4, visibility: SHADER_STAGE_COMPUTE, buffer: { type: "storage" } });
    const bindGroupLayout = device.createBindGroupLayout({ entries: bindingEntries });
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
    const pipeline = device.createComputePipeline({ layout: pipelineLayout, compute: { module, entryPoint: "main" } });
    const measurePipeline = device.createComputePipeline({ layout: pipelineLayout, compute: { module, entryPoint: "measure" } });
    const normalizePipeline = device.createComputePipeline({ layout: pipelineLayout, compute: { module, entryPoint: "normalize" } });
    return { pipeline, measurePipeline, normalizePipeline, bindGroupLayout };
  }, assertAlive);
  const buffers: GpuBufferLike[] = [];
  const createBuffer = (size: number, usage: number): GpuBufferLike => {
    const buffer = device.createBuffer({ size: align4(size), usage });
    buffers.push(buffer);
    return buffer;
  };
  const writeBuffer = async (buffer: GpuBufferLike, data: ArrayBuffer | ArrayBufferView, label: string): Promise<void> => {
    await withGpuErrorScopes(device, label, () => device.queue.writeBuffer(buffer, 0, data), assertAlive);
  };
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
  const solid = createBuffer(cells * 4, BUFFER_STORAGE | BUFFER_COPY_DST);
  const solidValues = Uint32Array.from(c.solid, (value) => Number(value));
  await writeBuffer(solid, solidValues, "D3Q19 solid mask");
  const average = createBuffer(cells * 8, BUFFER_STORAGE | BUFFER_COPY_SRC | BUFFER_COPY_DST);
  await writeBuffer(average, new Float32Array(cells * 2), "D3Q19 average buffer");
  const density = createBuffer(cells * 4, BUFFER_STORAGE | BUFFER_COPY_SRC | BUFFER_COPY_DST);
  const densityReadback = createBuffer(cells * 4, BUFFER_MAP_READ | BUFFER_COPY_DST);
  const averageReadback = createBuffer(cells * 8, BUFFER_MAP_READ | BUFFER_COPY_DST);
  const mass = createBuffer(4, BUFFER_STORAGE | BUFFER_COPY_DST | BUFFER_COPY_SRC);
  const params = createBuffer(64, BUFFER_UNIFORM | BUFFER_COPY_DST);
  const layout = pipelines.bindGroupLayout;
  const makeBindGroup = (input: GpuBufferLike[], output: GpuBufferLike[]): unknown => {
    const entries: Array<{ binding: number; resource: { buffer: GpuBufferLike } }> = [];
    input.forEach((buffer, index) => entries.push({ binding: index, resource: { buffer } }));
    output.forEach((buffer, index) => entries.push({ binding: groups.length + index, resource: { buffer } }));
    entries.push({ binding: groups.length * 2, resource: { buffer: solid } });
    entries.push({ binding: groups.length * 2 + 1, resource: { buffer: average } });
    entries.push({ binding: groups.length * 2 + 2, resource: { buffer: params } });
    entries.push({ binding: groups.length * 2 + 3, resource: { buffer: density } });
    entries.push({ binding: groups.length * 2 + 4, resource: { buffer: mass } });
    return device.createBindGroup({ layout, entries });
  };
  const bindAtoB = makeBindGroup(stateA, stateB);
  const bindBtoA = makeBindGroup(stateB, stateA);
  const averageFrom = Math.min(Math.max(0, Math.floor(c.averageFrom)), Math.max(0, c.steps - 1));
  const initialMass = initialFluidMass(c);
  if (!(initialMass > 0)) throw new Error("D3Q19 case has no fluid cells");
  let densityValues: Float32Array<ArrayBufferLike> = new Float32Array(0);
  let densityDrift = 0;
  let densityDriftMax = 0;
  const checkDensity = async (step: number): Promise<void> => {
    densityValues = await readFloatBuffer(device, density, densityReadback, cells * 4, `D3Q19 density step ${step}`, assertAlive);
    const mass = sumDensity(densityValues);
    if (!Number.isFinite(mass)) throw new Error(`D3Q19 density checksum is not finite at step ${step}`);
    densityDrift = Math.abs(mass / initialMass - 1);
    densityDriftMax = Math.max(densityDriftMax, densityDrift);
    if (densityDrift > MAX_DENSITY_DRIFT) {
      throw new Error(`D3Q19 density drift ${densityDrift.toExponential(3)} exceeds ${MAX_DENSITY_DRIFT.toExponential(1)} at step ${step}`);
    }
  };
  try {
    for (let step = 0; step < c.steps; step++) {
      if (options.signal?.aborted) throw abortError();
      await writeBuffer(params, writeParams(c, step, averageFrom, initialMass), `D3Q19 params step ${step + 1}`);
      await writeBuffer(mass, new Uint32Array([0]), `D3Q19 mass reset step ${step + 1}`);
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipelines.pipeline);
      pass.setBindGroup(0, step % 2 === 0 ? bindAtoB : bindBtoA);
      pass.dispatchWorkgroups(dispatchX, dispatchY, dispatchZ);
      pass.end();
      const measurePass = encoder.beginComputePass();
      measurePass.setPipeline(pipelines.measurePipeline);
      measurePass.setBindGroup(0, step % 2 === 0 ? bindAtoB : bindBtoA);
      measurePass.dispatchWorkgroups(dispatchX, dispatchY, dispatchZ);
      measurePass.end();
      const normalizePass = encoder.beginComputePass();
      normalizePass.setPipeline(pipelines.normalizePipeline);
      normalizePass.setBindGroup(0, step % 2 === 0 ? bindAtoB : bindBtoA);
      normalizePass.dispatchWorkgroups(dispatchX, dispatchY, dispatchZ);
      normalizePass.end();
      await submitAndWait(device, [encoder.finish()], `D3Q19 compute step ${step + 1}`, assertAlive);
      if ((step + 1) % MASS_CHECK_EVERY === 0 || step === c.steps - 1) await checkDensity(step + 1);
      if ((step + 1) % 256 === 0 || step === c.steps - 1) {
        const elapsedMs = (globalThis.performance?.now() ?? Date.now()) - started;
        options.onProgress?.({ step: step + 1, steps: c.steps, mlups: ((cells * (step + 1)) / Math.max(elapsedMs, 0.001)) / 1000, elapsedMs });
      }
    }
    const averageValues = await readFloatBuffer(device, average, averageReadback, cells * 8, "D3Q19 average", assertAlive);
    const samples = averageSampleCount(c.steps, averageFrom);
    const fieldChecksum = checksum(averageValues);
    if (!Number.isFinite(fieldChecksum) || Math.abs(fieldChecksum) <= 1e-6) throw new Error("D3Q19 velocity field checksum is empty");
    const velocityDelta = velocityDeltaFromInitial(c, averageValues, samples);
    if (!(velocityDelta > 1e-3)) throw new Error(`D3Q19 velocity field did not change from its initial state (${velocityDelta.toExponential(3)})`);
    const elapsedMs = (globalThis.performance?.now() ?? Date.now()) - started;
    return {
      cellM: c.cellM,
      nx: c.nx,
      ny: c.ny,
      layers: buildLayers(c, averageValues, samples),
      steps: c.steps,
      elapsedMs,
      adapter: adapterLabel(adapter),
      precision,
      mlups: ((cells * c.steps) / Math.max(elapsedMs, 0.001)) / 1000,
      residual: 1 / Math.max(c.steps, 1),
      fieldChecksum,
      densityChecksum: checksum(densityValues),
      densityDrift,
      densityDriftMax,
      velocityDelta,
      dispatch: { x: dispatchX, y: dispatchY, z: dispatchZ, limit: limits.maxComputeWorkgroupsPerDimension, strideX: dispatchStrideX, strideXY: dispatchStrideXY },
    };
  } finally {
    for (const buffer of buffers) {
      try { buffer.destroy(); } catch { /* device loss cleanup */ }
    }
  }
}
