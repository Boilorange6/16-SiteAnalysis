import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();

function read(path) {
  return readFileSync(resolve(root, path), "utf8");
}

function has(path, pattern) {
  if (!existsSync(resolve(root, path))) return false;
  const source = read(path);
  return typeof pattern === "string" ? source.includes(pattern) : pattern.test(source);
}

const checks = [
  {
    id: "F1",
    label: "분석 프로젝트 저장/히스토리",
    pass:
      has("src/lib/server/database.ts", "analysis_projects") &&
      has("src/app/api/projects/route.ts", "POST") &&
      has("src/app/api/projects/[id]/route.ts", "DELETE") &&
      has("src/components/sidebar.tsx", "저장된 분석"),
  },
  {
    id: "F2",
    label: "AI형 종합 코멘트",
    pass:
      has("src/lib/analysis-engine.ts", "generateAnalysisNarrative") &&
      has("src/lib/ppt-generator.ts", "getSummaryLines") &&
      has("src/components/sidebar.tsx", "insightNarrative.summary"),
  },
  {
    id: "F3",
    label: "입지 점수화 대시보드",
    pass:
      has("src/lib/analysis-engine.ts", "computeAnalysisScores") &&
      has("src/components/sidebar.tsx", "입지 점수") &&
      has("src/components/sidebar.tsx", "analysisScores.total"),
  },
  {
    id: "F6",
    label: "수동 POI 추가/수정",
    pass:
      has("src/components/sidebar.tsx", "수동 POI 보정") &&
      has("src/components/site-analysis-app.tsx", "handleAddManualPoi") &&
      has("src/components/site-analysis-app.tsx", "handleUpdateManualPoi") &&
      has("src/components/site-analysis-app.tsx", "handleRemoveManualPoi"),
  },
  {
    id: "F7",
    label: "PPT 단일 기본 디자인",
    pass:
      has("src/lib/ppt-design-config.ts", "DEFAULT_PPT_DESIGN") &&
      !has("src/lib/ppt-design-config.ts", "PPT_DESIGN_PRESETS") &&
      has("src/components/ppt-preview-modal.tsx", "setDesignConfig(DEFAULT_PPT_DESIGN)"),
  },
  {
    id: "F8",
    label: "지도 인사이트 레이어",
    pass:
      has("src/lib/analysis-engine.ts", "buildInsightOverlays") &&
      has("src/components/map-view.tsx", "insightLayersRef") &&
      has("src/components/sidebar.tsx", "인사이트 레이어"),
  },
  {
    id: "F9",
    label: "온보딩/API 키 상태/샘플 실행",
    pass:
      has("src/app/api/user/api-key-status/route.ts", "ApiKeyStatusResponse") &&
      has("src/components/sidebar.tsx", "API 연결") &&
      has("src/components/sidebar.tsx", "샘플 실행"),
  },
  {
    id: "QA",
    label: "기능 테스트 스크립트",
    pass: has("src/scripts/test-analysis-engine.mjs", "analysis-engine smoke tests passed"),
  },
  {
    id: "A11Y",
    label: "접근성 라벨/상태",
    pass:
      has("src/components/sidebar.tsx", "aria-label=\"수동 POI") &&
      has("src/components/sidebar.tsx", "aria-pressed={selected}") &&
      has("src/components/map-view.tsx", "interactive: false"),
  },
  {
    id: "DESIGN",
    label: "일관된 디자인 토큰/상태",
    pass:
      has("src/components/sidebar.tsx", "rounded-2xl") &&
      has("src/components/sidebar.tsx", "focusRingClass") &&
      has("src/components/sidebar.tsx", "bg-black/20"),
  },
];

const passed = checks.filter((check) => check.pass).length;
const score = (passed / checks.length) * 10;

console.log(JSON.stringify({ score, passed, total: checks.length, checks }, null, 2));

if (score < 9) {
  process.exitCode = 1;
}
