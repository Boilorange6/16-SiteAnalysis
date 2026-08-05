import ky, { type KyInstance } from "ky";

import {
  isJsonObject,
  normalizeIntegratedRow,
  normalizeStandardRow,
  readText,
  type JsonObject,
  type MaintenanceAttributeRecord,
} from "./national-provider-normalization";

export {
  normalizeIntegratedRow,
  normalizeStandardRow,
  type MaintenanceAttributeRecord,
} from "./national-provider-normalization";

const INTEGRATED_ENDPOINT =
  "https://api.odcloud.kr/api/15160169/v1/uddi:4d7f16a9-b0fd-4d07-b266-d0ad82aeaf34";
const STANDARD_ENDPOINT =
  "https://api.data.go.kr/openapi/tn_pubr_public_redevelopment_reconstruction_project_api";
const RETRY_STATUS_CODES = [429, ...Array.from({ length: 100 }, (_, index) => 500 + index)];

function safeErrorText(text: string, serviceKey: string): string {
  const withoutKey = serviceKey ? text.replaceAll(serviceKey, "[redacted]") : text;
  return withoutKey.replace(/\s+/g, " ").trim().slice(0, 300);
}

function findErrorMessage(value: unknown): string | undefined {
  if (!isJsonObject(value)) return undefined;
  const code = readText(value, ["code", "resultCode"]);
  const message = readText(value, ["msg", "message", "resultMsg", "returnAuthMsg"]);
  if (code && code !== "00" && code !== "0") return [code, message].filter(Boolean).join(" ");
  return message && /ERROR|INVALID|UNREGISTERED|SERVICE KEY/i.test(message) ? message : undefined;
}

function errorResponse(value: unknown): Response | undefined {
  if (typeof value !== "object" || value === null || !("response" in value)) return undefined;
  return value.response instanceof Response ? value.response : undefined;
}

async function requestJson(options: {
  readonly client: KyInstance;
  readonly endpoint: string;
  readonly searchParams: URLSearchParams;
  readonly sourceLabel: string;
  readonly serviceKey: string;
}): Promise<JsonObject> {
  let response: Response;
  try {
    response = await options.client.get(options.endpoint, {
      searchParams: options.searchParams,
    });
  } catch (error) {
    const httpResponse = errorResponse(error);
    if (httpResponse) {
      const text = httpResponse.bodyUsed ? "" : await httpResponse.text();
      const safeText = safeErrorText(text, options.serviceKey);
      throw new Error(
        `${options.sourceLabel} HTTP ${httpResponse.status}${safeText ? `: ${safeText}` : ""}`,
      );
    }
    throw new Error(`${options.sourceLabel} request failed`);
  }
  const text = await response.text();
  const safeText = safeErrorText(text, options.serviceKey);
  if (/^\s*</.test(text)) {
    const authMessage = /<returnAuthMsg>([^<]+)<\/returnAuthMsg>/i.exec(text)?.[1];
    throw new Error(`${options.sourceLabel} XML error: ${safeErrorText(authMessage ?? text, options.serviceKey)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${options.sourceLabel} returned non-JSON content`);
  }
  if (!isJsonObject(parsed)) throw new Error(`${options.sourceLabel} returned an invalid JSON body`);
  const errorMessage = findErrorMessage(parsed);
  if (errorMessage) throw new Error(`${options.sourceLabel}: ${safeErrorText(errorMessage, options.serviceKey)}`);
  return parsed;
}

function readTotalCount(value: unknown): number {
  const count = typeof value === "string" ? Number(value.replaceAll(",", "")) : value;
  if (typeof count === "number" && Number.isFinite(count)) return count;
  throw new Error("maintenance API returned an invalid totalCount");
}

/**
 * 행은 왔는데 하나도 못 읽었다면 상류 스키마가 바뀐 것이다.
 *
 * 2026-08-05에 표준 API가 CTPV_NM → ctpvNm으로 바꿨을 때 HTTP도 헤더도 정상이라
 * 어디서도 경고가 뜨지 않았고, 정비사업이 조용히 0건이 됐다. 조용한 0건은
 * 실패로 취급한다 — 상류가 진짜 0건을 주는 경우는 rows가 비어 있으므로 구분된다.
 */
function assertRowsReadable(options: {
  readonly rows: readonly unknown[];
  readonly records: readonly MaintenanceAttributeRecord[];
  readonly sourceLabel: string;
}): void {
  const { rows, records, sourceLabel } = options;
  if (rows.length > 0 && records.length === 0) {
    throw new Error(
      `${sourceLabel} schema mismatch: ${rows.length} rows returned but none could be read`,
    );
  }
}

function normalizeRows(
  rows: readonly unknown[],
  normalizer: (row: JsonObject) => MaintenanceAttributeRecord | null,
): MaintenanceAttributeRecord[] {
  const records: MaintenanceAttributeRecord[] = [];
  for (const row of rows) {
    if (!isJsonObject(row)) continue;
    const normalized = normalizer(row);
    if (normalized) records.push(normalized);
  }
  return records;
}

async function fetchIntegrated(options: {
  readonly client: KyInstance;
  readonly serviceKey: string;
  readonly pageSize: number;
}): Promise<MaintenanceAttributeRecord[]> {
  const records: MaintenanceAttributeRecord[] = [];
  for (let page = 1; ; page += 1) {
    const searchParams = new URLSearchParams({
      page: String(page), perPage: String(options.pageSize), serviceKey: options.serviceKey,
    });
    const body = await requestJson({ ...options, endpoint: INTEGRATED_ENDPOINT, searchParams, sourceLabel: "integrated maintenance API" });
    if (!Array.isArray(body.data)) throw new Error("integrated maintenance API returned invalid data");
    const normalized = normalizeRows(body.data, normalizeIntegratedRow);
    assertRowsReadable({ rows: body.data, records: normalized, sourceLabel: "integrated maintenance API" });
    records.push(...normalized);
    if (page * options.pageSize >= readTotalCount(body.totalCount)) return records;
  }
}

/**
 * 표준 API는 header/body를 `response` 안에 넣어 주기도 하고, 벗겨서 top-level로
 * 주기도 한다. 2026-08-05에 상류가 봉투를 벗기면서 운영의 maintenance_attributes가
 * 계속 실패했다. 어느 쪽이든 받아야 상류가 되돌려도 다시 깨지지 않는다.
 */
function standardEnvelope(root: JsonObject): JsonObject {
  return isJsonObject(root.response) ? root.response : root;
}

function standardBody(options: { readonly root: JsonObject; readonly serviceKey: string }): JsonObject {
  const { root, serviceKey } = options;
  const envelope = standardEnvelope(root);
  const headerError = findErrorMessage(envelope.header);
  if (headerError) {
    throw new Error(`standard maintenance API: ${safeErrorText(headerError, serviceKey)}`);
  }
  if (!isJsonObject(envelope.body)) throw new Error("standard maintenance API returned invalid body");
  return envelope.body;
}

function standardItems(body: JsonObject): readonly unknown[] {
  if (Array.isArray(body.items)) return body.items;
  if (!isJsonObject(body.items)) return [];
  if (Array.isArray(body.items.item)) return body.items.item;
  return body.items.item === undefined ? [] : [body.items.item];
}

async function fetchStandard(options: {
  readonly client: KyInstance;
  readonly serviceKey: string;
  readonly pageSize: number;
}): Promise<MaintenanceAttributeRecord[]> {
  const records: MaintenanceAttributeRecord[] = [];
  for (let pageNo = 1; ; pageNo += 1) {
    const searchParams = new URLSearchParams({
      serviceKey: options.serviceKey, pageNo: String(pageNo),
      numOfRows: String(options.pageSize), type: "json",
    });
    const root = await requestJson({ ...options, endpoint: STANDARD_ENDPOINT, searchParams, sourceLabel: "standard maintenance API" });
    const body = standardBody({ root, serviceKey: options.serviceKey });
    const rows = standardItems(body);
    const normalized = normalizeRows(rows, normalizeStandardRow);
    assertRowsReadable({ rows, records: normalized, sourceLabel: "standard maintenance API" });
    records.push(...normalized);
    if (pageNo * options.pageSize >= readTotalCount(body.totalCount)) return records;
  }
}

function createDefaultHttpClient(): KyInstance {
  return ky.create({
    timeout: 10_000,
    retry: { limit: 2, methods: ["get"], statusCodes: RETRY_STATUS_CODES },
  });
}

export async function fetchNationalMaintenanceAttributes(options: {
  readonly serviceKey?: string;
  readonly httpClient?: KyInstance;
  readonly pageSize?: number;
} = {}): Promise<{
  readonly integrated: readonly MaintenanceAttributeRecord[];
  readonly standard: readonly MaintenanceAttributeRecord[];
}> {
  const serviceKey = (options.serviceKey ?? process.env.DATA_GO_KR_API_KEY ?? "").trim();
  if (!serviceKey) throw new Error("DATA_GO_KR_API_KEY is not configured");
  const pageSize = options.pageSize ?? 1_000;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1_000) {
    throw new Error("pageSize must be an integer between 1 and 1000");
  }
  const client = options.httpClient ?? createDefaultHttpClient();
  const integrated = await fetchIntegrated({ client, serviceKey, pageSize });
  const standard = await fetchStandard({ client, serviceKey, pageSize });
  return { integrated, standard };
}
