// 저장된 분석의 조건으로 타일 엔진을 직접 돌려(DB 쓰기 없음) 그래프 합계·한 줄 요약·countedCapped를 본다.
// 사용(프로젝트 루트에서): npx tsx tools/qa/probe-charts.mts <analysisId> <code,code,...>
// 환경변수: V2_DATA_DIR(기본 C:/SiteAnalysisData/v2/data), V2_APP_DB_PATH(기본 .cache/v2/app.sqlite)
import Database from "better-sqlite3";
import { readManifest } from "../../src/lib/v2/data/manifest.ts";
import { EngineContext } from "../../src/lib/v2/engine/context.ts";
import { TILES } from "../../src/lib/v2/engine/run.ts";
import { restoreSiteFromParameters } from "../../src/lib/v2/engine/site.ts";
import { toTileView, viewWithLayer } from "../../src/lib/v2/ui/tile-view.ts";
import { analysisCharts, analysisStatLine } from "../../src/lib/v2/report/analysis-charts.ts";
const [id, codes] = process.argv.slice(2);
if (!id || !codes) { console.log("사용: npx tsx tools/qa/probe-charts.mts <analysisId> <code,code,...>"); process.exit(1); }
const db = new Database(process.env.V2_APP_DB_PATH ?? ".cache/v2/app.sqlite", { readonly: true });
const r: any = db.prepare("SELECT * FROM analysis_run WHERE analysis_id = ?").get(id);
if (!r) { console.log(`분석 ${id}을(를) 찾지 못함`); process.exit(1); }
const p = JSON.parse(r.parameters_json);
const dataDir = process.env.V2_DATA_DIR ?? "C:/SiteAnalysisData/v2/data";
const ctx = new EngineContext(dataDir, readManifest(dataDir)!, `probe-${id}`, { address: r.address, center: [r.center_lng, r.center_lat], radiusM: r.radius_m, analysisDate: r.analysis_date, pnu: p.pnu ?? null, site: restoreSiteFromParameters(p) });
for (const code of codes.split(",")) {
  const t0 = Date.now();
  const t: any = TILES.find(([k]) => k === code)![1](ctx);
  const v0 = toTileView(t); const v = v0.defaultLayer ? viewWithLayer(v0, v0.defaultLayer) : v0;
  const c = v.map ? analysisCharts(v.map) : null;
  console.log(code, `capped=${!!t.presentation?.countedCapped}`, `payload=${(t.presentation?.polygons?.length ?? 0) + (t.presentation?.features?.length ?? 0)}`, c ? analysisStatLine(c) : "charts=null", "|", (v.sentence ?? "").slice(0, 50), `(${Date.now() - t0}ms)`);
}
ctx.close();
