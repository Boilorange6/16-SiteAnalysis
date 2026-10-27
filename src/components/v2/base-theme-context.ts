import { createContext } from "react";
import type { BaseThemeRef } from "@/lib/v2/ui/map-theme";

/** 보드가 고른 벡터 바탕 테마(프리셋 id 또는 만든 색). 값이 없으면 MapFigure가 기본 테마를 쓴다. 카드·펼침·보고서 표면이 같은 값을 따른다. */
export const BaseThemeContext = createContext<BaseThemeRef | undefined>(undefined);
