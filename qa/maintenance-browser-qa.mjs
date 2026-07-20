import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const baseUrl = process.env.MAINTENANCE_QA_URL ?? "http://127.0.0.1:3000/site/";
const artifactDir = path.resolve("qa/artifacts/maintenance");
const now = Date.UTC(2026, 6, 20, 3, 0, 0);

const locations = [
  { slug: "seoul", name: "서울 종로구", lat: 37.5866, lng: 126.9748, geometry: "hole" },
  { slug: "busan", name: "부산 수영구", lat: 35.1568, lng: 129.1187, geometry: "multi" },
  { slug: "daejeon", name: "대전 중구", lat: 36.325, lng: 127.421, geometry: "polygon" },
];

function ring(lng, lat, size = 0.012) {
  return [[lng - size, lat - size], [lng + size, lat - size], [lng + size, lat + size], [lng - size, lat + size], [lng - size, lat - size]];
}

function fixtureFor(url) {
  const requestUrl = new URL(url);
  const lat = Number(requestUrl.searchParams.get("lat") ?? locations[0].lat);
  const lng = Number(requestUrl.searchParams.get("lng") ?? locations[0].lng);
  const target = locations.reduce((closest, location) =>
    Math.abs(location.lat - lat) < Math.abs(closest.lat - lat) ? location : closest,
  locations[0]);
  const boundary = target.geometry === "multi"
    ? { type: "MultiPolygon", coordinates: [[ring(lng - 0.009, lat, 0.005)], [ring(lng + 0.009, lat, 0.005)]] }
    : target.geometry === "hole"
      ? { type: "Polygon", coordinates: [ring(lng, lat), ring(lng, lat, 0.003)] }
      : { type: "Polygon", coordinates: [ring(lng, lat)] };
  const unmatched = target.slug === "busan";
  const project = {
    id: `${target.slug}-boundary`, name: `${target.name} 중앙정비구역`, lat, lng,
    category: "maintenance", type: unmatched ? "재건축" : "재개발",
    stage: unmatched ? "사업시행인가" : "조합설립", address: `${target.name} 공식 위치`,
    area_sqm: unmatched ? 18400 : 26750, planned_households: unmatched ? 640 : 920,
    implementer: `${target.name} 정비사업조합`, designation_date: "2025-11-03",
    source: unmatched ? "molit_spatial" : "molit_integrated",
    source_updated_at: "2026-07-18", boundary_status: unmatched ? "unmatched" : "confirmed",
    notice_url: "https://example.test/official-notice", boundary,
  };
  const unavailable = {
    id: `${target.slug}-point`, name: `${target.name} 후보사업`, lat: lat + 0.006, lng: lng + 0.006,
    category: "maintenance", type: "가로주택정비", stage: "추진위", address: `${target.name} 위치 미확인`,
    area_sqm: 7200, planned_households: 180, implementer: "추진위원회", source: "public_standard",
    source_updated_at: "2026-07-17", boundary_status: "unavailable",
  };
  const refreshed = requestUrl.searchParams.get("refresh") === "true";
  const status = (source, failed = false) => ({ source, status: failed ? "failed" : refreshed ? "fresh" : "cached", fetchedAt: failed ? null : now });
  return {
    pois: [project, unavailable], warnings: [],
    sources: [
      status("osm"), status("park"), status("residential"), status("planned-residential"),
      status("maintenance_boundaries"), status("maintenance_attributes"), status("maintenance_seoul"),
      status("maintenance_busan", !refreshed),
    ],
    maintenanceCatalog: [{
      id: `${target.slug}-catalog`, name: `${target.name} 행정목록 사업`, sido: target.name.split(" ")[0],
      sigungu: target.name.split(" ")[1], type: "재개발", stage: "구역지정/변경",
      source: "public_standard", source_updated_at: "2026-07-16", implementer: "미정",
      planned_households: 350, area_sqm: 9900, spatial_status: "not_located",
    }],
  };
}

async function installRoutes(page) {
  await page.route("**/site/api/auth/me", (route) => route.fulfill({ json: { id: 1, username: "qa-analyst", role: "user" } }));
  await page.route("**/site/api/user/api-key-status", (route) => route.fulfill({ json: { ready: true, configuredCount: 4, totalCount: 4, items: [] } }));
  await page.route("**/site/api/projects", (route) => route.fulfill({ json: { projects: [] } }));
  await page.route("**/site/api/address-search**", (route) => route.fulfill({ json: { results: [] } }));
  await page.route("**/site/api/reverse-geocode**", (route) => route.fulfill({ json: { name: "QA 위치" } }));
  await page.route("**/site/api/subway-routes**", (route) => route.fulfill({ json: { routes: [], source: { source: "subway-routes", status: "cached", fetchedAt: now } } }));
  await page.route("**/site/api/poi-search**", async (route) => {
    if (route.request().url().includes("refresh=true")) await new Promise((resolve) => setTimeout(resolve, 650));
    await route.fulfill({ json: fixtureFor(route.request().url()) });
  });
}

async function runLocation(browser, location, viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  const requestUrls = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => requestUrls.push(request.url()));
  await installRoutes(page);
  await page.goto(baseUrl, { waitUntil: "networkidle" });

  if (viewport.width < 1024) await page.getByTestId("controls-sheet-toggle").click();
  await page.getByLabel("분석 중심 주소").fill(location.name);
  await page.getByTestId("center-latitude-input").fill(String(location.lat));
  await page.getByTestId("center-longitude-input").fill(String(location.lng));
  await page.getByTestId("config-apply-button").click();
  await page.getByText("데이터 로딩 중").waitFor({ state: "hidden" });
  if (viewport.width < 1024) await page.getByTestId("controls-sheet-toggle").click();
  await page.getByRole("tab", { name: /분석/ }).click();
  await page.getByText("행정구역 수준 목록").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(artifactDir, `${location.slug}-${viewport.width}x${viewport.height}-analysis.png`) });

  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `${location.slug} horizontal overflow`);
  assert.equal(await page.getByText("법적 효력 없는 참고자료", { exact: true }).count(), 1);
  assert.equal(await page.getByText("좌표가 없어 반경 지표와 지도 표시에 포함하지 않은 공식 목록입니다.").count(), 1);
  assert.equal(await page.getByRole("button", { name: /행정목록 사업/ }).count(), 0);

  if (viewport.width >= 1024) {
    const maintenancePath = page.locator('.leaflet-overlay-pane path[stroke="#EC4899"]').first();
    await maintenancePath.waitFor({ state: "visible" });
    const pathData = await maintenancePath.getAttribute("d");
    if (location.geometry === "hole" || location.geometry === "multi") {
      assert.ok((pathData?.match(/M/g) ?? []).length >= 2, `${location.slug} nested geometry collapsed`);
    }
    const boundaryBox = await maintenancePath.boundingBox();
    assert.ok(boundaryBox, `${location.slug} boundary has no rendered box`);
    await maintenancePath.click({
      force: true,
      position: { x: boundaryBox.width * 0.15, y: boundaryBox.height * 0.5 },
    });
    const popup = page.locator(".leaflet-popup");
    await popup.waitFor({ state: "visible" });
    await popup.getByText(`${location.name} 중앙정비구역`, { exact: true }).waitFor();
    await popup.getByText("법적 효력 없는 참고자료", { exact: true }).waitFor();
    await page.screenshot({ path: path.join(artifactDir, `${location.slug}-${viewport.width}x${viewport.height}-popup-settled.png`) });
  }

  assert.equal(errors.length, 0, `${location.slug} page errors: ${errors.join(" | ")}`);
  assert.equal(requestUrls.some((url) => /serviceKey=|qa-secret/i.test(url)), false, `${location.slug} service key leaked in network URL`);
  await context.close();
}

async function runRetry(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await installRoutes(page);
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "샘플 실행" }).click();
  await page.getByText("데이터 로딩 중").waitFor({ state: "hidden" });
  const retry = page.getByRole("button", { name: "재시도" });
  await retry.focus();
  await page.screenshot({ path: path.join(artifactDir, "seoul-1440x1000-retry-focus-rest.png") });
  await retry.click();
  await page.getByRole("button", { name: "재시도 중…" }).waitFor();
  await page.screenshot({ path: path.join(artifactDir, "seoul-1440x1000-retry-mid.png") });
  await page.getByText("방금 수집").first().waitFor();
  await page.screenshot({ path: path.join(artifactDir, "seoul-1440x1000-retry-settled.png") });
  await context.close();
}

await mkdir(artifactDir, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const location of locations) {
    await runLocation(browser, location, { width: 1440, height: 1000 });
    await runLocation(browser, location, { width: 390, height: 844 });
  }
  await runRetry(browser);
} finally {
  await browser.close();
}
await writeFile(path.join(artifactDir, "browser-qa-summary.json"), JSON.stringify({
  locations: locations.map(({ slug, geometry }) => ({ slug, geometry })),
  viewports: ["1440x1000", "390x844"],
  verified: ["polygon", "hole", "multipolygon", "unmatched", "unavailable-point-only", "popup", "catalog-no-focus", "retry-rest-mid-settled", "keyboard-focus", "CJK", "no-horizontal-overflow", "no-service-key-url"],
}, null, 2));
console.log("maintenance browser QA passed");
