"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MassCamera, MassColorScheme, MassQuality } from "@/lib/v2/ui/mass-projection";
import type { Scene } from "@/lib/v2/scene";
import FallbackMassFigure from "./mass-figure";
import styles from "./board.module.css";

type RenderMode = "image" | "live";

export type Mass3dProps = {
  scene: Scene | null;
  camera: MassCamera;
  width: number;
  height: number;
  fixed?: boolean;
  label?: string;
  exploded?: { spreadPct: number; scheme?: MassColorScheme };
  quality?: MassQuality;
  mode?: RenderMode;
};

const loadRuntime = () => import("@/lib/v2/ui/mass-3d-runtime");

function inputKey({ scene, camera, width, height, exploded, quality, mode }: Mass3dProps): string {
  return [
    scene?.analysisId ?? "empty",
    scene?.manifestHash ?? "",
    camera.azimuthDeg,
    camera.elevationDeg,
    camera.radiusM,
    width,
    height,
    exploded ? `${exploded.spreadPct}:${exploded.scheme ?? "use"}` : "basic",
    quality ?? "detail",
    mode ?? "image",
  ].join("|");
}

function statusStyle(): React.CSSProperties {
  return {
    position: "absolute",
    inset: 0,
    display: "grid",
    placeItems: "center",
    color: "#676C76",
    fontSize: 12,
    background: "#F2F2EF",
  };
}

function LiveLegend({ scene, exploded }: Pick<Mass3dProps, "scene" | "exploded">) {
  if (exploded) {
    return (
      <div className={styles.mass3dExplodedLegend} aria-hidden="true">
        {[
          ["지형", "#E8ECEF"],
          ["수계", "#C4E6EB"],
          ["녹지", "#CFE4C8"],
          ["도로", "#D9DDE2"],
          ["건물", "#E8EDF2"],
          ["완성", "#F5F6F7"],
        ].map(([label, color]) => (
          <span key={label} className={styles.mass3dLegendItem}>
            <i style={{ background: color }} />
            {label}
          </span>
        ))}
      </div>
    );
  }
  return (
    <div className={styles.mass3dLegend} aria-hidden="true">
      <span className={styles.mass3dLegendItem}><i style={{ background: "#E8EDF2" }} />확정 높이</span>
      <span className={styles.mass3dLegendItem}><i className={styles.mass3dEstimatedSwatch} />추정 높이</span>
      <span className={styles.mass3dLegendItem}><i style={{ background: "#C8CDD4" }} />높이 미상</span>
      {scene?.ground.kind === "dem" && <span className={styles.mass3dLegendItem}><i style={{ background: "#E8ECEF" }} />지형</span>}
    </div>
  );
}

function Fallback({ props, note }: { props: Mass3dProps; note: string }) {
  return (
    <div className={styles.mass3dFallback} style={{ width: props.fixed ? props.width : "100%", height: props.fixed ? props.height : "100%" }}>
      <FallbackMassFigure
        scene={props.scene}
        camera={props.camera}
        width={props.width}
        height={props.height}
        fixed={props.fixed}
        label={props.label}
        exploded={props.exploded}
        quality={props.quality}
      />
      <span className={styles.mass3dFallbackNote} role="status">{note}</span>
    </div>
  );
}

function Mass3D({ mode = "image", ...props }: Mass3dProps) {
  const key = useMemo(() => inputKey({ ...props, mode }), [props.scene, props.camera, props.width, props.height, props.exploded, props.quality, mode]);
  const liveRef = useRef<HTMLDivElement>(null);
  const liveMountRef = useRef<{ update: (input: Mass3dProps) => void; dispose: () => void } | null>(null);
  const latestPropsRef = useRef(props);
  latestPropsRef.current = props;
  const liveSceneKey = `${props.scene?.analysisId ?? "empty"}:${props.scene?.manifestHash ?? ""}`;
  const [image, setImage] = useState<string | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "fallback" | "error">("loading");

  useEffect(() => {
    let active = true;
    if (mode !== "image") return () => { active = false; };
    setPhase("loading");
    setImage(null);
    void loadRuntime()
      .then(async (runtime) => {
        if (!runtime.isMass3dWebGLAvailable()) throw new Error("WebGL을 사용할 수 없습니다.");
        return runtime.renderMass3dPng({ ...props, label: props.label ?? "S01 3D 매스" });
      })
      .then((dataUrl) => {
        if (!active) return;
        setImage(dataUrl);
        setPhase("ready");
      })
      .catch(() => {
        if (!active) return;
        setPhase("fallback");
      });
    return () => { active = false; };
  }, [key, mode]);

  useEffect(() => {
    let active = true;
    if (mode !== "live" || !liveRef.current) return () => { active = false; };
    setPhase("loading");
    void loadRuntime()
      .then((runtime) => runtime.mountMass3d(liveRef.current!, { ...latestPropsRef.current, label: latestPropsRef.current.label ?? "S01 3D 매스" }))
      .then((nextMount) => {
        if (!active) {
          nextMount.dispose();
          return;
        }
        liveMountRef.current = nextMount;
        setPhase("ready");
      })
      .catch(() => {
        if (active) setPhase("fallback");
      });
    return () => {
      active = false;
      liveMountRef.current?.dispose();
      liveMountRef.current = null;
    };
  }, [liveSceneKey, mode]);

  useEffect(() => {
    if (mode !== "live") return;
    liveMountRef.current?.update({ ...props, label: props.label ?? "S01 3D 매스" });
  }, [key, mode]);

  const shellStyle = { width: props.fixed ? props.width : "100%", height: props.fixed ? props.height : "100%" } as const;
  if (phase === "fallback" || phase === "error") {
    return <Fallback props={{ ...props, mode }} note="WebGL을 사용할 수 없어 2D 대체 그림을 표시합니다." />;
  }
  if (mode === "live") {
    return (
      <div className={styles.mass3dRoot} style={shellStyle} aria-busy={phase === "loading"}>
        <div ref={liveRef} className={styles.mass3dCanvasHost} />
        <LiveLegend scene={props.scene} exploded={props.exploded} />
        {props.scene?.ground.kind === "flat" && <span className={styles.mass3dFlatNote} aria-hidden="true">지형 미반영</span>}
        {phase === "loading" && <span style={statusStyle()} role="status">3D 매스를 불러오는 중…</span>}
      </div>
    );
  }
  if (image) {
    return (
      <img
        src={image}
        alt={props.label ?? "S01 3D 매스"}
        width={props.fixed ? props.width : undefined}
        height={props.fixed ? props.height : undefined}
        className={styles.mass3dImage}
        style={shellStyle}
        decoding="async"
      />
    );
  }
  return (
    <div className={styles.mass3dRoot} style={shellStyle} aria-busy role="img" aria-label={props.label ?? "S01 3D 매스"}>
      <span style={statusStyle()} role="status">3D 매스를 불러오는 중…</span>
    </div>
  );
}

export default Mass3D;
