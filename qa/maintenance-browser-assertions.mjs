import assert from "node:assert/strict";

const forbiddenSentinel = "qa-secret-sentinel-do-not-leak";
const keyLikeSecret = /(?:service[_-]?key|api[_-]?key|data_go_kr_service_key|seoul_open_data_key)\s*[:=]\s*["']?[A-Za-z0-9_-]{16,}/i;

export function installBodyAudit(page) {
  const bodyReads = [];
  page.on("response", (response) => {
    const resourceType = response.request().resourceType();
    if (!["document", "fetch", "xhr", "script"].includes(resourceType)) return;
    bodyReads.push(response.text()
      .then((body) => ({ body, resourceType, url: response.url() }))
      .catch(() => ({ body: "", resourceType, url: response.url() })));
  });
  return async () => {
    const bodies = await Promise.all(bodyReads);
    assert.ok(bodies.some((entry) => entry.resourceType === "script"), "loaded JS body was not inspected");
    assert.ok(bodies.some((entry) => entry.url.includes("/api/poi-search")), "POI response body was not inspected");
    for (const entry of bodies) {
      assert.equal(entry.body.includes(forbiddenSentinel), false, `sentinel leaked in ${entry.url}`);
      assert.equal(keyLikeSecret.test(entry.body), false, `key-like secret leaked in ${entry.url}`);
    }
    return bodies.length;
  };
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
