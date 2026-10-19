import type { A05Counts, A05Filter } from "../engine/a05-filter";
import type { DemoPhase, CameraPreset, CutSpec, TerrainSectionId } from "../ui/board-state";
import type { MapFigureElementPick } from "../../../components/v2/map-figure";
import type { RoseSeason } from "../tile-result";
import type { TileView } from "../ui/tile-view";

export type TileStageProps = {
  view: TileView;
  displayView: TileView;
  state: boolean;
  chart: boolean;
  frame: "card" | "detail";
  label: string;
  page?: number;
  onPage?: (page: number) => void;
  cut?: CutSpec | null;
  roseSeason?: RoseSeason;
  siteX?: number | ((width: number) => number);
  rightInset?: number | ((width: number) => number);
  legendY?: number;
  pinnedKeys?: readonly string[];
  hoverKey?: string | null;
  emphasisKey?: string | null;
  onFeaturePin?: (feature: MapFigureElementPick) => void;
  mapInteractive?: boolean;
  mapWheel?: "plain" | "modifier" | "off";
  mapTouchPan?: "one" | "two";
  mapResetKey?: string;
  /** A05/A06 카드의 자동 말풍선·지시선 표시. 상세는 생략하면 표시한다. */
  showMapLabels?: boolean;
  /** D17 상세 지도에서 강조할 단면. 생략하면 A다. */
  terrainSection?: TerrainSectionId;
};

export type TileFaceExtraProps = {
  view: TileView;
  cut: CutSpec | null;
  state: boolean;
  placement: "header" | "controls" | "summary";
  onCut: (cut: CutSpec) => void;
  onOpen: () => void;
  phase?: DemoPhase | null;
  onWindUploaded?: () => void;
};

export type TileDialogPanelProps = {
  view: TileView;
  filter?: A05Filter | null;
  counts?: A05Counts | null;
  onChange?: (next: A05Filter | null) => void;
  titleId: string;
  cut?: CutSpec | null;
  onCut?: (cut: CutSpec) => void;
  camera?: CameraPreset | null;
  onCamera?: (camera: CameraPreset) => void;
  onWindUploaded?: () => void;
  terrainSection?: TerrainSectionId;
  onTerrainSection?: (section: TerrainSectionId) => void;
};
