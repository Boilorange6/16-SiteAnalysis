import type { MaintenanceCatalogProject, Poi, SourceStatus } from "../types";

/**
 * 독립 POI 원천을 동시에 수집한다.
 *
 * 기존에는 공원 → 정비사업 → OSM → 주거를 순차로 기다려 총 소요가 원천별 합계였다.
 * 실제로 앞선 결과에 의존하는 것은 실거래 결합과 준공 교차검증뿐이므로,
 * 그 앞 단계는 병렬로 돌리고 결과만 선언 순서로 병합한다.
 */
export interface SourceTaskResult {
  readonly pois?: readonly Poi[];
  readonly sources?: readonly SourceStatus[];
  readonly warnings?: readonly string[];
  readonly catalog?: readonly MaintenanceCatalogProject[];
}

export interface SourceTask {
  /** 실패 시 경고에 실릴 원천 이름 */
  readonly name: string;
  readonly run: () => Promise<SourceTaskResult>;
}

export interface CollectResult {
  readonly pois: readonly Poi[];
  readonly sources: readonly SourceStatus[];
  readonly warnings: readonly string[];
  readonly catalog: readonly MaintenanceCatalogProject[];
  readonly aborted: boolean;
}

/** 원천 하나가 끝날 때마다 방출되는 진행 이벤트 */
export interface SourceProgressEvent {
  readonly name: string;
  readonly ok: boolean;
  readonly poiCount: number;
  /** 지금까지 완료한 원천 수 / 전체 */
  readonly done: number;
  readonly total: number;
}

export async function collectSourcesInParallel(
  tasks: readonly SourceTask[],
  options: {
    readonly signal?: AbortSignal;
    /** 원천이 끝날 때마다 호출 — 전체 완료를 기다리지 않고 진행 상황을 알린다 */
    readonly onProgress?: (event: SourceProgressEvent) => void;
  } = {},
): Promise<CollectResult> {
  const empty: CollectResult = { pois: [], sources: [], warnings: [], catalog: [], aborted: false };
  if (options.signal?.aborted) return { ...empty, aborted: true };
  if (!tasks.length) return empty;

  let done = 0;
  const settled = await Promise.all(tasks.map(async (task) => {
    try {
      const result = await task.run();
      done += 1;
      options.onProgress?.({
        name: task.name, ok: true, poiCount: result.pois?.length ?? 0, done, total: tasks.length,
      });
      return { task, result, failed: false as const };
    } catch (error) {
      console.warn(`[poi-collection] ${task.name} 실패`, error);
      done += 1;
      options.onProgress?.({ name: task.name, ok: false, poiCount: 0, done, total: tasks.length });
      return { task, result: {} as SourceTaskResult, failed: true as const };
    }
  }));

  const pois: Poi[] = [];
  const sources: SourceStatus[] = [];
  const warnings: string[] = [];
  const catalog: MaintenanceCatalogProject[] = [];
  // 선언 순서로 병합 — 완료 순서에 따라 결과가 흔들리지 않게 한다
  for (const entry of settled) {
    if (entry.failed) {
      warnings.push(entry.task.name);
      continue;
    }
    if (entry.result.pois) pois.push(...entry.result.pois);
    if (entry.result.sources) sources.push(...entry.result.sources);
    if (entry.result.warnings) warnings.push(...entry.result.warnings);
    if (entry.result.catalog) catalog.push(...entry.result.catalog);
  }
  return { pois, sources, warnings, catalog, aborted: options.signal?.aborted ?? false };
}
