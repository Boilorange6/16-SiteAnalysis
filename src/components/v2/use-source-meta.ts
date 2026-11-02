"use client";

import { useEffect, useMemo, useState } from "react";
import type { SourceMeta } from "@/lib/v2/ui/source-details";
import { sourceIdsForRefs } from "@/lib/v2/ui/source-api";
import type { TileView } from "@/lib/v2/ui/tile-view";
import { readSourceMeta } from "./source-panel";

const NO_META: ReadonlyMap<string, SourceMeta> = new Map();

/**
 * 보고서 계획(출처 장·각주 띠)이 쓰는 서버 출처 메타. 출처 팝오버와 같은 읽기(readSourceMeta)를 쓴다.
 * 늦게 오면 Map이 바뀌어 계획이 다시 계산되고, 실패하면 빈 Map이라 계획은 정의 표로 내려간다.
 */
export function useSourceMeta(views: ReadonlyMap<string, TileView>): ReadonlyMap<string, SourceMeta> {
  const ids = useMemo(() => sourceIdsForRefs([...views.values()].flatMap((view) => view.sourceRefs)), [views]);
  const requestKey = ids.join(",");
  const [loaded, setLoaded] = useState<{ key: string; meta: ReadonlyMap<string, SourceMeta> } | null>(null);
  useEffect(() => {
    if (!requestKey) return;
    let active = true;
    readSourceMeta(requestKey.split(",")).then((meta) => { if (active) setLoaded({ key: requestKey, meta }); }, () => {});
    return () => { active = false; };
  }, [requestKey]);
  return loaded?.key === requestKey ? loaded.meta : NO_META;
}
