// The OKF concept bundle as a kernel PublicationDestination (kernel contract
// §Publication destination; decision 0026; Cormidia spec §8/§14). `prepare`
// renders the exact activated concept bytes the forked publisher would write
// (`renderActivatedConcept`: loop.status candidate → active, everything else
// byte-preserved) and binds the destination root's manifest `bundle_version`
// as the expected base — the same `base_manifest_version` the B-11 approval
// binding pins, so an intervening cut voids the plan exactly as it voids a
// `learning_publish` approval. `applyEffect` writes the concept, cuts one
// manifest version keyed by the kernel idempotency key (the journal's
// `approval_ref`, which is what makes a crashed apply forward-complete), and
// writes its receipt last.

import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
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
import {
  assertConceptPlacement,
  assertSafeConceptName,
  bundleScopeDir,
  cutManifestVersion,
  disableConcept,
  readManifest,
  rootKindForScope,
  type LearningRoot,
} from "../learning/concepts.js";
import { parseOkfDocument, serializeOkfDocument, type OkfDocument } from "../memory.js";
import { destinationRefusal, resolveRepeatedKey, writeDestinationReceipt } from "./destination-receipts.js";
import { loopScopeFromScope } from "./scope.js";

export const OKF_ACTIVATE_EFFECT_KIND = "okf.concept.activate";
/** The base of a root that has never cut a version — the forked binding's
 *  `base_manifest_version` value, preserved verbatim (binding.ts). */
export const UNVERSIONED_BASE = "unversioned";

export interface OkfConceptDestinationOptions {
  /** Destination id, unique per registered root (`okf-concept:org`, `okf-concept:app:<name>`). */
  readonly id: string;
  readonly root: LearningRoot;
  /** Where this destination keeps its idempotency receipts (state home). */
  readonly receiptsDir: string;
  /** The root's own V1 scope (`org` or `apps/<app>`): where a candidate whose
   *  scope is outside the V1 grammar lands, visibly in its loop block. */
  readonly defaultScope: string;
  readonly clock?: Clock;
}

interface ConceptPayload {
  readonly path: string;
  readonly conceptId: string;
  readonly scope: string;
  readonly markdown: string;
}

function stringField(value: JsonValue, key: string): string | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const field: unknown = Reflect.get(value, key);
  return typeof field === "string" ? field : undefined;
}

function activate(doc: OkfDocument): OkfDocument {
  const loop = doc.frontmatter.loop;
  if (loop === undefined) throw destinationRefusal("publication.effect_invalid", "concept draft carries no loop block");
  return { ...doc, frontmatter: { ...doc.frontmatter, status: "active", loop: { ...loop, status: "active" } } };
}

function conceptFromText(candidate: Candidate, text: string, scope: string, today: string): OkfDocument {
  const name = assertSafeConceptName(candidate.id);
  const firstLine = text.split("\n").find((line) => line.trim() !== "") ?? name;
  return {
    frontmatter: {
      name,
      description: firstLine.trim().slice(0, 120),
      type: "lesson",
      keywords: [],
      evidence: [],
      status: "active",
      created: today,
      updated: today,
      loop: {
        id: candidate.id,
        tier: candidate.proposedRisk,
        status: "active",
        scope,
        version: 1,
        claim: "authorized",
      },
    },
    body: text,
  };
}

function parsePayload(payload: JsonValue, target: string): ConceptPayload {
  const path = stringField(payload, "path");
  const conceptId = stringField(payload, "conceptId");
  const scope = stringField(payload, "scope");
  const markdown = stringField(payload, "markdown");
  if (path === undefined || conceptId === undefined || scope === undefined || markdown === undefined) {
    throw destinationRefusal(
      "publication.effect_invalid",
      "okf payload must carry path, conceptId, scope, and markdown",
    );
  }
  if (path !== target || !path.startsWith("bundle/") || path.split("/").some((segment) => segment === "..")) {
    throw destinationRefusal(
      "publication.effect_invalid",
      `okf payload path "${path}" does not name the effect target`,
    );
  }
  return { path, conceptId, scope, markdown };
}

export function createOkfConceptDestination(options: OkfConceptDestinationOptions): PublicationDestination {
  const { id, root, receiptsDir, defaultScope } = options;
  const clock = options.clock ?? { now: () => new Date().toISOString() };

  const currentBase = async (): Promise<string> => (await readManifest(root))?.bundle_version ?? UNVERSIONED_BASE;

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

  async function render(candidate: Candidate): Promise<{ doc: OkfDocument; scope: string }> {
    const content = candidate.intervention.content;
    const candidateScope = loopScopeFromScope(candidate.scope) ?? defaultScope;
    const markdown = stringField(content, "markdown");
    if (markdown !== undefined) {
      const doc = parseOkfDocument(markdown, `candidate:${candidate.id}`);
      assertConceptPlacement(doc, "candidates");
      const scope = doc.frontmatter.loop?.scope ?? candidateScope;
      if (scope !== candidateScope) {
        throw destinationRefusal(
          "publication.effect_invalid",
          `concept scope "${scope}" disagrees with candidate scope "${candidateScope}"`,
        );
      }
      return { doc: activate(doc), scope };
    }
    const text = stringField(content, "text");
    if (text === undefined)
      throw destinationRefusal("publication.effect_invalid", "okf content must carry markdown or text");
    return { doc: conceptFromText(candidate, text, candidateScope, clock.now().slice(0, 10)), scope: candidateScope };
  }

  return {
    id,
    prepare: async (input) => {
      const { doc, scope } = await render(input.candidate);
      if (rootKindForScope(scope) !== root.kind) {
        throw destinationRefusal(
          "publication.effect_invalid",
          `scope "${scope}" does not live in the ${root.kind} learning root`,
        );
      }
      const name = assertSafeConceptName(doc.frontmatter.name);
      const conceptId = doc.frontmatter.loop?.id ?? input.candidate.id;
      const target = relative(root.dir, join(bundleScopeDir(root, scope), `${name}.md`))
        .split("\\")
        .join("/");
      const payload: JsonValue = { path: target, conceptId, scope, markdown: serializeOkfDocument(doc) };
      const effect = parsePreparedEffect({
        id: `activate:${conceptId}`,
        kind: OKF_ACTIVATE_EFFECT_KIND,
        target,
        expectedBase: input.expectedBase ?? (await currentBase()),
        payload,
        payloadDigest: sha256HexOfCanonicalJson(payload),
        afterEffect: { kind: "disable", payload: { conceptId, scope, path: target } },
      });
      return [effect];
    },
    applyEffect: async (input) => {
      const effect = parsePreparedEffect(input.effect);
      const idempotencyKey = input.idempotencyKey;
      if (idempotencyKey.length === 0)
        throw destinationRefusal("publication.effect_invalid", "idempotency key must be non-empty");
      const effectDigest = sha256HexOfCanonicalJson(toJsonValue(effect));
      const repeated = await resolveRepeatedKey(receiptsDir, idempotencyKey, effectDigest);
      if (repeated !== undefined) return repeated;
      const now = new Date(clock.now());
      const manifest = await readManifest(root);
      let finalVersion: string;
      if (effect.kind === "disable") {
        const conceptId = stringField(effect.payload, "conceptId");
        if (conceptId === undefined)
          throw destinationRefusal("publication.effect_invalid", "disable payload names no conceptId");
        const disabled = await disableConcept(root, conceptId, { now }).catch((error: unknown) => {
          throw destinationRefusal(
            "publication.destination_busy",
            error instanceof Error ? error.message : String(error),
          );
        });
        if (disabled === undefined)
          throw destinationRefusal(
            "publication.effect_invalid",
            `no active concept "${conceptId}" in the ${root.kind} bundle`,
          );
        finalVersion = disabled.version;
      } else {
        const payload = parsePayload(effect.payload, effect.target);
        const applied = manifest?.history.find((entry) => entry.approval_ref === idempotencyKey);
        if (applied !== undefined) {
          // Crash after the manifest cut, before the receipt: forward-complete.
          finalVersion = applied.version;
        } else {
          const base = manifest?.bundle_version ?? UNVERSIONED_BASE;
          if (effect.expectedBase !== undefined && effect.expectedBase !== base) {
            throw destinationRefusal(
              "publication.base_mismatch",
              `${root.kind} bundle is at ${base}, not the expected base "${effect.expectedBase}"`,
            );
          }
          if (manifest?.canary !== null && manifest?.canary !== undefined) {
            throw destinationRefusal(
              "publication.destination_busy",
              `${root.kind} bundle has an active canary (${manifest.canary})`,
            );
          }
          const absolute = join(root.dir, payload.path);
          if (existsSync(absolute) && (await readFile(absolute, "utf8")) !== payload.markdown) {
            throw destinationRefusal("publication.base_mismatch", `${payload.path} already holds different bytes`);
          }
          await mkdir(dirname(absolute), { recursive: true });
          await writeFileAtomic(absolute, payload.markdown);
          const entry = await cutManifestVersion(root, {
            approvalRef: idempotencyKey,
            concepts: [payload.conceptId],
            note: `learning-loop ${effect.id}`,
            now,
          });
          finalVersion = entry.version;
        }
      }
      const receipt = receiptFor(effect, idempotencyKey, finalVersion);
      await writeDestinationReceipt(receiptsDir, idempotencyKey, { effectDigest, receipt });
      return receipt;
    },
  };
}
