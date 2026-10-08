/**
 * TileResult → 화면 문자열. 화면이 쓰는 문구는 전부 여기서 만든다 (컴포넌트에는 문구 로직 없음).
 * 규칙: 종합 점수 없음 · 도보 시간 없음 · 공급/가격/개발은 좋음·주의 평가 없음 (plan 화면 규칙 1~8).
 */
import type { MapPolygon, OUTPUT_FACES, RasterRef, RoseSeason, TileResult } from "../tile-result";
import type { Scene } from "../scene";
import { tileClientModuleFor } from "../tile/client";
import type { TileHeadlinePolicy } from "../tile/types";
import type { A05Counts, A05Filter } from "../engine/a05-filter";
import type { CalloutLegendSpec, Complex, Stat } from "./callout-layout";
import type { MapModel } from "./map-layers";
import type { MassModel } from "./mass-projection";
import { catalogEntry, sourceName, TILE_CODES, type TileCode } from "./tile-catalog";
import type { RoseModel } from "./wind-rose";
import { isSiteParcelLayer, siteParcelFromResults } from "./site-parcel";
import type { SourceRefLike } from "./source-details";
import { defaultLayerId, filterMapForLayer, layerOptionsForResult, type TileLayerOption } from "./tile-layers";

export type OutputFace = (typeof OUTPUT_FACES)[number];
export type Badge = { text: string; note?: string; tone: "status" | "limit" | "model" };
export type Row = { label: string; value: string; aux?: string; tag?: string };
export type TileView = {
  tileId: string;
  code: string;
  tileType: string;
  title: string;
  color: string;
  status: TileResult["status"];
  badges: Badge[];
  headline: { value: string; label: string; aux?: string; tag?: string } | null;
  /** 헤드라인에 선택된 결론 지표. 파라미터·확인율 지표는 여기에 오지 않는다. */
  headlineMetricId: string | null;
  rows: Row[];
  sentence: string | null;
  grade: { label: string; criteria: string } | null;
  /** 근거 지표별 등급 칩 ("철도 좋음", "버스 보통") — A01/A02만. 없으면 빈 배열 */
  grades: Array<{ target: string; label: string; level: "good" | "fair" | "caution"; criteria: string }>;
  caveats: string[];
  notes: string[];
  sourceLine: string;
  /** 카드 출처 칩과 출처·기준일 패널이 사용하는 실제 원천 참조. */
  sourceRefs: SourceRefLike[];
  chart: { label: string; value: number; unit: string }[] | null;
  hasFace: boolean;
  retryable: boolean;
  /** 지도 타일이면 지도 그림 입력, 아니면 null */
  map: MapModel | null;
  /** 지물 없는 대지·반경 지도. 지도 타일이 아니거나 결과가 없을 때 전면 배경으로 쓴다 (빈 흰 카드 금지) */
  backdrop: MapModel;
  /** 종류 배지 문구 */
  kindLabel: string;
  /** A05 재집계 필터의 카드용 짧은 칩. 필터가 없으면 null */
  filterChip?: string | null;
  /** 보고서/PPT와 요약 문장에 쓰는 A05 필터 한 줄 */
  filterLine?: string | null;
  /** A05 확장 보기의 결과 요약에 쓰는 필드별 정보 없음 건수 */
  a05Counts?: A05Counts | null;
  /** 주변 단지 설명선 타일(A05) 입력. 결과가 없으면 null */
  callout: CalloutModel | null;
  /** S01 축측 매스. Scene이 없을 때도 카메라·반경만으로 빈 틀을 그릴 수 있다. */
  mass: MassModel | null;
  /** D22 풍향·풍속 누적 모델. */
  rose?: RoseModel | null;
  /** D22 연간·계절 풍향·풍속 누적 모델. */
  roses?: Record<RoseSeason, RoseModel> | null;
  /** S03 작업/결과 조건에 선언된 계절별 유입 풍향(도). */
  windDirections?: Record<string, number>;
  /** STACK 카드의 층 이름. 일반 타일은 null. */
  stackLayers: string[] | null;
  /** SHEET 카드가 참조하는 하위 타일과 격자. 일반 타일은 null. */
  sheetTiles: string[] | null;
  sheetGrid: "2x2" | "3x2" | "3x1" | null;
  /** 흡수된 타일의 지도 표현 선택지. 보드에는 id만 저장한다. */
  layerOptions: TileLayerOption[];
  defaultLayer: string;
};

export type HeadlinePolicy = TileHeadlinePolicy;

function buildHeadlinePolicy(): Record<TileCode, HeadlinePolicy> {
  const policies: Partial<Record<TileCode, HeadlinePolicy>> = {};
  for (const code of TILE_CODES) {
    const modulePolicy = tileClientModuleFor(code)?.headline;
    if (modulePolicy) policies[code] = modulePolicy;
  }
  return policies as Record<TileCode, HeadlinePolicy>;
}

export const HEADLINE_POLICY = buildHeadlinePolicy();

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
  summary: { count: number; apartments: number; households: number; householdsKnown: number; medianYear: number | null };
  /** A05 필터가 적용된 보고서 한 줄 */
  filterLine?: string | null;
};

const KIND_LABEL = { analysis: "분석", diagram: "도판", simulation: "시뮬레이션" } as const;
function mapNoteFor(code: string): string | undefined {
  return tileClientModuleFor(code)?.mapNote;
}

function mapOf(r: TileResult, analysisSiteParcel?: readonly MapPolygon[] | null): RasterMapModel | null {
  // S03 is "pending" until the browser uploads a wind field, but the panel needs map.analysisId to run.
  const windAwaitingUpload = r.tileCode === "S03" && r.status === "pending";
  if (r.status !== "complete" && r.status !== "partial" && !windAwaitingUpload) return null;
  const features = r.presentation.features ?? [];
  const allPolygons = r.presentation.polygons ?? [];
  const ownSiteParcel = allPolygons.filter((polygon) => isSiteParcelLayer(polygon.layer));
  const siteParcel = analysisSiteParcel === undefined ? (ownSiteParcel.length > 0 ? ownSiteParcel : null) : analysisSiteParcel;
  const polygons = allPolygons.filter((polygon) => !isSiteParcelLayer(polygon.layer));
  const lines = r.presentation.lines ?? [];
  const presentation = r.presentation as ExtendedPresentation;
  const rasterOptions = presentation.rasters ?? [];
  const defaultRaster = rasterDefaultName(r.tileCode, rasterOptions, presentation);
  const rasters = defaultRaster ? rasterOptions.filter((ref) => ref.name === defaultRaster) : [];
  const basemap = presentation.basemap;
  const polygonsTotal = Math.max(0, (r.presentation.polygonsTotal ?? allPolygons.length) - ownSiteParcel.length);
  if (features.length === 0 && polygons.length === 0 && lines.length === 0 && rasterOptions.length === 0 && !basemap && !siteParcel?.length) return null;
  const mapNote = mapNoteFor(r.tileCode);
  const notes = mapNote ? [mapNote] : [];
  if (r.tileCode === "A01" && r.metrics.some((m) => m.id === "nearest_rail_m" && m.status === "missing")) notes.push("철도 자료를 확인하지 못해 버스정류장만 표시");
  // 래스터가 그려지는 타일은 건물·그림자를 래스터 셀이 담당하므로 "지물 없음"이 아니다.
  if (features.length === 0 && polygons.length === 0 && lines.length === 0 && rasterOptions.length === 0) notes.push("반경 안 표시할 지물 없음");
  if (rasters.some((ref) => ref.palette === "utci")) notes.push("흰색 = 건물 · 회색 = 바람 입력 없음");
  return {
    center: r.conditions.center,
    radiusM: r.conditions.radiusM,
    features,
    analysisId: r.analysisId,
    tileCode: r.tileCode,
    basemap,
    rasters,
    polygons,
    ...(siteParcel && siteParcel.length > 0 ? { siteParcel: [...siteParcel] } : { siteParcel: null }),
    polygonsTotal,
    lines,
    linesTotal: r.presentation.linesTotal ?? lines.length,
    total: r.presentation.featuresTotal ?? features.length,
    notes,
    ...(r.presentation.legend.length > 0 ? { legend: r.presentation.legend } : {}),
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
  const next = tileClientModuleFor(view.code)?.view?.({
    ...view,
    map: nextMap,
  }, undefined) ?? { ...view, map: nextMap };
  return note ? { ...next, notes: [note, ...next.notes.filter((existing) => existing !== note)] } : next;
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
  // S04의 대표 컷은 문장·헤드라인과 같은 여름 14시다. 나머지 11컷은 rasterOptions로 남는다.
  if (tileCode === "S04" && refs.some((ref) => ref.name === "utci_summer_h14")) return "utci_summer_h14";
  return refs[0]?.name ?? null;
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

const INTEGER_METRIC_UNITS = new Set([
  "동",
  "세대",
  "곳",
  "건",
  "개",
  "개소",
  "명",
  "가구",
  "호",
  "역",
  "정거장",
  "층",
  "년",
  "z",
  "m",
  "km",
  "㎡",
  "m²",
  "㎢",
  "km²",
  "ha",
  "원/㎡",
  "만원/㎡",
  "동/㎢",
  "동/km²",
  "명/㎢",
  "명/km²",
  "가구/㎢",
  "가구/km²",
  "W/m²",
]);
const ONE_DECIMAL_METRIC_UNITS = new Set(["%", "°C", "m/s", "도"]);

/** 화면·타일·PPT가 공유하는 단위별 표시 자릿수 규칙. */
export function formatMetricValue(value: number, unit: string): string {
  if (!Number.isFinite(value)) return "미확인";
  const decimals = ONE_DECIMAL_METRIC_UNITS.has(unit) ? 1 : INTEGER_METRIC_UNITS.has(unit) ? 0 : 2;
  return new Intl.NumberFormat("en-US", {
    useGrouping: unit !== "년",
    minimumFractionDigits: decimals === 1 ? 1 : 0,
    maximumFractionDigits: decimals,
  }).format(value);
}

/** 긴 원천 label을 카드 헤더에서 읽을 수 있는 짧은 의미 라벨로 정리한다. */
export function shortHeadlineLabel(label: string): string {
  const normalized = label.replace(/\s+/g, " ").trim();
  const firstClause = normalized.split(" · ")[0]?.trim() ?? normalized;
  return firstClause.replace(/^(반경\s*(안|내)\s*)/, "").trim() || normalized;
}

/** 화면·타일·PPT가 공유하는 직선거리 표기. 1 km 이상은 소수 한 자리 km로 줄인다. */
export function formatDistanceM(distanceM: number): string {
  if (!Number.isFinite(distanceM) || distanceM < 0) return "미확인";
  return distanceM >= 1000 ? `${(distanceM / 1000).toFixed(1)} km` : `${formatMetricValue(distanceM, "m")}m`;
}
const withUnit = (n: number, unit: string) => {
  if (unit === "m") return formatDistanceM(n);
  // 설계 숫자 규칙은 면적을 정수로 표시하되, 1 km² 미만을 0 km²로
  // 뭉개지 않는다. 작은 면적은 같은 정수 규칙의 ㎡로 전환한다.
  if ((unit === "km²" || unit === "㎢") && Math.abs(n) < 1) {
    return `${formatMetricValue(n * 1_000_000, "㎡")}㎡`;
  }
  const v = formatMetricValue(n, unit);
  return unit === "" ? v : unit.length > 2 && !unit.startsWith("/") ? `${v} ${unit}` : `${v}${unit}`;
};

function metricRow(m: TileResult["metrics"][number], _round = false): Row {
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
        value: withUnit(m.value as number, m.unit),
        // 직선거리 지표만 — 높이·표고·보행망 거리·길이도 단위가 m다
        ...(m.unit === "m" && /^nearest_|_distance_m$/.test(m.id) ? { aux: "직선" } : {}),
        ...(m.status === "estimated" ? { tag: "추정" } : {}),
      };
  }
}

/** 캐시된 결과의 옛 문장도 카드·상세의 실제 면적 표기와 맞춘다. */
function displaySentence(r: TileResult, rows: Row[], filterLine: string | null): string | null {
  let sentence = r.judgment?.sentence ?? null;
  if (sentence && r.tileCode === "D28") {
    const area = rows.find((row) => row.label === "도보 10분 도달 면적")?.value;
    if (area) sentence = sentence.replace(/(도보 10분(?:\([^)]*\))? 도달 면적 )[^ (]+(?:\s*(?:㎢|km²))?/, `$1${area}`);
  }
  if (sentence) return `${sentence}${filterLine ? " · 필터 적용" : ""}`;
  return filterLine ? "필터 적용" : null;
}

type HeadlineMetric = TileResult["metrics"][number];

function d04HeadlineMetric(metrics: TileResult["metrics"]): HeadlineMetric | null {
  const parts = ["share_pre1980", "share_1980s", "share_1990s"].map((id) => metrics.find((metric) => metric.id === id));
  if (parts.every((metric) => metric?.value === null || metric === undefined)) return null;
  const value = parts.reduce((sum, metric) => sum + (typeof metric?.value === "number" ? metric.value : 0), 0);
  const status = parts.some((metric) => metric?.status === "estimated") ? "estimated" : "observed";
  return {
    id: "share_pre2000",
    label: "1990년대 이전 준공",
    value,
    unit: "%",
    formulaVersion: "ui-headline@1:1979년 이하+1980년대+1990년대",
    numerator: null,
    denominator: null,
    status,
  };
}

function policyMetric(r: TileResult, metrics: TileResult["metrics"]): HeadlineMetric | null {
  const policy = HEADLINE_POLICY[r.tileCode as TileCode];
  const exact = policy?.ids?.map((id) => metrics.find((metric) => metric.id === id)).filter((metric): metric is HeadlineMetric => metric !== undefined) ?? [];
  const maxPrefix = policy?.maxPrefix;
  if (maxPrefix) {
    const prefixed = metrics.filter((metric) => metric.id.startsWith(maxPrefix));
    const max = prefixed.filter((metric) => metric.value !== null).sort((a, b) => (b.value as number) - (a.value as number))[0];
    if (max) return max;
    if (prefixed[0]) return prefixed[0];
  }
  if (exact.length > 0) return exact[0]!;
  const basis = r.judgment?.basisMetricIds ?? [];
  return basis.map((id) => metrics.find((metric) => metric.id === id)).find((metric): metric is HeadlineMetric => metric !== undefined) ?? null;
}

function parameterBadges(r: TileResult): Badge[] {
  const find = (id: string) => r.metrics.find((metric) => metric.id === id);
  const out: Badge[] = [];
  const add = (id: string, prefix: string, note: string) => {
    const metric = find(id);
    if (!metric) return;
    const row = metricRow(metric);
    out.push({ text: `${prefix} ${row.value}`, note, tone: "limit" });
  };
  if (r.tileCode === "D04") add("confirmed_share_pct", "확인율", "사용승인일이 확인된 건물의 비율입니다. 준공 연대 분포 자체와는 다른 보조 지표입니다.");
  if (r.tileCode === "D16") add("kde_bandwidth_m", "KDE 대역폭", "건물 밀도 추정에 사용한 계산 설정값입니다. 지역 결론 수치가 아닙니다.");
  if (r.tileCode === "D01") add("imagery_zoom_max", "최대 줌", "항공영상 배경의 표시 수준입니다. 촬영시기는 별도로 확인되지 않았습니다.");
  if (r.tileCode === "A12") add("site_zoning_count", "중심점 지정", "대지 중심점이 들어간 용도지역 도형 수입니다. 지정의 적합성 판정이 아닙니다.");
  return out;
}

function windDirectionsOf(r: TileResult): Record<string, number> | undefined {
  if (r.tileCode !== "S03" || !r.conditions.simulation) return undefined;
  const simulation = r.conditions.simulation;
  const simulationCase = simulation.case;
  if (!simulationCase || typeof simulationCase !== "object") return undefined;
  const inflow = (simulationCase as Record<string, unknown>).inflow;
  if (!inflow || typeof inflow !== "object") return undefined;
  const directions: Record<string, number> = {};
  for (const season of ["annual", "spring", "summer", "autumn", "winter"]) {
    const candidate = (inflow as Record<string, unknown>)[season];
    if (!candidate || typeof candidate !== "object") continue;
    const degrees = (candidate as Record<string, unknown>).deg;
    if (typeof degrees !== "number" || !Number.isFinite(degrees)) continue;
    directions[season] = ((degrees % 360) + 360) % 360;
  }
  return Object.keys(directions).length > 0 ? directions : undefined;
}

export function sourceLineOf(sources: TileResult["provenance"]["sources"]): string {
  if (sources.length === 0) return "출처 없음";
  const lines = sources
    .map((s) => {
      // source_release uses the fetched date in releaseId when sourceAsOf is unavailable.
      const releaseDate = /@(\d{4}(?:-\d{2}){0,2})$/.exec(s.releaseId)?.[1] ?? null;
      return `${sourceName(s.sourceId)} ${s.sourceAsOf ?? releaseDate ?? "기준일 미확인"}`;
    });
  // 같은 제공처·같은 기준일은 한 번만 (원천 id가 여러 개여도 이름이 같으면 합친다)
  return [...new Set(lines)].join(" · ");
}

export function toTileView(r: TileResult, scene?: Scene | null, analysisSiteParcel?: readonly MapPolygon[] | null, a05Filter?: A05Filter | null): TileView {
  const module = tileClientModuleFor(r.tileCode);
  const prepared = module?.prepare?.(r, { filter: a05Filter }) ?? { result: r };
  r = prepared.result;
  const filterChip = prepared.filterChip ?? null;
  const filterLine = prepared.filterLine ?? null;
  const cat = catalogEntry(r.tileCode);
  const layerOptions = layerOptionsForResult(r);
  const defaultLayer = defaultLayerId(r);
  const badges: Badge[] = [];
  const statusText = STATUS_TEXT[r.status];
  if (statusText) badges.push({ text: statusText, tone: "status" });
  for (const l of r.limitations) {
    badges.push({ text: LIMIT_TEXT[l.kind], note: l.note, tone: "limit" });
    badges.push(...(module?.limitationBadges?.(l) ?? []));
  }
  badges.push(...parameterBadges(r));
  const modelBadge = module?.modelBadge;
  if (modelBadge) badges.push({ text: modelBadge, tone: "model" });
  // 같은 문구의 배지는 하나로 합치고 note는 이어 붙인다.
  const merged = new Map<string, Badge>();
  for (const b of badges) {
    const prev = merged.get(b.text);
    if (!prev) merged.set(b.text, { ...b });
    else if (b.note && prev.note !== b.note) prev.note = prev.note ? `${prev.note} / ${b.note}` : b.note;
  }

  const isS04 = r.tileCode === "S04";
  let metrics = r.metrics.filter((m) => module?.metricFilter?.(m) ?? true);
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
  const caveat = module?.caveat;
  const caveats = caveat ? [caveat] : [];

  let headline: TileView["headline"] = null;
  let headlineMetricId: string | null = null;
  const hasResult = r.status === "complete" || r.status === "partial";
  if (hasResult && metrics.length > 0) {
    if (r.tileCode === "A02") {
      const zone = metrics.find((m) => m.id === "in_school_zone");
      const asOf = r.provenance.sources.find((s) => s.sourceId === "school_zone")?.sourceAsOf;
      const inside = zone?.status === "observed" ? (zone.value === 1 ? "통학구역 안" : "통학구역 밖") : "통학구역 미확인";
      headline = { value: inside, label: "대지 기준", aux: `학구도 기준일 ${asOf ?? "미확인"}` };
      headlineMetricId = "in_school_zone";
    } else if (r.tileCode === "A12") {
      const zoning = r.presentation.features?.find((feature) => feature.layer === "zoning_site")?.label;
      const selected = zoning ? null : policyMetric(r, metrics);
      if (zoning) {
        headline = { value: zoning, label: "대지 중심점 용도지역" };
        headlineMetricId = "site_zoning_label";
      } else if (selected) {
        const row = metricRow(selected);
        headline = { value: row.value, label: row.label, aux: row.aux, tag: row.tag };
        headlineMetricId = selected.id;
      }
    } else if (r.tileCode === "D01") {
      headline = { value: "항공영상 제공", label: "배경 결론", aux: "촬영시기 미확인" };
      headlineMetricId = "imagery_available";
    } else if (r.tileCode === "D04") {
      const selected = d04HeadlineMetric(metrics) ?? policyMetric(r, metrics);
      if (selected) {
        const row = metricRow(selected);
        headline = { value: row.value, label: row.label, aux: row.aux, tag: row.tag };
        headlineMetricId = selected.id;
      }
    } else {
      const selected = policyMetric(r, metrics);
      if (selected) {
        const row = metricRow(selected, isS04);
        headline = { value: row.value, label: row.label, aux: row.aux, tag: row.tag };
        headlineMetricId = selected.id;
      }
    }
  }
  // A02의 통학구역 지표는 headline이 대신 보여 준다.
  const allRows = r.tileCode === "A02" ? metrics.filter((m) => m.id !== "in_school_zone").map((m) => metricRow(m)) : rows;

  const gradedMetricOk = r.judgment?.level != null && GRADED_CODES.has(r.tileCode) && r.judgment.criteria;
  const windDirections = windDirectionsOf(r);
  const sourceLine = sourceLineOf(r.provenance.sources);
  const callout = module?.callout?.(r, sourceLine, filterLine) ?? null;
  const baseView: TileView = {
    tileId: r.tileId,
    code: r.tileCode,
    tileType: r.tileType,
    title: cat.title,
    color: cat.color,
    status: r.status,
    badges: [...merged.values()],
    headline,
    headlineMetricId,
    rows: allRows,
    sentence: displaySentence(r, allRows, filterLine),
    grade: gradedMetricOk ? { label: GRADE_TEXT[r.judgment!.level!], criteria: `내부 제안 기준: ${r.judgment!.criteria}` } : null,
    grades: GRADED_CODES.has(r.tileCode) ? (r.judgment?.grades ?? []).map((g) => gradeChip(r, g)) : [],
    caveats,
    notes: [...new Set(r.limitations.map((l) => l.note))],
    sourceLine,
    sourceRefs: r.provenance.sources.map((source) => ({
      sourceId: source.sourceId,
      releaseId: source.releaseId,
      sourceAsOf: source.sourceAsOf,
      ...(source.fetchedAt ? { fetchedAt: source.fetchedAt } : {}),
    })),
    chart: (() => {
      const data = r.metrics
        .filter((m) => /^(share_|back_)/.test(m.id) && m.value !== null)
        .map((m) => ({ label: m.label, value: m.value as number, unit: m.unit }));
      return data.length > 0 ? data : null;
    })(),
    hasFace: r.tileType === "diagram" || layerOptions.length > 0,
    retryable: r.status === "failed" || r.status === "cancelled",
    map: mapOf(r, analysisSiteParcel),
    backdrop: { center: r.conditions.center, radiusM: r.conditions.radiusM, features: [], total: 0, notes: [], siteParcel: analysisSiteParcel === undefined ? siteParcelFromResults([r]) : analysisSiteParcel ? [...analysisSiteParcel] : null },
    kindLabel: KIND_LABEL[cat.kind],
    filterChip,
    filterLine,
    a05Counts: prepared.a05Counts ?? null,
    callout,
    mass: massOf(r, scene),
    rose: r.presentation.rose ?? null,
    roses: r.presentation.roses ?? null,
    ...(windDirections ? { windDirections } : {}),
    stackLayers: null,
    sheetTiles: null,
    sheetGrid: null,
    layerOptions,
    defaultLayer,
  };
  return module?.view?.(baseView, r) ?? baseView;
}

/** 카드·펼침 창·보고서가 같은 레이어 선택 결과를 사용하도록 지도 입력만 파생한다. */
export function viewWithLayer(view: TileView, layerId: string): TileView {
  if (!view.layerOptions.some((option) => option.id === layerId)) return view;
  return { ...view, map: filterMapForLayer(view.map, view.code, layerId), defaultLayer: layerId };
}

// ── 대지 요약 ──
export type SiteSummary = { address: string; areaM2: number | null; areaSource?: string; parcelCount?: number | null; landPriceM2?: number | null; landPriceUnit?: string | null; jimok?: string | null; zoning: string | null; radiusM: number; facts: string[]; siteParcel?: MapPolygon[] | null; siteKind?: "address" | "parcels" | "polygon" };
export type SummaryView = {
  address: string;
  area: string;
  areaSource: string;
  landPrice: string;
  jimok: string;
  zoning: string;
  radius: string;
  siteMode: string | null;
  facts: string[];
  asOfLine: string;
  incomplete: boolean;
  incompleteCount: number;
  /** 대지·반경만 그린 배경 지도 */
  map: MapModel | null;
};

export function toSummaryView(s: SiteSummary, results: TileResult[]): SummaryView {
  const dates = results.flatMap((r) => r.provenance.sources.map((x) => x.sourceAsOf)).filter((d): d is string => !!d).sort();
  const weakStatuses = new Set<TileResult["status"]>(["failed", "not_provided", "no_data", "cancelled"]);
  const weak = results.filter((r) => weakStatuses.has(r.status));
  const siteParcel = s.siteParcel === undefined ? siteParcelFromResults(results) : s.siteParcel;
  const siteMode = s.siteKind === "polygon"
    ? "직접 그린 구역 · 면적 추정"
    : s.siteKind === "parcels" && typeof s.parcelCount === "number"
      ? `필지 ${s.parcelCount}개`
      : null;
  return {
    address: s.address,
    area: s.areaM2 === null ? "면적 미확인" : `${formatMetricValue(s.areaM2, "㎡")}㎡`,
    areaSource: s.areaM2 === null ? "대상 필지 도형 자료 미확인" : s.areaSource ?? "도형 면적 · 공부면적 아님",
    landPrice: typeof s.landPriceM2 === "number" && Number.isFinite(s.landPriceM2) ? `공시지가: ${formatMetricValue(s.landPriceM2, s.landPriceUnit ?? "원/㎡")}${s.landPriceUnit ?? "원/㎡"}` : "공시지가 미확인",
    jimok: s.jimok ? `지목: ${s.jimok}` : "지목 미확인",
    zoning: s.zoning ?? "용도지역 미확인",
    radius: `반경 ${s.radiusM >= 1000 ? `${s.radiusM / 1000}km` : `${s.radiusM}m`}`,
    siteMode,
    facts: s.facts.slice(0, 3),
    asOfLine: dates.length ? `자료 기준일 ${dates[0]}${dates.length > 1 && dates[0] !== dates[dates.length - 1] ? ` ~ ${dates[dates.length - 1]}` : ""}` : "자료 기준일 미확인",
    incomplete: weak.length > 0,
    incompleteCount: weak.length,
    map: results[0] ? { center: results[0].conditions.center, radiusM: s.radiusM, features: [], total: 0, notes: [], siteParcel } : null,
  };
}
