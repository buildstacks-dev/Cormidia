// Tests policy.yaml loading and gate-selection helpers in src/loop/policy.ts.
// Covers the real default template, tier resolution, dimension matching,
// immutable gate lists, schema validation, defaults, and clear rejection paths.
// Temp YAML files are parser fixtures; no network, auth, real org state, or
// wall-clock time is required.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_ATTEMPTS,
  gatesForTier,
  loadPolicy,
  matchedDimensions,
  packageJsonTouchesSecurityKeys,
  resolveTier,
  type Policy,
} from "../src/loop/policy.js";

const TEMPLATE_PATH = fileURLToPath(new URL("../docs/policy.yaml.template", import.meta.url));

/** Write a one-off yaml into a temp dir for rejection cases. */
const tempDirs: string[] = [];
function tempYaml(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "operon-policy-"));
  tempDirs.push(dir);
  const path = join(dir, "policy.yaml");
  writeFileSync(path, content, "utf8");
  return path;
}
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/** Minimal valid policy yaml with caller-controlled overrides spliced in. */
const MINIMAL_GATES = [
  "gates:",
  "  high: [tests, lint, security, completeness]",
  "  medium: [tests, lint, completeness]",
  "  low: [tests, completeness]",
].join("\n");

describe("policy template", () => {
  let template: Policy;
  beforeAll(async () => {
    template = await loadPolicy(TEMPLATE_PATH);
  });

  it("template parses as valid YAML through the real loader", () => {
    expect(template.riskTiers.high).toContain("db/**");
    expect(template.remediation.maxAttempts).toBe(3);
    expect(Object.keys(template.dimensionGlobs)).toEqual(["security", "perf"]);
  });

  it("gate sets per tier match the predecessor-mirrored defaults", () => {
    expect(gatesForTier(template, "high")).toEqual(["tests", "lint", "security", "completeness"]);
    // medium drops the security scan
    expect(gatesForTier(template, "medium")).toEqual(["tests", "lint", "completeness"]);
    expect(gatesForTier(template, "low")).toEqual(["tests", "completeness"]);
  });

  it("gatesForTier returns a copy — callers cannot mutate the policy", () => {
    gatesForTier(template, "low").push("security");
    expect(gatesForTier(template, "low")).toEqual(["tests", "completeness"]);
  });
});

describe("resolveTier", () => {
  let template: Policy;
  beforeAll(async () => {
    template = await loadPolicy(TEMPLATE_PATH);
  });

  it("unmatched files resolve to medium", () => {
    // Matches no template glob at any tier.
    expect(resolveTier(template, ["Makefile"])).toBe("medium");
  });

  it("highest tier among changed files wins", () => {
    expect(resolveTier(template, ["docs/guide.md", "db/schema.sql"])).toBe("high");
    expect(resolveTier(template, ["docs/guide.md", "src/util.ts"])).toBe("medium");
    expect(resolveTier(template, ["docs/guide.md", "tests/a.test.ts"])).toBe("low");
  });

  it("per file, high beats low when globs overlap", () => {
    // db/notes.md matches both db/** (high) and *.md (low) — high wins.
    expect(resolveTier(template, ["db/notes.md"])).toBe("high");
  });

  it("empty diff resolves low (predecessor parity)", () => {
    expect(resolveTier(template, [])).toBe("low");
  });

  it("fnmatch glob semantics: * crosses directory separators", () => {
    expect(resolveTier(template, ["docs/deep/nested/page.md"])).toBe("low"); // docs/**
    expect(resolveTier(template, ["notes/deep/nested/page.md"])).toBe("low"); // *.md
    expect(resolveTier(template, ["db/deep/nested/schema.sql"])).toBe("high"); // db/**
    expect(resolveTier(template, ["server/app/auth/session.ts"])).toBe("high"); // */auth/**
  });
});

describe("matchedDimensions", () => {
  let template: Policy;
  beforeAll(async () => {
    template = await loadPolicy(TEMPLATE_PATH);
  });

  it("returns dimensions whose globs match the diff, in declaration order", () => {
    expect(matchedDimensions(template, ["package.json"])).toEqual(["security"]);
    expect(matchedDimensions(template, ["app/migrations/001.sql"])).toEqual(["perf"]);
    expect(matchedDimensions(template, ["app/migrations/001.sql", "src/auth/login.ts"])).toEqual([
      "security",
      "perf",
    ]);
    expect(matchedDimensions(template, ["docs/guide.md"])).toEqual([]);
  });

  // L1-05: package.json is content-gated, not path-gated. Without the context
  // arg the historical blunt behavior is preserved (backward compatible); with
  // it, a trivial edit no longer trips security while a dependency change does.
  it("content-gates package.json for the security dimension when told which edits are dependency-relevant", () => {
    // No context: unchanged, path-only behavior — every caller/test still compiles and behaves.
    expect(matchedDimensions(template, ["package.json"])).toEqual(["security"]);

    // A trivial (metadata/test-glob) package.json edit does NOT escalate.
    expect(
      matchedDimensions(template, ["package.json"], { dependencyRelevantPackageJson: new Set() }),
    ).toEqual([]);
    // Even alongside another source file, the package.json alone stops driving security.
    expect(
      matchedDimensions(template, ["src/util.ts", "package.json"], {
        dependencyRelevantPackageJson: new Set(),
      }),
    ).toEqual([]);

    // A dependency/script change DOES escalate.
    expect(
      matchedDimensions(template, ["package.json"], {
        dependencyRelevantPackageJson: new Set(["package.json"]),
      }),
    ).toEqual(["security"]);

    // The gate is scoped to package.json — other security globs are unaffected.
    expect(
      matchedDimensions(template, ["src/auth/login.ts"], { dependencyRelevantPackageJson: new Set() }),
    ).toEqual(["security"]);
    // A lock-file touch stays path-gated (it only changes with dependencies).
    expect(
      matchedDimensions(template, ["pnpm-lock.yaml"], { dependencyRelevantPackageJson: new Set() }),
    ).toEqual(["security"]);
  });
});

describe("packageJsonTouchesSecurityKeys", () => {
  const base = JSON.stringify({
    name: "app",
    version: "1.0.0",
    scripts: { test: "vitest" },
    dependencies: { react: "^18.0.0" },
    devDependencies: { vitest: "^3.0.0" },
  });

  it("is false for a metadata-only edit (name/version/files/test-glob)", () => {
    const after = JSON.stringify({
      name: "app",
      version: "1.0.1",
      files: ["dist"],
      scripts: { test: "vitest" },
      dependencies: { react: "^18.0.0" },
      devDependencies: { vitest: "^3.0.0" },
    });
    expect(packageJsonTouchesSecurityKeys(base, after)).toBe(false);
  });

  it("is true for a dependency bump, a new dependency, and a script change", () => {
    const depBump = JSON.stringify({ ...JSON.parse(base), dependencies: { react: "^18.3.0" } });
    const newDep = JSON.stringify({ ...JSON.parse(base), dependencies: { react: "^18.0.0", lodash: "^4.0.0" } });
    const scriptChange = JSON.stringify({
      ...JSON.parse(base),
      scripts: { test: "vitest", postinstall: "node setup.js" },
    });
    expect(packageJsonTouchesSecurityKeys(base, depBump)).toBe(true);
    expect(packageJsonTouchesSecurityKeys(base, newDep)).toBe(true);
    expect(packageJsonTouchesSecurityKeys(base, scriptChange)).toBe(true);
  });

  it("ignores key reordering (a cosmetic re-sort is not a dependency change)", () => {
    const resorted = JSON.stringify({
      dependencies: { react: "^18.0.0" },
      devDependencies: { vitest: "^3.0.0" },
      scripts: { test: "vitest" },
      version: "1.0.0",
      name: "app",
    });
    expect(packageJsonTouchesSecurityKeys(base, resorted)).toBe(false);
  });

  it("treats an absent side as empty and errs toward escalation on unparseable content", () => {
    // Newly added file that introduces dependencies → escalate.
    expect(packageJsonTouchesSecurityKeys(undefined, base)).toBe(true);
    // Added file with no dependency/script keys → not a dependency change.
    expect(packageJsonTouchesSecurityKeys(undefined, JSON.stringify({ name: "app" }))).toBe(false);
    // Malformed content → cannot compare → escalate (never less safe).
    expect(packageJsonTouchesSecurityKeys(base, "{ not json")).toBe(true);
  });
});

describe("loadPolicy validation", () => {
  it("malformed file throws clearly: not a mapping", async () => {
    await expect(loadPolicy(tempYaml("- just\n- a\n- list\n"))).rejects.toThrow(
      /policy\.yaml: not a YAML mapping/,
    );
  });

  it("unknown top-level key rejected", async () => {
    await expect(
      loadPolicy(tempYaml(`risk_tiers: {}\n${MINIMAL_GATES}\ngatez: {}\n`)),
    ).rejects.toThrow(/unknown key "gatez" \(allowed: schema_version, risk_tiers, gates/);
  });

  it("missing or incomplete gates mapping rejected — no silent per-tier fallback", async () => {
    await expect(loadPolicy(tempYaml("risk_tiers: {}\n"))).rejects.toThrow(
      /"gates" must be a mapping of tier → gate list/,
    );
    await expect(
      loadPolicy(tempYaml("risk_tiers: {}\ngates:\n  high: [tests]\n  medium: [tests]\n")),
    ).rejects.toThrow(/gates\.low: required — a non-empty list of gates/);
  });

  it("unknown gate name and unknown tier rejected", async () => {
    await expect(
      loadPolicy(
        tempYaml(
          "risk_tiers: {}\ngates:\n  high: [tests, lint, fuzz]\n  medium: [tests]\n  low: [tests]\n",
        ),
      ),
    ).rejects.toThrow(/gates\.high: unknown gate "fuzz" \(allowed: tests, lint, e2e, security, completeness\)/);
    await expect(
      loadPolicy(tempYaml(`risk_tiers:\n  extreme: ["db/**"]\n${MINIMAL_GATES}\n`)),
    ).rejects.toThrow(/risk_tiers: unknown tier "extreme" \(allowed: low, medium, high\)/);
  });

  it("review-freshness in a gate set rejected — it always runs, not configurable", async () => {
    await expect(
      loadPolicy(
        tempYaml(
          "risk_tiers: {}\ngates:\n  high: [tests, review-freshness]\n  medium: [tests]\n  low: [tests]\n",
        ),
      ),
    ).rejects.toThrow(/"review-freshness" is not configurable — it always runs/);
  });

  it("malformed globs and remediation rejected", async () => {
    await expect(
      loadPolicy(tempYaml(`risk_tiers:\n  high: "db/**"\n${MINIMAL_GATES}\n`)),
    ).rejects.toThrow(/risk_tiers\.high: must be a list of globs/);
    await expect(
      loadPolicy(tempYaml(`risk_tiers: {}\n${MINIMAL_GATES}\nremediation:\n  max_attempts: 0\n`)),
    ).rejects.toThrow(/remediation\.max_attempts must be a positive integer \(got 0\)/);
    await expect(
      loadPolicy(tempYaml(`risk_tiers: {}\n${MINIMAL_GATES}\nremediation:\n  feed_findings: true\n`)),
    ).rejects.toThrow(/remediation: unknown key "feed_findings" \(allowed: max_attempts\)/);
  });

  it("unsupported schema_version rejected", async () => {
    await expect(
      loadPolicy(tempYaml(`schema_version: 2\nrisk_tiers: {}\n${MINIMAL_GATES}\n`)),
    ).rejects.toThrow(/unsupported schema_version 2 \(expected 1\)/);
  });

  it("defaults: absent risk tiers are empty, remediation defaults to 3 attempts", async () => {
    const policy = await loadPolicy(
      tempYaml(`risk_tiers:\n  high: ["db/**"]\n${MINIMAL_GATES}\n`),
    );
    expect(policy.riskTiers.low).toEqual([]);
    expect(policy.riskTiers.medium).toEqual([]);
    expect(policy.remediation.maxAttempts).toBe(DEFAULT_MAX_ATTEMPTS);
    expect(policy.dimensionGlobs).toEqual({});
    // Still resolves: db file high, anything else unmatched → medium.
    expect(resolveTier(policy, ["db/schema.sql"])).toBe("high");
    expect(resolveTier(policy, ["docs/guide.md"])).toBe("medium");
  });
});
