/**
 * 데이터 버전 전환 (spec §3.4).
 *
 * 데이터 파일은 versions/<version>/ 아래에 완성된 뒤 바뀌지 않는다.
 * 현재 버전은 manifest.json 하나가 가리키고, 그 파일을 rename으로 원자 교체한다.
 * 게시한 모든 manifest는 manifests/<hash>.json에 보관해, 저장된 프로젝트가 옛 버전을 다시 열 수 있게 한다.
 */
import { createHash } from "node:crypto";
import { closeSync, copyFileSync, createReadStream, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";
import { canonicalJson, sha256Hex } from "../canonical-json";
import { DATA_FILE_KINDS, type DataFileKind } from "./schema";
import type { GateFailure, GateResult } from "./quality-gate";

export const MANIFEST_FILE = "manifest.json";
export const PREVIOUS_MANIFEST_FILE = "manifest.prev.json";
export const MANIFEST_ARCHIVE_DIR = "manifests";
export const VERSIONS_DIR = "versions";

export type ManifestFileKind = DataFileKind | "pmtiles" | "dem" | "epw";

export interface ManifestFile {
  /** dataDir 기준 상대경로, "/" 구분, 반드시 versions/ 아래 */
  path: string;
  sha256: string;
  kind: ManifestFileKind;
  schemaVersion: number;
}

export interface Manifest {
  version: string;
  createdAt: string;
  files: Record<string, ManifestFile>;
}

export type ManifestErrorCode =
  | "MISSING_FILE"
  | "HASH_MISMATCH"
  | "PATH_ESCAPE"
  | "WAL_PRESENT"
  | "POST_PUBLISH_MISMATCH"
  | "NO_PREVIOUS"
  | "MISSING_PINNED_MANIFEST"
  | "UNKNOWN_FILE_KEY"
  | "LOCKED";

const LOCK_FILE = ".lock";

export class ManifestError extends Error {
  readonly name = "ManifestError";
  constructor(readonly code: ManifestErrorCode, message: string) {
    super(message);
  }
}

export function manifestHash(m: Manifest): string {
  return sha256Hex(canonicalJson(m));
}

/** 전국 파일은 수 GB라 스트림으로 읽는다 */
export function sha256File(path: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolvePromise(hash.digest("hex")));
  });
}

export function resolveDataPath(dataDir: string, relPath: string): string {
  const root = resolve(dataDir);
  const abs = resolve(root, relPath);
  // 정규형만 허용한다: `./`, `//`, `..`, 역슬래시 경로는 GC가 쓰는 정규화 경로와 달라 살아 있는 파일을 지우게 된다.
  if (
    !relPath.startsWith(`${VERSIONS_DIR}/`) ||
    !abs.startsWith(root + sep + VERSIONS_DIR + sep) ||
    relPath !== relative(root, abs).split(sep).join("/")
  ) {
    throw new ManifestError("PATH_ESCAPE", `path must be canonical and stay under ${VERSIONS_DIR}/: ${relPath}`);
  }
  return abs;
}

/**
 * dataDir 전체에 대한 배타 잠금. publishManifest와 collectGarbage는 이 잠금 안에서만 돈다.
 * 앞으로 만들 데이터 빌더도 versions/<v>/ 파일을 이 잠금을 쥔 채 만들어야 한다.
 * 그래야 GC가 아직 게시되지 않은 빌드 결과를 지우지 못한다.
 * ponytail: 크래시로 남은 낡은 잠금은 사람이 .lock을 지워야 한다. 불편해지면 잠금 나이/pid 검사를 추가한다.
 */
export async function withDataDirLock<T>(dataDir: string, fn: () => T | Promise<T>): Promise<T> {
  mkdirSync(dataDir, { recursive: true });
  const lockPath = join(dataDir, LOCK_FILE);
  let fd: number;
  try {
    fd = openSync(lockPath, "wx");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") throw new ManifestError("LOCKED", `data dir is locked: ${lockPath}`);
    throw e;
  }
  try {
    try {
      writeSync(fd, `${process.pid} ${new Date().toISOString()}\n`);
    } finally {
      closeSync(fd);
    }
    return await fn();
  } finally {
    rmSync(lockPath, { force: true });
  }
}

function readJson(path: string): Manifest | null {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Manifest) : null;
}

export function readManifest(dataDir: string): Manifest | null {
  return readJson(join(dataDir, MANIFEST_FILE));
}

export function readArchivedManifest(dataDir: string, hash: string): Manifest | null {
  return readJson(join(dataDir, MANIFEST_ARCHIVE_DIR, `${hash}.json`));
}

export async function verifyManifestFiles(dataDir: string, m: Manifest): Promise<void> {
  for (const [key, file] of Object.entries(m.files)) {
    const abs = resolveDataPath(dataDir, file.path);
    if (!existsSync(abs)) throw new ManifestError("MISSING_FILE", `${key}: ${file.path}`);
    if ((DATA_FILE_KINDS as readonly string[]).includes(file.kind) && existsSync(`${abs}-wal`)) {
      throw new ManifestError("WAL_PRESENT", `${key}: close the database before publishing (${file.path}-wal)`);
    }
    const actual = await sha256File(abs);
    if (actual !== file.sha256) throw new ManifestError("HASH_MISMATCH", `${key}: expected ${file.sha256}, got ${actual}`);
  }
}

export async function publishManifest(
  dataDir: string,
  candidate: Manifest,
  check: (m: Manifest) => GateResult | Promise<GateResult>,
): Promise<{ published: boolean; hash: string; failures: GateFailure[] }> {
  return withDataDirLock(dataDir, async () => {
    await verifyManifestFiles(dataDir, candidate);
    const hash = manifestHash(candidate);
    const gate = await check(candidate);
    if (!gate.ok) return { published: false, hash, failures: gate.failures };

    // 검사 도중 파일이 사라졌을 수 있다. 쓰기 전에 다시 확인한다.
    for (const [key, file] of Object.entries(candidate.files)) {
      if (!existsSync(resolveDataPath(dataDir, file.path))) throw new ManifestError("MISSING_FILE", `${key}: ${file.path} vanished before publish`);
    }

    mkdirSync(join(dataDir, MANIFEST_ARCHIVE_DIR), { recursive: true });
    writeFileSync(join(dataDir, MANIFEST_ARCHIVE_DIR, `${hash}.json`), JSON.stringify(candidate, null, 2));

    const current = join(dataDir, MANIFEST_FILE);
    const hadPrevious = existsSync(current);
    let currentHash: string | null = null;
    try {
      const cur = readManifest(dataDir);
      currentHash = cur ? manifestHash(cur) : null;
    } catch {
      // 깨진 현재본은 다른 것으로 취급해 이전본 자리로 보낸다
    }
    if (hadPrevious && currentHash !== hash) {
      const prevTmp = join(dataDir, `${PREVIOUS_MANIFEST_FILE}.tmp`);
      copyFileSync(current, prevTmp);
      renameSync(prevTmp, join(dataDir, PREVIOUS_MANIFEST_FILE));
    }
    const tmp = `${current}.tmp`;
    writeFileSync(tmp, JSON.stringify(candidate, null, 2));
    renameSync(tmp, current);

    const reread = readManifest(dataDir);
    if (!reread || manifestHash(reread) !== hash) {
      if (hadPrevious) await rollbackManifest(dataDir);
      else rmSync(current, { force: true });
      throw new ManifestError("POST_PUBLISH_MISMATCH", "manifest.json does not match the published candidate");
    }
    return { published: true, hash, failures: [] };
  });
}

export async function rollbackManifest(dataDir: string): Promise<void> {
  const previous = join(dataDir, PREVIOUS_MANIFEST_FILE);
  if (!existsSync(previous)) throw new ManifestError("NO_PREVIOUS", "no previous manifest to roll back to");
  let prev: Manifest;
  try {
    prev = JSON.parse(readFileSync(previous, "utf8")) as Manifest;
    if (!prev || typeof prev.files !== "object" || prev.files === null) throw new Error("bad shape");
  } catch {
    throw new ManifestError("NO_PREVIOUS", `${PREVIOUS_MANIFEST_FILE} is unreadable`);
  }
  await verifyManifestFiles(dataDir, prev);
  const tmp = join(dataDir, `${MANIFEST_FILE}.tmp`);
  copyFileSync(previous, tmp);
  renameSync(tmp, join(dataDir, MANIFEST_FILE));
}

function* walkFiles(dir: string): Generator<string> {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkFiles(abs);
    else yield abs;
  }
}

export function collectGarbage(dataDir: string, pinnedHashes: ReadonlySet<string>): Promise<{ deleted: string[] }> {
  return withDataDirLock(dataDir, () => collectGarbageLocked(dataDir, pinnedHashes));
}

function collectGarbageLocked(dataDir: string, pinnedHashes: ReadonlySet<string>): { deleted: string[] } {
  const keepFiles = new Set<string>();
  const keepManifests = new Set<string>();
  const keep = (m: Manifest) => {
    keepManifests.add(manifestHash(m));
    for (const f of Object.values(m.files)) keepFiles.add(f.path);
  };

  for (const name of [MANIFEST_FILE, PREVIOUS_MANIFEST_FILE]) {
    const m = readJson(join(dataDir, name));
    if (m) keep(m);
  }
  // 하나라도 핀 원본이 없으면 무엇이 쓰이는지 모르는 것이다 — 아무것도 지우지 않는다.
  for (const hash of pinnedHashes) {
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new ManifestError("MISSING_PINNED_MANIFEST", `invalid pinned manifest hash: ${hash}`);
    const m = readArchivedManifest(dataDir, hash);
    if (!m) throw new ManifestError("MISSING_PINNED_MANIFEST", `pinned manifest ${hash} not found`);
    keep(m);
    keepManifests.add(hash);
  }

  const deleted: string[] = [];
  for (const abs of walkFiles(join(dataDir, VERSIONS_DIR))) {
    const rel = relative(dataDir, abs).split(sep).join("/");
    if (keepFiles.has(rel)) continue;
    rmSync(abs);
    deleted.push(rel);
  }
  for (const abs of walkFiles(join(dataDir, MANIFEST_ARCHIVE_DIR))) {
    const hash = basename(abs, ".json");
    if (keepManifests.has(hash)) continue;
    rmSync(abs);
    deleted.push(`${MANIFEST_ARCHIVE_DIR}/${basename(abs)}`);
  }
  return { deleted: deleted.sort() };
}

export function openDataFile(dataDir: string, m: Manifest, key: string): BetterSqlite3.Database {
  const file = m.files[key];
  if (!file) throw new ManifestError("UNKNOWN_FILE_KEY", `manifest has no file "${key}"`);
  return new Database(resolveDataPath(dataDir, file.path), { readonly: true, fileMustExist: true });
}
