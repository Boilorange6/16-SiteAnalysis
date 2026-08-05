import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, isUser } from "@/lib/server/auth";
import { loadRailNetworkSnapshot, queryRailNetwork } from "@/lib/server/rail-network-store";

const querySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radius: z.coerce.number().int().min(100).max(50000).default(5400),
  include: z.string().optional().default("operational").transform((value) => new Set(value.split(",").map((item) => item.trim()))),
});

let snapshot: ReturnType<typeof loadRailNetworkSnapshot> | null = null;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const authResult = await requireAuth(req);
  if (!isUser(authResult)) return authResult;

  const parsed = querySchema.safeParse({
    lat: req.nextUrl.searchParams.get("lat") ?? "",
    lng: req.nextUrl.searchParams.get("lng") ?? "",
    radius: req.nextUrl.searchParams.get("radius") ?? 5400,
    include: req.nextUrl.searchParams.get("include") ?? "operational",
  });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid rail query" }, { status: 400 });
  }

  try {
    const currentSnapshot = snapshot ?? loadRailNetworkSnapshot();
    snapshot = currentSnapshot;
    const result = queryRailNetwork(currentSnapshot, { lat: parsed.data.lat, lng: parsed.data.lng, radiusM: parsed.data.radius });
    const includePlanned = parsed.data.include.has("planned");
    return NextResponse.json({ ...result, plannedProjects: includePlanned ? result.plannedProjects : [] });
  } catch (error) {
    if (error instanceof Error) {
      console.error("rail-network query failed", { message: error.message });
    }
    snapshot = null;
    return NextResponse.json({ error: "철도 네트워크 데이터를 불러오지 못했습니다." }, { status: 503 });
  }
}
