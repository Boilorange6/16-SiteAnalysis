import type { Apartment, Poi, PoiCategory, School } from "./types";
import { CATEGORY_COLORS } from "./types";

const CATEGORY_INITIALS: Record<PoiCategory, string> = {
  apartment: "A",
  subway: "T",
  school: "S",
  park: "P",
  mountain: "M",
};

const SCHOOL_LEVEL_LABELS: Record<School["level"], string> = {
  elementary: "초등학교",
  middle: "중학교",
  high: "고등학교",
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function getPoiColor(poi: Poi): string {
  if (poi.category === "subway") {
    return poi.lineColor;
  }

  return CATEGORY_COLORS[poi.category];
}

export function getClusterColor(items: readonly Poi[]): string {
  if (items.length === 0) {
    return "#64748B";
  }

  const counts = new Map<PoiCategory, number>();
  items.forEach((item) => counts.set(item.category, (counts.get(item.category) ?? 0) + 1));

  let dominantCategory = items[0].category;
  let dominantCount = 0;
  counts.forEach((count, category) => {
    if (count > dominantCount) {
      dominantCategory = category;
      dominantCount = count;
    }
  });

  return CATEGORY_COLORS[dominantCategory];
}

export function getPoiExtra(poi: Poi): string {
  switch (poi.category) {
    case "subway":
      return poi.line;
    case "school":
      return SCHOOL_LEVEL_LABELS[poi.level];
    case "park":
      return `${poi.type} · ${(poi.area_sqm / 10000).toFixed(1)}만㎡`;
    case "mountain":
      return `${poi.elevation_m.toLocaleString()}m`;
    case "apartment": {
      const apartment = poi as Apartment;
      return `${apartment.units.toLocaleString()}세대 · ${apartment.price_per_pyeong.toLocaleString()}만원/평`;
    }
  }
}

export function createLabel(title: string, subtitle: string): string {
  return `
    <div style="
      min-width: 96px;
      padding: 7px 10px;
      border-radius: 8px;
      background: rgba(15, 23, 42, 0.88);
      border: 1px solid rgba(255, 255, 255, 0.18);
      box-shadow: 0 8px 24px rgba(15, 23, 42, 0.28);
      color: #FFFFFF;
      text-align: center;
      backdrop-filter: blur(6px);
    ">
      <div style="font-size: 12px; line-height: 1.25; font-weight: 800;">${escapeHtml(title)}</div>
      <div style="margin-top: 3px; font-size: 10px; line-height: 1.2; color: rgba(255, 255, 255, 0.68);">${escapeHtml(subtitle)}</div>
    </div>
  `;
}

export function createIcon(
  category: PoiCategory,
  color: string,
  L: typeof import("leaflet")
): import("leaflet").DivIcon {
  return L.divIcon({
    className: "",
    iconAnchor: [14, 14],
    iconSize: [28, 28],
    html: `
      <div style="
        width: 28px;
        height: 28px;
        display: grid;
        place-items: center;
        border-radius: 999px;
        background: ${escapeHtml(color)};
        border: 2px solid #FFFFFF;
        box-shadow: 0 8px 18px rgba(15, 23, 42, 0.35);
        color: #FFFFFF;
        font-size: 11px;
        font-weight: 900;
        line-height: 1;
      ">${CATEGORY_INITIALS[category]}</div>
    `,
  });
}

export function createClusterIcon(
  count: number,
  color: string,
  L: typeof import("leaflet")
): import("leaflet").DivIcon {
  return L.divIcon({
    className: "",
    iconAnchor: [18, 18],
    iconSize: [36, 36],
    html: `
      <div style="
        width: 36px;
        height: 36px;
        display: grid;
        place-items: center;
        border-radius: 999px;
        background: ${escapeHtml(color)};
        border: 3px solid #FFFFFF;
        box-shadow: 0 10px 24px rgba(15, 23, 42, 0.42);
        color: #FFFFFF;
        font-size: 12px;
        font-weight: 900;
        line-height: 1;
      ">${count.toLocaleString()}</div>
    `,
  });
}
