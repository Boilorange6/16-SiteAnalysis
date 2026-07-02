// qa/validate-preview-parity.mjs
// 미리보기(canvas)와 PPT(pptx) 렌더러가 같은 empty-state 문자열을 쓰는지 정적 검증.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const canvas = readFileSync("src/lib/ppt-canvas-renderer.ts", "utf8");
const pptx = readFileSync("src/lib/ppt-generator.ts", "utf8");
const TEXT = "반경 내 확인된 시설이 없습니다";

assert.ok(canvas.includes(TEXT), `canvas renderer missing empty-state text: ${TEXT}`);
assert.ok(pptx.includes(TEXT), `pptx generator missing empty-state text: ${TEXT}`);
console.log("preview parity: empty-state OK");
