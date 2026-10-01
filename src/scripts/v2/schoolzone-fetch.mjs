/**
 * VWorld Data API national school-zone polygon fetcher.
 *
 *   node src/scripts/v2/schoolzone-fetch.mjs [--out D:/.../school_zone/vworld]
 *     [--delay-ms 250] [--tile-deg 0.5] [--force]
 *
 * The API is paged at size=1000 and queried over small WGS84 bbox tiles. A
 * feature can occur in more than one bbox, so the raw output is deduplicated
 * by hakgudo_id + objectid. Keys are read from the main checkout .env.local
 * (or the current directory's .env.local) and are never logged.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const API_URL = "https://api.vworld.kr/req/data";
const DEFAULT_OUT = "D:/V-coding/16-SiteAnalysis/.cache/v2/raw/school_zone/vworld";
const PAGE_SIZE = 1000;
const DEFAULT_TILE_DEG = 0.5;
const DEFAULT_DELAY_MS = 250;
const DEFAULT_RETRIES = 5;
const NATIONAL_BBOX = { minX: 124.5, minY: 33, maxX: 132, maxY: 39.5 };
const LAYERS = [
  { id: "LT_C_DESCH", label: "elem" },
  { id: "LT_C_DMSCH", label: "middle" },
  { id: "LT_C_DHSCH", label: "high" },
];

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : args[i + 1];
};
const has = (name) => args.includes(`--${name}`);
const outDir = resolve(String(opt("out", DEFAULT_OUT)));
const tileDeg = Number(opt("tile-deg", DEFAULT_TILE_DEG));
const delayMs = Number(opt("delay-ms", DEFAULT_DELAY_MS));
const retries = Number(opt("retries", DEFAULT_RETRIES));
if (!Number.isFinite(tileDeg) || tileDeg <= 0 || tileDeg > 2) throw new Error("--tile-deg must be in (0, 2]");
if (!Number.isFinite(delayMs) || delayMs < 0) throw new Error("--delay-ms must be >= 0");
if (!Number.isInteger(retries) || retries < 1 || retries > 10) throw new Error("--retries must be an integer in [1, 10]");

const envFile = existsSync(".env.local") ? resolve(".env.local") : "D:/V-coding/16-SiteAnalysis/.env.local";
if (existsSync(envFile)) process.loadEnvFile(envFile);
const apiKey = process.env.VWORLD_API_KEY;
if (!apiKey) {
  console.error("VWORLD_API_KEY가 .env.local에 없습니다.");
  process.exit(2);
}

const sleep = (ms) => new Promise((resolve_) => setTimeout(resolve_, ms));
const round = (n) => Math.round(n * 1e6) / 1e6;
const tileCount = (min, max) => Math.ceil((max - min) / tileDeg - 1e-12);

function tiles() {
  const out = [];
  for (let yi = 0; yi < tileCount(NATIONAL_BBOX.minY, NATIONAL_BBOX.maxY); yi++) {
    const minY = round(NATIONAL_BBOX.minY + yi * tileDeg);
    const maxY = round(Math.min(NATIONAL_BBOX.maxY, minY + tileDeg));
    for (let xi = 0; xi < tileCount(NATIONAL_BBOX.minX, NATIONAL_BBOX.maxX); xi++) {
      const minX = round(NATIONAL_BBOX.minX + xi * tileDeg);
      const maxX = round(Math.min(NATIONAL_BBOX.maxX, minX + tileDeg));
      out.push({ minX, minY, maxX, maxY });
    }
  }
  return out;
}

function asNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function responseError(json, httpStatus) {
  const response = json?.response;
  const status = response?.status ?? `HTTP_${httpStatus}`;
  const code = response?.error?.code ?? response?.error?.text ?? "";
  return `${status}${code ? ` (${String(code).slice(0, 120)})` : ""}`;
}

async function getPage(layer, tile, page, counters) {
  let lastError = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    const params = new URLSearchParams({
      service: "data",
      request: "GetFeature",
      data: layer.id,
      key: apiKey,
      domain: "localhost",
      crs: "EPSG:4326",
      format: "json",
      size: String(PAGE_SIZE),
      page: String(page),
      geomFilter: `BOX(${tile.minX},${tile.minY},${tile.maxX},${tile.maxY})`,
    });
    try {
      const response = await fetch(`${API_URL}?${params}`);
      const text = await response.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(`non-JSON response HTTP ${response.status}`);
      }
      // VWorld uses NOT_FOUND for a valid bbox with no features (common in
      // sea tiles). It is an empty page, not a transient request failure.
      if (json?.response?.status === "NOT_FOUND") {
        counters.requests++;
        counters.retries += attempt - 1;
        return json;
      }
      if (!response.ok || json?.response?.status !== "OK") throw new Error(responseError(json, response.status));
      counters.requests++;
      counters.retries += attempt - 1;
      return json;
    } catch (error) {
      counters.requests++;
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt >= retries) break;
      await sleep(Math.min(15_000, 500 * (2 ** (attempt - 1))));
    }
  }
  throw new Error(`${layer.id} tile ${tile.minX},${tile.minY} page ${page}: ${lastError?.message ?? "request failed"}`);
}

function extractPage(json) {
  const response = json.response ?? {};
  const result = response.result?.featureCollection ?? response.result;
  const features = Array.isArray(result?.features) ? result.features : [];
  const total = asNumber(response.record?.total, 0);
  const pageTotal = asNumber(response.page?.total, total === 0 ? 0 : Math.ceil(total / PAGE_SIZE));
  return { features, total, pageTotal };
}

async function fetchTile(layer, tile, counters) {
  const features = [];
  let page = 1;
  let reportedTotal = null;
  let reportedPages = null;
  while (true) {
    const json = await getPage(layer, tile, page, counters);
    const result = extractPage(json);
    reportedTotal ??= result.total;
    reportedPages ??= result.pageTotal;
    features.push(...result.features);
    if (result.features.length === 0 || page >= result.pageTotal || features.length >= result.total) break;
    page++;
    await sleep(delayMs);
  }
  counters.pages += page;
  counters.tiles++;
  return { features, reportedTotal: reportedTotal ?? 0, reportedPages: reportedPages ?? 0 };
}

function featureKey(feature) {
  const props = feature?.properties ?? {};
  const id = String(props.hakgudo_id ?? "").trim();
  const objectid = String(props.objectid ?? "").trim();
  return id && objectid ? `${id}|${objectid}` : null;
}

function baseDates(features) {
  return [...new Set(features.map((feature) => String(feature?.properties?.base_dt ?? "").trim()).filter(Boolean))].sort();
}

async function fetchLayer(layer) {
  const started = Date.now();
  const counters = { requests: 0, pages: 0, retries: 0, tiles: 0 };
  const unique = new Map();
  let received = 0;
  let duplicates = 0;
  let invalid = 0;
  const allTiles = tiles();
  for (const tile of allTiles) {
    const result = await fetchTile(layer, tile, counters);
    received += result.features.length;
    for (const feature of result.features) {
      const key = featureKey(feature);
      if (!key) {
        invalid++;
        continue;
      }
      if (unique.has(key)) {
        duplicates++;
        continue;
      }
      unique.set(key, feature);
    }
  }
  const features = [...unique.values()];
  const dates = baseDates(features);
  const collection = { type: "FeatureCollection", features };
  const output = join(outDir, `${layer.id}.geojson`);
  const done = `${output}.done.json`;
  if ((existsSync(output) || existsSync(done)) && !has("force")) {
    throw new Error(`${output} already exists; pass --force to replace it`);
  }
  mkdirSync(dirname(output), { recursive: true });
  const part = `${output}.part`;
  try {
    writeFileSync(part, JSON.stringify(collection));
    renameSync(part, output);
    const bytes = statSync(output).size;
    const elapsedSeconds = Math.round((Date.now() - started) / 10) / 100;
    const doneJson = {
      layer: layer.id,
      output: basename(output),
      bbox: NATIONAL_BBOX,
      tileDeg,
      pageSize: PAGE_SIZE,
      tiles: counters.tiles,
      pages: counters.pages,
      requests: counters.requests,
      retries: counters.retries,
      received,
      unique: features.length,
      duplicates,
      invalid,
      count: features.length,
      base_dt: dates.length === 1 ? dates[0] : dates.at(-1) ?? null,
      base_dates: dates,
      bytes,
      elapsedSeconds,
      downloadedAt: new Date().toISOString(),
    };
    writeFileSync(done, JSON.stringify(doneJson, null, 2));
    return doneJson;
  } finally {
    rmSync(part, { force: true });
  }
}

console.log(`VWorld school zones: ${outDir}`);
console.log(`bbox ${NATIONAL_BBOX.minX},${NATIONAL_BBOX.minY}..${NATIONAL_BBOX.maxX},${NATIONAL_BBOX.maxY} · ${tiles().length} tiles · size ${PAGE_SIZE}`);
for (const layer of LAYERS) {
  const done = await fetchLayer(layer);
  console.log(`${layer.id}: ${done.count.toLocaleString("en-US")} unique / ${done.received.toLocaleString("en-US")} received · duplicate ${done.duplicates.toLocaleString("en-US")} · ${done.pages} pages · ${(done.bytes / 1024 ** 2).toFixed(1)} MB · ${done.elapsedSeconds}s · base_dt ${done.base_dt ?? "unknown"}`);
}
