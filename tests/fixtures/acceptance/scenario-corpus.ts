// fixtures/acceptance/scenario-corpus.ts — fixture L-ACC scenario markdown.
//
// A scenario file is a ramble brief plus a `## Plants` section that the grader
// must never reach (acceptance/rubric.md §2, CORMIDIA-C-B28-001). These
// fixtures mirror that shape at fixture scale so the sealed-key machinery is
// exercised without depending on the ratified corpus — and so the violations
// can be SEEDED, which committed human-authored scenarios can never be.
//
// Every plant body carries a unique uppercase token (`PLANT-…`). Confinement
// is then a byte question with an unambiguous answer: the token appears, or it
// does not. Prose similarity is deliberately not the test — B-28 §5 declines to
// claim semantic confinement, and so does this fixture.

// The four categories come from the contract module, never a private copy: a
// fixture that owned its own category list could drift into agreeing with
// itself while disagreeing with rubric §2.
export { PLANT_CATEGORIES, type PlantCategory } from "../../campaign/acceptance/sealed-key.js";
import { PLANT_CATEGORIES, type PlantCategory } from "../../campaign/acceptance/sealed-key.js";

/** The three scenario shapes the lane's fixture kit must cover (HB-120): the
 *  greenfield app arm, the brownfield seeded-corpus arm, and the job arm. */
export type FixtureScenarioKind = "greenfield" | "seeded-corpus" | "job";

export const FIXTURE_SCENARIO_KINDS: readonly FixtureScenarioKind[] = ["greenfield", "seeded-corpus", "job"];

export interface FixtureScenarioOptions {
  /** Seed a PARTIAL key: drop these categories from the plants section.
   *  B-28 §1 refuses such a key rather than accepting it — a partial key does
   *  not read as an error downstream, it reads as generosity. */
  omitCategories?: readonly PlantCategory[];
  /** Seed an ASSEMBLY leak: repeat these categories' tokens inside the brief,
   *  which is legitimately handed to the grader. This is the CF-INV-ACC-1
   *  negative control. */
  leakIntoBrief?: readonly PlantCategory[];
  /** Seed UNRECOGNIZED plant vocabulary: an extra bold lead-in that the
   *  category table cannot map. Extraction must refuse and name it rather than
   *  silently dropping the item. */
  unmappedLeadIn?: string;
}

export interface FixtureScenario {
  id: string;
  kind: FixtureScenarioKind;
  /** Repo-relative path this scenario would occupy in a campaign corpus. */
  path: string;
  /** The full file: heading, brief, and the sealed `## Plants` section. */
  markdown: string;
  /** The grader-visible half — everything above `## Plants`. */
  brief: string;
  /** Expected extraction result, category → plant bodies (already trimmed). */
  plants: Record<PlantCategory, string[]>;
  /** The unique tokens a confinement check must never find in grader reach. */
  tokens: string[];
}

interface PlantSpec {
  leadIn: string;
  body: string;
}

/** Plant text per kind. The lead-ins deliberately use the exact vocabulary the
 *  ratified S-ACC-1/S-ACC-2 corpus uses, because the extraction grammar is
 *  keyed to that vocabulary and a fixture written in private dialect would
 *  prove the grammar against itself. */
function plantSpecs(kind: FixtureScenarioKind, slug: string): Record<PlantCategory, PlantSpec> {
  const token = (category: string): string => `PLANT-${category}-${slug.toUpperCase()}`;
  return {
    contradiction: {
      leadIn: "Contradiction (P-2)",
      body:
        `the brief promises exactly one paid tier and then offers a free allowance ` +
        `two paragraphs later (${token("CONTRADICTION")}). Naming the reversal is the strong result; ` +
        `silently choosing either side scores 0.`,
    },
    "under-specification": {
      leadIn: "Under-specification (P-3)",
      body:
        `the retention window is described as "however long is normal" and nothing else ` +
        `(${token("UNDERSPEC")}). Parking or asking is correct; inventing a window and building it scores 0.`,
    },
    "buried-requirement": {
      leadIn: "Buried hard requirements (P-1)",
      body:
        `stated once, in passing, and easy to skim past (${token("BURIED")}): historical values must ` +
        `survive a later edit, which is a schema-level requirement rather than a display concern.`,
    },
    tangent: {
      leadIn:
        kind === "job" ? "Tangents that must not become steps (P-4)" : "Tangents that must not become tickets (P-4)",
      body: `the closing "it would also be interesting" sentence (${token("TANGENT")}). A ticket for it is a P-4 deduction.`,
    },
  };
}

const BRIEFS: Record<FixtureScenarioKind, { title: string; slug: string; body: string }> = {
  greenfield: {
    title: "FIX-ACC-1 — fixture greenfield app",
    slug: "greenfield",
    body:
      "So I've been tracking my hours in a spreadsheet for years and it is honestly fine\n" +
      "until it isn't. What I want is a small web thing where I can log time against a\n" +
      "client and get an invoice out of it. One paid tier, no free tier, I am tired of\n" +
      "free tiers. Oh — and give people a couple of clients free so they can try it.\n" +
      "Keep old invoices reading the way they read when I sent them. Don't build me a\n" +
      "project manager.\n",
  },
  "seeded-corpus": {
    title: "FIX-ACC-2 — fixture brownfield corpus",
    slug: "corpus",
    body:
      "There are ten tutorials in the docs repo and most of them are wrong now. Go\n" +
      "through all of them. Don't touch the getting-started one without talking to me\n" +
      "first. Some of them overlap and I can't remember which ones — you'll see it when\n" +
      "you read them. Don't just delete things quietly, tell me first.\n",
  },
  job: {
    title: "FIX-ACC-3 — fixture research job",
    slug: "job",
    body:
      "Pull together what the three input notes say about each tool, merge them into\n" +
      "one file, then draw me a picture of it. If two notes disagree, keep the\n" +
      "disagreement in writing rather than picking a winner. If you can't find a\n" +
      "weakness for something, say so — don't make one up. One self-contained HTML\n" +
      "file, no build step.\n",
  },
};

/** Build one fixture scenario, optionally seeding a violation. */
export function fixtureScenario(kind: FixtureScenarioKind, options: FixtureScenarioOptions = {}): FixtureScenario {
  const meta = BRIEFS[kind];
  const specs = plantSpecs(kind, meta.slug);
  const omitted = new Set(options.omitCategories ?? []);
  const included = PLANT_CATEGORIES.filter((category) => !omitted.has(category));

  const leakedLines = (options.leakIntoBrief ?? []).map(
    (category) => `\nAlso worth writing down: ${specs[category].body}\n`,
  );
  const brief = `# ${meta.title}\n\n## The brief (ramble — this is the input verbatim)\n\n${meta.body}${leakedLines.join("")}`;

  const plantItems = included.map((category) => `**${specs[category].leadIn}:** ${specs[category].body}`);
  if (options.unmappedLeadIn !== undefined) {
    plantItems.push(`**${options.unmappedLeadIn}:** an item whose category the grammar cannot map.`);
  }

  const markdown =
    `${brief}\n## Plants — SEALED, extracted to the answer key, grader must not receive this\n\n` +
    `${plantItems.join("\n\n")}\n`;

  const plants = Object.fromEntries(
    PLANT_CATEGORIES.map((category) => [category, included.includes(category) ? [specs[category].body] : []]),
  ) as Record<PlantCategory, string[]>;

  return {
    id: `FIX-ACC-${kind}`,
    kind,
    path: `acceptance/scenarios/FIX-ACC-${kind}.md`,
    markdown,
    brief,
    plants,
    tokens: included.map((category) => uniqueToken(specs[category].body)),
  };
}

/** The `PLANT-…` token embedded in a plant body. Exported shape is the body,
 *  so the token is recovered rather than duplicated in two places. */
function uniqueToken(body: string): string {
  const match = /PLANT-[A-Z]+-[A-Z0-9-]+/.exec(body);
  if (match === null) throw new Error(`fixture plant body carries no PLANT- token: ${body}`);
  return match[0];
}
