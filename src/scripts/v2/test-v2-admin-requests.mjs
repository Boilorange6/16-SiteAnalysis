import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NextRequest } from "next/server";

const appDir = mkdtempSync(join(tmpdir(), "v2-admin-requests-app-"));
const legacyDir = mkdtempSync(join(tmpdir(), "v2-admin-requests-legacy-"));
const requestDir = mkdtempSync(join(tmpdir(), "v2-admin-requests-files-"));
process.env.V2_APP_DB_PATH = join(appDir, "app.sqlite");
process.env.DB_PATH = join(legacyDir, "legacy.sqlite");
process.env.V2_REQUESTS_DIR = requestDir;
process.env.JWT_SECRET = "a".repeat(64);

const A = await import("../../lib/v2/app-db.ts");
const R = await import("../../lib/v2/admin/requests.ts");
const U = await import("../../lib/server/user-store.ts");
const J = await import("../../lib/server/jwt.ts");
const requestsRoute = await import("../../app/api/v2/admin/requests/route.ts");
const requestIdRoute = await import("../../app/api/v2/admin/requests/[id]/route.ts");
const imageRoute = await import("../../app/api/v2/admin/requests/[id]/image/route.ts");

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const db = A.openV2AppDb(process.env.V2_APP_DB_PATH);
const admin = U.createUser("requests-admin", "password", "admin");
const user = U.createUser("requests-user", "password");

assert.deepEqual(R.validateRequestInput({ tileCode: "NOPE", memo: "메모", pins: [] }), { ok: false, error: "없는 타일 코드입니다" });
assert.deepEqual(R.validateRequestInput({ tileCode: "D17", memo: "가".repeat(2001), pins: [] }), { ok: false, error: "메모는 2,000자까지 쓸 수 있습니다" });
assert.deepEqual(R.validateRequestInput({ tileCode: "D17", memo: "", pins: [] }), { ok: false, error: "메모나 핀 중 하나는 있어야 합니다" });
assert.deepEqual(R.validateRequestInput({ tileCode: "D17", memo: "", pins: Array.from({ length: 10 }, () => ({ x: 0.5, y: 0.5 })) }), { ok: false, error: "핀은 9개까지 찍을 수 있습니다" });
assert.deepEqual(R.validateRequestInput({ tileCode: "D17", memo: "메모", pins: [{ x: 1.1, y: 0.5 }] }), { ok: false, error: "핀 위치가 그림 밖입니다" });
assert.equal(R.isPng(Uint8Array.from([1, 2, 3])), false);
assert.equal(R.isPng(png), true);

const first = R.createTileRequest(db, {
  tileCode: "D17",
  analysisId: "analysis-1",
  memo: "단면 그래프 아래 단차표 글자가 작다",
  pins: [{ x: 0.58, y: 0.42 }],
  context: { forms: ["vector", "section"] },
  png,
  userId: admin.id,
});
assert.equal(first.status, "대기");
assert.ok(first.imagePath && existsSync(first.imagePath));
assert.equal(R.getTileRequest(db, first.id).imagePath, first.imagePath);

const withoutImage = R.createTileRequest(db, {
  tileCode: "D17",
  analysisId: null,
  memo: "그림 없이 저장",
  pins: [],
  context: {},
  png: null,
  userId: admin.id,
});
assert.equal(withoutImage.imagePath, null);
assert.equal(R.listTileRequests(db)[0].id, withoutImage.id);

assert.deepEqual(R.transitionTileRequest(db, first.id, "완료"), { ok: false, error: "완료로 바꾸려면 커밋 번호가 필요합니다" });
const done = R.transitionTileRequest(db, first.id, "완료", { commit: "ac61390", note: "처리 메모" });
assert.equal(done.ok, true);
assert.equal(R.transitionTileRequest(db, first.id, "완료").ok, false);
const reopened = R.transitionTileRequest(db, first.id, "대기", { note: "1번이 아직 겹침" });
assert.equal(reopened.ok, true);
assert.match(R.getTileRequest(db, first.id).reopenNote ?? "", /1번이 아직 겹침/);
assert.equal(R.getTileRequest(db, first.id).resolvedCommit, null);
assert.equal(R.transitionTileRequest(db, first.id, "대기").ok, false);

const auth = async (token, path, init = {}) => new NextRequest(`http://localhost${path}`, {
  ...init,
  headers: { ...(init.headers ?? {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
});
const adminToken = await J.signAccessToken(admin.id);
const userToken = await J.signAccessToken(user.id);
assert.equal((await requestsRoute.GET(await auth(null, "/api/v2/admin/requests"))).status, 401);
assert.equal((await requestsRoute.GET(await auth(userToken, "/api/v2/admin/requests"))).status, 403);
assert.equal((await requestsRoute.GET(await auth(adminToken, "/api/v2/admin/requests?tile=D17"))).status, 200);

const form = new FormData();
form.set("tileCode", "D17");
form.set("analysisId", "analysis-2");
form.set("memo", "요청 API 메모");
form.set("pins", JSON.stringify([{ x: 0.25, y: 0.75 }]));
form.set("context", JSON.stringify({ cacheVersion: "test" }));
form.set("image", new Blob([png], { type: "image/png" }), "tile.png");
const createdResponse = await requestsRoute.POST(await auth(adminToken, "/api/v2/admin/requests", { method: "POST", body: form }));
assert.equal(createdResponse.status, 201);
const createdBody = await createdResponse.json();
assert.equal(createdBody.request.status, "대기");

const badImageForm = new FormData();
badImageForm.set("tileCode", "D17");
badImageForm.set("analysisId", "analysis-2");
badImageForm.set("memo", "잘못된 그림");
badImageForm.set("pins", "[]");
badImageForm.set("context", "{}");
badImageForm.set("image", new Blob([Uint8Array.from([1, 2, 3])], { type: "image/png" }), "bad.png");
const badImageResponse = await requestsRoute.POST(await auth(adminToken, "/api/v2/admin/requests", { method: "POST", body: badImageForm }));
assert.equal(badImageResponse.status, 400);
assert.equal((await badImageResponse.json()).error, "PNG 그림만 올릴 수 있습니다");

const tooLargeForm = new FormData();
tooLargeForm.set("tileCode", "D17");
tooLargeForm.set("analysisId", "analysis-2");
tooLargeForm.set("memo", "큰 그림");
tooLargeForm.set("pins", "[]");
tooLargeForm.set("context", "{}");
const tooLarge = new Uint8Array(5 * 1024 * 1024 + 1);
tooLarge.set(png);
tooLargeForm.set("image", new Blob([tooLarge], { type: "image/png" }), "large.png");
const tooLargeResponse = await requestsRoute.POST(await auth(adminToken, "/api/v2/admin/requests", { method: "POST", body: tooLargeForm }));
assert.equal(tooLargeResponse.status, 400);
assert.equal((await tooLargeResponse.json()).error, "그림은 5 MB까지입니다");

const routeRequest = R.getTileRequest(db, createdBody.request.id);
R.transitionTileRequest(db, routeRequest.id, "완료", { commit: "route123", note: "완료" });
const patchResponse = await requestIdRoute.PATCH(await auth(adminToken, `/api/v2/admin/requests/${routeRequest.id}`, { method: "PATCH", body: JSON.stringify({ action: "reopen", note: "다시 확인" }), headers: { "Content-Type": "application/json" } }), { params: Promise.resolve({ id: String(routeRequest.id) }) });
assert.equal(patchResponse.status, 200);
const imageResponse = await imageRoute.GET(await auth(adminToken, `/api/v2/admin/requests/${first.id}/image`), { params: Promise.resolve({ id: String(first.id) }) });
assert.equal(imageResponse.status, 200);
assert.equal(imageResponse.headers.get("content-type"), "image/png");
assert.equal(db.prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'").pluck().get(), "3");

db.close();
console.log("✓ admin tile requests and API");
