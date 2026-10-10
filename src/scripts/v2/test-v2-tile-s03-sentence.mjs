import assert from "node:assert/strict";

const { formatWindJudgmentSentence } = await import("../../lib/v2/engine/wind-api.ts");

const sentence = formatWindJudgmentSentence("annual", { deg: 225, name: "SW" }, 0.84, 12.5, 4.1);
assert.match(sentence, /연간 주풍향 남서\(SW\) 유입/);
assert.match(sentence, /상대풍속 중앙값 0\.84 U\/U유입/);
assert.match(sentence, /1\.5 이상 12\.5%/);
assert.match(sentence, /0\.2 미만 정체 4\.1%/);
assert.doesNotMatch(sentence, /annual|1\.2 이상/);

console.log("✓ v2 S03 Korean season/direction/unit sentence");
