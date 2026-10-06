/**
 * TileResult → 화면 문자열. 화면이 쓰는 문구는 전부 여기서 만든다 (컴포넌트에는 문구 로직 없음).
 * 규칙: 종합 점수 없음 · 도보 시간 없음 · 공급/가격/개발은 좋음·주의 평가 없음 (plan 화면 규칙 1~8).
 */
import type { OUTPUT_FACES, RasterRef, RoseSeason, TileResult } from "../tile-result";
import type { Scene } from "../scene";
import { fmtInt, rankComplexes, rankSupply, STOCK_LEGEND, SUPPLY_LAYERS, SUPPLY_LEGEND, summarize, supplyStats, type CalloutLegendSpec, type Complex, type Stat } from "./callout-layout";
import type { MapModel } from "./map-layers";
import type { MassModel } from "./mass-projection";
import { catalogEntry, sourceName } from "./tile-catalog";
import type { RoseModel } from "./wind-rose";

export type OutputFace = (typeof OUTPUT_FACES)[number];
export type Badge = { text: string; note?: string; tone: "status" | "limit" | "model" };
export type Row = { label: string; value: string; aux?: string; tag?: string };
export type TileView = {
  tileId: string;
  code: string;
  title: string;
  color: string;
  status: TileResult["status"];
  badges: Badge[];
  headline: { value: string; label: string; aux?: string; tag?: string } | null;
  rows: Row[];
  sentence: string | null;
  grade: { label: string; criteria: string } | null;
  /** 근거 지표별 등급 칩 ("철도 좋음", "버스 보통") — A01/A02만. 없으면 빈 배열 */
  grades: Array<{ target: string; label: string; level: "good" | "fair" | "caution"; criteria: string }>;
  caveats: string[];
  notes: string[];
  sourceLine: string;
  chart: { label: string; value: number; unit: string }[] | null;
  hasFace: boolean;
  retryable: boolean;
  /** 지도 타일이면 지도 그림 입력, 아니면 null */
  map: MapModel | null;
  /** 지물 없는 대지·반경 지도. 지도 타일이 아니거나 결과가 없을 때 전면 배경으로 쓴다 (빈 흰 카드 금지) */
  backdrop: MapModel;
  /** 종류 배지 문구 */
  kindLabel: string;
  /** 주변 단지 설명선 타일(A05) 입력. 결과가 없으면 null */
  callout: CalloutModel | null;
  /** S01 축측 매스. Scene이 없을 때도 카메라·반경만으로 빈 틀을 그릴 수 있다. */
  mass: MassModel | null;
  /** D22 풍향·풍속 누적 모델. */
  rose?: RoseModel | null;
  /** D22 연간·계절 풍향·풍속 누적 모델. */
  roses?: Record<RoseSeason, RoseModel> | null;
  /** STACK 카드의 층 이름. 일반 타일은 null. */
  stackLayers: string[] | null;
  /** SHEET 카드가 참조하는 하위 타일과 격자. 일반 타일은 null. */
  sheetTiles: string[] | null;
  sheetGrid: "2x2" | "3x2" | "3x1" | null;
};

/** 설명선 타일의 입력: 세대수 순위로 정렬된 단지 목록과 요약 (A06도 같은 모양으로 채운다) */
export type CalloutModel = {
  /** stock = A05 주변 단지, supply = A06 분양·입주예정 사업 */
  kind: "stock" | "supply";
  /** 개수 단위: "단지" | "곳" */
  unit: string;
  legend: CalloutLegendSpec;
  /** 개요 값 카드 (원천별 값은 합치지 않는다) */
  stats: Stat[];
  statNote: string | null;
  /** 보드 카드 왼쪽 아래 한 줄 값 */
  pill: Array<{ value: string; unit: string }>;
  center: readonly [number, number];
  radiusM: number;
  complexes: Complex[];
  /** 연립·다세대 등 기타 공동주택: 번호 없는 작은 회색 점으로만 그린다 */
  others: Array<{ lng: number; lat: number }>;
  analysisYear: number;
  /** 빈 상태 판·개요의 기준 문구 (출처 + 기준일) */
  sourceLine: string;
  summary: ReturnType<typeof summarize>;
};

const KIND_LABEL = { analysis: "분석", diagram: "도판", simulation: "시뮬레이션" } as const;
const MAP_NOTES: Record<string, string> = {
  D04: "건물 발자국 · 준공 연대별 색",
  D13: "도로 중심선 · 실제 폭·공식 도로대장 아님 · © OpenStreetMap contributors",
  D02: "발자국 · 높이 미상은 테두리만",
  D05: "지상층수 기준",
  D06: "높이 35m 기준 · [추정]은 층수×3m",
  D07: "높이 12m 기준 · [추정]은 층수×3m",
  D14: "운영 시설만 · 계획 철도 제외",
  D19: "연속지적 · 참조용",
  D20: "도형 면적 기준(공부면적 아님)",
  D15: "OSM 도로로 폐합된 블록 · 반경 밖 500m까지 읽음",
  D16: "건물 수 KDE · 대역폭 100m · 20백분위 구간",
  D17: "Copernicus DEM GLO-30(약 30m) 지표고 · EGM2008 · 중심 상대고",
  D18: "Copernicus DEM GLO-30 30m 격자 경사 · EGM2008 · 옹벽·미세 지형 미반영",
  D21: "기하학적 일조 · 09~15시 10분 간격",
  S02: "하지 평균 일조시간 · 건물·지형 그림자 반영",
  D27: "1km 격자 · 비밀보호 노이즈",
  D26: "VWorld 학구도·학교군 · 대상 구역 강조 · 기준일은 출처 띠",
  A04: "대표점 · 원천 면적 비례 (경계 아님)",
  A05: "원 크기 = 세대수 · 속 빈 원 = 세대수 미확인",
  A06: "원천별 표시 · 중복 가능",
  D01: "VWorld 항공영상 · 촬영시기 미확인",
  D10: "항공사진 색 기반 수관 검출 · 재현율 미검증 · OSM 녹지 보조",
  D28: "OSM 보행망 · 80 m/분 · 내부 제안 기준",
  D29: "건물·지형 기준 하늘열림(SVF) · 수목 제외",
  D22: "ASOS 최근접 관측소 · 연간·계절 16방위 바람장미",
  S03: "조기설계 참고용 · 풍동 검증 없음 · 주풍향 1방향",
};

function mapOf(r: TileResult): RasterMapModel | null {
  if (r.status !== "complete" && r.status !== "partial") return null;
  const features = r.presentation.features ?? [];
  const polygons = r.presentation.polygons ?? [];
  const lines = r.presentation.lines ?? [];
  const presentation = r.presentation as ExtendedPresentation;
  const rasterOptions = presentation.rasters ?? [];
  const defaultRaster = rasterDefaultName(r.tileCode, rasterOptions, presentation);
  const rasters = defaultRaster ? rasterOptions.filter((ref) => ref.name === defaultRaster) : [];
  const basemap = presentation.basemap;
  if (features.length === 0 && polygons.length === 0 && lines.length === 0 && rasterOptions.length === 0 && !basemap) return null;
  const notes = MAP_NOTES[r.tileCode] ? [MAP_NOTES[r.tileCode]] : [];
  if (r.tileCode === "A01" && r.metrics.some((m) => m.id === "nearest_rail_m" && m.status === "missing")) notes.push("철도 자료 미적재 · 버스정류장만 표시");
  // 래스터가 그려지는 타일은 건물·그림자를 래스터 셀이 담당하므로 "지물 없음"이 아니다.
  if (features.length === 0 && polygons.length === 0 && lines.length === 0 && rasterOptions.length === 0) notes.push("반경 안 표시할 지물 없음");
  if (rasters.some((ref) => ref.palette === "utci")) notes.push("흰색 = 건물 · 회색 = 풍속 입력 범위 밖");
  return {
    center: r.conditions.center,
    radiusM: r.conditions.radiusM,
    features,
    analysisId: r.analysisId,
    tileCode: r.tileCode,
    basemap,
    rasters,
    polygons,
    polygonsTotal: r.presentation.polygonsTotal ?? polygons.length,
    lines,
    linesTotal: r.presentation.linesTotal ?? lines.length,
    total: r.presentation.featuresTotal ?? features.length,
    notes,
    ...(r.presentation.legend.length > 0 ? { legend: r.tileCode === "S02" ? extendSunHoursLegend(r.presentation.legend) : r.presentation.legend } : {}),
    ...(rasterOptions.length > 0 ? { rasterOptions } : {}),
    ...(defaultRaster ? { defaultRaster, rasters } : {}),
  };
}

/** T31의 컷 선택이 카드·상세·PPT 공통 경로를 재사용하도록 래스터 하나만 남긴다. */
export function viewWithOnlyRaster(view: TileView, rasterName: string, note: string): TileView {
  if (!view.map) return view;
  const model = view.map as RasterMapModel;
  const options = model.rasterOptions ?? model.rasters ?? [];
  const selected = options.find((ref) => ref.name === rasterName);
  if (!selected) return view;
  const nextMap: RasterMapModel = {
    ...model,
    rasters: [selected],
    defaultRaster: selected.name,
    ...(note && !model.notes.includes(note) ? { notes: [...model.notes, note] } : {}),
  };
  return {
    ...view,
    map: nextMap,
  };
}

const STATUS_TEXT: Partial<Record<TileResult["status"], string>> = {
  partial: "일부 자료만 집계",
  failed: "계산 실패",
  cancelled: "취소됨",
  no_data: "자료 없음",
  not_provided: "다음 단계에서 제공",
  pending: "계산 대기",
  running: "계산 중",
};
const LIMIT_TEXT: Record<TileResult["limitations"][number]["kind"], string> = {
  estimated: "추정",
  incomplete: "지역 자료 불완전",
  partial: "일부 자료만 집계",
  unknown: "미확인",
  suppressed: "비공개",
  not_provided: "자료 미확보",
};
const GRADE_TEXT = { good: "좋음", fair: "보통", caution: "주의" } as const;
// 등급은 거리 지표 타일에서만 쓴다 (공급·가격·개발은 평가하지 않음).
const GRADED_CODES = new Set(["A01", "A02"]);
const GRADE_TARGET: Record<string, string> = { nearest_rail_m: "철도", nearest_station_m: "철도", nearest_bus_m: "버스", nearest_elem_m: "초등학교" };
function gradeChip(r: TileResult, g: NonNullable<NonNullable<TileResult["judgment"]>["grades"]>[number]): TileView["grades"][number] {
  const target = GRADE_TARGET[g.metricId] ?? r.metrics.find((m) => m.id === g.metricId)?.label ?? g.metricId;
  return { target, label: `${target} ${GRADE_TEXT[g.level]}`, level: g.level, criteria: `내부 제안 기준: ${g.criteria}` };
}
const CAVEATS: Record<string, string> = {
  A02: "배정은 교육청 확인",
  S02: "건물·지형 모델에 의한 기하학적 일조 추정입니다. 구름·실제 기상·창면 조건 및 법적 일조 판정을 포함하지 않습니다.",
  S03: "브라우저 탐색용 바람 모형입니다. 보행 안전·구조설계·인허가·검증된 CFD 결과로 사용할 수 없습니다.",
  S04: "UTCI 근사 · 계절×시각 대표 기상 · 자리끼리 비교",
};
const MODEL_BADGE: Record<string, string> = { S02: "그림자 추정 · 법적 판정 아님", S03: "탐색용 · 검증 CFD 아님", S04: "근사 · 건강 위험 예측 아님" };

type ExtendedPresentation = TileResult["presentation"] & {
  /** T31이 저장 결과 계약에 추가할 수 있는 명시적 기본 래스터. */
  defaultRaster?: string;
};

/** MapModel은 기존 타일 레이어와의 호환을 위해 유지하고, 래스터 표시 메타만 런타임으로 확장한다. */
type RasterMapModel = MapModel & {
  legend?: TileResult["presentation"]["legend"];
  defaultRaster?: string;
  /** 화면에는 기본 래스터만 넣고, 컷 전환용 전체 목록은 별도로 보존한다. */
  rasterOptions?: RasterRef[];
};

type PrimaryRasterRef = RasterRef & { primary?: boolean };

function rasterDefaultName(tileCode: string, refs: RasterRef[], presentation: ExtendedPresentation): string | null {
  const declared = presentation.defaultRaster;
  if (declared && refs.some((ref) => ref.name === declared)) return declared;
  const primary = refs.find((ref) => (ref as PrimaryRasterRef).primary === true);
  if (primary) return primary.name;
  // 현재 S02 결과는 날짜 순서가 춘분부터지만, 카드·상세의 대표 장면은 하지로 고정한다.
  if (tileCode === "S02" && refs.some((ref) => ref.name === "sun_hours_summer")) return "sun_hours_summer";
  // S04의 대표 컷은 문장·헤드라인과 같은 여름 14시다. 나머지 11컷은 rasterOptions로 남는다.
  if (tileCode === "S04" && refs.some((ref) => ref.name === "utci_summer_h14")) return "utci_summer_h14";
  return refs[0]?.name ?? null;
}

/** 화면용 일조 범례는 하지 낮 길이까지 읽히도록 0~15시간과 15+를 보여 준다. */
function extendSunHoursLegend(legend: TileResult["presentation"]["legend"]): TileResult["presentation"]["legend"] {
  const sunEntries = legend.filter((entry) => entry.label.includes("일조시간") && (entry.min !== null || entry.max !== null));
  if (sunEntries.length === 0) return legend;
  const prefix = sunEntries[0]!.label.split(" · ")[0] ?? "일조시간";
  const hourly = Array.from({ length: 16 }, (_, index) => ({
    label: index === 15 ? `${prefix} · 15시간 이상` : `${prefix} · ${index}시간`,
    min: index,
    max: index === 15 ? null : index + 1,
  }));
  return [...legend.filter((entry) => !entry.label.includes("일조시간")), ...hourly];
}

export const FACE_TEXT: Record<OutputFace, string> = { front: "도판", back: "구성비", both: "도판 + 구성비" };
export const faceLabel = (f: OutputFace) => FACE_TEXT[f];

function massOf(r: TileResult, scene: Scene | null | undefined): MassModel | null {
  if (r.tileCode !== "S01" || !r.presentation.camera) return null;
  const camera = r.presentation.camera;
  if (typeof camera.azimuthDeg !== "number" || typeof camera.elevationDeg !== "number") return null;
  return {
    scene: scene ?? null,
    camera: {
      azimuthDeg: camera.azimuthDeg,
      elevationDeg: camera.elevationDeg,
      radiusM: typeof camera.radiusM === "number" ? camera.radiusM : r.conditions.radiusM,
    },
  };
}

const group = (n: number) => {
  const [i, f] = String(n).split(".");
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (f ? `.${f}` : "");
};
/** 화면·타일·PPT가 공유하는 직선거리 표기. 1 km 이상은 소수 한 자리 km로 줄인다. */
export function formatDistanceM(distanceM: number): string {
  if (!Number.isFinite(distanceM) || distanceM < 0) return "미확인";
  return distanceM >= 1000 ? `${(distanceM / 1000).toFixed(1)} km` : `${Math.round(distanceM).toLocaleString("en-US")}m`;
}
const withUnit = (n: number, unit: string) => {
  if (unit === "m") return formatDistanceM(n);
  const v = unit === "년" ? String(n) : group(n); // 연도는 자리 구분 쉼표 없음
  return unit === "" ? v : unit.length > 2 && !unit.startsWith("/") ? `${v} ${unit}` : `${v}${unit}`;
};

/** S04 표시 규칙: °C·m/s·도는 소수 1자리, %·W/m²는 정수(1% 미만 면적률만 0 대신 소수 1자리). */
function roundForDisplay(n: number, unit: string): number {
  if (unit === "°C" || unit === "m/s" || unit === "도") return Math.round(n * 10) / 10;
  if (unit === "W/m²") return Math.round(n);
  if (unit === "%") return n > 0 && n < 1 ? Math.round(n * 10) / 10 : Math.round(n);
  return n;
}

function metricRow(m: TileResult["metrics"][number], round = false): Row {
  const base = { label: m.label };
  switch (m.status) {
    case "missing":
      return { ...base, value: "미확인" };
    case "suppressed":
      return { ...base, value: "비공개" };
    case "not_applicable":
      return { ...base, value: "해당 없음" };
    default:
      return {
        ...base,
        value: withUnit(round ? roundForDisplay(m.value as number, m.unit) : (m.value as number), m.unit),
        ...(m.unit === "m" ? { aux: "직선" } : {}),
        ...(m.status === "estimated" ? { tag: "추정" } : {}),
      };
  }
}

export function sourceLineOf(sources: TileResult["provenance"]["sources"]): string {
  if (sources.length === 0) return "출처 없음";
  return sources
    .map((s) => {
      // source_release uses the fetched date in releaseId when sourceAsOf is unavailable.
      const releaseDate = /@(\d{4}(?:-\d{2}){0,2})$/.exec(s.releaseId)?.[1] ?? null;
      return `${sourceName(s.sourceId)} ${s.sourceAsOf ?? releaseDate ?? "기준일 미확인"}`;
    })
    .join(" · ");
}

export function toTileView(r: TileResult, scene?: Scene | null): TileView {
  const cat = catalogEntry(r.tileCode);
  const badges: Badge[] = [];
  const statusText = STATUS_TEXT[r.status];
  if (statusText) badges.push({ text: statusText, tone: "status" });
  for (const l of r.limitations) {
    badges.push({ text: LIMIT_TEXT[l.kind], note: l.note, tone: "limit" });
    if (r.tileCode === "A06" && l.note.includes("중복")) badges.push({ text: "중복 가능 · 합계 보류", note: l.note, tone: "limit" });
  }
  if (MODEL_BADGE[r.tileCode]) badges.push({ text: MODEL_BADGE[r.tileCode], tone: "model" });
  // 같은 문구의 배지는 하나로 합치고 note는 이어 붙인다.
  const merged = new Map<string, Badge>();
  for (const b of badges) {
    const prev = merged.get(b.text);
    if (!prev) merged.set(b.text, { ...b });
    else if (b.note && prev.note !== b.note) prev.note = prev.note ? `${prev.note} / ${b.note}` : b.note;
  }

  const overlap = r.tileCode === "A06";
  const isS04 = r.tileCode === "S04";
  let metrics = r.metrics.filter((m) => !(overlap && /total|sum/.test(m.id)));
  if (isS04) {
    // 대표 컷(여름 14시) 지표를 맨 앞에 두고, 같은 값의 접미사 없는 별칭 지표는 행에서 뺀다.
    const cutSuffix = /_(spring|summer|autumn|winter)_h\d+$/;
    const representative = (id: string) => id.endsWith("_summer_h14");
    metrics = [
      ...metrics.filter((m) => representative(m.id)),
      ...metrics.filter((m) => cutSuffix.test(m.id) && !representative(m.id)),
    ];
  }
  const rows = metrics.map((m) => metricRow(m, isS04));
  const caveats = CAVEATS[r.tileCode] ? [CAVEATS[r.tileCode]] : [];

  let headline: TileView["headline"] = null;
  const hasResult = r.status === "complete" || r.status === "partial";
  if (hasResult && metrics.length > 0) {
    if (r.tileCode === "A02") {
      const zone = metrics.find((m) => m.id === "in_school_zone");
      const asOf = r.provenance.sources.find((s) => s.sourceId === "school_zone")?.sourceAsOf;
      const inside = zone?.status === "observed" ? (zone.value === 1 ? "통학구역 안" : "통학구역 밖") : "통학구역 미확인";
      headline = { value: inside, label: "대지 기준", aux: `학구도 기준일 ${asOf ?? "미확인"}` };
    } else {
      // S02는 춘분부터 저장된 지표 순서와 무관하게 하지 평균 일조를 대표로 쓴다.
      const preferred = r.tileCode === "S02"
        ? metrics.find((m) => m.id === "mean_sun_h_summer")
        : isS04
        ? (metrics.find((m) => m.id === "utci_median_summer_h14" && m.status === "estimated") ?? metrics.find((m) => m.id.startsWith("utci_median_") && m.status === "estimated"))
        : undefined;
      // 그 밖의 타일은 값이 있는 첫 지표를 대표로 쓴다 (예: 철도 미적재면 버스 거리).
      const i = preferred ? metrics.indexOf(preferred) : metrics.findIndex((m) => m.status === "observed" || m.status === "estimated");
      const first = rows[i < 0 ? 0 : i];
      headline = { value: first.value, label: first.label, aux: first.aux, tag: first.tag };
    }
  }
  // A02의 통학구역 지표는 headline이 대신 보여 준다.
  const allRows = r.tileCode === "A02" ? metrics.filter((m) => m.id !== "in_school_zone").map((m) => metricRow(m)) : rows;

  const gradedMetricOk = r.judgment?.level != null && GRADED_CODES.has(r.tileCode) && r.judgment.criteria;
  return {
    tileId: r.tileId,
    code: r.tileCode,
    title: cat.title,
    color: cat.color,
    status: r.status,
    badges: [...merged.values()],
    headline,
    rows: allRows,
    sentence: r.judgment?.sentence ?? null,
    grade: gradedMetricOk ? { label: GRADE_TEXT[r.judgment!.level!], criteria: `내부 제안 기준: ${r.judgment!.criteria}` } : null,
    grades: GRADED_CODES.has(r.tileCode) ? (r.judgment?.grades ?? []).map((g) => gradeChip(r, g)) : [],
    caveats,
    notes: [...new Set(r.limitations.map((l) => l.note))],
    sourceLine: sourceLineOf(r.provenance.sources),
    chart: (() => {
      const data = r.metrics
        .filter((m) => /^(share_|back_)/.test(m.id) && m.value !== null)
        .map((m) => ({ label: m.label, value: m.value as number, unit: m.unit }));
      return data.length > 0 ? data : null;
    })(),
    hasFace: r.tileType === "diagram",
    retryable: r.status === "failed",
    map: mapOf(r),
    backdrop: { center: r.conditions.center, radiusM: r.conditions.radiusM, features: [], total: 0, notes: [] },
    kindLabel: KIND_LABEL[cat.kind],
    callout: calloutOf(r),
    mass: massOf(r, scene),
    rose: r.presentation.rose ?? null,
    roses: r.presentation.roses ?? null,
    stackLayers: null,
    sheetTiles: null,
    sheetGrid: null,
  };
}

const HOUSING_LAYERS = new Set(["apt", "officetel"]); // 번호·카드·쪽은 아파트·오피스텔만
function calloutOf(r: TileResult): CalloutModel | null {
  if ((r.tileCode !== "A05" && r.tileCode !== "A06") || (r.status !== "complete" && r.status !== "partial")) return null;
  const features = r.presentation.features ?? [];
  const base = {
    center: r.conditions.center,
    radiusM: r.conditions.radiusM,
    analysisYear: Number(r.conditions.analysisDate.slice(0, 4)),
    sourceLine: sourceLineOf(r.provenance.sources),
  };
  if (r.tileCode === "A06") {
    const complexes = rankSupply(features.filter((f) => SUPPLY_LAYERS.has(f.layer)), r.conditions.analysisDate);
    const sup = supplyStats(complexes);
    const soon = complexes.filter((c) => c.supply?.timing === "m0_12").length;
    return {
      ...base,
      kind: "supply",
      unit: "곳",
      legend: SUPPLY_LEGEND,
      stats: sup.stats,
      statNote: sup.note,
      pill: [{ value: fmtInt(complexes.length), unit: "곳" }, { value: fmtInt(soon), unit: "곳 12개월 내 입주" }],
      others: [],
      complexes,
      summary: summarize(complexes),
    };
  }
  const complexes = rankComplexes(features.filter((f) => HOUSING_LAYERS.has(f.layer)));
  const summary = summarize(complexes);
  const unknown = summary.apartments - summary.householdsKnown;
  return {
    ...base,
    kind: "stock",
    unit: "단지",
    legend: STOCK_LEGEND,
    stats: [
      { value: fmtInt(summary.count), unit: "단지", label: "반경 안 단지 수" },
      { value: fmtInt(summary.households), unit: "세대", label: "확인 세대(아파트)" },
      { value: summary.medianYear === null ? "확인필요" : String(summary.medianYear), unit: summary.medianYear === null ? "" : "년", label: "준공 중앙값" },
    ],
    statNote: unknown > 0 ? `세대수 미확인 ${unknown}곳은 합계에서 제외` : null,
    pill: [{ value: fmtInt(summary.count), unit: "단지" }, { value: fmtInt(summary.households), unit: "세대(아파트)" }],
    others: features.filter((f) => f.layer === "other_housing").map((f) => ({ lng: f.lng, lat: f.lat })),
    complexes,
    summary,
  };
}

// ── 대지 요약 ──
/** 면적·용도지역이 적재되지 않은 동안은 null — 화면에는 "미확인"으로 보인다. */
export type SiteSummary = { address: string; areaM2: number | null; zoning: string | null; radiusM: number; facts: string[] };
export type SummaryView = {
  address: string;
  area: string;
  zoning: string;
  radius: string;
  facts: string[];
  asOfLine: string;
  incomplete: boolean;
  incompleteCount: number;
  /** 대지·반경만 그린 배경 지도 */
  map: MapModel | null;
};

export function toSummaryView(s: SiteSummary, results: TileResult[]): SummaryView {
  const dates = results.flatMap((r) => r.provenance.sources.map((x) => x.sourceAsOf)).filter((d): d is string => !!d).sort();
  const weak = results.filter((r) => r.status !== "complete" || r.limitations.some((l) => l.kind !== "estimated"));
  return {
    address: s.address,
    area: s.areaM2 === null ? "면적 미확인" : `${group(s.areaM2)}㎡`,
    zoning: s.zoning ?? "용도지역 미확인",
    radius: `반경 ${s.radiusM >= 1000 ? `${s.radiusM / 1000}km` : `${s.radiusM}m`}`,
    facts: s.facts.slice(0, 3),
    asOfLine: dates.length ? `자료 기준일 ${dates[0]}${dates.length > 1 && dates[0] !== dates[dates.length - 1] ? ` ~ ${dates[dates.length - 1]}` : ""}` : "자료 기준일 미확인",
    incomplete: weak.length > 0,
    incompleteCount: weak.length,
    map: results[0] ? { center: results[0].conditions.center, radiusM: s.radiusM, features: [], total: 0, notes: [] } : null,
  };
}
