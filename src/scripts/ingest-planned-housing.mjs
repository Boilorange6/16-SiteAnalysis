/**
 * 청약홈 분양 공고 전국 적재 (일 1회).
 *
 *   npx tsx src/scripts/ingest-planned-housing.mjs
 *   npx tsx src/scripts/ingest-planned-housing.mjs 경기 서울   # 특정 시도만
 *
 * 실패해도 기존 적재분은 건드리지 않는다 (dataset-store의 원자적 교체 + 급감 거부).
 * 종료 코드: 0 = 적재 성공, 1 = 거부되거나 실패 (배치 스케줄러가 감지할 수 있게)
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// Next 밖에서 도는 스크립트라 .env.local을 직접 읽는다
for (const file of [".env.local", ".env"]) {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) continue;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  }
}

const { getDb } = await import("../lib/server/database.ts");
const { APPLYHOME_AREA_NAMES, ingestPlannedHousing } = await import("../lib/server/planned-housing-ingest.ts");
const { fetchApplyhomeComplexesForArea } = await import("../lib/server/planned-residential-search.ts");
const { readGeocode, writeGeocode, isRecentMiss, recordGeocodeMiss } = await import("../lib/server/geocode-cache.ts");
const { buildGeocodeCandidates } = await import("../lib/server/planned-residential-filter.ts");

const apiKey =
  process.env.APPLYHOME_API_KEY || process.env.DATA_GO_KR_ODCLOUD_API_KEY || process.env.DATA_GO_KR_API_KEY;
const ncpId = process.env.NCP_CLIENT_ID;
const ncpSecret = process.env.NCP_CLIENT_SECRET;

if (!apiKey || !ncpId || !ncpSecret) {
  console.error("환경변수 누락: DATA_GO_KR_API_KEY / NCP_CLIENT_ID / NCP_CLIENT_SECRET");
  process.exit(1);
}

const serviceKey = apiKey.includes("%") ? decodeURIComponent(apiKey) : apiKey;
const areaNames = process.argv.slice(2).length > 0 ? process.argv.slice(2) : [...APPLYHOME_AREA_NAMES];
const db = getDb();

async function geocodeOnce(query) {
  const res = await fetch(
    `https://maps.apigw.ntruss.com/map-geocode/v2/geocode?query=${encodeURIComponent(query)}`,
    { headers: { "X-NCP-APIGW-API-KEY-ID": ncpId, "X-NCP-APIGW-API-KEY": ncpSecret } },
  );
  if (!res.ok) return null;
  const json = await res.json();
  const first = json.addresses?.[0];
  if (!first) return null;
  const lat = Number(first.y);
  const lng = Number(first.x);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

/** 앱 런타임과 같은 캐시·후보 규칙을 쓴다 (배치가 캐시를 채우면 앱이 그대로 재사용) */
async function geocode(address) {
  const cached = readGeocode(db, address);
  if (cached) return cached;
  if (isRecentMiss(db, address, Date.now())) return null;

  for (const candidate of buildGeocodeCandidates(address)) {
    try {
      const coord = await geocodeOnce(candidate);
      if (coord) {
        writeGeocode(db, address, coord.lat, coord.lng, Date.now());
        return coord;
      }
    } catch {
      // 개별 후보 실패는 다음 후보로
    }
  }
  recordGeocodeMiss(db, address, Date.now());
  return null;
}

const startedAt = Date.now();
const result = await ingestPlannedHousing({
  db,
  now: Date.now(),
  areaNames,
  fetchComplexes: (areaName) => fetchApplyhomeComplexesForArea(areaName, serviceKey),
  geocode,
  log: (message) => console.log(message),
});

const elapsed = Math.round((Date.now() - startedAt) / 1000);
console.log(`[planned-housing] status=${result.status} rows=${result.rowCount} (${elapsed}s)`);
process.exit(result.status === "ok" ? 0 : 1);
