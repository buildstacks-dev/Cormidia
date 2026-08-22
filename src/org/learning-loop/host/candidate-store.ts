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

import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "../../atomic.js";
import { parseOkfDocument } from "../../memory.js";
import { validateCandidateArtifact, type CandidateArtifact } from "./candidate.js";
import { assertConceptPlacement, candidatesDir, type LearningRoot } from "./concepts.js";
import { listJsonRecords, readJsonRecord } from "./records.js";
import { sha256Ref } from "./validate.js";

export { sha256Ref };

export function candidateArtifactPath(root: LearningRoot, candidateId: string): string {
  return join(candidatesDir(root), `${candidateId}.json`);
}

/** The OKF concept draft paired with an okf_concept candidate. */
export function conceptDraftPath(root: LearningRoot, candidateId: string): string {
  return join(candidatesDir(root), `${candidateId}.md`);
}

/** Governed candidate-store entry point used by M6. It is create-only: a
 * deterministic id may be replayed with byte-identical content, but a later
 * model response cannot silently rewrite evidence that is already awaiting
 * review. OKF concept drafts are validated against the candidate placement
 * contract before either file is written. */
export async function openCandidateArtifact(
  root: LearningRoot,
  value: unknown,
  conceptMarkdown?: string,
): Promise<{ candidate: CandidateArtifact; created: boolean }> {
  const candidate = validateCandidateArtifact(value);
  const path = candidateArtifactPath(root, candidate.candidate_id);
  const serialized = JSON.stringify(candidate, null, 2) + "\n";

  if (candidate.destination === "okf_concept") {
    if (conceptMarkdown === undefined) {
      throw new Error(`learning: ${candidate.candidate_id}: okf_concept needs a concept draft`);
    }
    assertConceptPlacement(
      parseOkfDocument(conceptMarkdown, conceptDraftPath(root, candidate.candidate_id)),
      "candidates",
    );
  } else if (conceptMarkdown !== undefined) {
    throw new Error(`learning: ${candidate.candidate_id}: only okf_concept candidates may carry a concept draft`);
  }

  if (existsSync(path)) {
    const existing = await readFile(path, "utf8");
    if (existing !== serialized) {
      throw new Error(
        `learning: ${candidate.candidate_id} already exists with different bytes — ` +
          "distillation is append-only; create a new evidence-bound candidate",
      );
    }
    if (conceptMarkdown !== undefined) {
      const draftPath = conceptDraftPath(root, candidate.candidate_id);
      if (!existsSync(draftPath) || (await readFile(draftPath, "utf8")) !== conceptMarkdown) {
        throw new Error(`learning: ${candidate.candidate_id} concept draft differs from its existing candidate`);
      }
    }
    return { candidate, created: false };
  }

  await mkdir(candidatesDir(root), { recursive: true });
  // For an OKF pair, JSON is the commit marker listCandidateArtifacts sees:
  // write the draft first so a crash can leave only an ignored draft, never a
  // reviewable candidate whose required concept bytes are absent.
  if (conceptMarkdown !== undefined) {
    await writeFileAtomic(conceptDraftPath(root, candidate.candidate_id), conceptMarkdown);
  }
  await writeFileAtomic(path, serialized);
  return { candidate, created: true };
}

async function readCandidateArtifact(root: LearningRoot, candidateId: string): Promise<CandidateArtifact> {
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
export async function candidateArtifactHash(root: LearningRoot, candidateId: string): Promise<string> {
  const path = candidateArtifactPath(root, candidateId);
  if (!existsSync(path)) {
    throw new Error(`learning: no candidate ${candidateId} under ${candidatesDir(root)}`);
  }
  return sha256Ref(await readFile(path));
}
