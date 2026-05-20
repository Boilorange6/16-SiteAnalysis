import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isUser } from "@/lib/server/auth";
import { getApiKeysMasked } from "@/lib/server/user-store";
import type { ApiKeyStatusResponse } from "@/lib/project-types";

const API_KEY_FIELDS = [
  { key: "naver_id", label: "Naver 검색 Client ID", requiredFor: "주소 자동완성", envKey: "NAVER_CLIENT_ID" },
  { key: "naver_secret", label: "Naver 검색 Client Secret", requiredFor: "주소 자동완성", envKey: "NAVER_CLIENT_SECRET" },
  { key: "naver_map_id", label: "Naver 지도 Client ID", requiredFor: "좌표 보정/역지오코딩", envKey: "NCP_CLIENT_ID" },
  { key: "naver_map_secret", label: "Naver 지도 Client Secret", requiredFor: "좌표 보정/역지오코딩", envKey: "NCP_CLIENT_SECRET" },
] as const;

function maskKey(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.length > 4 ? "****" + value.slice(-4) : "****";
}

export async function GET(req: NextRequest) {
  const result = await requireAuth(req);
  if (!isUser(result)) return result;

  const masked = getApiKeysMasked(result.id);
  const items = API_KEY_FIELDS.map((field) => ({
    key: field.key,
    label: field.label,
    requiredFor: field.requiredFor,
    configured: Boolean(masked[field.key] ?? process.env[field.envKey]),
    masked: masked[field.key] ?? maskKey(process.env[field.envKey]),
  }));
  const configuredCount = items.filter((item) => item.configured).length;
  const response: ApiKeyStatusResponse = {
    ready: configuredCount === API_KEY_FIELDS.length,
    configuredCount,
    totalCount: API_KEY_FIELDS.length,
    items,
  };

  return NextResponse.json(response);
}
