/**
 * 도로명주소 건물 보조 원천의 효과 확인(읽기 전용): 반경 안 건물 수를 원천별로 세고 PNG(원천별 색)를 만든다.
 *   V2_DATA_DIR=<dir> npx tsx src/scripts/v2/juso-coverage-check.mjs [--center 127.15592,37.56253] [--radius 800] [--png out.png]
 * 센터는 도형의 무게중심이 원 안에 드는지로 센다(반경 조회와 달리 걸친 건물은 뺀다).
 */
import { writeFileSync } from "node:fs";
import sharp from "sharp";

const { openDataFile, readManifest } = await import("../../lib/v2/data/manifest.ts");
const { toUtmk } = await import("../../lib/v2/crs.ts");
const { v2DataDir } = await import("../../lib/v2/paths.ts");

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const [lng, lat] = opt("center", "127.15592,37.56253").split(",").map(Number);
const R = Number(opt("radius", "800"));
const [cx, cy] = toUtmk([lng, lat]);

const dir = v2DataDir();
const manifest = readManifest(dir);
const db = openDataFile(dir, manifest, "buildings");
const rows = db.prepare(`SELECT f.feature_id, f.stable_id, f.name, f.geom_json, b.height_m, b.height_method, b.use_code, b.field_provenance_json
  FROM feature_rtree r CROSS JOIN feature f ON f.feature_id = r.feature_id LEFT JOIN building_fact b ON b.feature_id = f.feature_id
  WHERE r.max_x >= ? AND r.min_x <= ? AND r.max_y >= ? AND r.min_y <= ? AND f.kind = 'building'`).all(cx - R - 300, cx + R + 300, cy - R - 300, cy + R + 300);

function centroid(g) {
  const ring = g.type === "Polygon" ? g.coordinates[0] : g.coordinates[0][0];
  let a = 0, x = 0, y = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const k = ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    a += k;
    x += (ring[i][0] + ring[i + 1][0]) * k;
    y += (ring[i][1] + ring[i + 1][1]) * k;
  }
  return a === 0 ? ring[0] : [x / (3 * a), y / (3 * a)];
}

const inside = [];
for (const r of rows) {
  const g = JSON.parse(r.geom_json);
  const [x, y] = centroid(g);
  if (Math.hypot(x - cx, y - cy) > R) continue;
  const prov = JSON.parse(r.field_provenance_json ?? "{}");
  const juso = r.stable_id.startsWith("juso:");
  const attached = !juso && typeof prov.height_m === "object" && String(prov.height_m?.source ?? "").startsWith("juso:");
  inside.push({ ...r, g, juso, attached, noHeight: r.height_m === null, nameFromJuso: !juso && prov.name?.source === "juso:BULD_NM" });
}
const count = (f) => inside.filter(f).length;
const gis = inside.filter((b) => !b.juso);
const out = {
  center: [lng, lat], radiusM: R,
  gisOnly: gis.length,
  jusoAdded: count((b) => b.juso),
  total: inside.length,
  jusoAddedWithHeight: count((b) => b.juso && !b.noHeight),
  jusoAddedNamed: count((b) => b.juso && b.name),
  gisAttachedHeight: count((b) => b.attached),
  gisAttachedName: count((b) => b.nameFromJuso),
  noHeightBefore: gis.filter((b) => b.noHeight && !b.attached).length + count((b) => b.attached), // 보태기 전: 원래 GIS에 높이가 없던 것
  noHeightAfter: count((b) => b.noHeight),
  noHeightAfterGis: gis.filter((b) => b.noHeight).length,
  noHeightAfterJusoAdded: count((b) => b.juso && b.noHeight),
  noUseCodeAfter: count((b) => !b.use_code),
};
// 이중 집계 검사: 도로명주소로 추가한 건물이 (GIS 건물 또는 서로) 겹치는 쌍 — 0.5 이상은 있어서는 안 된다
{
  const { overlapArea, planarArea } = await import("../../lib/v2/ingest/sources/juso-buildings.ts");
  const box = (g) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const p of g.type === "Polygon" ? g.coordinates : g.coordinates.flat()) for (const [x, y] of p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } return [x0, y0, x1, y1]; };
  const all = rows.map((r) => ({ r, g: JSON.parse(r.geom_json) })).map((e) => ({ ...e, b: box(e.g), a: planarArea(e.g) }));
  const added = all.filter((e) => e.r.stable_id.startsWith("juso:") && inside.some((i) => i.feature_id === e.r.feature_id));
  const pairs = { vsGis_ge50: 0, vsGis_20to50: 0, vsJuso_ge50: 0, vsJuso_20to50: 0 };
  for (const e of added) for (const o of all) {
    if (o === e || o.b[0] > e.b[2] || o.b[2] < e.b[0] || o.b[1] > e.b[3] || o.b[3] < e.b[1]) continue;
    const juso = o.r.stable_id.startsWith("juso:");
    if (juso && o.r.feature_id < e.r.feature_id) continue; // 쌍을 한 번만
    const ratio = overlapArea(e.g, o.g) / Math.min(e.a, o.a);
    const k = juso ? "vsJuso" : "vsGis";
    if (ratio >= 0.5) pairs[`${k}_ge50`]++;
    else if (ratio >= 0.2) { pairs[`${k}_20to50`]++; if (process.env.JUSO_DEBUG) console.log("partial", ratio.toFixed(2), e.r.stable_id, e.r.name, Math.round(e.a), "vs", o.r.stable_id, o.r.name, Math.round(o.a), o.r.height_m); }
  }
  out.overlapPairsOfAdded = pairs;
}
const named = {};
for (const b of inside.filter((x) => x.juso && x.name)) named[b.name.split(" ")[0]] = (named[b.name.split(" ")[0]] ?? 0) + 1;
out.jusoAddedTopNames = Object.entries(named).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([n, c]) => `${n} ${c}`).join(", ");
console.log(JSON.stringify(out, null, 1));

const png = opt("png", null);
if (png) {
  const S = 1000, scale = S / (2 * (R + 40));
  const px = (x, y) => `${((x - cx) * scale + S / 2).toFixed(1)},${(S / 2 - (y - cy) * scale).toFixed(1)}`;
  const path = (g) => (g.type === "Polygon" ? [g.coordinates] : g.coordinates).map((p) => p.map((ring) => `M${ring.map(([x, y]) => px(x, y)).join("L")}Z`).join("")).join("");
  const layer = (list, fill, stroke) => `<path fill="${fill}" stroke="${stroke}" stroke-width="0.4" fill-rule="evenodd" d="${list.map((b) => path(b.g)).join("")}"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}"><rect width="${S}" height="${S}" fill="#fff"/>
    ${layer(gis.filter((b) => !b.attached && !b.nameFromJuso), "#c9ced6", "#8a93a0")}
    ${layer(gis.filter((b) => b.attached || b.nameFromJuso), "#4aa3ff", "#1c6fc2")}
    ${layer(inside.filter((b) => b.juso && !b.noHeight), "#ff7a1a", "#a64d00")}
    ${layer(inside.filter((b) => b.juso && b.noHeight), "#e03131", "#8c1d1d")}
    <circle cx="${S / 2}" cy="${S / 2}" r="${R * scale}" fill="none" stroke="#111" stroke-width="1.5" stroke-dasharray="6 4"/>
    <g font-family="sans-serif" font-size="15"><rect x="8" y="8" width="330" height="118" fill="#fff" fill-opacity=".9" stroke="#999"/>
    <rect x="16" y="18" width="14" height="14" fill="#c9ced6" stroke="#8a93a0"/><text x="38" y="30">GIS건물 ${gis.length - out.gisAttachedHeight - count((b) => b.nameFromJuso && !b.attached)}</text>
    <rect x="16" y="42" width="14" height="14" fill="#4aa3ff" stroke="#1c6fc2"/><text x="38" y="54">GIS + 도로명주소 속성 보탬 ${count((b) => b.attached || b.nameFromJuso)} (높이 ${out.gisAttachedHeight})</text>
    <rect x="16" y="66" width="14" height="14" fill="#ff7a1a" stroke="#a64d00"/><text x="38" y="78">도로명주소로 추가(층수 있음) ${out.jusoAddedWithHeight}</text>
    <rect x="16" y="90" width="14" height="14" fill="#e03131" stroke="#8c1d1d"/><text x="38" y="102">도로명주소로 추가(층수 없음) ${out.noHeightAfterJusoAdded}</text>
    <text x="16" y="120" font-size="13">반경 ${R} m · 합계 ${out.total}</text></g></svg>`;
  writeFileSync(png.replace(/\.png$/i, ".svg"), svg);
  await sharp(Buffer.from(svg)).png().toFile(png);
  console.log("wrote", png);
}
db.close();
