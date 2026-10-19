import assert from "node:assert/strict";

const JSZip = (await import("jszip")).default;
const { TOPO_UPLOAD_KEEP } = await import("../../lib/v2/topo/layers.ts");

const KEPT_ENTRIES = [
  ["N3L_F0010000.shp", Buffer.from("contour-shp")],
  ["N3L_F0010000.shx", Buffer.from("contour-shx")],
  ["N3L_F0010000.dbf", Buffer.from("contour-dbf")],
  ["N3L_F0010000.prj", Buffer.from("contour-prj")],
  ["N3L_F0010000.cpg", Buffer.from("UTF-8\n")],
];

// Three administrative-boundary entries plus a readme are deliberately dropped.
// The same contour basename with an unsupported extension is also dropped.
const DROPPED_ENTRIES = [
  ["N3A_C0010000.shp", Buffer.alloc(11, 0x41)],
  ["N3A_C0020000.shp", Buffer.alloc(13, 0x42)],
  ["N3L_C0010000.shp", Buffer.alloc(17, 0x43)],
  ["N3L_F0010000.txt", Buffer.from("not a shapefile")],
  ["readme.txt", Buffer.from("downloaded from NGII")],
];

const TOPO_SUMMARY = {
  crs: "EPSG:5179",
  bboxUtmk: [100, 200, 300, 400],
  coverageWgs84: [[127, 37], [127.001, 37], [127.001, 37.001], [127, 37.001], [127, 37]],
  counts: { topo_contour: 2 },
  demCells: 4,
  buildingFloorsOnePct: null,
};

async function zipBlob(entries, compression, compressedNames = new Set()) {
  const zip = new JSZip();
  for (const [name, content] of entries) {
    zip.file(name, content, { compression: compressedNames.has(name) ? "DEFLATE" : compression });
  }
  return zip.generateAsync({ type: "blob", compression });
}

async function zipEntryNames(blob) {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  return Object.keys(zip.files).filter((name) => !zip.files[name].dir).sort();
}

function centralDirectoryCompressionMethods(bytes) {
  const view = new DataView(bytes);
  const methods = [];
  for (let offset = 0; offset + 12 <= view.byteLength; offset += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    // Central-directory header: version-made (4), version-needed (2), flags (2), method (2).
    methods.push(view.getUint16(offset + 10, true));
  }
  return methods;
}

function expectTopoClientError(error, code) {
  assert.equal(error?.name, "TopoClientError");
  assert.equal(error?.code, code);
  return true;
}

function expectAbortError(error) {
  assert.ok(error && (error.name === "AbortError" || error.code === "ABORT_ERR"), `expected AbortError-like rejection, got ${error}`);
  return true;
}

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      const list = listeners.get(type) ?? [];
      list.push(listener);
      listeners.set(type, list);
    },
    removeEventListener(type, listener) {
      listeners.set(type, (listeners.get(type) ?? []).filter((candidate) => candidate !== listener));
    },
    emit(type, event) {
      for (const listener of listeners.get(type) ?? []) listener.call(this, event);
    },
  };
}

class FakeXMLHttpRequest {
  static responses = [];
  static instances = [];

  constructor() {
    Object.assign(this, eventTarget());
    this.upload = Object.assign(eventTarget(), { onprogress: null });
    this.withCredentials = false;
    this.readyState = 0;
    this.status = 0;
    this.responseType = "";
    this.responseText = "";
    this.response = "";
    this.headers = {};
    this.abortCalls = 0;
    this.aborted = false;
    this.onload = null;
    this.onerror = null;
    this.onabort = null;
    this.onreadystatechange = null;
  }

  open(method, url, async = true) {
    this.method = method;
    this.url = url;
    this.async = async;
    this.readyState = 1;
  }

  setRequestHeader(name, value) {
    this.headers[name] = value;
  }

  send(body) {
    this.body = body;
    FakeXMLHttpRequest.instances.push(this);
    const behavior = FakeXMLHttpRequest.responses.shift() ?? { status: 500, body: { error: "missing_fake_response" } };
    this.behavior = behavior;
    this.upload.onprogress?.({ loaded: behavior.loaded ?? 37, total: behavior.total ?? 100, lengthComputable: true });
    this.upload.emit("progress", { loaded: behavior.loaded ?? 37, total: behavior.total ?? 100, lengthComputable: true });
    if (behavior.hold) return;
    queueMicrotask(() => {
      if (this.aborted) return;
      this.finish(behavior);
    });
  }

  finish(behavior) {
    if (this.aborted) return;
    this.readyState = 4;
    this.status = behavior.status;
    this.responseText = JSON.stringify(behavior.body ?? {});
    this.response = this.responseType === "json" ? behavior.body ?? {} : this.responseText;
    this.onreadystatechange?.();
    this.emit("readystatechange");
    this.onload?.();
    this.emit("load");
  }

  abort() {
    if (this.aborted) return;
    this.abortCalls += 1;
    this.aborted = true;
    this.readyState = 0;
    this.onabort?.();
    this.emit("abort");
  }
}

const compressedDroppedNames = new Set(DROPPED_ENTRIES.map(([name]) => name));
const inputBlob = await zipBlob([...KEPT_ENTRIES, ...DROPPED_ENTRIES], "STORE", compressedDroppedNames);
const inputCompression = centralDirectoryCompressionMethods(await inputBlob.arrayBuffer());
assert.equal(inputCompression.length, KEPT_ENTRIES.length + DROPPED_ENTRIES.length);
assert.deepEqual(inputCompression, [0, 0, 0, 0, 0, 8, 8, 8, 8, 8], `fixture compression methods: ${inputCompression}`);

for (const [name] of KEPT_ENTRIES) assert.equal(TOPO_UPLOAD_KEEP(name), true, `kept fixture entry: ${name}`);
for (const [name] of DROPPED_ENTRIES) assert.equal(TOPO_UPLOAD_KEEP(name), false, `dropped fixture entry: ${name}`);

// Import after the fixture assertions so the pre-implementation RED identifies the missing client contract.
const { prepareTopoZip, uploadTopo, TOPO_ERROR_COPY } = await import("../../lib/v2/ui/topo-upload.ts");

const prepared = await prepareTopoZip(inputBlob);
assert.ok(prepared.blob instanceof Blob);
assert.deepEqual(prepared.keptLayers, ["N3L_F0010000"]);
assert.equal(prepared.droppedBytes, DROPPED_ENTRIES.reduce((total, [, content]) => total + content.length, 0));
assert.deepEqual(await zipEntryNames(prepared.blob), KEPT_ENTRIES.map(([name]) => name).sort(), "kept entry names must not be rewritten");

const outputCompression = centralDirectoryCompressionMethods(await prepared.blob.arrayBuffer());
assert.equal(outputCompression.length, KEPT_ENTRIES.length);
assert.ok(outputCompression.every((method) => method === 8), `prepared zip must use DEFLATE: ${outputCompression}`);

const noLayerBlob = await zipBlob([["readme.txt", Buffer.from("no supported layer")]], "DEFLATE");
await assert.rejects(() => prepareTopoZip(noLayerBlob), (error) => expectTopoClientError(error, "topo_not_topo"));
await assert.rejects(() => prepareTopoZip(new Blob([Buffer.from("not a zip")])), (error) => expectTopoClientError(error, "topo_bad_zip"));

assert.deepEqual(TOPO_ERROR_COPY, {
  topo_not_topo: {
    title: "수치지형도 레이어를 찾지 못했습니다",
    body: "zip 안에 등고선·도로·건물 SHP가 없습니다. 국토정보플랫폼에서 연속수치지도를 SHP 형식으로 받아 압축을 풀지 않은 채 넣어 주세요. 추가 자료 없이도 분석할 수 있습니다.",
  },
  topo_crs: {
    title: "지도 위치를 읽을 수 없습니다",
    body: "좌표 정보(.prj)가 없거나 지원하지 않는 좌표계입니다. 받은 zip을 고치지 않고 그대로 넣어 주세요. 추가 자료 없이도 분석할 수 있습니다.",
  },
  topo_outside: {
    title: "이 대지 둘레의 자료가 아닙니다",
    body: "파일 범위가 대지와 분석 반경에 전혀 겹치지 않습니다. 대지를 가운데 두고 다시 받아 주세요. 추가 자료 없이도 분석할 수 있습니다.",
  },
  topo_too_large: {
    title: "파일이 너무 큽니다",
    body: "필요한 레이어만 남겨도 64 MB를 넘습니다. 범위를 줄여 다시 받아 주세요. 추가 자료 없이도 분석할 수 있습니다.",
  },
  topo_bad_zip: {
    title: "zip 파일을 열 수 없습니다",
    body: "파일이 손상됐거나 zip이 아닙니다. 다시 받아 넣어 주세요. 추가 자료 없이도 분석할 수 있습니다.",
  },
});

const originalXhr = globalThis.XMLHttpRequest;
const originalFetch = globalThis.fetch;
const refreshCalls = [];
globalThis.XMLHttpRequest = FakeXMLHttpRequest;
globalThis.fetch = async (url, init = {}) => {
  refreshCalls.push({ url, init });
  assert.equal(url, "/site/api/auth/refresh");
  return { ok: true, status: 200 };
};

try {
  FakeXMLHttpRequest.instances = [];
  FakeXMLHttpRequest.responses = [
    { status: 401, body: { error: "auth_required" }, loaded: 37, total: 100 },
    { status: 201, body: { topoId: "topo-client-test", summary: TOPO_SUMMARY }, loaded: 100, total: 100 },
  ];
  refreshCalls.length = 0;
  const progress = [];
  const uploaded = await uploadTopo(prepared.blob, (loaded, total) => progress.push([loaded, total]));
  assert.deepEqual(uploaded, { topoId: "topo-client-test", summary: TOPO_SUMMARY });
  assert.deepEqual(progress, [[37, 100], [100, 100]], "progress must expose actual loaded/total bytes for both attempts");
  assert.equal(FakeXMLHttpRequest.instances.length, 2, "401 allows exactly one upload retry");
  assert.deepEqual(FakeXMLHttpRequest.instances.map((xhr) => [xhr.method, xhr.url]), [
    ["POST", "/site/api/v2/topo"],
    ["POST", "/site/api/v2/topo"],
  ]);
  assert.ok(FakeXMLHttpRequest.instances.every((xhr) => xhr.withCredentials === true));
  assert.equal(refreshCalls.length, 1, "401 must refresh exactly once");
  assert.equal(refreshCalls[0].init.method, "POST");
  assert.equal(refreshCalls[0].init.credentials, "include");

  FakeXMLHttpRequest.instances = [];
  FakeXMLHttpRequest.responses = [{ status: 422, body: { error: "topo_crs" } }];
  refreshCalls.length = 0;
  await assert.rejects(
    () => uploadTopo(prepared.blob, () => undefined),
    (error) => expectTopoClientError(error, "topo_crs"),
  );
  assert.equal(FakeXMLHttpRequest.instances.length, 1);
  assert.equal(refreshCalls.length, 0, "non-401 server errors must not refresh");

  FakeXMLHttpRequest.instances = [];
  FakeXMLHttpRequest.responses = [{ status: 429, body: { error: "topo_rate_limited" } }];
  await assert.rejects(
    () => uploadTopo(prepared.blob, () => undefined),
    (error) => {
      expectTopoClientError(error, "topo_rate_limited");
      assert.match(error.message, /추가 자료 없이도 분석할 수 있습니다/);
      return true;
    },
  );
  assert.equal(refreshCalls.length, 0, "rate-limit and unknown errors must not refresh");

  FakeXMLHttpRequest.instances = [];
  FakeXMLHttpRequest.responses = [{ status: 200, body: { topoId: "never-completes", summary: TOPO_SUMMARY }, hold: true }];
  const controller = new AbortController();
  const abortPromise = uploadTopo(prepared.blob, () => undefined, controller.signal);
  const abortXhr = FakeXMLHttpRequest.instances.at(-1);
  assert.ok(abortXhr);
  controller.abort();
  await assert.rejects(abortPromise, expectAbortError);
  assert.equal(abortXhr.abortCalls, 1, "signal abort must call xhr.abort()");
} finally {
  globalThis.XMLHttpRequest = originalXhr;
  globalThis.fetch = originalFetch;
}

console.log("✓ v2 topo client");
