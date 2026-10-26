import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const appDir = mkdtempSync(join(tmpdir(), "v2-admin-requests-cli-"));
const requestDir = mkdtempSync(join(tmpdir(), "v2-admin-requests-cli-files-"));
process.env.V2_APP_DB_PATH = join(appDir, "app.sqlite");
process.env.V2_REQUESTS_DIR = requestDir;

const A = await import("../../lib/v2/app-db.ts");
const R = await import("../../lib/v2/admin/requests.ts");
const { runTileRequestsCli } = await import("../../lib/v2/admin/requests-cli.ts");
const db = A.openV2AppDb(process.env.V2_APP_DB_PATH);
const one = R.createTileRequest(db, {
  tileCode: "D17",
  analysisId: "analysis-1",
  memo: "단면 그래프 아래 단차표 글자가 작다",
  pins: [{ x: 0.58, y: 0.42 }],
  context: { files: ["src/lib/v2/tile/d17/engine.ts", "view.ts", "Panel.tsx"] },
  png: null,
  userId: 1,
});
const two = R.createTileRequest(db, {
  tileCode: "A05",
  analysisId: null,
  memo: "표의 열 간격을 확인해 주세요",
  pins: [],
  context: {},
  png: null,
  userId: 1,
});

let result = runTileRequestsCli(["list"], db);
assert.equal(result.code, 0);
assert.match(result.out, /#1 \[대기\]/);
assert.match(result.out, /메모: 단면 그래프 아래 단차표 글자가 작다/);
assert.match(result.out, /그림:/);
assert.match(result.out, /핀: 1\(0\.58, 0\.42\)/);
const kst = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(one.createdAt));
assert.ok(result.out.includes(`· ${kst}`), `목록 시간은 한국 시간이어야 합니다: ${kst}`);

result = runTileRequestsCli(["done", String(one.id)], db);
assert.equal(result.code, 1);
assert.match(result.out, /커밋 번호가 필요합니다/);
result = runTileRequestsCli(["done", String(one.id), "--commit", "abc1234", "--note", "글자 키움"], db);
assert.equal(result.code, 0);
result = runTileRequestsCli(["list", "--status", "완료"], db);
assert.equal(result.code, 0);
assert.match(result.out, /#1 \[완료\]/);

result = runTileRequestsCli(["hold", String(two.id), "--note", "서버 계산 경로 필요"], db);
assert.equal(result.code, 0);
assert.match(runTileRequestsCli(["list", "--status", "보류"], db).out, /\[보류\]/);
result = runTileRequestsCli(["show", "99"], db);
assert.equal(result.code, 1);
assert.match(result.out, /없는 요청/);
result = runTileRequestsCli(["unknown"], db);
assert.equal(result.code, 1);
assert.match(result.out, /사용법/);

db.close();
console.log("✓ tile requests CLI");
