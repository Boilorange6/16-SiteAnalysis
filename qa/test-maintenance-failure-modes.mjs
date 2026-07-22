import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import ky from "ky";

const temporaryDirectory = mkdtempSync(join(tmpdir(), "maintenance-failures-"));
process.env.DB_PATH = join(temporaryDirectory, "cache.db");

const { fetchNationalMaintenanceAttributes } = await import("../src/lib/server/maintenance/national-provider.ts");
const { loadMaintenanceBoundaryArtifact } = await import("../src/lib/server/maintenance/boundary-store.ts");
const { getCachedSource, POI_CACHE_TTL_MS, resolveSource, setCachedSource } = await import("../src/lib/server/poi-cache.ts");
const { getDb } = await import("../src/lib/server/database.ts");

// Given no national key; When attributes are requested; Then the source fails instead of returning samples.
await assert.rejects(
  () => fetchNationalMaintenanceAttributes({ serviceKey: " " }),
  /DATA_GO_KR_API_KEY is not configured/,
);

// Given missing and malformed boundary artifacts; When loaded; Then each fails without terminating the process.
assert.throws(
  () => loadMaintenanceBoundaryArtifact(join(temporaryDirectory, "missing.geojson")),
  (error) => error?.code === "UNREADABLE",
);
const malformedPath = join(temporaryDirectory, "malformed.geojson");
writeFileSync(malformedPath, "{not-json", "utf8");
assert.throws(
  () => loadMaintenanceBoundaryArtifact(malformedPath),
  (error) => error?.code === "MALFORMED",
);

// Given an expired attribute cache and a simulated 403; When resolved; Then the old value and timestamp survive.
const cacheKey = { source: "maintenance_attributes", lat: 37.5665, lng: 126.978, radiusM: 3_000 };
setCachedSource({ key: cacheKey, value: { integrated: [{ name: "cached" }], standard: [] } });
const expiredFetchedAt = Date.now() - POI_CACHE_TTL_MS - 60_000;
getDb().prepare("UPDATE poi_source_cache SET fetched_at = ? WHERE source = ?").run(expiredFetchedAt, cacheKey.source);
const response = await resolveSource({
  ...cacheKey,
  refresh: false,
  fetcher: () => fetchNationalMaintenanceAttributes({
    serviceKey: "synthetic-expired-key",
    pageSize: 100,
    httpClient: ky.create({
      retry: 0,
      fetch: async () => new Response(
        JSON.stringify({ code: "30", msg: "SERVICE KEY IS NOT REGISTERED ERROR" }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      ),
    }),
  }),
});
assert.equal(response.status, "cached");
assert.equal(response.fetchedAt, expiredFetchedAt);
assert.equal(response.value.integrated[0].name, "cached");
assert.equal(getCachedSource(cacheKey), null);

console.log("maintenance failure-mode QA tests passed");
try {
  rmSync(temporaryDirectory, { recursive: true, force: true });
} catch {
  // Windows may retain the SQLite WAL handle until process exit; the OS owns this temporary path.
}
