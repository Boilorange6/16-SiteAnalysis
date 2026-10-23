import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const {
  defaultFrame,
  pageElementDeleted,
  reportDocReducer,
  restorePageElementPatch,
} = await import("../../lib/v2/report/report-doc.ts");
const { restoreReportDoc } = await import("../../lib/v2/ui/board-state.ts");

const tilePage = {
  id: "p1",
  layout: "map-summary",
  panels: {},
  textBoxes: [],
  notes: "",
  kind: "tile",
  tileId: "t-A01",
  part: { type: "single" },
  settings: {},
  frame: defaultFrame(),
};
const doc = { v: 1, format: "wide", pages: [tilePage] };
const deletedSummary = reportDocReducer(doc, { type: "pageElement", id: "p1", key: "summary", deleted: true });
assert.deepEqual(deletedSummary.pages[0].deletedElementKeys, ["summary"], "페이지 요소 지우기는 페이지에 기록한다");
assert.equal(pageElementDeleted(deletedSummary.pages[0], "summary"), true, "페이지 요소 삭제 판정은 순수 함수다");
assert.equal(pageElementDeleted(deletedSummary.pages[0], "title"), false, "다른 페이지 요소는 함께 지워지지 않는다");
const restoredSummary = reportDocReducer(deletedSummary, { type: "pageElement", id: "p1", key: "summary", deleted: false });
assert.deepEqual(restoredSummary.pages[0].deletedElementKeys, [], "페이지 요소 되살리기는 목록에서 하나를 뺀다");
assert.deepEqual(restorePageElementPatch({ deletedElementKeys: ["title", "summary"] }, "summary"), { deletedElementKeys: ["title"] }, "페이지 요소 복원 patch는 해당 항목만 되살린다");

const oldSave = restoreReportDoc({ v: 1, format: "wide", pages: [{ ...tilePage, frame: { ...tilePage.frame, deletedElementKeys: undefined } }] }, new Set(["t-A01"]));
assert.deepEqual(oldSave.pages[0].deletedElementKeys, [], "옛 저장본은 페이지 지운 요소를 빈 목록으로 복원한다");
const saved = restoreReportDoc({ v: 1, format: "wide", pages: [{ ...tilePage, deletedElementKeys: ["summary"], frame: { ...tilePage.frame, deletedElementKeys: ["line|road|1"] } }] }, new Set(["t-A01"]));
assert.deepEqual(saved.pages[0].deletedElementKeys, ["summary"], "페이지 지운 요소를 저장·복원한다");
assert.deepEqual(saved.pages[0].frame.deletedElementKeys, ["line|road|1"], "지도 지운 요소 상태를 함께 보존한다");

const surfaceSource = readFileSync(new URL("../../components/v2/report/slide-surface.tsx", import.meta.url), "utf8");
const modeSource = readFileSync(new URL("../../components/v2/report/report-mode.tsx", import.meta.url), "utf8");
const pptSource = readFileSync(new URL("../../lib/v2/report/render-pptx.ts", import.meta.url), "utf8");
assert.match(surfaceSource, /function ElementActionBar\s*\(/, "모든 요소는 공통 ElementActionBar를 사용한다");
assert.match(surfaceSource, /지우기/, "공통 막대의 삭제 문구는 지우기다");
assert.doesNotMatch(surfaceSource, /MapSelectionToolbar/, "요소별 지도 전용 막대 컴포넌트를 남기지 않는다");
assert.doesNotMatch(surfaceSource, /textBoxDeleteButton/, "글상자 전용 휴지통 버튼을 남기지 않는다");
assert.match(modeSource, /onDirectStylePatch=\{directPatch\}|onDirectStylePatch=\{/, "요약·패널 직접 수정 callback이 보고서 모드까지 연결된다");
assert.match(modeSource, /pageElement/, "보고서 모드가 페이지 요소 삭제 reducer를 사용한다");
assert.match(pptSource, /pageElementDeleted|deletedElementKeys/, "PPT가 페이지 지운 요소 상태를 읽는다");

console.log("v2 report element action contract tests passed");
