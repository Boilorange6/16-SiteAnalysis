/**
 * tile_result 계약 테스트 (spec §5.2).
 * 화면·PPT·DXF가 모두 이 결과에서 나온다. 여기서 "모름"을 0으로, 미완료를 완료로 통과시키면
 * 모든 출력이 조용히 틀린다.
 */
import assert from "node:assert/strict";

const { parseTileResult, tileCacheKey } = await import("../../lib/v2/tile-result.ts");

const HASH = "a".repeat(64);
const valid = () => ({
  tileId: "t1",
  analysisId: "a1",
  tileType: "analysis",
  tileCode: "A01",
  status: "complete",
  engineVersion: "v2-p0",
  conditions: {
    address: "서울특별시 강남구 개포동",
    center: [127.0592, 37.4869],
    radiusM: 800,
    analysisDate: "2026-09-29",
    timezone: "Asia/Seoul",
    filters: {},
    simulation: null,
    parcelSnapshotHash: null,
  },
  metrics: [
    { id: "nearest_station_m", label: "최근접 역 출입구", value: 420, unit: "m", formulaVersion: "a01-nearest@1", numerator: null, denominator: null, status: "observed" },
    { id: "bus_routes", label: "버스 노선 수", value: null, unit: "개", formulaVersion: "a01-routes@1", numerator: null, denominator: null, status: "missing" },
  ],
  judgment: { ruleId: "A01-rail-distance@1", basisMetricIds: ["nearest_station_m"], sentence: "철도 접근은 가까운 편이다(직선 420m, 내부 제안 기준).", level: "good" },
  presentation: { legend: [], camera: null, layers: ["station"], outputFace: "front" },
  provenance: { manifestHash: HASH, sources: [{ sourceId: "rail", releaseId: "r1", sourceAsOf: "2026-09-01", fetchedAt: "2026-09-29T00:00:00+09:00" }] },
  limitations: [{ kind: "unknown", note: "버스 노선 연결 미확보" }],
});

// 정상
assert.equal(parseTileResult(valid()).tileCode, "A01");

const rejects = (mutate, why) => {
  const v = valid();
  mutate(v);
  assert.throws(() => parseTileResult(v), undefined, why);
};

rejects((v) => { v.metrics[0].value = null; }, "observed인데 값 없음");
rejects((v) => { v.metrics[1].value = 0; }, "missing인데 값 0");
rejects((v) => { v.provenance.sources = []; }, "complete인데 출처 없음");
rejects((v) => { v.conditions.analysisDate = "2026-9-29"; }, "기준일 형식");
rejects((v) => { v.conditions.timezone = "UTC"; }, "시간대 고정");
rejects((v) => { v.provenance.manifestHash = "abc"; }, "manifest 해시 형식");
rejects((v) => { v.judgment.basisMetricIds = ["bus_routes"]; }, "근거 지표가 missing이면 등급 금지");
rejects((v) => { v.judgment.basisMetricIds = ["nope"]; }, "없는 지표를 근거로 삼음");
rejects((v) => { v.presentation.outputFace = "flipped"; }, "출력 면");
rejects((v) => { v.conditions.radiusM = 0; }, "반경 0");

// 등급 없는 판단(사실 문장)은 근거가 missing이어도 허용
{
  const v = valid();
  v.judgment = { ruleId: "A06-fact@1", basisMetricIds: ["bus_routes"], sentence: "노선 연결은 미확인이다.", level: null };
  assert.equal(parseTileResult(v).judgment.level, null);
}

// 실패 타일은 출처 없이도 허용
{
  const v = valid();
  v.status = "failed";
  v.provenance.sources = [];
  v.judgment = null;
  assert.equal(parseTileResult(v).status, "failed");
}

// 캐시 키
{
  const base = { tileCode: "A01", manifestHash: HASH, engineVersion: "v2-p0", conditions: valid().conditions };
  const k = tileCacheKey(base);
  assert.match(k, /^[0-9a-f]{64}$/);
  assert.equal(tileCacheKey({ ...base, conditions: { ...base.conditions, filters: {} } }), k, "같은 조건은 같은 키");
  assert.notEqual(tileCacheKey({ ...base, conditions: { ...base.conditions, analysisDate: "2026-09-30" } }), k, "기준일이 바뀌면 다른 키");
  assert.notEqual(tileCacheKey({ ...base, manifestHash: "b".repeat(64) }), k, "데이터 버전");
  assert.notEqual(tileCacheKey({ ...base, conditions: { ...base.conditions, parcelSnapshotHash: "c".repeat(64) } }), k, "최신 필지 스냅샷");
}

console.log("✓ v2 tile result");
