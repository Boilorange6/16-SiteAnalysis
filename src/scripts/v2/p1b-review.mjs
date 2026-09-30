/**
 * 검수 8곳을 게시된 실제 데이터로 분석해 타일별 핵심 지표·상태·소요 시간을 표로 낸다.
 *   V2_DATA_DIR=<데이터 디렉터리> npm run v2:review -- [--out docs/superpowers/a0/파일.md] [--radius 1000]
 * 앱 DB는 임시 파일이라 캐시가 겹치지 않는다. 데이터 디렉터리에는 쓰지 않는다.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { REVIEW_SITES } = await import("../../lib/v2/a0/review-sites.ts");
const { openV2AppDb } = await import("../../lib/v2/app-db.ts");
const { readManifest } = await import("../../lib/v2/data/manifest.ts");
const { runAnalysis } = await import("../../lib/v2/engine/run.ts");
const { v2DataDir } = await import("../../lib/v2/paths.ts");

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const radiusM = Number(opt("radius", 1000));
const out = opt("out", null);
const dataDir = v2DataDir();
const manifest = readManifest(dataDir);
if (!manifest) throw new Error(`no published manifest in ${dataDir}`);

const appDb = openV2AppDb(join(mkdtempSync(join(tmpdir(), "v2-review-")), "app.sqlite"));
const KEY = {
  A01: ["nearest_bus_m", "bus_stops"],
  A03: ["basic_groups", "stores"],
  A04: ["parks", "nearest_park_point_m"],
  A05: ["apartment_complexes", "households", "officetels"],
  A06: ["applyhome_units", "move_in_units"],
};
const show = (m) => (m.value === null ? `${m.label.slice(0, 0)}미확인` : `${m.value}`);

const lines = [`# P1b-1 검수 8곳 — 반경 ${radiusM}m`, "", `데이터 버전 ${manifest.version} · 분석일 ${new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" })}`, ""];
const rows = [];
for (const site of REVIEW_SITES) {
  const t0 = performance.now();
  const r = runAnalysis(appDb, dataDir, { address: site.name, center: site.center, radiusM });
  const ms = Math.round(performance.now() - t0);
  if (!r.ok) throw new Error(`${site.name}: ${r.reason}`);
  const failed = r.results.filter((t) => t.status === "failed");
  const cells = Object.entries(KEY).map(([code, ids]) => {
    const t = r.results.find((x) => x.tileCode === code);
    const parts = ids.map((id) => `${id}=${show(t.metrics.find((m) => m.id === id))}`);
    return `${t.status}: ${parts.join(", ")}`;
  });
  rows.push({ site, ms, cells, failed: failed.length, results: r.results });
  console.log(`${site.name.padEnd(10)} ${String(ms).padStart(6)}ms  failed=${failed.length}  ${cells.join(" | ")}`);
}
lines.push("| 지점 | 소요(ms) | A01 | A03 | A04 | A05 | A06 |", "|---|---:|---|---|---|---|---|");
for (const r of rows) lines.push(`| ${r.site.name} | ${r.ms} | ${r.cells.join(" | ")} |`);
lines.push("", "지표는 `id=값` (미확인 = 값 없음). 실패 타일 수: " + rows.map((r) => `${r.site.name} ${r.failed}`).join(", "));
if (out) writeFileSync(out, lines.join("\n") + "\n");
appDb.close();
