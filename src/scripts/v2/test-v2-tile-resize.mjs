/** v2 타일 크기 핸들의 순수 판정·경계·접근성/포인터 계약. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { sizeFromDrag } = await import("../../components/v2/use-tile-resize.ts");
const resizeSource = readFileSync(new URL("../../components/v2/use-tile-resize.ts", import.meta.url), "utf8");
const tileCardSource = readFileSync(new URL("../../components/v2/tile-card.tsx", import.meta.url), "utf8");
const boardCss = readFileSync(new URL("../../components/v2/board.module.css", import.meta.url), "utf8");

const cellW = 100;
const rowH = 80;
const base = { dx: 0, dy: 0, side: "right", cellW, rowH, start: 1 };
const size = (overrides) => sizeFromDrag({ ...base, ...overrides });

// 오른쪽 핸들: 정확히 절반부터 확장 임계값을 충족한다.
assert.equal(size({ dx: cellW / 2 - 0.01 }), 1, "가로 확장 임계 미만은 1칸 유지");
assert.equal(size({ dx: cellW / 2 }), 2, "가로 확장 경계는 2칸");
assert.equal(size({ dx: cellW / 2, dy: rowH / 2 - 0.01 }), 2, "세로 확장 임계 미만은 2칸");
assert.equal(size({ dx: cellW / 2, dy: rowH / 2 }), 4, "가로·세로 확장 경계는 4칸");
assert.equal(size({ dx: cellW / 2 + 20, dy: rowH / 2 + 20 }), 4, "확장량이 더 커져도 4칸 상한");
assert.equal(size({ start: 4, dx: cellW / 2, dy: rowH / 2 }), 4, "4칸에서 확장은 4칸 유지");

// 오른쪽 핸들: 4→2는 세로만, 2→1은 가로만, 두 축은 4→1이다.
assert.equal(size({ start: 4, dy: -rowH / 2 + 0.01 }), 4, "세로 축소 임계 미만은 4칸 유지");
assert.equal(size({ start: 4, dy: -rowH / 2 }), 2, "4→2 세로 축소 경계");
assert.equal(size({ start: 4, dx: cellW / 2, dy: 0 }), 4, "4칸에서 가로 바깥 이동은 상한 유지");
assert.equal(size({ start: 4, dx: -cellW / 2, dy: 0 }), 4, "4칸의 가로만 축소는 지원 크기 변화 없음");
assert.equal(size({ start: 4, dx: -cellW / 2, dy: -rowH / 2 }), 1, "4→1 양쪽 축소 경계");
assert.equal(size({ start: 2, dx: -cellW / 2 + 0.01 }), 2, "2→1 가로 축소 임계 미만은 유지");
assert.equal(size({ start: 2, dx: -cellW / 2 }), 1, "2→1 가로 축소 경계");
assert.equal(size({ start: 2, dy: -rowH / 2 }), 2, "2칸의 세로만 축소는 유지");
assert.equal(size({ start: 1, dx: -cellW / 2, dy: -rowH / 2 }), 1, "1칸은 더 줄지 않음");

// 왼쪽 핸들: 수평 부호를 반전하므로 바깥쪽(-dx)이 확장, 안쪽(+dx)이 축소다.
assert.equal(size({ side: "left", dx: -cellW / 2 - 0.01 }), 2, "왼쪽 핸들의 바깥쪽 확장");
assert.equal(size({ side: "left", dx: -cellW / 2 + 0.01 }), 1, "왼쪽 핸들의 확장 임계 미만");
assert.equal(size({ side: "left", start: 2, dx: cellW / 2 - 0.01 }), 2, "왼쪽 핸들의 축소 임계 미만");
assert.equal(size({ side: "left", start: 2, dx: cellW / 2 }), 1, "왼쪽 핸들의 2→1 축소 경계");
assert.equal(size({ side: "left", start: 4, dx: cellW / 2, dy: -rowH / 2 }), 1, "왼쪽 핸들의 4→1 양쪽 축소");

// 함수는 입력을 변경하지 않는다.
const input = { ...base, dx: 50, dy: 40 };
const snapshot = { ...input };
assert.equal(sizeFromDrag(input), 4, "순수 함수 결과");
assert.deepEqual(input, snapshot, "순수 함수는 입력 객체를 변경하지 않음");

// 훅의 통합 계약: pointer capture, Esc 취소, 44px hit area와 키보드 대안.
assert.match(resizeSource, /setPointerCapture\(/, "pointer capture를 시작해야 함");
assert.match(resizeSource, /releasePointerCapture\(/, "pointer capture를 해제해야 함");
assert.match(resizeSource, /event\.key === "Escape"/, "Esc 취소 경로가 있어야 함");
assert.match(resizeSource, /TILE_RESIZE_HANDLE_MIN_SIZE = 44/, "핸들 hit area는 44px이어야 함");
assert.match(resizeSource, /aria-keyshortcuts/, "키보드 대안을 접근성 API에 노출해야 함");

// 카드 미리보기는 현재 카드의 시작점/끝점을 기준으로 16px grid gap을 포함한 목표 span을 그린다.
assert.match(tileCardSource, /const BOARD_GRID_GAP = 16/, "미리보기는 보드의 16px gap 계약을 사용");
assert.match(tileCardSource, /p\.cellW \* previewColumns \+ BOARD_GRID_GAP \* \(previewColumns - 1\)/, "가로 미리보기는 cellW와 열 사이 gap을 계산");
assert.match(tileCardSource, /p\.rowH \* previewRows \+ BOARD_GRID_GAP \* \(previewRows - 1\)/, "세로 미리보기는 rowH와 행 사이 gap을 계산");
assert.match(tileCardSource, /resizePreview\?\.side === "left" \? currentWidth - previewWidth : 0/, "왼쪽 핸들은 현재 카드의 오른쪽 모서리를 고정");
assert.match(tileCardSource, /style=\{\{ width: previewWidth, height: previewHeight, left: previewLeft, top: 0 \}\}/, "오른쪽 핸들은 카드 시작점에서 미리보기를 그림");
assert.match(tileCardSource, /data-resize-target-size=\{resizePreview\.size\}/, "미리보기 목표 칸 수를 DOM에 노출");
assert.match(boardCss, /\.grid\s*\{[\s\S]*?overflow:\s*visible;/, "그리드는 리사이즈 미리보기를 자르지 않음");
assert.match(boardCss, /\.tile\s*\{[\s\S]*?overflow:\s*visible;/, "카드는 리사이즈 미리보기를 자르지 않음");

console.log("v2 tile resize contracts ok");
