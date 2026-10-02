import assert from "node:assert/strict";

const { minOf, maxOf } = await import("../../lib/v2/extent.ts");

// 실데이터 크기(Math.min(...xs)는 여기서 RangeError)
const big = Array.from({ length: 500_000 }, (_, i) => i - 1000);
assert.equal(minOf(big), -1000);
assert.equal(maxOf(big), 498_999);
assert.equal(minOf([]), Infinity);
assert.equal(maxOf([]), -Infinity);
console.log("v2 extent: ok");
