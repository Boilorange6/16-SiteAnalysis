import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const baseUrl = process.env.SITE_ANALYSIS_URL || "http://127.0.0.1:3001/site";
const username = `qa_${Date.now()}`;
const password = "pass1234";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });

try {
  await page.goto(`${baseUrl}/signup`, { waitUntil: "networkidle" });
  await page.getByLabel("사용자명").fill(username);
  await page.getByLabel("비밀번호", { exact: true }).fill(password);
  await page.getByLabel("비밀번호 확인").fill(password);
  await page.getByRole("button", { name: "회원가입" }).click();

  await page.waitForURL((url) => url.href === baseUrl || url.href === `${baseUrl}/`, { timeout: 15000 });
  await page.getByText("작업 상태").waitFor({ timeout: 15000 });

  const requiredTexts = [
    "API 연결",
    "저장된 분석",
    "입지 점수",
    "인사이트 레이어",
    "수동 POI 보정",
    "반경 내 데이터 레이어",
  ];

  for (const text of requiredTexts) {
    await page.getByText(text).first().waitFor({ timeout: 5000 });
  }

  await page.getByLabel("수동 POI 이름").fill("QA 수동 예정지");
  await page.getByRole("button", { name: "수동 POI 추가" }).click();
  await page.locator('input[value="QA 수동 예정지"]').waitFor({ timeout: 5000 });

  mkdirSync("output/playwright", { recursive: true });
  await page.screenshot({ path: "output/playwright/enhancements-browser-smoke.png", fullPage: true });
  console.log("enhancement browser smoke passed");
} finally {
  await browser.close();
}
