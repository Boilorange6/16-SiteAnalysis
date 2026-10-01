/**
 * D3Q19 pull-streaming kernel.
 *
 * The host can split the 19 SoA directions into several storage buffers when
 * maxStorageBufferBindingSize or maxStorageBuffersPerShaderStage is tight.
 * Each generated shader still performs one collision/streaming pass per cell.
 */

export interface Lbm3dWgslOptions {
  precision?: "f16" | "f32";
  groupSizes?: readonly number[];
}

const DEFAULT_GROUP_SIZES = [19] as const;

function switchFunction(name: string, values: readonly number[], type: "i32" | "u32"): string {
  return `${values.map((value, i) => `  if (q == ${i}u) { return ${value}${type === "u32" ? "u" : ""}; }`).join("\n")}\n  return 0${type === "u32" ? "u" : ""};`;
}

function groupFunction(groupSizes: readonly number[], scalar: "f16" | "f32"): { load: string; store: string; declarations: string } {
  const declarations: string[] = [];
  let start = 0;
  for (let group = 0; group < groupSizes.length; group++) {
    declarations.push(`@group(0) @binding(${group}) var<storage, read> distIn${group}: array<${scalar}>;`);
    declarations.push(`@group(0) @binding(${groupSizes.length + group}) var<storage, read_write> distOut${group}: array<${scalar}>;`);
    start += groupSizes[group];
  }
  const loadParts: string[] = [];
  const storeParts: string[] = [];
  start = 0;
  for (let group = 0; group < groupSizes.length; group++) {
    const end = start + groupSizes[group];
    loadParts.push(`  if (q < ${end}u) { return f32(distIn${group}[(q - ${start}u) * cell_count() + cell]); }`);
    storeParts.push(`  if (q < ${end}u) { distOut${group}[(q - ${start}u) * cell_count() + cell] = ${scalar}(value); return; }`);
    start = end;
  }
  return {
    declarations: declarations.join("\n"),
    load: `${loadParts.join("\n")}\n  return 0.0;`,
    store: `${storeParts.join("\n")}`,
  };
}

/** Generate a WGSL shader with the requested storage precision and direction groups. */
export function d3q19KernelWgsl(options: Lbm3dWgslOptions = {}): string {
  const precision = options.precision ?? "f32";
  const groupSizes = options.groupSizes && options.groupSizes.length > 0 ? options.groupSizes : DEFAULT_GROUP_SIZES;
  if (groupSizes.reduce((sum, size) => sum + size, 0) !== 19) throw new RangeError("D3Q19 group sizes must sum to 19");
  if (groupSizes.some((size) => !Number.isInteger(size) || size < 1)) throw new RangeError("D3Q19 group sizes must be positive integers");
  const group = groupFunction(groupSizes, precision);
  const solidBinding = groupSizes.length * 2;
  const averageBinding = solidBinding + 1;
  const paramsBinding = solidBinding + 2;
  const f16Enable = precision === "f16" ? "enable f16;\n" : "";
  const cx = [0, 1, -1, 0, 0, 0, 0, 1, -1, 1, -1, 1, -1, 1, -1, 0, 0, 0, 0] as const;
  const cy = [0, 0, 0, 1, -1, 0, 0, 1, -1, -1, 1, 0, 0, 0, 0, 1, -1, 1, -1] as const;
  const cz = [0, 0, 0, 0, 0, 1, -1, 0, 0, 0, 0, 1, -1, -1, 1, 1, -1, -1, 1] as const;
  const opposite = [0, 2, 1, 4, 3, 6, 5, 8, 7, 10, 9, 12, 11, 14, 13, 16, 15, 18, 17] as const;

  return `${f16Enable}// D3Q19 / BGK / Smagorinsky LES. Direction data is structure-of-arrays.
struct Params {
  nx: u32,
  ny: u32,
  nz: u32,
  step: u32,
  cellM: f32,
  uLattice: f32,
  profileAlpha: f32,
  zRefM: f32,
  cs: f32,
  tau0: f32,
  averageFrom: u32,
  averageEvery: u32,
}

${group.declarations}
@group(0) @binding(${solidBinding}) var<storage, read> solid: array<u32>;
@group(0) @binding(${averageBinding}) var<storage, read_write> average: array<vec2<f32>>;
@group(0) @binding(${paramsBinding}) var<uniform> params: Params;

const CX: array<i32, 19> = array<i32, 19>(${cx.join(", ")});
const CY: array<i32, 19> = array<i32, 19>(${cy.join(", ")});
const CZ: array<i32, 19> = array<i32, 19>(${cz.join(", ")});
const OPP: array<u32, 19> = array<u32, 19>(${opposite.join(", ")});

fn cell_count() -> u32 {
  return params.nx * params.ny * params.nz;
}

fn cx(q: u32) -> i32 { return CX[q]; }
fn cy(q: u32) -> i32 { return CY[q]; }
fn cz(q: u32) -> i32 { return CZ[q]; }
fn weight(q: u32) -> f32 {
  if (q == 0u) { return 0.3333333333333333; }
  if (q < 7u) { return 0.0555555555555556; }
  return 0.0277777777777778;
}

fn inflow_profile(z: u32) -> f32 {
  let z_m = (f32(z) + 0.5) * params.cellM;
  return params.uLattice * pow(max(0.05, z_m / params.zRefM), params.profileAlpha);
}

fn equilibrium(q: u32, rho: f32, ux: f32, uy: f32, uz: f32) -> f32 {
  let cu = f32(cx(q)) * ux + f32(cy(q)) * uy + f32(cz(q)) * uz;
  let speed_sq = ux * ux + uy * uy + uz * uz;
  return weight(q) * rho * (1.0 + 3.0 * cu + 4.5 * cu * cu - 1.5 * speed_sq);
}

fn load_dist(q: u32, cell: u32) -> f32 {
${group.load}
}

fn store_dist(q: u32, cell: u32, value: f32) {
${group.store}
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  // The host tiles very large 1D domains over a second dispatch dimension;
  // 65,535 is the WebGPU minimum per-dimension workgroup limit.
  let cell = gid.x + gid.y * 4194240u;
  if (cell >= cell_count()) { return; }
  if (solid[cell] != 0u) {
    for (var q: u32 = 0u; q < 19u; q = q + 1u) { store_dist(q, cell, 0.0); }
    average[cell] = vec2<f32>(0.0, 0.0);
    return;
  }

  let nxy = params.nx * params.ny;
  let z = cell / nxy;
  let y = (cell % nxy) / params.nx;
  let x = cell % params.nx;
  var incoming: array<f32, 19>;
  for (var q: u32 = 0u; q < 19u; q = q + 1u) {
    let sx = i32(x) - cx(q);
    let sy = i32(y) - cy(q);
    let sz = i32(z) - cz(q);
    if (sx < 0 || sx >= i32(params.nx) || sy < 0 || sy >= i32(params.ny) || sz < 0 || sz >= i32(params.nz)) {
      if (sx < 0 && cx(q) > 0) {
        incoming[q] = equilibrium(q, 1.0, inflow_profile(z), 0.0, 0.0);
      } else if (sx >= i32(params.nx) && cx(q) < 0) {
        incoming[q] = load_dist(q, cell);
      } else {
        incoming[q] = load_dist(OPP[q], cell);
      }
    } else {
      let neighbor = u32(sx) + params.nx * (u32(sy) + params.ny * u32(sz));
      if (solid[neighbor] != 0u) {
        let bounced = load_dist(OPP[q], cell);
        // Halfway bounce-back with a tangential power-law wall correction at
        // z=0 keeps the prescribed atmospheric inlet profile in the first
        // fluid layer. Building faces use stationary bounce-back.
        incoming[q] = select(bounced, bounced + 0.9 * 6.0 * weight(q) * inflow_profile(z) * f32(cx(q)), sz == 0);
      } else {
        incoming[q] = load_dist(q, neighbor);
      }
    }
  }

  var rho = 0.0;
  var ux = 0.0;
  var uy = 0.0;
  var uz = 0.0;
  for (var q: u32 = 0u; q < 19u; q = q + 1u) {
    rho = rho + incoming[q];
    ux = ux + incoming[q] * f32(cx(q));
    uy = uy + incoming[q] * f32(cy(q));
    uz = uz + incoming[q] * f32(cz(q));
  }
  if (!(rho > 0.00000001)) {
    rho = 1.0;
    ux = inflow_profile(z);
    uy = 0.0;
    uz = 0.0;
  } else {
    ux = ux / rho;
    uy = uy / rho;
    uz = uz / rho;
  }
  let speed_sq = ux * ux + uy * uy + uz * uz;
  if (speed_sq > 0.09) {
    let scale = 0.3 / sqrt(speed_sq);
    ux = ux * scale;
    uy = uy * scale;
    uz = uz * scale;
  }

  var equilibrium_values: array<f32, 19>;
  var non_equilibrium_norm = 0.0;
  for (var q: u32 = 0u; q < 19u; q = q + 1u) {
    equilibrium_values[q] = equilibrium(q, rho, ux, uy, uz);
    let delta = incoming[q] - equilibrium_values[q];
    non_equilibrium_norm = non_equilibrium_norm + delta * delta / max(weight(q), 0.000001);
  }
  // Local non-equilibrium stress gives the Smagorinsky effective relaxation.
  let stress = sqrt(max(0.0, non_equilibrium_norm));
  let tau_eff = clamp(0.5 * (params.tau0 + sqrt(params.tau0 * params.tau0 + 18.0 * params.cs * params.cs * stress)), 0.51, 3.0);
  let sponge = select(0.0, min(1.0, (f32(x) - f32(params.nx) * 0.9) / max(1.0, f32(params.nx) * 0.1)), f32(x) >= f32(params.nx) * 0.9);
  let sponge_ux = inflow_profile(z);
  let u_in = max(inflow_profile(z), 0.000001);
  for (var q: u32 = 0u; q < 19u; q = q + 1u) {
    var post = incoming[q] - (incoming[q] - equilibrium_values[q]) / tau_eff;
    if (sponge > 0.0) {
      let target_value = equilibrium(q, rho, sponge_ux, 0.0, 0.0);
      post = post * (1.0 - sponge * 0.08) + target_value * sponge * 0.08;
    }
    // Full equilibrium inlet avoids density drift in the small reference
    // channel while preserving the explicit pull boundary above.
    if (x == 0u) { post = equilibrium(q, 1.0, u_in, 0.0, 0.0); }
    store_dist(q, cell, post);
  }
  let normalized = select(vec2<f32>(ux / u_in, uy / u_in), vec2<f32>(1.0, 0.0), x == 0u);
  if (params.step >= params.averageFrom && params.step % params.averageEvery == 0u) {
    average[cell] = average[cell] + normalized;
  }
}
`;
}

export const D3Q19_WGSL = d3q19KernelWgsl();
export const KERNELS_WGSL = D3Q19_WGSL;
