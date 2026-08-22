// GitHub tickets as a kernel PublicationDestination (kernel contract
// §Publication destination; Cormidia design §6.1): a deduplicated, rate-capped
// internal issue carrying the candidate fingerprint marker, opened through
// the app's GhOps — an outward `proposal`-class write that enters the issue
// loop humans already triage, so the routine lane may authorize it at T0/T1.
// Dedupe by marker makes the create step crash-safe: a resume finds the issue
// this effect's bytes name instead of filing a twin. Compensation closes it.

import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
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
import type { GhOps } from "../../loop/github.js";
import { destinationRefusal, resolveRepeatedKey, writeDestinationReceipt } from "./destination-receipts.js";

export const TICKET_EFFECT_KIND = "github.issue.create";
export const LEARNING_TICKET_LABEL = "op:learning";
export const FINGERPRINT_MARKER = "cormidia:candidate-fingerprint";

export interface TicketCaps {
  readonly max_open_per_app: number;
  readonly max_new_per_week: number;
}

export interface TicketDestinationOptions {
  /** Destination id, unique per app (`ticket:app:<name>`). */
  readonly id: string;
  readonly receiptsDir: string;
  /** The app's GitHub seam, resolved lazily: composing a loop must never
   *  touch the network, and an app without a configured repo refuses at
   *  apply time, never at composition. */
  readonly gh: () => GhOps | undefined;
  readonly caps: TicketCaps;
  readonly clock?: Clock;
}

function stringField(value: JsonValue, key: string): string | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const field: unknown = Reflect.get(value, key);
  return typeof field === "string" ? field : undefined;
}

/** The marker line the issue body carries — what dedupe and compensation find. */
export function fingerprintMarker(fingerprint: string): string {
  return `<!-- ${FINGERPRINT_MARKER} ${fingerprint} -->`;
}

/** Forward receipts applied within the trailing week — the policy §13 weekly cap. */
async function ticketsCreatedSince(receiptsDir: string, sinceMs: number): Promise<number> {
  if (!existsSync(receiptsDir)) return 0;
  let count = 0;
  for (const name of await readdir(receiptsDir)) {
    if (!name.endsWith(".json")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(join(receiptsDir, name), "utf8"));
    } catch {
      continue;
    }
    if (parsed === null || typeof parsed !== "object") continue;
    const receipt: unknown = Reflect.get(parsed, "receipt");
    if (receipt === null || typeof receipt !== "object") continue;
    const appliedAt: unknown = Reflect.get(receipt, "appliedAt");
    const effectId: unknown = Reflect.get(receipt, "effectId");
    const finalVersion: unknown = Reflect.get(receipt, "finalVersion");
    if (typeof appliedAt !== "string" || typeof effectId !== "string" || typeof finalVersion !== "string") continue;
    if (effectId.startsWith("ticket:") && !finalVersion.endsWith(":closed") && Date.parse(appliedAt) >= sinceMs) {
      count += 1;
    }
  }
  return count;
}

export function createTicketDestination(options: TicketDestinationOptions): PublicationDestination {
  const { id, receiptsDir, caps } = options;
  const clock = options.clock ?? { now: () => new Date().toISOString() };

  const receiptFor = (effect: PreparedEffect, idempotencyKey: string, finalVersion: string): PublicationReceipt =>
    parsePublicationReceipt({
      destinationId: id,
      effectId: effect.id,
      target: effect.target,
      finalVersion,
      payloadDigest: effect.payloadDigest,
      idempotencyKey,
      appliedAt: clock.now(),
    });

  const requireGh = (): GhOps => {
    const gh = options.gh();
    if (gh === undefined) {
      throw destinationRefusal(
        "publication.destination_failed",
        `${id}: the ticket destination needs a configured GitHub repository (apps.yaml repo or --repo)`,
      );
    }
    return gh;
  };

  const findOpen = async (gh: GhOps, fingerprint: string): Promise<number | undefined> => {
    const open = await gh.listIssues({ state: "open", labels: [LEARNING_TICKET_LABEL] });
    return open.find((issue) => issue.body.includes(fingerprintMarker(fingerprint)))?.number;
  };

  return {
    id,
    prepare: async (input) => {
      const candidate: Candidate = input.candidate;
      if (input.expectedBase !== undefined) {
        throw destinationRefusal("publication.effect_invalid", "tickets carry no base version");
      }
      if (candidate.intervention.kind !== "ticket") {
        throw destinationRefusal("publication.effect_invalid", `intervention kind "${candidate.intervention.kind}"`);
      }
      const content = candidate.intervention.content;
      const title = stringField(content, "title");
      const body = stringField(content, "body");
      const fingerprint = stringField(content, "fingerprint");
      if (title === undefined || body === undefined || fingerprint === undefined) {
        throw destinationRefusal("publication.effect_invalid", "ticket content must carry title, body, fingerprint");
      }
      if (!/^sha256:[0-9a-f]{64}$/.test(fingerprint)) {
        throw destinationRefusal("publication.effect_invalid", "ticket fingerprint must be sha256:<64 hex>");
      }
      if (!body.includes(fingerprintMarker(fingerprint))) {
        throw destinationRefusal("publication.effect_invalid", "ticket body must carry its fingerprint marker");
      }
      const target = `issues/${fingerprint}`;
      const payload: JsonValue = { title, body, labels: [LEARNING_TICKET_LABEL], fingerprint };
      return [
        parsePreparedEffect({
          id: `ticket:${fingerprint}`,
          kind: TICKET_EFFECT_KIND,
          target,
          payload,
          payloadDigest: sha256HexOfCanonicalJson(payload),
          afterEffect: { kind: "compensate", payload: { fingerprint } },
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
      const fingerprint = stringField(effect.payload, "fingerprint");
      if (fingerprint === undefined)
        throw destinationRefusal("publication.effect_invalid", "ticket payload carries no fingerprint");
      const gh = requireGh();
      let finalVersion: string;
      if (effect.kind === "compensate") {
        const open = await findOpen(gh, fingerprint);
        if (open !== undefined) await gh.closeIssue(open);
        finalVersion = open === undefined ? "none:closed" : `#${open}:closed`;
      } else {
        const title = stringField(effect.payload, "title");
        const body = stringField(effect.payload, "body");
        if (title === undefined || body === undefined)
          throw destinationRefusal("publication.effect_invalid", "ticket payload carries no title/body");
        const existing = await findOpen(gh, fingerprint);
        if (existing !== undefined) {
          finalVersion = `#${existing}`;
        } else {
          const open = await gh.listIssues({ state: "open", labels: [LEARNING_TICKET_LABEL] });
          if (open.length >= caps.max_open_per_app) {
            throw destinationRefusal(
              "publication.limit_exceeded",
              `${open.length} open ${LEARNING_TICKET_LABEL} issues >= cap ${caps.max_open_per_app} (policy §13)`,
            );
          }
          const weekAgo = Date.parse(clock.now()) - 7 * 24 * 60 * 60 * 1000;
          const recent = await ticketsCreatedSince(receiptsDir, weekAgo);
          if (recent >= caps.max_new_per_week) {
            throw destinationRefusal(
              "publication.limit_exceeded",
              `${recent} learning tickets published this week >= cap ${caps.max_new_per_week} (policy §13)`,
            );
          }
          await gh.ensureLabel({
            name: LEARNING_TICKET_LABEL,
            color: "BFD4F2",
            description: "opened by the learning loop (routine, deduped, rate-capped)",
          });
          const issue = await gh.createIssue({ title, body, labels: [LEARNING_TICKET_LABEL] });
          finalVersion = `#${issue.number}`;
        }
      }
      const receipt = receiptFor(effect, idempotencyKey, finalVersion);
      await writeDestinationReceipt(receiptsDir, idempotencyKey, { effectDigest, receipt });
      return receipt;
    },
  };
}
