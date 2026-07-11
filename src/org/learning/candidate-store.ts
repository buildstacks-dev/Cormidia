// Candidate storage (docs/learning-loop/learning-loop-spec.md §3, §9):
// `learning/candidates/` under each root, deliberately OUTSIDE the
// gate-protected surfaces — agents emit candidates freely, and a candidate
// carries no authority until it passes review and the publisher moves it.
//
// Two files per structured candidate:
//   candidates/<candidate_id>.json  — the CandidateArtifact contract (M3)
//   candidates/<candidate_id>.md    — the OKF concept draft, only when the
//                                     destination is okf_concept (loop.status
//                                     "candidate"; the publisher rewrites it
//                                     to "active" on publish)
// Free-form learning notes (M1 end-of-turn protocol) share the same tree
// under per-role subdirectories; they are distillation input (M6), not
// publishable candidates, and this module ignores them.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "../atomic.js";
import { validateCandidateArtifact, type CandidateArtifact } from "./candidate.js";
import { candidatesDir, type LearningRoot } from "./concepts.js";
import { listJsonRecords, readJsonRecord } from "./records.js";

export function candidateArtifactPath(root: LearningRoot, candidateId: string): string {
  return join(candidatesDir(root), `${candidateId}.json`);
}

/** The OKF concept draft paired with an okf_concept candidate. */
export function conceptDraftPath(root: LearningRoot, candidateId: string): string {
  return join(candidatesDir(root), `${candidateId}.md`);
}

export async function writeCandidateArtifact(
  root: LearningRoot,
  value: unknown,
): Promise<CandidateArtifact> {
  const candidate = validateCandidateArtifact(value);
  await mkdir(candidatesDir(root), { recursive: true });
  await writeFileAtomic(
    candidateArtifactPath(root, candidate.candidate_id),
    JSON.stringify(candidate, null, 2) + "\n",
  );
  return candidate;
}

export async function readCandidateArtifact(
  root: LearningRoot,
  candidateId: string,
): Promise<CandidateArtifact> {
  return readJsonRecord(
    candidateArtifactPath(root, candidateId),
    validateCandidateArtifact,
    `learning: no candidate ${candidateId} under ${candidatesDir(root)}`,
  );
}

export async function listCandidateArtifacts(root: LearningRoot): Promise<CandidateArtifact[]> {
  return listJsonRecords(candidatesDir(root), "cand_", validateCandidateArtifact);
}

/** Locate a candidate across roots (org home first, then apps) — `learn
 *  review`/`publish` take an id, not a root. */
export async function findCandidateArtifact(
  roots: LearningRoot[],
  candidateId: string,
): Promise<{ root: LearningRoot; candidate: CandidateArtifact } | undefined> {
  for (const root of roots) {
    if (!existsSync(candidateArtifactPath(root, candidateId))) continue;
    return { root, candidate: await readCandidateArtifact(root, candidateId) };
  }
  return undefined;
}

/** Hash of the candidate JSON file bytes as stored — what the approval
 *  binding's candidate_hash pins (spec §14). Mutating the file after
 *  approval changes this hash and voids the approval. */
export async function candidateArtifactHash(
  root: LearningRoot,
  candidateId: string,
): Promise<string> {
  const path = candidateArtifactPath(root, candidateId);
  if (!existsSync(path)) {
    throw new Error(`learning: no candidate ${candidateId} under ${candidatesDir(root)}`);
  }
  return sha256Ref(await readFile(path));
}

export function sha256Ref(bytes: Buffer | string): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
