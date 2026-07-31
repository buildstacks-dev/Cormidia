// Tests the capsule → sanitized eval fixture conversion and the two-actor
// trust model (src/org/learning/eval-fixture.ts; spec §7): drafting scrubs
// secrets and copies the observed outcome as the grader target, validation
// is independent (never the drafter) and re-verifies sanitization instead of
// believing the flag, trusted fixtures are immutable to redrafting, and the
// builtin deterministic build-outcome grader fails closed.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeOrgHome } from "../fixtures/orgHome.js";
import { capsulePath, type ReplayCapsule } from "../../src/org/learning/capsule.js";
import {
  convertCapsuleToEvalFixture,
  fixturePath,
  gradeBuildOutcome,
  isValidEvalSet,
  listEvalFixtures,
  scanForSecrets,
  trustEvalFixture,
  validateEvalFixture,
} from "../../src/org/learning/eval-fixture.js";
import { FakeClock } from "../fixtures/fakeClock.js";

const CLEANUPS: Array<() => void> = [];
afterEach(() => {
  while (CLEANUPS.length > 0) CLEANUPS.pop()!();
});

/** Org-home/state-home stand-in via the packaged fixture (AGENTS.md: reuse
 *  test/fixtures/orgHome.ts instead of ad-hoc mkdtemp scaffolds). */
function tempDir(_prefix?: string): string {
  const home = makeOrgHome({});
  CLEANUPS.push(home.cleanup);
  return home.root;
}

const CAPSULE_ID = "replay_alpha_ticket_0007";
const SET = "roles/builder/standard-tickets";

function makeCapsule(overrides: Partial<ReplayCapsule> = {}): ReplayCapsule {
  return {
    capsule_id: CAPSULE_ID,
    episode_ref: "ep_alpha_ticket_0007",
    kind: "build_ticket",
    seed: { repo: "owner/alpha", commit: "a1b2c3d", fixtures: [] },
    input: {
      ticket_ref: "github:#7",
      brief_hash: `sha256:${"ef".repeat(32)}`,
      brief: "## Ticket\n\nImplement the CSV export (#7).",
    },
    fingerprint_ref: "sys_0123456789ab",
    artifacts: ["pull-request-12"],
    observed_outcome: { merged: true, review_cycles: 2, cost_usd: 12.41 },
    expected_outcome: null,
    grader: null,
    side_effect_policy: {
      network: "fixture_only",
      publishing: "forbidden",
      deployment: "sandbox_only",
    },
    replayability: "partially_replayable",
    missing: ["trusted_expected_outcome"],
    sanitized: false,
    validated_by: null,
    ...overrides,
  };
}

function storeCapsule(stateHome: string, capsule: ReplayCapsule): void {
  const path = capsulePath(stateHome, capsule.capsule_id);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(capsule, null, 2) + "\n");
}

describe("isValidEvalSet", () => {
  it("accepts <scope>/<set-name> in the V1 scope grammar and rejects the rest", () => {
    expect(isValidEvalSet("roles/builder/standard-tickets")).toBe(true);
    expect(isValidEvalSet("apps/alpha/regressions")).toBe(true);
    expect(isValidEvalSet("apps/alpha/roles/support/feedback-cases")).toBe(true);
    expect(isValidEvalSet("apps/buildstacks.dev/regressions")).toBe(true);
    expect(isValidEvalSet("org/global-cases")).toBe(true);
    expect(isValidEvalSet("standard-tickets")).toBe(false);
    expect(isValidEvalSet("identities/alice/cases")).toBe(false);
    expect(isValidEvalSet("roles/builder/")).toBe(false);
  });

  it("rejects dot-only segments — a set is a directory, not a path escape", () => {
    // `roles/../experiments` would write into the sibling experiments store.
    expect(isValidEvalSet("roles/../experiments")).toBe(false);
    expect(isValidEvalSet("apps/../roles/../..")).toBe(false);
    expect(isValidEvalSet("roles/builder/..")).toBe(false);
    expect(isValidEvalSet("roles/builder/.")).toBe(false);
    // Dots INSIDE a name stay legal.
    expect(isValidEvalSet("roles/builder/v1.2-cases")).toBe(true);
  });
});

describe("convertCapsuleToEvalFixture", () => {
  it("drafts a sanitized fixture with the observed outcome as grader target", async () => {
    const orgHome = tempDir("operon-fx-org-");
    const stateHome = tempDir("operon-fx-state-");
    // Plant a secret where capture could have leaked one.
    storeCapsule(
      stateHome,
      makeCapsule({ artifacts: ["pull-request-12", "note: api_key = sk-abcdefghijklmnopqrstuvwx"] }),
    );
    const clock = new FakeClock("2026-07-11T12:00:00.000Z");

    const converted = await convertCapsuleToEvalFixture({
      orgHome,
      stateHome,
      capsuleId: CAPSULE_ID,
      set: SET,
      draftedBy: "human-operator",
      clock: () => clock.now(),
    });

    expect(converted.fixture).toMatchObject({
      fixture_id: `evals/${SET}/${CAPSULE_ID}`,
      eval_set: SET,
      capsule_ref: CAPSULE_ID,
      episode_ref: "ep_alpha_ticket_0007",
      expected_outcome: { merged: true, review_cycles: 2, cost_usd: 12.41 },
      grader: { kind: "deterministic", ref: "builtin:build-outcome@1" },
      sanitized: true,
      drafted_by: "human-operator",
      drafted_at: "2026-07-11T12:00:00.000Z",
      validated_by: null,
      validated_at: null,
    });
    expect(converted.redactions).toBeGreaterThan(0);
    expect(converted.fixture.artifacts[1]).toBe("note: api_key = [REDACTED:sk-api-key]");
    expect(converted.trust_gaps).toEqual(["independent_validation"]);

    const onDisk = readFileSync(fixturePath(orgHome, SET, CAPSULE_ID), "utf8");
    expect(onDisk).toContain("[REDACTED:");
    expect(fixturePath(orgHome, SET, CAPSULE_ID)).toContain(
      join("learning", "evals", "roles", "builder", "standard-tickets"),
    );
    expect(await listEvalFixtures(orgHome)).toHaveLength(1);
  });

  it("refuses a capsule with no closed outcome — no grader target to draft", async () => {
    const orgHome = tempDir("operon-fx-org-");
    const stateHome = tempDir("operon-fx-state-");
    storeCapsule(stateHome, makeCapsule({ observed_outcome: null }));
    await expect(
      convertCapsuleToEvalFixture({
        orgHome,
        stateHome,
        capsuleId: CAPSULE_ID,
        set: SET,
        draftedBy: "human-operator",
      }),
    ).rejects.toThrow(/no closed outcome/);
  });

  it("refuses an invalid eval set and a missing capsule", async () => {
    const orgHome = tempDir("operon-fx-org-");
    const stateHome = tempDir("operon-fx-state-");
    await expect(
      convertCapsuleToEvalFixture({
        orgHome,
        stateHome,
        capsuleId: CAPSULE_ID,
        set: "not-a-set",
        draftedBy: "x",
      }),
    ).rejects.toThrow(/scope grammar/);
    await expect(
      convertCapsuleToEvalFixture({
        orgHome,
        stateHome,
        capsuleId: CAPSULE_ID,
        set: SET,
        draftedBy: "x",
      }),
    ).rejects.toThrow(/no capsule/);
  });
});

describe("trustEvalFixture — independent validation before trust (spec §7)", () => {
  async function draftedFixture(): Promise<{ orgHome: string; stateHome: string }> {
    const orgHome = tempDir("operon-fx-org-");
    const stateHome = tempDir("operon-fx-state-");
    storeCapsule(stateHome, makeCapsule());
    await convertCapsuleToEvalFixture({
      orgHome,
      stateHome,
      capsuleId: CAPSULE_ID,
      set: SET,
      draftedBy: "human-operator",
    });
    return { orgHome, stateHome };
  }

  it("the drafter cannot validate their own draft", async () => {
    const { orgHome } = await draftedFixture();
    await expect(
      trustEvalFixture({ orgHome, set: SET, capsuleId: CAPSULE_ID, validatedBy: "human-operator" }),
    ).rejects.toThrow(/must be independent/);
  });

  it("an independent validator trusts the fixture; the first validation stands", async () => {
    const { orgHome } = await draftedFixture();
    const clock = new FakeClock("2026-07-11T13:00:00.000Z");
    const trusted = await trustEvalFixture({
      orgHome,
      set: SET,
      capsuleId: CAPSULE_ID,
      validatedBy: "reviewer-2",
      clock: () => clock.now(),
    });
    expect(trusted.validated_by).toBe("reviewer-2");
    expect(trusted.validated_at).toBe("2026-07-11T13:00:00.000Z");
    // Idempotent — a later validator does not overwrite the record of trust.
    const again = await trustEvalFixture({
      orgHome,
      set: SET,
      capsuleId: CAPSULE_ID,
      validatedBy: "reviewer-3",
    });
    expect(again.validated_by).toBe("reviewer-2");
  });

  it("validation re-verifies sanitization instead of believing the flag", async () => {
    const { orgHome } = await draftedFixture();
    // Corrupt the draft on disk with a real-looking token, sanitized flag
    // still true — exactly what a buggy or malicious writer would leave.
    const path = fixturePath(orgHome, SET, CAPSULE_ID);
    const fixture = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    fixture["artifacts"] = ["ghp_0123456789abcdefghij0123456789abcdef"];
    writeFileSync(path, JSON.stringify(fixture, null, 2) + "\n");

    await expect(
      trustEvalFixture({ orgHome, set: SET, capsuleId: CAPSULE_ID, validatedBy: "reviewer-2" }),
    ).rejects.toThrow(/still matches secret pattern/);
  });

  it("a trusted fixture is immutable to redrafting", async () => {
    const { orgHome, stateHome } = await draftedFixture();
    await trustEvalFixture({ orgHome, set: SET, capsuleId: CAPSULE_ID, validatedBy: "reviewer-2" });
    await expect(
      convertCapsuleToEvalFixture({
        orgHome,
        stateHome,
        capsuleId: CAPSULE_ID,
        set: SET,
        draftedBy: "human-operator",
      }),
    ).rejects.toThrow(/already validated/);
  });
});

describe("scanForSecrets", () => {
  it("names every matching pattern and stays empty on clean fixtures", () => {
    expect(scanForSecrets({ a: ["ghp_0123456789abcdefghij0123456789abcdef"] })).toEqual([
      "github-token",
    ]);
    expect(scanForSecrets({ a: "clean text", n: 4 })).toEqual([]);
  });

  it("is stateless across strings — a match in one string cannot mask the next", () => {
    // Regression: a shared /g regex carries lastIndex between .test() calls,
    // so after matching late in string A it would start mid-string in B and
    // miss a secret near B's start — under-reporting on the trust boundary.
    const tokenA = "ghp_0123456789abcdefghij0123456789abcdef";
    const tokenB = "ghp_zyxwvutsrqponmlkjihg9876543210fedcba";
    expect(
      scanForSecrets({
        a: `${"x".repeat(120)} ${tokenA}`, // match far into string A
        b: `${tokenB} trailing text`, // secret at the START of string B
      }),
    ).toEqual(["github-token"]);
  });

  it("counts every match during sanitization, not merely touched strings", async () => {
    const orgHome = tempDir("operon-fx-org-");
    const stateHome = tempDir("operon-fx-state-");
    storeCapsule(
      stateHome,
      makeCapsule({
        artifacts: [
          "two in one string: ghp_0123456789abcdefghij0123456789abcdef and ghp_zyxwvutsrqponmlkjihg9876543210fedcba",
        ],
      }),
    );
    const converted = await convertCapsuleToEvalFixture({
      orgHome,
      stateHome,
      capsuleId: CAPSULE_ID,
      set: SET,
      draftedBy: "human-operator",
    });
    expect(converted.redactions).toBe(2);
  });
});

describe("gradeBuildOutcome (builtin:build-outcome@1)", () => {
  const expected = { merged: true, review_cycles: 2, cost_usd: 12.41 };

  it("passes an attempt that merges with no more review cycles", () => {
    expect(gradeBuildOutcome(expected, { merged: true, review_cycles: 1 })).toEqual({
      pass: true,
      reasons: [],
    });
    expect(gradeBuildOutcome(expected, { merged: true, review_cycles: 2 }).pass).toBe(true);
  });

  it("fails on a merge mismatch or extra review cycles, with reasons", () => {
    expect(gradeBuildOutcome(expected, { merged: false, review_cycles: 1 })).toEqual({
      pass: false,
      reasons: ["merged: false (expected true)"],
    });
    expect(gradeBuildOutcome(expected, { merged: true, review_cycles: 4 }).reasons).toEqual([
      "review_cycles: 4 (expected <= 2)",
    ]);
  });

  it("fails closed on unknown attempt values; ungraded expectations skip", () => {
    expect(gradeBuildOutcome(expected, { merged: null, review_cycles: null }).pass).toBe(false);
    expect(
      gradeBuildOutcome({ merged: null, review_cycles: null, cost_usd: null }, { merged: null, review_cycles: null }),
    ).toEqual({ pass: true, reasons: [] });
  });
});

describe("validateEvalFixture", () => {
  it("rejects a fixture whose validated_by/validated_at disagree", async () => {
    const orgHome = tempDir("operon-fx-org-");
    const stateHome = tempDir("operon-fx-state-");
    storeCapsule(stateHome, makeCapsule());
    const converted = await convertCapsuleToEvalFixture({
      orgHome,
      stateHome,
      capsuleId: CAPSULE_ID,
      set: SET,
      draftedBy: "human-operator",
    });
    const raw = JSON.parse(JSON.stringify(converted.fixture)) as Record<string, unknown>;
    raw["validated_by"] = "reviewer-2"; // no validated_at
    expect(() => validateEvalFixture(raw)).toThrow(/must be set together/);
  });
});
