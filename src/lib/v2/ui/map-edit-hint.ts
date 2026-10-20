const MAP_EDIT_HINT_KEY = "v2.report.mapEditHint";

export function readMapEditHintDismissed(storage: Pick<Storage, "getItem"> | null): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(MAP_EDIT_HINT_KEY) === "dismissed";
  } catch {
    return false;
  }
}

export function dismissMapEditHint(storage: Pick<Storage, "setItem"> | null): void {
  if (!storage) return;
  try {
    storage.setItem(MAP_EDIT_HINT_KEY, "dismissed");
  } catch {
    // 저장소를 쓸 수 없어도 지도 편집은 계속할 수 있다.
  }
}
