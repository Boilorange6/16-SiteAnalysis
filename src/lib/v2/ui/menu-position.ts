export type FloatingMenuRect = {
  top: number;
  left: number;
  right: number;
  bottom: number;
};

export type FloatingMenuSize = {
  width: number;
  height: number;
};

export type FloatingViewport = {
  width: number;
  height: number;
};

export type FloatingMenuPosition = {
  top: number;
  left: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/**
 * Place a fixed-position menu next to its trigger without letting it leave the
 * viewport. The menu prefers below/right-aligned, then flips above when the
 * trigger is close to the bottom edge.
 */
export function floatingMenuPosition(
  trigger: FloatingMenuRect,
  menu: FloatingMenuSize,
  viewport: FloatingViewport,
  gap = 6,
  edge = 8,
): FloatingMenuPosition {
  const maxLeft = Math.max(edge, viewport.width - menu.width - edge);
  const maxTop = Math.max(edge, viewport.height - menu.height - edge);
  const left = clamp(trigger.right - menu.width, edge, maxLeft);
  const below = trigger.bottom + gap + menu.height <= viewport.height - edge;
  const above = trigger.top - gap - menu.height >= edge;
  const preferredTop = below
    ? trigger.bottom + gap
    : above
      ? trigger.top - gap - menu.height
      : trigger.bottom + gap;
  return {
    top: Math.round(clamp(preferredTop, edge, maxTop)),
    left: Math.round(left),
  };
}
