/** ⑪ 카드 머리 이름: 두 줄까지 접고 넘치면 말줄임, 낱말 중간은 끊지 않는다(화면 = PPT 같은 줄) */
import assert from "node:assert/strict";
import { nameLines } from "../../lib/v2/tile/a05/name-lines.ts";
import { textIn } from "../../lib/v2/report/pptx-kit.ts";

const W = 1.6;
const PT = 8;
assert.deepEqual(nameLines("은마아파트", PT, W), ["은마아파트"], "짧은 이름은 한 줄");
const two = nameLines("은평 푸르지오 발라드 장기일반민간임대주택", PT, W);
assert.equal(two.length, 2, "긴 이름은 두 줄");
assert.ok(two.every((l) => textIn(l, PT) <= W + 1e-9), "두 줄 모두 폭 안");
assert.equal(two.join(" "), "은평 푸르지오 발라드 장기일반민간임대주택", "띄어쓰기에서 끊고 글자는 그대로");
const long = nameLines("가나다라마바사 아자차카타파하 거너더러머버서 어저처커터퍼허 고노도로모보소", PT, W);
assert.equal(long.length, 2, "넘쳐도 두 줄");
assert.ok(long[1].endsWith("…") && textIn(long[1], PT) <= W + 1e-9, "둘째 줄 끝 말줄임");
const noSpace = nameLines("가".repeat(40), PT, W);
assert.equal(noSpace.length, 2, "띄어쓰기 없으면 글자 단위");
assert.ok(noSpace[1].endsWith("…"));
console.log("v2 card name lines ok");
