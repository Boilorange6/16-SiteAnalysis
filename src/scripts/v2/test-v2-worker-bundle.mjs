import assert from "node:assert/strict";

const { default: nextConfig } = await import("../../../next.config.ts");

assert.equal(typeof nextConfig.webpack, "function", "Next webpack hook is required for server workers");

const serverConfig = {
  output: {
    path: "D:\\site-analysis\\.next\\server",
    publicPath: "/site/_next/",
  },
};
const serverResult = nextConfig.webpack(serverConfig, { isServer: true, dev: true, nextRuntime: "nodejs" });
assert.equal(serverResult, serverConfig);
assert.equal(serverResult.output.workerPublicPath, "./", "server workers must resolve from emitted server chunks");
assert.ok(nextConfig.outputFileTracingIncludes?.["/api/v2/analyses"]?.some((pattern) => pattern.includes(".next/server/chunks")));
assert.ok(nextConfig.outputFileTracingIncludes?.["/api/v2/analyses/[id]"]?.some((pattern) => pattern.includes(".next/server/chunks")));

const clientConfig = { output: { path: "D:\\site-analysis\\.next\\static", publicPath: "/site/_next/" } };
nextConfig.webpack(clientConfig, { isServer: false, dev: true, nextRuntime: "edge" });
assert.equal(clientConfig.output.workerPublicPath, undefined, "client worker public path stays browser-managed");

console.log("✓ v2 worker bundle config");

// Every worker spawned from engine code must use webpack's worker shape: the static node:worker_threads `Worker`
// with an inline `new URL(..., import.meta.url)`. Getting Worker via process.getBuiltinModule made Next dev turn the
// URL into a static asset path and Node threw 'The "filename" argument must be of type string or instance of URL'.
const { readFileSync } = await import("node:fs");
for (const file of ["sim/lbm2d.ts", "sim/sun-field.ts", "sim/svf-kernel.ts", "engine/jobs.ts", "engine/wind-api.ts"]) {
  const source = readFileSync(new URL(`../../lib/v2/${file}`, import.meta.url), "utf8");
  assert.match(source, /import \{[^}]*\bWorker\b[^}]*\} from "node:worker_threads"/, `${file} imports Worker statically`);
  assert.match(source, /new Worker\(\s*new URL\("\.\/[^"]+", import\.meta\.url\)/, `${file} passes an inline new URL to new Worker`);
  assert.doesNotMatch(source, /getBuiltinModule\("node:worker_threads"\)/, `${file} must not hide worker_threads from webpack`);
}
console.log("✓ v2 worker spawn shape");
