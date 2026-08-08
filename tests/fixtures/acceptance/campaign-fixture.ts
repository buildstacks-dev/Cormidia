// fixtures/acceptance/campaign-fixture.ts — the fixture campaign root.
//
// Layout mirrors the real one because the LAYOUT is load-bearing: B-28 §2
// clause 2 confines the sealed key by making its plaintext live outside every
// path a grader may read, and "outside" is a path relationship, not a policy
// string. The vault therefore sits in a sibling temp root by default, with
// `vaultInsideCampaignRoot` seeding the adversarial case (key under the
// campaign root while the grader's workdir IS the campaign root).

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  fixtureScenario,
  FIXTURE_SCENARIO_KINDS,
  type FixtureScenario,
  type FixtureScenarioKind,
  type FixtureScenarioOptions,
} from "./scenario-corpus.js";

export interface AcceptanceCampaignFixtureOptions {
  /** Which scenarios to write. Defaults to all three fixture kinds. */
  kinds?: readonly FixtureScenarioKind[];
  /** Per-kind seeding (partial key, brief leak, unmapped vocabulary). */
  scenarioOptions?: Partial<Record<FixtureScenarioKind, FixtureScenarioOptions>>;
  /** Seed the key vault under the campaign root — a confinement violation
   *  whenever a grader's reachable set includes that root. */
  vaultInsideCampaignRoot?: boolean;
}

export interface AcceptanceCampaignFixture {
  /** The campaign root. Grader workdirs are subtrees of this in the fixtures. */
  root: string;
  scenariosDir: string;
  evidenceDir: string;
  reportDir: string;
  /** Where sealed-key plaintext is written. Outside `root` unless seeded. */
  vaultDir: string;
  scenarios: FixtureScenario[];
  scenario(kind: FixtureScenarioKind): FixtureScenario;
  scenarioPath(kind: FixtureScenarioKind): string;
  /** Write a grader-reachable evidence file; returns its absolute path. */
  writeEvidence(relativePath: string, contents: string): Promise<string>;
  cleanup(): Promise<void>;
}

export async function makeAcceptanceCampaignFixture(
  options: AcceptanceCampaignFixtureOptions = {},
): Promise<AcceptanceCampaignFixture> {
  const parent = await mkdtemp(join(tmpdir(), "cormidia-acc-campaign-"));
  const root = join(parent, "campaign");
  const scenariosDir = join(root, "scenarios");
  const evidenceDir = join(root, "evidence");
  const reportDir = join(root, "report");
  const vaultDir = options.vaultInsideCampaignRoot === true ? join(root, "vault") : join(parent, "vault");
  for (const dir of [scenariosDir, evidenceDir, reportDir, vaultDir]) await mkdir(dir, { recursive: true });

  const kinds = options.kinds ?? FIXTURE_SCENARIO_KINDS;
  const scenarios: FixtureScenario[] = [];
  for (const kind of kinds) {
    const scenario = fixtureScenario(kind, options.scenarioOptions?.[kind] ?? {});
    scenarios.push(scenario);
    await writeFile(join(scenariosDir, `${scenario.id}.md`), scenario.markdown, "utf8");
  }

  const find = (kind: FixtureScenarioKind): FixtureScenario => {
    const found = scenarios.find((candidate) => candidate.kind === kind);
    if (found === undefined) throw new Error(`campaign fixture has no ${kind} scenario`);
    return found;
  };

  return {
    root,
    scenariosDir,
    evidenceDir,
    reportDir,
    vaultDir,
    scenarios,
    scenario: find,
    scenarioPath: (kind) => join(scenariosDir, `${find(kind).id}.md`),
    async writeEvidence(relativePath, contents) {
      const absolute = join(evidenceDir, relativePath);
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, contents, "utf8");
      return absolute;
    },
    cleanup: async () => {
      await rm(parent, { recursive: true, force: true });
    },
  };
}
