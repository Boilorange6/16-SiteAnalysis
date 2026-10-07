import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isUser } from "@/lib/server/auth";
import { listProjects, loadProject, openV2AppDb, saveProject } from "@/lib/v2/app-db";
import { isDataVersionGone, isProjectNotFound, parseProjectPayload, projectToJson, DATA_VERSION_GONE_MESSAGE } from "@/lib/v2/project-api";
import { readArchivedManifest } from "@/lib/v2/data/manifest";
import { v2DataDir } from "@/lib/v2/paths";

export const runtime = "nodejs";

function errorResponse(error: unknown): NextResponse {
  if (isDataVersionGone(error)) return NextResponse.json({ error: DATA_VERSION_GONE_MESSAGE, code: "DATA_VERSION_GONE" }, { status: 409 });
  if (isProjectNotFound(error) || (error instanceof Error && error.message.startsWith("unknown analysis"))) {
    return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다" }, { status: 404 });
  }
  console.error("v2 project request failed", error);
  return NextResponse.json({ error: "프로젝트를 저장하지 못했습니다" }, { status: 500 });
}
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!isUser(auth)) return auth;
  const appDb = openV2AppDb();
  try {
    const projects = listProjects(appDb, auth.id).map((project) => projectToJson(project, !!readArchivedManifest(v2DataDir(), project.dataVersion)));
    return NextResponse.json({ projects });
  } finally {
    appDb.close();
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!isUser(auth)) return auth;
  const parsed = parseProjectPayload(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const projectId = parsed.value.projectId ?? randomUUID();
  const appDb = openV2AppDb();
  try {
    await saveProject(appDb, v2DataDir(), { ...parsed.value, projectId, userId: auth.id });
    const project = loadProject(appDb, projectId, auth.id);
    if (!project) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다" }, { status: 404 });
    return NextResponse.json({ project: projectToJson(project, true) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  } finally {
    appDb.close();
  }
}
