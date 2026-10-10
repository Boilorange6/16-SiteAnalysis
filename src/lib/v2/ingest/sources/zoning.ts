/**
 * VWorld 일별용도지역지구정보(dsId 24) 국토계획 용도지역 5개 레이어 → zoning_area 폴리곤 (reference).
 * 레이어마다 전국 SHP 한 벌(AL_D124 도시, D125 관리, D126 농림, D127 자연환경보전, D128 기타).
 * 속성: A1 지정ID · A3 갱신일 · A4 시군구코드(5) · A5 용도지역코드(UQA122…) · A6 명칭 · A7 지정일(YYYYMMDD) · A8/A9 비고.
 * 겹침·충돌 지정은 합치지 않고 그대로 둔다(D08 "중복 지정·도형 충돌은 별도 범주").
 */
import type BetterSqlite3 from "better-sqlite3";
import { insertFeature } from "../../data/features";
import { batched, SourceStats } from "../build";
import type { ShpRecord } from "../shp";
import { latestShpPerSido, type SidoShpSet } from "../shp-parts";

type Db = BetterSqlite3.Database;

/** 타일 카탈로그 D08 분류 */
export type ZoningClass = "주거" | "상업" | "공업" | "녹지" | "관리" | "농림" | "자연환경보전" | "기타";

export const ZONING_LAYERS = [
  { key: "urban", sourceId: "zoning_urban", title: "국토계획/도시지역", fileTag: "AL_D124", fixed: null },
  { key: "management", sourceId: "zoning_management", title: "국토계획/관리지역", fileTag: "AL_D125", fixed: "관리" },
  { key: "agri_forest", sourceId: "zoning_agri_forest", title: "국토계획/농림지역", fileTag: "AL_D126", fixed: "농림" },
  { key: "nature", sourceId: "zoning_nature", title: "국토계획/자연환경보전지역", fileTag: "AL_D127", fixed: "자연환경보전" },
  { key: "other", sourceId: "zoning_other", title: "국토계획/기타용도지역", fileTag: "AL_D128", fixed: "기타" },
] as const satisfies readonly { key: string; sourceId: string; title: string; fileTag: string; fixed: ZoningClass | null }[];

export type ZoningLayerKey = (typeof ZONING_LAYERS)[number]["key"];

/** rights_json에 기록하는 이용 근거 (A0 검증표 행 5·13) */
export const ZONING_RIGHTS = {
  basis: "data.go.kr 15045898 일별용도지역지구정보 '이용허락범위 제한 없음'",
  decision: "A0 후속 13 권고 기본값: VWorld dsId=24를 내부 업무용으로 적재",
  vworldPageLicense: "VWorld dsId=24 페이지는 '라이센스가 지정되어 있지 않습니다'",
  excluded: "연속주제 파일 15147018(공공누리 4유형)은 쓰지 않는다",
} as const;

/** 좌표를 10 cm로 반올림한다: 농림·관리 레이어(정점 수천만 개)의 파일 크기를 줄이려는 것이고, 용도지역 경계 정확도(수 m)보다 훨씬 작다. */
const ROUND_M = 0.1;

const s = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

/** 도시지역은 명칭으로(코드 접두 UQA1/2/3/4는 보조), 나머지 레이어는 레이어로 분류한다. */
export function zoningClass(layer: (typeof ZONING_LAYERS)[number], name: string | null, code: string | null): ZoningClass {
  if (layer.fixed) return layer.fixed;
  const n = name ?? "";
  for (const c of ["주거", "상업", "공업", "녹지"] as const) if (n.includes(c)) return c;
  const byCode = { UQA1: "주거", UQA2: "상업", UQA3: "공업", UQA4: "녹지" } as const;
  return byCode[(code ?? "").slice(0, 4) as keyof typeof byCode] ?? "기타"; // 도시지역기타·미지정·미분류
}

/** 20190801 → 2019-08-01. 월·일이 00인 값("20140100")은 원문 그대로 둔다. */
export const isoDate = (v: unknown): string | null => {
  const t = s(v);
  const m = t?.match(/^(\d{4})(\d{2})(\d{2})$/);
  return m && m[2] >= "01" && m[2] <= "12" && m[3] >= "01" && m[3] <= "31" ? `${m[1]}-${m[2]}-${m[3]}` : t;
};

/** 압축을 푼 파일 경로들에서 레이어마다 가장 새 날짜의 SHP(분할 파트 포함)를 고른다. 파일명은 AL_D124_00_YYYYMMDD.shp. */
export function zoningLayerFiles(paths: readonly string[]): Map<ZoningLayerKey, SidoShpSet> {
  const out = new Map<ZoningLayerKey, SidoShpSet>();
  for (const l of ZONING_LAYERS) {
    const set = latestShpPerSido(paths, l.fileTag).get("00");
    if (set) out.set(l.key, set);
  }
  return out;
}

export interface ZoningLayerInput {
  layer: ZoningLayerKey;
  releaseId: string;
  records: AsyncIterable<ShpRecord>;
}

/** seen: 같은 지정ID의 순번 계수. 파일 단위로 나눠 적재할 때 호출 사이에 넘겨 같은 stable id 순번을 이어 간다. */
export async function buildZoning(db: Db, layers: ZoningLayerInput[], seen = new Map<string, number>()): Promise<SourceStats[]> {
  const out: SourceStats[] = [];
  for (const input of layers) {
    const layer = ZONING_LAYERS.find((l) => l.key === input.layer)!;
    const stats = new SourceStats(layer.sourceId, input.releaseId, ["designatedDate"]);
    await batched(db, input.records, (r) => {
      stats.read();
      const p = r.properties;
      const g = r.geometry;
      const sigungu = s(p.A4);
      const id = s(p.A1);
      if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon") || !id || !sigungu || !/^\d{5}$/.test(sigungu)) return stats.reject();
      const name = s(p.A6);
      const code = s(p.A5);
      const cls = zoningClass(layer, name, code);
      const props = {
        zoningClass: cls,
        // 세분 없이 "도시지역"이라고만 지정된 우산 폴리곤: 아래 세분 지정과 겹치므로 구성비에서는 빼야 한다
        umbrella: layer.key === "urban" && name === "도시지역",
        zoningCode: code,
        zoningName: name,
        layer: layer.key,
        designatedDate: isoDate(p.A7),
        remark: [s(p.A8), s(p.A9)].filter((x) => x !== null && x !== name),
        sourceUpdatedAt: s(p.A3),
      };
      const stable = `zoning:${id}`;
      const n = seen.get(stable) ?? 0; // 같은 지정ID가 여러 도형으로 오면 순번을 붙인다
      seen.set(stable, n + 1);
      insertFeature(db, { stableId: n === 0 ? stable : `${stable}#${n}`, kind: "zoning_area", sourceKey: id, releaseId: input.releaseId, geometry: g, name, legalCode: `${sigungu}00000`, properties: props, roundM: ROUND_M });
      stats.accept(props, sigungu.slice(0, 2), cls);
    }, 1000);
    out.push(stats);
  }
  return out;
}

/** 적재된 용도지역 행에서 지정ID별 순번 계수를 다시 센다(--resume 후 파일 단위 적재를 잇는 용도). */
export function seedZoningSeen(db: Db): Map<string, number> {
  const seen = new Map<string, number>();
  for (const [key, n] of db.prepare("SELECT source_key, COUNT(*) FROM feature WHERE kind = 'zoning_area' GROUP BY source_key").raw().iterate() as Iterable<[string, number]>) seen.set(`zoning:${key}`, n);
  return seen;
}
