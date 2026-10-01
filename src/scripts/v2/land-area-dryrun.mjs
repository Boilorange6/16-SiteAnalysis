/**
 * 공부면적 원천 조사 전용 dryrun.
 *
 * VWorld 로그인 후 다운로드 목록만 읽고 파일은 절대 받지 않는다.
 *
 *   npx tsx src/scripts/v2/land-area-dryrun.mjs --ds <id[,id...]> [--region 시도,...]
 *   npx tsx src/scripts/v2/land-area-dryrun.mjs --cadastral <raw/cadastral> --cadastral-only
 *
 * 자격 증명은 .env.local의 VWORLD_ID / VWORLD_PW에서만 읽고 출력하지 않는다.
 * 권리 문구는 목록 응답에 포함된 값이 아니라 문서 확인 상태를 표시한다.
 * 실제 토지특성정보·토지대장 상세 페이지의 이용조건은 사용자가 목록 결과와
 * 함께 확인한 뒤 적재 단계의 release rights로 확정해야 한다.
 */
import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const UNKNOWN_RIGHTS = "확인 필요 — 목록 응답에 이용조건 문구가 없어 상세 페이지·data.go.kr 확인";
const SOURCE_URL = (dsId) => `https://www.vworld.kr/dtmk/dtmk_ntads_s002.do?svcCde=NA&dsId=${encodeURIComponent(dsId)}`;

export function formatBytes(bytes) {
  if (bytes === null || bytes === undefined || !Number.isFinite(Number(bytes)) || Number(bytes) < 0) return "미상";
  const value = Number(bytes);
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

export function sourceKindOf(file) {
  const title = String(file?.title ?? "");
  if (title.includes("토지특성")) return "토지특성정보";
  if (title.includes("토지대장")) return "토지대장";
  if (title.includes("연속지적") || String(file?.dsId ?? "") === "23") return "연속지적도";
  return "미분류";
}

export function rightsFor(file) {
  const dsId = String(file?.dsId ?? "");
  const kind = sourceKindOf(file);
  if (kind === "연속지적도") {
    return {
      license: "CC-BY",
      wording: "VWorld 저작자표시[CC BY] · data.go.kr 15045882는 이용허락범위 제한 없음(dsId 23)",
      sourceUrl: SOURCE_URL(dsId || "23"),
    };
  }
  return {
    license: "확인 필요",
    wording: UNKNOWN_RIGHTS,
    sourceUrl: SOURCE_URL(dsId),
  };
}

/**
 * 파일 목록에서 제목별 최신 전체데이터만 고른다.
 * VWorld 한 dsId에 여러 제목이 섞여도 한 제목의 기준일을 다른 제목이
 * 가리지 않도록 그룹화한다. 지역 필터는 최신 기준일을 고르기 전에 적용한다.
 */
export function latestFullRows(files, regions = null) {
  const filtered = files.filter((file) => !regions || regions.has(file.region));
  const full = filtered.filter((file) => file.kind === "전체데이터");
  const latestByTitle = new Map();
  for (const file of full) {
    const key = `${file.dsId}|${file.title}`;
    const current = latestByTitle.get(key);
    if (!current || String(file.baseDate ?? "") > String(current)) latestByTitle.set(key, file.baseDate);
  }
  return full.filter((file) => latestByTitle.get(`${file.dsId}|${file.title}`) === file.baseDate);
}

function fieldNameFromDescriptor(buffer, offset) {
  return buffer.subarray(offset, offset + 11).toString("ascii").split(String.fromCharCode(0))[0].trim();
}

/** DBF 전체 레코드를 읽지 않고 헤더의 필드명만 읽는다. */
export function readDbfFieldNames(file) {
  const fd = openSync(file, "r");
  try {
    const prefix = Buffer.alloc(32);
    if (readSync(fd, prefix, 0, prefix.length, 0) !== prefix.length) throw new Error(`DBF header too short: ${file}`);
    const headerBytes = prefix.readUInt16LE(8);
    if (headerBytes < 33 || headerBytes > 1024 * 1024) throw new Error(`invalid DBF header length ${headerBytes}: ${file}`);
    const header = Buffer.alloc(headerBytes);
    if (readSync(fd, header, 0, header.length, 0) !== header.length) throw new Error(`DBF header truncated: ${file}`);
    const fields = [];
    for (let offset = 32; offset + 32 <= headerBytes - 1; offset += 32) {
      if (header[offset] === 0x0d) break;
      const name = fieldNameFromDescriptor(header, offset);
      if (name) fields.push(name);
    }
    return fields;
  } finally {
    closeSync(fd);
  }
}

function walkFiles(root) {
  const stat = statSync(root);
  if (stat.isFile()) return [root];
  const out = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const child = resolve(root, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(child));
    else out.push(child);
  }
  return out;
}

/**
 * 기존 dsId 23 SHP의 DBF 헤더에 LNDPCL_AR가 있는지 확인한다.
 * 파일 본문과 geometry는 읽지 않으므로 대용량 SHP도 헤더만 검사한다.
 */
export function inspectCadastralFields(root) {
  const directory = resolve(root);
  const dbfs = walkFiles(directory).filter((file) => file.toLowerCase().endsWith(".dbf")).sort();
  const fieldSets = [];
  const filesWithLandAreaField = [];
  for (const file of dbfs) {
    const fields = readDbfFieldNames(file);
    fieldSets.push(fields);
    if (fields.some((field) => field.toUpperCase() === "LNDPCL_AR")) filesWithLandAreaField.push(file);
  }
  return { directory, filesScanned: dbfs.length, filesWithLandAreaField, fieldSets };
}

function option(args, name, fallback = undefined) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
}

function hasFlag(args, name) {
  return args.includes(`--${name}`);
}

function csv(value) {
  return String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function escapeCell(value) {
  return String(value ?? "—").replaceAll("|", "\\|").replaceAll(/\r?\n/g, " ");
}

function table(rows) {
  const headers = ["dsId", "원천 후보", "제목", "형식", "시도", "표시 용량", "기준일", "권리 확인"];
  const lines = [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`];
  for (const file of rows) {
    const rights = rightsFor(file);
    lines.push(`| ${[
      file.dsId,
      sourceKindOf(file),
      file.title,
      file.format || "미상",
      file.region,
      formatBytes(file.approxBytes),
      file.baseDate,
      `${rights.license}: ${rights.wording}`,
    ].map(escapeCell).join(" | ")} |`);
  }
  if (rows.length === 0) lines.push("| — | — | 전체데이터 없음 | — | — | — | — | — |");
  return lines.join("\n");
}

function cadastralText(scan) {
  const uniqueSets = [...new Map(scan.fieldSets.map((fields) => [fields.join("\u0000"), fields])).values()];
  const found = scan.filesWithLandAreaField.length > 0;
  return [
    `연속지적도 DBF 헤더 검사: ${scan.filesScanned}개 파일 · LNDPCL_AR ${found ? "있음" : "없음"}`,
    found ? `  면적 필드 파일: ${scan.filesWithLandAreaField.join(", ")}` : "  확인된 필드 집합에 LNDPCL_AR가 없어 도형 계산면적과 별도 원천이 필요합니다.",
    `  필드 집합: ${uniqueSets.map((fields) => `[${fields.join(", ")}]`).join(" / ") || "없음"}`,
    "  현재 parcel-polygons 적재기는 A1/A2/A5/A7과 투영 도형으로 areaM2를 계산하며 LNDPCL_AR를 사용하지 않습니다.",
  ].join("\n");
}

function jsonPayload(requested, rows, failures, scan) {
  return {
    downloads: 0,
    requestedDsIds: requested,
    rows: rows.map((file) => ({
      dsId: file.dsId,
      candidate: sourceKindOf(file),
      title: file.title,
      format: file.format || null,
      region: file.region,
      approxBytes: file.approxBytes,
      baseDate: file.baseDate,
      fileSq: file.fileSq,
      rights: rightsFor(file),
    })),
    failures,
    cadastral: scan
      ? { ...scan, hasLandAreaField: scan.filesWithLandAreaField.length > 0 }
      : null,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const cadastral = option(args, "cadastral");
  if (hasFlag(args, "cadastral-only")) {
    if (!cadastral) throw new Error("--cadastral-only에는 --cadastral <폴더>가 필요합니다");
    const scan = inspectCadastralFields(resolve(cadastral));
    console.log(cadastralText(scan));
    return;
  }

  const dsArg = option(args, "ds");
  if (!dsArg) {
    throw new Error("사용법: --ds <VWorld dsId[,dsId...]> [--region 시도,...] [--cadastral <raw/cadastral>]");
  }
  const dsIds = csv(dsArg);
  const regionValues = option(args, "region");
  const regions = regionValues ? new Set(csv(regionValues)) : null;
  const titlePrefix = option(args, "title-prefix");
  const since = option(args, "since");
  const delayValue = option(args, "delay-ms", "2000");
  const delayMs = Number(delayValue);
  if (!Number.isFinite(delayMs) || delayMs < 0) throw new Error(`--delay-ms는 0 이상 숫자여야 합니다: ${delayValue}`);

  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const id = process.env.VWORLD_ID;
  const pw = process.env.VWORLD_PW;
  if (!id || !pw) throw new Error("VWORLD_ID / VWORLD_PW가 .env.local에 없습니다.");

  const { VworldSession } = await import("../../lib/v2/ingest/vworld.ts");
  const sessionOptions = { delayMs };
  const base = option(args, "base");
  if (base) sessionOptions.base = base;
  const session = new VworldSession(sessionOptions);
  const login = await session.login(id, pw);
  if (login === "expirePw") console.warn("⚠ VWorld 비밀번호 사용기간이 지났습니다(로그인은 됨). 목록 조사를 계속합니다.");

  const rows = [];
  const failures = [];
  for (const dsId of dsIds) {
    try {
      const files = await session.listFiles(dsId, { since, titlePrefix });
      rows.push(...latestFullRows(files, regions));
    } catch (error) {
      failures.push(`${dsId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const scan = cadastral ? inspectCadastralFields(resolve(cadastral)) : null;
  if (hasFlag(args, "json")) {
    console.log(JSON.stringify(jsonPayload(dsIds, rows, failures, scan), null, 2));
  } else {
    console.log("공부면적 원천 조사 (다운로드 없음)");
    console.log(`조회 dsId: ${dsIds.join(", ")} · 선택 행: ${rows.length} · 다운로드: 0건`);
    if (regions) console.log(`시도 필터: ${[...regions].join(", ")}`);
    console.log(table(rows));
    if (failures.length > 0) console.log(`\n조회 실패:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
    if (scan) console.log(`\n${cadastralText(scan)}`);
    console.log("\n판정: 토지특성정보·토지대장의 이용조건은 목록 결과와 상세 페이지 문구를 대조한 뒤 적재 승인 여부를 결정합니다.");
  }
  if (failures.length > 0) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
