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
 * `ready`는 요청이 끝났는지(성공·실패 모두)다. 끝나기 전에 내보내면 PPT 출처 장이 정의 표로만 나가므로 내보내기·발표가 이 값을 기다린다.
 */
export function useSourceMeta(views: ReadonlyMap<string, TileView>): { meta: ReadonlyMap<string, SourceMeta>; ready: boolean } {
  const ids = useMemo(() => sourceIdsForRefs([...views.values()].flatMap((view) => view.sourceRefs)), [views]);
  const requestKey = ids.join(",");
  const [loaded, setLoaded] = useState<{ key: string; meta: ReadonlyMap<string, SourceMeta> } | null>(null);
  useEffect(() => {
    if (!requestKey) return;
    let active = true;
    const done = (meta: ReadonlyMap<string, SourceMeta>) => { if (active) setLoaded({ key: requestKey, meta }); };
    // 요청이 걸려도 내보내기가 영영 막히지 않게 8초 뒤에는 정의 표 폴백으로 푼다.
    const giveUp = setTimeout(() => done(NO_META), 8000);
    readSourceMeta(requestKey.split(",")).then(done, () => done(NO_META)).finally(() => clearTimeout(giveUp));
    return () => { active = false; clearTimeout(giveUp); };
  }, [requestKey]);
  const current = loaded?.key === requestKey;
  return { meta: current ? loaded.meta : NO_META, ready: !requestKey || current };
}
