import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyToken } from "@/lib/server/jwt";
import { getUserById } from "@/lib/server/user-store";
import type { Poi, SubwayStation, School, Park, Mountain, Apartment, Officetel, ResidentialOther, ResidentialPoi, MaintenanceCatalogProject, SourceStatus } from "@/lib/types";
import {
  overpassPoiSearch,
  getElementCoords,
  classifyElement,
  inferSchoolLevel,
  inferSubwayLine,
  type OverpassElement,
} from "@/lib/overpass-api";
import { searchResidentialFromLedger } from "@/lib/server/residential-search";
import { mergeResidentialPois, searchPlannedResidential } from "@/lib/server/planned-residential-search";
import { searchParks } from "@/lib/server/park-search";
import { searchMaintenanceProjects } from "@/lib/server/maintenance-project-search";
import { attachRecentTrades } from "@/lib/server/rtms-trades";
import { crossCheckMaintenanceCompletion } from "@/lib/server/maintenance/completion-crosscheck";
import { resolveSource } from "@/lib/server/poi-cache";

const querySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radius: z.coerce.number().int().min(100).max(20000).default(3000),
  planned: z
    .string()
    .default("true")
    .transform((val) => val !== "false"),
  categories: z
    .string()
    .default("subway,school,park,mountain,apartment,officetel,residential,maintenance")
    .transform((val) => val.split(",").map((s) => s.trim())),
  // 1단계 데이터 신뢰성: "true"면 소스별 캐시를 무시하고 강제 재수집
  refresh: z.string().optional().transform((v) => v === "true"),
});

// M-1: Extract token from Authorization header or HttpOnly cookie
async function extractUserId(req: NextRequest): Promise<number | undefined> {
  let token: string | undefined;

  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    token = authHeader.slice(7);
  } else {
    token = req.cookies.get("site_access_token")?.value;
  }

  if (!token) return undefined;

  try {
    const payload = await verifyToken(token);
    if (payload.kind !== "access") return undefined;
    const user = getUserById(Number(payload.sub));
    return user?.id;
  } catch {
    return undefined;
  }
}

function elementToPoi(el: OverpassElement, category: string, index: number): Poi | null {
  const coords = getElementCoords(el);
  if (!coords) return null;

  const tags = el.tags ?? {};
  const name =
    tags["name:ko"] ??
    tags["name"] ??
    tags["official_name"] ??
    `${category}-${el.id}`;

  const baseId = `osm-${el.type}-${el.id}`;

  switch (category) {
    case "subway": {
      const lineName = tags["network"] ?? tags["operator"] ?? tags["line"] ?? name;
      const { line, lineColor } = inferSubwayLine(lineName + " " + name, tags["ref"]);
      return {
        id: baseId,
        name,
        lat: coords.lat,
        lng: coords.lng,
        category: "subway",
        line,
        lineColor,
      } satisfies SubwayStation;
    }
    case "school": {
      return {
        id: baseId,
        name,
        lat: coords.lat,
        lng: coords.lng,
        category: "school",
        level: inferSchoolLevel(name),
      } satisfies School;
    }
    case "park": {
      const areaSqm = tags["area"] ? Number(tags["area"]) : 0;
      return {
        id: baseId,
        name,
        lat: coords.lat,
        lng: coords.lng,
        category: "park",
        area_sqm: areaSqm,
        type: "공원",
      } satisfies Park;
    }
    case "mountain": {
      const elevation = tags["ele"] ? Number(tags["ele"]) : 0;
      return {
        id: baseId,
        name,
        lat: coords.lat,
        lng: coords.lng,
        category: "mountain",
        elevation_m: elevation,
      } satisfies Mountain;
    }
    case "apartment":
    case "officetel":
    case "residential": {
      // Skip individual building entries and meaningless names
      // "503동", "102동", "A동", "가동", "나동" etc. are building-level, not complex-level
      if (!name || /^[\d\s]+동?$/.test(name) || !/[가-힣]/.test(name)) return null;
      if (/^[A-Za-z가-힣]동$/.test(name)) return null;
      const units = tags["building:units"] ? Math.round(Number(tags["building:units"])) : 0;
      const parkingCount = tags["parking:spaces"] ? Math.round(Number(tags["parking:spaces"])) : 0;
      const saleDate = (tags["start_date"] ?? "").slice(0, 7).replace(/[~?]/, "");
      return {
        id: baseId,
        name,
        lat: coords.lat,
        lng: coords.lng,
        category,
        units,
        parking_count: parkingCount,
        sale_date: saleDate,
        distance_m: 0,
        status: "existing",
        source: "ledger",
      } as Apartment | Officetel | ResidentialOther;
    }
    default:
      return null;
  }
}

export async function GET(req: NextRequest) {
  // M-3: Require authentication
  const userId = await extractUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;

  const parsed = querySchema.safeParse({
    lat: searchParams.get("lat") ?? "",
    lng: searchParams.get("lng") ?? "",
    radius: searchParams.get("radius") ?? 3000,
    planned: searchParams.get("planned") ?? "true",
    categories: searchParams.get("categories") ?? "subway,school,park,mountain,apartment,officetel,residential,maintenance",
    refresh: searchParams.get("refresh") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 }
    );
  }

  const { lat, lng, radius, planned, categories, refresh } = parsed.data;

  try {
    // ── Non-residential POIs from OSM ──────────────────────────────────────
    const osmCategories = categories.filter((c) =>
      c !== "apartment" &&
      c !== "officetel" &&
      c !== "residential" &&
      c !== "park" &&
      c !== "maintenance"
    );
    const pois: Poi[] = [];
    const sourceWarnings: string[] = [];
    const sources: SourceStatus[] = [];
    const maintenanceCatalog: MaintenanceCatalogProject[] = [];

    if (categories.includes("park")) {
      const r = await resolveSource<Park[]>({
        source: "park", lat, lng, radiusM: radius, refresh,
        fetcher: () => searchParks(lat, lng, radius),
      });
      sources.push({ source: "park", status: r.status, fetchedAt: r.fetchedAt });
      if (r.value) {
        pois.push(...r.value);
      } else {
        console.warn("[park-search] Source unavailable");
        sourceWarnings.push("park");
      }
    }

    if (categories.includes("maintenance")) {
      const maintenance = await searchMaintenanceProjects({
        center: { lat, lng }, radiusM: radius, refresh,
      });
      pois.push(...maintenance.projects);
      sources.push(...maintenance.sources);
      sourceWarnings.push(...maintenance.warnings);
      maintenanceCatalog.push(...maintenance.catalog);
    }

    if (osmCategories.length > 0) {
      const r = await resolveSource<Poi[]>({
        source: "osm", lat, lng, radiusM: radius, refresh,
        fetcher: async () => {
          const elements = await overpassPoiSearch(lat, lng, radius);
          const seenIds = new Set<number>();
          const seenNames = new Set<string>();
          const converted: Poi[] = [];

          for (const el of elements) {
            if (seenIds.has(el.id)) continue;
            seenIds.add(el.id);

            const category = classifyElement(el);
            if (!category) continue;

            const poi = elementToPoi(el, category, converted.length);
            if (!poi) continue;

            const dedupeKey = `${category}:${poi.name}`;
            if (seenNames.has(dedupeKey)) continue;
            seenNames.add(dedupeKey);

            converted.push(poi);
          }

          return converted;
        },
      });
      sources.push({ source: "osm", status: r.status, fetchedAt: r.fetchedAt });
      if (r.value) {
        // 캐시는 osm 소스가 생성 가능한 전체 카테고리를 담고 있으므로 요청된 카테고리로 필터링
        for (const poi of r.value) {
          if (osmCategories.includes(poi.category)) {
            pois.push(poi);
          }
        }
      } else {
        console.warn("[overpass-poi-search] Source unavailable");
        sourceWarnings.push("osm");
      }
    }

    // ── Residential POIs from 건축물대장 ──────────────────────────────────
    const residentialCats = ["apartment", "officetel", "residential"] as const;
    const hasResidential = residentialCats.some((c) => categories.includes(c));

    if (hasResidential) {
      const residentialResult = await resolveSource<ResidentialPoi[]>({
        source: "residential", lat, lng, radiusM: radius, refresh,
        fetcher: () => searchResidentialFromLedger(lat, lng, radius),
      });
      sources.push({ source: "residential", status: residentialResult.status, fetchedAt: residentialResult.fetchedAt });
      if (!residentialResult.value) {
        console.warn("[residential-search] Source unavailable");
        sourceWarnings.push("residential");
      }

      let plannedPois: ResidentialPoi[] = [];
      if (planned) {
        const plannedResult = await resolveSource<ResidentialPoi[]>({
          source: "planned-residential", lat, lng, radiusM: radius, refresh,
          fetcher: () => searchPlannedResidential(lat, lng, radius),
        });
        sources.push({ source: "planned-residential", status: plannedResult.status, fetchedAt: plannedResult.fetchedAt });
        if (plannedResult.value) {
          plannedPois = plannedResult.value;
        } else {
          console.warn("[planned-residential-search] Source unavailable");
          sourceWarnings.push("planned-residential");
        }
      }

      for (const rp of mergeResidentialPois(residentialResult.value ?? [], plannedPois)) {
        if (categories.includes(rp.category)) {
          pois.push(rp);
        }
      }
    }

    // ── 신축 준공 교차검증: 폴리곤 안 최근 준공 대단지 존재 시 정비사업 제외 ──
    const crossCheck = crossCheckMaintenanceCompletion(pois);
    if (crossCheck.removedCount > 0) {
      sourceWarnings.push(`종료된 정비사업 ${crossCheck.removedCount}건 추가 제외(신축 준공 교차확인)`);
    }

    // ── 최근 실거래 요약 결합 (아파트 이름 매칭 · 정비구역 대표지번 매칭) ──
    let responsePois: readonly Poi[] = crossCheck.pois;
    if (crossCheck.pois.some((poi) => poi.category === "apartment" || poi.category === "officetel"
      || poi.category === "residential" || poi.category === "maintenance")) {
      const trades = await attachRecentTrades(crossCheck.pois, { lat, lng });
      responsePois = trades.pois;
      sources.push({ source: "rtms", status: trades.status, fetchedAt: trades.fetchedAt });
    }

    return NextResponse.json({ pois: responsePois, warnings: sourceWarnings, sources, maintenanceCatalog });
  } catch {
    // M-2: Generic error — don't expose internal details
    return NextResponse.json({ error: "POI 검색에 실패했습니다" }, { status: 500 });
  }
}
