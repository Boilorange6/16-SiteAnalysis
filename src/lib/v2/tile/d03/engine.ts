/** D03 건축물 용도 — 반경 안 건물의 주용도코드 분포. */
import type { TileResult } from "../../tile-result";
import type { EngineContext } from "../../engine/context";
import { buildingRetirementLimitations, buildingRows, BUILDING_SOURCES, isCounted, type BuildingRow } from "../../engine/tiles/buildings-shared";
import { makeTile, missing, obs, polygonCandidate, type PolygonCandidate, type TileDraft } from "../../engine/tiles/common";
import { areaInCircle, polygonArea, polygonParts } from "../../engine/tiles/geo";
import { notProvided } from "../../engine/tiles/not-provided";

/** 화면·지표에서 사용하는 고정 10분류 순서. */
export const USE_CLASSES = ["주거", "근린생활", "업무", "판매", "숙박", "문화집회", "교육복지", "공업", "기타", "미상"] as const;
type UseClass = (typeof USE_CLASSES)[number];

const CODE_TO_CLASS: Readonly<Record<string, UseClass>> = {
  "01": "주거", "02": "주거",
  "03": "근린생활", "04": "근린생활",
  "05": "문화집회", "06": "문화집회", "13": "문화집회", "27": "문화집회",
  "07": "판매",
  "08": "기타", "20": "기타", "21": "기타", "23": "기타", "26": "기타", "28": "기타", "29": "기타",
  "09": "교육복지", "10": "교육복지", "11": "교육복지", "12": "교육복지",
  "14": "업무", "24": "업무",
  "15": "숙박", "16": "숙박",
  "17": "공업", "18": "공업", "19": "공업", "22": "공업", "25": "공업",
};

const CODE_TO_LABEL: Readonly<Record<string, string>> = {
  "01": "단독주택",
  "02": "공동주택",
  "03": "제1종근린생활시설",
  "04": "제2종근린생활시설",
  "05": "문화및집회시설",
  "06": "종교시설",
  "07": "판매시설",
  "08": "운수시설",
  "09": "의료시설",
  "10": "교육연구시설",
  "11": "노유자시설",
  "12": "수련시설",
  "13": "운동시설",
  "14": "업무시설",
  "15": "숙박시설",
  "16": "위락시설",
  "17": "공장",
  "18": "창고시설",
  "19": "위험물저장및처리시설",
  "20": "자동차관련시설",
  "21": "동물및식물관련시설",
  "22": "자원순환관련시설",
  "23": "교정및군사시설",
  "24": "방송통신시설",
  "25": "발전시설",
  "26": "묘지관련시설",
  "27": "관광휴게시설",
  "28": "장례시설",
  "29": "야영장시설",
};

/** 5자리 주용도코드의 앞 2자리를 10분류로 바꾼다. */
export function useClassOf(code: string | null | undefined): UseClass {
  if (typeof code !== "string") return "미상";
  return CODE_TO_CLASS[code.trim().slice(0, 2)] ?? "미상";
}

/** 범례 분류명을 반복하지 않는, 원천 주용도 값이다. 미상은 sublabel로 내보내지 않는다. */
export function useLabelOf(code: string | null | undefined): string | null {
  if (typeof code !== "string") return null;
  return CODE_TO_LABEL[code.trim().slice(0, 2)] ?? null;
}

const pct = (part: number, whole: number) => Math.round((part / whole) * 1000) / 10;

function emptyClassCounts(): Map<UseClass, number> {
  return new Map(USE_CLASSES.map((useClass) => [useClass, 0] as const));
}

function fullGeometryArea(row: BuildingRow): number {
  return polygonParts(row.hit.geometry).reduce((sum, rings) => sum + polygonArea(rings), 0);
}

export function d03(ctx: EngineContext): TileResult {
  const rows = buildingRows(ctx);
  if (rows === null) return notProvided(ctx, "D03");

  const total = rows.filter((row) => isCounted(ctx, row)).length; // 동수·구성비는 중심점이 반경 안인 건물만, 그림은 교차 전부
  const counts = emptyClassCounts();
  const areaByClass = emptyClassCounts();
  const polygons: PolygonCandidate[] = [];
  let confirmed = 0;
  let areaDenominator = 0;
  let invalidGeometry = 0;

  for (const row of rows) {
    const useClass = useClassOf(row.useCode);
    const counted = isCounted(ctx, row);
    if (counted) counts.set(useClass, (counts.get(useClass) ?? 0) + 1);
    if (counted && useClass !== "미상") confirmed += 1;

    const clipped = areaInCircle(ctx.input.center, ctx.input.radiusM, row.hit.geometry);
    if (clipped === null) {
      invalidGeometry += 1;
      continue;
    }

    for (const rings of clipped.parts) {
      const name = row.hit.name ?? null;
      const polygon = polygonCandidate(row.hit.featureId, `use:${useClass}`, rings, polygonArea(rings), null, {
        name,
        sublabel: useLabelOf(row.useCode),
        labelPriority: name === null ? 0 : 1,
        counted, // 그래프 동수가 엔진 동수(중심점이 반경 안)를 따른다
      });
      if (polygon) polygons.push(polygon);
    }

    if (row.footprintM2 !== null && clipped.areaM2 > 0) {
      const geometryArea = fullGeometryArea(row);
      if (geometryArea > 0) {
        // footprintM2는 원본 속성값을 보존하되, 반경 경계에 걸친 동은 교차 면적 비율만 반영한다.
        const insideRatio = Math.min(1, clipped.areaM2 / geometryArea);
        const insideFootprintM2 = row.footprintM2 * insideRatio;
        areaDenominator += insideFootprintM2;
        areaByClass.set(useClass, (areaByClass.get(useClass) ?? 0) + insideFootprintM2);
      }
    }
  }

  const coverage = ctx.coverage("buildings", BUILDING_SOURCES);
  const retirementLimitations = buildingRetirementLimitations(ctx);
  const status: TileResult["status"] = invalidGeometry > 0 || retirementLimitations.length > 0 || coverage.some((limitation) => limitation.kind === "partial" || limitation.kind === "incomplete") ? "partial" : "complete";
  const areaFormula = "d03-area-share@1:반경 교차 발자국 면적÷유효 발자국 면적(footprintM2 확인 동)";
  const metrics: TileDraft["metrics"] = [
    total === 0
      ? missing("fill_use_pct", "주용도 확인 동수", "%", "d03-fill-use@1:주용도 확인 동수÷반경 안(중심점 기준) 건물 동수")
      : obs("fill_use_pct", "주용도 확인 동수", pct(confirmed, total), "%", "d03-fill-use@1:주용도 확인 동수÷반경 안(중심점 기준) 건물 동수", confirmed, total),
    ...USE_CLASSES.map((useClass, index) => {
      const count = counts.get(useClass) ?? 0;
      return total === 0
        ? missing(`share_use_${index + 1}`, `구성비: ${useClass}`, "%", "d03-share-use@1:분류별 건물 동수÷반경 안(중심점 기준) 건물 동수")
        : obs(`share_use_${index + 1}`, `구성비: ${useClass}`, pct(count, total), "%", "d03-share-use@1:분류별 건물 동수÷반경 안(중심점 기준) 건물 동수", count, total);
    }),
    ...USE_CLASSES.map((useClass, index) => {
      const area = areaByClass.get(useClass) ?? 0;
      return areaDenominator <= 0
        ? missing(`area_share_${index + 1}`, `발자국 면적 구성비: ${useClass}`, "%", areaFormula)
        : obs(`area_share_${index + 1}`, `발자국 면적 구성비: ${useClass}`, pct(area, areaDenominator), "%", areaFormula, Math.round(area), Math.round(areaDenominator));
    }),
  ];

  const limitations = [...retirementLimitations, ...coverage];
  if (areaDenominator <= 0 && total > 0) {
    limitations.push({ kind: "unknown", note: "footprintM2가 확인된 건물이 없어 발자국 면적 구성비를 산출하지 못했습니다." });
  } else if (areaDenominator > 0 && rows.some((row) => row.footprintM2 === null)) {
    limitations.push({ kind: "partial", note: "발자국 면적 구성비는 footprintM2가 확인된 건물만 분모에 포함합니다." });
  }
  if (invalidGeometry > 0) {
    limitations.push({ kind: "partial", note: `도형 오류로 반경 절단·지도 표시가 안 된 ${invalidGeometry}건은 면적 구성비에서도 빠졌습니다.` });
  }

  const leadingUse = USE_CLASSES.reduce<{ useClass: UseClass; count: number } | null>((best, useClass) => {
    if (useClass === "미상") return best;
    const count = counts.get(useClass) ?? 0;
    return count > (best?.count ?? 0) ? { useClass, count } : best;
  }, null);
  const leadingUseSentence = leadingUse
    ? `확인된 주용도 중 최다는 ${leadingUse.useClass} ${leadingUse.count.toLocaleString("en-US")}동`
    : "확인된 주용도 분류 없음";
  const sentence = total === 0
    ? "반경 안 건물이 확인되지 않아 건축물 용도를 산출하지 못함 → 용도 자료와 현장 확인 필요"
    : `반경 안 건물 ${total.toLocaleString("en-US")}동 중 주용도 확인 ${pct(confirmed, total)}% → ${leadingUseSentence} → 확인된 주용도별 건물 동수 분포를 표시하고 미상은 별도로 구분 → 건축물대장 주용도와 실제 이용 현황 확인 필요`;

  return makeTile(ctx, {
    code: "D03",
    type: "diagram",
    status,
    metrics,
    judgment: { ruleId: "D03-use@1", basisMetricIds: ["fill_use_pct"], sentence, level: null, criteria: null },
    sources: ctx.sources("buildings", BUILDING_SOURCES),
    layers: USE_CLASSES.map((useClass) => `use:${useClass}`),
    polygons,
    limitations,
  });
}
