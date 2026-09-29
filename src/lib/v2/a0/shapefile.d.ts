declare module "shapefile" {
  import type { Feature } from "geojson";
  interface Source {
    read(): Promise<{ done: true; value: undefined } | { done: false; value: Feature }>;
  }
  export function open(shp: string, dbf?: string, options?: { encoding?: string }): Promise<Source>;
}
