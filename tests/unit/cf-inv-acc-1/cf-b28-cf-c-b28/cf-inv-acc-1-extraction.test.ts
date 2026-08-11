// CF-INV-ACC-1 / CF-B28 / CF-C-B28 — HB-121 — invariants.md INV-ACC-1; CORMIDIA-C-B28-001 §1 and §4.

// Sealed-key extraction, binding and ordering (L1).
//
// CORMIDIA-C-B28-001 §1 and §4. Extraction is complete-or-refused, bound to the
// scenario by content hash, and closed the moment the first grader turn is
// constructed. Every refusal here is pre-grading: a key that is partial, stale
// or late must never reach a scorer, because the axis then scores against
// instrumentation that does not describe the brief.

import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  APP_PLANT_CATEGORIES,
  assertSealedKeyBinding,
  extractSealedKey,
  JOB_PLANT_CATEGORIES,
  plantCategoriesFor,
  SealedKeyError,
  SealedKeyRegistry,
  sha256,
} from "../../../campaign/acceptance/sealed-key.js";
import { fixtureScenario } from "../../../fixtures/acceptance/scenario-corpus.js";
import { assertNonEmptyWalk } from "../../../fixtures/walk.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const ratifiedScenarios = join(repoRoot, "acceptance", "scenarios");

function refusal(run: () => unknown): SealedKeyError {
  try {
    run();
  } catch (error) {
    if (error instanceof SealedKeyError) return error;
    throw error;
  }
  throw new Error("expected a SealedKeyError, but extraction succeeded");
}

describe("CF-INV-ACC-1 (L1) sealed-key extraction is complete or refused", () => {
  it("extracts all four plant categories from a well-formed scenario", () => {
    const scenario = fixtureScenario("greenfield");
    const key = extractSealedKey({
      scenarioId: scenario.id,
      scenarioKind: scenario.scenarioKind,
      scenarioMarkdown: scenario.markdown,
    });
    for (const category of APP_PLANT_CATEGORIES) {
      expect(key.plants[category]).toEqual(scenario.plants[category]);
    }
    expect(key.scenarioKind).toBe("app");
    expect(key.scenarioSha256).toBe(sha256(scenario.markdown));
  });

  it("is idempotent over identical scenario bytes", () => {
    const scenario = fixtureScenario("seeded-corpus");
    const first = extractSealedKey({
      scenarioId: scenario.id,
      scenarioKind: scenario.scenarioKind,
      scenarioMarkdown: scenario.markdown,
    });
    const second = extractSealedKey({
      scenarioId: scenario.id,
      scenarioKind: scenario.scenarioKind,
      scenarioMarkdown: scenario.markdown,
    });
    expect(second).toEqual(first);
  });

  it("negative control: a key missing one of the four categories is refused, not accepted as partial", () => {
    for (const category of APP_PLANT_CATEGORIES) {
      const scenario = fixtureScenario("greenfield", { omitCategories: [category] });
      const error = refusal(() =>
        extractSealedKey({
          scenarioId: scenario.id,
          scenarioKind: scenario.scenarioKind,
          scenarioMarkdown: scenario.markdown,
        }),
      );
      expect(error.code).toBe("plants-category-missing");
      expect(error.message).toContain(category);
    }
  });

  it("negative control: an unmappable plants lead-in is refused and named, never dropped", () => {
    const scenario = fixtureScenario("greenfield", { unmappedLeadIn: "Vibes probe (Q-9)" });
    const error = refusal(() =>
      extractSealedKey({
        scenarioId: scenario.id,
        scenarioKind: scenario.scenarioKind,
        scenarioMarkdown: scenario.markdown,
      }),
    );
    expect(error.code).toBe("plants-item-unmapped");
    expect(error.message).toContain("Vibes probe (Q-9)");
  });

  it("negative control: a scenario with no plants section is refused", () => {
    const scenario = fixtureScenario("greenfield");
    const error = refusal(() =>
      extractSealedKey({
        scenarioId: scenario.id,
        scenarioKind: scenario.scenarioKind,
        scenarioMarkdown: scenario.brief,
      }),
    );
    expect(error.code).toBe("plants-section-missing");
  });

  it("keeps sub-points under one category rather than treating them as separate items", () => {
    const scenario = fixtureScenario("greenfield");
    const withSubPoints = scenario.markdown.replace(
      "**Buried hard requirements (P-1):**",
      "**Buried hard requirements (P-1):**\n1. **Rate history** — temporal rates.\n2. **Timezones** — day resolution.\n",
    );
    const key = extractSealedKey({
      scenarioId: scenario.id,
      scenarioKind: scenario.scenarioKind,
      scenarioMarkdown: withSubPoints,
    });
    expect(key.plants["buried-requirement"]).toHaveLength(1);
    expect(key.plants["buried-requirement"][0]).toContain("Rate history");
  });

  it("negative control: key/scenario hash drift invalidates both", () => {
    const scenario = fixtureScenario("greenfield");
    const key = extractSealedKey({
      scenarioId: scenario.id,
      scenarioKind: scenario.scenarioKind,
      scenarioMarkdown: scenario.markdown,
    });
    expect(() => assertSealedKeyBinding(key, scenario.markdown)).not.toThrow();
    const drifted = `${scenario.markdown}\nA sentence the human added after sealing.\n`;
    const error = refusal(() => assertSealedKeyBinding(key, drifted));
    expect(error.code).toBe("scenario-hash-mismatch");
  });

  it("derives fingerprints that are distinctive to the plants, never shared with the brief", () => {
    const scenario = fixtureScenario("greenfield");
    const key = extractSealedKey({
      scenarioId: scenario.id,
      scenarioKind: scenario.scenarioKind,
      scenarioMarkdown: scenario.markdown,
    });
    expect(key.fingerprints.length).toBeGreaterThan(0);
    for (const fingerprint of key.fingerprints) {
      expect(scenario.brief.toLowerCase()).not.toContain(fingerprint.toLowerCase());
    }
    expect(key.fingerprints).toContain("PLANT-CONTRADICTION-GREENFIELD");
  });
});

describe("CF-INV-ACC-1 (L1) extraction ordering: exactly once, before the first grader turn", () => {
  it("seals each scenario once and hands the same key back afterwards", () => {
    const registry = new SealedKeyRegistry();
    const scenario = fixtureScenario("greenfield");
    const key = registry.seal({
      scenarioId: scenario.id,
      scenarioKind: scenario.scenarioKind,
      scenarioMarkdown: scenario.markdown,
    });
    expect(registry.key(scenario.id)).toEqual(key);
    expect(registry.sealedScenarioIds()).toEqual([scenario.id]);
  });

  it("negative control: a second extraction of the same scenario is refused", () => {
    const registry = new SealedKeyRegistry();
    const scenario = fixtureScenario("greenfield");
    registry.seal({
      scenarioId: scenario.id,
      scenarioKind: scenario.scenarioKind,
      scenarioMarkdown: scenario.markdown,
    });
    const error = refusal(() =>
      registry.seal({
        scenarioId: scenario.id,
        scenarioKind: scenario.scenarioKind,
        scenarioMarkdown: scenario.markdown,
      }),
    );
    expect(error.code).toBe("duplicate-extraction");
  });

  it("negative control: extraction after a grader turn exists is refused — there is no late path", () => {
    const registry = new SealedKeyRegistry();
    registry.noteGraderTurnConstructed();
    const scenario = fixtureScenario("seeded-corpus");
    const error = refusal(() =>
      registry.seal({
        scenarioId: scenario.id,
        scenarioKind: scenario.scenarioKind,
        scenarioMarkdown: scenario.markdown,
      }),
    );
    expect(error.code).toBe("extraction-after-grader-turn");
    expect(registry.graderTurnCount()).toBe(1);
  });

  it("refuses to hand back a key that was never sealed", () => {
    const registry = new SealedKeyRegistry();
    expect(refusal(() => registry.key("S-ACC-9")).code).toBe("key-absent");
  });
});

describe("CF-INV-ACC-1 (L1) the ratified scenario corpus", () => {
  it("walks a non-empty scenario corpus", async () => {
    const files = await assertNonEmptyWalk(ratifiedScenarios, /^S-ACC-\d.*\.md$/);
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  it("extracts a complete four-category key from every ratified APP scenario", async () => {
    for (const id of ["S-ACC-1-greenfield-web", "S-ACC-2-corpus-refresh"]) {
      const markdown = await readFile(join(ratifiedScenarios, `${id}.md`), "utf8");
      const key = extractSealedKey({ scenarioId: id, scenarioKind: "app", scenarioMarkdown: markdown });
      for (const category of APP_PLANT_CATEGORIES) {
        expect(key.plants[category].length, `${id} ${category}`).toBeGreaterThan(0);
      }
    }
  });

  // F-PT-032 RESOLVED-RATIFIED 2026-08-08 (rubric §9). The four plant categories
  // are plan-axis instrumentation and a job scenario has no plan arm, so job
  // scenarios carry their own four. S-ACC-3 was NOT edited — it already satisfies
  // the ratified job list as written, which is why the amendment was the right
  // resolution rather than a rewrite of a human-ratified brief.
  it("extracts a complete four-category JOB key from the ratified S-ACC-3, unedited", async () => {
    const id = "S-ACC-3-research-viz-job";
    const markdown = await readFile(join(ratifiedScenarios, `${id}.md`), "utf8");
    const key = extractSealedKey({ scenarioId: id, scenarioKind: "job", scenarioMarkdown: markdown });
    expect(key.scenarioKind).toBe("job");
    for (const category of JOB_PLANT_CATEGORIES) {
      expect(key.plants[category].length, `${id} ${category}`).toBeGreaterThan(0);
    }
    // J-2 is scored against this key, so an extractable key is exactly what
    // makes the highest-value job axis gradeable at all.
    expect(key.plants["input-conflict"].join(" ")).toMatch(/conflict|disagree/i);
  });

  it("negative control: the JOB list is applied to job scenarios only — the app list still refuses S-ACC-3", async () => {
    const id = "S-ACC-3-research-viz-job";
    const markdown = await readFile(join(ratifiedScenarios, `${id}.md`), "utf8");
    const error = refusal(() => extractSealedKey({ scenarioId: id, scenarioKind: "app", scenarioMarkdown: markdown }));
    expect(error.code).toBe("plants-item-unmapped");
    expect(error.message).toContain("app scenario");
  });

  it("negative control: an app scenario graded against the JOB list is refused too — neither list is a superset", async () => {
    const markdown = await readFile(join(ratifiedScenarios, "S-ACC-1-greenfield-web.md"), "utf8");
    const error = refusal(() =>
      extractSealedKey({ scenarioId: "S-ACC-1", scenarioKind: "job", scenarioMarkdown: markdown }),
    );
    expect(error.code).toBe("plants-item-unmapped");
  });

  it("keeps the two lists distinct and the same size", () => {
    expect(plantCategoriesFor("app")).toEqual(APP_PLANT_CATEGORIES);
    expect(plantCategoriesFor("job")).toEqual(JOB_PLANT_CATEGORIES);
    expect(JOB_PLANT_CATEGORIES).toHaveLength(APP_PLANT_CATEGORIES.length);
    expect(new Set([...APP_PLANT_CATEGORIES, ...JOB_PLANT_CATEGORIES]).size).toBe(7);
  });
});
