/** v2 프로젝트 API가 공유하는 입력 한도·오류 판정. 라우트는 인증과 DB 수명을 담당한다. */

import type { SavedProject, SavedProjectSummary } from "./app-db";

export const MAX_PROJECT_BOARD_BYTES = 2 * 1024 * 1024;
export const PROJECT_NAME_MAX_LENGTH = 120;
export const DATA_VERSION_GONE_MESSAGE = "데이터가 갱신되어 다시 분석이 필요합니다";

export type ProjectPayload = {
  name: string;
  analysisId: string;
  board: unknown;
  projectId?: string;
};

export type ProjectPayloadResult =
  | { ok: true; value: ProjectPayload }
  | { ok: false; status: 400 | 413; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function parseProjectPayload(raw: unknown): ProjectPayloadResult {
  if (!isRecord(raw)) return { ok: false, status: 400, error: "요청 형식이 올바르지 않습니다" };
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const analysisId = typeof raw.analysisId === "string" ? raw.analysisId.trim() : "";
  const projectId = raw.projectId === undefined ? undefined : typeof raw.projectId === "string" ? raw.projectId.trim() : "";
  if (name.length < 1 || name.length > PROJECT_NAME_MAX_LENGTH) {
    return { ok: false, status: 400, error: `프로젝트 이름은 1~${PROJECT_NAME_MAX_LENGTH}자로 입력해 주세요` };
  }
  if (analysisId.length < 1 || analysisId.length > 200) return { ok: false, status: 400, error: "분석 ID가 올바르지 않습니다" };
  if (projectId !== undefined && (projectId.length < 1 || projectId.length > 200)) return { ok: false, status: 400, error: "프로젝트 ID가 올바르지 않습니다" };
  let boardBytes: number;
  try {
    boardBytes = Buffer.byteLength(JSON.stringify(raw.board), "utf8");
  } catch {
    return { ok: false, status: 400, error: "보드 설정을 저장할 수 없습니다" };
  }
  if (boardBytes > MAX_PROJECT_BOARD_BYTES) {
    return { ok: false, status: 413, error: "보드 설정이 너무 큽니다. 2MB 이하로 줄여 주세요" };
  }
  return { ok: true, value: { name, analysisId, board: raw.board, ...(projectId === undefined ? {} : { projectId }) } };
}

export type ProjectNameResult =
  | { ok: true; name: string }
  | { ok: false; status: 400; error: string };

export function parseProjectName(raw: unknown): ProjectNameResult {
  if (!isRecord(raw) || typeof raw.name !== "string") return { ok: false, status: 400, error: "프로젝트 이름이 필요합니다" };
  const name = raw.name.trim();
  if (name.length < 1 || name.length > PROJECT_NAME_MAX_LENGTH) {
    return { ok: false, status: 400, error: `프로젝트 이름은 1~${PROJECT_NAME_MAX_LENGTH}자로 입력해 주세요` };
  }
  return { ok: true, name };
}

export function isDataVersionGone(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("DATA_VERSION_GONE:");
}

export function isProjectNotFound(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("PROJECT_NOT_FOUND:");
}

export function projectToJson(project: SavedProject | SavedProjectSummary, dataVersionAvailable = true): Record<string, unknown> {
  const body: Record<string, unknown> = {
    projectId: project.projectId,
    name: project.name,
    analysisId: project.analysisId,
    address: project.address,
    label: project.address,
    radiusM: project.radiusM,
    analysisDate: project.analysisDate,
    dataVersion: project.dataVersion,
    engineVersion: project.engineVersion,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    dataVersionAvailable,
  };
  if ("board" in project && project.board !== undefined) body.board = project.board;
  return body;
}
