/**
 * 옛 report 필드를 직접 구성하는 테스트 전용 fixture helper.
 * 새 boardReducer에는 보고서 편집 action이 없지만, v4 저장본과 legacy
 * import 경로는 이 필드를 읽어야 하므로 계획/이관 테스트에서만 사용한다.
 */
export function withLegacyTileState(board, id, patch) {
  const next = { ...board };
  if (Object.prototype.hasOwnProperty.call(patch, "included")) next.included = { ...board.included, [id]: patch.included };
  if (Object.prototype.hasOwnProperty.call(patch, "face")) next.faces = { ...board.faces, [id]: patch.face };
  if (Object.prototype.hasOwnProperty.call(patch, "callout")) next.callout = { ...board.callout, [id]: patch.callout };
  return next;
}

export function withLegacyTileStates(board, entries) {
  return entries.reduce((current, [id, patch]) => withLegacyTileState(current, id, patch), board);
}

export function withLegacyReport(board, report) {
  return {
    ...board,
    report: {
      styles: Object.fromEntries(Object.entries(report.styles ?? {}).map(([key, value]) => [key, structuredClone(value)])),
      extra: (report.extra ?? []).map((page) => ({
        ...page,
        ...(page.sheet ? { sheet: { ...page.sheet, tiles: [...page.sheet.tiles] } } : {}),
      })),
    },
  };
}

export function withLegacyStyle(board, keys, patch) {
  const styles = { ...board.report.styles };
  for (const key of keys) styles[key] = { ...(styles[key] ?? {}), ...structuredClone(patch) };
  return withLegacyReport(board, { ...board.report, styles });
}
