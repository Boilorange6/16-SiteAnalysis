import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();

function read(path) {
  return readFileSync(resolve(root, path), "utf8");
}

const configSource = read("src/lib/ppt-design-config.ts");
const appSource = read("src/components/site-analysis-app.tsx");
const sidebarSource = read("src/components/sidebar.tsx");
const previewSource = read("src/components/ppt-preview-modal.tsx");
const projectTypesSource = read("src/lib/project-types.ts");
const projectStoreSource = read("src/lib/server/project-store.ts");
const generatorSource = read("src/lib/ppt-generator.ts");
const canvasSource = read("src/lib/ppt-canvas-renderer.ts");

const checks = [
  {
    id: "no-preset-export",
    label: "PPT preset export has been removed",
    pass: !configSource.includes("PPT_DESIGN_PRESETS"),
  },
  {
    id: "default-design-kept",
    label: "Single default PPT design remains available for generation",
    pass: configSource.includes("export const DEFAULT_PPT_DESIGN"),
  },
  {
    id: "app-no-template-state",
    label: "App no longer stores selected template state",
    pass: !appSource.includes("selectedTemplateId") && !appSource.includes("setSelectedTemplateId"),
  },
  {
    id: "sidebar-no-template-ui",
    label: "Sidebar no longer exposes a PPT template selector",
    pass:
      !sidebarSource.includes("PPT_DESIGN_PRESETS") &&
      !sidebarSource.includes("PPT 템플릿") &&
      !sidebarSource.includes("selectedPptPreset") &&
      !sidebarSource.includes("onSelectTemplate"),
  },
  {
    id: "preview-no-preset-picker",
    label: "Preview modal no longer exposes preset picker controls",
    pass:
      !previewSource.includes("PPT_DESIGN_PRESETS") &&
      !previewSource.includes("applyPreset") &&
      !previewSource.includes("onTemplateChange") &&
      !previewSource.includes("selectedTemplateId") &&
      !previewSource.includes("프리셋"),
  },
  {
    id: "projects-no-template-payload",
    label: "Saved projects no longer persist template ids",
    pass:
      !projectTypesSource.includes("selectedTemplateId") &&
      !projectStoreSource.includes("selectedTemplateId"),
  },
  {
    id: "generation-fallback",
    label: "PPT generator and preview renderer still consume the default design",
    pass:
      generatorSource.includes("DEFAULT_PPT_DESIGN") &&
      canvasSource.includes("PptDesignConfig"),
  },
  {
    id: "clean-default-design",
    label: "Default PPT design removes decorative orange lines and background",
    pass:
      configSource.includes('frameStyle: "none"') &&
      configSource.includes('compositionStyle: "none"') &&
      configSource.includes('titleStyle: "plain"') &&
      configSource.includes('accentColor: "#111827"') &&
      configSource.includes('overlayColor: "#FFFFFF"') &&
      configSource.includes("mapOverlayTransparency: 78") &&
      configSource.includes("coverOverlayTransparency: 28") &&
      configSource.includes("titleChipTransparency: 100") &&
      configSource.includes("legendTransparency: 10") &&
      !configSource.includes("#FBBF24"),
  },
  {
    id: "satellite-legibility-guard",
    label: "PPT and preview renderers apply satellite-map veils on cover and content slides",
    pass:
      generatorSource.includes("function addMapVeil") &&
      generatorSource.includes("d.coverOverlayTransparency") &&
      generatorSource.includes("d.mapOverlayTransparency") &&
      canvasSource.includes("function drawMapVeil") &&
      canvasSource.includes("drawCoverMapOverlay") &&
      canvasSource.includes("d.coverOverlayTransparency") &&
      canvasSource.includes("d.mapOverlayTransparency"),
  },
  {
    id: "renderers-support-clean-mode",
    label: "PPT and preview renderers support no-frame/no-backdrop/plain-title modes",
    pass:
      generatorSource.includes('case "none":') &&
      generatorSource.includes('d.titleStyle === "plain"') &&
      canvasSource.includes('case "none":') &&
      canvasSource.includes('d.titleStyle === "plain"'),
  },
];

const passed = checks.filter((check) => check.pass).length;
console.log(JSON.stringify({ passed, total: checks.length, checks }, null, 2));

if (passed !== checks.length) {
  process.exitCode = 1;
}
