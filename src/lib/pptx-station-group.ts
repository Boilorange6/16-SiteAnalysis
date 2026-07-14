/**
 * PPTX 역 단위 그룹화 후처리 — pptxgenjs(3.x)는 도형 그룹을 지원하지 않으므로,
 * 생성된 PPTX의 슬라이드 XML에서 STGRP| 태깅된 도형들을 역 단위 <p:grpSp>로 묶는다.
 * (사용자 요구: PPT에서 한 역의 역명·역사도식 요소를 한 번에 선택/편집)
 *
 * objectName 규약: `STGRP|{고유키}|{표시명}|{부위}` — 표시명이 그룹 이름("지하철역 {표시명}")이 된다.
 * 그룹 xfrm은 off=chOff / ext=chExt 항등 매핑이라 자식 절대좌표(EMU)를 그대로 유지한다.
 */
import JSZip from "jszip";

export const STATION_GROUP_PREFIX = "STGRP|";

interface TaggedShape {
  readonly start: number;
  readonly end: number;
  readonly xml: string;
  readonly key: string;
  readonly display: string;
}

const SP_BLOCK_RE = /<p:sp>[\s\S]*?<\/p:sp>/g;
const NAME_RE = /<p:cNvPr id="\d+" name="([^"]*)"/;
const OFF_RE = /<a:off x="(-?\d+)" y="(-?\d+)"\/>/;
const EXT_RE = /<a:ext cx="(\d+)" cy="(\d+)"\/>/;

function escapeXmlAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 슬라이드 XML 1개에서 태깅 도형들을 역 단위 grpSp로 재배치. 태깅이 없으면 원본 그대로. */
export function groupSlideXml(xml: string): string {
  const tagged: TaggedShape[] = [];
  for (const m of xml.matchAll(SP_BLOCK_RE)) {
    const nm = m[0].match(NAME_RE);
    if (!nm || !nm[1].startsWith(STATION_GROUP_PREFIX)) continue;
    const parts = nm[1].slice(STATION_GROUP_PREFIX.length).split("|");
    if (parts.length < 2) continue;
    tagged.push({ start: m.index, end: m.index + m[0].length, xml: m[0], key: parts[0], display: parts[1] });
  }
  if (tagged.length === 0) return xml;

  const byKey = new Map<string, TaggedShape[]>();
  for (const t of tagged) {
    if (!byKey.has(t.key)) byKey.set(t.key, []);
    byKey.get(t.key)!.push(t);
  }

  let maxId = 0;
  for (const m of xml.matchAll(/<p:cNvPr id="(\d+)"/g)) {
    maxId = Math.max(maxId, parseInt(m[1], 10));
  }

  // 각 키의 첫 도형 위치에 그룹 전체를 삽입하고 나머지 멤버는 제거(문서 순서 1회 스캔 splice).
  // 단독 멤버 그룹은 PowerPoint 복구 대상이 될 수 있어 2개 이상일 때만 묶는다.
  const firstOfKey = new Map<string, TaggedShape>();
  for (const t of tagged) {
    if (!firstOfKey.has(t.key)) firstOfKey.set(t.key, t);
  }

  let out = "";
  let cursor = 0;
  for (const t of tagged) {
    out += xml.slice(cursor, t.start);
    const members = byKey.get(t.key)!;
    if (members.length < 2) {
      out += t.xml; // 단독 멤버 — 그룹화하지 않고 그대로 유지
    } else if (firstOfKey.get(t.key) === t) {
      maxId += 1;
      out += buildGroupXml(members, t.display, maxId);
    }
    cursor = t.end;
  }
  out += xml.slice(cursor);
  return out;
}

function buildGroupXml(members: readonly TaggedShape[], display: string, id: number): string {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const mb of members) {
    const off = mb.xml.match(OFF_RE);
    const ext = mb.xml.match(EXT_RE);
    if (!off || !ext) continue;
    const x = parseInt(off[1], 10), y = parseInt(off[2], 10);
    const cx = parseInt(ext[1], 10), cy = parseInt(ext[2], 10);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + cx);
    maxY = Math.max(maxY, y + cy);
  }
  if (!Number.isFinite(minX)) { minX = 0; minY = 0; maxX = 1; maxY = 1; }
  const extX = Math.max(1, maxX - minX);
  const extY = Math.max(1, maxY - minY);
  const name = escapeXmlAttr(`지하철역 ${display}`);
  return (
    `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr><a:xfrm><a:off x="${minX}" y="${minY}"/><a:ext cx="${extX}" cy="${extY}"/>` +
    `<a:chOff x="${minX}" y="${minY}"/><a:chExt cx="${extX}" cy="${extY}"/></a:xfrm></p:grpSpPr>` +
    members.map((m) => m.xml).join("") +
    `</p:grpSp>`
  );
}

/** PPTX 바이너리 전체를 받아 모든 슬라이드에 역 그룹화를 적용해 돌려준다. */
export async function groupStationShapes(input: ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(input);
  const slideNames = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  for (const name of slideNames) {
    const xml = await zip.file(name)!.async("string");
    const next = groupSlideXml(xml);
    if (next !== xml) zip.file(name, next);
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
