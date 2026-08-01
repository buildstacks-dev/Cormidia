// HB-006 — policy loader + artifact-location pin (Layer 1).
//
// Pins validation-design/validation-policy.yaml (the ratified, tighten-only
// harness contract) and the surfaces the policy claims exist: artifact paths,
// implementation_root, the per-commit CI lane (policy `ci.rule`: removing a
// gate in CI without a policy change is a policy violation), the vitest lane
// split, and the human-ratified constants of 2026-07-31 (blocked findings
// F-PT-006/F-PT-008, L3 spend bounds). Drift on any of these goes red so a
// human looks.
//
// Every detector family here carries a negative control that seeds the
// violation and asserts the detector FIRES (policy `harness_self_tests`).
// Nothing in this file spends a token or touches the network
// (claude-tests/README.md → Spend).

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse, stringify } from "yaml";
import { afterEach, describe, expect, it } from "vitest";
import {
  auditCoreChecksWorkflow,
  auditRatifiedPins,
  auditVitestConfigs,
  loadValidationPolicy,
  missingArtifacts,
  PolicyLoadError,
  POLICY_RELATIVE_PATH,
  resolveArtifacts,
  type ValidationPolicy,
} from "./policy-loader.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const policyPath = join(repoRoot, POLICY_RELATIVE_PATH);
const workflowPath = join(repoRoot, ".github", "workflows", "core-checks.yml");

// --- temp-repo rig for the negative controls ------------------------------

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Creates a throwaway repo root containing only validation-design/validation-policy.yaml. */
function tempRepo(policyText: string): string {
  const root = mkdtempSync(join(tmpdir(), "hb006-policy-pin-"));
  tempDirs.push(root);
  mkdirSync(join(root, "validation-design"), { recursive: true });
  writeFileSync(join(root, POLICY_RELATIVE_PATH), policyText);
  return root;
}

/** Materializes every artifact path (dirs get a placeholder so they are non-empty). */
function materializeArtifacts(root: string, artifacts: Readonly<Record<string, string>>): void {
  const designRoot = join(root, "validation-design");
  for (const relPath of Object.values(artifacts)) {
    const abs = resolve(designRoot, relPath);
    if (relPath.endsWith("/")) {
      mkdirSync(abs, { recursive: true });
      writeFileSync(join(abs, "placeholder.md"), "non-empty\n");
    } else {
      mkdirSync(dirname(abs), { recursive: true });
      if (!existsSync(abs)) writeFileSync(abs, "artifact\n");
    }
  }
}

// Loose mutable shapes for seeding violations into copies of real files.
interface MutableStep {
  [key: string]: unknown;
}
interface MutableJob {
  steps?: MutableStep[];
  env?: Record<string, unknown>;
  [key: string]: unknown;
}
interface MutableWorkflow {
  jobs: Record<string, MutableJob | undefined>;
  [key: string]: unknown;
}

function mutateWorkflow(mutate: (doc: MutableWorkflow) => void): string {
  const doc = parse(readFileSync(workflowPath, "utf8")) as MutableWorkflow;
  mutate(doc);
  return stringify(doc);
}

interface MutablePolicy {
  design_status: string;
  proposed_register: {
    items: { id: number; decision_status: string; value: string }[];
  };
  open_findings: { id: string; status: string }[];
  layers: {
    L3_live_sandbox: {
      spend_policy: {
        pre_merge_adapter_campaign: { max_provider_turns: number; max_equiv_usd: number };
        release_campaign: { max_provider_turns: number; max_equiv_usd: number };
      };
    };
  };
}

function mutatedPolicy(mutate: (doc: MutablePolicy) => void): ValidationPolicy {
  const clone = structuredClone(loadValidationPolicy(repoRoot));
  mutate(clone as unknown as MutablePolicy);
  return clone;
}

// ---------------------------------------------------------------------------

describe("HB-006 policy loader + artifact-location pin (validation-policy.yaml is the contract)", () => {
  it("(a) the policy parses and design_status is 'ratified'", () => {
    const policy = loadValidationPolicy(repoRoot);
    expect(policy.schema_version).toBe(1);
    expect(policy.scope).toBe("product");
    expect(policy.design_status).toBe("ratified");
    // The archive stays untouchable (ratified Phase 0 protected path).
    expect(
      policy.protected_paths.some((p) => p.path === "archive-do-not-read/**"),
    ).toBe(true);
    // Relied-on registries are present and non-trivial.
    expect(policy.open_findings.length).toBeGreaterThan(0);
    expect(policy.case_sourcing.length).toBeGreaterThan(0);
    expect(policy.harness_self_tests.length).toBeGreaterThan(0);
    expect(policy.proposed_register.items.length).toBeGreaterThan(0);
    expect(policy.verdict_semantics.verdict).toContain("inconclusive");
  });

  it("(b) every artifacts: path resolves to an existing, non-empty file or directory under validation-design/", () => {
    const policy = loadValidationPolicy(repoRoot);
    const statuses = resolveArtifacts(policy);
    // Non-empty walk: the registry must actually pin something.
    expect(statuses.length).toBeGreaterThanOrEqual(10);
    const keys = statuses.map((s) => s.key);
    for (const expected of [
      "readme",
      "policy",
      "scope_module_map",
      "system_map",
      "invariants",
      "boundary_map",
      "contracts",
      "risk_allocation",
      "case_catalog",
      "llm_eval_plan",
      "golden_sets",
      "harness_backlog",
      "agents_md_contribution",
      "elicitation_log",
      "design_state",
      "ratification_package",
    ]) {
      expect(keys).toContain(expected);
    }
    // Moving an artifact without updating the policy = red, right here.
    expect(missingArtifacts(policy)).toEqual([]);
  });

  it("(c) implementation_root resolves to an existing non-empty directory (claude-tests/)", () => {
    const policy = loadValidationPolicy(repoRoot);
    expect(policy.implementation_root).toBe("claude-tests/");
    const abs = resolve(repoRoot, policy.implementation_root);
    const stat = statSync(abs, { throwIfNoEntry: false });
    expect(stat?.isDirectory()).toBe(true);
    expect(readdirSync(abs).length).toBeGreaterThan(0);
  });

  it("(d) CI-lane pin: the per-commit lane runs typecheck+build+test and a pinned fail-closed gitleaks job with a canary", () => {
    const source = readFileSync(workflowPath, "utf8");
    expect(auditCoreChecksWorkflow(source)).toEqual([]);
    // Policy and CI must agree on the per-commit lane contents (policy ci.rule).
    const policy = loadValidationPolicy(repoRoot);
    for (const lane of ["L1", "L2", "gitleaks"]) {
      expect(policy.ci.per_commit).toContain(lane);
    }
    expect(policy.ci.per_commit_gate_class).toContain("fail-closed");
    expect(policy.ci.per_commit_enforcement_status).toContain("BLOCKED:F-PT-018");
  });

  it("(e) vitest-config pin: default config excludes claude-tests/live/** with passWithNoTests false; live config exists and includes only live/**", async () => {
    const liveConfigPath = join(repoRoot, "claude-tests", "live", "vitest.config.ts");
    expect(existsSync(liveConfigPath)).toBe(true);
    const defaultConfig = (await import(
      pathToFileURL(join(repoRoot, "vitest.config.ts")).href
    )) as { default: unknown };
    const liveConfig = (await import(pathToFileURL(liveConfigPath).href)) as {
      default: unknown;
    };
    expect(auditVitestConfigs(defaultConfig.default, liveConfig.default)).toEqual([]);
  });

  it("(f) ratified pins hold: F-PT-006/F-PT-008 stay open-blocked-contract; spend bounds are 2 turns/$5 pre-merge and 24 turns/$100 release", () => {
    const policy = loadValidationPolicy(repoRoot);
    expect(auditRatifiedPins(policy)).toEqual([]);
    // Assert the ratified numbers directly too, so this spec documents them.
    const spend = policy.layers.L3_live_sandbox.spend_policy;
    expect(spend.pre_merge_adapter_campaign.max_provider_turns).toBe(2);
    expect(spend.pre_merge_adapter_campaign.max_equiv_usd).toBe(5);
    expect(spend.release_campaign.max_provider_turns).toBe(24);
    expect(spend.release_campaign.max_equiv_usd).toBe(100);
    expect(spend.on_ceiling_exhaustion).toContain("never pass");
    const f006 = policy.open_findings.find((f) => f.id === "F-PT-006");
    const f008 = policy.open_findings.find((f) => f.id === "F-PT-008");
    expect(f006?.status).toBe("open-blocked-contract");
    expect(f008?.status).toBe("open-blocked-contract");
    for (const id of [1, 2, 3, 4, 5, 6, 7, 8, 13]) {
      expect(policy.proposed_register.items.find((item) => item.id === id)?.decision_status)
        .toMatch(/^(adjusted-ratified|ratified)$/);
    }
    for (const id of [9, 10, 11, 12]) {
      expect(policy.proposed_register.items.find((item) => item.id === id)?.decision_status)
        .toBe("proposed");
    }
  });
});

describe("HB-006 negative controls (each detector fires on a seeded violation)", () => {
  it("negative control: a syntactically broken policy copy makes the loader throw", () => {
    const root = tempRepo("artifacts: [unclosed\n");
    expect(() => loadValidationPolicy(root)).toThrow(PolicyLoadError);
    expect(() => loadValidationPolicy(root)).toThrow(/YAML/);
  });

  it("negative control: a policy copy missing a relied-on field throws naming the field", () => {
    const doc = parse(readFileSync(policyPath, "utf8")) as Record<string, unknown>;
    delete doc["design_status"];
    const root = tempRepo(stringify(doc));
    expect(() => loadValidationPolicy(root)).toThrow(PolicyLoadError);
    expect(() => loadValidationPolicy(root)).toThrow(/design_status/);
  });

  it("negative control: moving an artifact without updating the policy is reported", () => {
    // Seeded rig: a temp repo with the real policy and all artifacts present…
    const root = tempRepo(readFileSync(policyPath, "utf8"));
    const policy = loadValidationPolicy(root);
    materializeArtifacts(root, policy.artifacts);
    expect(missingArtifacts(policy)).toEqual([]); // detector is green before the seed
    // …then "move" one artifact out from under the policy.
    rmSync(join(root, "validation-design", "invariants.md"));
    const report = missingArtifacts(policy);
    expect(report).toHaveLength(1);
    expect(report[0]).toContain("invariants");
    // An emptied directory artifact is also not green (no green by absence).
    rmSync(join(root, "validation-design", "contracts", "placeholder.md"));
    expect(missingArtifacts(policy).some((v) => v.includes("contracts"))).toBe(true);
  });

  it("negative control: CI drift fires — canary removed, version unpinned, pnpm test dropped, fail-closed softened, job deleted", () => {
    // Baseline: mutating nothing stays clean (the rig itself is sound).
    expect(auditCoreChecksWorkflow(mutateWorkflow(() => {}))).toEqual([]);

    const noCanary = mutateWorkflow((doc) => {
      const job = doc.jobs["gitleaks"];
      job!.steps = job!.steps!.filter(
        (step) => !/canary/i.test(`${String(step["name"] ?? "")} ${String(step["run"] ?? "")}`),
      );
    });
    expect(auditCoreChecksWorkflow(noCanary)).toContainEqual(
      expect.stringContaining("canary"),
    );

    const unpinned = mutateWorkflow((doc) => {
      doc.jobs["gitleaks"]!.env!["GITLEAKS_VERSION"] = "latest";
    });
    expect(auditCoreChecksWorkflow(unpinned)).toContainEqual(
      expect.stringContaining("pin"),
    );

    const noTest = mutateWorkflow((doc) => {
      const job = doc.jobs["core"];
      job!.steps = job!.steps!.filter((step) => step["run"] !== "pnpm test");
    });
    expect(auditCoreChecksWorkflow(noTest)).toContainEqual(
      expect.stringContaining("pnpm test"),
    );

    const softened = mutateWorkflow((doc) => {
      const steps = doc.jobs["gitleaks"]!.steps!;
      const scan = steps.find((step) =>
        String(step["run"] ?? "").includes("--config .gitleaks.toml"),
      );
      scan!["continue-on-error"] = true;
    });
    expect(auditCoreChecksWorkflow(softened)).toContainEqual(
      expect.stringContaining("fail-closed"),
    );

    const noJob = mutateWorkflow((doc) => {
      delete doc.jobs["gitleaks"];
    });
    expect(auditCoreChecksWorkflow(noJob)).toContainEqual(
      expect.stringContaining("gitleaks secret-hygiene job is missing"),
    );
  });

  it("negative control: flipping a blocked finding or a spend bound without ratification fires the pin audit", () => {
    const flipped = mutatedPolicy((doc) => {
      const finding = doc.open_findings.find((f) => f.id === "F-PT-006");
      finding!.status = "resolved-ratified";
    });
    expect(auditRatifiedPins(flipped)).toContainEqual(
      expect.stringContaining("F-PT-006"),
    );

    const dropped = mutatedPolicy((doc) => {
      doc.open_findings = doc.open_findings.filter((f) => f.id !== "F-PT-008");
    });
    expect(auditRatifiedPins(dropped)).toContainEqual(
      expect.stringContaining("F-PT-008"),
    );

    const overspend = mutatedPolicy((doc) => {
      doc.layers.L3_live_sandbox.spend_policy.release_campaign.max_equiv_usd = 500;
    });
    expect(auditRatifiedPins(overspend)).toContainEqual(
      expect.stringContaining("release_campaign"),
    );

    const unratified = mutatedPolicy((doc) => {
      doc.design_status = "draft";
    });
    expect(auditRatifiedPins(unratified)).toContainEqual(
      expect.stringContaining("design_status"),
    );

    const hb007Drift = mutatedPolicy((doc) => {
      doc.proposed_register.items.find((item) => item.id === 7)!.value =
        "per-gate timeout default 15min";
    });
    expect(auditRatifiedPins(hb007Drift)).toContainEqual(
      expect.stringContaining("HB-007 decision item 7"),
    );
  });

  it("negative control: drifted vitest config shapes fire the config audit", () => {
    const badDefault = {
      test: {
        include: ["claude-tests/**/*.test.ts"],
        exclude: ["**/node_modules/**"], // live lane no longer excluded
        passWithNoTests: true, // green by absence
      },
    };
    const badLive = {
      test: {
        include: ["claude-tests/**/*.test.ts"], // reaches outside live/
      },
    };
    const violations = auditVitestConfigs(badDefault, badLive);
    expect(violations).toContainEqual(expect.stringContaining("claude-tests/live/**"));
    expect(violations).toContainEqual(expect.stringContaining("passWithNoTests"));
    expect(violations).toContainEqual(
      expect.stringContaining("live lane must include only live specs"),
    );
    // And junk shapes are violations, never a silent pass.
    expect(auditVitestConfigs(undefined, null).length).toBeGreaterThan(0);
  });
});
