const center = { lat: 37.5866, lng: 126.9748 };
const fetchedAt = Date.UTC(2026, 6, 22, 3, 0, 0);

function ring(lng, lat, size) {
  return [
    [lng - size, lat - size],
    [lng + size, lat - size],
    [lng + size, lat + size],
    [lng - size, lat + size],
    [lng - size, lat - size],
  ];
}

function maintenance(id, name, offset, boundary, boundaryStatus = "confirmed") {
  return {
    id,
    name,
    lat: center.lat + offset,
    lng: center.lng + offset,
    category: "maintenance",
    type: boundaryStatus === "unmatched" ? "재건축" : "재개발",
    stage: "조합설립",
    address: `서울특별시 종로구 ${name}`,
    area_sqm: 42_000 + Math.round(offset * 1_000_000),
    distance_m: 240 + Math.round(offset * 10_000),
    planned_households: 1_050 + Math.round(offset * 10_000),
    implementer: `${name} 조합`,
    source: boundaryStatus === "unmatched" ? "molit_spatial" : "molit_integrated",
    source_updated_at: "2026-07-20",
    boundary_status: boundaryStatus,
    boundary,
  };
}

const pois = [
  { id: "subway-1", name: "경복궁역", lat: 37.5758, lng: 126.9736, category: "subway", line: "3호선", lineColor: "#F97316" },
  { id: "subway-2", name: "광화문역", lat: 37.5716, lng: 126.9764, category: "subway", line: "5호선", lineColor: "#7C3AED" },
  { id: "subway-3", name: "안국역", lat: 37.5765, lng: 126.9854, category: "subway", line: "3호선", lineColor: "#F97316" },
  { id: "school-1", name: "구조검증초등학교", lat: 37.582, lng: 126.968, category: "school", level: "elementary" },
  { id: "school-2", name: "구조검증중학교", lat: 37.59, lng: 126.982, category: "school", level: "middle" },
  { id: "school-3", name: "구조검증고등학교", lat: 37.595, lng: 126.971, category: "school", level: "high" },
  { id: "mountain-1", name: "인왕산", lat: 37.584, lng: 126.958, category: "mountain", elevation_m: 338 },
  { id: "stale-park", name: "구조검증공원", lat: 37.598, lng: 126.973, category: "park", area_sqm: 18_000, type: "근린공원", distance_m: 420, source: "official" },
  { id: "apt-1", name: "청운 구조검증 아파트", lat: 37.589, lng: 126.969, category: "apartment", units: 840, parking_count: 920, sale_date: "2018-03", distance_m: 430, status: "existing", source: "ledger" },
  { id: "apt-2", name: "효자 구조검증 아파트", lat: 37.579, lng: 126.971, category: "apartment", units: 1_200, parking_count: 1_320, sale_date: "2027-10", distance_m: 860, status: "planned", source: "applyhome" },
  { id: "officetel-1", name: "광화문 구조검증 오피스텔", lat: 37.574, lng: 126.979, category: "officetel", units: 320, parking_count: 210, sale_date: "2020-06", distance_m: 1_050, status: "existing", source: "ledger" },
  { id: "residential-1", name: "종로 구조검증 주거", lat: 37.591, lng: 126.986, category: "residential", units: 410, parking_count: 330, sale_date: "2026-11", distance_m: 1_200, status: "planned", source: "housing_permit" },
  maintenance("maintenance-hole", "서울 구조검증 홀", 0.001, { type: "Polygon", coordinates: [ring(126.976, 37.588, 0.006), ring(126.976, 37.588, 0.002)] }),
  maintenance("maintenance-multi", "종로 가로주택정비", -0.003, { type: "MultiPolygon", coordinates: [[ring(126.965, 37.583, 0.003)], [ring(126.983, 37.583, 0.003)]] }, "unmatched"),
  maintenance("maintenance-solid-2", "서촌 재개발", 0.004, { type: "Polygon", coordinates: [ring(126.968, 37.593, 0.003)] }),
  maintenance("maintenance-solid-3", "청운 재개발", 0.006, { type: "Polygon", coordinates: [ring(126.979, 37.596, 0.003)] }),
  maintenance("maintenance-dashed-3", "북촌 재건축", -0.006, { type: "Polygon", coordinates: [ring(126.987, 37.58, 0.003)] }, "unmatched"),
];

export const presentationFixture = {
  centerName: "합성 구조검증",
  center,
  pois,
  response: {
    pois,
    maintenanceCatalog: [],
    warnings: ["공원 데이터 수집 실패"],
    sources: [
      { source: "osm", status: "fresh", fetchedAt },
      { source: "park", status: "failed", fetchedAt: null },
      { source: "residential", status: "fresh", fetchedAt },
      { source: "planned-residential", status: "fresh", fetchedAt },
      { source: "subway-routes", status: "cached", fetchedAt },
      { source: "rail-network", status: "cached", fetchedAt },
      { source: "maintenance_boundaries", status: "cached", fetchedAt },
      { source: "maintenance_attributes", status: "fresh", fetchedAt },
      { source: "maintenance_seoul", status: "fresh", fetchedAt },
      { source: "maintenance_busan", status: "cached", fetchedAt },
    ],
  },
};
