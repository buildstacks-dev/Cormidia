// CF-INV-ACC-1 / CF-B28-* (L2) — the three confinement escape routes, over
// real temp git repositories and a real campaign root.
//
// The reachability case is the one that justifies the layer. An assembled-input
// scan is an L1 string check; proving that a grader holding file-read tools
// cannot open the plants requires a real tree with a real history, because the
// interesting failure — delete the scenario from the working tree, leave it in
// `git log -p` — does not exist in a string.

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { KeyConfinementError, proveKeyConfinement } from "../../campaign/acceptance/key-confinement.js";
import { extractSealedKey, SealedKeyError, type SealedKey } from "../../campaign/acceptance/sealed-key.js";
import { makeAcceptanceCampaignFixture } from "../../fixtures/acceptance/campaign-fixture.js";
import { fixtureScenario, type FixtureScenarioKind } from "../../fixtures/acceptance/scenario-corpus.js";
import { makeFixtureScenarioRepo } from "../../fixtures/acceptance/scenario-repo.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

function sealedKeyFor(kind: FixtureScenarioKind): SealedKey {
  const scenario = fixtureScenario(kind);
  return extractSealedKey({ scenarioId: scenario.id, scenarioMarkdown: scenario.markdown });
}

async function leak(run: () => Promise<unknown>): Promise<KeyConfinementError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof KeyConfinementError) return error;
    throw error;
  }
  throw new Error("expected a KeyConfinementError, but confinement reported clean");
}

describe("CF-INV-ACC-1 (L2) route 1 — assembly", () => {
  it("proves clean when the grader is handed only the brief", async () => {
    const key = sealedKeyFor("greenfield");
    const scenario = fixtureScenario("greenfield");
    const repo = await makeFixtureScenarioRepo({ kind: "greenfield" });
    cleanups.push(repo.cleanup);

    const proof = await proveKeyConfinement([key], {
      assembledInput: scenario.brief,
      reachableRoots: [repo.repo.dir],
    });
    expect(proof.scenarioIds).toEqual([scenario.id]);
    expect(proof.filesScanned).toBeGreaterThan(0);
    expect(proof.gitHistoryScanned).toEqual([repo.repo.dir]);
    expect(proof.claim).toContain("semantic inference is not claimed");
  });

  it("negative control: a plant leaked into the grader's assembled input fires", async () => {
    const key = sealedKeyFor("greenfield");
    const leaked = fixtureScenario("greenfield", { leakIntoBrief: ["contradiction"] });
    const repo = await makeFixtureScenarioRepo({ kind: "greenfield" });
    cleanups.push(repo.cleanup);

    const error = await leak(async () =>
      proveKeyConfinement([key], { assembledInput: leaked.brief, reachableRoots: [repo.repo.dir] }),
    );
    expect(error.route).toBe("assembly");
    expect(error.fingerprint).toBe("PLANT-CONTRADICTION-GREENFIELD");
  });
});

describe("CF-INV-ACC-1 (L2) route 2 — reachability, including git history", () => {
  it("negative control: the scenario markdown committed into the grader's tree fires", async () => {
    const key = sealedKeyFor("greenfield");
    const scenario = fixtureScenario("greenfield");
    const repo = await makeFixtureScenarioRepo({ kind: "greenfield" });
    cleanups.push(repo.cleanup);
    await repo.repo.commitFile(scenario.path, scenario.markdown, "leak the sealed scenario");

    const error = await leak(async () =>
      proveKeyConfinement([key], { assembledInput: scenario.brief, reachableRoots: [repo.repo.dir] }),
    );
    expect(error.route).toBe("reachability");
    expect(error.location).toContain("FIX-ACC-greenfield.md");
  });

  it("negative control: a working-tree DELETE that leaves the plant in git history still fires", async () => {
    const key = sealedKeyFor("greenfield");
    const scenario = fixtureScenario("greenfield");
    const repo = await makeFixtureScenarioRepo({ kind: "greenfield", commitPlantsThenDelete: true });
    cleanups.push(repo.cleanup);

    // The tree is genuinely clean — a working-tree-only walk would report a
    // clean proof here, which is exactly the assumption this case exists to kill.
    expect(repo.repo.git(["status", "--porcelain"])).toBe("");
    expect(repo.repo.git(["ls-files"])).not.toContain("FIX-ACC-greenfield.md");

    const error = await leak(async () =>
      proveKeyConfinement([key], { assembledInput: scenario.brief, reachableRoots: [repo.repo.dir] }),
    );
    expect(error.route).toBe("reachability");
    expect(error.location).toContain("git log -p");
  });

  it("negative control: key plaintext under a grader-reachable root fires before any file is read", async () => {
    const fixture = await makeAcceptanceCampaignFixture({ kinds: ["greenfield"], vaultInsideCampaignRoot: true });
    cleanups.push(fixture.cleanup);
    const scenario = fixture.scenario("greenfield");
    const key = extractSealedKey({ scenarioId: scenario.id, scenarioMarkdown: scenario.markdown });
    const vaultPath = join(fixture.vaultDir, `${scenario.id}.key.json`);
    await writeFile(vaultPath, JSON.stringify(key), "utf8");
    await fixture.writeEvidence("diff.patch", "no plants here\n");

    const error = await leak(async () =>
      proveKeyConfinement([key], {
        assembledInput: scenario.brief,
        reachableRoots: [fixture.root],
        keyPlaintextPaths: [vaultPath],
      }),
    );
    expect(error.route).toBe("vault-placement");
  });

  it("proves clean when the vault sits outside every reachable root", async () => {
    const fixture = await makeAcceptanceCampaignFixture({ kinds: ["greenfield"] });
    cleanups.push(fixture.cleanup);
    const scenario = fixture.scenario("greenfield");
    const key = extractSealedKey({ scenarioId: scenario.id, scenarioMarkdown: scenario.markdown });
    const vaultPath = join(fixture.vaultDir, `${scenario.id}.key.json`);
    await writeFile(vaultPath, JSON.stringify(key), "utf8");
    await fixture.writeEvidence("diff.patch", "no plants here\n");

    const proof = await proveKeyConfinement([key], {
      assembledInput: scenario.brief,
      reachableRoots: [fixture.evidenceDir],
      keyPlaintextPaths: [vaultPath],
    });
    expect(proof.checkedRoots).toEqual([fixture.evidenceDir]);
  });
});

describe("CF-INV-ACC-1 (L2) route 3 — echo, and the unproven-set refusals", () => {
  it("negative control: a report draft quoting a plant, handed back as grader context, fires", async () => {
    const key = sealedKeyFor("seeded-corpus");
    const scenario = fixtureScenario("seeded-corpus");
    const repo = await makeFixtureScenarioRepo({ kind: "seeded-corpus" });
    cleanups.push(repo.cleanup);
    const draft = `# report draft\n\nP-2 coverage: ${scenario.plants.contradiction[0]}\n`;

    const error = await leak(async () =>
      proveKeyConfinement([key], {
        assembledInput: scenario.brief,
        reachableRoots: [repo.repo.dir],
        echoedArtifacts: [draft],
      }),
    );
    expect(error.route).toBe("echo");
    expect(error.location).toContain("echoed artifact #1");
  });

  it("negative control: a prior grader transcript reproducing a plant fires", async () => {
    const key = sealedKeyFor("job");
    const scenario = fixtureScenario("job");
    const repo = await makeFixtureScenarioRepo({ kind: "job" });
    cleanups.push(repo.cleanup);

    const error = await leak(async () =>
      proveKeyConfinement([key], {
        assembledInput: scenario.brief,
        reachableRoots: [repo.repo.dir],
        echoedArtifacts: ["clean prior axis", `earlier transcript said: ${scenario.plants.tangent[0]}`],
      }),
    );
    expect(error.route).toBe("echo");
    expect(error.location).toContain("#2");
  });

  it("refuses an undeclared reachable set rather than reporting a clean proof over nothing", async () => {
    const key = sealedKeyFor("greenfield");
    await expect(proveKeyConfinement([key], { assembledInput: "brief", reachableRoots: [] })).rejects.toBeInstanceOf(
      SealedKeyError,
    );
  });

  it("refuses an empty reachable root — an absent tree is an empty walk, never an ignorable one", async () => {
    const fixture = await makeAcceptanceCampaignFixture({ kinds: ["greenfield"] });
    cleanups.push(fixture.cleanup);
    const key = sealedKeyFor("greenfield");
    await expect(
      proveKeyConfinement([key], { assembledInput: "brief", reachableRoots: [fixture.evidenceDir] }),
    ).rejects.toThrow(/empty walk/);
  });

  it("refuses when asked to prove confinement of no key at all", async () => {
    await expect(proveKeyConfinement([], { assembledInput: "brief", reachableRoots: ["/tmp"] })).rejects.toBeInstanceOf(
      SealedKeyError,
    );
  });
});
