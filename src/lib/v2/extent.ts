// Math.min(...xs)는 실데이터(수십만 점·격자 셀)에서 호출 스택을 넘긴다. 빈 배열은 Math.min()처럼 ±Infinity.
export function minOf(values: Iterable<number>): number {
  let min = Infinity;
  for (const value of values) if (value < min) min = value;
  return min;
}

export function maxOf(values: Iterable<number>): number {
  let max = -Infinity;
  for (const value of values) if (value > max) max = value;
  return max;
}
