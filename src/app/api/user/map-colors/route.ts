import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isUser } from "@/lib/server/auth";
import { deleteMapColor, listMapColors, parseMapColorBody, saveMapColor } from "@/lib/server/map-color-store";

export async function GET(req: NextRequest) {
  const result = await requireAuth(req);
  if (!isUser(result)) return result;
  return NextResponse.json(listMapColors(result.id));
}

export async function POST(req: NextRequest) {
  const result = await requireAuth(req);
  if (!isUser(result)) return result;
  const body = await req.json().catch(() => null);
  const parsed = parseMapColorBody(body);
  if (!parsed) return NextResponse.json({ error: "Invalid map colors" }, { status: 400 });
  return NextResponse.json(saveMapColor(result.id, parsed.kind, parsed.colors));
}

export async function DELETE(req: NextRequest) {
  const result = await requireAuth(req);
  if (!isUser(result)) return result;
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id) || !deleteMapColor(result.id, id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
