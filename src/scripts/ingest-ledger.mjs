/**
 * 건축물대장 공동주택 적재 (월 1회 워밍).
 *
 *   npx tsx src/scripts/ingest-ledger.mjs 41360:11200 41310:10100   # 법정동 직접 지정
 *   npx tsx src/scripts/ingest-ledger.mjs --around 37.6241,127.1497,3000
 *   npx tsx src/scripts/ingest-ledger.mjs --from-planned            # 적재된 분양 단지 주변을 데운다
 *
 * 검색 경로는 read-through라 이 스크립트를 돌리지 않아도 동작한다.
 * 여기서는 자주 조회되는 지역을 미리 채워 첫 조회의 지연을 없앤다.
 *
 * 종료 코드: 0 = 모두 성공, 1 = 하나 이상 거부/실패
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

for (const file of [".env.local", ".env"]) {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) continue;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  }
}

const { getDb } = await import("../lib/server/database.ts");
const { warmLedgerDong, resolveDongsAround } = await import("../lib/server/residential-search.ts");
const { ledgerCoverage } = await import("../lib/server/ledger-store.ts");
const { PLANNED_HOUSING_SPEC, queryDatasetInBbox } = await import("../lib/server/dataset-store.ts");

const apiKey = process.env.DATA_GO_KR_API_KEY;
const ncpId = process.env.NCP_CLIENT_ID;
const ncpSecret = process.env.NCP_CLIENT_SECRET;
if (!apiKey || !ncpId || !ncpSecret) {
  console.error("환경변수 누락: DATA_GO_KR_API_KEY / NCP_CLIENT_ID / NCP_CLIENT_SECRET");
  process.exit(1);
}

const db = getDb();
const args = process.argv.slice(2);
let dongs = [];

if (args[0] === "--around") {
  const [lat, lng, radius] = String(args[1] ?? "").split(",").map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    console.error("사용법: --around <lat>,<lng>,<radiusM>");
    process.exit(1);
  }
  dongs = await resolveDongsAround(lat, lng, radius || 3000, ncpId, ncpSecret);
} else if (args[0] === "--from-planned") {
  // 적재된 분양 단지 좌표 주변 = 실제로 조회될 가능성이 높은 지역
  const rows = queryDatasetInBbox(db, PLANNED_HOUSING_SPEC, {
    minLat: -90, maxLat: 90, minLng: -180, maxLng: 180,
  });
  const seen = new Set();
  for (const row of rows) {
    const found = await resolveDongsAround(Number(row.lat), Number(row.lng), 1000, ncpId, ncpSecret);
    for (const d of found) {
      const key = `${d.sigunguCd}:${d.bjdongCd}`;
      if (!seen.has(key)) { seen.add(key); dongs.push(d); }
    }
  }
} else if (args.length > 0) {
  dongs = args.map((a) => {
    const [sigunguCd, bjdongCd] = a.split(":");
    return { sigunguCd, bjdongCd };
  });
} else {
  console.error("대상이 없습니다. 법정동 코드, --around, 또는 --from-planned 중 하나를 주세요.");
  process.exit(1);
}

console.log(`[ledger-ingest] 대상 법정동 ${dongs.length}개`);

let ok = 0;
let rejected = 0;
for (const dong of dongs) {
  const result = await warmLedgerDong(db, dong, { apiKey, ncpId, ncpSecret, now: Date.now(), force: true });
  if (result.status === "ok") {
    ok += 1;
    console.log(`  ${dong.sigunguCd}-${dong.bjdongCd}: ${result.rowCount}건`);
  } else {
    rejected += 1;
    console.warn(`  ${dong.sigunguCd}-${dong.bjdongCd}: ${result.message}`);
  }
}

const coverage = ledgerCoverage(db);
console.log(
  `[ledger-ingest] 성공 ${ok} / 거부 ${rejected} — 누적 법정동 ${coverage.dongCount}개, 건물 ${coverage.buildingCount}건`,
);
process.exit(rejected > 0 ? 1 : 0);
