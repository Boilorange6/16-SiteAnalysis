import assert from "node:assert/strict";

const { buildPptLegendItems } = await import("../lib/ppt-rail-legend.ts");

const categoryColors = {
  subway: "#F59E0B",
  school: "#7DD3FC",
  park: "#10B981",
  mountain: "#0F766E",
  apartment: "#EF4444",
  officetel: "#F97316",
  residential: "#A855F7",
  maintenance: "#EC4899",
};

// Given: a PPT map with no planned rail layer.
const operationalOnly = buildPptLegendItems(categoryColors, false);

// Then: the existing category legend remains unchanged.
assert.equal(operationalOnly.length, 8);
assert.equal(operationalOnly.some((item) => item.label.includes("예정 철도")), false);

// Given: the captured map contains a planned/approximate rail overlay.
const withPlannedRail = buildPptLegendItems(categoryColors, true);

// Then: the same legend explicitly identifies that overlay and its meaning.
assert.equal(withPlannedRail.length, 9);
assert.deepEqual(withPlannedRail.at(-1), {
  label: "예정 철도 (개략)",
  color: "#0F172A",
});

console.log("planned-rail-ppt-label: legend contract passed");
