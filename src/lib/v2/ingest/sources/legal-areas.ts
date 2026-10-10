/**
 * VWorld 법정구역정보(dsId 21) → 시군구·읍면동 경계 feature + 이름표(legal_area).
 * 리(里)는 경계가 필요 없고 주소 풀이용 이름만 넣는다.
 */
import type BetterSqlite3 from "better-sqlite3";
import { insertFeature } from "../../data/features";
import { batched, SourceStats } from "../build";
import type { ShpRecord } from "../shp";

type Db = BetterSqlite3.Database;

interface Layer {
  sourceId: string;
  level: "sigungu" | "emd" | "ri";
  codeLength: number;
  featureKind: string | null;
  legalCode: (code: string) => string;
  parent: (code: string) => string | null;
}

const LAYERS: Record<"sig" | "emd" | "ri", Layer> = {
  sig: { sourceId: "legal_sigungu", level: "sigungu", codeLength: 5, featureKind: "legal_sigungu", legalCode: (c) => `${c}00000`, parent: () => null },
  emd: { sourceId: "legal_emd", level: "emd", codeLength: 8, featureKind: "legal_emd", legalCode: (c) => `${c}00`, parent: (c) => c.slice(0, 5) }, // A4는 구가 있는 시(성남 등)에서 시 단위 코드라 쓰지 않는다
  ri: { sourceId: "legal_ri", level: "ri", codeLength: 10, featureKind: null, legalCode: (c) => c, parent: (c) => c.slice(0, 8) },
};

async function loadLayer(db: Db, layer: Layer, records: AsyncIterable<ShpRecord>, releaseId: string): Promise<SourceStats> {
  const stats = new SourceStats(layer.sourceId, releaseId, []);
  const insertArea = db.prepare("INSERT OR IGNORE INTO legal_area (code, level, name, parent_code, release_id) VALUES (?, ?, ?, ?, ?)");
  await batched(db, records, (r) => {
    stats.read();
    const code = r.properties.A1;
    const name = r.properties.A2;
    if (typeof code !== "string" || !new RegExp(`^\\d{${layer.codeLength}}$`).test(code) || typeof name !== "string") return stats.reject();
    if (layer.featureKind && !r.geometry) return stats.reject();
    if (insertArea.run(code, layer.level, name, layer.parent(code), releaseId).changes === 0) return stats.reject();
    if (layer.featureKind && r.geometry) {
      insertFeature(db, {
        stableId: `${layer.level === "sigungu" ? "sig" : layer.level}:${code}`,
        kind: layer.featureKind,
        sourceKey: code,
        releaseId,
        geometry: r.geometry,
        name,
        legalCode: layer.legalCode(code),
      });
    }
    stats.accept({}, code.slice(0, 2), layer.level);
  }, 500);
  return stats;
}

export async function buildLegalAreas(
  db: Db,
  input: { sig: AsyncIterable<ShpRecord>; emd: AsyncIterable<ShpRecord>; ri: AsyncIterable<ShpRecord>; releaseId: string },
): Promise<SourceStats[]> {
  return [
    await loadLayer(db, LAYERS.sig, input.sig, input.releaseId),
    await loadLayer(db, LAYERS.emd, input.emd, input.releaseId),
    await loadLayer(db, LAYERS.ri, input.ri, input.releaseId),
  ];
}
