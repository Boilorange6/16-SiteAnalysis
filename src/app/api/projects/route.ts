import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, isUser } from "@/lib/server/auth";
import { createAnalysisProject, listAnalysisProjects } from "@/lib/server/project-store";
import type { AnalysisProjectPayload } from "@/lib/project-types";

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

const createSchema = z.object({
  title: z.string().trim().min(1).max(80),
  payload: projectPayloadSchema,
});

export async function GET(req: NextRequest) {
  const result = await requireAuth(req);
  if (!isUser(result)) return result;

  return NextResponse.json({ projects: listAnalysisProjects(result.id) });
}

export async function POST(req: NextRequest) {
  const result = await requireAuth(req);
  if (!isUser(result)) return result;

  try {
    const parsed = createSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const project = createAnalysisProject(
      result.id,
      parsed.data.title,
      parsed.data.payload as unknown as AnalysisProjectPayload,
    );
    return NextResponse.json({ project }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "프로젝트 저장에 실패했습니다" }, { status: 500 });
  }
}
