import type {
  AnalysisConfig,
  SubwayStation,
  School,
  Park,
  Mountain,
  Apartment,
  SubwayRoute,
} from "./types";

export const DEFAULT_CONFIG: AnalysisConfig = {
  centerName: "청와대",
  centerLat: 37.5866,
  centerLng: 126.9748,
  radiusKm: 3,
};

export const SUBWAY_STATIONS: readonly SubwayStation[] = [
  { id: "sub-001", name: "경복궁역", lat: 37.5759, lng: 126.9738, category: "subway", line: "3호선", lineColor: "#EF7C1C" },
  { id: "sub-002", name: "안국역", lat: 37.5763, lng: 126.9855, category: "subway", line: "3호선", lineColor: "#EF7C1C" },
  { id: "sub-003", name: "광화문역", lat: 37.5713, lng: 126.9767, category: "subway", line: "5호선", lineColor: "#996CAC" },
  { id: "sub-004", name: "종로3가역", lat: 37.5715, lng: 126.992, category: "subway", line: "1호선", lineColor: "#263C96" },
  { id: "sub-005", name: "종각역", lat: 37.57, lng: 126.9828, category: "subway", line: "1호선", lineColor: "#263C96" },
  { id: "sub-006", name: "시청역", lat: 37.5657, lng: 126.977, category: "subway", line: "1호선", lineColor: "#263C96" },
  { id: "sub-007", name: "을지로입구역", lat: 37.566, lng: 126.9822, category: "subway", line: "2호선", lineColor: "#33A23D" },
  { id: "sub-008", name: "을지로3가역", lat: 37.5665, lng: 126.992, category: "subway", line: "2호선", lineColor: "#33A23D" },
  { id: "sub-009", name: "독립문역", lat: 37.5722, lng: 126.9601, category: "subway", line: "3호선", lineColor: "#EF7C1C" },
  { id: "sub-010", name: "충정로역", lat: 37.56, lng: 126.9637, category: "subway", line: "2호선", lineColor: "#33A23D" },
  { id: "sub-011", name: "서대문역", lat: 37.5658, lng: 126.9665, category: "subway", line: "5호선", lineColor: "#996CAC" },
  { id: "sub-012", name: "혜화역", lat: 37.5824, lng: 127.0019, category: "subway", line: "4호선", lineColor: "#00A4E3" },
  { id: "sub-013", name: "한성대입구역", lat: 37.5884, lng: 127.0063, category: "subway", line: "4호선", lineColor: "#00A4E3" },
  { id: "sub-014", name: "성균관대역", lat: 37.5891, lng: 126.9935, category: "subway", line: "4호선", lineColor: "#00A4E3" },
  { id: "sub-015", name: "동대문역", lat: 37.5712, lng: 127.0095, category: "subway", line: "1호선", lineColor: "#263C96" },
  { id: "sub-016", name: "동대문역사문화공원역", lat: 37.565, lng: 127.009, category: "subway", line: "2호선", lineColor: "#33A23D" },
  { id: "sub-017", name: "종로5가역", lat: 37.571, lng: 127.002, category: "subway", line: "1호선", lineColor: "#263C96" },
  { id: "sub-018", name: "경찰병원역", lat: 37.5943, lng: 126.969, category: "subway", line: "3호선", lineColor: "#EF7C1C" },
  { id: "sub-019", name: "녹번역", lat: 37.6015, lng: 126.9535, category: "subway", line: "3호선", lineColor: "#EF7C1C" },
  { id: "sub-020", name: "홍제역", lat: 37.5886, lng: 126.9436, category: "subway", line: "3호선", lineColor: "#EF7C1C" },
  { id: "sub-021", name: "무악재역", lat: 37.5828, lng: 126.95, category: "subway", line: "3호선", lineColor: "#EF7C1C" },
  { id: "sub-022", name: "아현역", lat: 37.5575, lng: 126.956, category: "subway", line: "2호선", lineColor: "#33A23D" },
  { id: "sub-023", name: "이대역", lat: 37.5569, lng: 126.946, category: "subway", line: "2호선", lineColor: "#33A23D" },
  { id: "sub-024", name: "신촌역", lat: 37.5552, lng: 126.9368, category: "subway", line: "2호선", lineColor: "#33A23D" },
  { id: "sub-025", name: "약수역", lat: 37.5545, lng: 127.01, category: "subway", line: "6호선", lineColor: "#CD7C2F" },
  { id: "sub-026", name: "버티고개역", lat: 37.5478, lng: 127.0073, category: "subway", line: "6호선", lineColor: "#CD7C2F" },
  { id: "sub-027", name: "창신역", lat: 37.579, lng: 127.013, category: "subway", line: "6호선", lineColor: "#CD7C2F" },
  { id: "sub-028", name: "보문역", lat: 37.585, lng: 127.019, category: "subway", line: "6호선", lineColor: "#CD7C2F" },
];

export const SCHOOLS: readonly School[] = [
  { id: "sch-001", name: "경복초", lat: 37.5785, lng: 126.9753, category: "school", level: "elementary" },
  { id: "sch-002", name: "교동초", lat: 37.5735, lng: 126.9865, category: "school", level: "elementary" },
  { id: "sch-003", name: "매동초", lat: 37.5745, lng: 126.993, category: "school", level: "elementary" },
  { id: "sch-004", name: "재동초", lat: 37.578, lng: 126.984, category: "school", level: "elementary" },
  { id: "sch-005", name: "효제초", lat: 37.577, lng: 126.998, category: "school", level: "elementary" },
  { id: "sch-006", name: "서울교대부설초", lat: 37.5725, lng: 126.978, category: "school", level: "elementary" },
  { id: "sch-007", name: "청운초", lat: 37.5855, lng: 126.966, category: "school", level: "elementary" },
  { id: "sch-008", name: "홍파초", lat: 37.575, lng: 126.957, category: "school", level: "elementary" },
  { id: "sch-009", name: "숭인초", lat: 37.575, lng: 127.01, category: "school", level: "elementary" },
  { id: "sch-010", name: "성균관대사부속초", lat: 37.588, lng: 126.995, category: "school", level: "elementary" },
  { id: "sch-011", name: "종로중", lat: 37.573, lng: 126.979, category: "school", level: "middle" },
  { id: "sch-012", name: "창덕여중", lat: 37.578, lng: 126.99, category: "school", level: "middle" },
  { id: "sch-013", name: "풍문중", lat: 37.5705, lng: 126.988, category: "school", level: "middle" },
  { id: "sch-014", name: "서울중", lat: 37.568, lng: 126.975, category: "school", level: "middle" },
  { id: "sch-015", name: "숭의중", lat: 37.565, lng: 126.97, category: "school", level: "middle" },
  { id: "sch-016", name: "혜화중", lat: 37.584, lng: 127.002, category: "school", level: "middle" },
  { id: "sch-017", name: "경기상업고", lat: 37.572, lng: 126.965, category: "school", level: "high" },
  { id: "sch-018", name: "경복고", lat: 37.585, lng: 126.972, category: "school", level: "high" },
  { id: "sch-019", name: "풍문고", lat: 37.571, lng: 126.989, category: "school", level: "high" },
  { id: "sch-020", name: "중앙고", lat: 37.578, lng: 127.005, category: "school", level: "high" },
  { id: "sch-021", name: "서울사대부속고", lat: 37.574, lng: 126.972, category: "school", level: "high" },
  { id: "sch-022", name: "대신고", lat: 37.569, lng: 126.965, category: "school", level: "high" },
  { id: "sch-023", name: "성균관대사부속고", lat: 37.589, lng: 126.996, category: "school", level: "high" },
  { id: "sch-024", name: "혜화여고", lat: 37.583, lng: 127.003, category: "school", level: "high" },
];

export const PARKS: readonly Park[] = [
  { id: "park-001", name: "경복궁", lat: 37.5796, lng: 126.977, category: "park", area_sqm: 432000, type: "사적/궁궐" },
  { id: "park-002", name: "창덕궁", lat: 37.5794, lng: 126.991, category: "park", area_sqm: 405000, type: "사적/궁궐" },
  { id: "park-003", name: "창경궁", lat: 37.5787, lng: 126.9948, category: "park", area_sqm: 213000, type: "사적/궁궐" },
  { id: "park-004", name: "덕수궁", lat: 37.566, lng: 126.975, category: "park", area_sqm: 63000, type: "사적/궁궐" },
  { id: "park-005", name: "삼청공원", lat: 37.5855, lng: 126.982, category: "park", area_sqm: 340000, type: "근린공원" },
  { id: "park-006", name: "사직공원", lat: 37.576, lng: 126.968, category: "park", area_sqm: 68000, type: "근린공원" },
  { id: "park-007", name: "탑골공원", lat: 37.571, lng: 126.988, category: "park", area_sqm: 19000, type: "역사공원" },
  { id: "park-008", name: "종묘공원", lat: 37.574, lng: 126.994, category: "park", area_sqm: 197000, type: "사적" },
  { id: "park-009", name: "와룡공원", lat: 37.577, lng: 127.003, category: "park", area_sqm: 45000, type: "근린공원" },
  { id: "park-010", name: "낙산공원", lat: 37.58, lng: 127.007, category: "park", area_sqm: 95000, type: "근린공원" },
  { id: "park-011", name: "독립공원", lat: 37.572, lng: 126.958, category: "park", area_sqm: 38000, type: "역사공원" },
  { id: "park-012", name: "청와대 개방구역", lat: 37.5866, lng: 126.9748, category: "park", area_sqm: 250000, type: "문화공원" },
  { id: "park-013", name: "북악스카이웨이공원", lat: 37.594, lng: 126.98, category: "park", area_sqm: 120000, type: "근린공원" },
];

export const MOUNTAINS: readonly Mountain[] = [
  { id: "mtn-001", name: "북악산", lat: 37.5934, lng: 126.9812, category: "mountain", elevation_m: 342 },
  { id: "mtn-002", name: "인왕산", lat: 37.5835, lng: 126.9575, category: "mountain", elevation_m: 338 },
  { id: "mtn-003", name: "낙산", lat: 37.5805, lng: 127.007, category: "mountain", elevation_m: 125 },
  { id: "mtn-004", name: "남산", lat: 37.5512, lng: 126.9882, category: "mountain", elevation_m: 262 },
  { id: "mtn-005", name: "안산", lat: 37.578, lng: 126.943, category: "mountain", elevation_m: 296 },
];

export const APARTMENTS: readonly Apartment[] = [
  { id: "apt-001", name: "경희궁자이", lat: 37.5685, lng: 126.967, category: "apartment", units: 2190, price_per_pyeong: 4800, sale_date: "2024-06", distance_m: 2100 },
  { id: "apt-002", name: "광화문 풍림스페이스본", lat: 37.571, lng: 126.972, category: "apartment", units: 474, price_per_pyeong: 4200, sale_date: "2025-01", distance_m: 1740 },
  { id: "apt-003", name: "종로 센트레빌", lat: 37.57, lng: 126.99, category: "apartment", units: 356, price_per_pyeong: 3800, sale_date: "2024-09", distance_m: 1920 },
  { id: "apt-004", name: "인왕산 아이파크", lat: 37.578, lng: 126.955, category: "apartment", units: 828, price_per_pyeong: 3500, sale_date: "2023-11", distance_m: 1800 },
  { id: "apt-005", name: "홍파동 e편한세상", lat: 37.575, lng: 126.956, category: "apartment", units: 612, price_per_pyeong: 3200, sale_date: "2025-03", distance_m: 1900 },
  { id: "apt-006", name: "돈의문 센트레빌", lat: 37.566, lng: 126.964, category: "apartment", units: 290, price_per_pyeong: 3600, sale_date: "2024-03", distance_m: 2400 },
  { id: "apt-007", name: "충정로 아크로타워", lat: 37.561, lng: 126.963, category: "apartment", units: 445, price_per_pyeong: 3400, sale_date: "2025-08", distance_m: 2900 },
  { id: "apt-008", name: "성균관대 힐스테이트", lat: 37.59, lng: 126.997, category: "apartment", units: 520, price_per_pyeong: 3100, sale_date: "2024-12", distance_m: 2200 },
];

export const SUBWAY_ROUTES: readonly SubwayRoute[] = [
  {
    line: "1호선",
    lineColor: "#263C96",
    stationIds: ["sub-006", "sub-005", "sub-004", "sub-017", "sub-015"],
    // 시청 → 종각 → 종로3가 → 종로5가 → 동대문 (종로 동서 방향, 시청 근방 북동 커브)
    coordinates: [
      [37.5657, 126.9770], // 시청
      [37.5668, 126.9790],
      [37.5682, 126.9808],
      [37.5700, 126.9828], // 종각
      [37.5708, 126.9873],
      [37.5715, 126.9920], // 종로3가
      [37.5712, 126.9968],
      [37.5710, 127.0020], // 종로5가
      [37.5711, 127.0058],
      [37.5712, 127.0095], // 동대문
    ],
  },
  {
    line: "2호선",
    lineColor: "#33A23D",
    stationIds: ["sub-024", "sub-023", "sub-022", "sub-010", "sub-007", "sub-008", "sub-016"],
    // 신촌 → 이대 → 아현 → 충정로 → 을지로입구 → 을지로3가 → 동대문역사문화공원 (을지로 동서)
    coordinates: [
      [37.5552, 126.9368], // 신촌
      [37.5561, 126.9414],
      [37.5569, 126.9460], // 이대
      [37.5572, 126.9510],
      [37.5575, 126.9560], // 아현
      [37.5585, 126.9598],
      [37.5600, 126.9637], // 충정로
      [37.5618, 126.9685],
      [37.5633, 126.9726],
      [37.5645, 126.9778],
      [37.5660, 126.9822], // 을지로입구
      [37.5663, 126.9871],
      [37.5665, 126.9920], // 을지로3가
      [37.5658, 126.9985],
      [37.5650, 127.0090], // 동대문역사문화공원
    ],
  },
  {
    line: "3호선",
    lineColor: "#EF7C1C",
    stationIds: ["sub-019", "sub-018", "sub-020", "sub-021", "sub-009", "sub-001", "sub-002"],
    // 녹번 → 경찰병원 → 홍제 → 무악재 → 독립문 → 경복궁 → 안국 (북서→남동, 곡선 많음)
    coordinates: [
      [37.6015, 126.9535], // 녹번
      [37.5985, 126.9558],
      [37.5962, 126.9608],
      [37.5943, 126.9690], // 경찰병원
      [37.5925, 126.9628],
      [37.5910, 126.9562],
      [37.5896, 126.9505],
      [37.5886, 126.9436], // 홍제
      [37.5870, 126.9462],
      [37.5852, 126.9488],
      [37.5828, 126.9500], // 무악재
      [37.5808, 126.9522],
      [37.5783, 126.9548],
      [37.5760, 126.9566],
      [37.5740, 126.9580],
      [37.5722, 126.9601], // 독립문
      [37.5732, 126.9647],
      [37.5745, 126.9693],
      [37.5759, 126.9738], // 경복궁
      [37.5761, 126.9797],
      [37.5763, 126.9855], // 안국
    ],
  },
  {
    line: "4호선",
    lineColor: "#00A4E3",
    stationIds: ["sub-014", "sub-013", "sub-012"],
    // 성균관대 → 한성대입구 → 혜화 (남북 방향, 완만한 커브)
    coordinates: [
      [37.5891, 126.9935], // 성균관대
      [37.5890, 126.9998],
      [37.5884, 127.0063], // 한성대입구
      [37.5868, 127.0048],
      [37.5848, 127.0032],
      [37.5824, 127.0019], // 혜화
    ],
  },
  {
    line: "5호선",
    lineColor: "#996CAC",
    stationIds: ["sub-011", "sub-003"],
    // 서대문 → 광화문 (짧은 동서 구간)
    coordinates: [
      [37.5658, 126.9665], // 서대문
      [37.5678, 126.9706],
      [37.5696, 126.9744],
      [37.5713, 126.9767], // 광화문
    ],
  },
  {
    line: "6호선",
    lineColor: "#CD7C2F",
    stationIds: ["sub-026", "sub-025", "sub-027", "sub-028"],
    // 버티고개 → 약수 → 창신 → 보문 (남→북 곡선 경로)
    coordinates: [
      [37.5478, 127.0073], // 버티고개
      [37.5508, 127.0086],
      [37.5545, 127.0100], // 약수
      [37.5575, 127.0105],
      [37.5610, 127.0112],
      [37.5648, 127.0120],
      [37.5685, 127.0125],
      [37.5723, 127.0128],
      [37.5758, 127.0130],
      [37.5790, 127.0130], // 창신
      [37.5820, 127.0158],
      [37.5850, 127.0190], // 보문
    ],
  },
];
