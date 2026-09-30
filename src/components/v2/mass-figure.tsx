import React from "react";
import { type MassCamera, projectMass, type MassLayer } from "@/lib/v2/ui/mass-projection";
import type { Scene } from "@/lib/v2/scene";

export type MassFigureProps = {
  scene: Scene | null;
  camera: MassCamera;
  width: number;
  height: number;
  fixed?: boolean;
  label?: string;
};

const INK = "#15171c";
const COLORS: Record<MassLayer, string> = {
  mass_source: "#5E83B3",
  mass_estimated: "#C58B2B",
  mass_unknown: "#9EA5AF",
  ground: "#E2E4E8",
};
const LABELS: Record<MassLayer, string> = {
  mass_source: "확보 높이",
  mass_estimated: "추정 높이",
  mass_unknown: "높이 미상",
  ground: "대지·반경",
};

function shadeColor(hex: string, shade: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const factor = Math.max(0.25, Math.min(1, shade));
  const channel = (shift: number) => Math.round(((value >> shift) & 0xff) * factor).toString(16).padStart(2, "0");
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}

function emptyGroundPath(width: number, height: number): string {
  const cx = width / 2;
  const cy = height * 0.56;
  const rx = Math.min(width * 0.38, height * 0.4);
  const ry = rx * 0.58;
  return `M${(cx - rx).toFixed(2)} ${cy.toFixed(2)}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0Z`;
}

function northVector(camera: MassCamera): { dx: number; dy: number } {
  const a = (camera.azimuthDeg * Math.PI) / 180;
  const e = (camera.elevationDeg * Math.PI) / 180;
  const dx = -Math.sin(a);
  const dy = -Math.cos(a) * Math.sin(e);
  const length = Math.hypot(dx, dy) || 1;
  return { dx: (dx / length) * 28, dy: (dy / length) * 28 };
}

function MassFigure({ scene, camera, width, height, fixed = false, label = "S01 3D 매스" }: MassFigureProps) {
  const projection = scene ? projectMass(scene, camera, width, height) : null;
  const faces = projection?.faces ?? [{ path: emptyGroundPath(width, height), shade: 0.08, layer: "ground" as const, depth: 0 }];
  const arrow = northVector(camera);
  const nx = width - 42;
  const ny = 48;
  const uid = `mass-${Math.round(width)}-${Math.round(height)}`;
  const legend: MassLayer[] = ["mass_source", "mass_estimated", "mass_unknown"];

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${width} ${height}`}
      {...(fixed ? { width, height } : { width: "100%", height: "100%" })}
      role="img"
      aria-label={label}
      style={{ display: "block" }}
      fontFamily={'"Noto Sans KR","Malgun Gothic","Apple SD Gothic Neo",sans-serif'}
    >
      <defs>
        <pattern id={`${uid}-estimate`} width="8" height="8" patternUnits="userSpaceOnUse">
          <rect width="8" height="8" fill={COLORS.mass_estimated} fillOpacity="0.28" />
          <path d="M0 8L8 0" stroke={COLORS.mass_estimated} strokeWidth="1" strokeOpacity="0.75" />
        </pattern>
      </defs>
      <rect width={width} height={height} fill="#F2F2EF" />
      {faces.map((face, index) => (
        <path
          key={`${face.layer}-${index}`}
          d={face.path}
          data-face-layer={face.layer}
          fill={face.layer === "mass_estimated" ? `url(#${uid}-estimate)` : shadeColor(COLORS[face.layer], face.shade)}
          fillOpacity={face.layer === "ground" ? 0.9 : 0.96}
          stroke={face.layer === "ground" ? "#AEB4BD" : "#FFFFFF"}
          strokeOpacity={face.layer === "ground" ? 0.7 : 0.85}
          strokeWidth={face.layer === "ground" ? 1 : 0.8}
          strokeLinejoin="round"
        />
      ))}

      <g aria-label="북쪽" transform={`translate(${nx} ${ny})`}>
        <circle r="18" fill="#FFFFFF" fillOpacity="0.9" />
        <line x1="0" y1="0" x2={arrow.dx} y2={arrow.dy} stroke={INK} strokeWidth="2" />
        <path d={`M${arrow.dx} ${arrow.dy}l-5 8h10Z`} fill={INK} />
        <text x="0" y="30" textAnchor="middle" fontSize="10" fontWeight="700" fill={INK}>
          N
        </text>
      </g>

      <g aria-label="매스 범례" transform={`translate(16 ${height - 42})`}>
        {legend.map((layer, index) => (
          <g key={layer} transform={`translate(${index * 112} 0)`}>
            <rect width="10" height="10" rx="2" fill={COLORS[layer]} />
            <text x="16" y="10" fontSize="10" fill={INK}>
              {LABELS[layer]}
            </text>
          </g>
        ))}
      </g>
      {!scene && (
        <text x={width / 2} y={height / 2} textAnchor="middle" fontSize="13" fontWeight="700" fill="#5B606B">
          건물 도형 미적재 · 매스 틀만 표시
        </text>
      )}
    </svg>
  );
}

export { MassFigure };
export default MassFigure;
