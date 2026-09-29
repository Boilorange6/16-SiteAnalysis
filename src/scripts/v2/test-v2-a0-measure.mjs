/**
 * A0 측정 도구 테스트.
 * data.go.kr CSV는 대부분 CP949다. UTF-8로 잘못 읽으면 채움률이 조용히 틀린다.
 */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "a0-measure-"));
const tmpFile = (name, bytes) => { const p = join(dir, name); writeFileSync(p, bytes); return p; };

const { decodeText, parseCsv, isFilled, measureRecords, csvRecords, normalizeEncoding } = await import("../../lib/v2/a0/measure.ts");
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
  const { fieldNames, records: stream, encoding } = await csvRecords(tmpFile("main.csv", csv), { lngField: "lng", latField: "lat" });
  const records = [];
  for await (const r of stream) records.push(r);
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

// ─── 6. 스트리밍 CSV: CP949, 따옴표 속 줄바꿈·쉼표, 1 MiB 청크 경계 ──────────
{
  const collect = async (it) => { const a = []; for await (const r of it) a.push(r); return a; };

  // CP949: "가" = B0 A1
  const cp = await csvRecords(tmpFile("cp949.csv", Uint8Array.from([...Buffer.from("name,lng,lat\r\n"), 0xb0, 0xa1, ...Buffer.from(",127.0,37.0\r\n")])));
  assert.equal(cp.encoding, "euc-kr");
  const cpRows = await collect(cp.records);
  assert.equal(cpRows[0].properties.name, "가");
  assert.equal((await measureRecords(cpRows, cp.fieldNames)).rows, 1);

  // UTF-8 BOM + 따옴표 안 줄바꿈·쉼표, 빈 줄 건너뜀
  const q = await csvRecords(tmpFile("quoted.csv", Buffer.from("﻿name,x\n\n\"a,\nb\",1\n\"q\"\"\",2"))); // 마지막 줄은 개행 없음
  assert.equal(q.encoding, "utf-8");
  assert.deepEqual(q.fieldNames, ["name", "x"]);
  assert.deepEqual((await collect(q.records)).map((r) => r.properties), [{ name: "a,\nb", x: "1" }, { name: 'q"', x: "2" }]);

  // 1 MiB 경계에 한글 한 글자("가" 3바이트)가 걸리도록 채운다
  const header = "name,lng,lat\n";
  const rowLine = "abc,127.0,37.0\n";
  let body = header + rowLine.repeat(60000);
  const padLen = (1 << 20) - 1 - Buffer.byteLength(body);
  assert.ok(padLen > 0);
  body += "y".repeat(padLen) + "가,127.0,37.0\n" + rowLine.repeat(20000);
  assert.ok(Buffer.byteLength(body) > 1.2 * (1 << 20) - 100_000);
  const big = await csvRecords(tmpFile("big.csv", Buffer.from(body, "utf8")), { lngField: "lng", latField: "lat" });
  assert.equal(big.encoding, "utf-8");
  const bigReport = await measureRecords(big.records, big.fieldNames, { pointBasis: "lnglat-columns" });
  assert.equal(bigReport.rows, 60000 + 1 + 20000);
  assert.equal(bigReport.pointBasis, "lnglat-columns");
}

// ─── 7. 한국 범위 밖 좌표는 검수지에 배정하지 않고 센다 ───────────────────────
{
  const site = REVIEW_SITES.find((s) => s.id === "dasan");
  const rows = [
    { properties: { a: "1" }, point: [200000, 500000] },
    { properties: { a: "1" }, point: site.center },
  ];
  const r = await measureRecords(rows, ["a"], { sites: REVIEW_SITES });
  assert.equal(r.outOfRangePoints, 1);
  assert.equal(r.pointBasis, "none");
  assert.equal(Object.values(r.bySite).reduce((n, s) => n + s.rows, 0), 1);
}

// ─── 8. 인코딩 라벨 정규화 ─────────────────────────────────────────────────
{
  for (const l of ["cp949", "CP949", "ms949", "x-windows-949", "ks_c_5601-1987", "EUC-KR", " euc-kr "]) assert.equal(normalizeEncoding(l), "euc-kr", l);
  assert.equal(normalizeEncoding("UTF8"), "utf-8");
  assert.equal(normalizeEncoding("utf-8"), "utf-8");
}

// ─── 9. CLI: --site-radius 검증 ────────────────────────────────────────────
{
  const { spawnSync } = await import("node:child_process");
  const csv = tmpFile("r.csv", "a\n1\n");
  for (const bad of ["0", "-5", "abc"]) {
    const r = spawnSync(process.execPath, ["--import", "tsx", "src/scripts/v2/a0-measure.mjs", csv, "--site-radius", bad], { encoding: "utf8" });
    assert.equal(r.status, 2, `--site-radius ${bad}`);
    assert.match(r.stderr, /--site-radius must be a positive number/);
  }
}

console.log("✓ v2 a0 measure");
