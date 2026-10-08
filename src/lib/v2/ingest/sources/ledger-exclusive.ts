/**
 * 건축물대장 전유공용면적 월간 전국 ZIP의 전유부 스트리밍 리더.
 *
 * 압축 해제하면 수십 GB가 되므로 tar.exe의 stdout만 소비한다. 이 모듈은
 * ZIP을 디스크에 풀거나 행을 배열로 모으지 않는다.
 */
import { once } from "node:events";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { join } from "node:path";
import type { MeasureRecord } from "../../a0/measure";

export const LEDGER_EXCLUSIVE_ENTRY = "mart_djy_06.txt";

/** mart_djy_06.txt는 헤더 없는 | 구분 39열이다. */
export const LEDGER_EXCLUSIVE_FIELDS = [
  "관리_건축물대장_PK", "대장_구분_코드", "대장_구분_코드_명", "대장_종류_코드", "대장_종류_코드_명",
  "대지_위치", "도로명_대지_위치", "건물_명", "시군구_코드", "법정동_코드", "대지_구분_코드", "번", "지",
  "특수지_명", "블록", "로트", "새주소_도로_코드", "새주소_법정동_코드", "새주소_지상지하_코드",
  "새주소_본_번", "새주소_부_번", "동_명", "호_명", "층_구분_코드", "층_구분_코드_명",
  "층_번호", "전유_공용_구분_코드", "전유_공용_구분_코드_명", "주_부속_구분_코드", "주_부속_구분_코드_명", "층_번호_명",
  "구조_코드", "구조_코드_명", "기타_구조", "주_용도_코드", "주_용도_코드_명", "기타_용도", "면적(㎡)", "생성_일자",
] as const;

function tarCommand(): string {
  return process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
}

function recordOf(line: string): MeasureRecord | null {
  const cells = line.endsWith("\r") ? line.slice(0, -1).split("|") : line.split("|");
  if (cells.length === 0 || cells.every((cell) => cell === "")) return null;
  const properties = Object.fromEntries(LEDGER_EXCLUSIVE_FIELDS.map((field, index) => [field, cells[index] ?? ""]));
  return { properties, point: null };
}

export function ledgerExclusiveRecordsFromZip(zipPath: string): AsyncIterable<MeasureRecord> {
  return (async function* stream(): AsyncGenerator<MeasureRecord> {
    const child = spawn(tarCommand(), ["-xOf", zipPath, LEDGER_EXCLUSIVE_ENTRY], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let processError: Error | null = null;
    child.once("error", (error) => { processError = error instanceof Error ? error : new Error(String(error)); });
    child.stderr?.resume();
    child.stdout?.setEncoding("utf8");
    const lines = createInterface({ input: child.stdout!, crlfDelay: Infinity });
    const closed = once(child, "close") as Promise<[number | null, NodeJS.Signals | null]>;
    try {
      for await (const line of lines) {
        const record = recordOf(line);
        if (record) yield record;
      }
    } finally {
      lines.close();
      if (child.exitCode === null && !child.killed) child.kill();
    }
    const [code] = await closed;
    if (processError) throw processError;
    if (code !== 0) throw new Error(`ledger exclusive ZIP stream failed: tar exit ${String(code)}`);
  })();
}
