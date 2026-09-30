/**
 * data-build --wait-lock: 잠금 파일이 풀릴 때까지 30초 간격으로 확인하고, 5분에 한 번만 로그한다.
 * 가짜 시계로 실제로 기다리지 않는다.
 */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { waitForDataDirLock } = await import("../../lib/v2/data/manifest.ts");

const MIN = 60_000;
function fakeClock() {
  let t = 0;
  const sleeps = [];
  return { now: () => t, sleeps, sleep: async (ms) => { sleeps.push(ms); t += ms; } };
}

const dir = mkdtempSync(join(tmpdir(), "v2-waitlock-"));
const lock = join(dir, ".lock");

// 잠금 없음 → 바로 true, 기다리지 않음
{
  const c = fakeClock();
  assert.equal(await waitForDataDirLock(dir, { timeoutMs: 10 * MIN, ...c }), true);
  assert.equal(c.sleeps.length, 0);
}

// 12분 뒤 풀림 → 30초 간격 24번 확인, 로그는 0·5·10분에 3번
{
  writeFileSync(lock, "1 x\n");
  const c = fakeClock();
  const logs = [];
  const sleep = async (ms) => { await c.sleep(ms); if (c.now() >= 12 * MIN) rmSync(lock, { force: true }); };
  assert.equal(await waitForDataDirLock(dir, { timeoutMs: 60 * MIN, log: (m) => logs.push(m), now: c.now, sleep }), true);
  assert.ok(c.sleeps.every((ms) => ms === 30_000));
  assert.equal(c.sleeps.length, 24);
  assert.equal(logs.length, 3, logs.join("\n"));
}

// 시간 초과 → false, 마지막 sleep은 남은 시간만큼
{
  writeFileSync(lock, "1 x\n");
  const c = fakeClock();
  assert.equal(await waitForDataDirLock(dir, { timeoutMs: 100_000, log: () => {}, ...c }), false);
  assert.deepEqual(c.sleeps, [30_000, 30_000, 30_000, 10_000]);
  rmSync(lock, { force: true });
}
console.log("wait-lock ok");
