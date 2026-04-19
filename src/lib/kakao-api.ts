const KAKAO_BASE_URL = "https://dapi.kakao.com";

function getKakaoApiKey(): string {
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key) {
    throw new Error("KAKAO_REST_API_KEY 환경 변수가 설정되지 않았습니다.");
  }
  return key;
}

async function kakaoFetch<T>(path: string, params: Record<string, string>): Promise<T> {
  const apiKey = getKakaoApiKey();
  const url = new URL(`${KAKAO_BASE_URL}${path}`);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `KakaoAK ${apiKey}`,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Kakao API 오류 [${res.status}]: ${body}`);
  }

  return res.json() as Promise<T>;
}

export interface KakaoAddressDocument {
  address_name: string;
  address_type: string;
  x: string; // 경도(lng)
  y: string; // 위도(lat)
  address: {
    address_name: string;
    region_1depth_name: string;
    region_2depth_name: string;
    region_3depth_name: string;
    h_code: string;
    b_code: string;
    mountain_yn: string;
    main_address_no: string;
    sub_address_no: string;
    x: string;
    y: string;
  } | null;
  road_address: {
    address_name: string;
    region_1depth_name: string;
    region_2depth_name: string;
    region_3depth_road_name: string;
    road_name: string;
    underground_yn: string;
    main_building_no: string;
    sub_building_no: string;
    building_name: string;
    zone_no: string;
    x: string;
    y: string;
  } | null;
}

export interface KakaoAddressResponse {
  meta: {
    total_count: number;
    pageable_count: number;
    is_end: boolean;
  };
  documents: KakaoAddressDocument[];
}

export interface KakaoKeywordDocument {
  id: string;
  place_name: string;
  category_name: string;
  category_group_code: string;
  category_group_name: string;
  phone: string;
  address_name: string;
  road_address_name: string;
  x: string; // 경도(lng)
  y: string; // 위도(lat)
  place_url: string;
  distance: string;
}

export interface KakaoKeywordResponse {
  meta: {
    total_count: number;
    pageable_count: number;
    is_end: boolean;
    same_name: {
      region: string[];
      keyword: string;
      selected_region: string;
    };
  };
  documents: KakaoKeywordDocument[];
}

export interface KakaoCategoryResponse {
  meta: {
    total_count: number;
    pageable_count: number;
    is_end: boolean;
    same_name: {
      region: string[];
      keyword: string;
      selected_region: string;
    };
  };
  documents: KakaoKeywordDocument[];
}

export async function searchAddress(query: string): Promise<KakaoAddressResponse> {
  return kakaoFetch<KakaoAddressResponse>("/v2/local/search/address.json", {
    query,
  });
}

export async function searchKeyword(
  query: string,
  page = 1,
  size = 15,
  x?: string,
  y?: string,
  radius?: number
): Promise<KakaoKeywordResponse> {
  const params: Record<string, string> = {
    query,
    page: String(page),
    size: String(size),
  };
  if (x) params.x = x;
  if (y) params.y = y;
  if (radius) params.radius = String(radius);
  return kakaoFetch<KakaoKeywordResponse>("/v2/local/search/keyword.json", params);
}

export async function searchByCategory(
  categoryGroupCode: string,
  x: string,
  y: string,
  radius: number,
  page = 1,
  size = 15
): Promise<KakaoCategoryResponse> {
  return kakaoFetch<KakaoCategoryResponse>("/v2/local/search/category.json", {
    category_group_code: categoryGroupCode,
    x,
    y,
    radius: String(radius),
    page: String(page),
    size: String(size),
  });
}
