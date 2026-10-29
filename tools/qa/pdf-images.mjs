// PDF 안의 DCTDecode(JPEG) 이미지 스트림을 순서대로 꺼낸다. node pdf-images.mjs <file.pdf> <outDir> [n1,n2,...]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const [file, out, pick] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const buf = readFileSync(file);
const text = buf.toString("latin1");
const want = pick ? new Set(pick.split(",").map(Number)) : null;
let i = 0, n = 0;
const sizes = [];
while ((i = text.indexOf("/DCTDecode", i)) >= 0) {
  const s = text.indexOf("stream", i);
  const start = s + (text[s + 6] === "\r" ? 8 : 7);
  const end = text.indexOf("endstream", start);
  n++;
  const bytes = buf.subarray(start, end);
  sizes.push(bytes.length);
  if (!want || want.has(n)) writeFileSync(`${out}/img${n}.jpg`, bytes);
  i = end;
}
console.log("jpeg streams", n, "sizes(KB)", sizes.map((b) => Math.round(b / 1024)).join(","));
