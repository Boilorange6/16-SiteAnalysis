import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyToken } from "@/lib/server/jwt";
import { getUserById } from "@/lib/server/user-store";
import type { Poi, SubwayStation, School, Park, Mountain, Apartment, Officetel, ResidentialOther, ResidentialPoi, MaintenanceProject } from "@/lib/types";
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
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 }
    );
  }

  const { lat, lng, radius, planned, categories } = parsed.data;

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

    if (categories.includes("park")) {
      const parks = await searchParks(lat, lng, radius)
        .catch((err) => {
          console.warn("[park-search] Source unavailable:", err);
          sourceWarnings.push("park");
          return [] as Park[];
        });
      pois.push(...parks);
    }

    if (categories.includes("maintenance")) {
      const projects = await searchMaintenanceProjects(lat, lng, radius)
        .catch((err) => {
          console.warn("[maintenance-project-search] Source unavailable:", err);
          sourceWarnings.push("maintenance");
          return [] as MaintenanceProject[];
        });
      pois.push(...projects);
    }

    if (osmCategories.length > 0) {
      const elements = await overpassPoiSearch(lat, lng, radius)
        .catch((err) => {
          console.warn("[overpass-poi-search] Source unavailable:", err);
          sourceWarnings.push("osm");
          return [] as OverpassElement[];
        });
      const seenIds = new Set<number>();
      const seenNames = new Set<string>();

      for (const el of elements) {
        if (seenIds.has(el.id)) continue;
        seenIds.add(el.id);

        const category = classifyElement(el);
        if (!category || !osmCategories.includes(category)) continue;

        const poi = elementToPoi(el, category, pois.length);
        if (!poi) continue;

        const dedupeKey = `${category}:${poi.name}`;
        if (seenNames.has(dedupeKey)) continue;
        seenNames.add(dedupeKey);

        pois.push(poi);
      }
    }

    // ── Residential POIs from 건축물대장 ──────────────────────────────────
    const residentialCats = ["apartment", "officetel", "residential"] as const;
    const hasResidential = residentialCats.some((c) => categories.includes(c));

    if (hasResidential) {
      const residentialPois = await searchResidentialFromLedger(lat, lng, radius)
        .catch((err) => {
          console.warn("[residential-search] Source unavailable:", err);
          sourceWarnings.push("residential");
          return [] as ResidentialPoi[];
        });
      const plannedPois = planned
        ? await searchPlannedResidential(lat, lng, radius)
          .catch((err) => {
            console.warn("[planned-residential-search] Source unavailable:", err);
            sourceWarnings.push("planned-residential");
            return [] as ResidentialPoi[];
          })
        : [];

      for (const rp of mergeResidentialPois(residentialPois, plannedPois)) {
        if (categories.includes(rp.category)) {
          pois.push(rp);
        }
      }
    }

    return NextResponse.json({ pois, warnings: sourceWarnings });
  } catch {
    // M-2: Generic error — don't expose internal details
    return NextResponse.json({ error: "POI 검색에 실패했습니다" }, { status: 500 });
  }
}
