"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MassCamera, MassColorScheme, MassLabel, MassQuality } from "@/lib/v2/ui/mass-projection";
import type { Scene } from "@/lib/v2/scene";
import FallbackMassFigure from "./mass-figure";
import styles from "./board.module.css";
import tileStyles from "@/lib/v2/tile/s01/tile.module.css";

type RenderMode = "image" | "live";

const DEFAULT_MASS_LABEL = "S01 3D 매스";
const MAX_ACCESSIBLE_BUILDING_LABELS = 8;

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

function buildingAccessibilityLabel(building: Scene["buildings"][number]): string | null {
  const name = typeof building.name === "string" && building.name.trim() ? building.name.trim() : null;
  const sublabel = typeof building.sublabel === "string" && building.sublabel.trim() ? building.sublabel.trim() : null;
  if (!name && !sublabel) return null;
  return [name ?? "건물", sublabel].filter((value): value is string => value !== null).join(" · ");
}

/** 모든 렌더 경로가 공유하는 건물명·층수 hover/aria 문자열을 만든다. */
export function formatMass3dAccessibilityLabel({ scene, label }: Pick<Mass3dProps, "scene" | "label">): string {
  const base = typeof label === "string" && label.trim() ? label.trim() : DEFAULT_MASS_LABEL;
  const labels = [...(scene?.buildings ?? [])]
    .sort((a, b) => b.labelPriority - a.labelPriority)
    .map(buildingAccessibilityLabel)
    .filter((value): value is string => value !== null);
  if (labels.length === 0) return base;
  const visible = labels.slice(0, MAX_ACCESSIBLE_BUILDING_LABELS);
  const remainder = labels.length - visible.length;
  return `${base} · ${visible.join(", ")}${remainder > 0 ? ` · 외 ${remainder}동` : ""}`;
}

const loadRuntime = () => import("@/lib/v2/ui/mass-3d-runtime");

function inputKey({ scene, camera, width, height, exploded, quality, label, mode }: Mass3dProps): string {
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
    label ?? "",
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

function LiveExplodedLabels({ scene, camera, exploded, width, height }: { scene: Scene | null; camera: MassCamera; exploded?: Mass3dProps["exploded"]; width: number; height: number }) {
  const [labels, setLabels] = useState<MassLabel[]>([]);
  const sceneKey = `${scene?.analysisId ?? "empty"}:${scene?.manifestHash ?? ""}`;
  const cameraKey = `${camera.azimuthDeg}:${camera.elevationDeg}:${camera.radiusM}`;
  const explodedKey = exploded ? `${exploded.spreadPct}:${exploded.scheme ?? "use"}` : "basic";

  useEffect(() => {
    let active = true;
    if (!scene || !exploded) {
      setLabels([]);
      return () => { active = false; };
    }
    setLabels([]);
    void loadRuntime()
      .then((runtime) => runtime.mass3dExplodedLabels({ scene, camera, width, height, exploded }, width, height))
      .then((nextLabels) => {
        if (active) setLabels(nextLabels);
      })
      .catch(() => {
        if (active) setLabels([]);
      });
    return () => { active = false; };
  }, [sceneKey, cameraKey, explodedKey, width, height]);

  if (!exploded || labels.length === 0) return null;
  return (
    <div className={tileStyles.mass3dExplodedLabels} aria-hidden="true">
      {labels.map((label) => (
        <div key={label.layer} data-layer-label={label.layer} className={tileStyles.mass3dExplodedLabelGroup} style={{ left: label.x, top: label.y }}>
          <span className={tileStyles.mass3dExplodedLabelText}>{label.text}</span>
          {label.note && <span className={tileStyles.mass3dExplodedLabelNote}>{label.note}</span>}
          <i className={tileStyles.mass3dExplodedLabelLeader} style={{ width: Math.max(0, label.leaderX - label.x - 4) }} />
        </div>
      ))}
      {labels.filter((label) => label.note && label.badgeX !== undefined && label.badgeY !== undefined).map((label) => (
        <span key={`${label.layer}-empty`} className={tileStyles.mass3dNoDataBadge} style={{ left: label.badgeX, top: label.badgeY }}>
          자료 없음
        </span>
      ))}
    </div>
  );
}

function LiveLegend({ scene, exploded }: Pick<Mass3dProps, "scene" | "exploded">) {
  if (exploded) {
    return (
      <div className={styles.mass3dExplodedLegend} aria-hidden="true">
          {[
          ["지형", "#E8ECEF"],
          ["수계", "#C4E6EB"],
          ["녹지", "#CFE4C8"],
          ["도로", "#6D7A89"],
          ["건물", "#E8EDF2"],
          ["완성", "#F5F6F7"],
          ].map(([label, color]) => (
          <span key={label} className={tileStyles.mass3dLegendItem}>
            <i style={{ background: color }} />
            {label}
          </span>
          ))}
          <span className={tileStyles.mass3dLegendItem}><i className={tileStyles.mass3dNoDataSwatch} />자료 없음 = 빈 원판</span>
        </div>
    );
  }
  return (
    <div className={styles.mass3dLegend} aria-hidden="true">
      <span className={tileStyles.mass3dLegendItem}><i style={{ background: "#E8EDF2" }} />확정 높이</span>
      <span className={tileStyles.mass3dLegendItem}><i className={tileStyles.mass3dEstimatedSwatch} />추정 높이</span>
      <span className={tileStyles.mass3dLegendItem}><i style={{ background: "#C8CDD4" }} />높이 미상</span>
      {scene?.ground.kind === "dem" && <span className={tileStyles.mass3dLegendItem}><i style={{ background: "#E8ECEF" }} />지형</span>}
    </div>
  );
}

function Fallback({ props, note }: { props: Mass3dProps; note: string }) {
  const accessibilityLabel = formatMass3dAccessibilityLabel(props);
  return (
    <div className={tileStyles.mass3dFallback} role="img" aria-label={accessibilityLabel} title={accessibilityLabel} style={{ width: props.fixed ? props.width : "100%", height: props.fixed ? props.height : "100%" }}>
      <FallbackMassFigure
        scene={props.scene}
        camera={props.camera}
        width={props.width}
        height={props.height}
        fixed={props.fixed}
        label={accessibilityLabel}
        exploded={props.exploded}
        quality={props.quality}
      />
      <span className={tileStyles.mass3dFallbackNote} role="status">{note}</span>
    </div>
  );
}

function Mass3D({ mode = "image", ...props }: Mass3dProps) {
  const accessibilityLabel = formatMass3dAccessibilityLabel(props);
  const imageRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef<HTMLDivElement>(null);
  const liveMountRef = useRef<{ update: (input: Mass3dProps) => void; dispose: () => void } | null>(null);
  const latestPropsRef = useRef({ ...props, label: accessibilityLabel });
  latestPropsRef.current = { ...props, label: accessibilityLabel };
  const liveSceneKey = `${props.scene?.analysisId ?? "empty"}:${props.scene?.manifestHash ?? ""}`;
  const [image, setImage] = useState<string | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "fallback" | "error">("loading");
  const [imageSize, setImageSize] = useState({ width: props.width, height: props.height });
  const [liveSize, setLiveSize] = useState({ width: props.width, height: props.height });

  const renderProps = mode === "image"
    ? { ...props, label: accessibilityLabel, width: imageSize.width, height: imageSize.height }
    : { ...props, label: accessibilityLabel };
  const key = useMemo(() => inputKey({ ...renderProps, mode }), [renderProps.scene, renderProps.camera, renderProps.width, renderProps.height, renderProps.exploded, renderProps.quality, renderProps.label, mode]);

  useEffect(() => {
    if (mode !== "image" || !imageRef.current) return;
    const node = imageRef.current;
    const updateSize = () => {
      setImageSize({
        width: Math.max(1, node.clientWidth || props.width),
        height: Math.max(1, node.clientHeight || props.height),
      });
    };
    updateSize();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateSize);
    observer.observe(node);
    return () => observer.disconnect();
  }, [mode, props.width, props.height]);

  useEffect(() => {
    if (mode !== "live" || !liveRef.current) return;
    const node = liveRef.current;
    const updateSize = () => {
      setLiveSize({
        width: Math.max(1, node.clientWidth || props.width),
        height: Math.max(1, node.clientHeight || props.height),
      });
    };
    updateSize();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateSize);
    observer.observe(node);
    return () => observer.disconnect();
  }, [mode, props.width, props.height]);

  useEffect(() => {
    let active = true;
    if (mode !== "image") return () => { active = false; };
    setPhase("loading");
    setImage(null);
    void loadRuntime()
      .then(async (runtime) => {
        if (!runtime.isMass3dWebGLAvailable()) throw new Error("WebGL을 사용할 수 없습니다.");
        return runtime.renderMass3dPng({ ...renderProps, label: accessibilityLabel });
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
      .then((runtime) => runtime.mountMass3d(liveRef.current!, { ...latestPropsRef.current, label: accessibilityLabel }))
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
  }, [liveSceneKey, accessibilityLabel, mode]);

  useEffect(() => {
    if (mode !== "live") return;
    liveMountRef.current?.update({ ...props, label: accessibilityLabel });
  }, [key, mode]);

  const shellStyle = { width: props.fixed ? props.width : "100%", height: props.fixed ? props.height : "100%" } as const;
  if (mode === "image") {
    return (
      <div ref={imageRef} className={tileStyles.mass3dRoot} role="img" aria-label={accessibilityLabel} title={accessibilityLabel} style={shellStyle} aria-busy={phase === "loading"}>
        {phase === "fallback" || phase === "error" ? (
          <Fallback props={{ ...renderProps, mode }} note="WebGL을 사용할 수 없어 2D 대체 그림을 표시합니다." />
        ) : image ? (
          <img
            src={image}
            alt={accessibilityLabel}
            title={accessibilityLabel}
            width={props.fixed ? props.width : undefined}
            height={props.fixed ? props.height : undefined}
            className={tileStyles.mass3dImage}
            style={{ width: "100%", height: "100%", display: "block" }}
            decoding="async"
          />
        ) : (
          <span style={statusStyle()} role="status">3D 매스를 불러오는 중…</span>
        )}
      </div>
    );
  }
  if (phase === "fallback" || phase === "error") {
    return <Fallback props={{ ...props, mode }} note="WebGL을 사용할 수 없어 2D 대체 그림을 표시합니다." />;
  }
  if (mode === "live") {
    return (
      <div className={tileStyles.mass3dRoot} style={shellStyle} aria-busy={phase === "loading"} role="img" aria-label={accessibilityLabel} title={accessibilityLabel}>
        <div ref={liveRef} className={tileStyles.mass3dCanvasHost} />
        <LiveExplodedLabels scene={props.scene} camera={props.camera} exploded={props.exploded} width={liveSize.width} height={liveSize.height} />
        <LiveLegend scene={props.scene} exploded={props.exploded} />
        {props.scene?.ground.kind === "flat" && <span className={tileStyles.mass3dFlatNote} aria-hidden="true">지형 미반영</span>}
        {phase === "loading" && <span style={statusStyle()} role="status">3D 매스를 불러오는 중…</span>}
      </div>
    );
  }
  return (
    <div className={tileStyles.mass3dRoot} style={shellStyle} aria-busy role="img" aria-label={accessibilityLabel} title={accessibilityLabel}>
      <span style={statusStyle()} role="status">3D 매스를 불러오는 중…</span>
    </div>
  );
}

export default Mass3D;
