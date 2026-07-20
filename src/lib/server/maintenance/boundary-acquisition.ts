import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { z } from "zod";
import type { BoundarySource } from "./boundary-build";

export interface AcquisitionMetadata extends BoundarySource {
  readonly metadataFile: string;
  readonly metadataSha256: string;
}

export class AcquisitionMetadataError extends Error {
  readonly name = "AcquisitionMetadataError";
  constructor(readonly code: "MISSING_SIDECAR" | "INVALID_SIDECAR", readonly metadataPath: string) {
    super(`${code === "MISSING_SIDECAR" ? "Missing" : "Invalid"} acquisition metadata sidecar: ${metadataPath}`);
  }
}

function isCalendarIso(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2})))?$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return false;
  if (match[4] === undefined) return true;
  return Number(match[4]) <= 23 && Number(match[5]) <= 59 && Number(match[6]) <= 59
    && Number(match[7]) <= 23 && Number(match[8]) <= 59;
}

const calendarIso = z.string().refine(isCalendarIso);
const provenanceCommon = z.object({
  schema_version: z.literal(1),
  retrieved_at: calendarIso,
  source_updated_at: calendarIso.optional(),
  source_url: z.string().url(),
}).strict();

const acquisitionMetadataSchema = z.union([
  provenanceCommon.extend({ source_dataset_id: z.literal("30335"), source_layer: z.literal("UD602") }).strict(),
  provenanceCommon.extend({ source_dataset_id: z.literal("30336"), source_layer: z.literal("UD501") }).strict(),
]);

export async function readAcquisitionMetadata(request: { readonly archivePath: string }): Promise<AcquisitionMetadata> {
  const metadataPath = `${request.archivePath}.metadata.json`;
  let bytes: Buffer;
  try {
    bytes = await readFile(metadataPath);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new AcquisitionMetadataError("MISSING_SIDECAR", metadataPath);
    }
    throw error;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) throw new AcquisitionMetadataError("INVALID_SIDECAR", metadataPath);
    throw error;
  }
  const parsed = acquisitionMetadataSchema.safeParse(raw);
  if (!parsed.success) throw new AcquisitionMetadataError("INVALID_SIDECAR", metadataPath);
  return {
    sourceUrl: parsed.data.source_url,
    retrievedAt: parsed.data.retrieved_at,
    sourceDatasetId: parsed.data.source_dataset_id,
    sourceLayer: parsed.data.source_layer,
    ...(parsed.data.source_updated_at ? { sourceUpdatedAt: parsed.data.source_updated_at } : {}),
    metadataFile: basename(metadataPath),
    metadataSha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
