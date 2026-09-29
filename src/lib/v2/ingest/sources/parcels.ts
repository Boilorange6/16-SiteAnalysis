/**
 * 연속지적도 → 필지 대표점(bbox 중심). 전국 약 3,900만 필지라 도형은 저장하지 않는다.
 * ponytail: bbox 중심 — ㄷ자 필지는 대표점이 필지 밖일 수 있다. 필지 도형 적재(P2) 때 내부점으로 바꾼다.
 */
import type BetterSqlite3 from "better-sqlite3";
import { batched, SourceStats } from "../build";
import type { ShpPointRecord } from "../shp";

export function jimokOf(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^(?:산\s*)?[\d-]+\s*([^\d\s-]+)$/);
  return m ? m[1] : null;
}

export async function buildParcelPoints(db: BetterSqlite3.Database, records: AsyncIterable<ShpPointRecord>, releaseId: string): Promise<SourceStats> {
  const stats = new SourceStats("parcel", releaseId, ["jimok"]);
  const insert = db.prepare("INSERT OR IGNORE INTO parcel_point (pnu, lng, lat, jimok, release_id) VALUES (?, ?, ?, ?, ?)");
  await batched(db, records, (r) => {
    stats.read();
    const pnu = r.properties.A1;
    if (typeof pnu !== "string" || !/^\d{19}$/.test(pnu) || !r.point) return stats.reject();
    const jimok = jimokOf(r.properties.A5);
    if (insert.run(pnu, r.point[0], r.point[1], jimok, releaseId).changes === 0) return stats.reject(); // 중복 PNU
    stats.accept({ jimok }, pnu.slice(0, 2), "parcel");
  });
  return stats;
}
