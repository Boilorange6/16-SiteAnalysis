import { citationOf, sourceDetailsFor, type SourceDetailRow, type SourceMeta } from "./source-details";
import type { TileView } from "./tile-view";

export type SourcePanelDetails = {
  calcMethod: string | null;
  rows: SourceDetailRow[];
};

/** source-panel의 순수 행 생성 부분. API 실패 때도 빈 메타로 catalog 이름을 보여 준다. */
export function sourcePanelDetails(view: Pick<TileView, "code" | "tileType" | "sourceRefs">, meta: ReadonlyMap<string, SourceMeta>): SourcePanelDetails {
  return sourceDetailsFor({ code: view.code, tileType: view.tileType, provenance: { sources: view.sourceRefs } }, meta);
}

/** 행 단위 인용문과 모두 복사에 같은 포맷을 사용한다. */
export function sourceCitationText(row: SourceDetailRow): string {
  return citationOf(row);
}

export function sourceCitationsText(rows: readonly SourceDetailRow[]): string {
  return rows.map(sourceCitationText).join("\n");
}
