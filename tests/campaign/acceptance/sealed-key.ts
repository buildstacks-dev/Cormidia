// campaign/acceptance/sealed-key.ts — extraction and sealing of a scenario's
// answer key (CORMIDIA-C-B28-001 §1, §4; CORMIDIA-INV-ACC-1).
//
// Extraction is mechanical, which means the grammar is fixed and fail-closed:
// a plants item whose lead-in the category table cannot map is REFUSED and
// named, never dropped. Dropping it would silently produce a partial key, and
// B-28 §1 is explicit about why that is worse than an error — a partial key
// does not read as a defect downstream, it reads as generosity, because the
// axis then scores against fewer expectations than the rubric requires.
//
// THE REQUIRED CATEGORIES DEPEND ON THE SCENARIO KIND (rubric §2 for app, §9 for
// job — amendment ratified 2026-08-08, resolving F-PT-032). The app list is
// plan-axis instrumentation, and a job scenario has no Planner and no plan arm,
// so requiring it there demanded instrumentation for a measurement that never
// happens — and left J-2, the highest-value job axis, permanently ungradeable.
// Four categories either way; complete-or-refused either way.
//
// The vocabularies below are derived from the ratified corpus
// (acceptance/scenarios/S-ACC-1, S-ACC-2, S-ACC-3). They are tighten-only like
// the rubric: narrow a marker, never widen one to make a scenario parse.

import { createHash } from "node:crypto";

/** App-scenario categories — rubric §2. */
export type AppPlantCategory = "contradiction" | "under-specification" | "buried-requirement" | "tangent";
/** Job-scenario categories — rubric §9. `tangent` is shared: it is the same
 *  concept, and a step is as wrong a place for a tangent as a ticket is. */
export type JobPlantCategory = "input-conflict" | "undiscoverable-answer" | "deliverable-constraint" | "tangent";
export type PlantCategory = AppPlantCategory | JobPlantCategory;

export type ScenarioKind = "app" | "job";

export const APP_PLANT_CATEGORIES: readonly AppPlantCategory[] = [
  "contradiction",
  "under-specification",
  "buried-requirement",
  "tangent",
];

export const JOB_PLANT_CATEGORIES: readonly JobPlantCategory[] = [
  "input-conflict",
  "undiscoverable-answer",
  "deliverable-constraint",
  "tangent",
];

export function plantCategoriesFor(kind: ScenarioKind): readonly PlantCategory[] {
  return kind === "job" ? JOB_PLANT_CATEGORIES : APP_PLANT_CATEGORIES;
}

/** Lead-in markers, lowercased, matched as substrings. Ordered most specific
 *  first so "buried hard requirement" never falls through to a looser row. */
const APP_MARKERS: ReadonlyArray<{ category: PlantCategory; marker: string }> = [
  { category: "buried-requirement", marker: "buried hard requirement" },
  { category: "under-specification", marker: "under-specification" },
  { category: "under-specification", marker: "under-specified" },
  { category: "contradiction", marker: "contradiction" },
  { category: "tangent", marker: "tangent" },
];

// S-ACC-3 heads its conflict plant "J-2 handoff fidelity" because the conflict
// IS the handoff instrumentation — the failure it catches is a fan-in step that
// resolves two disagreeing sources into one confident claim instead of
// preserving the disagreement. Both spellings map, so the ratified brief parses
// as written and a future scenario may say "conflict" outright.
const JOB_MARKERS: ReadonlyArray<{ category: PlantCategory; marker: string }> = [
  { category: "input-conflict", marker: "handoff fidelity" },
  { category: "input-conflict", marker: "conflict" },
  { category: "undiscoverable-answer", marker: "honest-absence" },
  { category: "undiscoverable-answer", marker: "honest absence" },
  { category: "undiscoverable-answer", marker: "no discoverable answer" },
  { category: "deliverable-constraint", marker: "hard requirement" },
  { category: "deliverable-constraint", marker: "ordering constraint" },
  { category: "deliverable-constraint", marker: "deliverable constraint" },
  { category: "tangent", marker: "tangent" },
];

export type SealedKeyErrorCode =
  | "plants-section-missing"
  | "plants-item-unmapped"
  | "plants-category-missing"
  | "scenario-hash-mismatch"
  | "key-absent"
  | "extraction-after-grader-turn"
  | "duplicate-extraction";

export class SealedKeyError extends Error {
  constructor(
    readonly code: SealedKeyErrorCode,
    message: string,
  ) {
    super(`sealed key refused (${code}): ${message}`);
    this.name = "SealedKeyError";
  }
}

export interface SealedKey {
  scenarioId: string;
  /** Which ratified category list this key was extracted against. */
  scenarioKind: ScenarioKind;
  /** Content hash of the exact scenario bytes the key was extracted from. */
  scenarioSha256: string;
  plants: Record<PlantCategory, string[]>;
  /** Byte fingerprints a confinement check searches for. Deliberately NOT a
   *  semantic model — B-28 §5 declines to claim semantic confinement and so
   *  does this: an 8-word normalized n-gram, or an all-caps hyphenated token,
   *  that occurs in the plants section and NOT in the brief. */
  fingerprints: string[];
}

const PLANTS_HEADING = /^##\s+Plants\b/m;
const ITEM_LEAD_IN = /^\*\*(.+?)\*\*/;
const SCREAMING_TOKEN = /\b[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+\b/g;
const PUBLIC_AXIS_TOKEN = /^(?:P|O|J)-\d+$/;
const FINGERPRINT_WORDS = 8;

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Split a scenario file at its plants heading. The brief is everything above,
 *  which is exactly the half a grader may legitimately be handed. */
function splitScenario(markdown: string): { brief: string; plants: string } {
  const match = PLANTS_HEADING.exec(markdown);
  if (match?.index === undefined) {
    throw new SealedKeyError("plants-section-missing", "the scenario has no `## Plants` section");
  }
  return { brief: markdown.slice(0, match.index), plants: markdown.slice(match.index) };
}

/** The only scenario bytes permitted to cross into a scenario repository. */
export function visibleScenarioBrief(markdown: string): string {
  return splitScenario(markdown).brief.trimEnd() + "\n";
}

/** Extract only the human's verbatim ramble, excluding scenario rationale,
 * matrix notes, expectations and the sealed Plants section. */
export function scenarioRamble(markdown: string): string {
  const visible = visibleScenarioBrief(markdown);
  const heading = /^##\s+The brief\b.*$/m.exec(visible);
  if (heading?.index === undefined)
    throw new SealedKeyError("plants-section-missing", "the scenario has no brief heading");
  const after = visible.slice(heading.index + heading[0].length);
  const nextHeading = /^##\s+/m.exec(after);
  const section = nextHeading?.index === undefined ? after : after.slice(0, nextHeading.index);
  const lines = section
    .split("\n")
    .filter((line) => /^>/.test(line))
    .map((line) => line.replace(/^> ?/, ""));
  if (lines.length === 0) throw new SealedKeyError("plants-section-missing", "the scenario brief has no quoted ramble");
  return `${lines.join("\n").trim()}\n`;
}

function categoryOf(leadIn: string, kind: ScenarioKind): PlantCategory | undefined {
  const lowered = leadIn.toLowerCase();
  const markers = kind === "job" ? JOB_MARKERS : APP_MARKERS;
  return markers.find((row) => lowered.includes(row.marker))?.category;
}

/** Items are paragraphs whose FIRST line opens with a bold lead-in. Nested
 *  bold inside a numbered sub-list is deliberately not an item — the ratified
 *  corpus uses `1. **Name** — …` for sub-points under one category. */
function plantItems(plantsSection: string): Array<{ leadIn: string; body: string }> {
  const lines = plantsSection.split("\n").slice(1);
  const items: Array<{ leadIn: string; body: string[] }> = [];
  for (const line of lines) {
    const lead = ITEM_LEAD_IN.exec(line);
    if (lead !== null && lead[1] !== undefined) {
      items.push({ leadIn: lead[1], body: [line.slice(lead[0].length)] });
    } else if (items.length > 0) {
      items[items.length - 1]?.body.push(line);
    }
  }
  return items.map((item) => ({
    leadIn: item.leadIn,
    body: item.body
      .join("\n")
      .replace(/^[:\s]+/, "")
      .trim(),
  }));
}

function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 0);
}

function ngrams(words: string[], size: number): string[] {
  if (words.length < size) return words.length === 0 ? [] : [words.join(" ")];
  return Array.from({ length: words.length - size + 1 }, (_unused, index) =>
    words.slice(index, index + size).join(" "),
  );
}

function computeFingerprints(plantsSection: string, brief: string): string[] {
  const briefText = normalizeWords(brief).join(" ");
  // Category lead-ins carry public rubric vocabulary such as `P-2`. Only the
  // plant bodies are answer material; fingerprinting headings makes a clean
  // rubric excerpt look like a key leak.
  const answerMaterial = plantItems(plantsSection)
    .map((item) => item.body)
    .join("\n");
  const candidates = new Set<string>();
  for (const gram of ngrams(normalizeWords(answerMaterial), FINGERPRINT_WORDS)) {
    if (!briefText.includes(gram)) candidates.add(gram);
  }
  for (const token of answerMaterial.match(SCREAMING_TOKEN) ?? []) {
    if (!PUBLIC_AXIS_TOKEN.test(token) && !brief.includes(token)) candidates.add(token);
  }
  return [...candidates].sort();
}

export interface ExtractSealedKeyInput {
  scenarioId: string;
  /** Required, never defaulted: the kind decides which four categories are
   *  mandatory, so guessing it would guess the completeness rule. */
  scenarioKind: ScenarioKind;
  scenarioMarkdown: string;
}

/** Extract a complete key, or refuse. There is no partial result. */
export function extractSealedKey(input: ExtractSealedKeyInput): SealedKey {
  const { brief, plants: plantsSection } = splitScenario(input.scenarioMarkdown);
  const categories = plantCategoriesFor(input.scenarioKind);
  const items = plantItems(plantsSection);
  const unmapped = items
    .filter((item) => categoryOf(item.leadIn, input.scenarioKind) === undefined)
    .map((item) => item.leadIn);
  if (unmapped.length > 0) {
    throw new SealedKeyError(
      "plants-item-unmapped",
      `${input.scenarioId} (${input.scenarioKind} scenario): plants item(s) whose category the ratified ` +
        `vocabulary cannot map: ${unmapped.map((leadIn) => JSON.stringify(leadIn)).join(", ")}. ` +
        `Extraction refuses rather than guessing a category or dropping the item.`,
    );
  }

  const plants = Object.fromEntries(categories.map((category) => [category, [] as string[]])) as Record<
    PlantCategory,
    string[]
  >;
  for (const item of items) {
    const category = categoryOf(item.leadIn, input.scenarioKind);
    if (category !== undefined && item.body.length > 0) plants[category]?.push(item.body);
  }

  const missing = categories.filter((category) => (plants[category] ?? []).length === 0);
  if (missing.length > 0) {
    throw new SealedKeyError(
      "plants-category-missing",
      `${input.scenarioId} (${input.scenarioKind} scenario): key is partial — missing plant categor(ies) ` +
        `${missing.join(", ")}. ` +
        `A partial key scores the scenario against fewer expectations than the rubric requires.`,
    );
  }

  return {
    scenarioId: input.scenarioId,
    scenarioKind: input.scenarioKind,
    scenarioSha256: sha256(input.scenarioMarkdown),
    plants,
    fingerprints: computeFingerprints(plantsSection, brief),
  };
}

/** Re-bind a key to scenario bytes. Drift invalidates BOTH (B-28 §1). */
export function assertSealedKeyBinding(key: SealedKey, scenarioMarkdown: string): void {
  const actual = sha256(scenarioMarkdown);
  if (actual !== key.scenarioSha256) {
    throw new SealedKeyError(
      "scenario-hash-mismatch",
      `${key.scenarioId}: key was sealed against ${key.scenarioSha256.slice(0, 12)} but the scenario now hashes ` +
        `${actual.slice(0, 12)}; both are invalid until re-extracted`,
    );
  }
}

/**
 * Ordering authority for one campaign (B-28 §1, §4): extraction happens exactly
 * once per scenario and strictly before the first grader turn is constructed.
 * There is no late path, so the registry refuses rather than re-extracting.
 */
export class SealedKeyRegistry {
  private readonly keys = new Map<string, SealedKey>();
  private graderTurnsConstructed = 0;

  seal(input: ExtractSealedKeyInput): SealedKey {
    if (this.graderTurnsConstructed > 0) {
      throw new SealedKeyError(
        "extraction-after-grader-turn",
        `${input.scenarioId}: ${this.graderTurnsConstructed} grader turn(s) already constructed; a key extracted ` +
          `after grading began is invalid and there is no late path`,
      );
    }
    if (this.keys.has(input.scenarioId)) {
      throw new SealedKeyError("duplicate-extraction", `${input.scenarioId}: already sealed for this campaign`);
    }
    const key = extractSealedKey(input);
    this.keys.set(input.scenarioId, key);
    return key;
  }

  key(scenarioId: string): SealedKey {
    const key = this.keys.get(scenarioId);
    if (key === undefined) throw new SealedKeyError("key-absent", `${scenarioId}: no sealed key for this scenario`);
    return key;
  }

  sealedScenarioIds(): string[] {
    return [...this.keys.keys()].sort();
  }

  /** Called at grader-turn construction; closes the extraction window. */
  noteGraderTurnConstructed(): void {
    this.graderTurnsConstructed += 1;
  }

  graderTurnCount(): number {
    return this.graderTurnsConstructed;
  }
}
