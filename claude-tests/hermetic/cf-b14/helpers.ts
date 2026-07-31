// CF-B14 shared helpers — detectors and tree oracles for the B-14 family
// (contracts/B-14-human-checkout.md; boundary-map.md §B-14).
//
// Two harness-side detectors live here, each proven by a named
// "negative control: …" test in the specs (README rule 3 — a detector that
// has never fired is an assumption):
// - assertHumanBytesPreserved — the clobber detector (INV-010 adjacency:
//   human-owned bytes are never silently altered by a lifecycle command);
// - assertWritesContained — the containment detector (contract §2: a
//   lifecycle command touches only its authorized generated paths).
//
// Tree snapshots go through fixtures/walk.ts so every sweep is a non-empty
// walk (README rule 4 — no green by absence).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assertNonEmptyWalk } from "../../fixtures/walk.js";

/** Relative-path pattern that keeps `.git/**` out of checkout snapshots —
 *  git's own bookkeeping churns (index, logs) without being a B-14 write. */
export const NOT_GIT = /^(?!\.git\/)/;

/** Snapshot every non-`.git` file under `dir` as rel path -> exact bytes.
 *  Uses assertNonEmptyWalk: an empty or missing tree fails the sweep loudly. */
export async function snapshotTree(dir: string): Promise<Map<string, string>> {
  const files = await assertNonEmptyWalk(dir, NOT_GIT);
  const snapshot = new Map<string, string>();
  for (const rel of files) snapshot.set(rel, readFileSync(join(dir, rel), "utf8"));
  return snapshot;
}

export interface TreeDiff {
  added: string[];
  removed: string[];
  changed: string[];
}

export function diffSnapshots(before: Map<string, string>, after: Map<string, string>): TreeDiff {
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const [rel, bytes] of after) {
    const prior = before.get(rel);
    if (prior === undefined) added.push(rel);
    else if (prior !== bytes) changed.push(rel);
  }
  for (const rel of before.keys()) {
    if (!after.has(rel)) removed.push(rel);
  }
  added.sort();
  removed.sort();
  changed.sort();
  return { added, removed, changed };
}

/** The CF-B14 containment detector (contract §2): the command's observed tree
 *  diff must stay inside its authorized created/updated sets — nothing else
 *  added, nothing else changed, nothing removed. Throws (fires) on any
 *  unauthorized write so a sweep can prove it with a seeded violation. */
export function assertWritesContained(
  diff: TreeDiff,
  authorized: { added: Iterable<string>; changed: Iterable<string> },
): void {
  const allowedAdded = new Set(authorized.added);
  const allowedChanged = new Set(authorized.changed);
  const violations: string[] = [
    ...diff.added.filter((rel) => !allowedAdded.has(rel)).map((rel) => `unauthorized add: ${rel}`),
    ...diff.changed
      .filter((rel) => !allowedChanged.has(rel))
      .map((rel) => `unauthorized change: ${rel}`),
    ...diff.removed.map((rel) => `unauthorized removal: ${rel}`),
  ];
  if (violations.length > 0) {
    throw new Error(`CF-B14 containment detector: ${violations.join("; ")}`);
  }
}

/** The CF-B14 clobber detector (F-PT-007 / contract §3): human-owned bytes at
 *  `abs` must still be exactly `expected`. Throws (fires) on any drift. */
export function assertHumanBytesPreserved(abs: string, expected: string): void {
  const actual = readFileSync(abs, "utf8");
  if (actual !== expected) {
    throw new Error(
      `CF-B14 clobber detector: human bytes at ${abs} were altered ` +
        `(expected ${JSON.stringify(expected.slice(0, 80))}, ` +
        `found ${JSON.stringify(actual.slice(0, 80))})`,
    );
  }
}

export function countOccurrences(text: string, needle: string): number {
  let count = 0;
  let index = text.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(needle, index + needle.length);
  }
  return count;
}

/** Minimal valid questionnaire answers for a bootstrap run. */
export function answersFor(role: string): Record<string, unknown> {
  return {
    product: "CF-B14 fixture product — a checkout-interference probe target.",
    good: "Bootstrap-owned writes stay inside their authorized paths.",
    roles: [role],
  };
}
