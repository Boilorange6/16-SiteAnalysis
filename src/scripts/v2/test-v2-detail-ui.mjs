import assert from "node:assert/strict";

const {
  DETAIL_CODES,
  filterDetailRows,
  formatDetailValue,
  hasDetail,
  sanitizeDetailText,
  sortDetailRows,
  tableColumns,
} = await import("../../lib/v2/ui/detail-state.ts");

assert.equal(hasDetail("D03"), true);
assert.equal(hasDetail("D15"), false);

const payload = {
  code: "D03",
  columns: [
    { key: "name", label: "이름", kind: "text" },
    { key: "floors_above", label: "지상층", kind: "number" },
    { key: "gross_floor_m2", label: "연면적(㎡)", kind: "number" },
  ],
  csvColumns: [
    { key: "name", label: "이름", kind: "text" },
    { key: "floors_above", label: "지상층", kind: "number" },
    { key: "floors_below", label: "지하층", kind: "number", csvOnly: true },
    { key: "approval_date", label: "사용승인일", kind: "date", csvOnly: true },
  ],
};
const columns = tableColumns(payload);
assert.equal(columns.find((column) => column.key === "floors_above")?.label, "층");
assert.equal(columns.find((column) => column.key === "approval_date")?.label, "승인");

const row = { fid: "1", lng: 127, lat: 37, cells: { name: "현대아파트", floors_above: 22, floors_below: 3, approval_date: "1995-11-30", gross_floor_m2: 29306 } };
assert.equal(formatDetailValue(row.cells.floors_above, columns.find((column) => column.key === "floors_above"), row), "22/B3");
assert.equal(formatDetailValue(22, columns.find((column) => column.key === "floors_above"), { ...row, cells: { ...row.cells, floors_below: null } }), "22/—");
assert.equal(formatDetailValue(row.cells.approval_date, columns.find((column) => column.key === "approval_date")), "1995");
assert.equal(formatDetailValue(row.cells.gross_floor_m2, columns.find((column) => column.key === "gross_floor_m2")), "29,306");

const rawTemplate = "출처 · 원자료 직선거리 ${number(item.straight)}m";
const renderedCardText = sanitizeDetailText(rawTemplate);
assert.doesNotMatch(renderedCardText, /\$\{/);
assert.match(renderedCardText, /값 없음/);

const rows = [
  { fid: "2", lng: 127, lat: 37, cells: { name: "나", value: 2 } },
  { fid: "1", lng: 127, lat: 37, cells: { name: "가", value: 1 } },
];
assert.equal(filterDetailRows(rows, [{ key: "name", label: "이름", kind: "text" }], "가").length, 1);
assert.deepEqual(sortDetailRows(rows, { key: "value", label: "값", kind: "number" }, "asc").map((item) => item.fid), ["1", "2"]);
assert.ok(DETAIL_CODES.size >= 20);

console.log("✓ v2 detail UI state (table formatting, mobile/search data, template guard)");
