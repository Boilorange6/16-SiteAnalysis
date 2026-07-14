// qa/validate-preview-parity.mjs
// 미리보기(canvas)와 PPT(pptx) 렌더러가 같은 empty-state 문자열을 쓰는지 정적 검증.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const canvas = readFileSync("src/lib/ppt-canvas-renderer.ts", "utf8");
const pptx = readFileSync("src/lib/ppt-generator.ts", "utf8");
const TEXT = "반경 내 확인된 시설이 없습니다";

assert.ok(canvas.includes(TEXT), `canvas renderer missing empty-state text: ${TEXT}`);
assert.ok(pptx.includes(TEXT), `pptx generator missing empty-state text: ${TEXT}`);

// 두 렌더러가 design-config의 서체 상수(PPT_FONT_MAIN)를 참조하는지 정적 검증 (하드코딩 회귀 방지)
assert.ok(canvas.includes("PPT_FONT_MAIN"), "canvas renderer must reference PPT_FONT_MAIN from ppt-design-config");
assert.ok(pptx.includes("PPT_FONT_MAIN"), "pptx generator must reference PPT_FONT_MAIN from ppt-design-config");

// 콜아웃 미니표 쌍둥이 함수(buildResidentialTableRows)의 본문이 두 렌더러에서 동일한지 정적 검증.
// 이 함수는 의도적으로 양쪽에 중복 구현되어 있으므로(수치 parity 주석 참조) 본문 drift가 곧 버그다.
function extractFnBody(src, file) {
  const m = src.match(/function buildResidentialTableRows\(apt: ResidentialPoi\): ResidentialTableRow\[\] \{[\s\S]*?\n\}/);
  assert.ok(m, `${file}: buildResidentialTableRows not found`);
  return m[0];
}
const canvasFn = extractFnBody(canvas, "ppt-canvas-renderer.ts");
const pptxFn = extractFnBody(pptx, "ppt-generator.ts");
assert.equal(canvasFn, pptxFn, "buildResidentialTableRows bodies diverged between canvas renderer and pptx generator");

// 콜아웃 미니표 필수 행: 세대수 + 주차 + 준공(사용승인일 기반 연도 라벨) — 주차/준공 누락 회귀 방지
for (const label of ['"세대수"', '"주차"', '"준공"']) {
  assert.ok(canvasFn.includes(label), `buildResidentialTableRows missing ${label} row`);
}

console.log("preview parity: empty-state OK, font constant OK, residential table rows OK");
