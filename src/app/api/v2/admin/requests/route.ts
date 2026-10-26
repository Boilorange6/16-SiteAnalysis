import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, isUser } from "@/lib/server/auth";
import { openV2AppDb } from "@/lib/v2/app-db";
import { createTileRequest, isPng, listTileRequests, MAX_REQUEST_PNG_BYTES, validateRequestInput } from "@/lib/v2/admin/requests";
import { v2AppDbPath } from "@/lib/v2/paths";

export const runtime = "nodejs";

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (!isUser(auth)) return auth;
  const db = openV2AppDb(v2AppDbPath());
  try {
    const tile = req.nextUrl.searchParams.get("tile") ?? undefined;
    return NextResponse.json({ requests: listTileRequests(db, tile ? { tileCode: tile } : undefined) });
  } finally {
    db.close();
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (!isUser(auth)) return auth;
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다" }, { status: 400 });
  }
  const tileCode = field(form, "tileCode");
  const memo = field(form, "memo");
  let pins: unknown;
  let context: Record<string, unknown>;
  try {
    pins = JSON.parse(field(form, "pins") || "[]");
    const parsedContext = JSON.parse(field(form, "context") || "{}");
    if (!parsedContext || typeof parsedContext !== "object" || Array.isArray(parsedContext)) throw new Error("context");
    context = parsedContext as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다" }, { status: 400 });
  }
  const validated = validateRequestInput({ tileCode, memo, pins });
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });
  const imageValue = form.get("image");
  let png: Uint8Array | null = null;
  if (imageValue !== null) {
    if (typeof imageValue === "string" || typeof (imageValue as File).arrayBuffer !== "function") {
      return NextResponse.json({ error: "PNG 그림만 올릴 수 있습니다" }, { status: 400 });
    }
    png = new Uint8Array(await (imageValue as File).arrayBuffer());
    if (png.length > MAX_REQUEST_PNG_BYTES) return NextResponse.json({ error: "그림은 5 MB까지입니다" }, { status: 400 });
    if (!isPng(png)) return NextResponse.json({ error: "PNG 그림만 올릴 수 있습니다" }, { status: 400 });
  }
  const db = openV2AppDb(v2AppDbPath());
  try {
    const request = createTileRequest(db, {
      tileCode,
      analysisId: field(form, "analysisId") || null,
      memo,
      pins: validated.pins,
      context,
      png,
      userId: auth.id,
    });
    return NextResponse.json({ request }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "요청을 저장하지 못했습니다" }, { status: 400 });
  } finally {
    db.close();
  }
}
