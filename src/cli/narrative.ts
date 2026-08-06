// `cormidia narrative` (#129) — the human-level causal timeline.
//
// Renders one markdown story per episode plus a per-app INDEX.md under the
// state home's narrative/ subtree. Deterministic and token-free: fold the
// durable sources, merge with prior captures (quotes are never lost to
// retention), write captures + markdown atomically. Read-only toward every
// other subtree.

import { existsSync } from "node:fs";
import { readdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { writeLoopFileAtomic } from "../loop/durable.js";
import {
  listCapturedStories,
  mergeStory,
  narrativeDir,
  readCapturedStory,
  storySlug,
  writeCapturedStory,
} from "../narrative/capture.js";
import { renderIndexMarkdown, renderStoryMarkdown } from "../narrative/render.js";
import { foldAppStories } from "../narrative/story.js";
import type { NarrativeStory } from "../narrative/types.js";
import { resolveCormidiaHomes } from "../org/home.js";
import { extractHomeFlags } from "./home-flags.js";

interface NarrativeArgs {
  app?: string;
  episode?: string;
  json: boolean;
}

export async function cmdNarrative(args: string[]): Promise<number> {
  const common = extractHomeFlags(args, "narrative");
  const parsed = parseNarrativeArgs(common.rest);
  const homes = await resolveCormidiaHomes(common);
  const stateHome = homes.stateHome;

  const apps = await resolveApps(
    stateHome,
    homes.appsFile.apps.map((app) => app.name),
    parsed.app,
  );
  if (apps.length === 0) {
    console.error(`narrative: no apps found${parsed.app !== undefined ? ` matching "${parsed.app}"` : ""}`);
    return 1;
  }

  let printed = false;
  const summaries: Array<{ app: string; stories: number; index: string; problems: string[] }> = [];
  for (const app of apps) {
    const fold = await foldAppStories(stateHome, app);
    const captured = await listCapturedStories(stateHome, app);
    const problems = [...fold.problems, ...captured.problems];

    // Merge fresh onto captured; captures whose sources are entirely gone
    // survive untouched and still re-render.
    const merged = new Map<string, NarrativeStory>(captured.stories.map((s) => [s.story_id, s]));
    for (const fresh of fold.stories) {
      let prior: NarrativeStory | undefined;
      try {
        prior = merged.get(fresh.story_id) ?? (await readCapturedStory(stateHome, app, fresh.story_id));
      } catch (error) {
        // Corrupt capture: quarantine the bytes for forensics, then let the
        // fresh fold recapture — dropping the story here would lose its
        // quotes to the next runs/ sweep AND hide it from INDEX/--episode.
        problems.push(`${(error as Error).message} — moved aside to .corrupt; recaptured from live sources`);
        await quarantineCorruptCapture(stateHome, app, fresh.story_id);
        prior = undefined;
      }
      merged.set(fresh.story_id, mergeStory(prior, fresh));
    }

    const stories = [...merged.values()];
    if (parsed.episode !== undefined) {
      const story = stories.find((s) => s.story_id === parsed.episode);
      if (story === undefined) continue;
      if (parsed.json) console.log(JSON.stringify(story, null, 2));
      else console.log(renderStoryMarkdown(story));
      printed = true;
      continue;
    }

    for (const story of stories) {
      await writeCapturedStory(stateHome, story);
      await writeLoopFileAtomic(
        join(narrativeDir(stateHome, app), `${storySlug(story.story_id)}.md`),
        renderStoryMarkdown(story),
      );
    }
    await writeLoopFileAtomic(join(narrativeDir(stateHome, app), "INDEX.md"), renderIndexMarkdown(app, stories));
    summaries.push({ app, stories: stories.length, index: join(narrativeDir(stateHome, app), "INDEX.md"), problems });
    if (!parsed.json) {
      console.log(`narrative: ${app} — ${stories.length} story(ies) → ${narrativeDir(stateHome, app)}`);
      for (const problem of problems) console.error(`narrative: warning: ${problem}`);
    }
    printed = true;
  }

  // One parseable document, like `cormidia report --json` — never a
  // concatenated stream of per-app objects.
  if (parsed.json && parsed.episode === undefined) console.log(JSON.stringify(summaries, null, 2));

  if (parsed.episode !== undefined && !printed) {
    console.error(`narrative: episode "${parsed.episode}" not found`);
    return 1;
  }
  return 0;
}

/** Preserve the corrupt bytes beside the capture (`<slug>.json.corrupt`)
 *  so recapture never silently destroys evidence of what went wrong. */
async function quarantineCorruptCapture(stateHome: string, app: string, storyId: string): Promise<void> {
  const path = join(narrativeDir(stateHome, app), `${storySlug(storyId)}.json`);
  try {
    await rename(path, `${path}.corrupt`);
  } catch {
    // Already quarantined or vanished — recapture proceeds either way.
  }
}

function parseNarrativeArgs(args: string[]): NarrativeArgs {
  const out: NarrativeArgs = { json: false };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--app") out.app = need(args, ++index, arg);
    else if (arg === "--episode") out.episode = need(args, ++index, arg);
    else if (arg === "--json") out.json = true;
    else throw new Error(`narrative: unknown argument "${arg}"`);
  }
  return out;
}

/** Union of configured apps and apps with any runs/ or narrative/ presence,
 *  so historical apps removed from apps.yaml still render their captures. */
async function resolveApps(stateHome: string, configured: string[], filter?: string): Promise<string[]> {
  const names = new Set(configured);
  for (const subtree of ["runs", "narrative"]) {
    const dir = join(stateHome, subtree);
    if (!existsSync(dir)) continue;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) names.add(entry.name);
    }
  }
  return [...names].sort().filter((name) => filter === undefined || name === filter);
}

function need(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (value === undefined) throw new Error(`narrative: ${flag} needs a value`);
  return value;
}
