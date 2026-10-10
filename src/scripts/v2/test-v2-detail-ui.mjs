import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const {
  DETAIL_CODES,
  DETAIL_LIST_LIMIT,
  detailDisplayValue,
  detailListApiUrl,
  filterDetailRows,
  formatDetailCardValue,
  formatDetailValue,
  hasDetail,
  normalizeDetailPayload,
  rowTitle,
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
assert.equal(detailDisplayValue("property_type", "apt"), "아파트");
assert.equal(detailDisplayValue("contract_type", "trade"), "매매");
assert.equal(detailDisplayValue("stage", "under_construction"), "공사 중");
assert.equal(detailDisplayValue("direction", "NNE"), "북북동");
assert.equal(detailDisplayValue("unknown_code", "keep_me"), "keep_me");

const buildingColumns = [
  { key: "name", label: "이름", kind: "text" },
  { key: "address", label: "주소", kind: "text" },
  { key: "primary_use", label: "주용도", kind: "category" },
];
const buildingRow = { fid: "7728861", lng: 127, lat: 37, cells: { name: null, address: null, primary_use: "01000", pnu: "1174010300102500000" } };
assert.equal(formatDetailValue(buildingRow.cells.primary_use, buildingColumns[2], buildingRow), "주거");
assert.notEqual(formatDetailValue(buildingRow.cells.name, buildingColumns[0], buildingRow), "—");
assert.notEqual(formatDetailValue(buildingRow.cells.address, buildingColumns[1], buildingRow), "—");
assert.equal(rowTitle(buildingRow, buildingColumns), "건물 7728861");
assert.equal(formatDetailCardValue("762249.4500000005㎡"), "762,249.45㎡");
assert.doesNotMatch(formatDetailCardValue("762249.4500000005㎡"), /\d\.\d{3,}/);

const listUrl = new URL(detailListApiUrl("analysis/id", "D02", { metric: "gfa" }), "https://example.test");
assert.equal(listUrl.searchParams.get("metric"), "gfa");
assert.equal(listUrl.searchParams.get("limit"), String(DETAIL_LIST_LIMIT));
assert.ok(Number(listUrl.searchParams.get("limit")) >= 1068, "the detail request must be able to return every summary row");

const a04 = normalizeDetailPayload({
  analysisId: "analysis/id",
  code: "A04",
  title: "공원·녹지·하천",
  columns: [{ key: "name", label: "이름", kind: "text" }, { key: "area_m2", label: "면적(㎡)", kind: "number" }],
  csvColumns: [],
  controls: [],
  card: { title: "공원·녹지·하천", fields: [{ label: "면적 합계", value: "0㎡" }], source: "원천" },
  rows: [{ fid: "park-1", lng: 127, lat: 37, cells: { name: "미래내공원", area_m2: 0, share_pct: 0 } }],
  total: 1,
  exportFileName: "detail.csv",
}, [{ fid: "park-1", weight: 1234 }], 800);
assert.equal(a04.rows.length, a04.total, "the displayed detail rows must match the summary count");
assert.equal(a04.rows[0].cells.area_m2, 1234);
assert.equal(a04.card.fields[0].value, "1,234㎡");

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

const mapFigureSource = readFileSync(new URL("../../components/v2/map-figure.tsx", import.meta.url), "utf8");
assert.doesNotMatch(mapFigureSource, /key=\{i\}/, "map feature keys must not use a bare index");
assert.doesNotMatch(mapFigureSource, /key=\{r\}/, "ring keys must be namespaced");
assert.doesNotMatch(mapFigureSource, /key=\{n\}/, "note keys must be namespaced");
assert.doesNotMatch(mapFigureSource, /key=\{it\.layer\}/, "legend keys must be namespaced");

console.log("✓ v2 detail UI state (table formatting, mobile/search data, template guard)");
