/** 보드에 표시하는 백그라운드 작업·내보내기 상태의 순수 화면 규칙. */

export type BoardJobStatus = "queued" | "running" | "done" | "failed";

export type BoardJob = {
  code: string;
  status: BoardJobStatus;
  enqueuedAt?: string | null;
  startedAt?: string | null;
  elapsedMs?: number | null;
};

export type JobDisplay = {
  code: string;
  phase: "pending" | "running";
  queueAhead: number;
  elapsedMs: number | null;
  note: string;
};

export type JobProgress = {
  total: number;
  completed: number;
  queued: number;
  running: number;
  elapsedMs: number | null;
  waitingLabel: string | null;
  retryLabel: string;
  byCode: Map<string, JobDisplay>;
};

function timestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatElapsedMs(elapsedMs: number | null): string {
  if (elapsedMs === null || !Number.isFinite(elapsedMs)) return "시간 미확인";
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  if (seconds < 60) return `${seconds}초`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes}분` : `${minutes}분 ${rest}초`;
}

function liveElapsed(job: BoardJob, nowMs: number): number | null {
  if ((job.status === "done" || job.status === "failed") && typeof job.elapsedMs === "number" && Number.isFinite(job.elapsedMs)) {
    return Math.max(0, job.elapsedMs);
  }
  const origin = timestamp(job.status === "running" ? (job.startedAt ?? job.enqueuedAt) : job.enqueuedAt);
  return origin === null ? null : Math.max(0, nowMs - origin);
}

function jobNote(phase: JobDisplay["phase"], queueAhead: number, elapsedMs: number | null): string {
  const state = phase === "pending" ? `대기 중 — 앞선 작업 ${queueAhead}개` : "계산 중";
  return `${state} · 경과 ${formatElapsedMs(elapsedMs)} · 오래 걸리면 다시 시도`;
}

export function jobProgress(jobs: readonly BoardJob[], nowMs = Date.now()): JobProgress {
  const active = jobs.filter((job) => job.status === "queued" || job.status === "running");
  const queued = active.filter((job) => job.status === "queued").length;
  const running = active.filter((job) => job.status === "running").length;
  const completed = jobs.filter((job) => job.status === "done" || job.status === "failed").length;
  const enqueued = active.map((job) => timestamp(job.enqueuedAt)).filter((value): value is number => value !== null);
  const fallbackStarts = active.map((job) => timestamp(job.startedAt)).filter((value): value is number => value !== null);
  const earliest = enqueued.length > 0 ? Math.min(...enqueued) : (fallbackStarts.length > 0 ? Math.min(...fallbackStarts) : null);
  const byCode = new Map<string, JobDisplay>();
  let queueAhead = 0;
  for (const job of jobs) {
    if (job.status !== "queued" && job.status !== "running") continue;
    const phase = job.status === "queued" ? "pending" : "running";
    const elapsedMs = liveElapsed(job, nowMs);
    byCode.set(job.code, { code: job.code, phase, queueAhead, elapsedMs, note: jobNote(phase, queueAhead, elapsedMs) });
    queueAhead += 1;
  }
  return {
    total: jobs.length,
    completed,
    queued,
    running,
    elapsedMs: earliest === null ? null : Math.max(0, nowMs - earliest),
    waitingLabel: queued > 0 ? `대기 중 — 앞선 작업 ${queued}개` : (running > 0 ? "계산 중" : null),
    retryLabel: "오래 걸리면 다시 시도",
    byCode,
  };
}

export type ExportOption = {
  enabled: boolean;
  reason: string | null;
  pendingNote: string | null;
};

export type ExportAvailability = {
  ppt: ExportOption;
  dxf: ExportOption;
  glb: ExportOption;
  dae: ExportOption;
  "3dm": ExportOption;
};

export function exportAvailability({ activeJobs, making, requesting = false, sceneReady }: { activeJobs: boolean; making: boolean; requesting?: boolean; sceneReady: boolean }): ExportAvailability {
  const blockedReason = making ? "다른 내보내기가 진행 중입니다." : (requesting ? "새 분석을 준비 중입니다." : null);
  const sceneReason = blockedReason ?? (sceneReady ? null : "장면이 아직 준비되지 않았습니다.");
  const sceneOption = (pendingNote: string | null = null): ExportOption => ({ enabled: sceneReady && !making && !requesting, reason: sceneReason, pendingNote });
  return {
    ppt: {
      enabled: !making && !requesting,
      reason: blockedReason,
      pendingNote: activeJobs ? "계산 중인 타일은 PPT에 '계산 중'으로 표시됩니다." : null,
    },
    dxf: sceneOption(),
    glb: sceneOption(),
    dae: sceneOption(),
    "3dm": sceneOption(),
  };
}
