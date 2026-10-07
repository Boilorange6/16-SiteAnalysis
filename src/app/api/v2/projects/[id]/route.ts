import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isUser } from "@/lib/server/auth";
import { deleteProject, loadProject, openV2AppDb, renameProject } from "@/lib/v2/app-db";
import { DATA_VERSION_GONE_MESSAGE, parseProjectName, projectToJson } from "@/lib/v2/project-api";
import { readArchivedManifest } from "@/lib/v2/data/manifest";
import { v2DataDir } from "@/lib/v2/paths";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

function goneResponse(project: ReturnType<typeof loadProject>): NextResponse {
  return NextResponse.json({
    error: DATA_VERSION_GONE_MESSAGE,
    code: "DATA_VERSION_GONE",
    project: project ? projectToJson(project, false) : undefined,
  }, { status: 409 });
}
export async function GET(req: NextRequest, { params }: Params) {
  const auth = await requireAuth(req);
  if (!isUser(auth)) return auth;
  const { id } = await params;
  const appDb = openV2AppDb();
  try {
    const project = loadProject(appDb, id, auth.id);
    if (!project) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다" }, { status: 404 });
    const available = !!readArchivedManifest(v2DataDir(), project.dataVersion);
    if (!available) return goneResponse(project);
    return NextResponse.json({ project: projectToJson(project, true) });
  } finally {
    appDb.close();
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await requireAuth(req);
  if (!isUser(auth)) return auth;
  const { id } = await params;
  const parsed = parseProjectName(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const appDb = openV2AppDb();
  try {
    const project = renameProject(appDb, id, auth.id, parsed.name);
    if (!project) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다" }, { status: 404 });
    return NextResponse.json({ project: projectToJson(project, !!readArchivedManifest(v2DataDir(), project.dataVersion)) });
  } finally {
    appDb.close();
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const auth = await requireAuth(req);
  if (!isUser(auth)) return auth;
  const { id } = await params;
  const appDb = openV2AppDb();
  try {
    if (!deleteProject(appDb, id, auth.id)) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다" }, { status: 404 });
    return NextResponse.json({ deleted: true, projectId: id });
  } finally {
    appDb.close();
  }
}
