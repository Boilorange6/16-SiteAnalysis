/**
 * 검수 대표 지역 8곳 (spec §6.1).
 * 좌표는 대표 지점의 근사값이다. Task 10에서 주소 검색으로 한 번 확인하고 필요하면 고친다.
 */
import type { LngLat } from "../crs";

export interface ReviewSite {
  id: string;
  name: string;
  address: string;
  center: LngLat;
  checks: string;
}

export const REVIEW_SITES: readonly ReviewSite[] = [
  { id: "guryong", name: "구룡역", address: "서울특별시 강남구 개포동 구룡역", center: [127.0592, 37.4869], checks: "정비사업 밀집, 기존 QA 비교" },
  { id: "dasan", name: "다산역", address: "경기도 남양주시 다산동 다산역", center: [127.1506, 37.6245], checks: "신도시, 분양·입주 물량, 기존 QA 비교" },
  { id: "cheongwadae", name: "청와대", address: "서울특별시 종로구 청와대로 1", center: [126.9748, 37.5866], checks: "도심 + 산지, 기존 샘플 비교" },
  { id: "jeongja", name: "정자역", address: "경기도 성남시 분당구 정자동 정자역", center: [127.1085, 37.367], checks: "경기 정비사업 단계" },
  { id: "marinecity", name: "해운대 마린시티", address: "부산광역시 해운대구 우동 마린시티", center: [129.1445, 35.156], checks: "초고층, 해안" },
  { id: "bokjeong", name: "복정역", address: "서울특별시 송파구 장지동 복정역", center: [127.1265, 37.47], checks: "시군구 경계를 넘는 반경(서울·성남)" },
  { id: "sejong", name: "세종 정부청사", address: "세종특별자치시 도움6로 11", center: [127.265, 36.504], checks: "계획도시, 신규 지역" },
  { id: "wanju", name: "완주 봉동읍", address: "전북특별자치도 완주군 봉동읍", center: [127.164, 35.944], checks: "농촌·산지, 자료 공백" },
];
