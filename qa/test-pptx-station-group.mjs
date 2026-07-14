// qa/test-pptx-station-group.mjs — 도형 그룹화 후처리(groupTaggedShapes) 단위 테스트.
// pptxgenjs로 GRP| 태깅된 미니 프레젠테이션을 만들고, 후처리 결과 XML에
// 역 단위 p:grpSp가 생기는지/비태깅 도형은 그대로인지 검증한다. (tsx로 TS 모듈 로드)
import assert from "node:assert/strict";
import PptxGenJS from "pptxgenjs";
import JSZip from "jszip";
import { groupTaggedShapes, GROUP_TAG_PREFIX } from "../src/lib/pptx-shape-group.ts";

const pptx = new PptxGenJS();
const slide = pptx.addSlide();
// 역A: 캐싱선 + 노선바 + 도트 + 라벨(회전) = 4개 요소
slide.addShape("line", { x: 1, y: 1, w: 1, h: 0.2, line: { color: "FFFFFF", width: 6 }, objectName: `${GROUP_TAG_PREFIX}sub-1|지하철역 강남역|casing0` });
slide.addShape("line", { x: 1, y: 1, w: 1, h: 0.2, line: { color: "00A84D", width: 4 }, objectName: `${GROUP_TAG_PREFIX}sub-1|지하철역 강남역|bar0` });
slide.addShape("ellipse", { x: 1.4, y: 1.05, w: 0.1, h: 0.1, fill: { color: "00A84D" }, objectName: `${GROUP_TAG_PREFIX}sub-1|지하철역 강남역|dot` });
slide.addText("강남역", { x: 1.2, y: 1.3, w: 0.8, h: 0.25, rotate: 20, objectName: `${GROUP_TAG_PREFIX}sub-1|지하철역 강남역|label` });
// 역B: 요소 2개
slide.addShape("line", { x: 3, y: 2, w: 1, h: 0.1, line: { color: "FFFFFF", width: 6 }, objectName: `${GROUP_TAG_PREFIX}sub-2|지하철역 역삼역|casing0` });
slide.addShape("ellipse", { x: 3.4, y: 2, w: 0.1, h: 0.1, fill: { color: "00A84D" }, objectName: `${GROUP_TAG_PREFIX}sub-2|지하철역 역삼역|dot` });
// 비태깅 도형 — 그룹화 대상 아님
slide.addShape("ellipse", { x: 5, y: 3, w: 0.2, h: 0.2, fill: { color: "FF0000" }, objectName: "plain-marker" });

const buf = await pptx.write({ outputType: "arraybuffer" });
const grouped = await groupTaggedShapes(buf);
const zip = await JSZip.loadAsync(grouped);
const xml = await zip.file("ppt/slides/slide1.xml").async("string");

const groups = xml.match(/<p:grpSp>/g) ?? [];
assert.equal(groups.length, 2, `expected 2 station groups, got ${groups.length}`);
assert.ok(xml.includes('name="지하철역 강남역"'), "group name for 강남역 missing");
assert.ok(xml.includes('name="지하철역 역삼역"'), "group name for 역삼역 missing");
// 그룹 내부에 자식 4개(강남역): grpSp 블록 안 p:sp 수 확인
const gangnam = xml.match(/<p:grpSp>(?:(?!<\/p:grpSp>)[\s\S])*지하철역 강남역(?:(?!<\/p:grpSp>)[\s\S])*<\/p:grpSp>/);
assert.ok(gangnam, "강남역 grpSp block not found");
assert.equal((gangnam[0].match(/<p:sp>/g) ?? []).length, 4, "강남역 group must contain 4 shapes");
// chOff=off 항등 매핑(자식 절대좌표 유지) 확인
assert.ok(/<a:chOff x="\d+" y="\d+"\/>/.test(gangnam[0]), "chOff missing");
// 비태깅 도형은 스프트리 최상위에 그대로
assert.ok(/<p:spTree>[\s\S]*name="plain-marker"/.test(xml), "plain marker must remain");
assert.ok(!/<p:grpSp>(?:(?!<\/p:grpSp>)[\s\S])*plain-marker(?:(?!<\/p:grpSp>)[\s\S])*<\/p:grpSp>/.test(xml), "plain marker must not be grouped");
// XML 유효성 최소 확인: 여는/닫는 sp 짝
assert.equal((xml.match(/<p:sp>/g) ?? []).length, (xml.match(/<\/p:sp>/g) ?? []).length, "unbalanced p:sp tags");

console.log("pptx-station-group: all tests passed");
