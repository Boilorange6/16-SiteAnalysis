/** 카드 지도 범례 띠의 스크롤·강조 상태 순수 계약. */
import assert from "node:assert/strict";

const {
  activeLegendLabel,
  legendScrollState,
  legendWheelScrollTarget,
  toggleLegendPin,
} = await import("../../lib/v2/ui/map-legend.ts");

// 세로 휠은 넘치는 띠 안에서만 가로 스크롤로 바뀌고, 끝에서는 페이지 스크롤을 돌려준다.
assert.equal(legendWheelScrollTarget({ scrollLeft: 0, clientWidth: 300, scrollWidth: 900, deltaX: 0, deltaY: 120 }), 120);
assert.equal(legendWheelScrollTarget({ scrollLeft: 240, clientWidth: 300, scrollWidth: 500, deltaX: 0, deltaY: 120 }), null);
assert.equal(legendWheelScrollTarget({ scrollLeft: 0, clientWidth: 300, scrollWidth: 300, deltaX: 0, deltaY: 120 }), null);
assert.equal(legendWheelScrollTarget({ scrollLeft: 80, clientWidth: 300, scrollWidth: 900, deltaX: 0, deltaY: -120 }), 0);
assert.equal(legendWheelScrollTarget({ scrollLeft: 80, clientWidth: 300, scrollWidth: 900, deltaX: 40, deltaY: 0 }), 120);

assert.deepEqual(legendScrollState({ scrollLeft: 0, clientWidth: 300, scrollWidth: 900 }), {
  overflowing: true,
  atStart: true,
  atEnd: false,
  maxScrollLeft: 600,
});
assert.deepEqual(legendScrollState({ scrollLeft: 600, clientWidth: 300, scrollWidth: 900 }), {
  overflowing: true,
  atStart: false,
  atEnd: true,
  maxScrollLeft: 600,
});
assert.deepEqual(legendScrollState({ scrollLeft: 0, clientWidth: 300, scrollWidth: 300 }), {
  overflowing: false,
  atStart: true,
  atEnd: true,
  maxScrollLeft: 0,
});

assert.equal(toggleLegendPin(null, "철도역"), "철도역");
assert.equal(toggleLegendPin("철도역", "철도역"), null);
assert.equal(toggleLegendPin("철도역", "버스정류장"), "버스정류장");
assert.equal(activeLegendLabel(null, "철도역"), "철도역");
assert.equal(activeLegendLabel("버스정류장", "철도역"), "버스정류장");

console.log("v2 map legend strip contracts GREEN");
