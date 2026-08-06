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

// ── standalone은 공유 .env를 링크해야 한다 ───────────────────────────────────
// Next standalone 빌드는 릴리스의 .env를 "복사"해 자기 디렉터리에 넣는다.
// 릴리스의 .env가 공유 .env로의 심볼릭 링크여도 복사본은 값이 굳는다.
// 그래서 운영 .env에 키를 넣고 재시작해도 반영되지 않았다
// (2026-08-05 SEOUL_OPEN_API_KEY: 파일엔 있는데 앱은 "not configured").
{
  const root = mkdtempSync(path.join(tmpdir(), "stage-env-")).replaceAll("\\", "/");
  const shared = `${root}/shared`;
  const release = `${root}/release`;
  mkdirSync(shared, { recursive: true });
  writeFileSync(`${shared}/.env`, "SEOUL_OPEN_API_KEY=live-value\n");

  const standalone = `${release}/.next/standalone`;
  mkdirSync(standalone, { recursive: true });
  writeFileSync(`${standalone}/.env`, "SEOUL_OPEN_API_KEY=\n"); // 빌드가 남긴 굳은 사본

  runLib(`stage_standalone_assets '${release}' '${shared}'`);

  const envPath = `${standalone}/.env`;
  assert.ok(lstatSync(envPath).isSymbolicLink(), "standalone/.env는 심볼릭 링크여야 한다");
  assert.equal(
    readFileSync(envPath, "utf8").trim(),
    "SEOUL_OPEN_API_KEY=live-value",
    "배포 시점 사본이 아니라 공유 .env의 현재 값을 읽어야 한다",
  );

  // 공유 .env를 고치면 재배포 없이 반영된다
  writeFileSync(`${shared}/.env`, "SEOUL_OPEN_API_KEY=rotated\n");
  assert.equal(readFileSync(envPath, "utf8").trim(), "SEOUL_OPEN_API_KEY=rotated");

  rmSync(root, { recursive: true, force: true });
  console.log("stage_standalone_assets: 공유 .env 링크 확인");
}

// ── 정비사업 산출물은 릴리스가 아니라 공유 경로에 있어야 한다 ────────────────
// 크론이 분기마다 seoul-cleanup을 다시 만드는데, 릴리스마다 사본이 따로 있으면
// 크론의 갱신이 앱에 영원히 닿지 않는다. 실제로 운영에서 공유 루트는 7/30,
// 앱이 읽는 릴리스는 8/5로 갈라져 있었다. .env와 같은 이유로 링크한다.
{
  const root = mkdtempSync(path.join(tmpdir(), "shared-artifacts-")).replaceAll("\\", "/");
  const shared = `${root}/shared`;
  const release = `${root}/release`;
  mkdirSync(`${shared}/data/maintenance/processed`, { recursive: true });
  writeFileSync(`${shared}/data/maintenance/processed/seoul-cleanup.json`, '{"records":[1,2,3]}');
  mkdirSync(`${release}/.next/standalone`, { recursive: true });

  runLib(`link_shared_artifacts '${release}' '${shared}'`);

  const linked = `${release}/data/maintenance/processed`;
  assert.ok(lstatSync(linked).isSymbolicLink(), "릴리스의 산출물 경로는 링크여야 한다");
  assert.equal(
    readFileSync(`${linked}/seoul-cleanup.json`, "utf8"),
    '{"records":[1,2,3]}',
    "공유 산출물을 읽어야 한다",
  );

  // 크론이 공유본을 갱신하면 재배포 없이 앱에 보인다
  writeFileSync(`${shared}/data/maintenance/processed/seoul-cleanup.json`, '{"records":[1,2,3,4]}');
  assert.equal(readFileSync(`${linked}/seoul-cleanup.json`, "utf8"), '{"records":[1,2,3,4]}');

  rmSync(root, { recursive: true, force: true });
  console.log("link_shared_artifacts: 공유 산출물 링크 확인");
}

// 공유 경로가 비어 있어도 배포는 실패하지 않는다 (신규 서버)
{
  const root = mkdtempSync(path.join(tmpdir(), "shared-empty-")).replaceAll("\\", "/");
  mkdirSync(`${root}/shared`, { recursive: true });
  mkdirSync(`${root}/release`, { recursive: true });
  runLib(`link_shared_artifacts '${root}/release' '${root}/shared'`);
  assert.ok(existsSync(`${root}/shared/data/maintenance/processed`), "공유 디렉터리를 만들어 둔다");
  assert.ok(lstatSync(`${root}/release/data/maintenance/processed`).isSymbolicLink());
  rmSync(root, { recursive: true, force: true });
  console.log("link_shared_artifacts: 빈 공유 경로도 안전 확인");
}

// ── 배포 전 게이트: 무엇을 배포했는지 나중에 알 수 있어야 한다 ────────────────
// deploy.sh는 작업 트리를 통째로 tar한다. 커밋되지 않았거나 푸시되지 않은 상태로
// 배포하면 릴리스와 커밋의 연결이 끊긴다 — "이 릴리스에 뭐가 들었나"에 답할 수 없다.
// 실제로 2026-08-05에 운영보다 뒤처진 브랜치를 배포할 뻔한 것을 사람이 겨우 잡았다.
{
  const mkRepo = (label) => {
    const dir = mkdtempSync(path.join(tmpdir(), `gate-${label}-`)).replaceAll("\\", "/");
    const git = (cmd) => execFileSync("bash", ["-c", `cd '${dir}' && ${cmd}`], { encoding: "utf8" });
    git("git init -q -b main && git config user.email t@t && git config user.name t");
    writeFileSync(`${dir}/f.txt`, "v1");
    git("git add -A && git commit -qm first");
    return { dir, git };
  };
  // 원격을 흉내낸다: bare 저장소를 만들고 push
  const withRemote = (repo) => {
    const remote = `${repo.dir}-remote.git`;
    execFileSync("bash", ["-c", `git init -q --bare '${remote}'`]);
    repo.git(`git remote add origin '${remote}' && git push -q -u origin main`);
    return remote;
  };

  // 깨끗하고 푸시된 저장소는 통과하고, 커밋 SHA를 알려준다
  {
    const repo = mkRepo("ok");
    withRemote(repo);
    const sha = runLib(`assert_deployable '${repo.dir}'`);
    assert.match(sha, /^[0-9a-f]{40}$/, `커밋 SHA를 출력해야 한다: ${sha}`);
    const head = repo.git("git rev-parse HEAD").trim();
    assert.equal(sha, head, "HEAD와 같아야 한다");
    console.log("assert_deployable: 정상 저장소 통과 확인");
  }

  // 추적 파일이 수정돼 있으면 거부 — 커밋 안 된 변경이 운영에 실려 간다
  {
    const repo = mkRepo("dirty");
    withRemote(repo);
    writeFileSync(`${repo.dir}/f.txt`, "미커밋 변경");
    assert.throws(
      () => runLib(`assert_deployable '${repo.dir}'`),
      (err) => /커밋되지 않은/.test(String(err.stderr)),
      "더러운 트리는 거부해야 한다",
    );
    console.log("assert_deployable: 미커밋 변경 거부 확인");
  }

  // 추적되지 않는 파일은 거부하지 않는다 — tar가 담기는 하지만 스크린샷·임시 zip까지
  // 막으면 게이트가 늘 걸려 결국 우회된다. 걸러야 할 것은 .gitignore가 할 일이다.
  {
    const repo = mkRepo("untracked");
    withRemote(repo);
    writeFileSync(`${repo.dir}/screenshot.png`, "x");
    assert.match(runLib(`assert_deployable '${repo.dir}'`), /^[0-9a-f]{40}$/);
    console.log("assert_deployable: 미추적 파일은 통과 확인");
  }

  // 푸시되지 않은 커밋은 거부 — 원격에 없으면 그 릴리스는 재현할 수 없다
  {
    const repo = mkRepo("unpushed");
    withRemote(repo);
    writeFileSync(`${repo.dir}/f.txt`, "v2");
    repo.git("git add -A && git commit -qm second");
    assert.throws(
      () => runLib(`assert_deployable '${repo.dir}'`),
      (err) => /푸시되지 않은/.test(String(err.stderr)),
      "푸시 안 된 커밋은 거부해야 한다",
    );
    // 푸시하면 통과한다
    repo.git("git push -q origin main");
    assert.match(runLib(`assert_deployable '${repo.dir}'`), /^[0-9a-f]{40}$/);
    console.log("assert_deployable: 미푸시 커밋 거부 확인");
  }

  // 원격이 아예 없으면 거부
  {
    const repo = mkRepo("noremote");
    assert.throws(
      () => runLib(`assert_deployable '${repo.dir}'`),
      (err) => /푸시되지 않은|원격/.test(String(err.stderr)),
    );
    console.log("assert_deployable: 원격 없음 거부 확인");
  }

  // 비상 우회구가 있어야 한다 — 없으면 급할 때 게이트를 주석 처리하고,
  // 그렇게 사라진 게이트는 돌아오지 않는다. 대신 통과 사실이 눈에 띄게 남는다.
  {
    const repo = mkRepo("override");
    withRemote(repo);
    writeFileSync(`${repo.dir}/f.txt`, "미커밋");
    const out = runLib(`ALLOW_DIRTY_DEPLOY=1 assert_deployable '${repo.dir}' 2>&1`);
    assert.match(out, /경고/, "우회 시 경고가 보여야 한다");
    console.log("assert_deployable: 비상 우회 확인");
  }
}

// ── 패키징: 배포되는 것은 커밋된 것과 같아야 한다 ────────────────────────────
// 예전에는 작업 트리를 tar했다. 그래서 미추적 파일이 그대로 서버로 갔다 —
// 실제로 API 키가 든 .env.local.bak-*가 제외 목록(.env.local 정확히 일치)을
// 빠져나가 배포될 뻔했다. 제외 목록을 늘리는 건 두더지잡기라서, 아예 HEAD를
// 아카이브한다. "배포된 것 = 커밋된 것"이 정의로 성립한다.
{
  const dir = mkdtempSync(path.join(tmpdir(), "pack-")).replaceAll("\\", "/");
  const git = (cmd) => execFileSync("bash", ["-c", `cd '${dir}' && ${cmd}`], { encoding: "utf8" });
  git("git init -q -b main && git config user.email t@t && git config user.name t");
  mkdirSync(`${dir}/src`, { recursive: true });
  writeFileSync(`${dir}/src/app.js`, "커밋된 코드");
  writeFileSync(`${dir}/.gitattributes`, "docs/ export-ignore\n");
  mkdirSync(`${dir}/docs`, { recursive: true });
  writeFileSync(`${dir}/docs/note.md`, "서버에 필요 없는 문서");
  git("git add -A && git commit -qm first");

  // 배포 직전의 작업 트리 오염을 재현한다
  writeFileSync(`${dir}/.env.local.bak-20260805`, "NAVER_CLIENT_SECRET=진짜비밀");
  writeFileSync(`${dir}/screenshot.png`, "x".repeat(1000));
  writeFileSync(`${dir}/src/app.js`, "아직 커밋 안 한 변경");

  const outDir = mkdtempSync(path.join(tmpdir(), "pack-out-")).replaceAll("\\", "/");
  const out = `${outDir}/release.tar.gz`;
  runLib(`package_release '${dir}' '${out}'`);
  // MSYS tar는 -f 인자의 `C:`를 원격 호스트로 해석한다("Cannot connect to C:").
  // 아카이브만 상대경로로 넘기면 된다.
  const listed = execFileSync("bash", ["-c", `cd '${outDir}' && tar tzf release.tar.gz`], { encoding: "utf8" });

  assert.ok(/src\/app\.js/.test(listed), "커밋된 파일은 담겨야 한다");
  assert.doesNotMatch(listed, /\.env\.local\.bak/, "★ 비밀키가 든 미추적 파일이 담기면 안 된다");
  assert.doesNotMatch(listed, /screenshot\.png/, "미추적 파일은 담기지 않는다");
  assert.doesNotMatch(listed, /docs\//, "export-ignore된 경로는 빠진다");

  // 담긴 내용은 작업 트리가 아니라 HEAD의 것이어야 한다
  const extract = mkdtempSync(path.join(tmpdir(), "unpack-")).replaceAll("\\", "/");
  execFileSync("bash", ["-c", `cd '${outDir}' && tar xzf release.tar.gz -C '${extract}'`]);
  assert.equal(
    readFileSync(`${extract}/src/app.js`, "utf8"),
    "커밋된 코드",
    "★ 작업 트리가 아니라 커밋된 내용이 배포돼야 한다",
  );

  rmSync(dir, { recursive: true, force: true });
  rmSync(extract, { recursive: true, force: true });
  rmSync(outDir, { recursive: true, force: true });
  console.log("package_release: 커밋된 트리만 패키징 확인");
}
