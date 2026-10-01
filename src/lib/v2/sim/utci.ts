/**
 * UTCI operational procedure (Bröde et al. 2012), Version a 0.002.
 *
 * The coefficient groups below are the public COST Action 730 / utci.org
 * 6th-order polynomial, arranged as [vapour pressure, Tmrt-Ta, wind] groups
 * whose members are Horner polynomials in air temperature.  Keeping the
 * groups explicit makes the units and the evaluation order auditable while
 * avoiding a 210-term expression that is easy to mistype.
 */

export const UTCI_WIND_RANGE = [0.5, 17] as const;
export const UTCI_BREAKS = [9, 26, 32, 38, 46] as const;

type TermGroup = readonly [paPower: number, deltaPower: number, windPower: number, taCoefficients: readonly number[]];

const TERMS: readonly TermGroup[] = [
  // pa^0, deltaTmrt^0
  [0, 0, 0, [6.07562052e-1, -2.27712343e-2, 8.06470249e-4, -1.54271372e-4, -3.24651735e-6, 7.32602852e-8, 1.35959073e-9]],
  [0, 0, 1, [-2.2583652, 8.80326035e-2, 2.16844454e-3, -1.53347087e-5, -5.72983704e-7, -2.55090145e-9]],
  [0, 0, 2, [-7.51269505e-1, -4.08350271e-3, -5.21670675e-5, 1.94544667e-6, 1.14099531e-8]],
  [0, 0, 3, [1.58137256e-1, -6.57263143e-5, 2.22697524e-7, -4.16117031e-8]],
  [0, 0, 4, [-1.27762753e-2, 9.66891875e-6, 2.52785852e-9]],
  [0, 0, 5, [4.56306672e-4, -1.74202546e-7]],
  [0, 0, 6, [-5.91491269e-6]],
  // pa^0, deltaTmrt^1
  [0, 1, 0, [3.98374029e-1, 1.83945314e-4, -1.73754510e-4, -7.60781159e-7, 3.77830287e-8, 5.43079673e-10]],
  [0, 1, 1, [-2.00518269e-2, 8.92859837e-4, 3.45433048e-6, -3.77925774e-7, -1.69699377e-9]],
  [0, 1, 2, [1.69992415e-4, -4.99204314e-5, 2.47417178e-7, 1.07596466e-8]],
  [0, 1, 3, [8.49242932e-5, 1.35191328e-6, -6.21531254e-9]],
  [0, 1, 4, [-4.99410301e-6, -1.89489258e-8]],
  [0, 1, 5, [8.15300114e-8]],
  // pa^0, deltaTmrt^2
  [0, 2, 0, [7.55043090e-4, -5.65095215e-5, -4.52166564e-7, 2.46688878e-8, 2.42674348e-10]],
  [0, 2, 1, [1.54547250e-4, 5.24110970e-6, -8.75874982e-8, -1.50743064e-9]],
  [0, 2, 2, [-1.56236307e-5, -1.33895614e-7, 2.49709824e-9]],
  [0, 2, 3, [6.51711721e-7, 1.94960053e-9]],
  [0, 2, 4, [-1.00361113e-8]],
  // pa^0, deltaTmrt^3
  [0, 3, 0, [-1.21206673e-5, -2.18203660e-7, 7.51269482e-9, 9.79063848e-11]],
  [0, 3, 1, [1.25006734e-6, -1.81584736e-9, -3.52197671e-10]],
  [0, 3, 2, [-3.36514630e-8, 1.35908359e-10]],
  [0, 3, 3, [4.17032620e-10]],
  // pa^0, deltaTmrt^4..6
  [0, 4, 0, [-1.30369025e-9, 4.13908461e-10, 9.22652254e-12]],
  [0, 4, 1, [-5.08220384e-9, -2.24730961e-11]],
  [0, 4, 2, [1.17139133e-10]],
  [0, 5, 0, [6.62154879e-10, 4.03863260e-13]],
  [0, 5, 1, [1.95087203e-12]],
  [0, 6, 0, [-4.73602469e-12]],

  // pa^1
  [1, 0, 0, [5.12733497, -3.12788561e-1, -1.96701861e-2, 9.99690870e-4, 9.51738512e-6, -4.66426341e-7]],
  [1, 0, 1, [5.48050612e-1, -3.30552823e-3, -1.64119440e-3, -5.16670694e-6, 9.52692432e-7]],
  [1, 0, 2, [-4.29223622e-2, 5.00845667e-3, 1.00601257e-6, -1.81748644e-6]],
  [1, 0, 3, [-1.25813502e-3, -1.79330391e-4, 2.34994441e-6]],
  [1, 0, 4, [1.29735808e-4, 1.29064870e-6]],
  [1, 0, 5, [-2.28558686e-6]],
  [1, 1, 0, [-3.69476348e-2, 1.62325322e-3, -3.14279680e-5, 2.59835559e-6, -4.77136523e-8]],
  [1, 1, 1, [8.64203390e-3, -6.87405181e-4, -9.13863872e-6, 5.15916806e-7]],
  [1, 1, 2, [-3.59217476e-5, 3.28696511e-5, -7.10542454e-7]],
  [1, 1, 3, [-1.24382300e-5, -7.38584400e-9]],
  [1, 1, 4, [2.20609296e-7]],
  [1, 2, 0, [-7.32469180e-4, -1.87381964e-5, 4.80925239e-6, -8.75492040e-8]],
  [1, 2, 1, [2.77862930e-5, -5.06004592e-6, 1.14325367e-7]],
  [1, 2, 2, [2.53016723e-6, -1.72857035e-8]],
  [1, 2, 3, [-3.95079398e-8]],
  [1, 3, 0, [-3.59413173e-7, 7.04388046e-7, -1.89309167e-8]],
  [1, 3, 1, [-4.79768731e-7, 7.96079978e-9]],
  [1, 3, 2, [1.62897058e-9]],
  [1, 4, 0, [3.94367674e-8, -1.18566247e-9]],
  [1, 4, 1, [3.34678041e-10]],
  [1, 5, 0, [-1.15606447e-10]],

  // pa^2
  [2, 0, 0, [-2.80626406, 5.48712484e-1, -3.99428410e-3, -9.54009191e-4, 1.93090978e-5]],
  [2, 0, 1, [-3.08806365e-1, 1.16952364e-2, 4.95271903e-4, -1.90710882e-5]],
  [2, 0, 2, [2.10787756e-3, -6.98445738e-4, 2.30109073e-5]],
  [2, 0, 3, [4.17856590e-4, -1.27043871e-5]],
  [2, 0, 4, [-3.04620472e-6]],
  [2, 1, 0, [5.14507424e-2, -4.32510997e-3, 8.99281156e-5, -7.14663943e-7]],
  [2, 1, 1, [-2.66016305e-4, 2.63789586e-4, -7.01199003e-6]],
  [2, 1, 2, [-1.06823306e-4, 3.61341136e-6]],
  [2, 1, 3, [2.29748967e-7]],
  [2, 2, 0, [3.04788893e-4, -6.42070836e-5, 1.16257971e-6]],
  [2, 2, 1, [7.68023384e-6, -5.47446896e-7]],
  [2, 2, 2, [-3.59937910e-8]],
  [2, 3, 0, [-4.36497725e-6, 1.68737969e-7]],
  [2, 3, 1, [2.67489271e-8]],
  [2, 4, 0, [3.23926897e-9]],

  // pa^3
  [3, 0, 0, [-3.53874123e-2, -2.21201190e-1, 1.55126038e-2, -2.63917279e-4]],
  [3, 0, 1, [4.53433455e-2, -4.32943862e-3, 1.45389826e-4]],
  [3, 0, 2, [2.17508610e-4, -6.66724702e-5]],
  [3, 0, 3, [3.33217140e-5]],
  [3, 1, 0, [-2.26921615e-3, 3.80261982e-4, -5.45314314e-9]],
  [3, 1, 1, [-7.96355448e-4, 2.53458034e-5]],
  [3, 1, 2, [-6.31223658e-6]],
  [3, 2, 0, [3.02122035e-4, -4.77403547e-6]],
  [3, 2, 1, [1.73825715e-6]],
  [3, 3, 0, [-4.09087898e-7]],

  // pa^4
  [4, 0, 0, [6.14155345e-1, -6.16755931e-2, 1.33374846e-3]],
  [4, 0, 1, [3.55375387e-3, -5.13027851e-4]],
  [4, 0, 2, [1.02449757e-4]],
  [4, 1, 0, [-1.48526421e-3, -4.11469183e-5]],
  [4, 1, 1, [-6.80434415e-6]],
  [4, 2, 0, [-9.77675906e-6]],

  // pa^5..6
  [5, 0, 0, [8.82773108e-2, -3.01859306e-3]],
  [5, 0, 1, [1.04452989e-3]],
  [5, 1, 0, [2.47090539e-4]],
  [6, 0, 0, [1.48348065e-3]],
] as const;

function evaluateTaPolynomial(coefficients: readonly number[], taC: number): number {
  let result = 0;
  for (let i = coefficients.length - 1; i >= 0; i--) result = result * taC + coefficients[i];
  return result;
}

function evaluateOffset(taC: number, deltaTmrtC: number, wind10: number, vapourPressureKpa: number): number {
  let offset = 0;
  for (const [paPower, deltaPower, windPower, coefficients] of TERMS) {
    offset +=
      vapourPressureKpa ** paPower *
      deltaTmrtC ** deltaPower *
      wind10 ** windPower *
      evaluateTaPolynomial(coefficients, taC);
  }
  return offset;
}

/** Magnus saturation-pressure conversion followed by RH → vapour pressure. */
export function vapourPressureHpa(taC: number, rhPct: number): number {
  if (!Number.isFinite(taC) || !Number.isFinite(rhPct)) return Number.NaN;
  const saturation = 6.112 * Math.exp((17.62 * taC) / (243.12 + taC));
  return saturation * (Math.max(0, Math.min(100, rhPct)) / 100);
}

export interface UtciResult {
  value: number;
  inRange: boolean;
}

/**
 * UTCI equivalent temperature in °C.  The polynomial is intentionally
 * evaluated even when wind is outside the published 0.5–17 m/s range; the
 * caller receives `inRange: false` and can classify the cell separately.
 */
export function utci(taC: number, tmrtC: number, va10: number, rhPct: number): UtciResult {
  const finite = [taC, tmrtC, va10, rhPct].every(Number.isFinite);
  if (!finite) return { value: Number.NaN, inRange: false };
  const vapourPressureHpaValue = vapourPressureHpa(taC, rhPct);
  const value = taC + evaluateOffset(taC, tmrtC - taC, va10, vapourPressureHpaValue / 10);
  return { value, inRange: va10 >= UTCI_WIND_RANGE[0] && va10 <= UTCI_WIND_RANGE[1] };
}
