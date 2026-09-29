/**
 * VWorld 클라이언트 테스트 — 로컬 가짜 서버만 쓴다(네트워크 없음).
 * 세션이 끊기면 서버는 파일 대신 로그인 HTML을 준다. 그걸 zip으로 저장하면 안 된다.
 */
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { parseFileList, latestFull, VworldSession, VworldError } = await import("../../lib/v2/ingest/vworld.ts");

const row = (sq, region, size, unit, kind, base) => `<li><!--v-for="n in 10"-->
<div class="item row"><input type="hidden" name="dsFileSq" value="${sq}"><input type="hidden" name="dsFileId" value="20171128DS00002">
<div class="format"><span class="shp">SHP</span></div><div class="less"><div class="path bg min"><span class="sigunguNm1">
${region}</span></div><div class="tit min">연속지적도형정보</div></div>
<div class="txt"><span>용량<em>
${size}</em>
${unit}</span><span>구분<em>${kind}</em></span><span>기준일<em class="xxs">${base}</em></span></div></div></li>`;

// ─── 1. 목록 파싱 ──────────────────────────────────────────────────────────
{
  const html = row("4729", "세종특별자치시", "37", "MB", "전체데이터", "2026-09-08") + row("4733", "경상북도", "1,203", "MB", "전체데이터", "2026-09-08") + row("4800", "세종특별자치시", "12", "KB", "변동데이터", "2026-09-28") + row("4600", "세종특별자치시", "36", "MB", "전체데이터", "2026-08-08");
  const files = parseFileList(html, "23");
  assert.equal(files.length, 4);
  assert.deepEqual(files[0], { dsId: "23", dsFileId: "20171128DS00002", fileSq: "4729", region: "세종특별자치시", title: "연속지적도형정보", format: "shp", approxBytes: 37 * 1024 ** 2, kind: "전체데이터", baseDate: "2026-09-08" });
  assert.equal(files[1].approxBytes, 1203 * 1024 ** 2, "천 단위 쉼표");
  assert.equal(files[2].approxBytes, 12 * 1024);
  assert.deepEqual(latestFull(files).map((f) => f.fileSq), ["4729", "4733"], "전체데이터 중 최신 기준일만");
}

// ─── 가짜 VWorld 서버 ──────────────────────────────────────────────────────
const state = { loggedIn: new Set(), expired: false, listPages: 0 };
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const sid = (req.headers.cookie ?? "").match(/SID=(\w+)/)?.[1];
  if (url.pathname === "/v4po_usrlogin_a001.do") {
    res.setHeader("set-cookie", [`SID=s${Date.now()}${Math.random().toString(36).slice(2, 6)}; Path=/`]);
    return res.end("<html>login</html>");
  }
  if (url.pathname === "/v4po_usrlogin_a004.do") {
    let body = "";
    for await (const c of req) body += c;
    const p = new URLSearchParams(body);
    res.setHeader("content-type", "application/json");
    if (!req.headers.referer || !req.headers.origin) return res.end(JSON.stringify({ resultMap: { result: "failed", msg: "잘못된 접근입니다." } }));
    if (p.get("usrIdeE") === b64("user") && p.get("usrPwdE") === b64("pass")) {
      state.loggedIn.add(sid);
      return res.end(JSON.stringify({ resultMap: { result: "expirePw", msg: "비밀번호 사용기간(6개월)이 초과하였습니다.", url: "/v4po_usrinf_i003.do" } }));
    }
    return res.end(JSON.stringify({ resultMap: { result: "error", msg: "아이디 또는 비밀번호가 일치하지 않습니다." } }));
  }
  if (url.pathname === "/dtmk/dtmk_ntads_s002.do") {
    state.listPages++;
    const page = Number(url.searchParams.get("datPageIndex"));
    const n = page === 1 ? 100 : 3;
    return res.end(Array.from({ length: n }, (_, i) => row(String(page * 1000 + i), "세종특별자치시", "1", "MB", "전체데이터", "2026-09-08")).join(""));
  }
  if (url.pathname === "/dtmk/downloadResourceFile.do") {
    if (!state.loggedIn.has(sid) || state.expired) {
      res.setHeader("content-type", "text/html;charset=UTF-8");
      return res.end("<html>로그인 후 이용해주세요</html>");
    }
    const payload = Buffer.from(`PK-fake-zip-${url.searchParams.get("fileNo")}`);
    res.setHeader("content-type", "application/download; UTF-8");
    res.setHeader("content-length", String(payload.length));
    return res.end(payload);
  }
  res.statusCode = 404;
  res.end();
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
let sleeps = 0;
const opts = { base, delayMs: 5, sleep: async () => { sleeps++; } };

try {
  // ─── 2. 로그인 ───────────────────────────────────────────────────────────
  await assert.rejects(new VworldSession(opts).login("user", "wrong"), (e) => e instanceof VworldError && e.code === "LOGIN_FAILED" && !/wrong/.test(e.message));
  const s = new VworldSession(opts);
  assert.equal(await s.login("user", "pass"), "expirePw", "비밀번호 기간 초과도 로그인 성공");

  // ─── 3. 목록: 페이지 넘김과 간격 ──────────────────────────────────────────
  const before = sleeps;
  const all = await s.listFiles("23");
  assert.equal(all.length, 103);
  assert.equal(state.listPages, 2);
  assert.equal(sleeps - before, 1, "두 번째 페이지 전에 한 번 쉰다");

  // ─── 4. 다운로드, 다시 받으면 건너뜀 ──────────────────────────────────────
  const dir = mkdtempSync(join(tmpdir(), "v2-vworld-"));
  const file = { dsId: "23", dsFileId: "20171128DS00002", fileSq: "4729", region: "세종특별자치시", title: "연속지적도형정보", format: "shp", approxBytes: null, kind: "전체데이터", baseDate: "2026-09-08" };
  const out = join(dir, "cadastral", "2026-09-08", "세종특별자치시.zip");
  const r1 = await s.download(file, out);
  assert.deepEqual(r1, { bytes: 16, skipped: false });
  assert.equal(readFileSync(out, "utf8"), "PK-fake-zip-4729");
  assert.equal(JSON.parse(readFileSync(`${out}.done.json`, "utf8")).fileSq, "4729");
  assert.deepEqual(await s.download(file, out), { bytes: 16, skipped: true });

  // ─── 5. 세션 만료 → HTML을 저장하지 않는다 ───────────────────────────────
  state.expired = true;
  const out2 = join(dir, "cadastral", "2026-09-08", "경상북도.zip");
  await assert.rejects(s.download({ ...file, fileSq: "4733", region: "경상북도" }, out2), (e) => e.code === "NOT_A_FILE");
  assert.equal(existsSync(out2), false);
  assert.deepEqual(readdirSync(join(dir, "cadastral", "2026-09-08")).filter((f) => f.endsWith(".part")), [], ".part 없음");
} finally {
  server.close();
}

console.log("✓ v2 vworld");
