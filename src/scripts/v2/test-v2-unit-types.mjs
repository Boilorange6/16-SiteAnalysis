import assert from "node:assert/strict";

const U = await import("../../lib/v2/unit-types.ts");

assert.deepEqual(
  [84.999, 85.0, 59.5, 0, -1, "", null, "not-a-number"].map(U.unitTypeM2),
  [84, 85, 59, null, null, null, null, null],
  "전용면적 소수점 버림과 결측·비양수 제외",
);

const merged = new Map();
assert.equal(U.mergeUnitType(merged, U.unitTypeM2("084.9700A"), U.unitTypeUnits("10")), true);
assert.equal(U.mergeUnitType(merged, U.unitTypeM2("084.9700B"), U.unitTypeUnits("7")), true);
assert.equal(U.mergeUnitType(merged, U.unitTypeM2("059.5000"), U.unitTypeUnits("0")), false);
assert.deepEqual(U.sortedUnitTypes(merged), [{ typeM2: 84, units: 17 }], "같은 숫자의 A/B/C형은 합친다");

assert.equal(U.unitTypeSummary([{ typeM2: 84, units: 2840 }, { typeM2: 59, units: 1210 }, { typeM2: 114, units: 520 }, { typeM2: 49, units: 10 }, { typeM2: 74, units: 200 }]), "59 1,210 · 84 2,840 · 114 520 외 2타입");
assert.equal(U.unitTypeSummary([]), "타입 미확인");
assert.equal(U.UNIT_TYPE_BASIS, "전용면적 기준");

console.log("v2 unit type tests passed");
