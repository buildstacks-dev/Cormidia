// CF-HARNESS-ACCFIX — HB-120; case-catalog.md §0 and validation-policy.yaml
// `harness_self_tests`: acceptance campaign-root fixture self-test.

import { relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertNonEmptyWalk } from "../../walk.js";
import { makeAcceptanceCampaignFixture } from "../campaign-fixture.js";
import { FIXTURE_SCENARIO_KINDS } from "../scenario-corpus.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel !== "" && !rel.startsWith("..");
}

describe("fixtures/acceptance/campaign-fixture self-test", () => {
  it("writes every scenario and the walk is non-empty", async () => {
    const fixture = await makeAcceptanceCampaignFixture();
    cleanups.push(fixture.cleanup);
    const files = await assertNonEmptyWalk(fixture.scenariosDir, /\.md$/);
    expect(files).toHaveLength(FIXTURE_SCENARIO_KINDS.length);
    for (const kind of FIXTURE_SCENARIO_KINDS) {
      expect(isInside(fixture.scenariosDir, fixture.scenarioPath(kind))).toBe(true);
    }
  });

  it("keeps the key vault OUTSIDE the campaign root by default", async () => {
    const fixture = await makeAcceptanceCampaignFixture();
    cleanups.push(fixture.cleanup);
    expect(isInside(fixture.root, fixture.vaultDir)).toBe(false);
  });

  it("seeds the vault INSIDE the campaign root on demand — the B-28 §2 adversarial case", async () => {
    const fixture = await makeAcceptanceCampaignFixture({ vaultInsideCampaignRoot: true });
    cleanups.push(fixture.cleanup);
    expect(isInside(fixture.root, fixture.vaultDir)).toBe(true);
  });

  it("threads per-kind scenario seeding through to the written file", async () => {
    const fixture = await makeAcceptanceCampaignFixture({
      kinds: ["greenfield"],
      scenarioOptions: { greenfield: { omitCategories: ["tangent"] } },
    });
    cleanups.push(fixture.cleanup);
    expect(fixture.scenarios).toHaveLength(1);
    expect(fixture.scenario("greenfield").plants.tangent).toEqual([]);
    expect(() => fixture.scenario("job")).toThrow(/no job scenario/);
  });

  it("writes grader-reachable evidence under the evidence root", async () => {
    const fixture = await makeAcceptanceCampaignFixture({ kinds: ["greenfield"] });
    cleanups.push(fixture.cleanup);
    const path = await fixture.writeEvidence("journal/turns.jsonl", "{}\n");
    expect(isInside(fixture.evidenceDir, path)).toBe(true);
    await assertNonEmptyWalk(fixture.evidenceDir);
  });
});
