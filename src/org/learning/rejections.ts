// Rejection ledger with suppression windows (docs/learning-loop/
// learning-loop-spec.md §13 `rejections`; design §3 "Rejection ledger").
//
// `learning/rejections.jsonl` in the committed org home is gate-protected:
// humans and the publisher append; agents never. A rejected candidate
// suppresses re-proposals of the same lesson for `suppress_days` unless the
// new candidate carries `override_if_evidence_x` times the evidence the
// rejected one had — repeated evidence is exactly the signal that a
// rejection was wrong.
//
// The suppression key is `error_class` when the candidate has one (the
// stable clustering key, spec §4) and the content hash otherwise: a reworded
// candidate about the same recurring failure still suppresses, while two
// unrelated candidates never collide.

import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CandidateArtifact } from "./candidate.js";
import type { LearningPolicy } from "./policy.js";

export interface RejectionEntry {
  rejected_at: string;
  candidate_id: string;
  content_hash: string;
  suppress_key: string;
  destination: string;
  proposed_scope: string;
  /** Distinct evidence the candidate carried when rejected. */
  evidence_count: number;
  reason: string;
  by: string;
}

export function rejectionsPath(orgHome: string): string {
  return join(orgHome, "learning", "rejections.jsonl");
}

export function suppressKeyFor(
  candidate: Pick<CandidateArtifact, "error_class" | "content_hash">,
): string {
  return candidate.error_class ?? candidate.content_hash;
}

export function evidenceCountFor(
  candidate: Pick<CandidateArtifact, "episode_ids" | "event_ids" | "evidence_refs">,
): number {
  return new Set([...candidate.episode_ids, ...candidate.event_ids, ...candidate.evidence_refs])
    .size;
}

export interface AppendRejectionInput {
  candidate: CandidateArtifact;
  reason: string;
  by: string;
  now?: Date;
}

export async function appendRejection(
  orgHome: string,
  input: AppendRejectionInput,
): Promise<RejectionEntry> {
  const entry: RejectionEntry = {
    rejected_at: (input.now ?? new Date()).toISOString(),
    candidate_id: input.candidate.candidate_id,
    content_hash: input.candidate.content_hash,
    suppress_key: suppressKeyFor(input.candidate),
    destination: input.candidate.destination,
    proposed_scope: input.candidate.proposed_scope,
    evidence_count: evidenceCountFor(input.candidate),
    reason: input.reason,
    by: input.by,
  };
  const path = rejectionsPath(orgHome);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, JSON.stringify(entry) + "\n", "utf8");
  return entry;
}

/** Same torn-tail contract as every learning JSONL surface: a malformed
 *  FINAL line is a torn append and is dropped; malformed anywhere else is
 *  corruption and throws. */
export async function readRejections(orgHome: string): Promise<RejectionEntry[]> {
  const path = rejectionsPath(orgHome);
  if (!existsSync(path)) return [];
  const lines = (await readFile(path, "utf8")).split("\n").filter((line) => line !== "");
  const entries: RejectionEntry[] = [];
  lines.forEach((line, i) => {
    try {
      entries.push(JSON.parse(line) as RejectionEntry);
    } catch {
      if (i !== lines.length - 1) {
        throw new Error(
          `learning: ${path}:${i + 1} is malformed mid-file — corruption, not a torn append`,
        );
      }
    }
  });
  return entries;
}

export interface SuppressionCheck {
  suppressed: boolean;
  /** The ledger entry doing the suppressing, when suppressed. */
  entry?: RejectionEntry;
  /** ISO time the window closes, when suppressed. */
  until?: string;
  /** Evidence the candidate would need to override the window. */
  evidenceNeeded?: number;
}

/** Is this candidate inside a rejection's suppression window (policy §13)?
 *  Overridden when its evidence count reaches `override_if_evidence_x`
 *  times the rejected entry's. */
export async function checkSuppression(
  orgHome: string,
  candidate: CandidateArtifact,
  policy: LearningPolicy,
  now: Date = new Date(),
): Promise<SuppressionCheck> {
  const key = suppressKeyFor(candidate);
  const windowMs = policy.rejections.suppress_days * 24 * 60 * 60 * 1000;
  const entries = (await readRejections(orgHome)).filter(
    (entry) =>
      entry.suppress_key === key &&
      now.getTime() - new Date(entry.rejected_at).getTime() < windowMs,
  );
  if (entries.length === 0) return { suppressed: false };

  // The strictest live entry governs: the one demanding the most evidence.
  const governing = entries.reduce((a, b) => (b.evidence_count > a.evidence_count ? b : a));
  const needed = Math.max(1, governing.evidence_count * policy.rejections.override_if_evidence_x);
  if (evidenceCountFor(candidate) >= needed) return { suppressed: false };
  return {
    suppressed: true,
    entry: governing,
    until: new Date(new Date(governing.rejected_at).getTime() + windowMs).toISOString(),
    evidenceNeeded: needed,
  };
}
