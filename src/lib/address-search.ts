import type { AddressSearchResult } from "./data-provider";

export type AddressSearchResultInput = Omit<AddressSearchResult, "jibunAddress"> & {
  readonly jibunAddress?: string | null;
};

/** API 응답을 V1/V2가 공유하는 주소 검색 결과로 정규화한다. */
export function mapAddressSearchResult(input: AddressSearchResultInput): AddressSearchResult {
  const jibunAddress = input.jibunAddress?.trim();
  return {
    id: input.id,
    name: input.name,
    address: input.address,
    lat: input.lat,
    lng: input.lng,
    ...(jibunAddress ? { jibunAddress } : {}),
  };
}

/** 자동완성 선택 시 V2 입력에 넣을 주소. 지번이 없으면 원래 주소를 보존한다. */
export function addressValueForSelection(result: Pick<AddressSearchResult, "address" | "jibunAddress">): string {
  return result.jibunAddress?.trim() || result.address.trim();
}

/** V2는 번지까지 있는 지번만 해석한다. "대치동"처럼 번지 없는 후보(입구·정문 등)는 고를 수 없다. */
export function isSelectableSuggestion(result: Pick<AddressSearchResult, "jibunAddress">): boolean {
  return /\s(산\s?)?\d+(-\d+)?$/.test(result.jibunAddress?.trim() ?? "");
}

export function addressSuggestionText(result: Pick<AddressSearchResult, "address" | "jibunAddress">): string {
  return addressValueForSelection(result);
}
