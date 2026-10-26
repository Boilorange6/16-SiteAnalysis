import { TILE_CATALOG } from "../ui/tile-catalog";
import { getTileRequest, listTileRequests, REQUEST_STATUSES, transitionTileRequest, type RequestStatus, type TileRequest } from "./requests";
import type BetterSqlite3 from "better-sqlite3";

type Db = BetterSqlite3.Database;

const usage = `사용법:
  tile-requests list [--status 대기|진행|완료|보류]
  tile-requests show <id>
  tile-requests start <id>
  tile-requests done <id> --commit <sha> --note "<처리 메모>"
  tile-requests hold <id> --note "<보류 이유>"`;

function numberText(value: number): string {
  return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function dateTime(value: string): string {
  return value.length >= 16 ? value.slice(0, 16).replace("T", " ") : value;
}

function pinsText(request: TileRequest): string {
  if (request.pins.length === 0) return "없음";
  return request.pins.map((pin, index) => `${index + 1}(${numberText(pin.x)}, ${numberText(pin.y)})`).join(", ");
}

function filesText(request: TileRequest): string {
  const files = request.context.files;
  if (!Array.isArray(files)) return "없음";
  const names = files.filter((file): file is string => typeof file === "string");
  return names.length > 0 ? names.join(", ") : "없음";
}

function header(request: TileRequest): string {
  const title = TILE_CATALOG[request.tileCode as keyof typeof TILE_CATALOG]?.title ?? request.tileCode;
  return `#${request.id} [${request.status}] ${request.tileCode} ${title} · ${dateTime(request.createdAt)}`;
}

function block(request: TileRequest, includeContext = false): string {
  const lines = [
    header(request),
    `  메모: ${request.memo || "없음"}`,
    `  핀: ${pinsText(request)}`,
    `  그림: ${request.imagePath ?? "없음"}`,
    `  파일: ${filesText(request)}`,
  ];
  if (request.reopenNote) lines.push(`  다시 열기: ${request.reopenNote}`);
  if (includeContext) lines.push(`  맥락: ${JSON.stringify(request.context)}`);
  return lines.join("\n");
}

function idFrom(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function statusFrom(value: string | undefined): RequestStatus | null {
  return value && REQUEST_STATUSES.includes(value as RequestStatus) ? value as RequestStatus : null;
}

function option(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function failure(out: string): { code: 1; out: string } {
  return { code: 1, out };
}

export function runTileRequestsCli(argv: string[], db: Db): { code: 0 | 1; out: string } {
  const command = argv[0];
  if (command === "list") {
    const statusValue = option(argv, "--status");
    const status = statusValue === undefined ? "대기" : statusFrom(statusValue);
    if (!status) return failure(`알 수 없는 상태입니다\n${usage}`);
    const requests = listTileRequests(db, { status });
    return { code: 0, out: requests.length > 0 ? requests.map((request) => block(request)).join("\n") : `${status} 요청이 없습니다` };
  }
  if (command === "show") {
    const id = idFrom(argv[1]);
    const request = id === null ? null : getTileRequest(db, id);
    if (!request) return failure("없는 요청입니다");
    return { code: 0, out: block(request, true) };
  }
  if (command === "start" || command === "done" || command === "hold") {
    const id = idFrom(argv[1]);
    if (id === null) return failure(usage);
    const to = command === "start" ? "진행" : command === "done" ? "완료" : "보류";
    const result = transitionTileRequest(db, id, to, { commit: option(argv, "--commit"), note: option(argv, "--note") });
    return result.ok ? { code: 0, out: block(result.request) } : failure(result.error);
  }
  return failure(usage);
}
