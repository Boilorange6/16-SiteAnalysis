import assert from "node:assert/strict";

const mapViewModule = await import("../components/map-view.tsx");
assert.equal(
  typeof mapViewModule.addPlannedRailOverlay,
  "function",
  "planned overlay helper must be available to the focused interaction regression",
);

class FakeElement {
  attributes = new Map();
  listeners = new Map();

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  addEventListener(event, handler) {
    const handlers = this.listeners.get(event) ?? [];
    handlers.push(handler);
    this.listeners.set(event, handlers);
  }

  removeEventListener(event, handler) {
    const handlers = this.listeners.get(event) ?? [];
    this.listeners.set(event, handlers.filter((candidate) => candidate !== handler));
  }

  dispatchEvent(event) {
    for (const handler of this.listeners.get(event.type) ?? []) {
      handler.call(this, event);
    }
  }
}

class FakePolyline {
  element = new FakeElement();
  handlers = new Map();
  tooltipContent = "";
  popupContent = "";
  tooltipOpen = false;
  popupOpen = false;
  popupOpenCount = 0;
  bringToFrontCalled = false;
  removed = false;

  constructor(latLngs, options) {
    this.latLngs = latLngs;
    this.options = options;
  }

  on(eventOrMap, handler) {
    if (typeof eventOrMap === "string") {
      const handlers = this.handlers.get(eventOrMap) ?? [];
      handlers.push(handler);
      this.handlers.set(eventOrMap, handlers);
      return this;
    }

    Object.entries(eventOrMap).forEach(([event, eventHandler]) => this.on(event, eventHandler));
    return this;
  }

  off(eventOrMap) {
    if (typeof eventOrMap === "string") {
      this.handlers.delete(eventOrMap);
      return this;
    }

    Object.keys(eventOrMap).forEach((event) => this.handlers.delete(event));
    return this;
  }

  fire(event, payload = {}) {
    for (const handler of this.handlers.get(event) ?? []) {
      handler.call(this, { target: this, ...payload });
    }
    return this;
  }

  bindTooltip(content) {
    this.tooltipContent = content;
    return this;
  }

  unbindTooltip() {
    this.tooltipContent = "";
    return this;
  }

  bindPopup(content) {
    this.popupContent = content;
    return this;
  }

  unbindPopup() {
    this.popupContent = "";
    return this;
  }

  openTooltip() {
    this.tooltipOpen = true;
    return this;
  }

  closeTooltip() {
    this.tooltipOpen = false;
    return this;
  }

  openPopup() {
    this.popupOpenCount += 1;
    this.popupOpen = true;
    this.fire("popupopen");
    return this;
  }

  closePopup() {
    this.popupOpen = false;
    return this;
  }

  isPopupOpen() {
    return this.popupOpen;
  }

  bringToFront() {
    this.bringToFrontCalled = true;
    return this;
  }

  remove() {
    this.removed = true;
    this.fire("remove");
    return this;
  }

  getElement() {
    return this.element;
  }
}

const polylines = [];
const L = {
  polyline(latLngs, options) {
    const polyline = new FakePolyline(latLngs, options);
    polylines.push(polyline);
    return polyline;
  },
  DomEvent: {
    stop() {},
  },
};
const layers = [];
const routeLinesLayer = {
  addLayer(layer) {
    layers.push(layer);
    layer.fire("add");
  },
  clearLayers() {
    for (const layer of layers.splice(0)) {
      layer.remove();
    }
  },
};
const project = {
  projectId: "seoul-line-9-phase-4",
  lineName: "서울 9호선 4단계 연장 (개략)",
  lifecycleStatus: "under_construction",
  geometry: {
    type: "LineString",
    coordinates: [[127.1501853, 37.5326446], [127.1693147, 37.5622842]],
  },
  geometrySourceLabel: "OpenStreetMap 공사 선형 보조",
};

// Given: one planned Line 9 geometry rendered behind another interactive map overlay.
// When: the planned overlay creates its visual and interaction layers.
mapViewModule.addPlannedRailOverlay(L, routeLinesLayer, [project]);

// Then: an unchanged visual line and a separate invisible pointer surface are both registered.
assert.equal(polylines.length, 2, "planned geometry must keep a visual line plus a dedicated interaction surface");
assert.equal(layers.length, 2, "both planned layers must share the planned lifecycle group");
const visualLine = polylines.find((line) => line.options.interactive === false);
const interactionLine = polylines.find((line) => line.options.interactive !== false);
assert.ok(visualLine, "the visible planned line must not compete for pointer events");
assert.ok(interactionLine, "the planned segment must expose an interactive hit surface");
assert.equal(interactionLine.options.interactive, true, "the planned hit surface must explicitly accept pointer events");
assert.equal(interactionLine.options.opacity, 0, "the interaction surface must not alter the planned line design");
assert.ok(interactionLine.options.weight >= 16, "the interaction surface must be practical for pointer and touch input");
assert.equal(interactionLine.options.bubblingMouseEvents, false, "planned activation must not bubble into normal map click handling");
assert.equal(interactionLine.bringToFrontCalled, true, "the planned hit surface must sit above competing map overlays");
for (const event of ["mouseover", "mouseout", "click", "keypress", "remove"]) {
  assert.equal(interactionLine.handlers.has(event), true, `planned segment must bind explicit ${event} handling`);
}
assert.equal(interactionLine.handlers.get("click")?.length, 1, "planned click must have one explicit activation handler");
assert.equal(interactionLine.element.listeners.get("focus")?.length, 1, "planned segment must bind one focus handler");
assert.equal(interactionLine.element.listeners.get("blur")?.length, 1, "planned segment must bind one blur handler");

for (const expected of [project.lineName, "공사 중", project.geometrySourceLabel]) {
  assert.ok(interactionLine.tooltipContent.includes(expected), `tooltip must expose ${expected}`);
  assert.ok(interactionLine.popupContent.includes(expected), `popup must expose ${expected}`);
}

// Given: the planned segment interaction surface is rendered.
// When: desktop hover enters and leaves the path.
interactionLine.fire("mouseover", { originalEvent: { pointerType: "mouse" } });
assert.equal(interactionLine.tooltipOpen, true, "desktop hover must open the existing Leaflet tooltip");
interactionLine.fire("mouseout", { originalEvent: { pointerType: "mouse" } });
assert.equal(interactionLine.tooltipOpen, false, "desktop hover exit must close the tooltip");

// Given: no planned popup is open.
// When: desktop click and mobile tap reach the segment.
for (const pointerType of ["mouse", "touch"]) {
  interactionLine.popupOpenCount = 0;
  interactionLine.popupOpen = false;
  interactionLine.fire("click", { originalEvent: { pointerType } });
  assert.equal(interactionLine.popupOpenCount, 1, `${pointerType} activation must open exactly one popup`);
  assert.equal(interactionLine.tooltipOpen, false, `${pointerType} activation must not leave a duplicate tooltip`);
}

// Given: Leaflet exposes the SVG path as a focusable layer.
// When: keyboard focus and Enter activate it.
assert.equal(interactionLine.element.getAttribute("role"), "button");
assert.equal(interactionLine.element.getAttribute("tabindex"), "0");
assert.match(interactionLine.element.getAttribute("aria-label") ?? "", /서울 9호선 4단계 연장/);
interactionLine.element.dispatchEvent({ type: "focus" });
assert.equal(interactionLine.tooltipOpen, true, "keyboard focus must expose the tooltip");
interactionLine.element.dispatchEvent({ type: "blur" });
assert.equal(interactionLine.tooltipOpen, false, "keyboard blur must close the tooltip");
interactionLine.popupOpenCount = 0;
interactionLine.popupOpen = false;
interactionLine.fire("keypress", { originalEvent: { keyCode: 13 } });
assert.equal(interactionLine.popupOpenCount, 1, "Enter must open exactly one planned popup");

// Given: the planned layer group is refreshed by the map effect.
// When: the old layers are removed.
routeLinesLayer.clearLayers();
assert.equal(interactionLine.removed, true, "planned layers must be removable with the route lifecycle group");
interactionLine.element.dispatchEvent({ type: "focus" });
assert.equal(interactionLine.tooltipOpen, false, "removed planned layers must release focus handlers");

console.log("planned-rail-tooltip: pointer, click, touch, and keyboard gates passed");
