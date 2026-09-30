/**
 * 원천 zip 해제. VWorld 법정구역 zip은 zip 안에 zip이 들어 있다.
 * Windows는 내장 tar.exe(bsdtar, zip 지원), 그 밖은 unzip을 쓴다. Git Bash의 GNU tar는 zip을 못 푼다.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";

function unzipTool(zip: string, dest: string): [string, string[]] {
  if (process.platform === "win32") return [join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"), ["-xf", zip, "-C", dest]];
  return ["unzip", ["-o", "-q", zip, "-d", dest]];
}

function* zipsUnder(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* zipsUnder(p);
    else if (extname(e.name).toLowerCase() === ".zip") yield p;
  }
}

export function extractAll(dir: string): string[] {
  const done: string[] = [];
  for (let changed = true; changed; ) {
    changed = false;
    for (const zip of [...zipsUnder(dir)]) {
      const dest = join(dirname(zip), basename(zip, extname(zip)));
      if (existsSync(join(dest, ".extracted"))) continue;
      mkdirSync(dest, { recursive: true });
      const [cmd, args] = unzipTool(zip, dest);
      const r = spawnSync(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
      if (r.status !== 0) throw new Error(`unzip failed for ${zip}: ${r.stderr?.toString() ?? r.error?.message}`);
      writeFileSync(join(dest, ".extracted"), new Date().toISOString());
      done.push(zip);
      changed = true; // 안쪽 zip이 새로 생겼을 수 있다
    }
  }
  return done;
}
