/**
 * A small, deterministic six-direction radiation model for the UTCI tile.
 *
 * This is intentionally a model input adapter rather than a surface solver:
 * direct and diffuse short-wave radiation are split from GHI, SVF controls the
 * open-sky share, and the remaining long-wave exchange is represented by the
 * air/ground temperatures.  The constants are exported because S04 records
 * them in its simulation conditions.
 */

export const AK = 0.7;
export const EP = 0.97;
export const F_UPDOWN = 0.06;
export const F_LATERAL = 0.22;
export const ALBEDO_GROUND = 0.15;
export const ALBEDO_WALL = 0.2;
export const EPS_SURFACE = 0.95;
export const GROUND_HEATING_C_PER_WM2 = 0.0121;
export const STEFAN_BOLTZMANN = 5.670374419e-8;

const DEG_TO_RAD = Math.PI / 180;
const SOLAR_CONSTANT_WM2 = 1367;
const HEMISPHERE_FACTOR = F_UPDOWN + 2 * F_LATERAL;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function saturationVapourPressureHpa(taC: number): number {
  // Magnus-Tetens, hPa.  The same formulation is used for sky emissivity and
  // UTCI RH conversion so a tile does not mix vapour-pressure conventions.
  return 6.112 * Math.exp((17.62 * taC) / (243.12 + taC));
}

function extraterrestrialNormalIrradiance(dayOfYear: number): number {
  const day = clamp(Math.round(dayOfYear), 1, 366);
  return SOLAR_CONSTANT_WM2 * (1 + 0.033 * Math.cos((2 * Math.PI * (day - 3)) / 365));
}

/**
 * Erbs (1982) decomposition of global horizontal irradiance.
 *
 * `dni` is normal to the sun beam and `dhi` is horizontal.  At night the
 * result is exactly zero instead of allowing a division by sin(altitude).
 */
export function erbsSplit(ghiWm2: number, sunAltDeg: number, dayOfYear: number): { dni: number; dhi: number; kt: number } {
  const ghi = Number.isFinite(ghiWm2) ? Math.max(0, ghiWm2) : 0;
  const altitude = Number.isFinite(sunAltDeg) ? sunAltDeg : -90;
  const sinAltitude = Math.sin(altitude * DEG_TO_RAD);
  if (ghi <= 0 || altitude <= 0 || sinAltitude <= 1e-6) return { dni: 0, dhi: 0, kt: 0 };

  const extraterrestrialHorizontal = extraterrestrialNormalIrradiance(dayOfYear) * sinAltitude;
  const kt = ghi / extraterrestrialHorizontal;
  const diffuseFraction =
    kt <= 0.22
      ? 1 - 0.09 * kt
      : kt <= 0.8
        ? 0.9511 - 0.1604 * kt + 4.388 * kt ** 2 - 16.638 * kt ** 3 + 12.336 * kt ** 4
        : 0.165;
  const dhi = clamp(ghi * diffuseFraction, 0, ghi);
  const dni = Math.max(0, (ghi - dhi) / sinAltitude);
  return { dni, dhi, kt };
}

/** Prata (1996) clear-sky emissivity, linearly blended to overcast sky. */
export function skyEmissivity(taC: number, rhPct: number, cloud10: number): number {
  const taK = taC + 273.15;
  if (!Number.isFinite(taK) || taK <= 0) return 1;
  const rh = clamp(Number.isFinite(rhPct) ? rhPct : 0, 0, 100);
  const vapourPressure = saturationVapourPressureHpa(taC) * (rh / 100);
  const xi = (46.5 * vapourPressure) / taK;
  const clear = 1 - (1 + xi) * Math.exp(-Math.sqrt(1.2 + 3 * xi));
  const cloud = clamp(Number.isFinite(cloud10) ? cloud10 / 10 : 0, 0, 1);
  return clamp(clear * (1 - cloud) + cloud, 0, 1);
}

export interface TmrtInput {
  taC: number;
  rhPct: number;
  ghiWm2: number;
  cloud10: number;
  sunAltDeg: number;
  dayOfYear: number;
  svf: number;
  sunlit: boolean;
  groundSunlit: boolean;
}

/**
 * Estimate mean radiant temperature for an upright person.
 *
 * The six-direction form factors are F_UPDOWN for the vertical directions
 * and F_LATERAL for one effective lateral direction.  The open upper/lower
 * hemisphere factor is 0.50 (= .06 + 2*.22).  Direct beam is projected with
 * the published cylindrical-person factor; reflected components retain their
 * direction-specific factors so tree/building shade remains visible.
 */
export function tmrt(i: TmrtInput): number {
  const taC = Number.isFinite(i.taC) ? i.taC : 0;
  const ghi = Number.isFinite(i.ghiWm2) ? Math.max(0, i.ghiWm2) : 0;
  const svf = clamp(Number.isFinite(i.svf) ? i.svf : 1, 0, 1);
  const altitude = Number.isFinite(i.sunAltDeg) ? i.sunAltDeg : -90;
  const split = erbsSplit(ghi, altitude, i.dayOfYear);

  // Fanger/RayMan projection factor; altitude is expressed in degrees.
  const projection = altitude > 0 ? 0.308 * Math.cos((altitude * (1 - (altitude * altitude) / 48402)) * DEG_TO_RAD) : 0;
  const direct = i.sunlit ? split.dni * Math.max(0, projection) : 0;
  const diffuseSky = split.dhi * HEMISPHERE_FACTOR * svf;

  const diffuseGroundRatio = ghi > 0 ? split.dhi / ghi : 0;
  const groundIncident = ghi * ALBEDO_GROUND * (i.groundSunlit ? 1 : diffuseGroundRatio);
  const groundReflection = groundIncident * (i.groundSunlit ? HEMISPHERE_FACTOR : F_UPDOWN);
  const wallReflection = (1 - svf) * ALBEDO_WALL * ghi * F_LATERAL;
  const absorbedShortwave = AK * (direct + diffuseSky + groundReflection + wallReflection);

  const taK = taC + 273.15;
  const groundC = i.groundSunlit ? taC + GROUND_HEATING_C_PER_WM2 * ghi : taC;
  const groundK = groundC + 273.15;
  const skyWeight = HEMISPHERE_FACTOR * svf;
  const surfaceWeight = 1 - skyWeight;
  const skyLongwave = skyEmissivity(taC, i.rhPct, i.cloud10) * STEFAN_BOLTZMANN * taK ** 4 * skyWeight;
  const surfaceLongwave = EPS_SURFACE * STEFAN_BOLTZMANN * groundK ** 4 * surfaceWeight;
  const totalAbsorbed = Math.max(0, skyLongwave + surfaceLongwave + absorbedShortwave);
  return Math.pow(totalAbsorbed / (EP * STEFAN_BOLTZMANN), 0.25) - 273.15;
}
