import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "./jwt";
import { getUserById, type User } from "./user-store";

// Only set secure flag when explicitly using HTTPS (not just production mode)
const IS_SECURE = process.env.COOKIE_SECURE === "true";
const ACCESS_TTL_SECONDS = 15 * 60;       // 15 minutes
const REFRESH_TTL_SECONDS = 14 * 24 * 60 * 60; // 14 days

// ─── Token extraction ─────────────────────────────────────────────────────────

function extractToken(req: NextRequest): string | null {
  // 1. Authorization header (kept for API compatibility)
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7);
  // 2. HttpOnly cookie (M-1: preferred for browser clients)
  return req.cookies.get("site_access_token")?.value ?? null;
}

// ─── Auth middleware ───────────────────────────────────────────────────────────

export async function requireAuth(
  req: NextRequest
): Promise<User | NextResponse> {
  const token = extractToken(req);
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const payload = await verifyToken(token);
    if (payload.kind !== "access") {
      return NextResponse.json({ error: "Invalid token type" }, { status: 401 });
    }
    const user = getUserById(Number(payload.sub));
    if (!user || !user.is_active) {
      return NextResponse.json({ error: "User not found" }, { status: 401 });
    }
    return user;
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }
}

export function isUser(result: User | NextResponse): result is User {
  return "id" in result;
}

// ─── Cookie helpers (M-1) ─────────────────────────────────────────────────────

const COOKIE_BASE = {
  httpOnly: true,
  sameSite: "strict" as const,
  path: "/",
  secure: IS_SECURE,
} as const;

export function setAuthCookies(
  response: NextResponse,
  accessToken: string,
  refreshToken: string,
): void {
  response.cookies.set({ name: "site_access_token", value: accessToken, maxAge: ACCESS_TTL_SECONDS, ...COOKIE_BASE });
  response.cookies.set({ name: "site_refresh_token", value: refreshToken, maxAge: REFRESH_TTL_SECONDS, ...COOKIE_BASE });
}

export function clearAuthCookies(response: NextResponse): void {
  response.cookies.set({ name: "site_access_token", value: "", maxAge: 0, ...COOKIE_BASE });
  response.cookies.set({ name: "site_refresh_token", value: "", maxAge: 0, ...COOKIE_BASE });
}
