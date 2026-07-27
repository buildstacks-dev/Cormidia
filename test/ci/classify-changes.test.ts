import { describe, expect, it } from "vitest";
// @ts-expect-error -- dependency-free .mjs CI helper, deliberately untyped.
import { classify } from "../../scripts/ci/classify-changes.mjs";

/** The nine admission scenarios the lane design must satisfy. */

interface Decision {
  core: boolean;
  observe: boolean;
  build: boolean;
  nightly: boolean;
  reason: string;
}

const decide = (paths: string[], context: Record<string, unknown> = {}): Decision =>
  classify(paths, { event: "pull_request", ...context }) as Decision;

describe("docs-only changes admit no lane", () => {
  it("skips every lane for documentation, reviewer notes, and root markdown", () => {
    const decision = decide([
      "docs/PURPOSE.md",
      "docs/architecture.md",
      "review/track-a-findings.md",
      "AGENTS.md",
      "CHANGELOG.md",
      ".github/ISSUE_TEMPLATE/bug.md",
    ]);
    expect(decision).toMatchObject({ core: false, observe: false, build: false, nightly: false });
    expect(decision.reason).toContain("documentation-only");
  });

  it("treats PACKAGED documentation as product, not docs (it ships in npm pack)", () => {
    // docs/scheduler/design.md, docs/policy.yaml.template and README.md are in
    // package.json `files`, so they are packaged artifact paths. A docs-only
    // skip here would let shipped bytes change with no coverage at all.
    for (const packaged of ["docs/scheduler/design.md", "docs/policy.yaml.template", "README.md"]) {
      const decision = decide([packaged]);
      expect(decision.core, packaged).toBe(true);
      expect(decision.observe, packaged).toBe(true);
    }
  });

  it("keeps PACKAGED_DOCS in lockstep with package.json files entries", async () => {
    // The 2026-07-26 docs reorg moved docs/scheduler.md into a topic folder.
    // A packaged doc whose path moves in only one of these two places fails
    // SILENTLY: either npm pack drops the file, or CI stops covering shipped
    // bytes. This case turns that into a loud failure.
    const { readFileSync } = await import("node:fs");
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { files: string[] };
    const { __testing } = await import("../../scripts/ci/classify-changes.mjs");
    for (const packagedDoc of ["docs/policy.yaml.template", "docs/scheduler/design.md"]) {
      expect(pkg.files, packagedDoc).toContain(packagedDoc);
      expect(__testing.isDocsOnlyPath(packagedDoc), packagedDoc).toBe(false);
    }
    // The retired root path is ordinary docs again — a stale entry must not
    // quietly keep admitting lanes for a file that no longer ships.
    expect(__testing.isDocsOnlyPath("docs/scheduler.md")).toBe(true);
  });
});

describe("ordinary source changes admit the core lane only", () => {
  it("admits core and build for a src change, without the observer lane", () => {
    const decision = decide(["src/org/approvals.ts", "test/approvals.test.ts"]);
    expect(decision).toMatchObject({ core: true, observe: false, build: true, nightly: false });
  });

  it("admits core without build for a test-only change", () => {
    expect(decide(["test/gate.test.ts"])).toMatchObject({ core: true, observe: false, build: false });
  });

  it("admits core for an unrecognised path rather than skipping it", () => {
    // Unknown paths must fail-open into MORE testing, never less.
    expect(decide(["some/brand/new/surface.ts"])).toMatchObject({ core: true });
  });
});

describe("Observer and Reports changes add their required lane", () => {
  it("admits the observer lane for Observer sources, CLI surface and tests", () => {
    for (const path of ["src/observe/server.ts", "src/cli/observe.ts", "test/observe/browser.spec.ts"]) {
      expect(decide([path]), path).toMatchObject({ core: true, observe: true });
    }
  });

  it("admits the observer lane for Reports sources, CLI surface and tests", () => {
    for (const path of ["src/report/projection.ts", "src/cli/report.ts", "test/report/sessions.test.ts"]) {
      expect(decide([path]), path).toMatchObject({ core: true, observe: true });
    }
  });

  it("admits the observer lane for packaging, home resolution and onboarding surfaces", () => {
    // AGENTS.md: "Packaging, home resolution, CLI discovery, or onboarding
    // changes: also run pnpm smoke:onboarding and npm pack --dry-run".
    for (const path of [
      "src/org/home.ts",
      "src/cli.ts",
      "src/operon.cjs",
      "src/operon-local.cjs",
      "scripts/smoke-onboarding.mjs",
      "agent-skills/operon/SKILL.md",
    ]) {
      expect(decide([path]), path).toMatchObject({ core: true, observe: true });
    }
  });
});

describe("eval and qualification changes", () => {
  it("admits the core lane for eval and qualification-script surfaces", () => {
    for (const path of ["eval/campaigns/candidate-qualification.yaml", "scripts/eval/contracts.ts", "test/transformation/release-gate.test.ts"]) {
      expect(decide([path]), path).toMatchObject({ core: true });
    }
  });

  it("admits FULL coverage when the contract inventory itself changes", () => {
    const decision = decide(["eval/contracts.yaml"]);
    expect(decision).toMatchObject({ core: true, observe: true, build: true });
  });
});

describe("workflow, test-runner and grading config changes get conservative coverage", () => {
  it("admits every lane for test-selection and build surfaces", () => {
    for (const path of [
      ".github/workflows/efficiency-qualification.yml",
      "scripts/ci/classify-changes.mjs",
      "vitest.config.ts",
      "playwright.observe.config.ts",
      "package.json",
      "pnpm-lock.yaml",
      "tsconfig.json",
    ]) {
      const decision = decide([path]);
      expect(decision, path).toMatchObject({ core: true, observe: true, build: true });
      expect(decision.reason, path).toContain("full coverage");
    }
  });

  it("lets a single conservative path override an otherwise docs-only change", () => {
    expect(decide(["docs/PURPOSE.md", "vitest.config.ts"])).toMatchObject({ core: true, observe: true });
  });
});

describe("events that are never path-optimised", () => {
  it("admits every lane for a release tag", () => {
    const decision = decide(["docs/PURPOSE.md"], { event: "push", ref: "refs/tags/v0.2.0" });
    expect(decision).toMatchObject({ core: true, observe: true, build: true });
    expect(decision.reason).toContain("release tag");
  });

  it("admits every lane plus the nightly flake lane on a schedule", () => {
    const decision = decide([], { event: "schedule", ref: "refs/heads/main" });
    expect(decision).toMatchObject({ core: true, observe: true, build: true, nightly: true });
  });

  it("admits every lane for manual dispatch", () => {
    expect(decide([], { event: "workflow_dispatch" })).toMatchObject({ core: true, observe: true, build: true });
  });

  it("never sets the nightly lane outside a schedule", () => {
    for (const event of ["pull_request", "push", "workflow_dispatch"]) {
      expect(decide(["src/cli.ts"], { event }).nightly, event).toBe(false);
    }
  });
});

describe("push to main keeps a safety check", () => {
  it("admits the core lane for a direct source push to main", () => {
    // The repository has no branch-protection enforcement, so a direct push
    // must still be checked.
    expect(decide(["src/loop/executor.ts"], { event: "push", ref: "refs/heads/main" }))
      .toMatchObject({ core: true, build: true });
  });

  it("admits full coverage when the diff cannot be resolved (force-push, first push)", () => {
    const decision = decide([], { event: "push", ref: "refs/heads/main", diffAvailable: false });
    expect(decision).toMatchObject({ core: true, observe: true, build: true });
    expect(decision.reason).toContain("unavailable");
  });

  it("admits full coverage for an empty diff", () => {
    expect(decide([], { event: "push", ref: "refs/heads/main" })).toMatchObject({ core: true, observe: true });
  });
});
