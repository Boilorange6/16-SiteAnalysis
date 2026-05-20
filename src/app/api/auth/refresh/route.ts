import { NextRequest, NextResponse } from "next/server";
import { verifyToken, signAccessToken, signRefreshToken } from "@/lib/server/jwt";
import { getUserById, validateAndRotateSession } from "@/lib/server/user-store";
import { setAuthCookies } from "@/lib/server/auth";

export async function POST(req: NextRequest) {
  try {
    // M-1: Read refresh token from HttpOnly cookie first, then body (backward compat)
    let refreshToken = req.cookies.get("site_refresh_token")?.value;
    if (!refreshToken) {
      const body = await req.json().catch(() => ({})) as Record<string, unknown>;
      refreshToken = typeof body?.refresh_token === "string" ? body.refresh_token : undefined;
    }

    if (!refreshToken) {
      return NextResponse.json({ error: "refresh_token is required" }, { status: 400 });
    }

    const payload = await verifyToken(refreshToken);
    if (payload.kind !== "refresh") {
      return NextResponse.json({ error: "Invalid token type" }, { status: 401 });
    }

    const userId = Number(payload.sub);
    const user = getUserById(userId);
    if (!user || !user.is_active) {
      return NextResponse.json({ error: "User not found" }, { status: 401 });
    }

    const [accessToken, newRefreshToken] = await Promise.all([
      signAccessToken(user.id),
      signRefreshToken(user.id),
    ]);

    // C-1: Validate old session in DB and rotate to new token
    const valid = validateAndRotateSession(refreshToken, userId, newRefreshToken);
    if (!valid) {
      return NextResponse.json({ error: "Invalid or expired refresh token" }, { status: 401 });
    }

    const response = NextResponse.json({
      access_token: accessToken,
      refresh_token: newRefreshToken,
      user: { id: user.id, username: user.username, role: user.role },
    });
    // M-1: Set updated HttpOnly cookies
    setAuthCookies(response, accessToken, newRefreshToken);
    return response;
  } catch {
    return NextResponse.json({ error: "Invalid or expired refresh token" }, { status: 401 });
  }
}
