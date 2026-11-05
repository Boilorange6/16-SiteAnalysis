import assert from "node:assert/strict";

const { boundaryLoops } = await import("../../lib/v2/engine/tiles/canopy-shared.ts");

// Reference: original string-key boundary traversal, including its start and turn order.
function reference(grid, radius) {
  const key = ({ col, row }) => `${col},${row}`;
  const point = (s) => { const [col, row] = s.split(",").map(Number); return { col, row }; };
  const direction = (a, b) => b.col > a.col ? 0 : b.row > a.row ? 1 : b.col < a.col ? 2 : 3;
  const edges = new Map();
  function add(a, b) {
    const start = key(a), list = edges.get(start) ?? [];
    list.push({ start, end: key(b), direction: direction(a, b) }); edges.set(start, list);
  }
  const filled = (col, row) => col >= 0 && row >= 0 && col < grid.cols && row < grid.rows
    && Math.hypot(grid.x0 + col * grid.cellM - grid.cx, grid.y0 + row * grid.cellM - grid.cy) <= radius + grid.cellM * .75
    && grid.values[row * grid.cols + col] >= .5;
  for (let row = 0; row < grid.rows; row++) for (let col = 0; col < grid.cols; col++) {
    if (!filled(col, row)) continue;
    if (!filled(col, row - 1)) add({ col, row }, { col: col + 1, row });
    if (!filled(col + 1, row)) add({ col: col + 1, row }, { col: col + 1, row: row + 1 });
    if (!filled(col, row + 1)) add({ col: col + 1, row: row + 1 }, { col, row: row + 1 });
    if (!filled(col - 1, row)) add({ col, row: row + 1 }, { col, row });
  }
  const cmp = (a, b) => a.direction - b.direction || a.end.localeCompare(b.end);
  const used = new Set(), id = (e) => e.start + ">" + e.end;
  const starts = [...edges.values()].flat().sort((a,b) => a.start.localeCompare(b.start) || cmp(a,b));
  const loops = [];
  for (const first of starts) {
    if (used.has(id(first))) continue;
    const points = [point(first.start)]; let edge = first;
    while (edge && !used.has(id(edge))) {
      used.add(id(edge)); points.push(point(edge.end));
      if (edge.end === first.start) break;
      const wanted = [(edge.direction + 3) % 4, edge.direction, (edge.direction + 1) % 4, (edge.direction + 2) % 4];
      edge = (edges.get(edge.end) ?? []).filter((e) => !used.has(id(e))).sort((a,b) => wanted.indexOf(a.direction) - wanted.indexOf(b.direction) || cmp(a,b))[0];
    }
    if (points.length >= 4 && key(points[0]) === key(points.at(-1))) {
      let area = 0;
      for (let i = 1; i < points.length; i++) area += points[i-1].col * points[i].row - points[i].col * points[i-1].row;
      loops.push({points, signedArea: area / 2});
    }
  }
  return loops;
}

let seed = 271828;
for (let sample = 0; sample < 80; sample++) {
  const cols = 3 + sample % 17, rows = 4 + sample % 15;
  const values = new Float64Array(cols * rows);
  for (let i = 0; i < values.length; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; values[i] = seed % 7 === 0 ? NaN : (seed >>> 8) % 3 === 0 ? 1 : 0; }
  if (sample === 0) values.fill(1);
  const grid = { cx: cols / 2, cy: rows / 2, x0: 0, y0: 0, cols, rows, cellM: 1, values };
  const radius = sample % 2 ? Math.max(cols, rows) : Math.min(cols, rows) / 2;
  assert.deepEqual(boundaryLoops(grid, radius), reference(grid, radius), `boundary case ${sample}`);
}
console.log("✓ canopy integer boundary matches original string-key loops");
