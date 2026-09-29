/**
 * A0 측정 도구 테스트.
 * data.go.kr CSV는 대부분 CP949다. UTF-8로 잘못 읽으면 채움률이 조용히 틀린다.
 */
import assert from "node:assert/strict";

const { decodeText, parseCsv, isFilled, measureRecords, csvRecords } = await import("../../lib/v2/a0/measure.ts");
const { REVIEW_SITES } = await import("../../lib/v2/a0/review-sites.ts");

// ─── 1. 인코딩 판별 ────────────────────────────────────────────────────────
{
  // "가" = EUC-KR B0 A1
  const euckr = Uint8Array.from([0x6e, 0x61, 0x6d, 0x65, 0x0a, 0xb0, 0xa1, 0x0a]);
  assert.deepEqual(decodeText(euckr), { text: "name\n가\n", encoding: "euc-kr" });
  const bom = Uint8Array.from([0xef, 0xbb, 0xbf, ...Buffer.from("name\n가\n", "utf8")]);
  assert.deepEqual(decodeText(bom), { text: "name\n가\n", encoding: "utf-8" });
  assert.equal(decodeText(Buffer.from("a,b\n", "utf8")).encoding, "utf-8");
}

// ─── 2. CSV: 따옴표 안 쉼표·줄바꿈·이스케이프, CRLF ─────────────────────────
{
  assert.deepEqual(parseCsv('a,b\r\n"x,1","y ""q"""\r\n"multi\nline",z\r\n'), [["a", "b"], ["x,1", 'y "q"'], ["multi\nline", "z"]]);
  assert.deepEqual(parseCsv("a,b\n1,\n"), [["a", "b"], ["1", ""]], "빈 마지막 칸 보존");
}

// ─── 3. 채움 판정 ──────────────────────────────────────────────────────────
{
  for (const v of ["", "  ", null, undefined, "None", "null", "NULL", "-", "NaN"]) assert.equal(isFilled(v), false, `${v}`);
  for (const v of ["0", 0, "가", "2020-01-01"]) assert.equal(isFilled(v), true, `${v}`);
}

// ─── 4. 측정: 전체·지역·검수지 ──────────────────────────────────────────────
{
  const site = REVIEW_SITES.find((s) => s.id === "dasan");
  const csv = Buffer.from(
    ["code,height,lng,lat",
     `4136010100,12.5,${site.center[0]},${site.center[1]}`,
     `4136010100,,${site.center[0]},${site.center[1]}`,
     "1168010100,30,127.0592,37.4869",
     "2635010100,None,,"].join("\n") + "\n",
    "utf8",
  );
  const { fieldNames, records, encoding } = csvRecords(csv, { lngField: "lng", latField: "lat" });
  assert.equal(encoding, "utf-8");
  assert.deepEqual(fieldNames, ["code", "height", "lng", "lat"]);
  assert.equal(records[3].point, null, "좌표 없는 행");

  const report = await measureRecords(records, fieldNames, { regionField: "code", regionDigits: 2, sites: REVIEW_SITES, siteRadiusM: 1000 });
  assert.equal(report.rows, 4);
  assert.deepEqual(report.fields.find((f) => f.field === "height"), { field: "height", filled: 2, total: 4, fillRate: 0.5 });
  assert.deepEqual(report.byRegion, { "11": 1, "26": 1, "41": 2 });
  assert.equal(report.bySite.dasan.rows, 2);
  assert.deepEqual(report.bySite.dasan.fields.find((f) => f.field === "height"), { field: "height", filled: 1, total: 2, fillRate: 0.5 });
  assert.equal(report.bySite.guryong.rows, 1);
  assert.equal(report.bySite.wanju.rows, 0);
  assert.deepEqual(report.bySite.wanju.fields.find((f) => f.field === "height"), { field: "height", filled: 0, total: 0, fillRate: null }, "0행이면 채움률은 산정 불가(null)");
}

// ─── 5. 검수지 8곳 ─────────────────────────────────────────────────────────
{
  assert.equal(REVIEW_SITES.length, 8);
  assert.deepEqual(REVIEW_SITES.map((s) => s.id), ["guryong", "dasan", "cheongwadae", "jeongja", "marinecity", "bokjeong", "sejong", "wanju"]);
  for (const s of REVIEW_SITES) {
    assert.ok(s.center[0] > 124 && s.center[0] < 132 && s.center[1] > 33 && s.center[1] < 39, `${s.id} 좌표가 한국 범위`);
  }
}

console.log("✓ v2 a0 measure");
