import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export interface ArtifactMoveRequest {
  readonly from: string;
  readonly to: string;
}

export interface ArtifactPathRequest {
  readonly path: string;
}

export interface ArtifactWriteRequest extends ArtifactPathRequest {
  readonly contents: string;
}

export interface ArtifactFileOperations {
  readonly makeDirectory: (request: ArtifactPathRequest) => Promise<void>;
  readonly writeText: (request: ArtifactWriteRequest) => Promise<void>;
  readonly move: (request: ArtifactMoveRequest) => Promise<void>;
  readonly removeFile: (request: ArtifactPathRequest) => Promise<void>;
}

type Artifact = {
  readonly finalPath: string;
  readonly temporaryPath: string;
  readonly backupPath: string;
  readonly recoveryPath: string;
  readonly value: unknown;
};

export interface ArtifactOperationFailure {
  readonly path: string;
  readonly operation: "remove" | "restore" | "isolate_partial";
  readonly cause: unknown;
}

export interface ArtifactPromoteRequest extends Artifact {
  readonly index: number;
}

export interface BoundaryArtifactWriteRequest {
  readonly outputDirectory: string;
  readonly geojson: unknown;
  readonly metadata: unknown;
  readonly quarantine: unknown;
  readonly fileOperations?: ArtifactFileOperations;
  readonly promote?: (request: ArtifactPromoteRequest) => Promise<void>;
}

export class ArtifactRollbackError extends Error {
  readonly name = "ArtifactRollbackError";
  readonly recoveryBackupPaths: readonly string[];
  readonly survivingPartialPaths: readonly string[];
  readonly operationFailures: readonly ArtifactOperationFailure[];
  constructor(request: {
    readonly recoveryBackupPaths: readonly string[];
    readonly survivingPartialPaths: readonly string[];
    readonly operationFailures: readonly ArtifactOperationFailure[];
    readonly cause: unknown;
  }) {
    const backups = request.recoveryBackupPaths.length > 0 ? ` Manual recovery backups retained: ${request.recoveryBackupPaths.join(", ")}.` : "";
    const partials = request.survivingPartialPaths.length > 0 ? ` Surviving partial artifacts retained for recovery: ${request.survivingPartialPaths.join(", ")}.` : "";
    super(`Rollback incomplete.${backups}${partials}`, { cause: request.cause });
    this.recoveryBackupPaths = request.recoveryBackupPaths;
    this.survivingPartialPaths = request.survivingPartialPaths;
    this.operationFailures = request.operationFailures;
  }
}

export class ArtifactPublishedCleanupError extends Error {
  readonly name = "ArtifactPublishedCleanupError";
  constructor(readonly cleanupFailures: readonly ArtifactOperationFailure[]) {
    super(`Artifacts published consistently, but cleanup incomplete: ${cleanupFailures.map((failure) => failure.path).join(", ")}`);
  }
}

const DEFAULT_FILE_OPERATIONS: ArtifactFileOperations = {
  makeDirectory: async ({ path }) => { await mkdir(path, { recursive: true }); },
  writeText: async ({ path, contents }) => { await writeFile(path, contents, "utf8"); },
  move: async ({ from, to }) => { await rename(from, to); },
  removeFile: async ({ path }) => { await rm(path, { force: true }); },
};

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function backupIfPresent(request: { readonly artifact: Artifact; readonly operations: ArtifactFileOperations }): Promise<boolean> {
  try {
    await request.operations.move({ from: request.artifact.finalPath, to: request.artifact.backupPath });
    return true;
  } catch (error) {
    if (isMissingFile(error)) return false;
    throw error;
  }
}

async function removeIndependently(paths: readonly string[], operations: ArtifactFileOperations): Promise<readonly ArtifactOperationFailure[]> {
  const results = await Promise.all(paths.map(async (path): Promise<readonly ArtifactOperationFailure[]> => {
    try {
      await operations.removeFile({ path });
      return [];
    } catch (cause) {
      return [{ path, operation: "remove", cause }];
    }
  }));
  return results.flat();
}

async function restoreIndependently(artifacts: readonly Artifact[], operations: ArtifactFileOperations): Promise<readonly ArtifactOperationFailure[]> {
  return (await Promise.all(artifacts.map(async (artifact): Promise<readonly ArtifactOperationFailure[]> => {
    try {
      await operations.move({ from: artifact.backupPath, to: artifact.finalPath });
      return [];
    } catch (cause) {
      return [{ path: artifact.backupPath, operation: "restore", cause }];
    }
  }))).flat();
}

async function isolatePartialFinals(request: {
  readonly removalFailures: readonly ArtifactOperationFailure[];
  readonly artifacts: readonly Artifact[];
  readonly operations: ArtifactFileOperations;
}): Promise<{ readonly recoveryPaths: readonly string[]; readonly failures: readonly ArtifactOperationFailure[] }> {
  const results = await Promise.all(request.removalFailures.map(async (failure) => {
    const artifact = request.artifacts.find((candidate) => candidate.finalPath === failure.path);
    if (!artifact) return { recoveryPath: failure.path, failures: [failure] };
    try {
      await request.operations.move({ from: artifact.finalPath, to: artifact.recoveryPath });
      return { recoveryPath: artifact.recoveryPath, failures: [failure] };
    } catch (cause) {
      return { recoveryPath: artifact.finalPath, failures: [failure, { path: artifact.finalPath, operation: "isolate_partial" as const, cause }] };
    }
  }));
  return { recoveryPaths: results.map((result) => result.recoveryPath), failures: results.flatMap((result) => result.failures) };
}

function artifactSet(outputDirectory: string, nonce: string, values: readonly (readonly [string, unknown])[]): readonly Artifact[] {
  const root = resolve(outputDirectory);
  return values.map(([name, value]) => ({
    finalPath: join(root, name),
    temporaryPath: join(root, `${name}.tmp-${nonce}`),
    backupPath: join(root, `${name}.backup-${nonce}`),
    recoveryPath: join(root, `${name}.recovery-${nonce}`),
    value,
  }));
}

export async function writeBoundaryArtifactsAtomically(request: BoundaryArtifactWriteRequest): Promise<void> {
  const operations = request.fileOperations ?? DEFAULT_FILE_OPERATIONS;
  const artifacts = artifactSet(request.outputDirectory, `${process.pid}-${Date.now()}`, [
    ["boundaries.geojson", request.geojson],
    ["boundaries.meta.json", request.metadata],
    ["boundaries.quarantine.json", request.quarantine],
  ]);
  await operations.makeDirectory({ path: resolve(request.outputDirectory) });
  try {
    await Promise.all(artifacts.map((artifact) => operations.writeText({ path: artifact.temporaryPath, contents: `${JSON.stringify(artifact.value, null, 2)}\n` })));
  } catch (error) {
    await removeIndependently(artifacts.map((artifact) => artifact.temporaryPath), operations);
    throw error;
  }
  const backedUp: Artifact[] = [];
  try {
    for (const artifact of artifacts) if (await backupIfPresent({ artifact, operations })) backedUp.push(artifact);
  } catch (error) {
    const restoreFailures = await restoreIndependently(backedUp, operations);
    const tempFailures = await removeIndependently(artifacts.map((artifact) => artifact.temporaryPath), operations);
    const failures = [...restoreFailures, ...tempFailures];
    if (failures.length > 0) throw new ArtifactRollbackError({
      recoveryBackupPaths: restoreFailures.map((failure) => failure.path),
      survivingPartialPaths: tempFailures.map((failure) => failure.path),
      operationFailures: failures,
      cause: error,
    });
    throw error;
  }
  try {
    for (const [index, artifact] of artifacts.entries()) {
      if (request.promote) await request.promote({ ...artifact, index });
      else await operations.move({ from: artifact.temporaryPath, to: artifact.finalPath });
    }
  } catch (error) {
    const finalRemovalFailures = await removeIndependently(artifacts.map((artifact) => artifact.finalPath), operations);
    const isolated = await isolatePartialFinals({ removalFailures: finalRemovalFailures, artifacts, operations });
    const restoreFailures = await restoreIndependently(backedUp, operations);
    const tempFailures = await removeIndependently(artifacts.map((artifact) => artifact.temporaryPath), operations);
    const failures = [...isolated.failures, ...restoreFailures, ...tempFailures];
    const survivingPartialPaths = [...isolated.recoveryPaths, ...tempFailures.map((failure) => failure.path)];
    if (failures.length > 0) throw new ArtifactRollbackError({
      recoveryBackupPaths: restoreFailures.map((failure) => failure.path),
      survivingPartialPaths,
      operationFailures: failures,
      cause: error,
    });
    throw error;
  }
  const cleanupFailures = await removeIndependently(artifacts.flatMap((artifact) => [artifact.temporaryPath, artifact.backupPath]), operations);
  if (cleanupFailures.length > 0) throw new ArtifactPublishedCleanupError(cleanupFailures);
}
