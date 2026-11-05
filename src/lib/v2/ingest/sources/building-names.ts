/** 건물 원천 이름의 비교·표시·무의미값 판정 규칙. */

function isOnlyJamo(value: string): boolean {
  return value.length > 0 && [...value].every((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return (codePoint >= 0x1100 && codePoint <= 0x11ff) || (codePoint >= 0xa960 && codePoint <= 0xa97f) || (codePoint >= 0xd7b0 && codePoint <= 0xd7ff);
  });
}

/** W4 자리 채움 기호·단독 자모를 제외하되, 숫자·영문·한글 음절 등 식별 가능한 값은 보존한다. */
export function isMeaningfulBuildingName(value: string | null): boolean {
  const name = value?.normalize("NFKC").trim() ?? "";
  return Boolean(name && /[\p{L}\p{N}]/u.test(name) && !isOnlyJamo(name));
}

/** 건축물대장 주용도 이름(`useLabelOf` 값 전체)과 원천에 자주 오는 용도성 값. 라벨 제목이 되면 안 된다. */
const USE_NAME_NOISE = new Set([
  "단독주택", "공동주택", "제1종근린생활시설", "제2종근린생활시설", "문화및집회시설", "종교시설", "판매시설", "운수시설", "의료시설",
  "교육연구시설", "노유자시설", "수련시설", "운동시설", "업무시설", "숙박시설", "위락시설", "공장", "창고시설", "위험물저장및처리시설",
  "자동차관련시설", "동물및식물관련시설", "자원순환관련시설", "교정및군사시설", "방송통신시설", "발전시설", "묘지관련시설", "관광휴게시설",
  "장례시설", "야영장시설", "다세대주택", "연립주택", "다가구주택", "창고", "경비실",
]);

/**
 * 지도 라벨 제목이 되면 안 되는 이름: 동 번호·한글 동 기호·용도 이름·지번·코드·치수·소유자/용도 문장.
 * 진짜 단지·건물 이름(`개포1차우성아파트6동`, `예일빌라(다동)`)은 거짓이다. 빈 값은 잡음이다.
 */
export function isLabelNoiseName(value: string | null): boolean {
  const name = value?.normalize("NFKC").trim() ?? "";
  if (!name) return true;
  const compact = name.replace(/\s/g, "");
  return /^\d+$/.test(name)
    || /^\d+동$/.test(name)
    || /^[A-Za-z가-힣]{1,2}동$/.test(name)
    || USE_NAME_NOISE.has(compact)
    || /^\d+-\d+$/.test(name)
    || /^[A-Z]\d{3,}$/.test(name)
    || /^\d+(_\d+)+$/.test(name)
    || /^\d+(\.\d+)?m?x\d+(\.\d+)?m?$/i.test(name)
    || /^[가-힣0-9]+[동리가]\s+산?\d+(-\d+)?(\s|$)/.test(name)
    || /\s\([가-힣]{3}\)$/.test(name)
    || /^[가-힣]{2,4}\s건물$/.test(name)
    // 법인 표기(`(유)갈현상가`, `서울주택(주)`, `㈜`은 NFKC로 `(주)`)로 시작하거나 끝나면 단지·건물 이름이 아니라 소유 법인이다.
    // 표기를 뗀 나머지에 띄어쓰기가 있으면(`(주)건영 경로당`) 법인 뒤에 시설 이름이 붙은 것이라 이름으로 둔다.
    || (CORP_MARK.test(name) && !/\s/.test(name.replace(CORP_MARK, "")));
}

const CORP_MARK = /^(\([유주재사]\)|주식회사|유한회사)\s*|\s*(\([유주재사]\)|주식회사|유한회사)$/;

/** 단지·동 이름의 표기 차이(공백·괄호·구두점)만 제거한다. 모르는 접두어는 보수적으로 남긴다. */
export function normalizeBuildingName(value: string | null): string | null {
  const name = value?.trim();
  return name ? name.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/[\s()·,._\-/\\]/g, "") : null;
}

/**
 * 도로명주소 원천의 표시용 건물명과 동/상세명을 하나의 라벨로 조립한다.
 * 비교용 정규화(normalizeBuildingName)와 달리 표시 문자열의 공백·구두점은 보존한다.
 * 단, 문자·숫자가 하나도 없는 값은 원천의 자리 채움 기호로 보고 버린다.
 */
export function composeBuildingName(value: string | null, detail: string | null): string | null {
  const cleanPart = (candidate: string | null): string | null => {
    const part = candidate?.normalize("NFKC").trim() ?? "";
    return isMeaningfulBuildingName(part) ? part : null;
  };
  const name = cleanPart(value);
  const extra = cleanPart(detail);
  if (!name) return extra;
  if (!extra) return name;

  const normalizedName = normalizeBuildingName(name);
  const normalizedExtra = normalizeBuildingName(extra);
  if (!normalizedName || !normalizedExtra) return name;
  if (normalizedName === normalizedExtra || normalizedName.includes(normalizedExtra)) return name;
  if (normalizedExtra.includes(normalizedName)) return extra;
  return `${name} ${extra}`;
}
