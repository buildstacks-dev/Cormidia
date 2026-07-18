import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { parse } from "yaml";

interface Step { name?: string; run?: string; if?: string; uses?: string }
interface Job { if?: string; needs?: unknown; steps?: Step[] }
interface Workflow { on?: Record<string, unknown>; concurrency?: { group?: string; "cancel-in-progress"?: unknown }; jobs?: Record<string, Job> }

function workflowText(): string {
  return readFileSync(fileURLToPath(new URL("../../.github/workflows/efficiency-qualification.yml", import.meta.url)), "utf8");
}
function workflow(): Workflow {
  return parse(workflowText()) as Workflow;
}
function runs(job: Job | undefined): string[] {
  return (job?.steps ?? []).map((step) => (step.run ?? "").trim()).filter(Boolean);
}
function allRuns(value: Workflow): string[] {
  return Object.values(value.jobs ?? {}).flatMap(runs);
}

it("J-REL-01 positive: wires token-free PR/nightly checks and a deliberate strict release gate", () => {
  const raw = workflowText(); const value = workflow();
  expect(value).toBeTruthy();
  const core = value.jobs?.core;
  expect(core).toBeTruthy();
  // The token-free gates the umbrella scripts uniquely contributed. They are
  // invoked directly so the offline suite is not re-executed to reach them.
  for (const command of ["pnpm test:offline", "pnpm typecheck", "pnpm eval:validate", "pnpm eval:contracts", "pnpm eval:contracts:strict"]) {
    expect(runs(core), command).toContain(command);
  }
  expect(raw).toContain("pnpm eval:deterministic:nightly");
  expect(raw).not.toContain("eval:live");
  expect(raw).not.toContain("test:live");
});

it("J-REL-01 executes the offline suite exactly once per run, with no umbrella re-runs", () => {
  // Regression guard for the duplication this workflow structure removed. The
  // previous `deterministic` job ran `test:transformation`, `eval:deterministic`,
  // the full vitest suite and `test:transformation:strict` in sequence, so
  // test/transformation + test/eval executed four times (six nightly). Each
  // umbrella script bundles a vitest invocation with a distinct non-vitest
  // assertion; the assertions now run directly via eval:contracts*, so nothing
  // needs to re-enter vitest. If any of these reappear the duplication is back.
  const value = workflow();
  const commands = allRuns(value);
  expect(commands.filter((run) => run === "pnpm test:offline")).toHaveLength(1);
  for (const umbrella of ["pnpm test:transformation", "pnpm test:transformation:strict", "pnpm eval:deterministic", "pnpm test"]) {
    expect(commands, umbrella).not.toContain(umbrella);
  }
  // The nightly shuffle is the one deliberate repetition: distinct invariant
  // (order dependence at two workers, concurrency dependence at one worker).
  const nightly = (value.jobs?.core?.steps ?? []).filter((step) => (step.run ?? "").includes("eval:deterministic:nightly"));
  expect(nightly).toHaveLength(1);
  expect(nightly[0]!.if).toContain("nightly");
});

it("J-REL-01 gates the fail-closed product-currency check to releases, off ordinary push/PR CI", () => {
  // P0-07 / ROOT-001 integrity/currency separation (docs/PURPOSE.md 2026-07-17):
  // the offline suite proves evidence INTEGRITY on every push/PR; live
  // product-CURRENCY is enforced only at the release gate. The workflow therefore
  // carries a distinct release-currency job running `pnpm eval:release-verify`,
  // guarded to release tags / manual dispatch so a legitimate src change does not
  // leave per-commit CI permanently red.
  const raw = workflowText(); const value = workflow();
  const gate = value.jobs?.["release-currency"];
  expect(gate).toBeTruthy();
  // Tag-gated (release tags) and reachable by explicit manual dispatch, never on
  // an ordinary branch push or pull_request.
  expect(gate!.if).toContain("refs/tags/");
  expect(gate!.if).toContain("workflow_dispatch");
  expect(raw).toContain("pnpm eval:release-verify");
  // The release gate must not be admitted by the path classifier, and must keep
  // full history so the changed-path check can resolve the candidate commit.
  expect(gate!.needs).toBeUndefined();
  expect(raw).toContain("fetch-depth: 0");
  // The release-currency check must NOT be a per-push step in any ordinary lane,
  // or main would be permanently red after any src change.
  for (const [name, job] of Object.entries(value.jobs ?? {})) {
    if (name === "release-currency") continue;
    expect(runs(job).some((run) => run.includes("eval:release-verify")), name).toBe(false);
  }
});

it("J-REL-01 near-miss keeps live/provider work out of ordinary pull-request CI", () => {
  const raw = workflowText();
  expect(raw).toContain("workflow_dispatch");
  expect(raw).not.toContain("OPERON_EVAL_LIVE=1");
  expect(raw).not.toContain("OPERON_EVAL_GITHUB=1");
  // No provider-spending, externally mutating or operated-org command may enter CI.
  for (const forbidden of ["eval:soak", "eval:github", "e2e:sandbox", "OPERON_EVAL_SOAK", "OPERON_EVAL_LEARNING_ACTIVATION", "eval:prepare", "eval:promote", "operon dispatch", "operon loop"]) {
    expect(raw, forbidden).not.toContain(forbidden);
  }
});

it("J-REL-01 Phase 6 keeps strict token-free enforcement on every CI invocation", () => {
  const raw = workflowText(); const value = workflow();
  const packageRaw = readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8");
  expect(raw).not.toContain("inputs.strict");
  // Strict enforcement is unconditional inside the core lane: no `if:` may ever
  // guard it, so it cannot be skipped for a "fast" run.
  const strict = (value.jobs?.core?.steps ?? []).filter((step) => (step.run ?? "").trim() === "pnpm eval:contracts:strict");
  expect(strict).toHaveLength(1);
  expect(strict[0]!.if).toBeUndefined();
  expect(packageRaw).toContain('"test:transformation:future-soak-strict"');
  expect(raw).not.toContain("future-soak-strict");
});

it("J-REL-01 admits lanes conservatively and keeps a check on direct pushes to main", () => {
  const value = workflow();
  // Path admission is computed by the governed classifier, never inlined.
  const classify = value.jobs?.classify;
  expect(runs(classify).join("\n")).toContain("scripts/ci/classify-changes.mjs");
  // A push to `main` still receives the core lane: this repository has no
  // branch-protection enforcement, so direct pushes remain possible.
  expect((value.on?.push as { branches?: string[] } | undefined)?.branches).toContain("main");
  expect(value.jobs?.core?.if).toContain("needs.classify.outputs.core");
  // Superseded PR runs are cancelled; main and tag runs never are.
  expect(value.concurrency?.group).toContain("github.event.pull_request.number");
  expect(String(value.concurrency?.["cancel-in-progress"])).toContain("github.event_name == 'pull_request'");
});

it("J-REL-01 runs the AGENTS.md Observer/Reports checks that per-commit CI previously omitted", () => {
  const value = workflow();
  const lane = value.jobs?.["observer-reports"];
  expect(lane).toBeTruthy();
  expect(lane!.if).toContain("needs.classify.outputs.observe");
  const commands = runs(lane);
  for (const required of ["pnpm test:observe-browser", "pnpm smoke:onboarding", "npm pack --dry-run", "pnpm build"]) {
    expect(commands, required).toContain(required);
  }
  // Each exactly once, and the semantic Observer/Reports tests are not repeated
  // here — the core lane's single offline-suite execution already covers
  // test/observe/*.test.ts and test/report/*.test.ts, and an Observer change
  // always admits the core lane as well.
  for (const required of ["pnpm test:observe-browser", "pnpm smoke:onboarding", "npm pack --dry-run"]) {
    expect(commands.filter((run) => run === required), required).toHaveLength(1);
  }
  expect(commands.some((run) => run.includes("vitest"))).toBe(false);
});

it("J-REL-01 development cadence binds credentialed descendants to standing objective authority while reserving genuinely new decisions", () => {
  const raw = readFileSync(fileURLToPath(new URL("../../eval/README.md", import.meta.url)), "utf8");
  for (const cadence of ["GitHub nightly or scheduled", "Weekly/manual calibration", "Release candidate", "Post-release"]) expect(raw).toContain(cadence);
  expect(raw).toContain("Requires either exact campaign authority or a matching standing developer-objective grant");
  expect(raw).toContain("Same-objective descendants reuse their bound grant");
  expect(raw).toContain("learning activation remains separate");
  expect(raw).toContain("future real-time soak");
  expect(raw).toContain("only this campaign may promote `I-LIVE-01`");
  expect(raw).toMatch(/Any source, fixture, grader, price-catalog, or\s+campaign change invalidates the prepared identity/);
  expect(raw).toContain("A matching standing objective grant remains valid");
});
