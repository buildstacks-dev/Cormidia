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
// The category vocabulary below is derived from the ratified corpus
// (acceptance/rubric.md §2; acceptance/scenarios/S-ACC-1, S-ACC-2). It is
// tighten-only like the rubric: narrow a marker, never widen one to make a
// scenario parse.

import { createHash } from "node:crypto";

export type PlantCategory = "contradiction" | "under-specification" | "buried-requirement" | "tangent";

export const PLANT_CATEGORIES: readonly PlantCategory[] = [
  "contradiction",
  "under-specification",
  "buried-requirement",
  "tangent",
];

/** Lead-in markers, lowercased, matched as substrings. Ordered most specific
 *  first so "buried hard requirement" never falls through to a looser row. */
const CATEGORY_MARKERS: ReadonlyArray<{ category: PlantCategory; marker: string }> = [
  { category: "buried-requirement", marker: "buried hard requirement" },
  { category: "under-specification", marker: "under-specification" },
  { category: "under-specification", marker: "under-specified" },
  { category: "contradiction", marker: "contradiction" },
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

function categoryOf(leadIn: string): PlantCategory | undefined {
  const lowered = leadIn.toLowerCase();
  return CATEGORY_MARKERS.find((row) => lowered.includes(row.marker))?.category;
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
  const candidates = new Set<string>();
  for (const gram of ngrams(normalizeWords(plantsSection), FINGERPRINT_WORDS)) {
    if (!briefText.includes(gram)) candidates.add(gram);
  }
  for (const token of plantsSection.match(SCREAMING_TOKEN) ?? []) {
    if (!brief.includes(token)) candidates.add(token);
  }
  return [...candidates].sort();
}

export interface ExtractSealedKeyInput {
  scenarioId: string;
  scenarioMarkdown: string;
}

/** Extract a complete key, or refuse. There is no partial result. */
export function extractSealedKey(input: ExtractSealedKeyInput): SealedKey {
  const { brief, plants: plantsSection } = splitScenario(input.scenarioMarkdown);
  const items = plantItems(plantsSection);
  const unmapped = items.filter((item) => categoryOf(item.leadIn) === undefined).map((item) => item.leadIn);
  if (unmapped.length > 0) {
    throw new SealedKeyError(
      "plants-item-unmapped",
      `${input.scenarioId}: plants item(s) whose category the ratified vocabulary cannot map: ` +
        `${unmapped.map((leadIn) => JSON.stringify(leadIn)).join(", ")}. ` +
        `Extraction refuses rather than guessing a category or dropping the item.`,
    );
  }

  const plants = Object.fromEntries(PLANT_CATEGORIES.map((category) => [category, [] as string[]])) as Record<
    PlantCategory,
    string[]
  >;
  for (const item of items) {
    const category = categoryOf(item.leadIn);
    if (category !== undefined && item.body.length > 0) plants[category].push(item.body);
  }

  const missing = PLANT_CATEGORIES.filter((category) => plants[category].length === 0);
  if (missing.length > 0) {
    throw new SealedKeyError(
      "plants-category-missing",
      `${input.scenarioId}: key is partial — missing plant categor(ies) ${missing.join(", ")}. ` +
        `A partial key scores the scenario against fewer expectations than the rubric requires.`,
    );
  }

  return {
    scenarioId: input.scenarioId,
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
