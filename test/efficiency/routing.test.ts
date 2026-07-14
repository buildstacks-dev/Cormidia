import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { loadPipelines } from "../../src/loop/pipelines.js";
import {
  admitEpisode,
  readRouteRecord,
  reassessEpisode,
} from "../../src/loop/efficiency.js";
import {
  authorizeRoutePasses,
  decideExecutionRoute,
  decideMechanicalOnly,
  executionBoundsFor,
  nextRouteAfterUnexpectedFinding,
  type RouteRiskProfile,
} from "../../src/loop/route-policy.js";
import { loadRoles } from "../../src/org/roles.js";

interface CorpusRow {
  id: string;
  expected: "quick" | "standard" | "deep";
  blast_radius: "low" | "medium" | "high";
  reversibility: "reversible" | "difficult" | "irreversible";
  sensitive_domains: string[];
  uncertainty: "low" | "medium" | "high";
  release_consequence: string;
  components?: number;
  external_systems?: number;
  novelty?: "familiar" | "new";
  evidence_quality?: "high" | "partial" | "low";
  tests?: "partial";
  prose_variant?: string;
  prompt_length?: string;
  repeated_keywords?: string[];
}

const corpus = parse(readFileSync("eval/corpora/routing.yaml", "utf8")) as { cases: CorpusRow[] };

function profile(row: CorpusRow): RouteRiskProfile {
  return {
    blastRadius: row.blast_radius,
    reversibility: row.reversibility,
    sensitiveDomains: row.sensitive_domains,
    uncertainty: row.uncertainty,
    componentCount: row.components ?? 1,
    externalSystemCount: row.external_systems ?? 0,
    releaseConsequence:
      row.release_consequence === "external_api" ? "external" : row.release_consequence as RouteRiskProfile["releaseConsequence"],
    novelty: row.novelty ?? "familiar",
    evidenceQuality: row.evidence_quality ?? (row.tests === "partial" ? "partial" : "high"),
  };
}

describe("Phase 3 deterministic routing", () => {
  it("D-ROUTE-01 maps all 32 reviewed combinations exactly", () => {
    expect(corpus.cases).toHaveLength(32);
    expect(corpus.cases.map((row) => [row.id, decideExecutionRoute(profile(row)).route])).toEqual(
      corpus.cases.map((row) => [row.id, row.expected]),
    );
  });

  it("D-ROUTE-02 ignores prompt length, repeated keywords, and prose about effects", () => {
    for (const id of ["r02", "r04", "r12", "r13", "r14"]) {
      const row = corpus.cases.find((candidate) => candidate.id === id)!;
      expect(decideExecutionRoute(profile(row)).route, id).toBe("quick");
    }
    expect(decideExecutionRoute(profile(corpus.cases.find((row) => row.id === "r03")!)).route).toBe("deep");
    expect(decideExecutionRoute(profile(corpus.cases.find((row) => row.id === "r05")!)).route).toBe("deep");
  });

  it("D-ROUTE-03 every real risk-factor mutation is monotonic", () => {
    const base = profile(corpus.cases[0]!);
    const rank = { quick: 0, standard: 1, deep: 2 } as const;
    const mutations: RouteRiskProfile[] = [
      { ...base, blastRadius: "medium" },
      { ...base, reversibility: "irreversible" },
      { ...base, sensitiveDomains: ["auth"], reversibility: "difficult" },
      { ...base, uncertainty: "high" },
      { ...base, releaseConsequence: "production" },
      { ...base, componentCount: 7 },
      { ...base, externalSystemCount: 3 },
      { ...base, novelty: "new" },
      { ...base, evidenceQuality: "low" },
    ];
    for (const mutant of mutations) {
      expect(rank[decideExecutionRoute(mutant).route]).toBeGreaterThanOrEqual(rank.quick);
    }
  });

  it("D-ROUTE-04 extra passes carry a recorded factor and fail if it is deleted", async () => {
    const rolesFile = await loadRoles("roles.yaml");
    const roles = Object.fromEntries(rolesFile.roles.map((role) => [role.name, role]));
    const pipelines = await loadPipelines("pipelines.yaml", {
      roleNames: rolesFile.roles.map((role) => role.name),
      promptsDir: "prompts",
    });
    const decision = decideExecutionRoute({
      blastRadius: "high",
      reversibility: "difficult",
      sensitiveDomains: ["security"],
      uncertainty: "high",
      componentCount: 5,
      externalSystemCount: 2,
      releaseConsequence: "production",
      novelty: "new",
      evidenceQuality: "partial",
    });
    const passes = authorizeRoutePasses({ decision, pipelines: pipelines.pipelines, roles });
    expect(passes.find((pass) => pass.pass === "security-deep")?.factor_rules).toEqual(["sensitive_review"]);
    expect(passes.find((pass) => pass.pass === "perf-scale")?.factor_rules).toHaveLength(1);
    expect(passes.find((pass) => pass.pass === "ship-check")?.factor_rules).toHaveLength(1);
    expect(() => authorizeRoutePasses({
      decision: { ...decision, factors: decision.factors.filter((factor) => factor.policy_rule !== "sensitive_review") },
      pipelines: pipelines.pipelines,
      roles,
    })).toThrow(/without recorded factor rule sensitive_review/);
  });

  it("D-ROUTE-05 records policy-selected model and effort before execution", async () => {
    const root = mkdtempSync(join(tmpdir(), "operon-route-"));
    const rolesFile = await loadRoles("roles.yaml");
    const roles = Object.fromEntries(rolesFile.roles.map((role) => [role.name, role]));
    const pipelines = await loadPipelines("pipelines.yaml", {
      roleNames: rolesFile.roles.map((role) => role.name),
      promptsDir: "prompts",
    });
    const decision = decideExecutionRoute(profile(corpus.cases.find((row) => row.id === "r01")!));
    const passes = authorizeRoutePasses({ decision, pipelines: pipelines.pipelines, roles });
    expect(passes.every((pass) => pass.effort === "low")).toBe(true);
    await admitEpisode({
      root,
      episodeId: "route-recorded-before-runtime",
      app: "fixture",
      route: decision.route,
      policyVersion: decision.policyVersion,
      factors: decision.factors,
      passes,
      now: new Date("2026-07-14T00:00:00Z"),
    });
    expect((await readRouteRecord(root, "route-recorded-before-runtime")).authorized_passes).toEqual(passes);
  });

  it("D-ROUTE-06 unexpected findings reassess once and never de-escalate", async () => {
    const root = mkdtempSync(join(tmpdir(), "operon-reassess-"));
    const base = decideExecutionRoute(profile(corpus.cases[0]!));
    await admitEpisode({
      root,
      episodeId: "finding",
      app: "fixture",
      route: base.route,
      policyVersion: base.policyVersion,
      factors: base.factors,
      passes: [],
      now: new Date("2026-07-14T00:00:00Z"),
    });
    const toRoute = nextRouteAfterUnexpectedFinding(base.route);
    const updated = await reassessEpisode({
      root,
      episodeId: "finding",
      toRoute,
      factor: { kind: "uncertainty", evidence: "new failing invariant", policy_rule: "unexpected_finding" },
      now: new Date("2026-07-14T00:01:00Z"),
    });
    expect(updated.current_route).toBe("standard");
    expect(updated.reassessments).toHaveLength(1);
    await expect(reassessEpisode({
      root,
      episodeId: "finding",
      toRoute: "quick",
      factor: { kind: "uncertainty", evidence: "try to lower", policy_rule: "invalid" },
      now: new Date("2026-07-14T00:02:00Z"),
    })).rejects.toThrow(/cannot reduce depth/);
  });

  it("D-ROUTE-07 permits only ratified, evidenced quick mechanical work", () => {
    const quick = profile(corpus.cases[0]!);
    const evidence = {
      caseClass: "generated-ignore-normalization" as const,
      changedFiles: [".gitignore", "packages/a/.npmignore"],
      generatedOrFormattingOnly: true,
      requiredGatesPassed: true,
      acceptanceCriteriaSatisfied: true,
    };
    expect(decideMechanicalOnly("quick", quick, evidence).allowed).toBe(true);
    expect(decideMechanicalOnly("deep", quick, evidence).allowed).toBe(false);
    expect(decideMechanicalOnly("quick", { ...quick, sensitiveDomains: ["auth"] }, evidence).allowed).toBe(false);
    expect(decideMechanicalOnly("quick", quick, { ...evidence, requiredGatesPassed: false }).allowed).toBe(false);
    expect(executionBoundsFor("quick")).toMatchObject({ claimAttempts: 2, repairAttempts: 1, reviewCycles: 1 });
  });
});
