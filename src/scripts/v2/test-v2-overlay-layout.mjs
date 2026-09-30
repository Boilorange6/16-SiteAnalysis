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
