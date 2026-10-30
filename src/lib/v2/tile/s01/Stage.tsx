"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import Mass3D from "@/components/v2/mass-3d";
import type { TileStageProps } from "../component-types";

/** 펼침 창 오른쪽 정보 판이 덮는 폭만큼 오른쪽을 비워 3D 매스·범례·시점 버튼이 판 왼쪽 영역 안에 놓이게 한다. */
function InsetHost({ rightInset, children }: { rightInset: NonNullable<TileStageProps["rightInset"]>; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [inset, setInset] = useState(0);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const read = () => setInset(typeof rightInset === "function" ? rightInset(node.clientWidth) : rightInset);
    read();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => observer.disconnect();
  }, [rightInset]);
  return <div ref={ref} style={{ width: "100%", height: "100%", boxSizing: "border-box", paddingRight: inset, background: "#F2F2EF" }}>{children}</div>;
}

export function MassStage({ displayView, frame, label, rightInset }: TileStageProps) {
  const mass = displayView.mass;
  if (!mass) return null;
  const card = frame === "card";
  const figure = (
    <Mass3D
      scene={mass.scene}
      camera={mass.camera}
      width={960}
      height={540}
      label={label}
      quality={card ? "card" : "detail"}
      mode={card ? "image" : "live"}
      exploded={mass.exploded}
      palette={mass.palette}
    />
  );
  return !card && rightInset !== undefined ? <InsetHost rightInset={rightInset}>{figure}</InsetHost> : figure;
}

export const s01StageRegistration = {
  codes: ["S01"] as const,
  Component: MassStage,
  when: (view: TileStageProps["view"]) => !!view.mass,
};
