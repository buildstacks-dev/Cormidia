// Eval fixtures (docs/learning-loop/learning-loop-spec.md §7; design §9.4):
// the conversion of a finalized build-episode ReplayCapsule into a SANITIZED
// eval fixture under the committed org home's `learning/evals/**` — the
// gate-protected eval sets that experiment eligibility references
// (`evals/roles/builder/standard-tickets`, spec §10).
//
// Two-actor trust model (spec §7 rules): conversion DRAFTS the fixture —
// deterministic software copies the capsule, scrubs every string through the
// canonical secret-pattern list, and drafts `expected_outcome` verbatim from
// the episode's observed outcome. The draft is not trusted: `validated_by`
// stays null until an INDEPENDENT validator (never the drafter) re-checks it
// — including a fresh secret scan, because validation verifies sanitization
// rather than believing the `sanitized` flag. Only then is the fixture a
// trusted eval. An already-validated fixture is immutable to redrafting;
// losing trust silently is the one failure mode this file exists to prevent.
//
// The drafted expected outcome is the grader TARGET, not a transcript: replay
// (M5) asks whether a fresh attempt merges like the original did and stays
// within its review-cycle count. Cost is deliberately NOT part of the
// fixture grade — experiment guardrails own cost comparison (spec §10), and
// grading it twice would double-count one signal.

import { existsSync } from "node:fs";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { asGlobal, SECRET_PATTERNS } from "../../runtime/secret-patterns.js";
import { scrubSecrets } from "../../runtime/runlog/redact.js";
import { isValidLoopScope } from "../memory.js";
import { writeFileAtomic } from "../atomic.js";
import { readCapsule, type ReplayCapsule } from "./capsule.js";
import type { GraderKind } from "./eval-result.js";
import {
  optionalString,
  requireEnum,
  requireRecord,
  requireString,
  requireStringArray,
} from "./validate.js";

/** The deterministic build-outcome grader this module drafts fixtures
 *  against; gradeBuildOutcome() is its implementation. Versioned so a
 *  semantics change is a new ref, never a silent regrade. */
export const BUILD_OUTCOME_GRADER_REF = "builtin:build-outcome@1";

export interface ExpectedBuildOutcome {
  merged: boolean | null;
  review_cycles: number | null;
  cost_usd: number | null;
}

export interface EvalFixture {
  schema_version: 1;
  /** `evals/<set>/<capsule_id>` — the ref experiments and reports use. */
  fixture_id: string;
  /** `<scope>/<set-name>`, e.g. `roles/builder/standard-tickets`. */
  eval_set: string;
  capsule_ref: string;
  episode_ref: string;
  kind: "build_ticket";
  seed: ReplayCapsule["seed"];
  input: ReplayCapsule["input"];
  fingerprint_ref: string | null;
  artifacts: string[];
  observed_outcome: NonNullable<ReplayCapsule["observed_outcome"]>;
  /** Drafted verbatim from the observed outcome; validation confirms it as
   *  the trusted grader target. */
  expected_outcome: ExpectedBuildOutcome;
  grader: { kind: GraderKind; ref: string };
  side_effect_policy: ReplayCapsule["side_effect_policy"];
  sanitized: true;
  drafted_by: string;
  drafted_at: string;
  validated_by: string | null;
  validated_at: string | null;
}

// ---------------------------------------------------------------------------
// layout
// ---------------------------------------------------------------------------

/** `<scope>/<set-name>` where scope is the V1 scope grammar (spec §2) — the
 *  same grammar concepts use, so eval sets and the concepts they test line
 *  up (`evals/roles/builder/standard-tickets` tests `roles/builder`). The
 *  set name, like every scope segment, may contain dots but must not BE
 *  dots: the set becomes a directory under the gate-protected
 *  `learning/evals/**`, and `roles/../experiments` escaping into a sibling
 *  store is a grammar error, not a path. */
export function isValidEvalSet(set: string): boolean {
  const slash = set.lastIndexOf("/");
  if (slash <= 0) return false;
  const scope = set.slice(0, slash);
  const name = set.slice(slash + 1);
  return isValidLoopScope(scope) && /^[A-Za-z0-9._-]+$/.test(name) && !/^\.+$/.test(name);
}

export function evalsDir(orgHome: string): string {
  return join(orgHome, "learning", "evals");
}

export function evalSetDir(orgHome: string, set: string): string {
  return join(evalsDir(orgHome), ...set.split("/"));
}

export function fixturePath(orgHome: string, set: string, capsuleId: string): string {
  return join(evalSetDir(orgHome, set), `${capsuleId}.json`);
}

// ---------------------------------------------------------------------------
// conversion (draft) — deterministic, sanitizing
// ---------------------------------------------------------------------------

export interface ConvertCapsuleOptions {
  orgHome: string;
  stateHome: string;
  capsuleId: string;
  /** Target eval set, e.g. `roles/builder/standard-tickets`. */
  set: string;
  /** Who drafted — the independence check pivots on it. */
  draftedBy: string;
  /** Grader ref override; defaults to the builtin build-outcome grader. */
  graderRef?: string;
  clock?: () => Date;
}

export interface ConvertedFixture {
  fixture: EvalFixture;
  path: string;
  /** Secret-pattern replacements applied during sanitization. */
  redactions: number;
  /** What stands between this draft and trusted use. */
  trust_gaps: string[];
}

export async function convertCapsuleToEvalFixture(
  options: ConvertCapsuleOptions,
): Promise<ConvertedFixture> {
  if (!isValidEvalSet(options.set)) {
    throw new Error(
      `learning: eval set "${options.set}" must be "<scope>/<set-name>" with the V1 scope ` +
        `grammar (spec §2), e.g. roles/builder/standard-tickets`,
    );
  }
  if (options.draftedBy.trim() === "") {
    throw new Error("learning: draftedBy must name who drafted the fixture");
  }
  const capsule = await readCapsule(options.stateHome, options.capsuleId);
  if (capsule === undefined) {
    throw new Error(
      `learning: no capsule ${options.capsuleId} in the store — ` +
        `operon learn inspect <episode-id> assembles capsules for closed build episodes`,
    );
  }
  if (capsule.observed_outcome === null) {
    throw new Error(
      `learning: ${options.capsuleId} has no closed outcome — nothing to draft a grader ` +
        `target from; close the episode first`,
    );
  }

  const path = fixturePath(options.orgHome, options.set, capsule.capsule_id);
  if (existsSync(path)) {
    const existing = validateEvalFixture(JSON.parse(await readFile(path, "utf8")));
    // A trusted fixture is immutable to redrafting — with ONE recovery
    // path: a pre-M5 fixture without the verbatim brief can never replay,
    // so redrafting to backfill it is allowed, and the redraft resets
    // validated_by (new content entered; a second actor must re-trust it).
    if (
      existing.validated_by !== null &&
      existing.input.brief !== null &&
      existing.input.brief !== undefined
    ) {
      throw new Error(
        `learning: ${existing.fixture_id} is already validated by ${existing.validated_by} — ` +
          `a trusted fixture is immutable; convert into a different set instead`,
      );
    }
    if (existing.validated_by !== null) {
      process.stderr.write(
        `learning: ${existing.fixture_id} was validated without a verbatim brief (pre-M5) — ` +
          `redrafting to backfill it; validation resets and a second actor must re-trust it\n`,
      );
    }
  }

  const { value: sanitizedCapsule, redactions } = sanitizeDeep(capsule);
  const now = (options.clock ?? (() => new Date()))();
  const fixture: EvalFixture = {
    schema_version: 1,
    fixture_id: `evals/${options.set}/${capsule.capsule_id}`,
    eval_set: options.set,
    capsule_ref: capsule.capsule_id,
    episode_ref: sanitizedCapsule.episode_ref,
    kind: "build_ticket",
    seed: sanitizedCapsule.seed,
    input: sanitizedCapsule.input,
    fingerprint_ref: sanitizedCapsule.fingerprint_ref,
    artifacts: sanitizedCapsule.artifacts,
    observed_outcome: sanitizedCapsule.observed_outcome!,
    expected_outcome: { ...sanitizedCapsule.observed_outcome! },
    grader: { kind: "deterministic", ref: options.graderRef ?? BUILD_OUTCOME_GRADER_REF },
    side_effect_policy: sanitizedCapsule.side_effect_policy,
    sanitized: true,
    drafted_by: options.draftedBy,
    drafted_at: now.toISOString(),
    validated_by: null,
    validated_at: null,
  };

  await mkdir(evalSetDir(options.orgHome, options.set), { recursive: true });
  await writeFileAtomic(path, JSON.stringify(fixture, null, 2) + "\n");
  return { fixture, path, redactions, trust_gaps: fixtureTrustGaps(fixture) };
}

/** One traversal shared by the scrubber and the scanner. They are a matched
 *  pair by design — validation re-verifies sanitization, which only holds if
 *  the scanner visits at least everything the scrubber visited — so a single
 *  walker is a security property here, not a style choice. `visit` returns
 *  the (possibly replaced) string; walkStrings returns the mapped copy. */
function walkStrings(value: unknown, visit: (s: string) => string): unknown {
  if (typeof value === "string") return visit(value);
  if (Array.isArray(value)) return value.map((entry) => walkStrings(entry, visit));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        walkStrings(entry, visit),
      ]),
    );
  }
  return value;
}

/** Deep-copy with every string scrubbed through the canonical secret list
 *  (src/runtime/secret-patterns.ts — the ONE list). `redactions` counts
 *  individual secret matches, not touched strings — the CLI reports it as an
 *  audit figure, and three secrets in one string are three, not one. */
function sanitizeDeep<T>(input: T): { value: T; redactions: number } {
  let redactions = 0;
  const value = walkStrings(input, (s) => {
    for (const pattern of SECRET_PATTERNS) {
      redactions += s.match(asGlobal(pattern))?.length ?? 0;
    }
    return scrubSecrets(s);
  }) as T;
  return { value, redactions };
}

// ---------------------------------------------------------------------------
// independent validation (trust)
// ---------------------------------------------------------------------------

export interface TrustFixtureOptions {
  orgHome: string;
  set: string;
  capsuleId: string;
  /** Who validated — must not be the drafter (spec §7: an independent
   *  reviewer, and a human for important or ambiguous cases). */
  validatedBy: string;
  clock?: () => Date;
}

export async function trustEvalFixture(options: TrustFixtureOptions): Promise<EvalFixture> {
  const path = fixturePath(options.orgHome, options.set, options.capsuleId);
  if (!existsSync(path)) {
    throw new Error(`learning: no fixture ${options.capsuleId} in set ${options.set}`);
  }
  const fixture = validateEvalFixture(JSON.parse(await readFile(path, "utf8")));
  if (fixture.validated_by !== null) return fixture; // first validation stands

  if (options.validatedBy.trim() === "" || options.validatedBy === fixture.drafted_by) {
    throw new Error(
      `learning: ${fixture.fixture_id} was drafted by ${fixture.drafted_by} — ` +
        `validation must be independent (spec §7); a drafter cannot validate their own draft`,
    );
  }
  // Verify sanitization, never believe it: a fixture that still matches any
  // secret pattern is refused regardless of its `sanitized` flag.
  const leaks = scanForSecrets(fixture);
  if (leaks.length > 0) {
    throw new Error(
      `learning: ${fixture.fixture_id} still matches secret pattern(s): ${leaks.join(", ")} — ` +
        `refusing to validate; re-draft after cleaning the source capsule`,
    );
  }

  const now = (options.clock ?? (() => new Date()))();
  const trusted: EvalFixture = {
    ...fixture,
    validated_by: options.validatedBy,
    validated_at: now.toISOString(),
  };
  await writeFileAtomic(path, JSON.stringify(trusted, null, 2) + "\n");
  return trusted;
}

/** Names of secret patterns that still match anywhere in the fixture. Uses
 *  the same walker as the scrubber (see walkStrings) and the patterns'
 *  STATELESS form — a shared /g regex carries lastIndex between .test()
 *  calls and would skip matches early in the next string, which is exactly
 *  the under-report this scan exists to prevent. */
export function scanForSecrets(fixture: unknown): string[] {
  const hits = new Set<string>();
  walkStrings(fixture, (s) => {
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.pattern.test(s)) hits.add(pattern.name);
    }
    return s;
  });
  return [...hits].sort();
}

export function fixtureTrustGaps(fixture: EvalFixture): string[] {
  const gaps: string[] = [];
  if (fixture.validated_by === null) gaps.push("independent_validation");
  if (fixture.seed.repo === null || fixture.seed.commit === null) gaps.push("seed");
  if (fixture.fingerprint_ref === null) gaps.push("fingerprint");
  // Replay recreates the original inputs; without the verbatim brief the
  // fixture can grade but never replay (M5).
  if (fixture.input.brief === null || fixture.input.brief === undefined) gaps.push("brief");
  return gaps;
}

// ---------------------------------------------------------------------------
// the builtin deterministic grader
// ---------------------------------------------------------------------------

export interface BuildAttemptOutcome {
  merged: boolean | null;
  review_cycles: number | null;
}

/** `builtin:build-outcome@1`: a replayed attempt passes when it merges like
 *  the original did and needs no MORE review cycles than the original.
 *  Unknown expectations don't grade; unknown attempt values fail closed. */
export function gradeBuildOutcome(
  expected: ExpectedBuildOutcome,
  attempt: BuildAttemptOutcome,
): { pass: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (expected.merged !== null) {
    if (attempt.merged === null) reasons.push("merged: unknown (expected " + expected.merged + ")");
    else if (attempt.merged !== expected.merged) {
      reasons.push(`merged: ${attempt.merged} (expected ${expected.merged})`);
    }
  }
  if (expected.review_cycles !== null) {
    if (attempt.review_cycles === null) {
      reasons.push(`review_cycles: unknown (expected <= ${expected.review_cycles})`);
    } else if (attempt.review_cycles > expected.review_cycles) {
      reasons.push(
        `review_cycles: ${attempt.review_cycles} (expected <= ${expected.review_cycles})`,
      );
    }
  }
  return { pass: reasons.length === 0, reasons };
}

// ---------------------------------------------------------------------------
// record validation + listing
// ---------------------------------------------------------------------------

export function validateEvalFixture(value: unknown): EvalFixture {
  const spec = requireRecord(value, "fixture");
  const fixtureId = requireString(spec, "fixture_id", "fixture");
  const source = fixtureId;
  if (spec["schema_version"] !== 1) {
    throw new Error(`learning: ${source}.schema_version must be 1`);
  }
  const evalSet = requireString(spec, "eval_set", source);
  if (!isValidEvalSet(evalSet)) {
    throw new Error(`learning: ${source}.eval_set "${evalSet}" is not "<scope>/<set-name>"`);
  }
  if (spec["kind"] !== "build_ticket") {
    throw new Error(`learning: ${source}.kind must be "build_ticket" (V1 capsules, design §9.4)`);
  }
  if (spec["sanitized"] !== true) {
    throw new Error(`learning: ${source}.sanitized must be true — unsanitized drafts stay capsules`);
  }
  const graderSpec = requireRecord(spec["grader"], `${source}.grader`);
  const observed = requireRecord(spec["observed_outcome"], `${source}.observed_outcome`);
  const expected = requireRecord(spec["expected_outcome"], `${source}.expected_outcome`);
  const seed = requireRecord(spec["seed"], `${source}.seed`);
  const input = requireRecord(spec["input"], `${source}.input`);
  const policy = requireRecord(spec["side_effect_policy"], `${source}.side_effect_policy`);

  const validatedBy = optionalString(spec, "validated_by", source);
  const validatedAt = optionalString(spec, "validated_at", source);
  if ((validatedBy === null) !== (validatedAt === null)) {
    throw new Error(`learning: ${source}: validated_by and validated_at must be set together`);
  }

  return {
    schema_version: 1,
    fixture_id: fixtureId,
    eval_set: evalSet,
    capsule_ref: requireString(spec, "capsule_ref", source),
    episode_ref: requireString(spec, "episode_ref", source),
    kind: "build_ticket",
    seed: seed as EvalFixture["seed"],
    input: input as unknown as EvalFixture["input"],
    fingerprint_ref: optionalString(spec, "fingerprint_ref", source),
    artifacts: requireStringArray(spec, "artifacts", source),
    observed_outcome: observed as unknown as EvalFixture["observed_outcome"],
    expected_outcome: expected as unknown as ExpectedBuildOutcome,
    grader: {
      kind: requireEnum(graderSpec, "kind", ["deterministic", "model", "human"] as const, `${source}.grader`),
      ref: requireString(graderSpec, "ref", `${source}.grader`),
    },
    side_effect_policy: policy as unknown as EvalFixture["side_effect_policy"],
    sanitized: true,
    drafted_by: requireString(spec, "drafted_by", source),
    drafted_at: requireString(spec, "drafted_at", source),
    validated_by: validatedBy,
    validated_at: validatedAt,
  };
}

/** Every fixture across every set, sorted by fixture id. */
export async function listEvalFixtures(orgHome: string): Promise<EvalFixture[]> {
  const root = evalsDir(orgHome);
  if (!existsSync(root)) return [];
  const fixtures: EvalFixture[] = [];
  const files = (await readdir(root, { withFileTypes: true, recursive: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
  for (const file of files) {
    fixtures.push(validateEvalFixture(JSON.parse(await readFile(file, "utf8"))));
  }
  return fixtures;
}
