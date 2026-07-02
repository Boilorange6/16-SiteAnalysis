// SlideSpec 1장을 HTML로 렌더한다. 논리 캔버스 1280×720px 위에 절대배치 후
// transform: scale로 요청 폭에 맞춘다. PPT 매퍼와 시각 결과가 일치해야 하므로
// 여기서 디자인을 추가하지 말 것 — 디자인은 slide-builder.ts에서만.
import type { CSSProperties } from "react";
import type { SlideSpec, SlideElement, Fill, Stroke } from "@/lib/slide-spec";
import { PX_W, PX_H, ptToPx, inToPx } from "@/lib/slide-spec";

const FONT = "var(--font-noto), 'Noto Sans KR', sans-serif";
const SHADOW_CSS = "0 4px 10.5px rgba(0,0,0,0.25)"; // PPT outer shadow(blur 8pt, offset 3pt) 근사

function rgba(fill: Fill): string {
  const c = fill.color.replace("#", "");
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${fill.alpha ?? 1})`;
}

function borderOf(stroke: Stroke): string {
  return `${ptToPx(stroke.widthPt)}px ${stroke.dash === "dash" ? "dashed" : "solid"} ${stroke.color}`;
}

function box(x: number, y: number, w: number, h: number): CSSProperties {
  return {
    position: "absolute",
    left: x * PX_W,
    top: y * PX_H,
    width: w * PX_W,
    height: h * PX_H,
  };
}

function ElementView({ el }: { readonly el: SlideElement }) {
  switch (el.kind) {
    case "image":
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={el.dataUrl} alt="" style={{ ...box(el.x, el.y, el.w, el.h), objectFit: "fill" }} />;

    case "rect":
      return (
        <div
          style={{
            ...box(el.x, el.y, el.w, el.h),
            backgroundColor: rgba(el.fill),
            borderRadius: el.radiusIn ? inToPx(el.radiusIn) : 0,
            border: el.stroke ? borderOf(el.stroke) : undefined,
            boxShadow: el.shadow ? SHADOW_CSS : undefined,
          }}
        />
      );

    case "ellipse":
      return (
        <div
          style={{
            ...box(el.cx - el.rx, el.cy - el.ry, el.rx * 2, el.ry * 2),
            backgroundColor: rgba(el.fill),
            borderRadius: "50%",
            border: el.stroke ? borderOf(el.stroke) : undefined,
            boxShadow: el.shadow ? SHADOW_CSS : undefined,
          }}
        />
      );

    case "line": {
      const x1 = el.x1 * PX_W, y1 = el.y1 * PX_H;
      const x2 = el.x2 * PX_W, y2 = el.y2 * PX_H;
      const len = Math.hypot(x2 - x1, y2 - y1);
      const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
      return (
        <div
          style={{
            position: "absolute",
            left: x1,
            top: y1 - ptToPx(el.stroke.widthPt) / 2,
            width: len,
            height: 0,
            borderTop: borderOf(el.stroke),
            transform: `rotate(${angle}deg)`,
            transformOrigin: "0 50%",
          }}
        />
      );
    }

    case "text": {
      const valign = el.valign ?? "top";
      return (
        <div
          style={{
            ...box(el.x, el.y, el.w, el.h),
            display: "flex",
            flexDirection: "column",
            justifyContent: valign === "middle" ? "center" : valign === "bottom" ? "flex-end" : "flex-start",
            fontSize: ptToPx(el.fontSizePt),
            fontFamily: FONT,
            color: el.color,
            fontWeight: el.bold ? 700 : 400,
            textAlign: el.align ?? "left",
            letterSpacing: el.charSpacingPt ? ptToPx(el.charSpacingPt) : undefined,
            backgroundColor: el.fill ? rgba(el.fill) : undefined,
            borderRadius: el.radiusIn ? inToPx(el.radiusIn) : undefined,
            lineHeight: 1.2,
            whiteSpace: "pre-wrap",
            overflow: "hidden",
          }}
        >
          {el.text}
        </div>
      );
    }

    case "table": {
      const cellPad = "3px 6px";
      return (
        <table
          style={{
            position: "absolute",
            left: el.x * PX_W,
            top: el.y * PX_H,
            width: el.w * PX_W,
            borderCollapse: "collapse",
            fontSize: ptToPx(el.fontSizePt),
            fontFamily: FONT,
            color: "#334155",
            tableLayout: "fixed",
          }}
        >
          <colgroup>
            {el.columns.map((c, i) => (
              <col key={i} style={{ width: `${c.wFrac * 100}%` }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {el.columns.map((c, i) => (
                <th
                  key={i}
                  style={{
                    backgroundColor: el.headerFill,
                    color: el.headerColor,
                    textAlign: c.align ?? "left",
                    padding: cellPad,
                    height: inToPx(el.rowHIn),
                    border: "0.7px solid #E2E8F0",
                    fontWeight: 700,
                  }}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {el.rows.map((row, ri) => (
              <tr key={ri} style={el.zebraFill && ri % 2 === 1 ? { backgroundColor: el.zebraFill } : undefined}>
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    style={{
                      textAlign: el.columns[ci].align ?? "left",
                      padding: cellPad,
                      height: inToPx(el.rowHIn),
                      border: "0.7px solid #E2E8F0",
                    }}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    }

    case "chart": {
      const max = Math.max(...el.values, 1);
      const areaH = el.h * PX_H;
      const labelH = 16;
      const valueH = 12;
      const plotH = areaH - labelH - valueH;
      return (
        <div style={{ ...box(el.x, el.y, el.w, el.h), display: "flex", alignItems: "flex-end", gap: 8, fontFamily: FONT }}>
          {el.values.map((v, i) => (
            <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%" }}>
              <div style={{ fontSize: valueH - 2, color: "#334155", marginBottom: 2 }}>{v.toLocaleString()}</div>
              <div data-testid={`chart-bar-${i}`} style={{ width: "60%", height: (v / max) * plotH, backgroundColor: el.color }} />
              <div style={{ fontSize: labelH - 6, color: "#64748B", marginTop: 2, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {el.categories[i]}
              </div>
            </div>
          ))}
        </div>
      );
    }
  }
}

export default function SlideRenderer({ spec, width }: { readonly spec: SlideSpec; readonly width: number }) {
  const scale = width / PX_W;
  return (
    <div style={{ width, height: width * (PX_H / PX_W), overflow: "hidden", position: "relative" }}>
      <div
        data-testid="slide-canvas"
        style={{
          width: PX_W,
          height: PX_H,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          position: "relative",
          backgroundColor: "#FFFFFF",
          overflow: "hidden",
        }}
      >
        {spec.elements.map((el, i) => (
          // kind를 key에 포함해 슬라이드 전환 시 DOM 재사용으로 border/borderTop 스타일이 섞이는 것을 방지
          <ElementView key={`${el.kind}-${i}`} el={el} />
        ))}
      </div>
    </div>
  );
}
