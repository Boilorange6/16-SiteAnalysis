import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isUser } from "@/lib/server/auth";
import { getApiKeysMasked, saveApiKeys } from "@/lib/server/user-store";

const ALLOWED_KEYS = ["naver_id", "naver_secret", "naver_map_id", "naver_map_secret"];

export async function GET(req: NextRequest) {
  const result = await requireAuth(req);
  if (!isUser(result)) return result;

  const masked = getApiKeysMasked(result.id);
  return NextResponse.json({ keys: masked });
}

export async function PUT(req: NextRequest) {
  const result = await requireAuth(req);
  if (!isUser(result)) return result;

  try {
    const body = await req.json();
    const keysToSave: Record<string, string> = {};

    for (const key of ALLOWED_KEYS) {
      const value = body[key];
      if (typeof value === "string" && value.trim()) {
        keysToSave[key] = value.trim();
      }
    }

    if (Object.keys(keysToSave).length === 0) {
      return NextResponse.json(
        { error: "No valid keys provided" },
        { status: 400 }
      );
    }

    saveApiKeys(result.id, keysToSave);
    const masked = getApiKeysMasked(result.id);
    return NextResponse.json({ keys: masked });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
