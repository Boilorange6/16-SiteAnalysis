import { useId, type ReactNode } from "react";
import { LAYER_STYLES, layerStyle, type MapModel } from "@/lib/v2/ui/map-layers";
import { BASEMAP_ATTRIBUTION, makeProjector, metersPerPixel, scaleBar, tilesFor, tileUrl, viewportFor } from "@/lib/v2/ui/map-projection";

/**
 * 지도 그림 하나(SVG). 카드·상세·PPT가 같은 입력으로 같은 그림을 그린다.
 * CSS 모듈을 쓰지 않는다 — 문자열로 직렬화해 PNG로 바꿀 수 있어야 한다.
 */
export type MapFigureProps = {
  model: MapModel;
  width: number;
  height: number;
  /** "none"이면 배경 타일 없이 격자만 (배경을 못 받았을 때) */
  basemap?: "tiles" | "none";
  /** 배경 타일 주소 → 실제 href (PPT용: data URI로 바꿔 넣는다). 반환 undefined면 그 타일은 생략 */
  tileHref?: (url: string) => string | undefined;
  /** true면 범례·문구를 그리지 않는다 (대지 요약 칸) */
  bare?: boolean;
  /** 직렬화용: width/height 속성을 붙인다. 아니면 부모를 채운다 */
  fixed?: boolean;
  label?: string;
};

const FONT = '"Noto Sans KR","Malgun Gothic","Apple SD Gothic Neo",sans-serif';
const INK = "#16181d";

const textW = (s: string, fs: number) => [...s].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x2e80 ? fs : fs * 0.58), 0);
type Box = { x0: number; y0: number; x1: number; y1: number };
const hit = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

export default function MapFigure({ model, width: W, height: H, basemap = "tiles", tileHref, bare, fixed, label }: MapFigureProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const u = Math.min(1.5, Math.max(1, H / 360));
  const vp = viewportFor(model.center, model.radiusM, W, H);
  const proj = makeProjector(vp);
  const mpp = metersPerPixel(model.center[1], vp.zoom);
  const [cx, cy] = [W / 2, H / 2];
  const R = model.radiusM / mpp;

  const tiles = basemap === "tiles" ? tilesFor(vp) : [];
  const grid = scaleBar(mpp, 110 * u).px;

  // 500m 간격 보조 원 (반경 안쪽만)
  const rings: number[] = [];
  for (let m = 500; m < model.radiusM - 1; m += 500) rings.push(m / mpp);

  const feats = model.features.map((f) => ({ f, p: proj(f.lng, f.lat) }));
  const wmax = Math.max(0, ...model.features.map((f) => f.weight ?? 0));
  const radiusOf = (f: MapFigureProps["model"]["features"][number]) => {
    const st = layerStyle(f.layer);
    if (st.sizeBy !== "weight") return (f.highlight ? 4.6 : 2.6) * u;
    const min = 3.2 * u;
    const max = 13 * u;
    return f.weight && wmax > 0 ? min + (max - min) * Math.sqrt(f.weight / wmax) : min;
  };
  const drawn = [...feats].sort((a, b) => {
    const rank = (x: (typeof feats)[number]) => (x.f.highlight ? 2 : x.f.layer === "store:other" ? 0 : 1);
    return rank(a) - rank(b) || (b.f.weight ?? 0) - (a.f.weight ?? 0);
  });

  // 범례 (지물이 있는 레이어만, 정의된 순서)
  const present = Object.keys(LAYER_STYLES).filter((k) => model.features.some((f) => f.layer === k));
  const fs = 10.5 * u;
  const pad = 6 * u;
  const legendMaxW = W - 2 * pad - 56 * u;
  const cut = model.total > model.features.length ? `표시 ${model.features.length.toLocaleString("en-US")} / 전체 ${model.total.toLocaleString("en-US")}` : null;
  const notes = [...model.notes, ...(cut ? [cut] : [])];
  const legendRows: Array<Array<{ layer: string; x: number; w: number }>> = [[]];
  let lx = 0;
  for (const layer of present) {
    const w = 12 * u + textW(layerStyle(layer).label, fs) + 8 * u;
    if (lx + w > legendMaxW && legendRows.at(-1)!.length) {
      legendRows.push([]);
      lx = 0;
    }
    legendRows.at(-1)!.push({ layer, x: lx, w });
    lx += w;
  }
  const rowH = fs * 1.5;
  const legendRowsN = present.length ? legendRows.length : 0;
  const legendW = Math.min(
    legendMaxW,
    Math.max(0, ...legendRows.map((r) => r.reduce((s, i) => s + i.w, 0)), ...notes.map((n) => textW(n, fs * 0.95))) + 2 * pad,
  );
  const legendH = legendRowsN * rowH + notes.length * rowH * 0.95 + (legendRowsN + notes.length ? pad * 1.4 : 0);
  const showLegend = !bare && legendH > 0;
  const boxes: Box[] = showLegend ? [{ x0: pad, y0: pad, x1: pad + legendW, y1: pad + legendH }] : [];
  const site = 6.5 * u;
  boxes.push({ x0: cx - site - 2, y0: cy - site - 2, x1: cx + site + 2, y1: cy + site + 2 });

  // 라벨은 강조 지물만, 겹치면 생략
  const labels: ReactNode[] = [];
  if (!bare) {
    // 강조 지물 라벨이 먼저 자리를 잡고, 나머지(예: 입주 월)는 남는 자리에만 놓는다
    drawn
      .filter((d) => d.f.label)
      .sort((a, b) => Number(!!b.f.highlight) - Number(!!a.f.highlight))
      .forEach((d, i) => {
        const text = d.f.label!;
        const w = textW(text, fs) + 4 * u;
        // 지물 오른쪽 → 왼쪽 → 위 → 아래 순으로 겹치지 않는 자리를 찾는다. 없으면 생략.
        const g = radiusOf(d.f) + 3 * u;
        const spots = [
          { x: d.p[0] + g, y: d.p[1] - fs / 2 },
          { x: d.p[0] - g - w, y: d.p[1] - fs / 2 },
          { x: d.p[0] - w / 2, y: d.p[1] - g - fs - 2 },
          { x: d.p[0] - w / 2, y: d.p[1] + g },
        ];
        const fit = spots
          .map((a) => ({ a, b: { x0: a.x, y0: a.y - 1, x1: a.x + w, y1: a.y + fs + 2 } }))
          .find(({ b }) => b.x0 >= 2 && b.x1 <= W - 2 && b.y0 >= 2 && b.y1 <= H - 2 && !boxes.some((o) => hit(o, b)));
        if (!fit) return;
        const { a: anchor, b } = fit;
        boxes.push(b);
        labels.push(
          <text key={`l${i}`} x={anchor.x + 2 * u} y={anchor.y + fs * 0.85} fontSize={fs} fontWeight={700} fill={INK} stroke="#fff" strokeWidth={3 * u} strokeLinejoin="round" paintOrder="stroke">
            {text}
          </text>,
        );
      });
  }

  const bar = scaleBar(mpp, 88 * u);
  const barY = H - 20 * u;
  const barX1 = W - pad;
  const barX0 = barX1 - bar.px;
  const north = { x: W - 20 * u, y: 22 * u };
  const dim = `M0 0H${W}V${H}H0Z M${cx - R} ${cy}a${R} ${R} 0 1 0 ${2 * R} 0a${R} ${R} 0 1 0 ${-2 * R} 0Z`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      xmlnsXlink="http://www.w3.org/1999/xlink"
      viewBox={`0 0 ${W} ${H}`}
      {...(fixed ? { width: W, height: H } : { width: "100%", height: "100%" })}
      role="img"
      aria-label={label ?? "분석 반경 지도"}
      fontFamily={FONT}
      style={{ display: "block" }}
    >
      <defs>
        <filter id={`s${uid}`}>
          <feColorMatrix type="saturate" values="0.3" />
        </filter>
        <clipPath id={`c${uid}`}>
          <rect width={W} height={H} />
        </clipPath>
      </defs>
      <g clipPath={`url(#c${uid})`}>
        <rect width={W} height={H} fill="#f2f2ef" />
        {basemap === "none" && (
          <g stroke="#dcdde1" strokeWidth={1}>
            {Array.from({ length: Math.ceil(W / grid) + 1 }, (_, i) => (
              <line key={`v${i}`} x1={(cx % grid) + i * grid} y1={0} x2={(cx % grid) + i * grid} y2={H} />
            ))}
            {Array.from({ length: Math.ceil(H / grid) + 1 }, (_, i) => (
              <line key={`h${i}`} x1={0} y1={(cy % grid) + i * grid} x2={W} y2={(cy % grid) + i * grid} />
            ))}
          </g>
        )}
        {/* 표준 지도는 색이 진해 점이 묻히므로 채도를 낮추고 흰 막을 덮는다 */}
        <g filter={`url(#s${uid})`}>
          {tiles.map((t) => {
            const href = tileHref ? tileHref(tileUrl(t)) : tileUrl(t);
            return href ? <image key={`${t.z}/${t.x}/${t.y}`} href={href} x={t.left} y={t.top} width={t.size + 0.6} height={t.size + 0.6} preserveAspectRatio="none" /> : null;
          })}
        </g>
        {tiles.length > 0 && <rect width={W} height={H} fill="#fff" fillOpacity={0.35} />}

        <path d={dim} fillRule="evenodd" fill="#14161c" fillOpacity={0.09} />
        {rings.map((r) => (
          <circle key={r} cx={cx} cy={cy} r={r} fill="none" stroke={INK} strokeOpacity={0.35} strokeWidth={1 * u} strokeDasharray={`${4 * u} ${4 * u}`} />
        ))}
        <circle cx={cx} cy={cy} r={R} fill="none" stroke={INK} strokeOpacity={0.75} strokeWidth={1.6 * u} />

        {drawn.map((d) => {
          if (d.f.highlight && d.f.layer.endsWith("_nearest"))
            return <line key={`n${d.f.layer}`} x1={cx} y1={cy} x2={d.p[0]} y2={d.p[1]} stroke={INK} strokeWidth={1.4 * u} strokeDasharray={`${3 * u} ${3 * u}`} />;
          return null;
        })}
        {drawn.map((d, i) => {
          const st = layerStyle(d.f.layer);
          const r = radiusOf(d.f);
          if (d.p[0] < -r || d.p[1] < -r || d.p[0] > W + r || d.p[1] > H + r) return null;
          const hollow = st.sizeBy === "weight" && !d.f.weight;
          return (
            <circle
              key={i}
              cx={d.p[0]}
              cy={d.p[1]}
              r={r}
              fill={hollow ? "#fff" : st.color}
              fillOpacity={hollow ? 0.6 : st.sizeBy === "weight" ? 0.55 : d.f.highlight ? 1 : 0.85}
              stroke={d.f.highlight ? INK : st.sizeBy === "weight" ? st.color : "#fff"}
              strokeWidth={(d.f.highlight ? 2 : st.sizeBy === "weight" ? 1.4 : 0.8) * u}
            />
          );
        })}
        {labels}

        {/* 대지 표시 */}
        <rect x={cx - site} y={cy - site} width={2 * site} height={2 * site} fill={INK} stroke="#fff" strokeWidth={2.4 * u} />

        {/* 범례·문구 */}
        {showLegend && (
          <g>
            <rect x={pad} y={pad} width={legendW} height={legendH} rx={6 * u} fill="#fff" fillOpacity={0.9} />
            {legendRows.map((row, ri) =>
              row.map((it) => (
                <g key={it.layer}>
                  <circle cx={pad * 1.8 + it.x + 4 * u} cy={pad + pad * 0.7 + ri * rowH + rowH / 2} r={4 * u} fill={layerStyle(it.layer).color} fillOpacity={0.85} />
                  <text x={pad * 1.8 + it.x + 11 * u} y={pad + pad * 0.7 + ri * rowH + rowH * 0.72} fontSize={fs} fill={INK}>
                    {layerStyle(it.layer).label}
                  </text>
                </g>
              )),
            )}
            {notes.map((n, i) => (
              <text key={n} x={pad + pad * 0.8} y={pad + pad * 0.7 + legendRowsN * rowH + i * rowH * 0.95 + rowH * 0.72} fontSize={fs * 0.95} fill="#555a64">
                {n}
              </text>
            ))}
          </g>
        )}

        {/* 북쪽 */}
        <g>
          <circle cx={north.x} cy={north.y} r={13 * u} fill="#fff" fillOpacity={0.9} />
          <path d={`M${north.x} ${north.y - 9 * u}L${north.x + 4.5 * u} ${north.y + 3 * u}L${north.x} ${north.y + 0.5 * u}L${north.x - 4.5 * u} ${north.y + 3 * u}Z`} fill={INK} />
          <text x={north.x} y={north.y + 11 * u} fontSize={7.5 * u} fontWeight={700} textAnchor="middle" fill={INK}>
            N
          </text>
        </g>

        {/* 축척 막대 + 저작권 */}
        <g>
          <rect x={barX0 - 6 * u} y={barY - 14 * u} width={bar.px + 12 * u} height={22 * u} rx={5 * u} fill="#fff" fillOpacity={0.85} />
          <path d={`M${barX0} ${barY - 4 * u}V${barY}H${barX1}V${barY - 4 * u}`} fill="none" stroke={INK} strokeWidth={1.6 * u} />
          <text x={barX0 + bar.px / 2} y={barY - 6 * u} fontSize={9.5 * u} fontWeight={700} textAnchor="middle" fill={INK}>
            {bar.label}
          </text>
          <text x={W - 4 * u} y={H - 4 * u} fontSize={6.6 * u} textAnchor="end" fill="#3b3f47" stroke="#fff" strokeOpacity={0.8} strokeWidth={2 * u} paintOrder="stroke">
            {BASEMAP_ATTRIBUTION}
          </text>
        </g>
      </g>
    </svg>
  );
}
