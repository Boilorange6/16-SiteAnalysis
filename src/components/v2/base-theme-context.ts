import { createContext } from "react";
import type { BaseThemeId } from "@/lib/v2/ui/map-theme";

/** 보드가 고른 벡터 바탕 테마. 값이 없으면 MapFigure가 기본 테마를 쓴다. 카드·펼침·보고서 표면이 같은 값을 따른다. */
export const BaseThemeContext = createContext<BaseThemeId | undefined>(undefined);
