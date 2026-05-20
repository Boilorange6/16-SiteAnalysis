import { NextRequest, NextResponse } from "next/server";
import { deleteSession } from "@/lib/server/user-store";
import { clearAuthCookies } from "@/lib/server/auth";

export async function POST(req: NextRequest) {
  // C-1: Invalidate refresh token in DB
  const refreshToken = req.cookies.get("site_refresh_token")?.value;
  if (refreshToken) {
    deleteSession(refreshToken);
  }

  const response = NextResponse.json({ ok: true });
  // M-1: Clear HttpOnly cookies
  clearAuthCookies(response);
  return response;
}
