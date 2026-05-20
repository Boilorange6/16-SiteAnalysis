import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { execFileSync } from "child_process";

const QA_ROOT = process.cwd();
const DEV_ROOT =
  process.env.DEV_ROOT ||
  QA_ROOT;
const DESIGN_ROOT =
  process.env.DESIGN_ROOT ||
  QA_ROOT;

const PATHS = {
  devPlan: path.join(DEV_ROOT, "docs", "dev-supplement-plan.md"),
  analysisJson: path.join(DEV_ROOT, "output", "cheongwadae-analysis.json"),
  generatorScript: path.join(DEV_ROOT, "src", "scripts", "test-cheongwadae.mjs"),
  designSpec: path.join(DESIGN_ROOT, "docs", "design-spec.md"),
  iconDir: path.join(DESIGN_ROOT, "public", "assets", "icons"),
  resultsDir: path.join(QA_ROOT, "qa", "results"),
};

const CENTER = { lat: 37.5866, lng: 126.9748 };
const REQUIRED_LAYERS = [
  { type: "subways", icon: "subway.svg" },
  { type: "mountains", icon: "mountain.svg" },
  { type: "schools", icon: "school.svg" },
  { type: "parks", icon: "park.svg" },
  { type: "apartments", icon: "apartment.svg" },
];
const EXPECTED_SLIDES = 7;

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function hashBuffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function fileExists(filePath) {
  return fs.existsSync(filePath);
}

function readUtf8(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function findOutputFiles(rootDir) {
  if (!fileExists(rootDir)) {
    return [];
  }

  return fs
    .readdirSync(rootDir)
    .filter((entry) => /\.(pptx|ppt|pdf|png|jpg|jpeg)$/i.test(entry))
    .map((entry) => path.join(rootDir, entry));
}

function hasUsableFile(filePath, minBytes = 1024) {
  if (!fileExists(filePath)) return false;
  return fs.statSync(filePath).size >= minBytes;
}

function runGeneratorInIsolation(sourceScriptPath) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cheongwadae-qa-"));
  const tempScriptDir = path.join(tempRoot, "src", "scripts");
  const tempOutputDir = path.join(tempRoot, "output");

  ensureDir(tempScriptDir);
  ensureDir(tempOutputDir);

  const tempScriptPath = path.join(tempScriptDir, "test-cheongwadae.mjs");
  fs.copyFileSync(sourceScriptPath, tempScriptPath);

  execFileSync(process.execPath, [tempScriptPath], {
    cwd: tempRoot,
    stdio: "pipe",
  });

  return {
    tempRoot,
    generatedJsonPath: path.join(tempOutputDir, "cheongwadae-analysis.json"),
  };
}

function cleanupTemp(dirPath) {
  if (fileExists(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
}

function createCheck(id, title, severity, passed, evidence, detail) {
  return { id, title, severity, passed, evidence, detail };
}

function main() {
  ensureDir(PATHS.resultsDir);

  const analysis = JSON.parse(readUtf8(PATHS.analysisJson));
  const designSpec = readUtf8(PATHS.designSpec);
  const outputFiles = findOutputFiles(path.dirname(PATHS.analysisJson)).filter(
    (filePath) => path.basename(filePath) !== "cheongwadae-analysis.json"
  );

  const checks = [];

  const satelliteLayer = analysis.layers.find(
    (layer) => layer.type === "satellite_map"
  );
  const satelliteOutputFiles = outputFiles.filter((filePath) => {
    const basename = path.basename(filePath);
    return basename === "map-satellite.png" || basename === "청와대_사이트분석.pptx";
  });
  const satellitePassed =
    Boolean(satelliteLayer) &&
    satelliteLayer.source &&
    satelliteLayer.source !== "pending_selection" &&
    satelliteOutputFiles.some((filePath) => hasUsableFile(filePath, 10_000));
  checks.push(
    createCheck(
      "QA-01",
      "위성지도 타일 렌더링",
      "HIGH",
      satellitePassed,
      {
        satelliteSource: satelliteLayer?.source ?? null,
        outputFiles: satelliteOutputFiles,
      },
      satellitePassed
        ? "위성지도 소스와 대표 지도/PPT 출력 파일이 모두 확인되었습니다."
        : "위성지도 소스 또는 대표 지도/PPT 출력 파일이 없습니다."
    )
  );

  const declaredLayers = new Map(
    analysis.layers.map((layer) => [layer.type, layer])
  );
  const missingLayerTypes = [];
  const missingIcons = [];

  for (const requirement of REQUIRED_LAYERS) {
    const layer = declaredLayers.get(requirement.type);
    if (!layer || Number(layer.count) < 1) {
      missingLayerTypes.push(requirement.type);
    }

    const iconPath = path.join(PATHS.iconDir, requirement.icon);
    if (!fileExists(iconPath)) {
      missingIcons.push(requirement.icon);
    }
  }

  const layersPassed =
    missingLayerTypes.length === 0 && missingIcons.length === 0;
  checks.push(
    createCheck(
      "QA-02",
      "5개 POI 레이어 표시",
      "HIGH",
      layersPassed,
      {
        missingLayerTypes,
        missingIcons,
      },
      layersPassed
        ? "5개 필수 레이어와 대응 아이콘이 모두 존재합니다."
        : "필수 레이어 또는 아이콘이 누락되었습니다."
    )
  );

  const hasExactCenter =
    Math.abs(Number(analysis.center?.lat) - CENTER.lat) < 0.000001 &&
    Math.abs(Number(analysis.center?.lng) - CENTER.lng) < 0.000001;
  const coordinateCollections = REQUIRED_LAYERS.map((layer) => {
    const definition = declaredLayers.get(layer.type);
    const items = Array.isArray(definition?.items) ? definition.items : [];
    const hasCoordinates =
      items.length > 0 &&
      items.every(
        (item) =>
          typeof item?.lat === "number" && typeof item?.lng === "number"
      );
    return {
      type: layer.type,
      itemCount: items.length,
      hasCoordinates,
    };
  });
  const coordinatesPassed =
    hasExactCenter &&
    coordinateCollections.every(
      (collection) => collection.itemCount > 0 && collection.hasCoordinates
    );
  checks.push(
    createCheck(
      "QA-03",
      "오버레이 좌표 정합성",
      "HIGH",
      coordinatesPassed,
      {
        center: analysis.center,
        coordinateCollections,
      },
      coordinatesPassed
        ? "중심좌표와 개별 오버레이 좌표가 모두 검증 범위 내입니다."
        : "중심좌표는 존재하지만 개별 오버레이 좌표 목록이 없어 반경 3km 정합성 검증이 불가능합니다."
    )
  );

  const slideCount = Array.isArray(analysis.pptStructure)
    ? analysis.pptStructure.length
    : 0;
  const designMentionsExpectedSlides =
    designSpec.includes("16:9") &&
    designSpec.includes(`1 / ${EXPECTED_SLIDES}`) &&
    designSpec.includes("Full-bleed Map");
  const pptFiles = outputFiles.filter((filePath) => /\.(pptx|ppt|pdf)$/i.test(filePath));
  const usablePptFiles = pptFiles.filter((filePath) => hasUsableFile(filePath, 10_000));
  const pptPassed =
    usablePptFiles.length > 0 &&
    slideCount === EXPECTED_SLIDES &&
    designMentionsExpectedSlides;
  checks.push(
    createCheck(
      "QA-04",
      "PPT 출력 완결성",
      "HIGH",
      pptPassed,
      {
        slideCount,
        expectedSlides: EXPECTED_SLIDES,
        outputFiles: usablePptFiles,
        designMentionsExpectedSlides,
      },
      pptPassed
        ? "실제 PPT/PDF 출력물과 7장 슬라이드 구성이 디자인 사양과 일치합니다."
        : "7장 슬라이드 구조, 디자인 사양, 실제 PPT/PDF 출력물 중 일부가 누락되었습니다."
    )
  );

  let reproducibilityPassed = false;
  let reproducibilityEvidence = {};
  let reproducibilityDetail = "";
  let tempRoot;

  try {
    const isolatedRun = runGeneratorInIsolation(PATHS.generatorScript);
    tempRoot = isolatedRun.tempRoot;
    const expectedBuffer = fs.readFileSync(PATHS.analysisJson);
    const actualBuffer = fs.readFileSync(isolatedRun.generatedJsonPath);

    reproducibilityPassed = expectedBuffer.equals(actualBuffer);
    reproducibilityEvidence = {
      expectedSha256: hashBuffer(expectedBuffer),
      actualSha256: hashBuffer(actualBuffer),
      generatedJsonPath: isolatedRun.generatedJsonPath,
    };
    reproducibilityDetail = reproducibilityPassed
      ? "격리 경로 실행 결과가 기존 JSON과 바이트 단위로 일치합니다."
      : "격리 경로 실행 결과가 기존 JSON과 일치하지 않습니다.";
  } catch (error) {
    reproducibilityPassed = false;
    reproducibilityEvidence = {
      error: error instanceof Error ? error.message : String(error),
    };
    reproducibilityDetail =
      "재현 스크립트 실행에 실패하여 데모 시나리오 재현성을 입증하지 못했습니다.";
  } finally {
    if (tempRoot) {
      cleanupTemp(tempRoot);
    }
  }

  checks.push(
    createCheck(
      "QA-05",
      "데모 시나리오 재현성",
      "MEDIUM",
      reproducibilityPassed,
      reproducibilityEvidence,
      reproducibilityDetail
    )
  );

  const failedHighChecks = checks.filter(
    (check) => !check.passed && (check.severity === "CRITICAL" || check.severity === "HIGH")
  );
  const overallStatus =
    failedHighChecks.length > 0 ? "CONDITIONAL_HOLD" : "APPROVED";

  const report = {
    generatedAt: new Date().toISOString(),
    overallStatus,
    summary: {
      passed: checks.filter((check) => check.passed).length,
      failed: checks.filter((check) => !check.passed).length,
      failedHigh: failedHighChecks.length,
    },
    references: PATHS,
    checks,
  };

  const jsonReportPath = path.join(
    PATHS.resultsDir,
    "cheongwadae-qa-report.json"
  );
  fs.writeFileSync(jsonReportPath, JSON.stringify(report, null, 2));

  const markdownLines = [
    "# 청와대 반경 3km 산출물 QA 판정 보고서",
    "",
    `- 판정 시각: ${report.generatedAt}`,
    `- 종합 상태: **${overallStatus}**`,
    `- 요약: 통과 ${report.summary.passed}건 / 실패 ${report.summary.failed}건 / HIGH 이상 실패 ${report.summary.failedHigh}건`,
    "",
    "## 체크 결과",
    "",
    "| ID | 항목 | 치명도 | 결과 | 상세 |",
    "| --- | --- | --- | --- | --- |",
    ...checks.map(
      (check) =>
        `| ${check.id} | ${check.title} | ${check.severity} | ${check.passed ? "PASS" : "FAIL"} | ${check.detail} |`
    ),
    "",
    "## 주요 판단",
    "",
  ];

  for (const check of checks) {
    markdownLines.push(`### ${check.id} ${check.title}`);
    markdownLines.push(`- 결과: ${check.passed ? "PASS" : "FAIL"} (${check.severity})`);
    markdownLines.push(`- 상세: ${check.detail}`);
    markdownLines.push(`- 증적: \`${JSON.stringify(check.evidence)}\``);
    markdownLines.push("");
  }

  if (overallStatus === "CONDITIONAL_HOLD") {
    markdownLines.push("## QA 결론");
    markdownLines.push("");
    markdownLines.push(
      "- 조건부 승인 유지. 대표 지도 출력물, 레이어 좌표, PPT 완성본 중 하나 이상이 최종 승인 기준을 충족하지 못했습니다."
    );
    markdownLines.push(
      "- 재검토 전 필수 보완: 위성지도 소스 확정 및 출력물 첨부, 레이어별 좌표 리스트 제공, 7장 구성의 실제 PPT/PDF 생성."
    );
    markdownLines.push("");
  }

  const markdownReportPath = path.join(
    PATHS.resultsDir,
    "cheongwadae-qa-report.md"
  );
  fs.writeFileSync(markdownReportPath, markdownLines.join("\n"));

  console.log(
    JSON.stringify(
      {
        overallStatus,
        jsonReportPath,
        markdownReportPath,
      },
      null,
      2
    )
  );

  if (overallStatus !== "APPROVED") {
    process.exitCode = 1;
  }
}

main();
