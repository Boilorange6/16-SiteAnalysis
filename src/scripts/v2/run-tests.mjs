// test-v2-*.mjs 를 이름순으로 모두 실행한다. 새 테스트는 파일만 추가하면 된다(package.json 병합 충돌 방지).
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(dir).filter((f) => /^test-v2-.*\.mjs$/.test(f)).sort();
for (const f of files) {
  const r = spawnSync("npx", ["tsx", join(dir, f)], { stdio: "inherit", shell: true });
  if (r.status !== 0) {
    console.error(`FAILED: ${f}`);
    process.exit(r.status ?? 1);
  }
}
console.log(`v2 tests: ${files.length} files passed`);
