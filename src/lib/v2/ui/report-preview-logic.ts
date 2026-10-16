/**
 * PPT 미리보기에서 공유하는 페이지 선택·값 비교·추가 위치 계산.
 *
 * 이 모듈은 React/보드 상태에 의존하지 않는다. UI는 이 함수의 결과를
 * boardReducer 액션으로 변환하고, extra id를 스타일 key로 바꿀 때는
 * board-state의 기존 `extraPageKey`를 사용한다.
 */

export type PageSelectionModifiers = Readonly<{
  /** DOM KeyboardEvent의 modifier 값을 그대로 전달할 수 있다. */
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  /** Ctrl/Meta 토글에 필요한 현재 선택. plan 밖의 key는 무시한다. */
  selectedKeys?: readonly string[];
}>;

export type PageSelectionDirection = -1 | 1;

function orderedKeys(keys: readonly string[]): string[] {
  const seen = new Set<string>();
  return keys.filter((key) => key.length > 0 && !seen.has(key) && (seen.add(key), true));
}

/**
 * 지도 라벨 고정 상태를 순수하게 토글한다.
 *
 * 보드 라벨 또는 페이지 style에서 온 목록을 먼저 현재 순서대로
 * 정규화하고, 이미 있는 key는 모든 중복을 제거하며, 없는 key는 끝에
 * 한 번만 추가한다. 빈 key는 상태를 바꾸지 않는다.
 */
export function togglePinnedKey(currentKeys: readonly string[], key: string): string[] {
  const normalizedKeys = orderedKeys(currentKeys);
  if (key.length === 0) return normalizedKeys;
  return normalizedKeys.includes(key)
    ? normalizedKeys.filter((currentKey) => currentKey !== key)
    : [...normalizedKeys, key];
}

/** 자동 라벨과 고정 라벨을 같은 visible/hidden 상태 기계로 토글한다. */
export function toggleLabelVisibility(
  pinnedKeys: readonly string[],
  hiddenKeys: readonly string[],
  key: string,
  currentlyVisible: boolean,
): { pinnedKeys: string[]; hiddenKeys: string[] } {
  const pinned = orderedKeys(pinnedKeys).filter((candidate) => candidate !== key);
  const hidden = orderedKeys(hiddenKeys).filter((candidate) => candidate !== key);
  if (key.length === 0) return { pinnedKeys: pinned, hiddenKeys: hidden };
  return currentlyVisible
    ? { pinnedKeys: pinned, hiddenKeys: [...hidden, key] }
    : { pinnedKeys: [...pinned, key], hiddenKeys: hidden };
}

/**
 * 범례 강조 상태를 순수하게 토글한다.
 * 같은 항목을 다시 누르면 강조를 해제하고, 다른 항목이면 새 항목을
 * 강조한다.
 */
export function toggleLegendFocus(currentKey: string | null, key: string): string | null {
  return currentKey === key ? null : key;
}

function pageRange(keys: readonly string[], fromKey: string, toKey: string): string[] {
  const from = keys.indexOf(fromKey);
  const to = keys.indexOf(toKey);
  if (to < 0) return [];
  if (from < 0) return [toKey];
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  return keys.slice(start, end + 1);
}

/**
 * 썸네일 클릭 선택을 계산한다.
 *
 * `selectPageKeys(keys, anchorKey, currentKey, modifiers)`
 * - plain: currentKey 한 장만 선택
 * - Ctrl/Meta: modifiers.selectedKeys에서 currentKey를 토글
 * - Shift: anchorKey부터 currentKey까지 inclusive 범위 선택
 *
 * anchorKey가 없거나 plan에 없으면 Shift도 currentKey 한 장으로 안전하게
 * 돌아간다. 함수는 항상 plan 순서로 결과를 반환한다.
 */
export function selectPageKeys(
  keys: readonly string[],
  anchorKey: string | null,
  currentKey: string,
  modifiers: PageSelectionModifiers = {},
): string[] {
  const planKeys = orderedKeys(keys);
  if (!planKeys.includes(currentKey)) return [];

  if (modifiers.shiftKey) {
    return pageRange(planKeys, anchorKey ?? currentKey, currentKey);
  }

  if (modifiers.ctrlKey || modifiers.metaKey) {
    const selected = new Set((modifiers.selectedKeys ?? []).filter((key) => planKeys.includes(key)));
    if (selected.has(currentKey)) selected.delete(currentKey);
    else selected.add(currentKey);
    return planKeys.filter((key) => selected.has(key));
  }

  return [currentKey];
}

/**
 * 키보드 ↑/↓ 이동 결과를 계산한다.
 *
 * `direction`은 위=-1, 아래=+1이다. `extend=false`면 이동한 한 장,
 * `extend=true`면 anchorKey부터 이동한 장까지의 Shift 범위를 반환한다.
 * 목록 끝에서는 currentKey를 유지한다.
 */
export function movePageSelection(
  keys: readonly string[],
  anchorKey: string | null,
  currentKey: string,
  direction: PageSelectionDirection,
  extend: boolean,
): string[] {
  const planKeys = orderedKeys(keys);
  const currentIndex = planKeys.indexOf(currentKey);
  if (currentIndex < 0) return [];
  const nextIndex = Math.max(0, Math.min(planKeys.length - 1, currentIndex + direction));
  const nextKey = planKeys[nextIndex]!;
  return extend ? pageRange(planKeys, anchorKey ?? nextKey, nextKey) : [nextKey];
}

/**
 * 선택된 페이지 속성의 공통값을 반환한다.
 *
 * 빈 배열 또는 모든 값이 undefined이면 fallback을 반환한다. 하나라도
 * 값이 다르면 undefined를 반환하므로, 호출자는 `undefined`를 mixed로
 * 표시하면 된다. null은 유효한 값으로 취급한다.
 */
export function mixedValue<T>(values: readonly T[], fallback: T): T | undefined {
  if (values.length === 0 || values.every((value) => value === undefined)) return fallback;
  const first = values[0];
  return values.every((value) => Object.is(value, first)) ? first : undefined;
}

function encodedTileId(tileId: string): string {
  // 길이 prefix로 tileId 자체의 suffix와 자동 suffix가 충돌하지 않게 한다.
  return `${tileId.length}-${encodeURIComponent(tileId)}`;
}

/**
 * `BoardAction.addPage`에 넘길 unprefixed extra id를 결정적으로 만든다.
 * 같은 tileId를 다시 추가하면 가장 작은 사용 가능 suffix(-2, -3, ...)를
 * 사용한다. existingIds에는 저장 id와 `extra:<id>` key를 모두 받을 수 있다.
 */
export function nextExtraPageId(existingIds: readonly string[], tileId: string): string {
  const base = `preview-${encodedTileId(tileId)}`;
  const used = new Set(existingIds.map((id) => id.startsWith("extra:") ? id.slice("extra:".length) : id));
  if (!used.has(base)) return base;

  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

/**
 * 삽입 요청의 after key를 현재 plan에 맞게 정규화한다.
 * null은 첫 장 앞을 뜻하고, stale/unknown key는 안전한 null로 바꾼다.
 * UI의 '+'가 이미 앞 장 key를 알고 있을 때 addPage의 `after` 값으로 쓴다.
 */
export function pageKeyAfterInsertion(
  planKeys: readonly string[],
  afterKey: string | null,
): string | null {
  if (afterKey === null) return null;
  return planKeys.includes(afterKey) ? afterKey : null;
}
