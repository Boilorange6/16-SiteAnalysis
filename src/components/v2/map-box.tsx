"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { MapModel } from "@/lib/v2/ui/map-layers";
import type { BasemapChoice } from "@/lib/v2/ui/map-projection";
import MapFigure from "./map-figure";

/** 보드가 고른 배경지도 종류. 카드·상세·요약의 모든 지도가 같이 따른다. */
export const BasemapContext = createContext<BasemapChoice>("white");

/** 부모 크기에 맞춰 MapFigure를 그린다 (반경 원은 항상 높이의 80%). */
export default function MapBox({ model, bare, label }: { model: MapModel; bare?: boolean; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // 서버에서는 크기를 모르고 부동소수 결과도 브라우저와 미세하게 달라, 마운트 뒤 실측 크기로만 그린다.
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
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
    return () => ro.disconnect();
  }, []);
  const layer = useContext(BasemapContext);
  return (
    <div ref={ref} style={{ position: "absolute", inset: 0 }}>
      {size && <MapFigure model={model} width={size.w} height={size.h} bare={bare} label={label} layer={layer} />}
    </div>
  );
}
