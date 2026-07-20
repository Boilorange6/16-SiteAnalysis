import assert from "node:assert/strict";

const forbiddenSentinel = "qa-secret-sentinel-do-not-leak";
const keyLikeSecret = /(?:service[_-]?key|api[_-]?key|data_go_kr_service_key|seoul_open_data_key)\s*[:=]\s*["']?[A-Za-z0-9_-]{16,}/i;

export function installBodyAudit(page) {
  const bodyReads = [];
  page.on("response", (response) => {
    const resourceType = response.request().resourceType();
    if (!["document", "fetch", "xhr", "script"].includes(resourceType)) return;
    if (response.status() >= 300 && response.status() < 400) return;
    bodyReads.push(response.text().then((body) => ({ body, resourceType, url: response.url() })));
  });
  return async () => {
    const bodies = await Promise.all(bodyReads);
    const pageOrigin = new URL(page.url()).origin;
    assert.ok(
      bodies.some((entry) => entry.resourceType === "script" && new URL(entry.url).origin === pageOrigin && entry.body.length > 0),
      "non-empty same-origin JS body was not inspected",
    );
    assert.ok(
      bodies.some((entry) => entry.url.includes("/api/poi-search") && entry.body.length > 0),
      "non-empty POI response body was not inspected",
    );
    for (const entry of bodies) {
      assert.equal(entry.body.includes(forbiddenSentinel), false, `sentinel leaked in ${entry.url}`);
      assert.equal(keyLikeSecret.test(entry.body), false, `key-like secret leaked in ${entry.url}`);
    }
    return bodies.length;
  };
}

export async function exerciseMobileDialog(page) {
  const toggle = page.getByTestId("controls-sheet-toggle");
  await toggle.click();
  const dialog = page.getByRole("dialog", { name: "Site Analysis" });
  await dialog.waitFor();
  assert.equal(await page.locator("main").getAttribute("inert"), "");
  await page.waitForFunction(() => document.activeElement?.getAttribute("data-testid") === "controls-sheet-toggle");
  await page.keyboard.press("Shift+Tab");
  assert.equal(await dialog.evaluate((element) => element.contains(document.activeElement)), true, "focus escaped mobile dialog");

  await page.setViewportSize({ width: 1440, height: 844 });
  await page.waitForFunction(() => document.querySelector("main")?.getAttribute("inert") === null);
  assert.equal(await page.locator("main").getAttribute("aria-hidden"), null);
  assert.equal(await page.locator("aside").getAttribute("role"), null);
  assert.equal(await page.locator("aside").getAttribute("aria-modal"), null);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("dialog", { name: "Site Analysis" }).waitFor();
  assert.equal(await page.locator("main").getAttribute("inert"), "");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "Site Analysis" }).waitFor({ state: "detached" });
  assert.equal(await page.locator("main").getAttribute("inert"), null);
  assert.equal(await toggle.evaluate((element) => element === document.activeElement), true, "focus was not restored to sheet trigger");
  await toggle.click();
  await page.getByRole("dialog", { name: "Site Analysis" }).waitFor();
}

export async function waitForPopupSettled(popup) {
  await popup.evaluate(async (element) => {
    let previous = "";
    let stableFrames = 0;
    for (let frame = 0; frame < 90; frame += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const rect = element.getBoundingClientRect();
      const current = `${rect.x.toFixed(2)}:${rect.y.toFixed(2)}:${rect.width.toFixed(2)}:${rect.height.toFixed(2)}`;
      stableFrames = getComputedStyle(element).opacity === "1" && current === previous ? stableFrames + 1 : 0;
      if (stableFrames >= 4) return;
      previous = current;
    }
    throw new Error("Leaflet popup did not reach opacity 1 at a stable placement");
  });
}

export async function assertMaintenanceTextLayout(page) {
  const required = ["반경 내 사업 상세", "시행자", "예정세대", "행정구역 수준 목록", "법적 효력 없는 참고자료"];
  for (const text of required) assert.ok(await page.getByText(text, { exact: false }).count() > 0, `missing CJK text: ${text}`);
  const details = page.locator("[data-maintenance-detail], [data-maintenance-legal]");
  assert.ok(await details.count() > 0, "maintenance detail text not found");
  const metrics = await details.evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      fontSize: Number.parseFloat(style.fontSize),
      horizontalClip: element.scrollWidth > element.clientWidth + 1,
      outsideViewport: rect.left < -1 || rect.right > window.innerWidth + 1,
    };
  }));
  for (const metric of metrics) {
    assert.ok(metric.fontSize >= 12, `maintenance detail font below 12px: ${metric.fontSize}`);
    assert.equal(metric.horizontalClip, false, "maintenance CJK text is horizontally clipped");
    assert.equal(metric.outsideViewport, false, "maintenance detail is outside viewport");
  }
}
