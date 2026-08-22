// Unmerged proposal drafts as a kernel PublicationDestination (kernel contract
// §Publication destination; Cormidia design §3/§6.1): a skill draft, protocol
// proposal, or eval/gate proposal lands as ONE file under the learning root's
// `proposals/<skills|protocol|gates>/`, exactly the bytes the reviewed
// candidate carries. The file is inert — the merge into a ratified surface
// stays human-gated wherever it always was — so the destination is
// `proposal` class and the routine lane may authorize it at T0/T1 (the host
// authority port enforces that bound). Compensation withdraws the draft.

import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  parsePreparedEffect,
  parsePublicationReceipt,
  sha256HexOfCanonicalJson,
  toJsonValue,
} from "@cormidia/learning-loop";
import type {
  Candidate,
  Clock,
  JsonValue,
  PreparedEffect,
  PublicationDestination,
  PublicationReceipt,
} from "@cormidia/learning-loop";
import { writeFileAtomic } from "../atomic.js";
import { rootKindForScope, type LearningRoot } from "./host/concepts.js";
import { destinationRefusal, resolveRepeatedKey, writeDestinationReceipt } from "./destination-receipts.js";
import { loopScopeFromScope } from "./scope.js";

export const PROPOSAL_EFFECT_KIND = "proposal.draft.write";
export const PROPOSAL_KINDS = ["skill_draft", "protocol_proposal", "eval_or_gate_proposal"] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

const PROPOSAL_DIR: Record<ProposalKind, string> = {
  skill_draft: "skills",
  protocol_proposal: "protocol",
  eval_or_gate_proposal: "gates",
};

export interface ProposalDestinationOptions {
  /** Destination id, unique per registered root (`proposal:org`, `proposal:app:<name>`). */
  readonly id: string;
  readonly root: LearningRoot;
  readonly receiptsDir: string;
  readonly clock?: Clock;
}

function stringField(value: JsonValue, key: string): string | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const field: unknown = Reflect.get(value, key);
  return typeof field === "string" ? field : undefined;
}

function proposalKindOf(candidate: Candidate): ProposalKind {
  for (const kind of PROPOSAL_KINDS) if (candidate.intervention.kind === kind) return kind;
  throw destinationRefusal(
    "publication.effect_invalid",
    `intervention kind "${candidate.intervention.kind}" is not a proposal kind (${PROPOSAL_KINDS.join(" | ")})`,
  );
}

/** The proposal draft path for a candidate artifact id, relative to the root. */
export function proposalDraftPath(kind: ProposalKind, artifactId: string): string {
  return `proposals/${PROPOSAL_DIR[kind]}/${artifactId}.md`;
}

function assertProposalPath(path: string, kind: ProposalKind): void {
  const prefix = `proposals/${PROPOSAL_DIR[kind]}/`;
  const name = path.slice(prefix.length);
  if (!path.startsWith(prefix) || !/^[A-Za-z0-9._-]+\.md$/.test(name) || /^\.+\.md$/.test(name)) {
    throw destinationRefusal("publication.effect_invalid", `proposal path "${path}" is not ${prefix}<name>.md`);
  }
}

export function createProposalDestination(options: ProposalDestinationOptions): PublicationDestination {
  const { id, root, receiptsDir } = options;
  const clock = options.clock ?? { now: () => new Date().toISOString() };

  const receiptFor = (effect: PreparedEffect, idempotencyKey: string, finalVersion: string): PublicationReceipt =>
    parsePublicationReceipt({
      destinationId: id,
      effectId: effect.id,
      target: effect.target,
      ...(effect.expectedBase !== undefined ? { expectedBase: effect.expectedBase } : {}),
      finalVersion,
      payloadDigest: effect.payloadDigest,
      idempotencyKey,
      appliedAt: clock.now(),
    });

  return {
    id,
    prepare: async (input) => {
      const candidate = input.candidate;
      if (input.expectedBase !== undefined) {
        throw destinationRefusal("publication.effect_invalid", "proposal drafts carry no base version");
      }
      const kind = proposalKindOf(candidate);
      const scope = loopScopeFromScope(candidate.scope);
      if (scope === undefined || rootKindForScope(scope) !== root.kind) {
        throw destinationRefusal(
          "publication.effect_invalid",
          `candidate scope does not live in the ${root.kind} learning root`,
        );
      }
      const markdown = stringField(candidate.intervention.content, "markdown");
      const path = stringField(candidate.intervention.content, "path");
      if (markdown === undefined || path === undefined) {
        throw destinationRefusal("publication.effect_invalid", "proposal content must carry markdown and path");
      }
      assertProposalPath(path, kind);
      const payload: JsonValue = { path, kind, markdown };
      return [
        parsePreparedEffect({
          id: `draft:${path}`,
          kind: PROPOSAL_EFFECT_KIND,
          target: path,
          payload,
          payloadDigest: sha256HexOfCanonicalJson(payload),
          afterEffect: { kind: "compensate", payload: { path } },
        }),
      ];
    },
    applyEffect: async (input) => {
      const effect = parsePreparedEffect(input.effect);
      const idempotencyKey = input.idempotencyKey;
      if (idempotencyKey.length === 0)
        throw destinationRefusal("publication.effect_invalid", "idempotency key must be non-empty");
      const effectDigest = sha256HexOfCanonicalJson(toJsonValue(effect));
      const repeated = await resolveRepeatedKey(receiptsDir, idempotencyKey, effectDigest);
      if (repeated !== undefined) return repeated;
      const path = stringField(effect.payload, "path");
      if (path === undefined || path !== effect.target || !path.startsWith("proposals/") || path.includes("..")) {
        throw destinationRefusal("publication.effect_invalid", `proposal payload path does not name the target`);
      }
      const absolute = join(root.dir, path);
      let finalVersion: string;
      if (effect.kind === "compensate") {
        await rm(absolute, { force: true });
        finalVersion = "withdrawn";
      } else {
        const markdown = stringField(effect.payload, "markdown");
        if (markdown === undefined)
          throw destinationRefusal("publication.effect_invalid", "proposal payload carries no markdown");
        if (existsSync(absolute) && (await readFile(absolute, "utf8")) !== markdown) {
          throw destinationRefusal("publication.base_mismatch", `${path} already holds different bytes`);
        }
        await mkdir(dirname(absolute), { recursive: true });
        await writeFileAtomic(absolute, markdown);
        finalVersion = effect.payloadDigest;
      }
      const receipt = receiptFor(effect, idempotencyKey, finalVersion);
      await writeDestinationReceipt(receiptsDir, idempotencyKey, { effectDigest, receipt });
      return receipt;
    },
  };
}
