import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { buildEngineFixture, CENTER, PNU_DASAN_100 } = await import("./engine-fixture.mjs");
const { resolveSite, SITE_FAILURE_MESSAGE } = await import("../../lib/v2/engine/site.ts");
const M = await import("../../lib/v2/data/manifest.ts");

const dataDir = mkdtempSync(join(tmpdir(), "v2-eng-site-"));
await buildEngineFixture(dataDir, "v1");
const core = M.openDataFile(dataDir, M.readManifest(dataDir), "core");
try {
  const ok = resolveSite(core, { address: "경기도  남양주시 다산동 100" });
  assert.deepEqual({ ...ok, center: undefined }, { ok: true, center: undefined, pnu: PNU_DASAN_100, legalCode: "4136011800", jimok: "대", label: "경기도 남양주시 다산동 100" });
  assert.deepEqual(ok.center, CENTER);

  const cases = [
    ["다산동 100", "ambiguous", "시군구 없이 동만 → 더 적으라고 안내"],
    ["경기도 남양주시 다산동", "parse_failed", "번지 없음"],
    ["경기도 남양주시 별내동 1", "ambiguous", "동명이 둘"],
    ["경기도 남양주시 없는동 1", "not_found", "없는 동"],
    ["경기도 남양주시 다산동 999", "no_point", "필지 위치 없음"],
    ["경기도 남양주시 다산로 100", "not_found", "도로명 주소는 받지 않는다"],
    ["", "parse_failed", "빈 입력"],
  ];
  for (const [address, reason, why] of cases) {
    const r = resolveSite(core, { address });
    assert.deepEqual([r.ok, r.reason], [false, reason], `${address}: ${why}`);
    assert.ok(SITE_FAILURE_MESSAGE[reason].length > 0);
  }

  // 좌표 직접 입력: 주소 없이도 통과, 지번 정보는 없음
  const c = resolveSite(core, { center: [127.15, 37.62] });
  assert.equal(c.ok, true);
  assert.deepEqual([c.pnu, c.jimok], [null, null]);
  assert.match(c.label, /^좌표 127\.15000, 37\.62000$/);
  assert.equal(resolveSite(core, { address: "내 검수 지점", center: [127.15, 37.62] }).label, "내 검수 지점");
} finally {
  core.close();
}
console.log("✓ v2 engine site");
