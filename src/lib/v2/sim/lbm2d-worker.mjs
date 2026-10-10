import { workerData } from "node:worker_threads";

const CS2 = 1 / 3;
const CONTROL_ARRIVALS = 0;
const CONTROL_GENERATION = 1;
const CONTROL_DONE = 2;
const CONTROL_ERROR = 3;
const CONTROL_STARTED = 4;
const EDGE_LEFT = 1;
const EDGE_RIGHT = 2;
const EDGE_BOTTOM = 4;
const EDGE_TOP = 8;

const {
  nx, ny, n, steps, u0, nu, cs, firstAverage, workerId, workerCount, rowStart, rowEnd, stallForTest,
  fluid: fluidBuffer, fluidStart, fluidEnd,
  stateA: stateABuffer, stateB: stateBBuffer,
  solid: solidBuffer, regular: regularBuffer, edge: edgeBuffer,
  east: eastBuffer, north: northBuffer, west: westBuffer, south: southBuffer,
  northEast: northEastBuffer, northWest: northWestBuffer,
  southWest: southWestBuffer, southEast: southEastBuffer,
  sumU: sumUBuffer, sumV: sumVBuffer, prevUx: prevUxBuffer, prevUy: prevUyBuffer,
  deltaParts: deltaPartsBuffer, speedParts: speedPartsBuffer, control: controlBuffer,
  inflow: inflowValues,
} = workerData;

const solid = new Uint8Array(solidBuffer);
const regular = new Uint8Array(regularBuffer);
const edge = new Uint8Array(edgeBuffer);
const east = new Int32Array(eastBuffer);
const north = new Int32Array(northBuffer);
const west = new Int32Array(westBuffer);
const south = new Int32Array(southBuffer);
const northEast = new Int32Array(northEastBuffer);
const northWest = new Int32Array(northWestBuffer);
const southWest = new Int32Array(southWestBuffer);
const southEast = new Int32Array(southEastBuffer);
const fluid = new Int32Array(fluidBuffer);
const sumU = new Float64Array(sumUBuffer);
const sumV = new Float64Array(sumVBuffer);
const prevUx = new Float32Array(prevUxBuffer);
const prevUy = new Float32Array(prevUyBuffer);
const deltaParts = new Float64Array(deltaPartsBuffer);
const speedParts = new Float64Array(speedPartsBuffer);
const control = new Int32Array(controlBuffer);
const inflow = inflowValues;
const statesA = new Float32Array(stateABuffer);
const statesB = new Float32Array(stateBBuffer);
const baseTau = 0.5 + 3 * nu;
const baseOmega = 1 / baseTau;
const smagFactor = 3 * cs * cs;
const inverseU0 = 1 / u0;
const strainScale = 1 / (2 * CS2 * baseTau);
const W0 = 4 / 9, W1 = 1 / 9, W2 = 1 / 9, W3 = 1 / 9, W4 = 1 / 9;
const W5 = 1 / 36, W6 = 1 / 36, W7 = 1 / 36, W8 = 1 / 36;

function barrier() {
  const generation = Atomics.load(control, CONTROL_GENERATION);
  if (Atomics.add(control, CONTROL_ARRIVALS, 1) === workerCount - 1) {
    Atomics.store(control, CONTROL_ARRIVALS, 0);
    Atomics.store(control, CONTROL_GENERATION, generation + 1);
    Atomics.notify(control, CONTROL_GENERATION, workerCount - 1);
    return;
  }
  while (Atomics.load(control, CONTROL_GENERATION) === generation && Atomics.load(control, CONTROL_ERROR) === 0) Atomics.wait(control, CONTROL_GENERATION, generation);
  if (Atomics.load(control, CONTROL_ERROR) !== 0) throw new Error("parallel D2Q9 barrier failed");
}

function applyXBoundaries(currentNext) {
  for (let y = 0; y < ny; y++) {
    const left = y * nx;
    const leftBase = left * 9;
    if (solid[left] === 0) for (let k = 0; k < 9; k++) currentNext[leftBase + k] = inflow[k];
    const right = left + nx - 1;
    if (solid[right] === 0) {
      const upstream = right - 1;
      const rightBase = right * 9, upstreamBase = upstream * 9;
      for (let k = 0; k < 9; k++) currentNext[rightBase + k] = solid[upstream] === 0 ? currentNext[upstreamBase + k] : inflow[k];
    }
  }
}

try {
  // 테스트 전용: 시작하지 않는 worker를 흉내 낸다(호출자의 startup timeout이 오류를 내야 한다).
  if (stallForTest) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  Atomics.add(control, CONTROL_STARTED, 1);
  Atomics.notify(control, CONTROL_STARTED, workerCount);

  for (let step = 1; step <= steps; step++) {
    const current = step % 2 === 1 ? statesA : statesB;
    const currentNext = step % 2 === 1 ? statesB : statesA;
    let delta2 = 0;
    let speed2 = 0;

    for (let cell = fluidStart; cell < fluidEnd; cell++) {
        const idx = fluid[cell];
        const base = idx * 9;
        const a0 = current[base], a1 = current[base + 1], a2 = current[base + 2], a3 = current[base + 3], a4 = current[base + 4], a5 = current[base + 5], a6 = current[base + 6], a7 = current[base + 7], a8 = current[base + 8];
        let rho = a0 + a1 + a2 + a3 + a4 + a5 + a6 + a7 + a8;
        let ux = (a1 - a3 + a5 - a6 - a7 + a8) / rho;
        let uy = (a2 - a4 + a5 + a6 - a7 - a8) / rho;
        if (!(rho > 0)) {
          rho = 1;
          ux = u0;
          uy = 0;
        }

        if (step > 1 && step === steps) {
          const du = ux - prevUx[idx], dv = uy - prevUy[idx];
          delta2 += du * du + dv * dv;
          speed2 += ux * ux + uy * uy;
        }
        prevUx[idx] = ux;
        prevUy[idx] = uy;

        const ux2 = ux * ux, uy2 = uy * uy;
        let omega = baseOmega;
        if (smagFactor !== 0) {
          const inverseRho = 1 / rho;
          const pxx = (a1 + a3 + a5 + a6 + a7 + a8) * inverseRho;
          const pyy = (a2 + a4 + a5 + a6 + a7 + a8) * inverseRho;
          const pxy = (a5 - a6 + a7 - a8) * inverseRho;
          const sxx = -(pxx - CS2 - ux2) * strainScale;
          const syy = -(pyy - CS2 - uy2) * strainScale;
          const sxy = -(pxy - ux * uy) * strainScale;
          const strain2 = 2 * (sxx * sxx + syy * syy + 2 * sxy * sxy);
          if (strain2 > 1e-12) omega = 1 / (baseTau + smagFactor * Math.sqrt(strain2));
        }
        const uu = ux2 + uy2;
        const common = 1 - 1.5 * uu;
        let cu = ux;
        const q0 = a0 + omega * (W0 * rho * common - a0);
        const q1 = a1 + omega * (W1 * rho * (common + 3 * cu + 4.5 * cu * cu) - a1);
        cu = uy;
        const q2 = a2 + omega * (W2 * rho * (common + 3 * cu + 4.5 * cu * cu) - a2);
        cu = -ux;
        const q3 = a3 + omega * (W3 * rho * (common + 3 * cu + 4.5 * cu * cu) - a3);
        cu = -uy;
        const q4 = a4 + omega * (W4 * rho * (common + 3 * cu + 4.5 * cu * cu) - a4);
        cu = ux + uy;
        const q5 = a5 + omega * (W5 * rho * (common + 3 * cu + 4.5 * cu * cu) - a5);
        cu = -ux + uy;
        const q6 = a6 + omega * (W6 * rho * (common + 3 * cu + 4.5 * cu * cu) - a6);
        cu = -ux - uy;
        const q7 = a7 + omega * (W7 * rho * (common + 3 * cu + 4.5 * cu * cu) - a7);
        cu = ux - uy;
        const q8 = a8 + omega * (W8 * rho * (common + 3 * cu + 4.5 * cu * cu) - a8);

        currentNext[base] = q0;
        if (regular[idx] !== 0) {
          currentNext[base + 9 + 1] = q1;
          currentNext[base + nx * 9 + 2] = q2;
          currentNext[base - 9 + 3] = q3;
          currentNext[base - nx * 9 + 4] = q4;
          currentNext[base + nx * 9 + 9 + 5] = q5;
          currentNext[base + nx * 9 - 9 + 6] = q6;
          currentNext[base - nx * 9 - 9 + 7] = q7;
          currentNext[base - nx * 9 + 9 + 8] = q8;
        } else {
          const boundary = edge[idx];
          let target = east[idx];
          if (target >= 0) currentNext[target * 9 + 1] = q1;
          else if ((boundary & EDGE_RIGHT) === 0) currentNext[base + 3] = q1;
          target = north[idx];
          if (target >= 0) currentNext[target * 9 + 2] = q2;
          else currentNext[base + 4] = q2;
          target = west[idx];
          if (target >= 0) currentNext[target * 9 + 3] = q3;
          else if ((boundary & EDGE_LEFT) === 0) currentNext[base + 1] = q3;
          target = south[idx];
          if (target >= 0) currentNext[target * 9 + 4] = q4;
          else currentNext[base + 2] = q4;
          target = northEast[idx];
          if (target >= 0) currentNext[target * 9 + 5] = q5;
          else if ((boundary & EDGE_RIGHT) === 0) {
            if ((boundary & EDGE_TOP) !== 0) currentNext[base + 8] = q5;
            else currentNext[base + 7] = q5;
          }
          target = northWest[idx];
          if (target >= 0) currentNext[target * 9 + 6] = q6;
          else if ((boundary & EDGE_LEFT) === 0) {
            if ((boundary & EDGE_TOP) !== 0) currentNext[base + 7] = q6;
            else currentNext[base + 8] = q6;
          }
          target = southWest[idx];
          if (target >= 0) currentNext[target * 9 + 7] = q7;
          else if ((boundary & EDGE_LEFT) === 0) {
            if ((boundary & EDGE_BOTTOM) !== 0) currentNext[base + 6] = q7;
            else currentNext[base + 5] = q7;
          }
          target = southEast[idx];
          if (target >= 0) currentNext[target * 9 + 8] = q8;
          else if ((boundary & EDGE_RIGHT) === 0) {
            if ((boundary & EDGE_BOTTOM) !== 0) currentNext[base + 5] = q8;
            else currentNext[base + 6] = q8;
          }
        }

        if (step > firstAverage) {
          sumU[idx] += ux * inverseU0;
          sumV[idx] += uy * inverseU0;
        }
    }

    if (step === steps) {
      deltaParts[workerId] = delta2;
      speedParts[workerId] = speed2;
    }
    barrier();
    if (workerId === 0) applyXBoundaries(currentNext);
    barrier();
  }
  Atomics.add(control, CONTROL_DONE, 1);
  Atomics.notify(control, CONTROL_DONE, 1);
} catch {
  Atomics.store(control, CONTROL_ERROR, 1);
  Atomics.notify(control, CONTROL_GENERATION, workerCount);
  Atomics.notify(control, CONTROL_STARTED, workerCount);
  Atomics.add(control, CONTROL_DONE, 1);
  Atomics.notify(control, CONTROL_DONE, 1);
}
