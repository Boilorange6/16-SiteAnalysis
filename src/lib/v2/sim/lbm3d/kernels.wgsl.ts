/**
 * D3Q19 pull-streaming kernel, fully unrolled per direction.
 *
 * One pass per time step does streaming, boundary handling, Smagorinsky BGK
 * collision, the velocity averaging and the global mass bookkeeping. Direction
 * and boundary conditions are generated as literals so the 19 distributions
 * stay in registers (a rolled loop over a private array spills to local
 * memory). Memory traffic per cell update is one read and one write of the 19
 * stored distributions (2 x 19 x 2 B for f16) plus the solid mask.
 *
 * Mass correction is lazy: step n accumulates the mass of the distributions it
 * stores (workgroup tree reduction, one atomic per workgroup), and step n + 1
 * scales every distribution it loads by initialMass / mass(n). This is the
 * same global renormalisation the former separate measure/normalize passes
 * applied, without two extra full-field passes.
 *
 * The host can split the 19 SoA directions into several storage buffers when
 * maxStorageBufferBindingSize or maxStorageBuffersPerShaderStage is tight.
 */

export interface Lbm3dWgslOptions {
  precision?: "f16" | "f32";
  groupSizes?: readonly number[];
  /** Number of invocations covered by one dispatch y slice. */
  dispatchStrideX?: number;
  /** Number of invocations covered by one dispatch z slice. */
  dispatchStrideXY?: number;
  workgroupSize?: number;
}

const DEFAULT_GROUP_SIZES = [19] as const;
const CX = [0, 1, -1, 0, 0, 0, 0, 1, -1, 1, -1, 1, -1, 1, -1, 0, 0, 0, 0] as const;
const CY = [0, 0, 0, 1, -1, 0, 0, 1, -1, -1, 1, 0, 0, 0, 0, 1, -1, 1, -1] as const;
const CZ = [0, 0, 0, 0, 0, 1, -1, 0, 0, 0, 0, 1, -1, -1, 1, 1, -1, -1, 1] as const;
const OPP = [0, 2, 1, 4, 3, 6, 5, 8, 7, 10, 9, 12, 11, 14, 13, 16, 15, 18, 17] as const;
const WEIGHT = (q: number): number => (q === 0 ? 1 / 3 : q < 7 ? 1 / 18 : 1 / 36);
const lit = (value: number): string => {
  const text = String(Number(value.toPrecision(9)));
  return /[.e]/.test(text) ? text : `${text}.0`;
};

/** "ux + uy", "-uz", ... — c . u for direction q. */
function dot(q: number, names: readonly [string, string, string]): string {
  const parts: string[] = [];
  const c = [CX[q], CY[q], CZ[q]];
  for (let axis = 0; axis < 3; axis++) {
    if (c[axis] === 0) continue;
    const negative = c[axis] < 0;
    parts.push(parts.length === 0 ? `${negative ? "-" : ""}${names[axis]}` : `${negative ? " - " : " + "}${names[axis]}`);
  }
  return parts.length === 0 ? "0.0" : parts.join("");
}

interface GroupSlot {
  group: number;
  offset: number;
}

function slotOf(groupSizes: readonly number[]): GroupSlot[] {
  const slots: GroupSlot[] = [];
  for (let group = 0; group < groupSizes.length; group++) {
    for (let k = 0; k < groupSizes[group]; k++) slots.push({ group, offset: k });
  }
  return slots;
}

/** Generate a WGSL shader with the requested storage precision and direction groups. */
export function d3q19KernelWgsl(options: Lbm3dWgslOptions = {}): string {
  const precision = options.precision ?? "f32";
  const groupSizes = options.groupSizes && options.groupSizes.length > 0 ? options.groupSizes : DEFAULT_GROUP_SIZES;
  if (groupSizes.reduce((sum, size) => sum + size, 0) !== 19) throw new RangeError("D3Q19 group sizes must sum to 19");
  if (groupSizes.some((size) => !Number.isInteger(size) || size < 1)) throw new RangeError("D3Q19 group sizes must be positive integers");
  const dispatchStrideX = options.dispatchStrideX ?? 4_194_240;
  const dispatchStrideXY = options.dispatchStrideXY ?? dispatchStrideX;
  if (!Number.isInteger(dispatchStrideX) || dispatchStrideX < 1 || !Number.isInteger(dispatchStrideXY) || dispatchStrideXY < dispatchStrideX) {
    throw new RangeError("D3Q19 dispatch strides must be positive integers");
  }
  const wg = options.workgroupSize ?? 64;
  if (![32, 64, 128, 256].includes(wg)) throw new RangeError("workgroupSize must be 32, 64, 128 or 256");
  const groups = groupSizes.length;
  const slots = slotOf(groupSizes);
  const solidBinding = groups * 2;
  const f16Enable = precision === "f16" ? "enable f16;\n" : "";

  const declarations: string[] = [];
  for (let group = 0; group < groups; group++) {
    declarations.push(`@group(0) @binding(${group}) var<storage, read> distIn${group}: array<${precision}>;`);
    declarations.push(`@group(0) @binding(${groups + group}) var<storage, read_write> distOut${group}: array<${precision}>;`);
  }
  const ldIn = (q: number, index: string): string => `f32(distIn${slots[q].group}[${slots[q].offset}u * cc + ${index}])`;
  const stOut = (q: number, value: string): string => `distOut${slots[q].group}[${slots[q].offset}u * cc + cell] = ${precision}(${value});`;

  const body: string[] = [];
  const add = (line: string): void => { body.push(`  ${line}`); };

  for (let q = 0; q < 19; q++) {
    const cx = CX[q], cy = CY[q], cz = CZ[q];
    const w = lit(WEIGHT(q));
    const opposite = OPP[q];
    const bounce = `${ldIn(opposite, "cell")} * factor`;
    // y/z out-of-domain: sy = y - cy < 0 -> y == 0 for cy = 1, sy >= ny -> y == ny - 1 for cy = -1.
    const outside: string[] = [];
    if (cy === 1) outside.push("y0");
    if (cy === -1) outside.push("yN");
    if (cz === 1) outside.push("z0");
    if (cz === -1) outside.push("zN");
    const offsetTerms: string[] = [];
    if (cx !== 0) offsetTerms.push(`(${cx})`);
    if (cy !== 0) offsetTerms.push(`(${cy}) * nxi`);
    if (cz !== 0) offsetTerms.push(`(${cz}) * nxyi`);
    // The tangential wall correction applies when the solid neighbour sits on the z = 0 ground layer.
    const ground = cz === 0 ? "z0" : cz === 1 ? "(z == 1u)" : null;
    const correction = cx !== 0 && ground !== null
      ? `select(bnc${q}, bnc${q} + (0.9 * 6.0 * ${w}) * ${cx}.0 * prof, ${ground})`
      : `bnc${q}`;
    add(`var v${q}: f32;`);
    let chain = "";
    if (cx === 1) {
      chain += `if (x0) { v${q} = eq(${w}, 1.0, prof, prof2); } else `;
    } else if (cx === -1) {
      chain += `if (xN) { v${q} = ${ldIn(q, "cell")} * factor; } else `;
    }
    if (outside.length > 0) chain += `if (${outside.join(" || ")}) { v${q} = ${bounce}; } else `;
    if (offsetTerms.length > 0) {
      add(`${chain}{`);
      add(`  let nb${q} = u32(i32(cell) - (${offsetTerms.join(" + ")}));`);
      add(`  let bnc${q} = ${bounce};`);
      add(`  if (is_solid(nb${q})) { v${q} = ${correction}; } else { v${q} = ${ldIn(q, `nb${q}`)} * factor; }`);
      add("}");
    } else {
      // q = 0 never leaves its own cell.
      add(`v${q} = ${ldIn(q, "cell")} * factor;`);
    }
  }

  const sum = (terms: string[]): string => terms.join(" + ");
  add(`var rho = ${sum(Array.from({ length: 19 }, (_, q) => `v${q}`))};`);
  const momentum = (axis: readonly number[]): string => {
    const parts: string[] = [];
    for (let q = 0; q < 19; q++) {
      if (axis[q] === 0) continue;
      parts.push(`${parts.length === 0 ? (axis[q] < 0 ? "-" : "") : axis[q] < 0 ? " - " : " + "}v${q}`);
    }
    return parts.join("");
  };
  add(`var ux = ${momentum(CX)};`);
  add(`var uy = ${momentum(CY)};`);
  add(`var uz = ${momentum(CZ)};`);
  add("if (!(rho > 0.00000001)) {");
  add("  rho = 1.0; ux = prof; uy = 0.0; uz = 0.0;");
  add("} else {");
  add("  let inv_rho = 1.0 / rho;");
  add("  ux = ux * inv_rho; uy = uy * inv_rho; uz = uz * inv_rho;");
  add("}");
  add("let speed_sq0 = ux * ux + uy * uy + uz * uz;");
  add("if (speed_sq0 > 0.09) {");
  add("  let scale = 0.3 / sqrt(speed_sq0);");
  add("  ux = ux * scale; uy = uy * scale; uz = uz * scale;");
  add("}");
  add("let usq = ux * ux + uy * uy + uz * uz;");
  const normTerms: string[] = [];
  for (let q = 0; q < 19; q++) {
    add(`let e${q} = eq(${lit(WEIGHT(q))}, rho, ${dot(q, ["ux", "uy", "uz"])}, usq);`);
    add(`let d${q} = v${q} - e${q};`);
    normTerms.push(`d${q} * d${q} * ${lit(1 / WEIGHT(q))}`);
  }
  add(`let non_equilibrium_norm = ${normTerms.join(" + ")};`);
  add("// Local non-equilibrium stress gives the Smagorinsky effective relaxation.");
  add("let stress = sqrt(max(0.0, non_equilibrium_norm));");
  add("let tau_eff = clamp(0.5 * (params.tau0 + sqrt(params.tau0 * params.tau0 + 18.0 * params.cs * params.cs * stress)), 0.51, 3.0);");
  add("let omega = 1.0 / tau_eff;");
  add("let sponge = select(0.0, min(1.0, (f32(x) - f32(nx) * 0.9) / max(1.0, f32(nx) * 0.1)), f32(x) >= f32(nx) * 0.9);");
  add("var msum = 0.0;");
  add("if (x == 0u) {");
  add("  // Full equilibrium inlet; keeps density at 1 in the inlet plane.");
  for (let q = 0; q < 19; q++) {
    const cuIn = CX[q] === 0 ? "0.0" : CX[q] > 0 ? "u_in" : "-u_in";
    add(`  let p${q} = rd(eq(${lit(WEIGHT(q))}, 1.0, ${cuIn}, u_in * u_in));`);
  }
  add(`  msum = ${sum(Array.from({ length: 19 }, (_, q) => `p${q}`))};`);
  for (let q = 0; q < 19; q++) add(`  ${stOut(q, `p${q}`)}`);
  add("} else if (sponge > 0.0) {");
  for (let q = 0; q < 19; q++) {
    const cu = CX[q] === 0 ? "0.0" : CX[q] > 0 ? "prof" : "-prof";
    add(`  let s${q} = rd((v${q} - d${q} * omega) * (1.0 - sponge * 0.08) + eq(${lit(WEIGHT(q))}, rho, ${cu}, prof2) * sponge * 0.08);`);
  }
  add(`  msum = ${sum(Array.from({ length: 19 }, (_, q) => `s${q}`))};`);
  for (let q = 0; q < 19; q++) add(`  ${stOut(q, `s${q}`)}`);
  add("} else {");
  for (let q = 0; q < 19; q++) {
    add(`  let c${q} = rd(v${q} - d${q} * omega);`);
  }
  add(`  msum = ${sum(Array.from({ length: 19 }, (_, q) => `c${q}`))};`);
  for (let q = 0; q < 19; q++) add(`  ${stOut(q, `c${q}`)}`);
  add("}");
  add("if ((params.flags & 2u) != 0u) { density[cell] = msum; }");
  add("if ((params.flags & 1u) != 0u) {");
  add("  let li = layerMap[z];");
  add("  if (li >= 0) {");
  add("    let normalized = select(vec2<f32>(ux / u_in, uy / u_in), vec2<f32>(1.0, 0.0), x == 0u);");
  add("    let at = u32(li) * nxy + xy;");
  add("    average[at] = average[at] + normalized;");
  add("  }");
  add("}");
  add("return msum;");

  const reduce: string[] = [];
  for (let s = wg / 2; s >= 1; s = s / 2) {
    reduce.push(`  if (lid < ${s}u) { wg_sum[lid] = wg_sum[lid] + wg_sum[lid + ${s}u]; }`);
    reduce.push("  workgroupBarrier();");
  }

  return `${f16Enable}// D3Q19 / BGK / Smagorinsky LES. Direction data is structure-of-arrays; the 19 directions are unrolled.
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
  cellCount: u32,
  flags: u32,
  initialMass: f32,
  massScale: f32,
  pad0: u32,
  pad1: u32,
}

${declarations.join("\n")}
@group(0) @binding(${solidBinding}) var<storage, read> solid: array<u32>;
@group(0) @binding(${solidBinding + 1}) var<storage, read_write> average: array<vec2<f32>>;
@group(0) @binding(${solidBinding + 2}) var<uniform> params: Params;
@group(0) @binding(${solidBinding + 3}) var<storage, read_write> density: array<f32>;
@group(0) @binding(${solidBinding + 4}) var<storage, read_write> mass: array<atomic<u32>, 2>;
@group(0) @binding(${solidBinding + 5}) var<storage, read> layerMap: array<i32>;

var<workgroup> wg_sum: array<f32, ${wg}>;
var<workgroup> wg_factor: f32;

fn eq(w: f32, rho: f32, cu: f32, usq: f32) -> f32 {
  return w * rho * (1.0 + 3.0 * cu + 4.5 * cu * cu - 1.5 * usq);
}

// Solid mask packed four cells per u32 (1 byte per cell) to keep the 19 neighbour lookups cache friendly.
fn is_solid(i: u32) -> bool {
  return ((solid[i >> 2u] >> ((i & 3u) * 8u)) & 255u) != 0u;
}

// Round to the storage precision so the mass bookkeeping sees exactly what is stored.
fn rd(x: f32) -> f32 {
  return f32(${precision}(x));
}

fn update_cell(cell: u32, factor: f32) -> f32 {
  if (is_solid(cell)) { return 0.0; }
  let nx = params.nx;
  let cc = params.cellCount;
  let nxy = nx * params.ny;
  let nxi = i32(nx);
  let nxyi = i32(nxy);
  let z = cell / nxy;
  let xy = cell - z * nxy;
  let y = xy / nx;
  let x = xy - y * nx;
  let x0 = x == 0u;
  let xN = x + 1u == nx;
  let y0 = y == 0u;
  let yN = y + 1u == params.ny;
  let z0 = z == 0u;
  let zN = z + 1u == params.nz;
  let z_m = (f32(z) + 0.5) * params.cellM;
  let prof = params.uLattice * pow(max(0.05, z_m / params.zRefM), params.profileAlpha);
  let prof2 = prof * prof;
  let u_in = max(prof, 0.000001);
${body.join("\n")}
}

@compute @workgroup_size(${wg})
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_index) lid: u32) {
  if (lid == 0u) {
    var factor = 1.0;
    if (params.step > 0u) {
      let measured = f32(atomicLoad(&mass[(params.step + 1u) & 1u])) / params.massScale;
      if (measured > 0.0) { factor = params.initialMass / measured; }
    }
    wg_factor = factor;
  }
  workgroupBarrier();
  // The host tiles very large 1D domains over 2D/3D dispatch dimensions;
  // strides are generated from the adapter's workgroup limit.
  let cell = gid.x + gid.y * ${dispatchStrideX}u + gid.z * ${dispatchStrideXY}u;
  var part = 0.0;
  if (cell < params.cellCount) { part = update_cell(cell, wg_factor); }
  wg_sum[lid] = part;
  workgroupBarrier();
${reduce.join("\n")}
  if (lid == 0u) {
    let total = wg_sum[0];
    if (total > 0.0) { atomicAdd(&mass[params.step & 1u], u32(total * params.massScale + 0.5)); }
  }
}
`;
}

/**
 * Block roll-over of the layer-average accumulators. Computes the relative
 * change of the (running or per-block) mean field, one partial sum per workgroup,
 * then clears the block accumulator.
 */
export function d3q19RolloverWgsl(dispatchStrideX: number): string {
  return `struct RParams {
  count: u32,
  live: u32,
  pad0: u32,
  pad1: u32,
  invBlock: f32,
  invTotal: f32,
  pad2: f32,
  pad3: f32,
}
@group(0) @binding(0) var<storage, read_write> blk: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read_write> total: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read_write> prevBlock: array<vec2<f32>>;
@group(0) @binding(3) var<storage, read_write> prevRun: array<vec2<f32>>;
@group(0) @binding(4) var<storage, read_write> partial: array<vec4<f32>>;
@group(0) @binding(5) var<uniform> rp: RParams;
var<workgroup> sh: array<vec4<f32>, 64>;

@compute @workgroup_size(64)
fn rollover(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_index) lid: u32, @builtin(workgroup_id) wid: vec3<u32>, @builtin(num_workgroups) nwg: vec3<u32>) {
  let i = gid.x + gid.y * ${dispatchStrideX}u;
  var acc = vec4<f32>(0.0, 0.0, 0.0, 0.0);
  if (i < rp.count) {
    let b = blk[i];
    // Change of this block's mean relative to the previous block's mean.
    let cb = b * rp.invBlock;
    let db = cb - prevBlock[i];
    acc.x = dot(db, db);
    acc.y = dot(cb, cb);
    if (rp.live != 0u) {
      // Change of the running mean of the averaging window.
      let t = total[i] + b;
      total[i] = t;
      let cr = t * rp.invTotal;
      let dr = cr - prevRun[i];
      acc.z = dot(dr, dr);
      acc.w = dot(cr, cr);
      prevRun[i] = cr;
    }
    prevBlock[i] = cb;
    blk[i] = vec2<f32>(0.0, 0.0);
  }
  sh[lid] = acc;
  workgroupBarrier();
  for (var s = 32u; s > 0u; s = s >> 1u) {
    if (lid < s) { sh[lid] = sh[lid] + sh[lid + s]; }
    workgroupBarrier();
  }
  if (lid == 0u) { partial[wid.x + wid.y * nwg.x] = sh[0]; }
}
`;
}

export const D3Q19_WGSL = d3q19KernelWgsl();
export const KERNELS_WGSL = D3Q19_WGSL;
