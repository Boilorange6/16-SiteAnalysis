import { NextRequest, NextResponse } from "next/server";
import { createUser, storeSession } from "@/lib/server/user-store";
import { signAccessToken, signRefreshToken } from "@/lib/server/jwt";
import { checkRateLimit } from "@/lib/server/rate-limiter";
import { setAuthCookies } from "@/lib/server/auth";

export async function POST(req: NextRequest) {
  // C-2: Rate limiting — 3 signups per hour per IP
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  const rateLimit = checkRateLimit(`signup:${ip}`, 3, 60 * 60 * 1000);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many signup attempts. Please try again later." },
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
    // H-2, H-3: Validated lengths
    if (username.length < 3 || username.length > 32) {
      return NextResponse.json(
        { error: "username must be 3–32 characters" },
        { status: 400 }
      );
    }
    if (password.length < 8 || password.length > 128) {
      return NextResponse.json(
        { error: "password must be 8–128 characters" },
        { status: 400 }
      );
    }

    let user;
    try {
      user = createUser(username, password);
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes("UNIQUE")) {
        return NextResponse.json({ error: "Username already exists" }, { status: 409 });
      }
      throw e;
    }

    const [accessToken, refreshToken] = await Promise.all([
      signAccessToken(user.id),
      signRefreshToken(user.id),
    ]);

    // C-1: Store refresh token hash in DB
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
