// fixtures/learning-parity/inputs.ts — the EXACT inputs the forked
// deterministic engine consumed when `captured/` was recorded (see CAPTURE.md):
// episode records, candidate artifacts, concept drafts, reviewer verdicts, the
// captured learning event, the fixed clock, and the approval-id scheme. The
// kernel-path parity spec replays these unchanged; any edit here invalidates
// the captured oracle and must be accompanied by a re-capture (the digests
// file pins the oracle's bytes).

import { createHash } from "node:crypto";
import type { LearningEvent } from "../../../src/org/learning-loop/host/events.js";
import { serializeOkfDocument } from "../../../src/org/memory.js";

export const PARITY_ORG = "acme";
export const PARITY_CLOCK_START = "2026-08-21T12:00:00.000Z";
export const PARITY_APP = "web";

export function parityApprovalIdSource(): () => string {
  let sequence = 0;
  return () => `parity-approval-${String(++sequence).padStart(2, "0")}`;
}

export function sha256Ref(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function conceptDraft(input: {
  conceptId: string;
  name: string;
  scope: string;
  tier?: "T0" | "T1" | "T2" | "T3";
  body: string;
}): string {
  return serializeOkfDocument({
    frontmatter: {
      name: input.name,
      description: `learning concept ${input.name}`,
      type: "lesson",
      keywords: ["typecheck", "review"],
      evidence: ["ep_web_ticket_0042"],
      status: "active",
      created: "2026-08-21",
      updated: "2026-08-21",
      loop: {
        id: input.conceptId,
        tier: input.tier ?? "T1",
        status: "candidate",
        scope: input.scope,
        version: 1,
        claim: "authorized",
        topic_key: `topic.${input.name}`,
      },
    },
    body: input.body,
  });
}

export function episodeRecord(episodeId: string, ticket: string, closed: boolean): Record<string, unknown> {
  return {
    schema_version: 1,
    episode_id: episodeId,
    kind: "build_ticket",
    app: PARITY_APP,
    source: { kind: "github_issue", ref: ticket },
    stage: null,
    risk_tier: null,
    opened: "2026-08-20T09:00:00.000Z",
    ...(closed ? { closed: "2026-08-20T10:00:00.000Z" } : {}),
    status: closed ? "closed" : "open",
    fingerprint_ref: null,
    bundle_lineage: null,
    turns: [],
    gates: [
      { gate: "typecheck", status: "fail", run_id: "run-1" },
      { gate: "typecheck", status: "pass", run_id: "run-2" },
    ],
    approvals: [],
    artifacts: [],
    side_effects: [],
    ...(closed
      ? {
          outcome: {
            completed: true,
            merged: true,
            release_disposition: "merged",
            review_cycles: 2,
            gate_failures: 1,
            human_interventions: 1,
            cost_usd: 1.25,
            cost_estimated: false,
            unsettled_runs: [],
            terminal_reason: "completed",
          },
        }
      : {}),
    late_outcomes: closed ? [{ kind: "revert", ref: "pr-7", recorded: "2026-08-21T08:00:00.000Z" }] : [],
    human_observations: [],
  };
}

export const PARITY_EPISODES: ReadonlyArray<readonly [string, string, boolean]> = [
  ["ep_web_ticket_0042", "web#42", true],
  ["ep_web_ticket_0043", "web#43", true],
  ["ep_web_ticket_0044", "web#44", false],
];

export function candidateSpec(input: {
  id: string;
  destination: string;
  scope: string;
  tier?: string;
  title: string;
  errorClass?: string;
  episodeIds: string[];
  draft?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    candidate_id: input.id,
    destination: input.destination,
    title: input.title,
    proposed_scope: input.scope,
    proposed_tier: input.tier ?? "T1",
    claims_efficacy: false,
    experiment_ref: null,
    ...(input.errorClass !== undefined ? { error_class: input.errorClass } : {}),
    episode_ids: input.episodeIds,
    event_ids: [],
    evidence_refs: [],
    content_hash: sha256Ref(`candidate-content:${input.id}`),
    ...(input.draft !== undefined ? { draft: input.draft } : {}),
  };
}

export function verdictSpec(input: {
  id: string;
  destination: string;
  scope: string;
  tier?: string;
  verdict?: string;
  rationale?: string;
}): Record<string, unknown> {
  return {
    schema_version: 1,
    candidate_id: input.id,
    verdict: input.verdict ?? "approve",
    proposed_destination: input.destination,
    proposed_tier: input.tier ?? "T1",
    proposed_scope: input.scope,
    experiment_required: false,
    rubric: {
      correctness: 4,
      generality: 4,
      scope_fit: 4,
      destination_fit: 4,
      provenance_trust: 4,
      injection_screen: "clean",
    },
    conflicts_with: [],
    duplicates: [],
    eval_required: false,
    eval_present: false,
    rationale: input.rationale ?? `rationale for ${input.id}`,
    reviewed_by: "human:parity-reviewer",
    reviewed_at: "2026-08-21T11:00:00.000Z",
  };
}

/** The captured orchestrator error event that ties episode → candidate. */
export function parityErrorEvent(ts: string): LearningEvent {
  return {
    event_id: "evt_parity_error_1",
    episode_id: "ep_web_ticket_0042",
    turn_id: "turn_parity_capture",
    ts,
    app: PARITY_APP,
    type: "error",
    error_class: "build.typecheck-before-done",
    emitter: "orchestrator",
    source_channel: "internal",
    trust: "trusted",
  };
}

export const PARITY_ORG_CANDIDATE = {
  id: "cand_parity_org",
  conceptId: "lrn_parity_org",
  name: "parity-org-lesson",
  scope: "org",
  spec: () =>
    candidateSpec({
      id: "cand_parity_org",
      destination: "okf_concept",
      scope: "org",
      title: "type-check before reporting done",
      errorClass: "build.typecheck-before-done",
      episodeIds: ["ep_web_ticket_0042"],
      draft: { generated_by: "distiller", source_app: PARITY_APP, topic_key: "topic.parity-org-lesson" },
    }),
  draft: () =>
    conceptDraft({
      conceptId: "lrn_parity_org",
      name: "parity-org-lesson",
      scope: "org",
      body: "Run the repository type-check before reporting completion.\n",
    }),
  verdict: () => verdictSpec({ id: "cand_parity_org", destination: "okf_concept", scope: "org" }),
} as const;

export const PARITY_APP_CANDIDATE = {
  id: "cand_parity_app",
  conceptId: "lrn_parity_app",
  name: "parity-app-lesson",
  scope: "apps/web",
  spec: () =>
    candidateSpec({
      id: "cand_parity_app",
      destination: "okf_concept",
      scope: "apps/web",
      title: "web: run the contract tests before review",
      episodeIds: ["ep_web_ticket_0042", "ep_web_ticket_0043"],
      draft: { generated_by: "distiller", source_app: PARITY_APP },
    }),
  draft: () =>
    conceptDraft({
      conceptId: "lrn_parity_app",
      name: "parity-app-lesson",
      scope: "apps/web",
      body: "Run the contract tests before requesting review on web.\n",
    }),
  verdict: () => verdictSpec({ id: "cand_parity_app", destination: "okf_concept", scope: "apps/web" }),
} as const;

export const PARITY_SKILL_CANDIDATE = {
  id: "cand_parity_skill",
  scope: "roles/builder",
  spec: () =>
    candidateSpec({
      id: "cand_parity_skill",
      destination: "skill_draft",
      scope: "roles/builder",
      tier: "T0",
      title: "builder: verify the default branch before diffing",
      episodeIds: ["ep_web_ticket_0043"],
      draft: { generated_by: "distiller", markdown: "# Verify the default branch\n\nResolve it; never guess.\n" },
    }),
  verdict: () =>
    verdictSpec({ id: "cand_parity_skill", destination: "skill_draft", scope: "roles/builder", tier: "T0" }),
} as const;

export const PARITY_REJECT_CANDIDATE = {
  id: "cand_parity_reject",
  spec: () =>
    candidateSpec({
      id: "cand_parity_reject",
      destination: "skill_draft",
      scope: "org",
      title: "noise",
      errorClass: "tooling.parity-flaky",
      episodeIds: ["ep_web_ticket_0043"],
    }),
  verdict: () =>
    verdictSpec({
      id: "cand_parity_reject",
      destination: "reject",
      scope: "org",
      rationale: "recurring noise, not a lesson",
    }),
} as const;

/** The governed resolve the capture pinned after the four publishes. */
export const PARITY_RESOLVE = {
  turnId: "turn_parity_1",
  episodeId: "ep_web_ticket_0044",
  role: "builder",
  taskText: "fix the typecheck failure on the review branch",
} as const;
