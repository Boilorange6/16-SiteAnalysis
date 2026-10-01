## Judge review of the T35 design prototype (apply in T35 implementation)
Accepted: information structure (map | selected card | table), missing-values callout, sort indicators, search + CSV, keyboard hints, selected-feature outline, mobile stacking order.
Fix in implementation:
1. Desktop table cells must not wrap: `white-space: nowrap`, tabular numbers, approval as year (full date in card/CSV), floors "22/B3" compact, area without unit in cells (unit in header "연면적(㎡)"). One line per row (row height ≤ 40 px) so ≥ 12 rows are visible at 1440×900.
2. D28 card source line shows an uninterpolated template (`${number(item.straight)}m`) — never ship raw templates; add a test that rendered text contains no `${`.
3. D28 table "구분" column shows the badge "도보권" on every row — show the stop type (버스 정류장 / 지하철역) instead; badge colour only if it encodes something.
4. Mobile (390 px): the table must switch to a stacked card list (name + 2 key values + chevron) instead of squeezed columns; the selected-feature card must not clip its missing-values note (let it expand / scroll); the header must not truncate controls (no prototype-state select in production).
5. The map in the prototype is schematic; production must use the real MapFigure with all features of the tile, legend from the tile, and the same colour scheme as the board card.
6. Focus: visible 2 px focus ring with ≥ 3:1 contrast on map controls, table rows and CSV; Esc closes and returns focus to the «상세» button.
