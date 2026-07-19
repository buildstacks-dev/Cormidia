// Capture layer (#129): merge-write story.json under narrative/<app>/.
//
// The capture is what makes narrative outlive its sources. The fold reads
// live state; this layer merges each fresh story with what was previously
// captured, on one rule: STRUCTURE follows the fresh fold, QUOTES AND
// MOMENTS ARE NEVER LOST. A run dir swept between renders removes the
// moment from the fresh fold — the merge keeps the captured one. A story
// whose sources are entirely gone simply keeps its capture (the CLI
// re-renders markdown from it without a fresh counterpart).

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { writeLoopFileAtomic } from "../loop/durable.js";
import { NARRATIVE_SCHEMA_VERSION, type NarrativeStory } from "./types.js";

export function narrativeDir(stateHome: string, app: string): string {
  return join(stateHome, "narrative", app);
}

/** Path-safe, collision-proof story file stem: readable prefix + 8-hex id
 *  hash (episode ids contain `:` and unvalidated app names). */
export function storySlug(storyId: string): string {
  const readable = storyId.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  const hash = createHash("sha256").update(storyId).digest("hex").slice(0, 8);
  return `${readable === "" ? "story" : readable}-${hash}`;
}

export async function readCapturedStory(
  stateHome: string,
  app: string,
  storyId: string,
): Promise<NarrativeStory | undefined> {
  const path = join(narrativeDir(stateHome, app), `${storySlug(storyId)}.json`);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`narrative capture ${app}/${storySlug(storyId)}.json is not valid JSON`);
  }
  if (!isStory(parsed) || parsed.story_id !== storyId) {
    throw new Error(`narrative capture ${app}/${storySlug(storyId)}.json is not a valid v1 story`);
  }
  return parsed;
}

/** Every previously captured story for an app (for re-rendering after the
 *  sources expire). Corrupt captures are reported, never overwritten. */
export async function listCapturedStories(
  stateHome: string,
  app: string,
): Promise<{ stories: NarrativeStory[]; problems: string[] }> {
  const dir = narrativeDir(stateHome, app);
  const out: { stories: NarrativeStory[]; problems: string[] } = { stories: [], problems: [] };
  if (!existsSync(dir)) return out;
  for (const name of (await readdir(dir)).filter((f) => f.endsWith(".json")).sort()) {
    try {
      const parsed: unknown = JSON.parse(await readFile(join(dir, name), "utf8"));
      if (!isStory(parsed)) {
        out.problems.push(`narrative/${app}/${name}: not a valid v1 story`);
        continue;
      }
      out.stories.push(parsed);
    } catch {
      out.problems.push(`narrative/${app}/${name}: unreadable`);
    }
  }
  return out;
}

/** Merge fresh onto captured. Fresh structure wins; captured quotes/moments
 *  survive source expiry. Returns the story that should be persisted. */
export function mergeStory(captured: NarrativeStory | undefined, fresh: NarrativeStory): NarrativeStory {
  if (captured === undefined) return fresh;
  const freshByRun = new Map(fresh.moments.map((m) => [m.run_id, m]));
  const merged = { ...captured, ...fresh };

  // Union of moments: fresh version of a run wins, but keeps the captured
  // quote when the fresh fold no longer has one (source swept). Captured
  // moments whose runs vanished from the fold stay.
  const moments = new Map(captured.moments.map((m) => [m.run_id, m]));
  for (const [runId, freshMoment] of freshByRun) {
    const prior = moments.get(runId);
    moments.set(
      runId,
      prior?.quote !== undefined && freshMoment.quote === undefined
        ? { ...freshMoment, quote: prior.quote }
        : freshMoment,
    );
  }
  merged.moments = [...moments.values()].sort(
    (a, b) => a.at.localeCompare(b.at) || a.run_id.localeCompare(b.run_id),
  );

  // Never trade a captured quote/record for absence.
  if (merged.origin?.quote === undefined && captured.origin?.quote !== undefined) {
    merged.origin = captured.origin;
  }
  if (merged.planned_tickets === undefined && captured.planned_tickets !== undefined) {
    merged.planned_tickets = captured.planned_tickets;
  }
  if (merged.planned_by === undefined && captured.planned_by !== undefined) {
    merged.planned_by = captured.planned_by;
  }
  if (merged.delivery === undefined && captured.delivery !== undefined) merged.delivery = captured.delivery;
  if (merged.cost === undefined && captured.cost !== undefined) merged.cost = captured.cost;
  if (merged.captured_at.localeCompare(captured.captured_at) < 0) {
    merged.captured_at = captured.captured_at;
  }
  return merged;
}

export async function writeCapturedStory(stateHome: string, story: NarrativeStory): Promise<string> {
  const path = join(narrativeDir(stateHome, story.app), `${storySlug(story.story_id)}.json`);
  await writeLoopFileAtomic(path, JSON.stringify(story, null, 2) + "\n");
  return path;
}

function isStory(value: unknown): value is NarrativeStory {
  if (typeof value !== "object" || value === null) return false;
  const story = value as Record<string, unknown>;
  return (
    story["schema_version"] === NARRATIVE_SCHEMA_VERSION &&
    typeof story["story_id"] === "string" &&
    typeof story["app"] === "string" &&
    typeof story["title"] === "string" &&
    typeof story["opened"] === "string" &&
    typeof story["status"] === "string" &&
    typeof story["captured_at"] === "string" &&
    Array.isArray(story["moments"])
  );
}
