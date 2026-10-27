/** 「내 테마」 계정 저장: 사용자별 격리, 종류별 12개 한도, 이름 번호, 본문 검사. 임시 DB를 쓴다. */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "v2-map-colors-"));
process.env.DB_PATH = join(dir, "test.db"); // database.ts를 가져오기 전에 둔다.

const { createUser } = await import("../../lib/server/user-store.ts");
const { listMapColors, saveMapColor, deleteMapColor, parseMapColorBody } = await import("../../lib/server/map-color-store.ts");
const { getDb } = await import("../../lib/server/database.ts");

const BASE = { bg: "#101820", building: "#2a3642", parcel: "#34414e", road: "#41505f", green: "#2f4a35", water: "#1d3a52", site: "#ff8a8a" };
const PAL = { cat: ["#e6194b", "#3cb44b", "#ffe119", "#4363d8", "#f58231", "#911eb4", "#46f0f0", "#f032e6"], seq: ["#f7fbff", "#c6dbef", "#6baed6", "#2171b5", "#08306b"] };

try {
  const a = createUser("map-a", "pw-aaaaaa").id;
  const b = createUser("map-b", "pw-bbbbbb").id;

  // 저장·목록·삭제 왕복
  assert.deepEqual(listMapColors(a), { base: [], palette: [] });
  const s1 = saveMapColor(a, "base", BASE);
  assert.equal(s1.name, "내 테마 1");
  assert.deepEqual(s1.colors, BASE);
  const p1 = saveMapColor(a, "palette", PAL);
  assert.equal(p1.name, "내 테마 1", "종류마다 번호를 센다");
  assert.deepEqual(listMapColors(a), { base: [s1], palette: [p1] });
  assert.deepEqual(listMapColors(b), { base: [], palette: [] }, "다른 사용자 것은 보이지 않는다");

  // 남의 것은 지울 수 없다
  assert.equal(deleteMapColor(b, s1.id), false);
  assert.equal(listMapColors(a).base.length, 1);
  assert.equal(deleteMapColor(a, s1.id), true);
  assert.equal(deleteMapColor(a, s1.id), false, "이미 지웠으면 false");
  assert.deepEqual(listMapColors(a).base, []);

  // 이름 번호: 중간 것을 지워도 겹치지 않는다. 최근 것이 먼저다.
  const n = [saveMapColor(b, "base", BASE), saveMapColor(b, "base", BASE), saveMapColor(b, "base", BASE)];
  assert.deepEqual(n.map((x) => x.name), ["내 테마 1", "내 테마 2", "내 테마 3"]);
  deleteMapColor(b, n[1].id);
  assert.equal(saveMapColor(b, "base", BASE).name, "내 테마 4");
  assert.deepEqual(listMapColors(b).base.map((x) => x.name), ["내 테마 4", "내 테마 3", "내 테마 1"]);

  // 종류별 12개: 13번째에 가장 오래된 것이 빠진다.
  const c = createUser("map-c", "pw-cccccc").id;
  const saved = Array.from({ length: 13 }, () => saveMapColor(c, "palette", PAL));
  const kept = listMapColors(c).palette;
  assert.equal(kept.length, 12);
  assert.equal(kept[0].name, "내 테마 13");
  assert.equal(kept.at(-1).name, "내 테마 2", "가장 오래된 1번이 빠졌다");
  assert.ok(!kept.some((x) => x.id === saved[0].id));
  assert.equal(saveMapColor(c, "base", BASE).name, "내 테마 1", "다른 종류의 한도와 번호는 따로");

  // 사용자를 지우면 같이 지워진다(외래키 CASCADE)
  getDb().prepare("DELETE FROM users WHERE id = ?").run(c);
  assert.deepEqual(listMapColors(c), { base: [], palette: [] });

  // 본문 검사
  assert.deepEqual(parseMapColorBody({ kind: "base", colors: BASE }), { kind: "base", colors: BASE });
  assert.deepEqual(parseMapColorBody({ kind: "palette", colors: PAL }), { kind: "palette", colors: PAL });
  assert.deepEqual(parseMapColorBody({ kind: "base", colors: { ...BASE, extra: "#000000" } }), { kind: "base", colors: BASE }, "모르는 키는 버린다");
  const { site: _site, ...sixKeys } = BASE;
  for (const bad of [
    null,
    "base",
    {},
    { kind: "base", colors: sixKeys },
    { kind: "base", colors: { ...BASE, bg: "red" } },
    { kind: "base", colors: { ...BASE, bg: "#fff" } },
    { kind: "palette", colors: { ...PAL, cat: PAL.cat.slice(0, 7) } },
    { kind: "palette", colors: { ...PAL, seq: PAL.seq.slice(0, 4) } },
    { kind: "palette", colors: { ...PAL, cat: [...PAL.cat.slice(0, 7), "blue"] } },
    { kind: "palette", colors: BASE },
    { kind: "base", colors: PAL },
    { kind: "zzz", colors: BASE },
    { colors: BASE },
  ]) assert.equal(parseMapColorBody(bad), null, JSON.stringify(bad));
  assert.throws(() => saveMapColor(a, "base", { ...BASE, bg: "red" }), "저장 직전에도 검사한다");
} finally {
  getDb().close();
  rmSync(dir, { recursive: true, force: true });
}

console.log("v2 map color store tests passed");
