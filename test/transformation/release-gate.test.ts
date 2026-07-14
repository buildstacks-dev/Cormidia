import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { parse } from "yaml";

it("J-REL-01 positive: wires token-free PR/nightly checks and a deliberate strict release gate", () => {
  const path = fileURLToPath(new URL("../../.github/workflows/efficiency-qualification.yml", import.meta.url));
  const raw = readFileSync(path, "utf8"); const workflow = parse(raw) as Record<string, unknown>;
  expect(workflow).toBeTruthy();
  for (const command of ["pnpm eval:validate", "pnpm test:transformation", "pnpm eval:deterministic", "pnpm typecheck", "pnpm test:transformation:strict"]) expect(raw).toContain(command);
  expect(raw).toMatch(/^\s*- run: pnpm test\s*$/m);
  expect(raw).toContain("pnpm eval:deterministic:nightly");
  expect(raw).not.toContain("eval:live");
  expect(raw).not.toContain("test:live");
});

it("J-REL-01 near-miss keeps live/provider work out of ordinary pull-request CI", () => {
  const raw = readFileSync(fileURLToPath(new URL("../../.github/workflows/efficiency-qualification.yml", import.meta.url)), "utf8");
  expect(raw).toContain("workflow_dispatch");
  expect(raw).not.toContain("OPERON_EVAL_LIVE=1");
  expect(raw).not.toContain("OPERON_EVAL_GITHUB=1");
});

it("J-REL-01 honest failure treats strict as an explicit manual gate rather than silently enabling it", () => {
  const raw = readFileSync(fileURLToPath(new URL("../../.github/workflows/efficiency-qualification.yml", import.meta.url)), "utf8");
  expect(raw).toContain("inputs.strict");
  expect(raw).toContain("default: false");
});

it("J-REL-01 operating cadence keeps credentialed GitHub, provider, and soak work under fresh exact human authorization", () => {
  const raw = readFileSync(fileURLToPath(new URL("../../eval/README.md", import.meta.url)), "utf8");
  for (const cadence of ["GitHub nightly or scheduled", "Weekly/manual calibration", "Release candidate", "Post-release"]) expect(raw).toContain(cadence);
  expect(raw).toContain("A human must authorize the campaign hash, repository, operations, and GitHub mutation before execution");
  expect(raw).toContain("Candidate and soak require separate exact authorizations");
  expect(raw).toMatch(/Any source, fixture, grader, price-catalog, or\s+campaign change invalidates the prepared identity/);
});
