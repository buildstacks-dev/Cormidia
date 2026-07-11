// Shared read side for the org-home learning record stores (experiments,
// eval results, interventions): one existsSync/readFile/validate path and
// one readdir/prefix-filter/sort/parse loop, so crash behavior and
// diagnostics cannot drift per store. Errors name the offending FILE — a
// hand-edited or merge-conflicted record in the committed org home should
// fail loudly and identifiably, and the CLI report catches per store so one
// bad governance file cannot take the whole human window down.

import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

export async function readJsonRecord<T>(
  path: string,
  validate: (value: unknown) => T,
  missingMessage: string,
): Promise<T> {
  if (!existsSync(path)) throw new Error(missingMessage);
  return parseValidated(path, await readFile(path, "utf8"), validate);
}

/** Every `<prefix>*.json` record in `dir`, filename-sorted. Records sharing
 *  a directory route by id prefix (spec §1: experiments + eval results). */
export async function listJsonRecords<T>(
  dir: string,
  prefix: string,
  validate: (value: unknown) => T,
): Promise<T[]> {
  if (!existsSync(dir)) return [];
  const records: T[] = [];
  const names = (await readdir(dir))
    .filter((name) => name.startsWith(prefix) && name.endsWith(".json"))
    .sort();
  for (const name of names) {
    const path = join(dir, name);
    records.push(parseValidated(path, await readFile(path, "utf8"), validate));
  }
  return records;
}

function parseValidated<T>(path: string, raw: string, validate: (value: unknown) => T): T {
  try {
    return validate(JSON.parse(raw));
  } catch (error) {
    throw new Error(`learning: ${path}: ${(error as Error).message}`);
  }
}

/** The one torn-tail JSONL read contract every learning ledger shares
 *  (learning events, rejections): a malformed FINAL line is a torn append
 *  and is dropped; a malformed line anywhere else is corruption and throws
 *  loudly. Returns [] for a missing file. */
export async function readJsonLinesTolerant<T>(path: string): Promise<T[]> {
  if (!existsSync(path)) return [];
  const lines = (await readFile(path, "utf8")).split("\n").filter((line) => line !== "");
  const out: T[] = [];
  lines.forEach((line, i) => {
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      if (i !== lines.length - 1) {
        throw new Error(
          `learning: ${path}:${i + 1} is malformed mid-file — corruption, not a torn append`,
        );
      }
    }
  });
  return out;
}
