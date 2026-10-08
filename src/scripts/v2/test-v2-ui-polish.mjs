/** v2 P4 보드 UI 정리: 미니 범례·요약면·모바일 데모 버튼·설명선 잘림 계약. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const calloutLayoutSource = readFileSync(new URL("../../lib/v2/ui/callout-layout.ts", import.meta.url), "utf8");
assert.match(calloutLayoutSource, /return duplicatePrefix \? `\$\{full\}/, "단지명 원문은 두 줄까지 보존");
assert.doesNotMatch(calloutLayoutSource, /return `\$\{prefix\}…/, "단지명 표시 함수가 말줄임표를 넣지 않음");
assert.match(calloutLayoutSource, /cardFraction: 0\.21/, "모바일 설명선 카드 폭을 줄여 중앙 반경원 확보");

const calloutSource = readFileSync(new URL("../../components/v2/callout-map.tsx", import.meta.url), "utf8");
const calloutStart = calloutSource.indexOf("export function CalloutLegend");
const calloutEnd = calloutSource.indexOf("/** 개요 페이지 왼쪽 아래 핵심 값 카드", calloutStart);
assert.ok(calloutStart >= 0 && calloutEnd > calloutStart, "CalloutLegend source must remain discoverable");
const calloutLegend = calloutSource.slice(calloutStart, calloutEnd);
assert.match(calloutLegend, /aria-label=\{compact \? `범례 \$\{items\.length\}색` : "범례"\}/, "compact legend keeps its accessible name");
assert.doesNotMatch(calloutLegend, /<span className=\{styles\.cLegendT\}>\{compact \? `범례/, "compact legend must not render an N-color heading");
assert.match(calloutLegend, /\{!compact && <span className=\{styles\.cLegendT\}>/, "full legend keeps its visible title");

const boardCss = readFileSync(new URL("../../components/v2/board.module.css", import.meta.url), "utf8");
const cNameRule = boardCss.match(/\.cName\s*\{([^}]*)\}/)?.[1] ?? "";
assert.match(cNameRule, /white-space:\s*normal/, "단지명은 두 줄 표시 가능");
assert.match(cNameRule, /text-overflow:\s*clip/, "단지명은 CSS 말줄임을 쓰지 않음");
assert.match(cNameRule, /max-height:\s*2\.2em/, "단지명은 최대 두 줄 높이를 예약");
assert.match(boardCss, /\.cHead\[data-compact\]\s*\{[^}]*height:\s*auto/, "짧은 카드 헤더도 두 줄 높이를 수용");
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

const mapFigureSource = readFileSync(new URL("../../components/v2/map-figure.tsx", import.meta.url), "utf8");
assert.match(mapFigureSource, /function compactSteppedLegendTitle/, "카드 래스터 범례에 짧은 표시명 경로가 있음");
assert.match(mapFigureSource, /if \(label\) return `\$\{label\} 일조시간`;/, "S02 카드 범례는 실제 래스터 계절명을 따르는 짧은 제목을 사용");
assert.doesNotMatch(mapFigureSource, /compactTitle \+= "…"/, "S02 카드 범례 제목을 잘라 말줄임하지 않음");

console.log("v2 UI polish contracts ok");
