export type TopoKind =
  | "topo_contour"
  | "topo_spot"
  | "topo_road"
  | "topo_road_surface"
  | "topo_building"
  | "topo_retaining"
  | "topo_cut_fill"
  | "topo_fence"
  | "topo_water";

export type TopoGeometry = "line" | "point" | "polygon";

export interface TopoLayer {
  kind: TopoKind;
  geometry: TopoGeometry;
}

export const TOPO_LAYERS: Record<string, TopoLayer> = {
  N3L_F0010000: { kind: "topo_contour", geometry: "line" },
  N3P_F0020000: { kind: "topo_spot", geometry: "point" },
  N3L_A0020000: { kind: "topo_road", geometry: "line" },
  N3A_A0010000: { kind: "topo_road_surface", geometry: "polygon" },
  N3A_B0010000: { kind: "topo_building", geometry: "polygon" },
  N3L_F0030000: { kind: "topo_retaining", geometry: "line" },
  N3L_F0040000: { kind: "topo_cut_fill", geometry: "line" },
  N3L_B0020000: { kind: "topo_fence", geometry: "line" },
  N3A_E0010001: { kind: "topo_water", geometry: "polygon" },
  N3A_E0032111: { kind: "topo_water", geometry: "polygon" },
};

const TOPO_EXTENSIONS = new Set([".shp", ".shx", ".dbf", ".prj", ".cpg"]);

export function TOPO_UPLOAD_KEEP(entryName: string): boolean {
  const baseName = entryName.split(/[\\/]/).pop() ?? "";
  const extensionIndex = baseName.lastIndexOf(".");
  if (extensionIndex <= 0) return false;
  const base = baseName.slice(0, extensionIndex);
  const extension = baseName.slice(extensionIndex).toLowerCase();
  return Object.prototype.hasOwnProperty.call(TOPO_LAYERS, base) && TOPO_EXTENSIONS.has(extension);
}
