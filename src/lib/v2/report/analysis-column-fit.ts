/**
 * 글 줄 나눔: 폭 width(inch)에 pt로 쓸 때 줄 배열로 나누고 maxLines를 넘으면 마지막 줄을 「…」로 닫는다.
 * 핵심 숫자 카드·범례·해석 줄이 화면과 PPT에서 같은 줄을 그리도록 보이는 문자열 자체를 나눈다(글자 폭 어림은 pptx-kit의 textIn, 10 % 여유).
 */
import { textIn } from "./pptx-kit";

/** 줄 맨 앞에 오면 안 되는 닫는 기호 */
const CLOSING = ")]}」』,.%·:;!?";

/** 줄 나눔(공백 우선, 없으면 글자 단위). starts는 모든 줄의 시작, ends는 마지막 줄을 뺀 줄의 끝(글자 인덱스). */
function lineSpans(chars: string[], pt: number, width: number): { starts: number[]; ends: number[] } {
  const w = Math.max(0.01, width) / 1.1;
  const fits = (from: number, to: number) => textIn(chars.slice(from, to).join(""), pt) <= w;
  const starts: number[] = [0];
  const ends: number[] = [];
  let lastSpace = -1;
  for (let i = 0; i < chars.length; i++) {
    const start = starts[starts.length - 1]!;
    if (chars[i] === " ") lastSpace = i;
    if (fits(start, i + 1)) continue;
    let at = lastSpace > start && chars[i] !== " " ? lastSpace : i; // 공백이 있으면 그 자리에서 줄을 바꾸고, 없으면 글자 단위로
    if (at === start) at = i + 1; // 글자 하나가 폭보다 넓은 극단: 한 줄에 한 글자씩
    while (at > start + 1 && CLOSING.includes(chars[at]!)) at--; // 닫는 괄호·쉼표가 줄 맨 앞에 혼자 남지 않게 앞 글자와 함께 내린다
    ends.push(at);
    starts.push(chars[at] === " " ? at + 1 : at);
    lastSpace = -1;
    i = starts[starts.length - 1]! - 1; // 새 줄 처음부터 다시 잰다
  }
  return { starts, ends };
}

/** 줄 배열로 돌려준다. maxLines를 넘으면 마지막 줄을 …로 닫는다(카드가 줄마다 그리도록). */
export function wrapToLines(text: string, pt: number, width: number, maxLines: number): string[] {
  const chars = [...text.trim()];
  if (chars.length === 0) return [];
  const { starts, ends } = lineSpans(chars, pt, width);
  const line = (i: number) => chars.slice(starts[i]!, i < ends.length ? ends[i]! : chars.length).join("").trimEnd();
  if (starts.length <= maxLines) return starts.map((_, i) => line(i));
  const w = Math.max(0.01, width) / 1.1;
  let last = chars.slice(starts[maxLines - 1]!, ends[maxLines - 1]!);
  while (last.length > 0 && textIn(`${last.join("")}…`, pt) > w) last = last.slice(0, -1);
  return [...Array.from({ length: maxLines - 1 }, (_, i) => line(i)), `${last.join("").trimEnd()}…`];
}
