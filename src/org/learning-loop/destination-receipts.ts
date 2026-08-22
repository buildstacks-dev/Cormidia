// File-backed idempotency receipts shared by the Cormidia publication
// destinations (kernel contract §Publication destination; decision 0026). A
// destination answers a repeated idempotency key with the receipt it stored
// for that key, refuses the same key for a different effect, and never
// re-applies — the receipt is written LAST, after the effect's own durable
// writes, so a crash between the two resumes by re-deriving the applied fact
// from the destination's own state (manifest history, file digest), never by
// trusting a receipt that was never written.

import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { LearningLoopError, parsePublicationReceipt, sha256HexOfCanonicalJson } from "@cormidia/learning-loop";
import type { JsonValue, PublicationReceipt } from "@cormidia/learning-loop";
import { writeFileAtomic } from "../atomic.js";

export interface StoredDestinationReceipt {
  readonly effectDigest: string;
  readonly receipt: PublicationReceipt;
}

const DIGEST_RE = /^[0-9a-f]{64}$/;

export function destinationRefusal(code: string, message: string): LearningLoopError {
  return new LearningLoopError(code, [{ code, severity: "error", message }]);
}

function receiptPath(dir: string, idempotencyKey: string): string {
  return join(dir, `${sha256HexOfCanonicalJson({ idempotencyKey })}.json`);
}

/** Parse a stored receipt file from unknown bytes; a malformed file is a
 *  loud refusal (store.corrupt), never an absent receipt. */
function parseStored(raw: string, path: string): StoredDestinationReceipt {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw destinationRefusal("store.corrupt", `destination receipt ${path} is not JSON`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw destinationRefusal("store.corrupt", `destination receipt ${path} must be an object`);
  }
  const effectDigest: unknown = Reflect.get(parsed, "effectDigest");
  if (typeof effectDigest !== "string" || !DIGEST_RE.test(effectDigest)) {
    throw destinationRefusal("store.corrupt", `destination receipt ${path} carries no effect digest`);
  }
  return { effectDigest, receipt: parsePublicationReceipt(Reflect.get(parsed, "receipt")) };
}

export async function readDestinationReceipt(
  dir: string,
  idempotencyKey: string,
): Promise<StoredDestinationReceipt | undefined> {
  const path = receiptPath(dir, idempotencyKey);
  if (!existsSync(path)) return undefined;
  return parseStored(await readFile(path, "utf8"), path);
}

export async function writeDestinationReceipt(
  dir: string,
  idempotencyKey: string,
  stored: StoredDestinationReceipt,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  const value: JsonValue = { effectDigest: stored.effectDigest, receipt: { ...stored.receipt } };
  await writeFileAtomic(receiptPath(dir, idempotencyKey), `${JSON.stringify(value, null, 2)}\n`);
}

/** Resolve a repeated key: the stored receipt for the identical effect, a
 *  refusal for a different effect, or undefined when the key is new. */
export async function resolveRepeatedKey(
  dir: string,
  idempotencyKey: string,
  effectDigest: string,
): Promise<PublicationReceipt | undefined> {
  const known = await readDestinationReceipt(dir, idempotencyKey);
  if (known === undefined) return undefined;
  if (known.effectDigest !== effectDigest) {
    throw destinationRefusal(
      "publication.receipt_mismatch",
      `idempotency key "${idempotencyKey}" was used for another effect`,
    );
  }
  return { ...known.receipt };
}
