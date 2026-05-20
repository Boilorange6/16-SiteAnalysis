import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { overpassSubwayRoutes } from "@/lib/overpass-subway-routes";
import { requireAuth, isUser } from "@/lib/server/auth";
import type { SubwayRoute } from "@/lib/types";

const querySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radius: z.coerce.number().int().min(100).max(50000).default(5400),
});

interface CacheEntry {
  routes: SubwayRoute[];
  ts: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_CACHE_SIZE = 200;           // M-4: bounded cache

export async function GET(req: NextRequest) {
  // M-3: Require authentication
  const authResult = await requireAuth(req);
  if (!isUser(authResult)) return authResult;

  const { searchParams } = req.nextUrl;

  const parsed = querySchema.safeParse({
    lat: searchParams.get("lat") ?? "",
    lng: searchParams.get("lng") ?? "",
    radius: searchParams.get("radius") ?? 5400,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 }
    );
  }

  const { lat, lng, radius } = parsed.data;
  const cacheKey = `${lat.toFixed(4)}-${lng.toFixed(4)}-${radius}`;

  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return NextResponse.json({ routes: cached.routes });
  }

  try {
    const routes = await overpassSubwayRoutes(lat, lng, radius);
    // M-4: Evict oldest entry when cache is full
    if (cache.size >= MAX_CACHE_SIZE) {
      const oldest = cache.keys().next().value;
      if (oldest) cache.delete(oldest);
    }
    cache.set(cacheKey, { routes, ts: Date.now() });
    return NextResponse.json({ routes });
  } catch {
    // M-2: Generic error — don't expose internal details
    return NextResponse.json({ error: "지하철 노선 검색에 실패했습니다" }, { status: 500 });
  }
}
