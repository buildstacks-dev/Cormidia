import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { parse } from "yaml";

it("J-REL-01 positive: wires token-free PR/nightly checks and a deliberate strict release gate", () => {
  const path = fileURLToPath(new URL("../../.github/workflows/efficiency-qualification.yml", import.meta.url));
  const raw = readFileSync(path, "utf8"); const workflow = parse(raw) as Record<string, unknown>;
  expect(workflow).toBeTruthy();
  for (const command of ["pnpm eval:validate", "pnpm test:transformation", "pnpm eval:deterministic", "pnpm typecheck", "pnpm test:transformation:strict"]) expect(raw).toContain(command);
  expect(raw).toMatch(/^\s*- run: pnpm exec vitest run --maxWorkers=2 --testTimeout=15000\s*$/m);
  expect(raw).toContain("pnpm eval:deterministic:nightly");
  expect(raw).not.toContain("eval:live");
  expect(raw).not.toContain("test:live");
});

it("J-REL-01 gates the fail-closed product-currency check to releases, off ordinary push/PR CI", () => {
  // P0-07 / ROOT-001 integrity/currency separation (docs/PURPOSE.md 2026-07-17):
  // the offline suite proves evidence INTEGRITY on every push/PR; live
  // product-CURRENCY is enforced only at the release gate. The workflow therefore
  // carries a distinct release-currency job running `pnpm eval:release-verify`,
  // guarded to release tags / manual dispatch so a legitimate src change does not
  // leave per-commit CI permanently red.
  const raw = readFileSync(fileURLToPath(new URL("../../.github/workflows/efficiency-qualification.yml", import.meta.url)), "utf8");
  const workflow = parse(raw) as { jobs?: Record<string, { if?: string; steps?: Array<{ run?: string }> }> };
  const gate = workflow.jobs?.["release-currency"];
  expect(gate).toBeTruthy();
  // Tag-gated (release tags) and reachable by explicit manual dispatch, never on
  // an ordinary branch push or pull_request.
  expect(gate!.if).toContain("refs/tags/");
  expect(gate!.if).toContain("workflow_dispatch");
  expect(raw).toContain("pnpm eval:release-verify");
  // The release-currency check must NOT be a per-push step in the deterministic
  // job, or main would be permanently red after any src change.
  const deterministicSteps = (workflow.jobs?.deterministic?.steps ?? []).map((step) => step.run ?? "");
  expect(deterministicSteps.some((run) => run.includes("eval:release-verify"))).toBe(false);
});

it("J-REL-01 near-miss keeps live/provider work out of ordinary pull-request CI", () => {
  const raw = readFileSync(fileURLToPath(new URL("../../.github/workflows/efficiency-qualification.yml", import.meta.url)), "utf8");
  expect(raw).toContain("workflow_dispatch");
  expect(raw).not.toContain("OPERON_EVAL_LIVE=1");
  expect(raw).not.toContain("OPERON_EVAL_GITHUB=1");
});

it("J-REL-01 Phase 6 keeps strict token-free enforcement on every CI invocation", () => {
  const raw = readFileSync(fileURLToPath(new URL("../../.github/workflows/efficiency-qualification.yml", import.meta.url)), "utf8");
  const packageRaw = readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8");
  expect(raw).not.toContain("inputs.strict");
  expect(raw).toMatch(/^\s*run: pnpm test:transformation:strict\s*$/m);
  expect(packageRaw).toContain('"test:transformation:future-soak-strict"');
  expect(raw).not.toContain("test:transformation:future-soak-strict");
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
