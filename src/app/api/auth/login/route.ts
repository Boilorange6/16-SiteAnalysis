import { NextRequest, NextResponse } from "next/server";
import { authenticate, storeSession } from "@/lib/server/user-store";
import { signAccessToken, signRefreshToken } from "@/lib/server/jwt";
import { checkRateLimit } from "@/lib/server/rate-limiter";
import { setAuthCookies } from "@/lib/server/auth";

export async function POST(req: NextRequest) {
  // C-2: Rate limiting — 5 attempts per 15 minutes per IP
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  const rateLimit = checkRateLimit(`login:${ip}`, 5, 15 * 60 * 1000);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many login attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfter) } }
    );
  }

  try {
    const { username, password } = await req.json();
    if (!username || !password) {
      return NextResponse.json(
        { error: "username and password are required" },
        { status: 400 }
      );
    }

    const user = authenticate(username, password);
    if (!user) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const [accessToken, refreshToken] = await Promise.all([
      signAccessToken(user.id),
      signRefreshToken(user.id),
    ]);

    // C-1: Store refresh token hash in DB for invalidation support
    storeSession(user.id, refreshToken);

    const response = NextResponse.json({
      access_token: accessToken,
      refresh_token: refreshToken,
      user: { id: user.id, username: user.username, role: user.role },
    });
    // M-1: Set HttpOnly cookies
    setAuthCookies(response, accessToken, refreshToken);
    return response;
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
