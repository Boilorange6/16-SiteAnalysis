/**
 * 다산역 QA에서 드러난 주거 데이터 3중 결함에 대한 회귀 테스트.
 *
 * 1. 건축물대장 API가 XML → JSON 기본값으로 바뀌어 XML 파서가 전국에서 0건을 반환하던 문제
 * 2. 분양 조회 창이 모집공고일 기준 540일이라 미입주 단지까지 탈락하던 문제
 * 3. 택지지구/블록 표기 주소의 지오코딩 실패 시 단지를 조용히 폐기하던 문제
 */
import assert from "node:assert/strict";

const { buildLedgerUrl } = await import("../lib/server/ledger-url.ts");
const {
  isPlannedComplexCurrent,
  buildGeocodeCandidates,
  isSameResidentialComplex,
  findResidentialMatchIndex,
} = await import("../lib/server/planned-residential-filter.ts");

// ─── 1. 건축물대장 요청은 응답 포맷을 명시해야 한다 ─────────────────────────────
{
  const url = buildLedgerUrl({
    sigunguCd: "41360",
    bjdongCd: "11200",
    pageNo: 3,
    encodedApiKey: "TEST%2BKEY",
  });

  assert.ok(
    url.includes("_type=xml"),
    "건축물대장 요청은 _type=xml을 명시해야 한다 (기본값이 JSON으로 바뀌면 XML 파서가 전국에서 0건을 반환)",
  );
  assert.ok(url.includes("sigunguCd=41360"), "시군구 코드가 전달되어야 한다");
  assert.ok(url.includes("bjdongCd=11200"), "법정동 코드가 전달되어야 한다");
  assert.ok(url.includes("pageNo=3"), "페이지 번호가 전달되어야 한다");
  assert.ok(url.includes("numOfRows=100"), "페이지 크기가 전달되어야 한다");
  assert.ok(
    url.includes("serviceKey=TEST%2BKEY"),
    "인코딩된 서비스 키를 재인코딩하지 않고 그대로 붙여야 한다",
  );
}

// ─── 2. 분양 레이어 대상 판별은 입주예정월 기준이어야 한다 ─────────────────────
{
  const now = "202608";

  // 구리역 롯데캐슬 시그니처: 공고 2023-02, 입주 2026-03 → 아직 분양 정보로 유효
  assert.equal(
    isPlannedComplexCurrent({ moveInMonth: "202603", saleDate: "2023-02-09" }, now),
    true,
    "입주가 유예기간 안이면 공고일이 오래돼도 분양 레이어에 남아야 한다",
  );

  // 다산역 데시앙: 입주 2024-04 → 이미 준공, 건축물대장이 담당
  assert.equal(
    isPlannedComplexCurrent({ moveInMonth: "202404", saleDate: "2021-08-12" }, now),
    false,
    "입주 유예기간을 넘긴 단지는 분양이 아니라 기존 단지로 취급해야 한다",
  );

  // 미래 입주
  assert.equal(
    isPlannedComplexCurrent({ moveInMonth: "202812", saleDate: "2026-01-05" }, now),
    true,
    "미래 입주 단지는 항상 분양 레이어 대상이다",
  );

  // 입주예정월이 비어 있으면 공고일로 폴백
  assert.equal(
    isPlannedComplexCurrent({ moveInMonth: "", saleDate: "2026-07-09" }, now),
    true,
    "입주예정월이 없으면 최근 공고 단지는 포함해야 한다",
  );
  assert.equal(
    isPlannedComplexCurrent({ moveInMonth: "", saleDate: "2020-05-14" }, now),
    false,
    "입주예정월이 없고 공고도 오래됐으면 제외해야 한다",
  );

  // 형식이 깨진 입주예정월은 없는 것으로 보고 공고일로 폴백
  assert.equal(
    isPlannedComplexCurrent({ moveInMonth: "미정", saleDate: "2026-07-09" }, now),
    true,
    "입주예정월 형식이 깨졌으면 공고일 폴백을 써야 한다",
  );

  // 판단 근거가 아무것도 없으면 제외 (조용히 통과시키지 않는다)
  assert.equal(
    isPlannedComplexCurrent({ moveInMonth: "", saleDate: "" }, now),
    false,
    "입주월도 공고일도 없으면 제외해야 한다",
  );
}

// ─── 3. 지오코딩은 괄호 안 지번을 폴백 후보로 써야 한다 ────────────────────────
{
  // 힐스테이트 지금 디포레: 원문은 지오코딩 실패, 괄호 안 지번은 성공 (다산역 2,204m)
  const blockAddress = "경기도 남양주시 다산신도시 상업 2BL (다산동 6192-1번지)";
  const blockCandidates = buildGeocodeCandidates(blockAddress);

  assert.equal(blockCandidates[0], blockAddress, "원문 주소를 가장 먼저 시도해야 한다");
  assert.ok(
    blockCandidates.includes("경기도 남양주시 다산동 6192-1"),
    `괄호 안 지번에 시도·시군구를 붙인 후보가 있어야 한다 (실제: ${JSON.stringify(blockCandidates)})`,
  );

  // "외 N필지" 꼬리표 제거
  const lotAddress = "경기도 남양주시 다산동 3473번지 외 24필지";
  const lotCandidates = buildGeocodeCandidates(lotAddress);
  assert.ok(
    lotCandidates.includes("경기도 남양주시 다산동 3473"),
    `"외 N필지"와 "번지"를 떼어낸 후보가 있어야 한다 (실제: ${JSON.stringify(lotCandidates)})`,
  );

  // 괄호 안이 단지명뿐이면 동 이름만으로 좌표를 만들지 않는다 (엉뚱한 위치 방지)
  const namedAddress = "경기도 남양주시 다산중앙로82번길 12 (다산동, 다산자연앤e편한세상3차)";
  const namedCandidates = buildGeocodeCandidates(namedAddress);
  assert.equal(namedCandidates[0], namedAddress, "도로명 주소는 원문을 먼저 시도한다");
  assert.ok(
    !namedCandidates.some((c) => /다산동$/.test(c)),
    `지번 없는 괄호 내용으로 동 단위 좌표 후보를 만들면 안 된다 (실제: ${JSON.stringify(namedCandidates)})`,
  );

  // 중복 후보 없음
  const plain = buildGeocodeCandidates("경기도 남양주시 다산동 6056");
  assert.equal(
    new Set(plain).size,
    plain.length,
    `후보에 중복이 없어야 한다 (실제: ${JSON.stringify(plain)})`,
  );

  // 빈 주소는 빈 후보
  assert.deepEqual(buildGeocodeCandidates(""), [], "빈 주소는 후보가 없어야 한다");
}

// ─── 4. 같은 단지가 분양/기존으로 두 번 찍히면 안 된다 ─────────────────────────
{
  // 다산 유보라 마크뷰: 건축물대장 좌표와 청약홈 지오코딩 좌표가 약 250m 어긋난다.
  // 이름이 같으면 좌표 오차를 넘어 같은 단지로 봐야 한다.
  const ledger = { name: "다산 유보라 마크뷰", lat: 37.6055, lng: 127.1615, category: "apartment" };
  const applyhome = { name: "다산 유보라 마크뷰", lat: 37.6077, lng: 127.1625, category: "apartment" };
  assert.equal(
    isSameResidentialComplex(ledger, applyhome),
    true,
    "이름이 같고 수백 m 안이면 같은 단지로 병합해야 한다 (분양/기존 이중 표시 방지)",
  );

  // 이름이 같아도 아주 멀면 다른 단지 (동명 단지)
  assert.equal(
    isSameResidentialComplex(ledger, { ...applyhome, lat: 37.65, lng: 127.20 }),
    false,
    "이름이 같아도 수 km 떨어지면 동명의 다른 단지다",
  );

  // 이름이 달라도 같은 카테고리로 아주 가까우면 같은 단지 (기존 동작 유지)
  assert.equal(
    isSameResidentialComplex(ledger, { name: "유보라마크뷰아파트", lat: 37.6056, lng: 127.1616, category: "apartment" }),
    true,
    "표기가 다른 같은 자리의 같은 유형은 병합한다",
  );

  // 다른 이름 + 다른 카테고리는 가까워도 별개
  assert.equal(
    isSameResidentialComplex(ledger, { name: "다산역 데시앙", lat: 37.6056, lng: 127.1616, category: "officetel" }),
    false,
    "이름도 유형도 다르면 가까워도 별개 단지다",
  );

  // 인접 브랜드 단지를 이름 부분일치로 잘못 묶지 않는다
  assert.equal(
    isSameResidentialComplex(
      { name: "다산지금데시앙", lat: 37.6055, lng: 127.1615, category: "apartment" },
      { name: "다산진건데시앙", lat: 37.6070, lng: 127.1630, category: "apartment" },
    ),
    false,
    "지구명이 다른 동일 브랜드 단지는 병합하면 안 된다",
  );
}

// ─── 5. 병합 상대는 배열 순서가 아니라 가장 잘 맞는 단지여야 한다 ─────────────
{
  // 다산역 3km 실측 좌표. 분양 "다산 유보라 마크뷰"에서
  //   - 다산 효성해링턴 타워 171m (이름 불일치, 같은 유형) — 배열에서 앞
  //   - 다산 유보라 마크뷰    20m (이름 일치)              — 배열에서 뒤
  // 앞에서부터 첫 매치를 고르면 엉뚱한 단지에 병합되고 진짜 짝은 중복으로 남는다.
  const existing = [
    { name: "다산 효성해링턴 타워", lat: 37.6059962, lng: 127.1561392, category: "apartment" },
    { name: "다산 유보라 마크뷰", lat: 37.6054096, lng: 127.1541352, category: "apartment" },
  ];
  const planned = { name: "다산 유보라 마크뷰", lat: 37.6053885, lng: 127.1543556, category: "apartment" };

  assert.equal(
    findResidentialMatchIndex(existing, planned),
    1,
    "이름이 일치하는 단지를 골라야 한다 (배열 앞의 근접 단지가 아니라)",
  );

  // 이름 단서가 없으면 가장 가까운 같은 유형 단지로 병합
  assert.equal(
    findResidentialMatchIndex(existing, {
      name: "이름없는신축",
      lat: 37.60600,
      lng: 127.15614,
      category: "apartment",
    }),
    0,
    "이름 단서가 없으면 가장 가까운 같은 유형 단지에 병합한다",
  );

  // 아무 단지와도 맞지 않으면 -1
  assert.equal(
    findResidentialMatchIndex(existing, {
      name: "전혀 다른 단지",
      lat: 37.70,
      lng: 127.30,
      category: "apartment",
    }),
    -1,
    "맞는 단지가 없으면 -1을 반환해 새 POI로 추가되게 해야 한다",
  );

  assert.equal(findResidentialMatchIndex([], planned), -1, "빈 목록이면 -1이다");
}

console.log("test-planned-residential-fixes: 통과");
