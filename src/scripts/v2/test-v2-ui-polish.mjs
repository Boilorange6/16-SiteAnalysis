/** v2 P4 보드 UI 정리: 미니 범례·요약면·모바일 데모 버튼 계약. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const calloutSource = readFileSync(new URL("../../components/v2/callout-map.tsx", import.meta.url), "utf8");
const calloutStart = calloutSource.indexOf("export function CalloutLegend");
const calloutEnd = calloutSource.indexOf("/** 개요 페이지 왼쪽 아래 핵심 값 카드", calloutStart);
assert.ok(calloutStart >= 0 && calloutEnd > calloutStart, "CalloutLegend source must remain discoverable");
const calloutLegend = calloutSource.slice(calloutStart, calloutEnd);
assert.match(calloutLegend, /aria-label=\{compact \? `범례 \$\{items\.length\}색` : "범례"\}/, "compact legend keeps its accessible name");
assert.doesNotMatch(calloutLegend, /<span className=\{styles\.cLegendT\}>\{compact \? `범례/, "compact legend must not render an N-color heading");
assert.match(calloutLegend, /\{!compact && <span className=\{styles\.cLegendT\}>/, "full legend keeps its visible title");

const boardCss = readFileSync(new URL("../../components/v2/board.module.css", import.meta.url), "utf8");
const summaryBodyBlocks = [...boardCss.matchAll(/\.sumBody\s*\{([^}]*)\}/g)].map((match) => match[1]);
assert.ok(summaryBodyBlocks.length >= 2, "summary body must have base and mobile rules");
assert.ok(summaryBodyBlocks.every((block) => /justify-content:\s*flex-start/.test(block)), "summary content must start at the top at every breakpoint");
assert.doesNotMatch(boardCss, /\.sumBody\s*\{[^}]*justify-content:\s*center/, "summary must not reserve a centered blank area");

const pageSource = readFileSync(new URL("../../app/v2/page.tsx", import.meta.url), "utf8");
assert.match(pageSource, /const DEMO_START_LABEL = "분석 데모";/, "demo start copy has one shared, concise label");
assert.match(pageSource, /\{demoOn \? "데모 끄기" : DEMO_START_LABEL\}/, "desktop and mobile use the same demo copy");
const mobileDemoRule = boardCss.match(/\.demoToggle\s*\{([^}]*)\}/)?.[1] ?? "";
assert.match(mobileDemoRule, /flex:\s*0\s+0\s+auto/, "mobile demo button keeps its intrinsic width");
assert.match(mobileDemoRule, /white-space:\s*nowrap/, "mobile demo button stays on one line");

console.log("v2 UI polish contracts ok");
