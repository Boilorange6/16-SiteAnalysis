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
  readonly value: unknown;
};

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
  constructor(readonly recoveryBackupPaths: readonly string[], cause: unknown) {
    super(`Rollback incomplete. Manual recovery backups retained: ${recoveryBackupPaths.join(", ")}`, { cause });
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

async function removeIndependently(paths: readonly string[], operations: ArtifactFileOperations): Promise<void> {
  await Promise.allSettled(paths.map((path) => operations.removeFile({ path })));
}

async function restoreIndependently(artifacts: readonly Artifact[], operations: ArtifactFileOperations): Promise<readonly string[]> {
  const results = await Promise.allSettled(artifacts.map((artifact) => operations.move({ from: artifact.backupPath, to: artifact.finalPath })));
  return artifacts.filter((_artifact, index) => results[index]?.status === "rejected").map((artifact) => artifact.backupPath);
}

function artifactSet(outputDirectory: string, nonce: string, values: readonly (readonly [string, unknown])[]): readonly Artifact[] {
  const root = resolve(outputDirectory);
  return values.map(([name, value]) => ({
    finalPath: join(root, name),
    temporaryPath: join(root, `${name}.tmp-${nonce}`),
    backupPath: join(root, `${name}.backup-${nonce}`),
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
    const recoveryPaths = await restoreIndependently(backedUp, operations);
    await removeIndependently(artifacts.map((artifact) => artifact.temporaryPath), operations);
    if (recoveryPaths.length > 0) throw new ArtifactRollbackError(recoveryPaths, error);
    throw error;
  }
  try {
    for (const [index, artifact] of artifacts.entries()) {
      if (request.promote) await request.promote({ ...artifact, index });
      else await operations.move({ from: artifact.temporaryPath, to: artifact.finalPath });
    }
  } catch (error) {
    await removeIndependently(artifacts.map((artifact) => artifact.finalPath), operations);
    const recoveryPaths = await restoreIndependently(backedUp, operations);
    await removeIndependently(artifacts.map((artifact) => artifact.temporaryPath), operations);
    if (recoveryPaths.length > 0) throw new ArtifactRollbackError(recoveryPaths, error);
    throw error;
  }
  await removeIndependently(artifacts.flatMap((artifact) => [artifact.temporaryPath, artifact.backupPath]), operations);
}
