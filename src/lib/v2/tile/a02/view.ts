import type { TileClientModule } from "../types";

export const a02ClientModule = {
  code: "A02",
  headline: { ids: ["in_school_zone", "nearest_elem_m"] },
  caveat: "배정은 교육청 확인",
  layers: {
    options: [{ id: "all", label: "기본 학교" }, { id: "school_zone", label: "학구·학교군" }],
  },
} satisfies TileClientModule;
