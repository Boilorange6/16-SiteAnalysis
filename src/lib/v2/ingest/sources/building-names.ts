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
