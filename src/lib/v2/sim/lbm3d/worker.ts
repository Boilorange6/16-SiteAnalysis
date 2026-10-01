import { runLbm3d, type Lbm3dField } from "./gpu";
import type { Lbm3dCase } from "./plan";

export type Lbm3dWorkerRequest =
  | { type: "run"; id?: string; case: Lbm3dCase }
  | { type: "cancel"; id?: string };

export type Lbm3dWorkerMessage =
  | { type: "progress"; id?: string; step: number; steps: number; mlups: number; elapsedMs: number }
  | { type: "result"; id?: string; field: Lbm3dField }
  | { type: "error"; id?: string; name: string; message: string };

interface WorkerScopeLike {
  onmessage: ((event: { data: Lbm3dWorkerRequest }) => void) | null;
  postMessage: (message: Lbm3dWorkerMessage, transfer?: Transferable[]) => void;
}
function transferForField(field: Lbm3dField): Transferable[] {
  return field.layers.flatMap((layer) => [layer.u.buffer, layer.v.buffer]);
}

/** Install the message bridge; exported for a tiny host-side smoke test. */
export function installLbm3dWorker(scope: WorkerScopeLike): void {
  let active: { id?: string; controller: AbortController } | null = null;
  scope.onmessage = (event) => {
    const request = event.data;
    if (request.type === "cancel") {
      if (!request.id || !active || active.id === request.id) active?.controller.abort();
      return;
    }
    active?.controller.abort();
    const controller = new AbortController();
    active = { id: request.id, controller };
    void runLbm3d(request.case, {
      signal: controller.signal,
      onProgress: (progress) => scope.postMessage({ type: "progress", id: request.id, ...progress }),
    }).then((field) => {
      if (active?.controller !== controller) return;
      scope.postMessage({ type: "result", id: request.id, field }, transferForField(field));
    }).catch((error: unknown) => {
      if (active?.controller !== controller) return;
      const normalized = error instanceof Error ? error : new Error(String(error));
      scope.postMessage({ type: "error", id: request.id, name: normalized.name, message: normalized.message });
    }).finally(() => {
      if (active?.controller === controller) active = null;
    });
  };
}

const workerGlobal = globalThis as unknown as Partial<WorkerScopeLike>;
if (typeof workerGlobal.postMessage === "function" && "onmessage" in workerGlobal) {
  installLbm3dWorker(workerGlobal as WorkerScopeLike);
}
