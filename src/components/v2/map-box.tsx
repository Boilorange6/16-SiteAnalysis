"use client";

import { useEffect, useRef, useState } from "react";
import type { MapModel } from "@/lib/v2/ui/map-layers";
import MapFigure from "./map-figure";

/** 부모 크기에 맞춰 MapFigure를 그린다 (반경 원은 항상 높이의 80%). */
export default function MapBox({ model, bare, label }: { model: MapModel; bare?: boolean; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 640, h: 360 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const w = Math.round(el.clientWidth);
      const h = Math.round(el.clientHeight);
      if (w > 0 && h > 0) setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} style={{ position: "absolute", inset: 0 }}>
      <MapFigure model={model} width={size.w} height={size.h} bare={bare} label={label} />
    </div>
  );
}
