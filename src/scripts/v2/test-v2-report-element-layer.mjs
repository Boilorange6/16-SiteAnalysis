import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const surface = readFileSync(new URL("../../components/v2/report/slide-surface.tsx", import.meta.url), "utf8");
const reportMode = readFileSync(new URL("../../components/v2/report/report-mode.tsx", import.meta.url), "utf8");
const surfaceCss = readFileSync(new URL("../../components/v2/report-surface.module.css", import.meta.url), "utf8");
const reportModeCss = readFileSync(new URL("../../components/v2/report/report-mode.module.css", import.meta.url), "utf8");

assert.match(surface, /data-element-action-layer/, "공통 막대는 콘텐츠와 분리된 최상위 요소 층을 표시한다");
assert.match(surface, /elementActionLayer/, "지도·장식 공통 막대는 전용 최상위 오버레이를 쓴다");
assert.match(surface, /칸 비율 그대로 크게 · 이 칸에만 적용/, "칸 크게 편집은 비율 유지·현재 칸 한정 안내를 표시한다");
assert.match(surface, /\{cellIndex \+ 1\} \/ \{slide\.cells\.length\}/, "칸 크게 편집은 현재 칸 위치를 표시한다");
assert.match(reportMode, /data-sheet-cell-editing/, "조판 칸 편집 상태가 페이지 독에 전달된다");
assert.match(surfaceCss, /\.elementActionLayer\s*\{[\s\S]*?z-index:\s*90[\s\S]*?pointer-events:\s*none/s, "공통 막대 층은 콘텐츠보다 높은 명시적 z-index를 가진다");
assert.match(surfaceCss, /\.elementActionLayer\[data-element-action-layer="true"\]\s+\[data-element-action-bar="true"\][\s\S]*?pointer-events:\s*auto/s, "최상위 공통 막대만 포인터를 받는다");
assert.match(reportModeCss, /\.pageDock\[data-sheet-cell-editing="true"\][\s\S]*?opacity:\s*\.4/s, "칸 편집 중 아래 페이지 줄은 40%로 흐려진다");

console.log("v2 report element layer contract tests passed");
