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

it("J-REL-01 Phase 6 keeps strict token-free enforcement on every CI invocation", () => {
  const raw = readFileSync(fileURLToPath(new URL("../../.github/workflows/efficiency-qualification.yml", import.meta.url)), "utf8");
  const packageRaw = readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8");
  expect(raw).not.toContain("inputs.strict");
  expect(raw).toMatch(/^\s*run: pnpm test:transformation:strict\s*$/m);
  expect(packageRaw).toContain('"test:transformation:future-soak-strict"');
  expect(raw).not.toContain("test:transformation:future-soak-strict");
});

it("J-REL-01 operating cadence keeps credentialed GitHub, provider, and soak work under fresh exact human authorization", () => {
  const raw = readFileSync(fileURLToPath(new URL("../../eval/README.md", import.meta.url)), "utf8");
  for (const cadence of ["GitHub nightly or scheduled", "Weekly/manual calibration", "Release candidate", "Post-release"]) expect(raw).toContain(cadence);
  expect(raw).toContain("A human must authorize the campaign hash, repository, operations, and GitHub mutation before execution");
  expect(raw).toContain("Candidate and future soak require separate exact authorizations");
  expect(raw).toContain("only this campaign may promote `I-LIVE-01`");
  expect(raw).toMatch(/Any source, fixture, grader, price-catalog, or\s+campaign change invalidates the prepared identity/);
});
