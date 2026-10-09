import type BetterSqlite3 from "better-sqlite3";

const PNU_CHUNK_SIZE = 500;
const PNU_PATTERN = /^\d{19}$/;

type NameRow = { pnu: string; name: string | null; kind: string; stable_id: string };

/**
 * 매매·임대차가 가진 PNU를 core의 단지/오피스텔 이름으로 연결한다.
 * 전국 단위 PNU 목록도 SQLite 변수 상한을 넘지 않도록 500개씩 조회한다.
 * 같은 PNU에 여러 행이 있으면 housing_complex를 우선하고 stable_id로 결정한다.
 */
export function lookupComplexNames(db: BetterSqlite3.Database | null | undefined, pnus: readonly string[]): Map<string, string> {
  const names = new Map<string, string>();
  if (!db) return names;
  const unique = [...new Set(pnus.filter((pnu) => PNU_PATTERN.test(pnu)))];
  for (let offset = 0; offset < unique.length; offset += PNU_CHUNK_SIZE) {
    const chunk = unique.slice(offset, offset + PNU_CHUNK_SIZE);
    const rows = db
      .prepare(`SELECT pnu, name, kind, stable_id FROM feature
        WHERE pnu IN (${chunk.map(() => "?").join(",")})
          AND kind IN ('housing_complex', 'officetel')
        ORDER BY pnu, CASE kind WHEN 'housing_complex' THEN 0 ELSE 1 END, stable_id`)
      .all(...chunk) as NameRow[];
    for (const row of rows) {
      const name = row.name?.trim();
      if (name && !names.has(row.pnu)) names.set(row.pnu, name);
    }
  }
  return names;
}
