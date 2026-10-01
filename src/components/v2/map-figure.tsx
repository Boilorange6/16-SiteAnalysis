import { useId, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { layerStyle, legendItems, type MapModel } from "@/lib/v2/ui/map-layers";
import { BASEMAP_ATTRIBUTION, BASEMAP_STACK, framedViewport, makeProjector, metersPerPixel, scaleBar, tilesFor, tileUrl, worldPx, type BasemapChoice } from "@/lib/v2/ui/map-projection";
import { rasterAffine } from "@/lib/v2/ui/raster-image";
import type { RasterRef } from "@/lib/v2/tile-result";

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
  /** 배경지도 종류 (기본 일반=white). 항공은 위성 사진 위에 글자 레이어를 겹친다 */
  layer?: BasemapChoice;
  /** 배경 타일 주소 → 실제 href (PPT용: data URI로 바꿔 넣는다). 반환 undefined면 그 타일은 생략 */
  tileHref?: (url: string) => string | undefined;
  /** 결과 래스터 이름 → 압축 해제·팔레트 처리한 이미지 data URL (MapBox/PPT가 주입) */
  rasterHref?: (ref: RasterRef) => string | null;
  /** true면 범례·문구를 그리지 않는다 (대지 요약 칸) */
  bare?: boolean;
  /** 직렬화용: width/height 속성을 붙인다. 아니면 부모를 채운다 */
  fixed?: boolean;
  label?: string;
  /** 몰입형: 범례를 그리지 않는다 (기본은 bare가 아니면 그림). 색 의미는 강조 라벨·바깥 판이 전달한다 */
  legend?: boolean;
  /** 범례 위쪽 위치(px). 제목 칩 아래에 놓을 때 */
  legendY?: number;
  /** 북쪽 표시의 중심 y(px). false면 그리지 않는다 (보고서 칩 아래에 놓거나 슬라이드에서는 생략) */
  north?: number | false;
  /** 축척 막대 (기본 그림) */
  scale?: boolean;
  /** 그림 안 저작권 글자. 출처 띠가 대신하면 false */
  credit?: boolean;
  /** 맨 아래 출처 띠가 덮는 높이(px). 축척 막대가 그 위에 놓인다 */
  bottomInset?: number;
  /** 오버레이가 덮는 자리 — 강조 라벨이 피한다 */
  avoid?: Array<{ x0: number; y0: number; x1: number; y1: number }>;
  /** 대지 중심의 가로 위치(0~1, 기본 0.5). 오른쪽에 정보 판이 있으면 왼쪽으로 옮긴다 */
  siteX?: number;
  /** 흐리게(흑백+번짐): 상태 화면 배경 */
  muted?: boolean;
  /** 오른쪽에 떠 있는 정보 판의 폭(px): 북쪽·축척이 그 왼쪽에 놓인다 */
  rightInset?: number;
  /** 축척을 왼쪽 아래에 (펼침) */
  scaleLeft?: boolean;
  /** 반경 원 지름 / 그림 높이 (기본 0.8). 설명선 칸 사이에 원을 넣을 때 줄인다 */
  fill?: number;
  /** 축척 막대 왼쪽 끝 x(px). 지정하면 rightInset·scaleLeft 대신 이 자리에 놓는다 (설명선 칸 사이) */
  scaleX?: number;
  /** 대지 중심의 세로 위치(0~1, 기본 0.5). 아래에서 올라오는 시트가 있으면 위로 옮긴다 */
  siteY?: number;
  /** 상세 창에서 행/지도 선택을 같은 fid로 강조한다. */
  selectedFids?: readonly string[];
  /** 상세 창의 보행 경로 등 WGS84 경로선. */
  path?: Array<[number, number]>;
  /** 점·면·선 지물을 클릭하거나 Enter/Space로 선택했을 때의 좌표. */
  onFeatureClick?: (feature: { fid?: string; lng: number; lat: number; kind: "feature" | "polygon" | "line" }) => void;
  /** 래스터 지점처럼 별도 벡터 지물이 없는 곳을 클릭했을 때의 WGS84 좌표. */
  onMapClick?: (coordinate: { lng: number; lat: number }) => void;
};

export type MapFigurePick = NonNullable<MapFigureProps["onFeatureClick"]> extends (feature: infer T) => void ? T : never;

const FONT = '"Noto Sans KR","Malgun Gothic","Apple SD Gothic Neo",sans-serif';
const INK = "#16181d";

const textW = (s: string, fs: number) => [...s].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x2e80 ? fs : fs * 0.58), 0);
type Box = { x0: number; y0: number; x1: number; y1: number };
const hit = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

export default function MapFigure({ model, width: W, height: H, basemap = "tiles", layer = "white", tileHref, rasterHref, bare, fixed, label, legend, legendY, north: northOpt, scale = true, credit = true, bottomInset = 0, avoid = [], siteX = 0.5, muted, rightInset = 0, scaleLeft, fill = 0.8, scaleX, siteY = 0.5, selectedFids = [], path = [], onFeatureClick, onMapClick }: MapFigureProps) {
  const activeLayer = model.basemap ?? layer;
  const sat = activeLayer === "Satellite";
  // 항공 사진 위에서는 어두운 선·점 테두리가 묻히므로 흰색으로 바꾼다
  const line = sat ? "#fff" : INK;
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const u = Math.min(1.5, Math.max(1, H / 360));
  const vp = framedViewport(model.center, model.radiusM, W, H, siteX, fill, siteY);
  const proj = makeProjector(vp);
  const mpp = metersPerPixel(model.center[1], vp.zoom);
  const [cx, cy] = proj(model.center[0], model.center[1]);
  const R = model.radiusM / mpp;

  const tiles = basemap === "tiles" ? tilesFor(vp) : [];
  const stack = BASEMAP_STACK[activeLayer];
  const rasterImages = (model.rasters ?? [])
    .map((ref) => ({ ref, href: rasterHref?.(ref) ?? null, matrix: rasterAffine(ref, vp) }))
    .filter((item): item is typeof item & { href: string } => !!item.href);
  const grid = scaleBar(mpp, 110 * u).px;

  // 500m 간격 보조 원 (반경 안쪽만)
  const rings: number[] = [];
  for (let m = 500; m < model.radiusM - 1; m += 500) rings.push(m / mpp);

  const selected = new Set(selectedFids);
  const isSelected = (fid: string | undefined) => !!fid && selected.has(fid);
  const feats = model.features.map((f) => ({ f, p: proj(f.lng, f.lat), selected: isSelected(f.fid) }));
  const linePaths = (model.lines ?? []).map((l, index) => ({ l, points: l.points.map(([lng, lat]) => proj(lng, lat)), index }));
  const wmax = Math.max(0, ...model.features.map((f) => f.weight ?? 0));
  const radiusOf = (f: MapFigureProps["model"]["features"][number]) => {
    const st = layerStyle(f.layer);
    if (st.sizeBy !== "weight") return (f.highlight ? 4.6 : 2.6) * u;
    const min = 3.2 * u;
    const max = 13 * u;
    return f.weight && wmax > 0 ? min + (max - min) * Math.sqrt(f.weight / wmax) : min;
  };
  const drawn = [...feats].sort((a, b) => {
    const rank = (x: (typeof feats)[number]) => (x.f.highlight || x.selected ? 2 : x.f.layer === "store:other" ? 0 : 1);
    return rank(a) - rank(b) || (b.f.weight ?? 0) - (a.f.weight ?? 0);
  });

  type ScreenPolygon = {
    polygon: NonNullable<MapModel["polygons"]>[number];
    rings: Array<Array<[number, number]>>;
    center: [number, number];
    area: number;
    index: number;
  };
  const polygonArea = (ring: Array<[number, number]>) => Math.abs(ring.reduce((sum, point, i) => {
    const previous = ring[(i + ring.length - 1) % ring.length];
    return sum + previous[0] * point[1] - point[0] * previous[1];
  }, 0)) / 2;
  const polygons: ScreenPolygon[] = (model.polygons ?? []).map((polygon, index) => {
    const rings = polygon.rings.map((ring) => ring.map(([lng, lat]) => proj(lng, lat)));
    const outer = rings[0] ?? [];
    const xs = outer.map(([x]) => x);
    const ys = outer.map(([, y]) => y);
    return {
      polygon,
      rings,
      center: xs.length > 0 ? [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2] : [cx, cy],
      area: polygonArea(outer),
      index,
    };
  });
  const polygonOpacity = sat ? 0.45 : 0.35;
  const isEstimated = (polygon: ScreenPolygon) => polygon.polygon.layer.endsWith("_est") || layerStyle(polygon.polygon.layer).label.startsWith("[추정]");
  const hatchId = (index: number) => `hatch${uid}-${index}`;
  const polygonPath = (rings: Array<Array<[number, number]>>) => rings.map((ring) => `${ring.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x} ${y}`).join("")}Z`).join(" ");
  const centerOf = (points: Array<[number, number]>): [number, number] => {
    if (points.length === 0) return model.center as [number, number];
    const total = points.reduce(([lng, lat], [nextLng, nextLat]) => [lng + nextLng, lat + nextLat], [0, 0]);
    return [total[0] / points.length, total[1] / points.length];
  };
  const pickProps = (pick: MapFigurePick, key: string, labelText: string) => {
    if (!onFeatureClick) return {};
    const choose = () => onFeatureClick(pick);
    const onKeyDown = (event: ReactKeyboardEvent<SVGElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      choose();
    };
    return {
      "data-map-feature": key,
      role: "button" as const,
      tabIndex: 0,
      "aria-label": labelText,
      onClick: choose,
      onKeyDown,
      style: { cursor: "pointer" },
    };
  };
  const routePoints = path.map((point) => proj(point[0], point[1]));
  const [worldCenterX, worldCenterY] = worldPx(vp.center[0], vp.center[1], vp.zoom);
  const mapClick = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (!onMapClick) return;
    const target = event.target as Element;
    if (target.closest("[data-map-feature]")) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = (event.clientX - rect.left) * (W / rect.width);
    const y = (event.clientY - rect.top) * (H / rect.height);
    const size = 256 * 2 ** vp.zoom;
    const worldX = worldCenterX + x - W / 2;
    const worldY = worldCenterY + y - H / 2;
    const lng = (worldX / size) * 360 - 180;
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * worldY) / size))) * 180) / Math.PI;
    if (Number.isFinite(lng) && Number.isFinite(lat)) onMapClick({ lng, lat });
  };

  // 범례 (지물이 있는 레이어만, 정의된 순서)
  const present = legendItems(model).map((item) => item.layer);
  const fs = 10.5 * u;
  const pad = 6 * u;
  const legendMaxW = W - 2 * pad - 56 * u;
  const cuts = [
    ...(model.total > model.features.length ? [`표시 ${model.features.length.toLocaleString("en-US")} / 전체 ${model.total.toLocaleString("en-US")}`] : []),
    ...(model.polygonsTotal !== undefined && model.polygonsTotal > polygons.length ? [`면 표시 ${polygons.length.toLocaleString("en-US")} / 전체 ${model.polygonsTotal.toLocaleString("en-US")}`] : []),
    ...(model.linesTotal !== undefined && model.linesTotal > linePaths.length ? [`선 표시 ${linePaths.length.toLocaleString("en-US")} / 전체 ${model.linesTotal.toLocaleString("en-US")}`] : []),
  ];
  const notes = [...model.notes, ...cuts];
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
  const showLegend = (legend ?? !bare) && legendH > 0;
  const ly = legendY ?? pad;
  const bar = scaleBar(mpp, 88 * u);
  const barY = H - bottomInset - 20 * u;
  const barX1 = scaleX !== undefined ? scaleX + bar.px : scaleLeft ? Math.max(pad, 12) + bar.px : W - pad - rightInset;
  const barX0 = barX1 - bar.px;
  const boxes: Box[] = showLegend ? [{ x0: pad, y0: ly, x1: pad + legendW, y1: ly + legendH }] : [];
  boxes.push(...avoid);
  if (scale) boxes.push({ x0: barX0 - 8 * u, y0: barY - 16 * u, x1: W, y1: H });
  const site = 6.5 * u;
  boxes.push({ x0: cx - site - 2, y0: cy - site - 2, x1: cx + site + 2, y1: cy + site + 2 });

  // 라벨은 강조 지물과 면적이 큰 면 지물(최대 5개)만, 겹치면 생략
  const labels: ReactNode[] = [];
  if (!bare) {
    const candidates = [
      ...drawn.filter((d) => d.f.label).map((d, i) => ({ text: d.f.label!, p: d.p, radius: radiusOf(d.f), highlight: !!d.f.highlight || d.selected, key: `f${i}-${d.f.layer}`, small: false })),
      ...polygons
        .filter((d) => d.polygon.label)
        .sort((a, b) => b.area - a.area || a.index - b.index)
        .slice(0, 5)
        .map((d) => ({ text: d.polygon.label!, p: d.center, radius: 0, highlight: false, key: `p${d.index}`, small: false })),
      ...linePaths
        .filter((d) => d.l.label)
        .map((d) => ({ text: d.l.label!, p: d.points[Math.floor(d.points.length / 2)]!, radius: 0, highlight: false, key: `l${d.index}`, small: true })),
    ].sort((a, b) => Number(b.highlight) - Number(a.highlight));
    candidates.forEach((d) => {
        const w = textW(d.text, fs) + 4 * u;
        // 지물 오른쪽 → 왼쪽 → 위 → 아래 순으로 겹치지 않는 자리를 찾는다. 없으면 생략.
        const g = d.radius + 3 * u;
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
          <text key={`label-${d.key}`} x={anchor.x + 2 * u} y={anchor.y + fs * 0.85} fontSize={d.small ? fs * 0.85 : fs} fontWeight={d.small ? 500 : 700} fill={INK} stroke="#fff" strokeWidth={3 * u} strokeLinejoin="round" paintOrder="stroke">
            {d.text}
          </text>,
        );
      });
  }

  const north = { x: W - rightInset - 20 * u, y: (northOpt || 22 * u) };
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
      onClick={mapClick}
    >
      <defs>
        <filter id={`s${uid}`}>
          <feColorMatrix type="saturate" values="0.3" />
        </filter>
        <filter id={`m${uid}`}>
          <feColorMatrix type="saturate" values="0" />
          <feGaussianBlur stdDeviation={2} />
        </filter>
        <clipPath id={`c${uid}`}>
          <rect width={W} height={H} />
        </clipPath>
        {polygons.filter(isEstimated).map((polygon) => {
          const st = layerStyle(polygon.polygon.layer);
          return (
            <pattern key={hatchId(polygon.index)} id={hatchId(polygon.index)} patternUnits="userSpaceOnUse" width={10 * u} height={10 * u} patternTransform="rotate(45)">
              <rect width={10 * u} height={10 * u} fill={st.color} fillOpacity={polygonOpacity} />
              <path d={`M0 0V${10 * u}`} stroke={st.color} strokeWidth={1.2 * u} strokeOpacity={0.75} />
            </pattern>
          );
        })}
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
        <g filter={muted ? `url(#m${uid})` : sat ? undefined : `url(#s${uid})`}>
          {stack.map((ly) =>
            tiles.map((t) => {
              const url = tileUrl(ly, t.z, t.x, t.y);
              const href = tileHref ? tileHref(url) : url;
              return href ? <image key={`tile-${ly}/${t.z}/${t.x}/${t.y}`} href={href} x={t.left} y={t.top} width={t.size + 0.6} height={t.size + 0.6} preserveAspectRatio="none" /> : null;
            }),
          )}
        </g>
        {tiles.length > 0 && (!sat || muted) && <rect width={W} height={H} fill="#fff" fillOpacity={muted ? 0.5 : activeLayer === "Base" ? 0.35 : 0.15} />}
        {tiles.length > 0 && sat && !muted && <rect width={W} height={H} fill="#000" fillOpacity={0.12} />}

        {/* 격자 셀 경계가 보이는 원해상도 래스터. 배경 타일 위, 면·선·점 아래에 둔다. */}
        {rasterImages.map(({ ref, href, matrix }) => (
          <image
            key={`raster-${ref.name}`}
            data-raster={ref.name}
            href={href}
            x={0}
            y={0}
            width={ref.cols}
            height={ref.rows}
            preserveAspectRatio="none"
            transform={`matrix(${matrix.join(",")})`}
            style={{ imageRendering: "pixelated" }}
            opacity={1}
          />
        ))}

        <path d={dim} fillRule="evenodd" fill="#14161c" fillOpacity={0.09} />
        {polygons.map((polygon) => {
          const st = layerStyle(polygon.polygon.layer);
          const estimated = isEstimated(polygon);
          const polygonFid = polygon.polygon.fid;
          const polygonCenter = centerOf(polygon.polygon.rings[0] ?? []);
          const polygonSelected = isSelected(polygonFid);
          return <path key={`poly${polygon.index}`} data-poly="true" d={polygonPath(polygon.rings)} fillRule="evenodd" fill={estimated ? `url(#${hatchId(polygon.index)})` : st.color} fillOpacity={estimated ? 1 : polygonOpacity} stroke={polygonSelected ? INK : st.color} strokeWidth={(polygonSelected ? 3 : 1) * u} {...pickProps({ fid: polygonFid, lng: polygonCenter[0], lat: polygonCenter[1], kind: "polygon" }, polygonFid ?? `polygon-${polygon.index}`, `${layerStyle(polygon.polygon.layer).label} 면${polygonFid ? ` ${polygonFid}` : ""}`)} />;
        })}
        {linePaths.map((d) => {
          const st = layerStyle(d.l.layer);
          const lineSelected = isSelected(d.l.fid);
          const center = centerOf(d.l.points);
          return <polyline key={`line${d.index}`} data-line="true" points={d.points.map(([x, y]) => `${x},${y}`).join(" ")} fill="none" stroke={lineSelected ? INK : st.color} strokeWidth={(lineSelected ? 4 : 1.5) * u} strokeLinejoin="round" {...pickProps({ fid: d.l.fid, lng: center[0], lat: center[1], kind: "line" }, d.l.fid ?? `line-${d.index}`, `${layerStyle(d.l.layer).label} 선${d.l.fid ? ` ${d.l.fid}` : ""}`)} />;
        })}
        {rings.map((r, i) => (
          <circle key={`ring-${i}-${r}`} cx={cx} cy={cy} r={r} fill="none" stroke={line} strokeOpacity={sat ? 0.7 : 0.35} strokeWidth={1 * u} strokeDasharray={`${4 * u} ${4 * u}`} />
        ))}
        <circle cx={cx} cy={cy} r={R} fill="none" stroke={line} strokeOpacity={sat ? 0.95 : 0.75} strokeWidth={1.6 * u} />

        {drawn.map((d, i) => {
          if (d.f.highlight && d.f.layer.endsWith("_nearest"))
            return <line key={`nearest-${i}-${d.f.fid ?? d.f.layer}`} x1={cx} y1={cy} x2={d.p[0]} y2={d.p[1]} stroke={line} strokeWidth={1.4 * u} strokeDasharray={`${3 * u} ${3 * u}`} />;
          return null;
        })}
        {drawn.map((d, i) => {
           const st = layerStyle(d.f.layer);
           const r = radiusOf(d.f);
          if (d.p[0] < -r || d.p[1] < -r || d.p[0] > W + r || d.p[1] > H + r) return null;
          const hollow = st.sizeBy === "weight" && !d.f.weight;
          return (
            <circle
              key={`feature-${i}-${d.f.fid ?? d.f.layer}`}
              cx={d.p[0]}
              cy={d.p[1]}
              r={r}
               fill={hollow ? "#fff" : st.color}
               fillOpacity={hollow ? 0.6 : st.sizeBy === "weight" ? 0.55 : d.f.highlight ? 1 : 0.85}
               stroke={sat ? "#fff" : d.f.highlight || d.selected ? INK : st.sizeBy === "weight" ? st.color : "#fff"}
               strokeWidth={(d.f.highlight || d.selected ? 2.8 : sat ? 1.5 : st.sizeBy === "weight" ? 1.4 : 0.8) * u}
               {...pickProps({ fid: d.f.fid, lng: d.f.lng, lat: d.f.lat, kind: "feature" }, d.f.fid ?? `feature-${i}`, `${st.label}${d.f.label ? ` ${d.f.label}` : ""}`)}
             />
           );
         })}
        {routePoints.length >= 2 && (
          <>
            <polyline data-route="true" points={routePoints.map(([x, y]) => `${x},${y}`).join(" ")} fill="none" stroke="#fff" strokeWidth={8 * u} strokeLinecap="round" strokeLinejoin="round" opacity={0.92} />
            <polyline data-route="true" points={routePoints.map(([x, y]) => `${x},${y}`).join(" ")} fill="none" stroke="#D97706" strokeWidth={4.5 * u} strokeLinecap="round" strokeLinejoin="round" />
            <circle cx={routePoints[0]![0]} cy={routePoints[0]![1]} r={5.5 * u} fill={INK} stroke="#fff" strokeWidth={2 * u} />
            <circle cx={routePoints.at(-1)![0]} cy={routePoints.at(-1)![1]} r={6.5 * u} fill="#D97706" stroke="#fff" strokeWidth={2.5 * u} />
          </>
        )}
        {labels}

        {/* 대지 표시 */}
        {!muted && <rect x={cx - site} y={cy - site} width={2 * site} height={2 * site} fill={INK} stroke="#fff" strokeWidth={2.4 * u} />}

        {/* 범례·문구 */}
        {showLegend && (
          <g>
            <rect x={pad} y={ly} width={legendW} height={legendH} rx={6 * u} fill="#fff" fillOpacity={0.9} />
            {legendRows.map((row, ri) =>
              row.map((it, ii) => (
                <g key={`legend-${ri}-${ii}-${it.layer}`}>
                  <circle cx={pad * 1.8 + it.x + 4 * u} cy={ly + pad * 0.7 + ri * rowH + rowH / 2} r={4 * u} fill={layerStyle(it.layer).color} fillOpacity={0.85} />
                  <text x={pad * 1.8 + it.x + 11 * u} y={ly + pad * 0.7 + ri * rowH + rowH * 0.72} fontSize={fs} fill={INK}>
                    {layerStyle(it.layer).label}
                  </text>
                </g>
              )),
            )}
            {notes.map((n, i) => (
              <text key={`note-${i}-${n}`} x={pad + pad * 0.8} y={ly + pad * 0.7 + legendRowsN * rowH + i * rowH * 0.95 + rowH * 0.72} fontSize={fs * 0.95} fill="#555a64">
                {n}
              </text>
            ))}
          </g>
        )}

        {/* 북쪽 */}
        {northOpt !== false && (
          <g>
            <circle cx={north.x} cy={north.y} r={13 * u} fill="#fff" fillOpacity={0.9} />
            <path d={`M${north.x} ${north.y - 9 * u}L${north.x + 4.5 * u} ${north.y + 3 * u}L${north.x} ${north.y + 0.5 * u}L${north.x - 4.5 * u} ${north.y + 3 * u}Z`} fill={INK} />
            <text x={north.x} y={north.y + 11 * u} fontSize={7.5 * u} fontWeight={700} textAnchor="middle" fill={INK}>
              N
            </text>
          </g>
        )}

        {/* 축척 막대 + 저작권 */}
        <g>
          {scale && (
            <>
              <rect x={barX0 - 6 * u} y={barY - 14 * u} width={bar.px + 12 * u} height={22 * u} rx={5 * u} fill="#fff" fillOpacity={0.85} />
              <path d={`M${barX0} ${barY - 4 * u}V${barY}H${barX1}V${barY - 4 * u}`} fill="none" stroke={INK} strokeWidth={1.6 * u} />
              <text x={barX0 + bar.px / 2} y={barY - 6 * u} fontSize={9.5 * u} fontWeight={700} textAnchor="middle" fill={INK}>
                {bar.label}
              </text>
            </>
          )}
          {credit && (
            <text x={W - 4 * u} y={H - 4 * u} fontSize={6.6 * u} textAnchor="end" fill="#3b3f47" stroke="#fff" strokeOpacity={0.8} strokeWidth={2 * u} paintOrder="stroke">
              {BASEMAP_ATTRIBUTION}
            </text>
          )}
        </g>
      </g>
    </svg>
  );
}
