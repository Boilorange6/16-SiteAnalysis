import type { CSSProperties } from "react";

/** 슬라이드 글자 크기(pt)를 화면 px로. unit은 슬라이드 1 inch가 차지하는 px다. */
export function fontStyle(pt: number, unit: number, extra: CSSProperties = {}): CSSProperties {
  // 슬라이드 축소본이므로 글자도 배치와 같은 비율로 줄인다(하한을 두면 좁은 화면에서 줄이 겹친다).
  return { ...extra, fontSize: (pt / 72) * unit };
}
