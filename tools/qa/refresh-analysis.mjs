// 분석 하나를 refresh 경로로 다시 계산하고, 끝날 때까지 상태를 본 뒤 결과 JSON을 저장한다. 공유 분석의 결과를 바꾸므로 다른 테스트가 도는 동안은 돌리지 않는다.
// 사용(프로젝트 루트에서): node tools/qa/refresh-analysis.mjs <analysisId> <out.json>
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { BASE as base, qaContext } from "./auth.mjs";
const [id, out] = process.argv.slice(2);
if (!id || !out || id.startsWith("-")) {
  console.log("사용: node tools/qa/refresh-analysis.mjs <analysisId> <out.json>");
  process.exit(id === "--help" || id === "-h" ? 0 : 1);
}
const browser = await chromium.launch();
const ctx = await qaContext(browser);
const r = await ctx.request.post(`${base}/api/v2/analyses/${id}/refresh`, { timeout: 120000 }); // dev 첫 요청은 컴파일로 30 s를 넘는다
console.log("refresh", r.status(), (await r.text()).slice(0, 300));
if (!r.ok()) { await browser.close(); process.exit(1); }
const t0 = Date.now();
let last = "";
for (;;) {
  const g = await ctx.request.get(`${base}/api/v2/analyses/${id}`, { timeout: 120000 });
  const j = await g.json();
  const rf = j.refresh ?? {};
  const summary = JSON.stringify({ status: j.status, state: rf.state, active: rf.active, activeCodes: rf.activeCodes, engineChanged: rf.engineChanged, done: (j.results ?? []).length });
  if (summary !== last) { console.log(Math.round((Date.now() - t0) / 1000) + "s", summary.slice(0, 300)); last = summary; }
  if (!rf.active && !/queued|running|pending/i.test(String(j.status)) && Date.now() - t0 > 15000) {
    writeFileSync(out, JSON.stringify(j));
    break;
  }
  if (Date.now() - t0 > 40 * 60000) { console.log("timeout"); break; }
  await new Promise((res) => setTimeout(res, 15000));
}
await browser.close();
