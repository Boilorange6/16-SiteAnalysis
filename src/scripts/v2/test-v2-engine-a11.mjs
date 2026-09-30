import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { insertRelease } = await import("../../lib/v2/ingest/build.ts");
const { buildPopGrid, AGE_ITEMS } = await import("../../lib/v2/ingest/sources/sgis-grid.ts");
const M = await import("../../lib/v2/data/manifest.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { a11, circleRectOverlap } = await import("../../lib/v2/engine/tiles/a11.ts");
const { toLngLat } = await import("../../lib/v2/crs.ts");
const { toTileView } = await import("../../lib/v2/ui/tile-view.ts");

// ── 넓이 공식: 알려진 값과 수치 적분 ──
const close = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} vs ${b}`);
close(circleRectOverlap(0, 0, 1, -5, -5, 5, 5), Math.PI); // 원이 사각형 안
close(circleRectOverlap(0, 0, 1, 0, -5, 5, 5), Math.PI / 2); // 반쪽
close(circleRectOverlap(0, 0, 1, 0, 0, 5, 5), Math.PI / 4); // 1/4
close(circleRectOverlap(0, 0, 1, 2, 2, 3, 3), 0); // 겹침 없음
close(circleRectOverlap(0, 0, 10, -1, -2, 3, 4), 4 * 6); // 사각형이 원 안
close(circleRectOverlap(500, 500, 500, 0, 0, 1000, 1000), (Math.PI * 500 * 500)); // 내접원
{
  const [cx, cy, r, x0, y0, x1, y1] = [30, -20, 700, 300, -200, 1300, 600];
  let area = 0;
  const step = 0.5;
  for (let x = x0 + step / 2; x < x1; x += step) {
    const dx = x - cx;
    if (Math.abs(dx) >= r) continue;
    const h = Math.sqrt(r * r - dx * dx);
    area += Math.max(0, Math.min(y1, cy + h) - Math.max(y0, cy - h)) * step;
  }
  close(circleRectOverlap(cx, cy, r, x0, y0, x1, y1), area, 1e-5);
}

// ── 데이터 디렉터리: reference 하나 (격자 셀 4개) ──
const cellRows = (g, o) => Object.entries(o).map(([item, value]) => ({ gridId: g, item, value }));
const rows = [
  // 5352: 가장 조밀. 5세 구간 21개가 모두 있고 50명씩(합 1050)
  ...cellRows("다사5352", { to_in_001: 1200, to_in_007: 600, to_in_008: 600, to_ga_001: 500, ga_sd_005: 150 }),
  ...AGE_ITEMS.map((item) => ({ gridId: "다사5352", item, value: 50 })),
  // 5353: 인구·가구 비공개(연령 구간만 일부)
  ...cellRows("다사5353", { in_age_014: 7 }),
  // 5452: 인구 0(값), 가구 행 없음
  ...cellRows("다사5452", { to_in_001: 0 }),
  // 5453: 인구 비공개, 가구 20
  ...cellRows("다사5453", { to_ga_001: 20, ga_sd_005: 5 }),
];
const dir = mkdtempSync(join(tmpdir(), "v2-a11-"));
mkdirSync(join(dir, "versions", "v1"), { recursive: true });
const path = join(dir, "versions", "v1", "reference.sqlite");
{
  const db = new Database(path);
  initDataFileSchema(db, "reference");
  const rel = insertRelease(db, { sourceId: "sgis_grid", provider: "SGIS", sourceUrl: "https://x.invalid", sourceAsOf: "2024", fetchedAt: "2026-09-30T00:00:00Z", checksum: "x", licenseCode: "UNRESTRICTED" });
  const s = await buildPopGrid(db, { rows, releaseId: rel, dataYear: "2024", locate: () => "1111000000" });
  db.prepare(`INSERT INTO ingest_run (run_id, source_id, started_at, finished_at, status, received_count, accepted_count, rejected_count, release_id, snapshot_json)
    VALUES ('sgis:1', 'sgis_grid', 'a', 'b', 'succeeded', ?, ?, 0, ?, ?)`).run(s.received, s.accepted, rel, JSON.stringify({ ...s.snapshot(), unlocated: 0 }));
  db.close();
}
const manifest = { version: "v1", createdAt: "2026-09-30T00:00:00Z", files: { reference: { path: "versions/v1/reference.sqlite", sha256: await M.sha256File(path), kind: "reference", schemaVersion: 2 } } };
assert.ok((await M.publishManifest(dir, manifest, () => ({ ok: true, failures: [] }))).published);
const published = M.readManifest(dir);

const ctxAt = (x, y, radiusM) => new EngineContext(dir, published, "an-1", { address: "테스트", center: toLngLat([x, y]), radiusM, analysisDate: "2026-09-30" });
const metric = (t, id) => t.metrics.find((m) => m.id === id);
const val = (t, id) => metric(t, id)?.value;

// ── 1. 셀 중심의 r=500 원 = 격자에 내접: 겹침 π/4, 이웃 셀은 한 점에서만 닿아 제외 ──
{
  const ctx = ctxAt(953500, 1952500, 500);
  const t = a11(ctx);
  assert.equal(val(t, "cells_in_circle"), 1);
  assert.equal(metric(t, "pop_est").status, "estimated");
  assert.equal(val(t, "pop_est"), Math.round(1200 * Math.PI / 4)); // 942
  assert.equal(val(t, "hh_est"), Math.round(500 * Math.PI / 4)); // 393
  close(val(t, "density_per_km2"), Math.round(1200 * Math.PI / 4 / (Math.PI * 0.25)), 1e-3); // 1200/km²
  assert.equal(val(t, "avg_hh_size"), 2.4);
  assert.equal(val(t, "single_hh_pct"), 30);
  assert.equal(val(t, "elder_pct"), 38.1); // 65세+ 8구간×50 / 세 묶음 합 1050
  assert.equal(val(t, "youth_pct"), 14.3);
  assert.equal(val(t, "working_pct"), 47.6);
  assert.ok(!t.limitations.some((l) => l.note.includes("행이 없는 5세 구간")), "빠진 구간이 없으면 안내하지 않는다");
  assert.equal(t.judgment.level, null, "등급 없음");
  assert.equal(t.judgment.criteria, null);
  assert.match(t.judgment.sentence, /^2024년 격자 기준 반경 500m 안 추정 인구 약 940명·약 390가구, 65세 이상 38\.1% → .+ → .+/);
  assert.equal(t.status, "complete");
  assert.ok(t.limitations.some((l) => l.kind === "estimated" && l.note.includes("±7")));
  assert.ok(!t.limitations.some((l) => l.kind === "suppressed"));
  assert.equal(t.presentation.features.length, 1);
  assert.equal(t.presentation.features[0].weight, 1200);
  assert.match(t.presentation.features[0].layer, /^pop_grid_q\d$/);
  assert.deepEqual(t.provenance.sources.map((s) => s.sourceId), ["sgis_grid"]);
  assert.doesNotThrow(() => toTileView(t));
  ctx.close();
}

// ── 2. 네 셀의 만나는 모서리 r=500: 셀마다 1/4 원(π/16 = 0.19635) ──
{
  const ctx = ctxAt(954000, 1953000, 500);
  const t = a11(ctx);
  const q = Math.PI / 16;
  assert.equal(val(t, "cells_in_circle"), 4);
  assert.equal(val(t, "cells_suppressed"), 2, "5353·5453의 인구는 비공개");
  assert.equal(val(t, "pop_est"), Math.round(1200 * q + 0 * q), "비공개는 0으로 더하지 않고 제외, 0명(값)은 더한다");
  assert.equal(val(t, "hh_est"), Math.round((500 + 20) * q), "가구 비공개(5353·5452)는 제외");
  assert.equal(t.status, "partial");
  const sup = t.limitations.filter((l) => l.kind === "suppressed");
  assert.ok(sup.some((l) => /4개 중 2개는 인구가 비공개.*원 면적의 50%/.test(l.note)), sup.map((l) => l.note).join("|"));
  assert.ok(sup.some((l) => l.note.includes("가구 수가 비공개인 격자 2개")));
  assert.ok(t.limitations.some((l) => l.kind === "estimated" && l.note.includes("행이 없는 5세 구간을 0으로")), "5452는 구간 행이 전혀 없다");
  assert.equal(val(t, "elder_pct"), 38.1, "5452(인구 0)는 분모에 0을 더할 뿐");
  const layers = t.presentation.features.map((f) => f.layer).sort();
  assert.deepEqual(layers.filter((l) => l === "pop_grid_na").length, 2);
  assert.equal(t.presentation.features.find((f) => f.layer === "pop_grid_na").weight, null);
  // 5분위: 공개 셀 2개(밀도 0, 1200) → q1, q3 (등간격 순위)
  assert.deepEqual(layers.filter((l) => l !== "pop_grid_na"), ["pop_grid_q1", "pop_grid_q3"]);
  ctx.close();
}

// ── 3. 인구 비공개 셀만 걸친 원: 값은 null/suppressed, 0이 아니다 ──
{
  const ctx = ctxAt(953500, 1953500, 100);
  const t = a11(ctx);
  assert.equal(metric(t, "pop_est").status, "suppressed");
  assert.equal(metric(t, "pop_est").value, null);
  assert.equal(metric(t, "density_per_km2").status, "suppressed");
  assert.deepEqual(t.judgment.basisMetricIds, []);
  assert.match(t.judgment.sentence, /모두 비공개.*0명이 아님/);
  assert.equal(t.status, "partial");
  ctx.close();
}

// ── 4. 격자가 없는 곳: 0명이 아니라 missing ──
{
  const ctx = ctxAt(700500, 1300500, 500);
  const t = a11(ctx);
  assert.equal(t.metrics.length, 2);
  assert.ok(t.metrics.every((m) => m.status === "missing" && m.value === null));
  assert.match(t.judgment.sentence, /격자 자료 셀 없음.*0으로 볼 수 없음/);
  assert.equal(t.status, "partial");
  ctx.close();
}

// ── 5. 원천 미적재 버전 ──
{
  const emptyDir = mkdtempSync(join(tmpdir(), "v2-a11-none-"));
  mkdirSync(join(emptyDir, "versions", "v1"), { recursive: true });
  const p = join(emptyDir, "versions", "v1", "reference.sqlite");
  const db = new Database(p);
  initDataFileSchema(db, "reference");
  db.close();
  const mf = { version: "v1", createdAt: "2026-09-30T00:00:00Z", files: { reference: { path: "versions/v1/reference.sqlite", sha256: await M.sha256File(p), kind: "reference", schemaVersion: 2 } } };
  await M.publishManifest(emptyDir, mf, () => ({ ok: true, failures: [] }));
  const ctx = new EngineContext(emptyDir, M.readManifest(emptyDir), "an-1", { address: "t", center: [127, 37.5], radiusM: 500, analysisDate: "2026-09-30" });
  const t = a11(ctx);
  assert.deepEqual([t.status, t.metrics.length], ["no_data", 0]);
  ctx.close();
}

console.log("a11 ok");
