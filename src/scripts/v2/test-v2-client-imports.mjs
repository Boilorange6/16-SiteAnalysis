// "use client" 화면 코드가 상대 경로 import를 따라가다 node: 내장 모듈에 닿으면 Next 화면 번들이 깨진다
// (2026-10-06 lbm2d.ts의 node:worker_threads가 tile-card → wind-upload로 새어 /v2가 500).
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const entries = [join(root, "app/v2/page.tsx"), ...readdirSync(join(root, "components/v2")).map((f) => join(root, "components/v2", f))]
  .filter((f) => /\.tsx?$/.test(f) && readFileSync(f, "utf8").includes('"use client"'));
const IMPORT = /(?:^|\n)\s*(?:import|export)\s+(?!type\b)[^;'"]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
const resolveLocal = (from, spec) => {
  const base = spec.startsWith("@/") ? join(root, spec.slice(2)) : resolve(dirname(from), spec);
  return [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")].find((p) => existsSync(p) && /\.tsx?$/.test(p));
};

const seen = new Map(); // file -> importer chain
const queue = entries.map((f) => [f, [f]]);
const leaks = [];
while (queue.length) {
  const [file, chain] = queue.shift();
  if (seen.has(file)) continue;
  seen.set(file, chain);
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
assert.deepEqual(leaks, [], `client bundle reaches node: builtins:\n${leaks.join("\n")}`);
console.log(`✓ v2 client imports (${entries.length} entries, ${seen.size} modules, no node: builtins)`);
