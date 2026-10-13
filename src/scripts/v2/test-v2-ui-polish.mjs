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
assert.match(calloutLegend, /\{!compact && <span className=\{tileStyles\.cLegendT\}>/, "full legend keeps its visible title");

const boardCss = readFileSync(new URL("../../components/v2/board.module.css", import.meta.url), "utf8");
const calloutCss = readFileSync(new URL("../../lib/v2/tile/a05/tile.module.css", import.meta.url), "utf8");
const cNameRule = calloutCss.match(/\.cName\s*\{([^}]*)\}/)?.[1] ?? "";
assert.match(cNameRule, /white-space:\s*normal/, "단지명은 두 줄 표시 가능");
assert.match(cNameRule, /text-overflow:\s*clip/, "단지명은 CSS 말줄임을 쓰지 않음");
assert.match(cNameRule, /max-height:\s*2\.2em/, "단지명은 최대 두 줄 높이를 예약");
assert.match(calloutCss, /\.cHead\[data-compact\]\s*\{[^}]*height:\s*auto/, "짧은 카드 헤더도 두 줄 높이를 수용");
const summaryBodyBlocks = [...boardCss.matchAll(/\.sumBody\s*\{([^}]*)\}/g)].map((match) => match[1]);
assert.ok(summaryBodyBlocks.length >= 2, "summary body must have base and mobile rules");
assert.ok(summaryBodyBlocks.every((block) => /justify-content:\s*flex-start/.test(block)), "summary content must start at the top at every breakpoint");
assert.doesNotMatch(boardCss, /\.sumBody\s*\{[^}]*justify-content:\s*center/, "summary must not reserve a centered blank area");


const mapFigureSource = readFileSync(new URL("../../components/v2/map-figure.tsx", import.meta.url), "utf8");
const mapBoxSource = readFileSync(new URL("../../components/v2/map-box.tsx", import.meta.url), "utf8");
const tileCardSource = readFileSync(new URL("../../components/v2/tile-card.tsx", import.meta.url), "utf8");
const { mapLegendStripVisible } = await import("../../lib/v2/ui/map-legend.ts");
assert.match(mapFigureSource, /function compactSteppedLegendTitle/, "카드 래스터 범례에 짧은 표시명 경로가 있음");
assert.doesNotMatch(mapFigureSource, /if \(label\) return `\$\{label\} 일조시간`;/, "S02 카드 범례에 일조시간 하드코딩 특례가 없음");
assert.match(mapFigureSource, /return style\.label \?\? ref\.label \?\? ref\.name;/, "래스터 범례 제목은 공용 스타일·래스터 메타데이터를 사용");
assert.doesNotMatch(mapFigureSource, /compactTitle \+= "…"/, "S02 카드 범례 제목을 잘라 말줄임하지 않음");
assert.match(mapFigureSource, /mapCalloutTextLayout/, "지도 말풍선은 내용 기반 텍스트 레이아웃을 사용");
assert.match(mapFigureSource, /whiteSpace: "nowrap"/, "지도 말풍선 텍스트는 자동 줄바꿈하지 않음");
assert.match(mapFigureSource, /<title>\{d\.text\}<\/title>/, "말줄임 전 라벨 원문을 SVG title로 보존");
assert.match(mapBoxSource, /mapLegendStripVisible\(\{ bare, legend: opts\.legend, muted: opts\.muted, itemCount: legendItems\.length \}\)/, "카드 범례 띠는 카드 상태와 무관하게 렌더");
assert.doesNotMatch(mapBoxSource, /showLegendStrip/, "범례 띠 숨김 게이트는 제거");
assert.equal(mapLegendStripVisible({ legend: false, itemCount: 2 }), true, "카드 범례 띠는 기본 표시");
assert.equal(mapLegendStripVisible({ legend: false, itemCount: 0 }), false, "범례 항목이 없으면 띠를 생략");
assert.match(tileCardSource, /라벨 보기/, "카드 더 보기 메뉴에 라벨 토글 제공");
assert.match(tileCardSource, /showMapLabels=\{p\.showMapLabels\}/, "카드 라벨 토글이 지도 렌더에 연결");
assert.match(tileCardSource, /role="menuitemcheckbox" aria-checked=\{compact\.showLabels\}/, "라벨 토글은 체크박스 메뉴 의미와 상태를 노출");
assert.match(mapFigureSource, /showAutomaticLabels/, "일반 지도는 자동 라벨 표시를 카드별로 제어");
assert.match(calloutSource, /showMapLabels/, "A05\/A06은 카드별 말풍선 표시를 제어");
assert.match(calloutSource, /scene\.labelFrame/, "A05\/A06 호버·포커스 정보 카드는 라벨 프레임을 재사용");
assert.match(calloutSource, /onFocus=\{\(\) =>/, "A05\/A06 마커는 키보드 포커스로 정보 경로를 유지");
assert.match(calloutSource, /<MapLegendStrip/, "A05/A06 설명선 범례는 공용 하단 띠를 사용");
assert.doesNotMatch(calloutSource, /showLegendStrip/, "A05/A06 범례 띠 숨김 게이트는 제거");
assert.match(calloutSource, /data-callout-map-root/, "설명선 지도와 하단 범례는 별도 레이아웃 영역");
assert.doesNotMatch(calloutSource, /<CalloutLegend[\s\S]*style=\{detail \?/, "설명선 범례를 지도 위 절대 위치로 렌더링하지 않음");
assert.match(calloutSource, /paddingBottom: detail \? OV\.stripH : 0/, "상세 설명선 범례가 출처 띠를 침범하지 않음");

console.log("v2 UI polish contracts ok");
