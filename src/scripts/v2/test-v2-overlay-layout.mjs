/** 몰입형 오버레이 위치 문법: 카드·펼침·슬라이드가 같은 토큰을 쓰고, 오버레이가 서로·가장자리와 어긋나지 않는다. */
import assert from "node:assert/strict";

const L = await import("../../lib/v2/ui/overlay-layout.ts");
const { GODEOK_RESULTS } = await import("../../lib/v2/ui/fixtures/godeok.ts");
const { toTileView } = await import("../../lib/v2/ui/tile-view.ts");

// 배지: 최대 2개 + "+n"
assert.deepEqual(L.badgesToShow(["a", "b", "c", "d"]), { shown: ["a", "b"], more: 2 });
assert.deepEqual(L.badgesToShow(["a"]), { shown: ["a"], more: 0 });

// 출처 띠는 항상 출처와 기준일을 담는다
assert.equal(L.stripText("rail 2026-09-01", false), "rail 2026-09-01");
assert.match(L.stripText("rail 2026-09-01"), /© VWorld\(국토교통부\)$/);
assert.match(L.stripText("출처 없음"), /출처 없음 · 기준일 해당 없음/);
for (const r of GODEOK_RESULTS) assert.match(L.stripText(toTileView(r).sourceLine), /기준일|\d{4}-\d{2}/, `${r.tileCode} 출처 띠`);

// 카드 예약 자리: 모두 카드 안, 왼쪽 위(제목)·오른쪽 위(보고서)·왼쪽 아래(값)·맨 아래(출처 띠)
for (const [w, h] of [[334, 280], [684, 280], [358, 280]]) {
  const boxes = L.cardReserved(w, h);
  for (const b of boxes) assert.ok(b.x0 >= 0 && b.y0 >= 0 && b.x1 <= w && b.y1 <= h && b.x0 < b.x1 && b.y0 < b.y1, `card ${w}x${h} 범위`);
  const [title, report, value, strip] = boxes;
  assert.ok(!L.overlaps(title, report), "제목 칩과 보고서 칩이 겹치지 않는다");
  assert.ok(!L.overlaps(title, value), "제목 칩과 값 카드가 겹치지 않는다");
  assert.equal(strip.y1, h);
  assert.equal(strip.y0, h - L.OV.stripH);
}

// 슬라이드: 제목 판·정보 판·출처 띠가 겹치지 않고 슬라이드 안에 있다. 정보 판 폭 ≈ 32%
const s = L.slideLayout();
const inSlide = (r) => r.x >= 0 && r.y >= 0 && r.x + r.w <= L.SLIDE.w + 1e-9 && r.y + r.h <= L.SLIDE.h + 1e-9;
for (const r of [s.title, s.info, s.strip, s.page]) assert.ok(inSlide(r), JSON.stringify(r));
const box = (r) => ({ x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h });
assert.ok(!L.overlaps(box(s.title), box(s.info)) && !L.overlaps(box(s.info), box(s.strip)) && !L.overlaps(box(s.title), box(s.strip)));
assert.ok(Math.abs(s.info.w / L.SLIDE.w - 0.32) < 0.01);
assert.ok(s.strip.y + s.strip.h === L.SLIDE.h, "출처 띠는 맨 아래");
// 대지 위치: 정보 판 왼쪽 영역의 가운데 (오른쪽 32%에 들어가지 않는다)
assert.ok(L.slideSiteX() > 0.25 && L.slideSiteX() < 0.5);
assert.equal(L.detailSiteX(390), 0.5);
assert.ok(L.detailSiteX(1440) < 0.5);

// 범례 판: 항목이 없으면 없음, 있으면 슬라이드 안·출처 띠 위·왼쪽 아래
assert.equal(L.slideLegendRect(0, 0, 0), null);
const lg = L.slideLegendRect(7, 1, 10);
assert.ok(inSlide(lg) && lg.y + lg.h <= s.strip.y && lg.x === s.legendX);
const legendRows = L.slideLegendRowRects(lg, 7, 1);
const legendGeometry = L.slideLegendGeometry(lg);
const legendRowBoxes = [...legendRows.items, ...legendRows.notes].map((row) => ({ x0: row.x, y0: row.y, x1: row.x + row.w, y1: row.y + row.h }));
for (let i = 0; i < legendRowBoxes.length; i += 1) {
  for (let j = i + 1; j < legendRowBoxes.length; j += 1) assert.ok(!L.overlaps(legendRowBoxes[i], legendRowBoxes[j]), `범례 행 ${i}/${j}가 겹치지 않는다`);
}
assert.equal(L.SLIDE_LEGEND.padding, 0.12, "보고서 범례 안쪽 여백 정본");
assert.equal(L.SLIDE_LEGEND.row, 0.24, "보고서 범례 행 높이 정본");
assert.ok(legendRows.items.every((row) => row.h >= L.SLIDE_LEGEND.row), "범례 항목은 축소되어 0이 되지 않는다");
assert.equal(legendRows.items[0].x, lg.x + L.SLIDE_LEGEND.padding, "범례 항목 x가 안쪽 여백에서 시작한다");
assert.equal(legendRows.notes[0].x, lg.x + L.SLIDE_LEGEND.padding, "범례 문구 x가 항목과 같은 안쪽 여백에서 시작한다");
assert.equal(legendGeometry.labelX, lg.x + L.SLIDE_LEGEND.padding + L.SLIDE_LEGEND.iconColumn + L.SLIDE_LEGEND.gap, "범례 라벨 시작 x가 아이콘 열·간격 뒤다");
const shortLegend = L.slideLegendRect(2, 0, 5);
const shortLegendW = L.SLIDE_LEGEND.padding * 2 + L.SLIDE_LEGEND.iconColumn + L.SLIDE_LEGEND.gap + 5 * L.SLIDE_LEGEND.labelChar;
assert.ok(shortLegend && shortLegend.w < 2.0, "2항목 짧은 라벨 범례 폭이 기존 2.0in 최소값보다 작다");
assert.ok(shortLegend && Math.abs(shortLegend.w - shortLegendW) < 1e-9, "범례 폭이 padding·아이콘 열·간격·라벨 폭 공식이다");
const firstMap = toTileView(GODEOK_RESULTS[0]).map;
assert.ok(firstMap, "오른쪽 배치 회귀용 지도");
const rightLegend = L.slideLegend(firstMap, true, undefined, true, "wide", { placement: "right" });
assert.ok(rightLegend.rect && rightLegend.rect.x + rightLegend.rect.w <= L.SLIDE.w - L.SLIDE.edge + 1e-9, "오른쪽 배치 범례가 새 폭으로 정렬된다");
// 모든 지도 타일의 범례가 판 안에서 충돌 없이 슬라이드 안에 들어간다
for (const r of GODEOK_RESULTS) {
  const v = toTileView(r);
  if (!v.map) continue;
  const { rect } = L.slideLegend(v.map);
  if (rect) assert.ok(inSlide(rect) && rect.y > s.title.y + s.title.h, `${v.code} 범례가 제목 판을 침범하지 않는다`);
}
// 예약 자리(px)는 지도 이미지(960px 폭) 안
for (const b of L.slideReserved(960 / L.SLIDE.w, { legend: lg })) assert.ok(b.x0 >= 0 && b.x1 <= 960.1 && b.y1 <= 540.1);

console.log("v2 overlay layout tests passed");
