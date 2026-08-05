/**
 * deploy/release-lib.sh 단위 테스트.
 * 임시 디렉터리를 원격 루트로 삼아 릴리스 전환·롤백·정리·헬스체크를 검증한다.
 */
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync, lstatSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const libPath = path.join(here, "..", "deploy", "release-lib.sh").replaceAll("\\", "/");

/**
 * release-lib.sh를 source한 뒤 명령을 실행하고 stdout을 반환.
 * MSYS=winsymlinks:nativestrict — Git Bash는 기본적으로 심볼릭 링크 대신 복사를 만든다.
 * 배포 대상(Linux)에는 영향이 없고, 로컬에서 실제 링크 동작을 검증하기 위한 환경 보정이다.
 */
function runLib(script, options = {}) {
  return execFileSync("bash", ["-c", `set -Eeuo pipefail; source '${libPath}'; ${script}`], {
    encoding: "utf8",
    ...options,
    env: { ...process.env, MSYS: "winsymlinks:nativestrict", ...(options.env ?? {}) },
  }).trim();
}

/**
 * 비동기 실행판. 같은 프로세스에서 띄운 테스트 서버가 응답하려면
 * 이벤트 루프가 살아 있어야 하므로 헬스체크 테스트는 이쪽을 쓴다.
 */
function runLibAsync(script) {
  return new Promise((resolve, reject) => {
    execFile("bash", ["-c", `set -Eeuo pipefail; source '${libPath}'; ${script}`],
      { encoding: "utf8", env: { ...process.env, MSYS: "winsymlinks:nativestrict" } },
      (error, stdout) => (error ? reject(error) : resolve(stdout.trim())));
  });
}

function tempRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "release-test-"));
  return root.replaceAll("\\", "/");
}

function seedRelease(root, stamp, marker) {
  const dir = path.join(root, "releases", stamp);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "marker.txt"), marker);
  return dir;
}

// ── release_activate: current 심볼릭 링크가 지정 릴리스를 가리킨다 ──────────
{
  const root = tempRoot();
  seedRelease(root, "20260101-000000", "first");
  runLib(`release_activate '${root}' 20260101-000000`);
  const current = path.join(root, "current");
  assert.ok(existsSync(current), "current 링크가 생성되어야 한다");
  assert.equal(readFileSync(path.join(current, "marker.txt"), "utf8"), "first");
  rmSync(root, { recursive: true, force: true });
}

// ── release_activate: 이전 릴리스를 previous 파일에 기록한다 ────────────────
{
  const root = tempRoot();
  seedRelease(root, "20260101-000000", "first");
  seedRelease(root, "20260102-000000", "second");
  runLib(`release_activate '${root}' 20260101-000000`);
  runLib(`release_activate '${root}' 20260102-000000`);
  assert.equal(readFileSync(path.join(root, "releases", ".previous"), "utf8").trim(), "20260101-000000");
  assert.equal(readFileSync(path.join(root, "current", "marker.txt"), "utf8"), "second");
  rmSync(root, { recursive: true, force: true });
}

// ── release_rollback: 직전 릴리스로 되돌린다 ───────────────────────────────
{
  const root = tempRoot();
  seedRelease(root, "20260101-000000", "first");
  seedRelease(root, "20260102-000000", "second");
  runLib(`release_activate '${root}' 20260101-000000`);
  runLib(`release_activate '${root}' 20260102-000000`);
  runLib(`release_rollback '${root}'`);
  assert.equal(readFileSync(path.join(root, "current", "marker.txt"), "utf8"), "first",
    "롤백 후 current는 직전 릴리스를 가리켜야 한다");
  rmSync(root, { recursive: true, force: true });
}

// ── release_rollback: 직전 릴리스가 없으면 실패한다(조용히 성공 금지) ──────
{
  const root = tempRoot();
  seedRelease(root, "20260101-000000", "only");
  runLib(`release_activate '${root}' 20260101-000000`);
  assert.throws(() => runLib(`release_rollback '${root}' 2>/dev/null`),
    "이전 릴리스가 없으면 0이 아닌 종료코드를 반환해야 한다");
  rmSync(root, { recursive: true, force: true });
}

// ── release_prune: 최신 N개만 남기고, 현재/이전 릴리스는 보호한다 ──────────
{
  const root = tempRoot();
  for (const stamp of ["20260101-000000", "20260102-000000", "20260103-000000", "20260104-000000", "20260105-000000"]) {
    seedRelease(root, stamp, stamp);
  }
  runLib(`release_activate '${root}' 20260104-000000`);
  runLib(`release_activate '${root}' 20260105-000000`);
  runLib(`release_prune '${root}' 3`);
  const remaining = readdirSync(path.join(root, "releases")).filter((name) => !name.startsWith(".")).sort();
  assert.deepEqual(remaining, ["20260103-000000", "20260104-000000", "20260105-000000"]);
  rmSync(root, { recursive: true, force: true });
}

// ── release_prune: 보관 수보다 적으면 아무것도 지우지 않는다 ───────────────
{
  const root = tempRoot();
  seedRelease(root, "20260101-000000", "a");
  seedRelease(root, "20260102-000000", "b");
  runLib(`release_prune '${root}' 3`);
  assert.equal(readdirSync(path.join(root, "releases")).filter((n) => !n.startsWith(".")).length, 2);
  rmSync(root, { recursive: true, force: true });
}

// ── health_check: 200이면 성공, 실패 응답이면 재시도 후 실패 ───────────────
{
  let hits = 0;
  const server = createServer((req, res) => {
    hits += 1;
    // 3번째 요청부터 200 — 기동 지연을 재시도로 넘길 수 있어야 한다
    if (hits < 3) {
      res.writeHead(502).end("bad gateway");
      return;
    }
    res.writeHead(200).end("ok");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  const output = await runLibAsync(`health_check 'http://127.0.0.1:${port}/' 5 0 && echo PASSED`);
  assert.match(output, /PASSED/, "재시도 끝에 200을 받으면 성공해야 한다");
  assert.ok(hits >= 3, `재시도가 실제로 일어나야 한다 (hits=${hits})`);

  server.close();
}

{
  // 계속 실패하면 재시도 소진 후 0이 아닌 종료코드
  const server = createServer((req, res) => res.writeHead(500).end("boom"));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await assert.rejects(runLibAsync(`health_check 'http://127.0.0.1:${port}/' 2 0 2>/dev/null`),
    "계속 실패하면 실패로 종료해야 한다");
  server.close();
}

// ── release_activate: current가 심볼릭 링크여야 원자적 교체가 가능하다 ─────
{
  const root = tempRoot();
  seedRelease(root, "20260101-000000", "first");
  runLib(`release_activate '${root}' 20260101-000000`);
  assert.ok(lstatSync(path.join(root, "current")).isSymbolicLink(), "current는 심볼릭 링크여야 한다");
  rmSync(root, { recursive: true, force: true });
}

// ── resolve_server_entry: standalone 산출물 위치를 찾아낸다 ────────────────
// Next.js가 워크스페이스 루트를 상위로 추론하면 산출물이
// .next/standalone/<중첩 경로>/server.js 로 들어간다(2026-08-01 운영 장애 원인).
{
  const root = tempRoot();
  const flat = path.join(root, "releases", "flat").replaceAll("\\", "/");
  mkdirSync(path.join(flat, ".next", "standalone"), { recursive: true });
  writeFileSync(path.join(flat, ".next", "standalone", "server.js"), "// entry");
  assert.equal(
    runLib(`resolve_server_entry '${flat}'`),
    path.join(flat, ".next", "standalone", "server.js").replaceAll("\\", "/"),
    "평면 배치일 때 표준 경로를 반환해야 한다",
  );
  rmSync(root, { recursive: true, force: true });
}

{
  const root = tempRoot();
  const nested = path.join(root, "releases", "nested").replaceAll("\\", "/");
  const deep = path.join(nested, ".next", "standalone", "releases", "20260801-002231");
  mkdirSync(deep, { recursive: true });
  writeFileSync(path.join(deep, "server.js"), "// entry");
  assert.equal(
    runLib(`resolve_server_entry '${nested}'`),
    path.join(deep, "server.js").replaceAll("\\", "/"),
    "중첩 배치여도 실제 server.js를 찾아야 한다",
  );
  rmSync(root, { recursive: true, force: true });
}

{
  // 산출물이 아예 없으면 실패해야 한다 — 운영 프로세스를 내리기 전에 막기 위함
  const root = tempRoot();
  const empty = path.join(root, "releases", "empty").replaceAll("\\", "/");
  mkdirSync(path.join(empty, ".next"), { recursive: true });
  assert.throws(() => runLib(`resolve_server_entry '${empty}' 2>/dev/null`),
    "산출물이 없으면 0이 아닌 종료코드를 반환해야 한다");
  rmSync(root, { recursive: true, force: true });
}

console.log("test-release-manager: all assertions passed");

// ── stage_standalone_assets: public/ 중첩 없이 standalone에 복사한다 ──────────
// 배경: `cp -r public .next/standalone/public`은 대상 디렉터리가 이미 있으면
// public/public/ 으로 중첩된다. 운영에서 폰트·assets가 404가 됐다.
{
  const root = mkdtempSync(path.join(tmpdir(), "stage-assets-")).replaceAll("\\", "/");
  mkdirSync(path.join(root, "public", "fonts"), { recursive: true });
  mkdirSync(path.join(root, "public", "assets"), { recursive: true });
  writeFileSync(path.join(root, "public", "fonts", "Pretendard-Medium.woff2"), "font");
  writeFileSync(path.join(root, "public", "assets", "logo.svg"), "<svg/>");
  mkdirSync(path.join(root, ".next", "static", "chunks"), { recursive: true });
  writeFileSync(path.join(root, ".next", "static", "chunks", "main.js"), "//js");

  // Next standalone은 public/ 일부를 미리 만들어 둔다 — 중첩이 생기는 조건
  mkdirSync(path.join(root, ".next", "standalone", "public", "data"), { recursive: true });
  writeFileSync(path.join(root, ".next", "standalone", "public", "data", "keep.json"), "{}");
  mkdirSync(path.join(root, ".next", "standalone", ".next"), { recursive: true });

  runLib(`stage_standalone_assets '${root}'`);

  const sa = path.join(root, ".next", "standalone");
  assert.ok(existsSync(path.join(sa, "public", "fonts", "Pretendard-Medium.woff2")),
    "폰트는 public/fonts 바로 아래에 있어야 한다");
  assert.ok(existsSync(path.join(sa, "public", "assets", "logo.svg")),
    "assets도 public 바로 아래에 있어야 한다");
  assert.ok(!existsSync(path.join(sa, "public", "public")),
    "public/public 중첩이 생기면 안 된다 (운영 폰트 404의 원인)");
  assert.ok(existsSync(path.join(sa, "public", "data", "keep.json")),
    "standalone이 미리 만든 public 내용은 보존해야 한다");
  assert.ok(existsSync(path.join(sa, ".next", "static", "chunks", "main.js")),
    "정적 청크가 standalone에 있어야 한다");
  assert.ok(!existsSync(path.join(sa, ".next", "static", "static")),
    ".next/static도 중첩되면 안 된다");

  rmSync(root, { recursive: true, force: true });
  console.log("stage_standalone_assets: 중첩 없이 복사 확인");
}
