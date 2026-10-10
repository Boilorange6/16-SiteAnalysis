import assert from "node:assert/strict";
import { parseSourceIds, sourceApiBody, sourceRowsForIds } from "../../lib/v2/ui/source-api.ts";

const row = (sourceId, releaseId) => ({
  sourceId,
  releaseId,
  provider: `provider-${sourceId}`,
  sourceUrl: `https://example.test/${sourceId}`,
  sourceAsOf: "2026-09-09",
  publishedAt: null,
  fetchedAt: "2026-10-07T00:00:00Z",
  licenseCode: "TEST",
  rights: {},
});
const rows = [row("building", "building@2026-09-09"), row("building", "building@2026-10-01"), row("building_juso", "building_juso@2026-09")];

assert.deepEqual(parseSourceIds([" building,building_juso ", "building:building@2026-09-09", "building", "bad/id"]), [
  "building",
  "building_juso",
  "building:building@2026-09-09",
]);

assert.deepEqual(sourceRowsForIds(rows, ["building:building@2026-10-01", "missing", "building_juso"]), [rows[1], rows[2]]);

assert.deepEqual(sourceApiBody({ manifestVersion: "v1", manifestCreatedAt: "2026-10-07T00:00:00Z", rows }, ["building"]), {
  manifestVersion: "v1",
  manifestCreatedAt: "2026-10-07T00:00:00Z",
  sources: rows.slice(0, 2),
});

console.log("✓ sources API pure selection");
