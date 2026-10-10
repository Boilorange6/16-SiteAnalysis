import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isUser } from "@/lib/server/auth";
import { parseScene } from "@/lib/v2/scene";
import { sceneTo3dm } from "@/lib/v2/export/rhino";

export const runtime = "nodejs";

/** 장면(JSON) → 3DM. rhino3dm(WASM)은 Node 전용 경로를 참조해 브라우저 번들에 넣지 않고 서버에서 변환한다. */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!isUser(auth)) return auth;
  let scene;
  try {
    scene = parseScene(await req.json());
  } catch {
    return NextResponse.json({ error: "장면 형식이 올바르지 않습니다" }, { status: 400 });
  }
  const bytes = await sceneTo3dm(scene);
  return new NextResponse(Buffer.from(bytes), { headers: { "Content-Type": "application/octet-stream" } });
}
