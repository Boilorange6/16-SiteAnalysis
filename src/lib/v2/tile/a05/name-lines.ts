import { textIn } from "../../report/pptx-kit";

/**
 * 카드 머리 이름 줄 나눔: 띄어쓰기에서 먼저 끊고(낱말 중간은 끊지 않음, 한 낱말이 폭보다 길면 글자 단위),
 * maxLines를 넘으면 마지막 줄 끝을 말줄임(…)으로 줄인다. 화면과 PPT가 같은 줄을 그리도록 자동 줄바꿈에 기대지 않는다.
 */
export function nameLines(value: string, pt: number, width: number, maxLines = 2): string[] {
  const fits = (s: string) => textIn(s, pt) <= width + 1e-9;
  const lines: string[] = [];
  let cur = "";
  const push = () => { if (cur) lines.push(cur); cur = ""; };
  for (const word of value.split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${word}` : word;
    if (fits(next)) { cur = next; continue; }
    push();
    if (fits(word)) { cur = word; continue; }
    for (const ch of word) {
      if (cur && !fits(cur + ch)) push();
      cur += ch;
    }
  }
  push();
  if (lines.length <= maxLines) return lines.length ? lines : [value];
  let last = [...lines.slice(maxLines - 1).join(" ")];
  while (last.length > 1 && !fits(`${last.join("")}…`)) last.pop();
  return [...lines.slice(0, maxLines - 1), `${last.join("").trimEnd()}…`];
}
