/** 설명선 배치를 만드는 순수 계산 (CalloutMap이 쓰고 테스트가 직접 부른다): 프레임 종류·크기·페이지 → 점·카드 자리 */
import { BOARD_TOP, PX, PX_NARROW, STRIP_H, calloutFrame, cardHeight, cardWidth, capacityOf, compactNameNeedsExtraHeight, isMobileWidth, layoutCallouts, pageItems, rowsFor, stripFrame, type CalloutFrame, type Placed } from "./callout-layout";
import { applyView, framedViewport, makeProjector, type MapView } from "./map-projection";
import { OV } from "./overlay-layout";
import type { CalloutModel } from "./tile-view";

export const PANEL_W = 360;
/** 보드 카드 왼쪽 아래 값 판 높이 */
const PILL_H = 32;

export type CalloutFrameKind = "card" | "detail";

export function calloutScene(model: CalloutModel, kind: CalloutFrameKind, W: number, H: number, page: number, sourceInset: number = OV.stripH, view?: MapView) {
  const detail = kind === "detail";
  const mobile = isMobileWidth(W);
  // 모바일 펼침: 좌우 칸 대신 지도 아래(시트 위)에 가로 띠 카드. 모든 페이지에서 같은 자리를 비워 두어 지도 범위가 변하지 않는다
  const strip = detail && mobile;
  const panel = detail && W > 720 ? PANEL_W + OV.edge : 0;
  const top = detail ? OV.edge + 34 + 6 + 32 + 8 : OV.edge; // 카드는 머리·출처가 지도 밖이라 위쪽 칩 자리를 비우지 않는다
  const sheetTop = H - sourceInset - OV.edge - (0.4 * H + 20);
  const stripTop = sheetTop - 8 - STRIP_H;
  const bottom = detail ? (strip ? stripTop - 6 : H - sourceInset - OV.edge + (mobile ? -(0.4 * H + 20) : 0)) : H - 8;
  const candidates = !detail ? model.complexes.slice(0, BOARD_TOP) : page === 0 ? model.complexes : pageItems(model.complexes, page);
  const candidateCards = page !== 0 || !detail ? candidates : [];
  const rows = rowsFor(candidateCards);
  const perSide = detail ? 5 : 3;
  const m = mobile ? PX_NARROW : PX;
  // 아래에서 올라오는 시트가 덮는 만큼을 뺀 지도 영역의 세로 가운데에 반경 원을 둔다
  const sheet = detail && mobile;
  const siteY = sheet ? (top + bottom) / 2 / H : 0.5;
  const maxFill = sheet ? Math.min(0.8, (0.9 * (bottom - top)) / H) : detail ? 0.8 : Math.max(0.3, (H - 14) / H);
  const spec = { W, H, m, edge: mobile ? 8 : OV.edge, top, bottom, leftBottom: detail ? undefined : bottom - PILL_H - 6, rightInset: panel, perSide, rows, maxFill, minDiameter: !detail && mobile && W >= 360 ? 132 : undefined };
  // 세로 여유가 되면 4행 카드, 아니면 이름+세대수 2줄 카드
  const fullNameWrap = detail && !mobile && candidateCards.some((c) => compactNameNeedsExtraHeight(c, model.complexes, cardWidth(m, "full", W)));
  const fullFits = detail && !mobile && (bottom - top + m.gap) >= perSide * (cardHeight(m, "full", rows, fullNameWrap) + m.gap) - 1e-6;
  const variant = fullFits ? "full" : "compact";
  const compactNameWrap = !strip && variant === "compact" && candidateCards.some((c) => compactNameNeedsExtraHeight(c, model.complexes, cardWidth(m, variant, W)));
  const frame: CalloutFrame = strip
    ? stripFrame(W, H, m, top, bottom)
    : calloutFrame({ ...spec, variant, compactNameWrap });
  // 보드의 번호 점은 실제로 카드가 놓일 수 있는 수까지만 만든다. 그래야
  // 번호가 있는데 카드가 없는 점(특히 195px 높이 compact 프레임)이 남지 않는다.
  const boardCapacity = !detail && !strip ? Math.min(BOARD_TOP, capacityOf(frame.left, frame) + capacityOf(frame.right, frame)) : BOARD_TOP;
  const numbered = detail ? candidates : candidates.slice(0, boardCapacity);
  const withCards = page !== 0 || !detail ? numbered : [];
  const baseVp = framedViewport(model.center, model.radiusM, W, H, frame.siteX, frame.fill, siteY);
  const vp = applyView(baseVp, model.center[1], view);
  const proj = makeProjector(vp);
  const hMax = Math.max(0, ...model.complexes.map((c) => c.households ?? 0));
  const pos = new Map(model.complexes.map((c) => [c.id, proj(c.lng, c.lat)]));
  const visible = (items: readonly typeof model.complexes[number][]) => view
    ? items.filter((complex) => {
        const point = pos.get(complex.id);
        return point && point[0] >= 0 && point[0] <= W && point[1] >= 0 && point[1] <= H;
      })
    : [...items];
  const visibleNumbered = visible(numbered);
  const visibleWithCards = visible(withCards);
  const otherPts = model.others.map((o) => proj(o.lng, o.lat));
  const { placed, overflow } = strip
      ? { placed: [] as Placed[], overflow: [] as string[] } // 띠 모드: 지시선 없음
      : layoutCallouts(
          frame,
          visibleWithCards.map((c) => ({ id: c.id, rank: c.rank, x: pos.get(c.id)![0], y: pos.get(c.id)![1] })),
        );
  return { frame, pos, otherPts, hMax, placed, overflow, numbered: visibleNumbered, withCards: visibleWithCards, panel, siteY, strip, stripTop };
}
