import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NextRequest } from "next/server";

const legacyDir = mkdtempSync(join(tmpdir(), "v2-admin-auth-"));
process.env.DB_PATH = join(legacyDir, "legacy.sqlite");
process.env.JWT_SECRET = "a".repeat(64);

const U = await import("../../lib/server/user-store.ts");
const J = await import("../../lib/server/jwt.ts");
const { isUser, requireAdmin } = await import("../../lib/server/auth.ts");

const admin = U.createUser("admin1", "password", "admin");
const user = U.createUser("user1", "password");
const requestFor = (token) => new NextRequest("http://localhost/api/v2/admin/overview", token ? { headers: { Authorization: `Bearer ${token}` } } : {});

const anonymous = await requireAdmin(requestFor(null));
assert.equal(anonymous.status, 401);

const userToken = await J.signAccessToken(user.id);
const ordinary = await requireAdmin(requestFor(userToken));
assert.equal(ordinary.status, 403);
assert.equal((await ordinary.json()).error, "관리자 권한이 필요합니다");

const adminToken = await J.signAccessToken(admin.id);
assert.ok(isUser(await requireAdmin(requestFor(adminToken))));

assert.equal(U.setUserRole("user1", "admin"), true);
assert.ok(isUser(await requireAdmin(requestFor(userToken))));
assert.equal(U.setUserRole("없음", "admin"), false);

console.log("✓ admin auth and role update");
