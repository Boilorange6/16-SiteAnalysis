import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, isUser } from "@/lib/server/auth";
import { deleteAnalysisProject, getAnalysisProject, updateAnalysisProject } from "@/lib/server/project-store";
import type { AnalysisProjectPayload } from "@/lib/project-types";

const paramsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const projectPayloadSchema = z.object({
  config: z.object({
    centerName: z.string(),
    centerLat: z.number(),
    centerLng: z.number(),
    radiusKm: z.number().positive(),
  }),
  layers: z.record(z.string(), z.boolean()),
  manualPois: z.array(z.any()),
  apartmentFilter: z.object({
    enabled: z.boolean(),
    minYear: z.number(),
  }),
});

const updateSchema = z.object({
  title: z.string().trim().min(1).max(80),
  payload: projectPayloadSchema,
});

async function getProjectId(context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  return paramsSchema.safeParse(params);
}

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const result = await requireAuth(req);
  if (!isUser(result)) return result;

  const parsedParams = await getProjectId(context);
  if (!parsedParams.success) {
    return NextResponse.json({ error: "잘못된 프로젝트 ID입니다" }, { status: 400 });
  }

  const project = getAnalysisProject(result.id, parsedParams.data.id);
  if (!project) {
    return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다" }, { status: 404 });
  }
  return NextResponse.json({ project });
}

export async function PUT(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const result = await requireAuth(req);
  if (!isUser(result)) return result;

  const parsedParams = await getProjectId(context);
  if (!parsedParams.success) {
    return NextResponse.json({ error: "잘못된 프로젝트 ID입니다" }, { status: 400 });
  }

  try {
    const parsed = updateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const project = updateAnalysisProject(
      result.id,
      parsedParams.data.id,
      parsed.data.title,
      parsed.data.payload as unknown as AnalysisProjectPayload,
    );
    if (!project) {
      return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다" }, { status: 404 });
    }
    return NextResponse.json({ project });
  } catch {
    return NextResponse.json({ error: "프로젝트 업데이트에 실패했습니다" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const result = await requireAuth(req);
  if (!isUser(result)) return result;

  const parsedParams = await getProjectId(context);
  if (!parsedParams.success) {
    return NextResponse.json({ error: "잘못된 프로젝트 ID입니다" }, { status: 400 });
  }

  const deleted = deleteAnalysisProject(result.id, parsedParams.data.id);
  if (!deleted) {
    return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
