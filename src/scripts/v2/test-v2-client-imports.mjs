// "use client" 화면 코드가 상대 경로 import를 따라가다 node: 내장 모듈에 닿으면 Next 화면 번들이 깨진다
// (2026-10-06 lbm2d.ts의 node:worker_threads가 tile-card → wind-upload로 새어 /v2가 500).
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const entries = [join(root, "app/v2/page.tsx"), ...readdirSync(join(root, "components/v2")).map((f) => join(root, "components/v2", f))]
  .filter((f) => /\.tsx?$/.test(f) && readFileSync(f, "utf8").includes('"use client"'));
// Client entries may consume tile view/component modules, but never server-side computation.
// Keep absorbed engine paths explicit: these are the host-owned files listed by the refactor plan.
const ABSORBED_ENGINE_FILES = new Set([
  "lib/v2/tile/a02/d26.ts",
  "lib/v2/tile/a04/d09.ts",
  "lib/v2/tile/a07/d25.ts",
  "lib/v2/tile/a09/d23.ts",
  "lib/v2/tile/a10/d24.ts",
  "lib/v2/tile/a11/d27.ts",
  "lib/v2/tile/a12/d08.ts",
  "lib/v2/tile/d05/d06.ts",
  "lib/v2/tile/d05/d07.ts",
  "lib/v2/tile/d19/d20.ts",
  "lib/v2/tile/s02/d21.ts",
]);
const mass3dSource = readFileSync(join(root, "components/v2/mass-3d.tsx"), "utf8");
const mass3dRuntimeSource = readFileSync(join(root, "lib/v2/ui/mass-3d-runtime.ts"), "utf8");
assert.match(mass3dSource, /^"use client";/, "3D 컴포넌트는 client-only여야 한다");
assert.doesNotMatch(mass3dSource, /from\s+["']three["']/, "three는 초기 컴포넌트 모듈에서 정적으로 가져오지 않는다");
assert.match(mass3dSource, /import\(["']@\/lib\/v2\/ui\/mass-3d-runtime["']\)/, "3D 런타임은 동적으로 가져온다");
assert.match(mass3dRuntimeSource, /import\(["']three["']\)/, "three 런타임은 동적 import로 분리한다");
const IMPORT = /(?:^|\n)\s*(?:import|export)\s+(?!type\b)[^;'"]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
const resolveLocal = (from, spec) => {
  const base = spec.startsWith("@/") ? join(root, spec.slice(2)) : resolve(dirname(from), spec);
  return [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")].find((p) => existsSync(p) && /\.tsx?$/.test(p));
};

const seen = new Map(); // file -> importer chain
const queue = entries.map((f) => [f, [f]]);
const leaks = [];
// Pure modules under engine/ that the client legitimately shares (type-only imports, no node:, no data access).
// a05-filter: A05-owned filter/re-aggregation used by both the engine and the board UI (plan ownership table keeps it in place).
const CLIENT_SAFE_ENGINE_FILES = new Set(["lib/v2/engine/a05-filter.ts"]);
const serverModules = [];
const relativeToRoot = (file) => file.slice(root.length + 1).replaceAll("\\", "/");
const serverReason = (file) => {
  const relative = relativeToRoot(file);
  if (relative.startsWith("lib/v2/engine/") && !CLIENT_SAFE_ENGINE_FILES.has(relative)) return "shared engine module";
  if (/^lib\/v2\/tile\/[^/]+\/engine\.ts$/.test(relative)) return "tile engine module";
  if (ABSORBED_ENGINE_FILES.has(relative)) return "absorbed tile engine module";
  return null;
};
while (queue.length) {
  const [file, chain] = queue.shift();
  if (seen.has(file)) continue;
  seen.set(file, chain);
  const reason = serverReason(file);
  if (reason) serverModules.push(`${reason}: ${relativeToRoot(file)} ← ${chain.map(relativeToRoot).join(" ← ")}`);
  for (const m of readFileSync(file, "utf8").matchAll(IMPORT)) {
    const spec = m[1] ?? m[2];
    if (spec.startsWith("node:")) leaks.push(`${spec} ← ${chain.map((p) => p.slice(root.length + 1)).join(" ← ")}`);
    else if (spec.startsWith(".") || spec.startsWith("@/")) {
      const next = resolveLocal(file, spec);
      if (next) queue.push([next, [next, ...chain]]);
    }
  }
}
assert.ok(entries.length >= 5, `client entries found: ${entries.length}`);
assert.deepEqual(serverModules, [], `client bundle reaches server-side v2 engine modules:\n${serverModules.join("\n")}`);
assert.deepEqual(leaks, [], `client bundle reaches node: builtins:\n${leaks.join("\n")}`);
console.log(`✓ v2 client imports (${entries.length} entries, ${seen.size} modules, no node: builtins or server engines)`);
