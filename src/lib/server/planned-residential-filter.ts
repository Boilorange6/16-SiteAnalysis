/**
 * 분양(청약홈) 단지의 레이어 편입 판별과 지오코딩 주소 후보 생성.
 *
 * 둘 다 순수 함수라 네트워크 없이 테스트한다.
 * 회귀 테스트: src/scripts/test-planned-residential-fixes.mjs
 */

/**
 * 입주 후 이 기간까지는 계속 "분양" 레이어에 남긴다.
 * 준공 직후 단지는 건축물대장 등재가 늦어 공백이 생기므로 유예를 둔다.
 */
export const MOVE_IN_GRACE_MONTHS = 24;

/** 입주예정월을 알 수 없을 때 모집공고일로 판단하는 유예 기간 */
export const PBLANC_FALLBACK_MONTHS = 24;

export interface PlannedComplexDates {
  /** MVN_PREARNGE_YM (입주예정월), 예: "202603" */
  moveInMonth: string;
  /** RCRIT_PBLANC_DE (모집공고일), 예: "2023-02-09" */
  saleDate: string;
}

function toMonthIndex(yyyymm: string): number | null {
  if (!/^\d{6}$/.test(yyyymm)) return null;
  const year = Number(yyyymm.slice(0, 4));
  const month = Number(yyyymm.slice(4, 6));
  if (month < 1 || month > 12) return null;
  return year * 12 + (month - 1);
}

function saleDateToMonthIndex(saleDate: string): number | null {
  const match = saleDate.match(/^(\d{4})-?(\d{2})/);
  if (!match) return null;
  return toMonthIndex(`${match[1]}${match[2]}`);
}

/**
 * 분양 레이어에 표시할 단지인지 판별한다.
 *
 * 모집공고일 기준으로 자르면 입주가 한참 남은 단지까지 탈락한다
 * (예: 구리역 롯데캐슬 시그니처 — 공고 2023-02, 입주 2026-03).
 * 판단 기준은 "아직 입주하지 않았거나 갓 입주했는가"여야 한다.
 */
export function isPlannedComplexCurrent(complex: PlannedComplexDates, nowYm: string): boolean {
  const now = toMonthIndex(nowYm);
  if (now === null) return false;

  const moveIn = toMonthIndex(complex.moveInMonth ?? "");
  if (moveIn !== null) return moveIn >= now - MOVE_IN_GRACE_MONTHS;

  const pblanc = saleDateToMonthIndex(complex.saleDate ?? "");
  if (pblanc !== null) return pblanc >= now - PBLANC_FALLBACK_MONTHS;

  return false;
}

/** 현재 연월을 "YYYYMM"으로 (테스트에서 주입할 수 있도록 인자를 받는다) */
export function toYearMonth(date: Date): string {
  return `${date.getFullYear()}${`${date.getMonth() + 1}`.padStart(2, "0")}`;
}

/** 좌표가 이만큼 안이면 표기가 달라도 같은 자리로 본다 */
const SAME_SPOT_M = 180;
/**
 * 이름이 같을 때 허용하는 좌표 오차.
 * 건축물대장 지번 좌표와 청약홈 공급위치 지오코딩 좌표는 수백 m 어긋나는 일이 흔하다.
 */
const SAME_NAME_M = 600;

export interface ResidentialIdentity {
  name: string;
  lat: number;
  lng: number;
  category: string;
}

function normalizeComplexName(value: string): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, "")
    .replace(/(아파트|공동주택|오피스텔|도시형생활주택|민간임대|분양|신축|단지)$/g, "");
}

function distanceM(a: ResidentialIdentity, b: ResidentialIdentity): number {
  const R = 6371000;
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLng = (b.lng - a.lng) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * 같은 단지인지 판별한다.
 *
 * 좌표만 보면 분양(청약홈 지오코딩)과 기존(건축물대장 지번) 좌표가 어긋나
 * 한 단지가 "분양"과 "기존"으로 두 번 찍힌다 — 실제로 다산 유보라 마크뷰가 그랬다.
 * 이름이 일치하면 좌표 허용치를 넓히되, 동명의 다른 단지까지 묶이지 않게 상한을 둔다.
 */
export function isSameResidentialComplex(a: ResidentialIdentity, b: ResidentialIdentity): boolean {
  const nameA = normalizeComplexName(a.name);
  const nameB = normalizeComplexName(b.name);
  const sameName = !!nameA && !!nameB && (nameA.includes(nameB) || nameB.includes(nameA));
  const dist = distanceM(a, b);

  if (sameName) return dist <= SAME_NAME_M;
  return dist <= SAME_SPOT_M && a.category === b.category;
}

/**
 * 분양 단지를 병합할 기존 단지의 인덱스를 고른다. 없으면 -1.
 *
 * 배열 앞에서부터 첫 매치를 고르면 안 된다.
 * 실제로 분양 "다산 유보라 마크뷰"가 171m 떨어진 "다산 효성해링턴 타워"에 먼저 걸려
 * 엉뚱하게 병합되고, 20m 거리의 진짜 짝은 중복으로 남았다.
 * 이름 일치를 근접보다 우선하고, 같은 등급 안에서는 가까운 쪽을 고른다.
 */
export function findResidentialMatchIndex(
  existing: readonly ResidentialIdentity[],
  planned: ResidentialIdentity,
): number {
  let bestIndex = -1;
  let bestRank = Number.POSITIVE_INFINITY;
  let bestDist = Number.POSITIVE_INFINITY;

  for (let i = 0; i < existing.length; i += 1) {
    const candidate = existing[i];
    if (!isSameResidentialComplex(candidate, planned)) continue;

    const nameA = normalizeComplexName(candidate.name);
    const nameB = normalizeComplexName(planned.name);
    const sameName = !!nameA && !!nameB && (nameA.includes(nameB) || nameB.includes(nameA));
    const rank = sameName ? 0 : 1;
    const dist = distanceM(candidate, planned);

    if (rank < bestRank || (rank === bestRank && dist < bestDist)) {
      bestIndex = i;
      bestRank = rank;
      bestDist = dist;
    }
  }

  return bestIndex;
}

const ADMIN_PREFIX_RE = /(특별시|광역시|특별자치시|특별자치도|[가-힣]도|[가-힣]+시|[가-힣]+군|[가-힣]+구)$/;
const JIBUN_RE = /([가-힣]+(?:동|리|가|읍|면))\s*(\d+(?:-\d+)?)/;

/** 주소 앞머리에서 시도·시군구 접두사를 뽑는다. 예: "경기도 남양주시" */
function extractAdminPrefix(address: string): string {
  const head = address.split("(")[0].trim();
  const tokens = head.split(/\s+/);
  const prefix: string[] = [];
  for (const token of tokens) {
    if (!ADMIN_PREFIX_RE.test(token)) break;
    prefix.push(token);
    if (prefix.length === 2) break;
  }
  return prefix.join(" ");
}

function normalizeLotAddress(value: string): string {
  return value
    .replace(/번지/g, "")
    .replace(/\s*(외|외에)\s*\d+\s*필지/g, "")
    .replace(/\s*일원\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 지오코딩에 순서대로 시도할 주소 후보를 만든다.
 *
 * 청약홈 공급위치는 "경기도 남양주시 다산신도시 상업 2BL (다산동 6192-1번지)"처럼
 * 택지지구·블록 표기가 섞여 원문 그대로는 지오코딩이 실패한다.
 * 괄호 안 지번은 정상 좌표를 주므로 폴백으로 쓴다.
 *
 * 지번이 없는 괄호 내용(단지명 등)으로는 후보를 만들지 않는다.
 * 동 단위 좌표로 떨어지면 단지가 엉뚱한 곳에 찍히기 때문이다.
 */
export function buildGeocodeCandidates(address: string): string[] {
  const original = (address ?? "").trim();
  if (!original) return [];

  const candidates: string[] = [original];
  const push = (value: string) => {
    const trimmed = value.trim();
    if (trimmed && !candidates.includes(trimmed)) candidates.push(trimmed);
  };

  const prefix = extractAdminPrefix(original);

  for (const match of original.matchAll(/\(([^)]*)\)/g)) {
    const inner = match[1];
    const jibun = normalizeLotAddress(inner).match(JIBUN_RE);
    if (!jibun) continue;
    push(prefix ? `${prefix} ${jibun[1]} ${jibun[2]}` : `${jibun[1]} ${jibun[2]}`);
  }

  const withoutParens = normalizeLotAddress(original.replace(/\([^)]*\)/g, ""));
  push(withoutParens);

  const outerJibun = withoutParens.match(JIBUN_RE);
  if (outerJibun) {
    push(prefix ? `${prefix} ${outerJibun[1]} ${outerJibun[2]}` : `${outerJibun[1]} ${outerJibun[2]}`);
  }

  return candidates;
}
