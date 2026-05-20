import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isUser } from "@/lib/server/auth";

export async function GET(req: NextRequest) {
  const result = await requireAuth(req);
  if (!isUser(result)) return result;

  return NextResponse.json({
    id: result.id,
    username: result.username,
    role: result.role,
  });
}
