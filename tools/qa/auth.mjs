// QA 공통 로그인. 저장된 세션(tools/qa/.auth.json)이 살아 있으면 그대로 쓰고, 아니면 .env.local의 DEV_QA_* 계정으로 한 번만 로그인해 저장한다.
// 로그인은 IP당 15분에 5회로 제한되므로 저장된 세션이 통하면 절대 다시 로그인하지 않는다.
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const BASE = process.env.QA_BASE ?? "http://localhost:3200/site";
const AUTH = join(dirname(fileURLToPath(import.meta.url)), ".auth.json");

export async function qaContext(browser, { width = 1440, height = 900, ...opts } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, ...opts, ...(existsSync(AUTH) ? { storageState: AUTH } : {}) });
  if (!(await ctx.request.get(`${BASE}/api/auth/me`)).ok()) {
    const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^DEV_QA_/.test(l)).map((l) => [l.split("=")[0], l.slice(l.indexOf("=") + 1)]));
    const login = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: env.DEV_QA_USERNAME, password: env.DEV_QA_PASSWORD } });
    if (!login.ok()) throw new Error(`login ${login.status()}`);
    await ctx.storageState({ path: AUTH });
  }
  return ctx;
}
