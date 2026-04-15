# 시드 데이터 명세서

> **작성:** 기획팀 (Clio)
> **일자:** 2026-04-15
> **용도:** 강남역 2km 반경 MVP 개발용 더미 데이터

---

## 파일 경로

```
public/data/seed/
  subway-stations.json
  schools.json
  parks.json
  mountains.json
  apartments.json
```

---

## 1. subway-stations.json

강남역 2km 반경 내 지하철역 (실제 좌표 기반)

```json
[
  { "id": "sub-001", "name": "강남역", "lat": 37.4979, "lng": 127.0276, "category": "subway", "line": "2호선", "lineColor": "#33A23D" },
  { "id": "sub-002", "name": "역삼역", "lat": 37.5007, "lng": 127.0365, "category": "subway", "line": "2호선", "lineColor": "#33A23D" },
  { "id": "sub-003", "name": "선릉역", "lat": 37.5045, "lng": 127.0490, "category": "subway", "line": "2호선", "lineColor": "#33A23D" },
  { "id": "sub-004", "name": "교대역", "lat": 37.4934, "lng": 127.0146, "category": "subway", "line": "2호선", "lineColor": "#33A23D" },
  { "id": "sub-005", "name": "신논현역", "lat": 37.5047, "lng": 127.0253, "category": "subway", "line": "9호선", "lineColor": "#AA9872" },
  { "id": "sub-006", "name": "논현역", "lat": 37.5112, "lng": 127.0214, "category": "subway", "line": "7호선", "lineColor": "#6E7C49" }
]
```

---

## 2. schools.json

```json
[
  { "id": "sch-001", "name": "역삼초등학교", "lat": 37.4995, "lng": 127.0340, "category": "school", "level": "elementary" },
  { "id": "sch-002", "name": "도곡초등학교", "lat": 37.4910, "lng": 127.0370, "category": "school", "level": "elementary" },
  { "id": "sch-003", "name": "언주중학교", "lat": 37.5020, "lng": 127.0410, "category": "school", "level": "middle" },
  { "id": "sch-004", "name": "단국대사범대학부속중학교", "lat": 37.4960, "lng": 127.0190, "category": "school", "level": "middle" },
  { "id": "sch-005", "name": "경기고등학교", "lat": 37.4948, "lng": 127.0455, "category": "school", "level": "high" },
  { "id": "sch-006", "name": "숙명여자고등학교", "lat": 37.4880, "lng": 127.0310, "category": "school", "level": "high" }
]
```

---

## 3. parks.json

```json
[
  { "id": "park-001", "name": "강남역근린공원", "lat": 37.4965, "lng": 127.0290, "category": "park", "area_sqm": 12000 },
  { "id": "park-002", "name": "도곡공원", "lat": 37.4890, "lng": 127.0380, "category": "park", "area_sqm": 25000 },
  { "id": "park-003", "name": "역삼공원", "lat": 37.5010, "lng": 127.0350, "category": "park", "area_sqm": 18000 },
  { "id": "park-004", "name": "양재시민의숲", "lat": 37.4725, "lng": 127.0380, "category": "park", "area_sqm": 260000 }
]
```

---

## 4. mountains.json

```json
[
  { "id": "mtn-001", "name": "구룡산", "lat": 37.4750, "lng": 127.0550, "category": "mountain", "elevation_m": 306 },
  { "id": "mtn-002", "name": "대모산", "lat": 37.4680, "lng": 127.0720, "category": "mountain", "elevation_m": 293 }
]
```

---

## 5. apartments.json

강남역 2km 반경 내 최근 분양 아파트 (예시 데이터)

```json
[
  {
    "id": "apt-001",
    "name": "래미안 라클래시",
    "lat": 37.4920,
    "lng": 127.0320,
    "category": "apartment",
    "units": 1317,
    "price_per_pyeong": 6800,
    "sale_date": "2025-03",
    "distance_m": 680
  },
  {
    "id": "apt-002",
    "name": "디에이치 자이 개포",
    "lat": 37.4810,
    "lng": 127.0540,
    "category": "apartment",
    "units": 1996,
    "price_per_pyeong": 7200,
    "sale_date": "2024-11",
    "distance_m": 1850
  },
  {
    "id": "apt-003",
    "name": "역삼 센트럴 아이파크",
    "lat": 37.5010,
    "lng": 127.0380,
    "category": "apartment",
    "units": 489,
    "price_per_pyeong": 5900,
    "sale_date": "2025-06",
    "distance_m": 520
  },
  {
    "id": "apt-004",
    "name": "논현 파크리오",
    "lat": 37.5100,
    "lng": 127.0260,
    "category": "apartment",
    "units": 752,
    "price_per_pyeong": 5500,
    "sale_date": "2025-09",
    "distance_m": 1400
  },
  {
    "id": "apt-005",
    "name": "도곡렉슬",
    "lat": 37.4870,
    "lng": 127.0440,
    "category": "apartment",
    "units": 1654,
    "price_per_pyeong": 6100,
    "sale_date": "2024-05",
    "distance_m": 1600
  }
]
```

---

## 데이터 정합성 노트

- 좌표는 실제 위치 기반이나 정밀도는 보장하지 않음 (개발용)
- `distance_m`은 강남역(37.4979, 127.0276) 기준 직선거리 근사값
- `price_per_pyeong`은 만원 단위 (예: 6800 = 평당 6,800만원)
- `sale_date`는 YYYY-MM 포맷
- 실제 API 연동 시 이 구조를 유지하면서 데이터 소스만 교체
