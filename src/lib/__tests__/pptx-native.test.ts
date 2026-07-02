// @vitest-environment node
import { describe, it, expect } from "vitest";
import AdmZip from "adm-zip";
import { buildSlides } from "@/lib/slide-builder";
import { createPptx } from "@/lib/ppt-generator";
import { SUBWAY_STATIONS, SCHOOLS, PARKS, MOUNTAINS, APARTMENTS, DEFAULT_CONFIG } from "@/lib/seed-data";

const ALL_POIS = [...SUBWAY_STATIONS, ...SCHOOLS, ...PARKS, ...MOUNTAINS, ...APARTMENTS];

describe("생성된 .pptx의 네이티브 요소", () => {
  it("슬라이드 7장, 텍스트/도형은 XML 네이티브, 차트 파트 존재, 이미지 없음(베이스맵 미제공 시)", async () => {
    const specs = buildSlides({
      config: DEFAULT_CONFIG,
      pois: ALL_POIS,
      baseMapImage: "", // 이미지 없이 생성 → media 폴더가 비어야 함
      poiPositions: ALL_POIS.map((poi, i) => ({ poi, nx: (i % 10) / 10 + 0.05, ny: ((i * 7) % 10) / 10 + 0.05 })),
      radiusPosition: { centerNx: 0.5, centerNy: 0.5, radiusNx: 0.3, radiusNy: 0.35 },
      routePositions: [],
    });
    const pptx = createPptx(specs, "test");
    const buf = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
    const zip = new AdmZip(buf);
    const names = zip.getEntries().map((e) => e.entryName);

    for (let i = 1; i <= 7; i++) {
      expect(names).toContain(`ppt/slides/slide${i}.xml`);
    }
    // 차트 파트 (분양 슬라이드의 네이티브 차트)
    expect(names.some((n) => /^ppt\/charts\/chart\d+\.xml$/.test(n))).toBe(true);
    // 이미지 미디어 없음 → 전부 네이티브 (차트 제외 워크북 xlsx는 embeddings에 있음)
    expect(names.filter((n) => n.startsWith("ppt/media/") && /\.(png|jpe?g)$/i.test(n))).toHaveLength(0);

    // 표지 슬라이드 XML에 텍스트 런이 존재
    const slide1 = zip.readAsText("ppt/slides/slide1.xml");
    expect(slide1).toContain("<a:t>");
    expect(slide1).toContain(DEFAULT_CONFIG.centerName);
  });
});
