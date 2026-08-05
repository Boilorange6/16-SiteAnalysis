/**
 * 정비구역 경계 노후 감지.
 *
 * 경계 SHP는 VWorld 로그인이 필요해 자동 갱신이 불가능하다(사람이 받아야 한다).
 * 잊히면 조용히 낡는다 — 소스 상태는 계속 "정상"이라 아무도 모른다.
 * 그래서 데이터 자체의 나이를 보고 안내를 띄운다.
 */
import assert from "node:assert/strict";
import { boundaryStalenessWarning, BOUNDARY_STALE_DAYS } from "../lib/server/maintenance/boundary-store.ts";

const now = Date.parse("2026-08-05T00:00:00Z");
const feature = (retrievedAt) => ({ properties: { retrieved_at: retrievedAt } });

// 갓 받은 경계는 조용하다
assert.equal(boundaryStalenessWarning([feature("2026-08-01")], now), null);

// 임계 직전도 조용하다
const justUnder = new Date(now - (BOUNDARY_STALE_DAYS - 1) * 86400_000).toISOString().slice(0, 10);
assert.equal(boundaryStalenessWarning([feature(justUnder)], now), null, "임계 미만은 안내하지 않는다");

// 임계를 넘으면 며칠 됐는지 알려준다
const stale = new Date(now - (BOUNDARY_STALE_DAYS + 20) * 86400_000).toISOString().slice(0, 10);
const warning = boundaryStalenessWarning([feature(stale)], now);
assert.ok(warning, "노후 경계는 안내해야 한다");
assert.match(warning, /정비구역 경계/, "무엇이 낡았는지 알려야 한다");
assert.match(warning, new RegExp(String(BOUNDARY_STALE_DAYS + 20)), "며칠 됐는지 알려야 한다");
assert.doesNotMatch(warning, /실패|오류/, "실패가 아니라 안내다");

// 가장 오래된 것을 기준으로 삼는다 — 일부만 갱신된 경우를 놓치지 않는다
const mixed = boundaryStalenessWarning([feature("2026-08-01"), feature(stale)], now);
assert.ok(mixed, "하나라도 낡았으면 안내한다");

// 경계가 없으면 안내할 것도 없다 (실패는 소스 상태가 따로 알린다)
assert.equal(boundaryStalenessWarning([], now), null);

// 날짜가 깨져 있어도 터지지 않는다
assert.equal(boundaryStalenessWarning([feature("알 수 없음")], now), null);
assert.equal(boundaryStalenessWarning([{ properties: {} }], now), null);

console.log("boundary-staleness: all assertions passed");
