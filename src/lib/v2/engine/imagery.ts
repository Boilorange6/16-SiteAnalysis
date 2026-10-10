/** VWorld Satellite WMTS mosaic used by the imagery and canopy engines. */
import sharp from "sharp";
import { type LngLat } from "../crs";
import { serveTile, type TileDeps } from "../tiles";
import { MAX_Z } from "../tiles";

const TILE_SIZE = 256;
const EARTH_RADIUS_M = 6_378_137;
const MAX_MERCATOR_LAT = 85.05112878;
const DEFAULT_AERIAL_CACHE_ROOT = "D:/V-coding/16-SiteAnalysis/.cache/v2/raw/aerial";

export interface Mosaic {
  z: number;
  /** Global Web Mercator pixel coordinate of the upper-left output pixel. */
  x0Px: number;
  y0Px: number;
  width: number;
  height: number;
  /** Row-major RGB bytes, three bytes per pixel. */
  rgb: Uint8Array;
  mPerPx: number;
  missingTiles: number;
  totalTiles: number;
  /** 1 for decoded imagery and 0 for a failed WMTS tile. */
  valid?: Uint8Array;
}

function assertCenterAndRadius(center: LngLat, radiusM: number): void {
  if (center.length !== 2 || !center.every(Number.isFinite)) throw new RangeError("invalid imagery center");
  if (!Number.isFinite(radiusM) || radiusM < 0) throw new RangeError("invalid imagery radius");
}

function worldSize(z: number): number {
  return TILE_SIZE * 2 ** z;
}

function globalPixel(center: LngLat, z: number): [number, number] {
  const [lng, rawLat] = center;
  const lat = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, rawLat));
  const size = worldSize(z);
  const sin = Math.sin((lat * Math.PI) / 180);
  return [
    ((lng + 180) / 360) * size,
    (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
  ];
}

function metersPerPixel(lat: number, z: number): number {
  return (Math.cos((lat * Math.PI) / 180) * 2 * Math.PI * EARTH_RADIUS_M) / worldSize(z);
}

function wrapTileX(x: number, z: number): number {
  const count = 2 ** z;
  return ((x % count) + count) % count;
}

function copyRgb(data: Buffer, channels: number): Uint8Array {
  const rgb = new Uint8Array(TILE_SIZE * TILE_SIZE * 3);
  for (let index = 0; index < TILE_SIZE * TILE_SIZE; index++) {
    const source = index * channels;
    const target = index * 3;
    const value = data[source] ?? 0;
    if (channels === 1 || channels === 2) {
      rgb[target] = value;
      rgb[target + 1] = value;
      rgb[target + 2] = value;
    } else {
      rgb[target] = data[source] ?? 0;
      rgb[target + 1] = data[source + 1] ?? 0;
      rgb[target + 2] = data[source + 2] ?? 0;
    }
  }
  return rgb;
}

async function decodeRgb(bytes: Uint8Array): Promise<Uint8Array> {
  const decoded = await sharp(Buffer.from(bytes), { failOn: "none" }).raw().toBuffer({ resolveWithObject: true });
  if (decoded.info.width === TILE_SIZE && decoded.info.height === TILE_SIZE) return copyRgb(decoded.data, decoded.info.channels);
  const resized = await sharp(Buffer.from(bytes), { failOn: "none" })
    .resize(TILE_SIZE, TILE_SIZE, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return copyRgb(resized.data, resized.info.channels);
}

async function fetchDecodedTile(z: number, x: number, y: number, deps: TileDeps, cacheRoot: string): Promise<Uint8Array | null> {
  const request = { layer: "Satellite" as const, z: String(z), x: String(wrapTileX(x, z)), y: String(y) };
  const requestDeps = { ...deps, cacheRoot };
  const retryRateLimit = deps.now === undefined;
  for (let attempt = 0; attempt < (retryRateLimit ? 20 : 1); attempt++) {
    const reply = await serveTile(request, null, requestDeps);
    if (reply.status === 429 && attempt + 1 < 20) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      continue;
    }
    if (reply.status !== 200 || typeof reply.body === "string") return null;
    try {
      return await decodeRgb(reply.body);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Fetches and stitches the smallest VWorld WMTS zoom that keeps a 1 km study
 * radius at aerial-photo resolution. Failed tiles remain black and are marked
 * invalid so downstream grid values can be NaN rather than false negatives.
 */
export async function satelliteMosaic(center: LngLat, radiusM: number, deps: TileDeps = {}): Promise<Mosaic> {
  assertCenterAndRadius(center, radiusM);
  const z = radiusM <= 1_000 ? 18 : 17;
  const mPerPx = metersPerPixel(center[1], z);
  const [cxPx, cyPx] = globalPixel(center, z);
  const halfPixels = radiusM / mPerPx;
  const x0Px = Math.floor(cxPx - halfPixels);
  const y0Px = Math.floor(cyPx - halfPixels);
  const x1Px = Math.ceil(cxPx + halfPixels);
  const y1Px = Math.ceil(cyPx + halfPixels);
  const width = Math.max(1, x1Px - x0Px);
  const height = Math.max(1, y1Px - y0Px);
  const firstTileX = Math.floor(x0Px / TILE_SIZE);
  const lastTileX = Math.floor((x1Px - 1) / TILE_SIZE);
  const firstTileY = Math.floor(y0Px / TILE_SIZE);
  const lastTileY = Math.floor((y1Px - 1) / TILE_SIZE);
  const tileCoordinates: Array<{ x: number; y: number }> = [];
  for (let y = firstTileY; y <= lastTileY; y++) {
    for (let x = firstTileX; x <= lastTileX; x++) tileCoordinates.push({ x, y });
  }

  const rgb = new Uint8Array(width * height * 3);
  const valid = new Uint8Array(width * height);
  const cacheRoot = deps.cacheRoot ?? DEFAULT_AERIAL_CACHE_ROOT;
  const decoded = await Promise.all(tileCoordinates.map(({ x, y }) => fetchDecodedTile(z, x, y, deps, cacheRoot)));
  let missingTiles = 0;
  const tileCount = 2 ** z;
  for (let index = 0; index < tileCoordinates.length; index++) {
    const tile = decoded[index];
    if (!tile) {
      missingTiles += 1;
      continue;
    }
    const { x, y } = tileCoordinates[index];
    if (y < 0 || y >= tileCount) {
      missingTiles += 1;
      continue;
    }
    const tileLeft = x * TILE_SIZE;
    const tileTop = y * TILE_SIZE;
    const left = Math.max(x0Px, tileLeft);
    const right = Math.min(x1Px, tileLeft + TILE_SIZE);
    const top = Math.max(y0Px, tileTop);
    const bottom = Math.min(y1Px, tileTop + TILE_SIZE);
    for (let globalY = top; globalY < bottom; globalY++) {
      const sourceRow = (globalY - tileTop) * TILE_SIZE;
      const targetRow = (globalY - y0Px) * width;
      for (let globalX = left; globalX < right; globalX++) {
        const sourcePixel = (sourceRow + globalX - tileLeft) * 3;
        const targetPixel = (targetRow + globalX - x0Px) * 3;
        rgb[targetPixel] = tile[sourcePixel];
        rgb[targetPixel + 1] = tile[sourcePixel + 1];
        rgb[targetPixel + 2] = tile[sourcePixel + 2];
        valid[targetRow + globalX - x0Px] = 1;
      }
    }
  }
  return { z, x0Px, y0Px, width, height, rgb, mPerPx, missingTiles, totalTiles: tileCoordinates.length, valid };
}
