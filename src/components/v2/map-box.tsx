"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { MapModel } from "@/lib/v2/ui/map-layers";
import type { BasemapChoice } from "@/lib/v2/ui/map-projection";
import MapFigure, { type MapFigureProps } from "./map-figure";

/** 보드가 고른 배경지도 종류. 카드·상세·요약의 모든 지도가 같이 따른다. */
export const BasemapContext = createContext<BasemapChoice>("white");
/** 상세 화면 위쪽 전환 버튼이 보드의 배경지도를 바꾼다 */
export const SetBasemapContext = createContext<(b: BasemapChoice) => void>(() => {});

type Box = NonNullable<MapFigureProps["avoid"]>;
/** avoid·siteX는 실측 크기를 받아 계산하는 함수도 받는다 */
type Opts = Pick<MapFigureProps, "legend" | "legendY" | "north" | "scale" | "credit" | "bottomInset" | "muted" | "rightInset" | "scaleLeft" | "fill" | "scaleX" | "siteY"> & {
  avoid?: Box | ((w: number, h: number) => Box);
  siteX?: number | ((w: number) => number);
};
type Opts2 = Omit<Opts, "rightInset"> & { rightInset?: number | ((w: number) => number) };

export const BASEMAPS: Array<{ id: BasemapChoice; label: string }> = [
  { id: "white", label: "일반" },
  { id: "Base", label: "지도" },
  { id: "Satellite", label: "항공" },
];

/**
 * 부모 크기에 맞춰 MapFigure를 그린다 (반경 원은 항상 높이의 80%).
 * 화면 밖 카드는 가까이 올 때까지 그리지 않는다 (보드 12장 × 배경 타일).
 */
/** 부모를 채우는 상자의 실측 크기와 "화면에 가까워졌는가". 서버에서는 크기를 모르고 부동소수 결과도 브라우저와 미세하게 달라, 마운트 뒤 실측 크기로만 그린다. */
export function useMeasured() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const w = Math.round(el.clientWidth);
      const h = Math.round(el.clientHeight);
      if (w > 0 && h > 0) setSize((s) => (s && s.w === w && s.h === h ? s : { w, h }));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    // 스크롤 컨테이너(보드 root) 기준으로 가까워지면 한 번 켠다
    const io = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setNear(true), { rootMargin: "400px" });
    if (io) io.observe(el);
    else setNear(true);
    return () => {
      ro.disconnect();
      io?.disconnect();
    };
  }, []);
  return { ref, size, near };
}

export default function MapBox({ model, bare, label, avoid, siteX, rightInset, ...opts }: { model: MapModel; bare?: boolean; label?: string } & Opts2) {
  const { ref, size, near } = useMeasured();
  const layer = useContext(BasemapContext);
  return (
    <div ref={ref} style={{ position: "absolute", inset: 0 }}>
      {size && near && (
        <MapFigure
          model={model}
          width={size.w}
          height={size.h}
          bare={bare}
          label={label}
          layer={layer}
          avoid={typeof avoid === "function" ? avoid(size.w, size.h) : avoid}
          siteX={typeof siteX === "function" ? siteX(size.w) : siteX}
          rightInset={typeof rightInset === "function" ? rightInset(size.w) : rightInset}
          {...opts}
        />
      )}
    </div>
  );
}
