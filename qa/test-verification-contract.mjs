/**
 * 검증 계약 테스트.
 * "테스트가 있는데 아무도 안 돌린다"는 상태를 구조적으로 막는다.
 * - 기본 test 스크립트가 정비사업/실거래 계약 테스트를 포함하는가
 * - CI가 lint·test·build를 모두 도는가
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

// ── 기본 `npm test`가 유지보수 계약 테스트를 포함해야 한다 ────────────────
{
  const testScript = pkg.scripts?.test ?? "";
  assert.ok(testScript.includes("test:maintenance"),
    "npm test는 test:maintenance를 포함해야 한다 — 그렇지 않으면 정비사업·실거래 계약 회귀가 잡히지 않는다");
}

// ── 릴리스 검증에 쓰는 스크립트가 모두 존재해야 한다 ──────────────────────
for (const name of ["lint", "test", "test:maintenance", "build"]) {
  assert.ok(typeof pkg.scripts?.[name] === "string" && pkg.scripts[name].length > 0,
    `package.json에 ${name} 스크립트가 있어야 한다`);
}

// ── CI 워크플로가 검증 명령을 모두 실행해야 한다 ──────────────────────────
{
  const workflow = path.join(root, ".github", "workflows", "ci.yml");
  assert.ok(existsSync(workflow), ".github/workflows/ci.yml이 있어야 한다");
  const content = readFileSync(workflow, "utf8");
  // CI는 결정론적 검증만 돌린다. `npm test`에 포함된 청와대 산출물 QA는 생성된
  // PPT/PDF 아티팩트를 요구해 CI 환경에서 항상 실패한다(기존 문제, 45ea9ac에서도 재현).
  for (const command of ["npm run lint", "npm run test:maintenance", "npm run build"]) {
    assert.ok(content.includes(command), `CI가 ${command}를 실행해야 한다`);
  }
  assert.ok(/on:\s*[\s\S]*push/.test(content), "CI는 push에서 실행되어야 한다");
  assert.ok(/pull_request/.test(content), "CI는 pull_request에서도 실행되어야 한다");
}

// ── 새 단위 테스트가 test:maintenance 체인에 등록돼 있어야 한다 ───────────
{
  const chain = pkg.scripts["test:maintenance"];
  for (const required of [
    "test-seoul-cleanup", "test-building-ledger", "test-rtms-trades",
    "test-completion-crosscheck", "test-release-manager", "test-verification-contract",
  ]) {
    assert.ok(chain.includes(required), `${required}가 test:maintenance 체인에 있어야 한다`);
  }
}

console.log("test-verification-contract: all assertions passed");
