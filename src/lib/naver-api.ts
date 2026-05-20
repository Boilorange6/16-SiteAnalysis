const NAVER_SEARCH_URL = "https://openapi.naver.com/v1/search/local.json";

export interface NaverLocalItem {
  title: string;
  link: string;
  category: string;
  description: string;
  telephone: string;
  address: string;
  roadAddress: string;
  mapx: string;
  mapy: string;
}

interface NaverLocalResponse {
  lastBuildDate: string;
  total: number;
  start: number;
  display: number;
  items: NaverLocalItem[];
}

export function stripHtml(str: string): string {
  return str.replace(/<[^>]*>/g, "").trim();
}

export function naverCoordsToWgs84(mapx: string, mapy: string): { lat: number; lng: number } {
  return {
    lng: parseInt(mapx, 10) / 10_000_000,
    lat: parseInt(mapy, 10) / 10_000_000,
  };
}

export async function naverLocalSearch(
  query: string,
  clientId: string,
  clientSecret: string,
  display: number = 5,
  start: number = 1
): Promise<NaverLocalResponse> {
  const url = new URL(NAVER_SEARCH_URL);
  url.searchParams.set("query", query);
  url.searchParams.set("display", String(display));
  url.searchParams.set("start", String(start));

  const res = await fetch(url.toString(), {
    headers: {
      "X-Naver-Client-Id": clientId,
      "X-Naver-Client-Secret": clientSecret,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Naver API error [${res.status}]: ${body}`);
  }

  return res.json() as Promise<NaverLocalResponse>;
}

export async function naverLocalSearchAll(
  query: string,
  clientId: string,
  clientSecret: string,
  maxResults: number = 15
): Promise<NaverLocalItem[]> {
  const pages = Math.ceil(maxResults / 5);
  const items: NaverLocalItem[] = [];

  for (let i = 0; i < pages; i++) {
    const start = i * 5 + 1;
    const display = Math.min(5, maxResults - items.length);
    if (display <= 0) break;

    const response = await naverLocalSearch(query, clientId, clientSecret, display, start);
    items.push(...response.items);

    if (response.start + response.display > response.total) break;
  }

  return items;
}
