import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  allowedPathForCode,
  allowedReason,
  isAllowedPath,
  normalizePath,
  parseArgs,
} from "./harness/tile-scope.mjs";

const scriptPath = fileURLToPath(new URL("./harness/tile-scope.mjs", import.meta.url));

assert.equal(normalizePath(".\\src\\lib\\v2\\ui\\map-layers.ts"), "src/lib/v2/ui/map-layers.ts");
assert.deepEqual(
  parseArgs([
    "A01",
    "--allow",
    ".\\src\\lib\\v2\\ui\\map-layers.ts",
    "--base",
    "v2-int",
    "--allow",
    "src/lib/v2/ui/map-layers.ts",
  ]),
  {
    codes: ["A01"],
    base: "v2-int",
    selfTest: false,
    allowPaths: ["src/lib/v2/ui/map-layers.ts"],
  },
  "--allow accepts repeated normalized exact paths without duplicates",
);
assert.throws(
  () => parseArgs(["A01", "--allow"]),
  /--allow requires a repository-relative path/,
  "--allow requires a value",
);
assert.throws(
  () => parseArgs(["A01", "--allow", "C:\\repo\\file.ts"]),
  /--allow requires a repository-relative path/,
  "--allow rejects absolute paths",
);

assert.equal(allowedPathForCode("src/lib/v2/tile/a01/view.ts", "A01"), true);
assert.equal(allowedPathForCode("src/lib/v2/ui/map-layers.ts", "A01"), false);
assert.equal(isAllowedPath("src/lib/v2/ui/map-layers.ts", ["A01"], []), false);
assert.equal(
  isAllowedPath(".\\src\\lib\\v2\\ui\\map-layers.ts", ["A01"], [".\\src\\lib\\v2\\ui\\map-layers.ts"]),
  true,
  "explicit allow uses the same path normalization as git output",
);
assert.equal(
  allowedReason("src/lib/v2/ui/map-layers.ts", ["A01"], [".\\src\\lib\\v2\\ui\\map-layers.ts"]),
  "explicit --allow",
);
assert.equal(
  isAllowedPath("src/lib/v2/engine/run.ts", ["A01"], ["src/lib/v2/ui/map-layers.ts"]),
  false,
  "an unlisted shared file remains outside",
);

const selfTest = spawnSync(process.execPath, [scriptPath, "--self-test"], { encoding: "utf8" });
assert.equal(selfTest.status, 0, selfTest.stderr);
assert.match(selfTest.stdout, /tile-scope: PASS \(--self-test\)/);

const selfTestWithAllow = spawnSync(
  process.execPath,
  [scriptPath, "--self-test", "--allow", "src/lib/v2/ui/map-layers.ts"],
  { encoding: "utf8" },
);
assert.equal(selfTestWithAllow.status, 2, "self-test keeps rejecting CLI operands");

console.log("✓ v2 tile-scope allow-list and legacy behavior");
