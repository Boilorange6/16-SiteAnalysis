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

console.log("preview parity: empty-state OK, font constant OK");
