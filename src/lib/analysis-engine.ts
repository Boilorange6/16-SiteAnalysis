import type {
  AnalysisConfig,
  MaintenanceProject,
  Park,
  Poi,
  ResidentialPoi,
  School,
  SubwayStation,
} from "./types";
import { haversineDistance } from "./geo";
import { formatAreaSqm, formatDistanceM, summarizeParks } from "./park-analysis";
import { summarizeMaintenanceProjects } from "./maintenance-analysis";
import { isRawPoiId } from "./poi-id-guard";

export type ScoreKey = "traffic" | "education" | "nature" | "residential" | "development";
export type ScoreLevel = "excellent" | "good" | "fair" | "weak";

export interface ScoreItem {
  readonly key: ScoreKey;
  readonly label: string;
  readonly score: number;
  readonly max: number;
  readonly level: ScoreLevel;
  readonly detail: string;
}

export interface AnalysisScores {
  readonly total: number;
  readonly grade: "S" | "A" | "B" | "C" | "D";
  readonly headline: string;
  readonly items: readonly ScoreItem[];
}

export interface InsightOverlay {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly radiusM: number;
  readonly color: string;
  readonly scoreKey: ScoreKey;
}

export interface InsightNarrative {
  readonly summary: string;
  readonly bullets: readonly string[];
  readonly risks: readonly string[];
  readonly nextActions: readonly string[];
}

function clampScore(value: number, max: number): number {
  return Math.max(0, Math.min(max, Math.round(value)));
}

function levelFor(score: number, max: number): ScoreLevel {
  const ratio = score / max;
  if (ratio >= 0.82) return "excellent";
  if (ratio >= 0.65) return "good";
  if (ratio >= 0.45) return "fair";
  return "weak";
}

function countWithin<T extends Poi>(pois: readonly T[], config: AnalysisConfig, radiusM: number): number {
  return pois.filter((poi) => haversineDistance(config.centerLat, config.centerLng, poi.lat, poi.lng) <= radiusM).length;
}

function nearestDistance<T extends Poi>(pois: readonly T[], config: AnalysisConfig): number | null {
  // P4R Task B fix: 원시 ID 이름 POI는 최근접 후보에서 제외 — 이 거리는 "최근접 역 NNNm" 형태로
  // 표시 문구에 쓰이므로 팩트시트(fact-summary findNearest)와 동일한 필터 후보 기준으로 통일해
  // 두 곳의 최근접 거리가 어긋나지 않게 한다.
  const displayable = pois.filter((poi) => !isRawPoiId(poi.name));
  if (displayable.length === 0) return null;
  return Math.min(...displayable.map((poi) => haversineDistance(config.centerLat, config.centerLng, poi.lat, poi.lng)));
}

export function computeAnalysisScores(config: AnalysisConfig, pois: readonly Poi[]): AnalysisScores {
  const subways = pois.filter((p): p is SubwayStation => p.category === "subway");
  const schools = pois.filter((p): p is School => p.category === "school");
  const parks = pois.filter((p): p is Park => p.category === "park");
  const residentials = pois.filter(
    (p): p is ResidentialPoi => p.category === "apartment" || p.category === "officetel" || p.category === "residential",
  );
  const projects = pois.filter((p): p is MaintenanceProject => p.category === "maintenance");

  const subwayNear = countWithin(subways, config, 700);
  const subwayMid = countWithin(subways, config, 1200);
  const nearestSubway = nearestDistance(subways, config);
  const trafficScore = clampScore(
    subwayNear * 8 + Math.max(0, subwayMid - subwayNear) * 3 + (nearestSubway !== null ? Math.max(0, 8 - nearestSubway / 120) : 0),
    25,
  );

  const elementaryCount = schools.filter((school) => school.level === "elementary").length;
  const schoolNear = countWithin(schools, config, 1000);
  const educationScore = clampScore(schoolNear * 3 + elementaryCount * 2 + Math.min(5, schools.length), 20);

  const parkSummary = summarizeParks(parks);
  const natureScore = clampScore(
    parkSummary.nearby500Count * 5 + parkSummary.majorCount * 4 + parkSummary.accessibilityScore * 0.08,
    20,
  );

  const totalUnits = residentials.reduce((sum, item) => sum + item.units, 0);
  const plannedCount = residentials.filter((item) => item.status === "planned").length;
  const residentialScore = clampScore(Math.min(12, residentials.length * 1.2) + Math.min(7, totalUnits / 900) + plannedCount * 2, 20);

  const maintenanceSummary = summarizeMaintenanceProjects(projects);
  const confirmedRatio = maintenanceSummary.count > 0 ? maintenanceSummary.boundaryConfirmedCount / maintenanceSummary.count : 0;
  const developmentScore = clampScore(
    Math.min(8, maintenanceSummary.count * 1.6) + Math.min(4, maintenanceSummary.totalAreaSqm / 50000) + confirmedRatio * 3,
    15,
  );

  const items: ScoreItem[] = [
    {
      key: "traffic",
      label: "교통",
      score: trafficScore,
      max: 25,
      level: levelFor(trafficScore, 25),
      detail: nearestSubway === null
        ? "반경 내 확인된 지하철역이 없습니다."
        : `최근접 역 ${formatDistanceM(nearestSubway)} · 700m ${subwayNear}개 · 1.2km ${subwayMid}개`,
    },
    {
      key: "education",
      label: "교육",
      score: educationScore,
      max: 20,
      level: levelFor(educationScore, 20),
      detail: `학교 ${schools.length}개 · 1km ${schoolNear}개 · 초등 ${elementaryCount}개`,
    },
    {
      key: "nature",
      label: "자연",
      score: natureScore,
      max: 20,
      level: levelFor(natureScore, 20),
      detail: `공원 ${parkSummary.count}개 · ${formatAreaSqm(parkSummary.totalAreaSqm)} · 접근성 ${parkSummary.accessibilityScore}/100`,
    },
    {
      key: "residential",
      label: "주거 공급",
      score: residentialScore,
      max: 20,
      level: levelFor(residentialScore, 20),
      detail: `주거 ${residentials.length}개 · ${totalUnits.toLocaleString()}세대 · 분양예정 ${plannedCount}개`,
    },
    {
      key: "development",
      label: "개발/정비",
      score: developmentScore,
      max: 15,
      level: levelFor(developmentScore, 15),
      detail: `정비사업 ${maintenanceSummary.count}건, 경계 확인 ${maintenanceSummary.boundaryConfirmedCount}건 · 미결합 ${maintenanceSummary.boundaryUnmatchedCount}건 · 미확인 ${maintenanceSummary.boundaryUnavailableCount}건${maintenanceSummary.totalPlannedHouseholds > 0 ? `, 예정 ${maintenanceSummary.totalPlannedHouseholds.toLocaleString()}세대` : ""}; 행정구역 카탈로그는 반경 집계·점수에서 제외`,
    },
  ];

  const total = items.reduce((sum, item) => sum + item.score, 0);
  const grade = total >= 88 ? "S" : total >= 76 ? "A" : total >= 64 ? "B" : total >= 50 ? "C" : "D";
  const strongest = [...items].sort((a, b) => b.score / b.max - a.score / a.max)[0];
  const weakest = [...items].sort((a, b) => a.score / a.max - b.score / b.max)[0];

  return {
    total,
    grade,
    headline: `${strongest.label} 경쟁력이 가장 높고 ${weakest.label} 보완 검토가 필요합니다.`,
    items,
  };
}

export function buildInsightOverlays(config: AnalysisConfig, pois: readonly Poi[]): readonly InsightOverlay[] {
  const subways = pois.filter((p) => p.category === "subway");
  const schools = pois.filter((p) => p.category === "school");
  const parks = pois.filter((p) => p.category === "park");
  const projects = pois.filter((p) => p.category === "maintenance");

  return [
    {
      id: "station-500",
      label: `역세권 500m (${countWithin(subways, config, 500)}개역)`,
      description: "도보권 대중교통 경쟁력을 판단하는 핵심 반경입니다.",
      radiusM: 500,
      color: "#F59E0B",
      scoreKey: "traffic",
    },
    {
      id: "school-1000",
      label: `통학권 1km (${countWithin(schools, config, 1000)}개교)`,
      description: "초중고 접근성을 함께 확인하는 생활권 반경입니다.",
      radiusM: 1000,
      color: "#3B82F6",
      scoreKey: "education",
    },
    {
      id: "park-500",
      label: `생활공원 500m (${countWithin(parks, config, 500)}개)`,
      description: "일상 이용 가능한 녹지 접근성을 보는 반경입니다.",
      radiusM: 500,
      color: "#10B981",
      scoreKey: "nature",
    },
    {
      id: "development-1500",
      label: `개발영향권 1.5km (${countWithin(projects, config, 1500)}건)`,
      description: "정비사업과 개발호재가 가격·환경에 미치는 영향권입니다.",
      radiusM: 1500,
      color: "#EC4899",
      scoreKey: "development",
    },
  ];
}

export function generateAnalysisNarrative(config: AnalysisConfig, pois: readonly Poi[]): InsightNarrative {
  const scores = computeAnalysisScores(config, pois);
  const subways = pois.filter((p) => p.category === "subway");
  const parks = pois.filter((p): p is Park => p.category === "park");
  const residentials = pois.filter(
    (p): p is ResidentialPoi => p.category === "apartment" || p.category === "officetel" || p.category === "residential",
  );
  const projects = pois.filter((p): p is MaintenanceProject => p.category === "maintenance");
  const nearestSubway = nearestDistance(subways, config);
  const parkSummary = summarizeParks(parks);
  const totalUnits = residentials.reduce((sum, item) => sum + item.units, 0);
  const plannedCount = residentials.filter((item) => item.status === "planned").length;
  const maintenanceSummary = summarizeMaintenanceProjects(projects);
  const weakItems = scores.items.filter((item) => item.level === "fair" || item.level === "weak");

  return {
    // P4R Task B-4a: 점수를 문장 선두에서 강조하지 않는다 — 강·약점 팩트 요약을 앞세우고
    // 점수/등급은 문장 끝 괄호 보조 표기로 격하한다.
    summary: `${config.centerName || "선택 입지"}는 ${scores.headline} (참고: 종합 ${scores.total}/100점 · ${scores.grade}등급)`,
    bullets: [
      nearestSubway === null
        ? "교통: 지하철역 미확인. 버스·도로 접근성 보완 필요."
        : `교통: 최근접 역 ${formatDistanceM(nearestSubway)} · 반경 내 ${subways.length}개 역.`,
      `교육: 초중고 ${pois.filter((p) => p.category === "school").length}개교 · 통학권 기초자료 확보.`,
      `자연: 공원 ${parkSummary.count}개 · ${formatAreaSqm(parkSummary.totalAreaSqm)} · 접근성 ${parkSummary.accessibilityScore}/100.`,
      `주거: ${residentials.length}개 시설 · ${totalUnits.toLocaleString()}세대${plannedCount > 0 ? ` · 분양예정 ${plannedCount}건` : ""}.`,
      `개발/정비: ${maintenanceSummary.count}건 · 경계 확인 ${maintenanceSummary.boundaryConfirmedCount}건 · 미결합 ${maintenanceSummary.boundaryUnmatchedCount}건 · 미확인 ${maintenanceSummary.boundaryUnavailableCount}건${maintenanceSummary.totalPlannedHouseholds > 0 ? ` · 예정 ${maintenanceSummary.totalPlannedHouseholds.toLocaleString()}세대` : ""}.`,
      "정비사업 집계: 행정구역 카탈로그는 반경 집계·점수에서 제외합니다.",
    ],
    risks: [
      ...weakItems.map((item) => `${item.label}: ${item.detail}`),
      maintenanceSummary.boundaryUnmatchedCount + maintenanceSummary.boundaryUnavailableCount > 0
        ? `정비사업 경계 미결합 ${maintenanceSummary.boundaryUnmatchedCount}건 · 미확인 ${maintenanceSummary.boundaryUnavailableCount}건. 원문 확인 필요.`
        : "",
    ].filter(Boolean),
    // P4R Task B-3: "PPT 첫 장에서 강조하세요"·"프로젝트를 저장하세요" 같은 앱 사용 안내문을
    // 보고서 수신자(발주처) 관점 제언으로 교체 — 데이터 조건에 따라 분기하는 일반 제언.
    // 문구 길이 제약(리뷰 fix): canvas 렌더러의 "다음 액션" 카드는 drawWrappedText maxLines=2
    // (2줄 ≈ 50자)라 45자를 넘기면 말줄임되고 pptx(fit:"shrink" 전문 표시)와 내용이 어긋난다.
    // 각 항목 45자 이내·핵심 권고 선두 배치를 유지할 것.
    nextActions: [
      nearestSubway === null
        ? "지하철역 미확인 — 현장·버스 노선 확인"
        : `최근접 역 ${formatDistanceM(nearestSubway)} — 신설·연장 기관 고시 확인`,
      weakItems.length > 0
        ? `${weakItems.slice(0, 2).map((item) => item.label).join("·")}${weakItems.length > 2 ? " 등" : ""} 보완 — 현장·공고 확인`
        : "전 항목 고른 확인 — 핵심 지표 정기 확인",
      maintenanceSummary.boundaryUnmatchedCount + maintenanceSummary.boundaryUnavailableCount > 0
        ? `정비 미결합 ${maintenanceSummary.boundaryUnmatchedCount}건 · 미확인 ${maintenanceSummary.boundaryUnavailableCount}건 — 공고 확인`
        : maintenanceSummary.count > 0
          ? "정비사업 단계는 최신 공고 확인"
          : "반경 밖 대규모 개발계획 별도 확인",
      ...(plannedCount > 0
        ? [`분양예정 ${plannedCount}건 — 공고로 일정 확인`]
        : []),
    ],
  };
}

/** 종합 의견 슬라이드 한 줄. `muted`가 true면 강조 없이 보조 지표 톤(작은 글자·톤 다운 색)으로 표기한다. */
export interface SummaryLine {
  readonly text: string;
  readonly muted?: boolean;
}

/**
 * 종합 의견(요약) 슬라이드 전용 라인 빌더.
 * 2단계 재설계(Task 7): 점수를 문장 선두에서 강조하지 않고, 마지막 줄에 "참고: 종합 입지 점수 NN점(보조 지표)"
 * 형태의 muted 라인으로 격하한다. 점수 대시보드 슬라이드(별도)는 여전히 `generateAnalysisNarrative`/
 * `computeAnalysisScores`를 직접 써서 점수를 크게 표시하므로 이 함수의 변경 영향을 받지 않는다.
 */
export function getSummaryLines(config: AnalysisConfig, pois: readonly Poi[]): SummaryLine[] {
  const narrative = generateAnalysisNarrative(config, pois);
  const scores = computeAnalysisScores(config, pois);
  const body: SummaryLine[] = [
    { text: `${config.centerName || "선택 입지"} 입지 종합 의견: ${scores.headline}` },
    ...narrative.bullets.slice(0, 3).map((text) => ({ text })),
    ...(narrative.risks[0] ? [{ text: `리스크: ${narrative.risks[0]}` }] : []),
  ];
  return [...body, { text: `참고: 종합 입지 점수 ${scores.total}점 (보조 지표)`, muted: true }];
}
