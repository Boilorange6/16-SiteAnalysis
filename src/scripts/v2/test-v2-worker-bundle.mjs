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
