/** 허가된 영상 원천에서 주입하는 모자이크. */
export interface Mosaic {
  z: number;
  /** Global Web Mercator pixel coordinate of the upper-left output pixel. */
  x0Px: number;
  y0Px: number;
  width: number;
  height: number;
  /** Row-major RGB bytes, three bytes per pixel. */
  rgb: Uint8Array;
  mPerPx: number;
  missingTiles: number;
  totalTiles: number;
  /** 1 for decoded imagery and 0 for a failed WMTS tile. */
  valid?: Uint8Array;
}
