// CF-INV-011 — narrative capture applies the shared secret policy at capture
// time: L2 composition on a temp state home (HB-016, FLOOR).
//
// OPERON-INV-011 adversarial seed (c) (validation-design/invariants.md):
// "secret in run log → narrative capture (years-durable)". B-12 contract §5:
// "narrative capture applies the shared secret policy at capture time
// (INV-011 — years-durable records)". The capture outlives its L3 sources by
// years, so the quote/caption scrub at capture time is the guardrail — L3
// files themselves legitimately hold verbatim secrets (that is their
// permitted boundary; "secrets are never written" was explicitly REJECTED as
// an invariant in favor of confinement).
//
// Composition under test: REAL `readRunQuote` / `boundQuote` /
// `scrubCaptureText` (src/narrative/sources.ts) feeding REAL
// `writeCapturedStory` / `readCapturedStory` (src/narrative/capture.ts) and
// REAL `renderStoryMarkdown` (src/narrative/render.ts), over L3 files
// planted at real runPaths locations on a fixture temp state home.
//
// Layer: 2 (real temp home, real product modules; no network, no tokens).

import { afterEach, describe, expect, it } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  boundQuote,
  MOMENT_QUOTE_MAX,
  ORIGIN_QUOTE_MAX,
  readRunQuote,
  scrubCaptureText,
} from "../../../src/narrative/sources.js";
import {
  narrativeDir,
  readCapturedStory,
  storySlug,
  writeCapturedStory,
} from "../../../src/narrative/capture.js";
import { renderStoryMarkdown } from "../../../src/narrative/render.js";
import { runPaths } from "../../../src/runtime/runlog/paths.js";
import type { NarrativeQuote, NarrativeStory } from "../../../src/narrative/types.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";
import { assertNonEmptyWalk } from "../../fixtures/walk.js";
import { makeSyntheticSecret, type SyntheticSecret } from "../../fixtures/synthetic-secret.js";
import {
  detectSecretEgress,
  detectSecretEgressInJson,
  makeAllSeeds,
  SecretEgressViolation,
} from "../../unit/cf-inv-011/secret-egress-detector.js";

const APP = "cf-inv-011-app";
const RUN_ID = "20260731-120000-build-implement";
const STORY_ID = "episode:cf-inv-011:1";

/** Plant a verbatim L3 file — the PERMITTED boundary for secrets. */
async function plantL3(
  state: TempStateHome,
  file: "output.md" | "brief.md" | "prompt.md",
  text: string,
): Promise<void> {
  const paths = runPaths(state.stateHome, APP, RUN_ID);
  await mkdir(paths.dir, { recursive: true });
  await writeFile(join(paths.dir, file), text, "utf8");
}

function storyWith(quote: NarrativeQuote | undefined, title: string): NarrativeStory {
  return {
    schema_version: 1,
    story_id: STORY_ID,
    app: APP,
    kind: "ticket",
    title,
    opened: "2026-07-31T12:00:00.000Z",
    status: "completed",
    closed: "2026-07-31T12:30:00.000Z",
    moments: [
      {
        at: "2026-07-31T12:10:00.000Z",
        run_id: RUN_ID,
        pipeline: "build",
        pass: "implement",
        role: "builder",
        status: "completed",
        headline: "Builder implemented the connector",
        ...(quote !== undefined ? { quote } : {}),
        evidence: `runs/${APP}/${RUN_ID}/`,
      },
    ],
    captured_at: "2026-07-31T12:30:00.000Z",
  };
}

describe("CF-INV-011 — narrative capture scrubs at capture time; story.json and markdown stay clean (L2, HB-016)", () => {
  let state: TempStateHome;

  afterEach(async () => {
    await state.cleanup();
  });

  it("readRunQuote over a secret-bearing L3 output.md returns a scrubbed, bounded quote", async () => {
    state = await makeTempStateHome({ name: "cf-inv-011-narrative" });
    const seeds = makeAllSeeds();
    const long = `the model wrote:\n${seeds.map((seed) => `uses ${seed.value}`).join("\n")}\n${"padding line\n".repeat(100)}`;
    await plantL3(state, "output.md", long);

    const quote = await readRunQuote(state.stateHome, APP, RUN_ID, "output.md");
    expect(quote).toBeDefined();
    detectSecretEgress("narrative moment quote", quote!.text, seeds);
    expect(quote!.text).toContain("[REDACTED:"); // scrub happened, content kept
    expect(quote!.truncated).toBe(true);
    // Bounded: MOMENT_QUOTE_MAX chars plus the single ellipsis character.
    expect(quote!.text.length).toBeLessThanOrEqual(MOMENT_QUOTE_MAX + 1);
    expect(quote!.source).toBe(`runs/${APP}/${RUN_ID}/output.md`);
  });

  it("boundQuote scrubs BEFORE truncating: a secret sitting exactly astride the cut cannot survive as a prefix", () => {
    const seed = makeSyntheticSecret("github-token");
    // Position the seed so a truncate-then-scrub implementation would slice
    // it mid-token (leaving a prefix the pattern no longer matches).
    const padding = "x".repeat(ORIGIN_QUOTE_MAX - Math.floor(seed.value.length / 2));
    const quote = boundQuote("tasks/t1/prompt.md", `${padding} ${seed.value}`, ORIGIN_QUOTE_MAX);
    expect(quote).toBeDefined();
    expect(quote!.text).not.toContain(seed.value.slice(0, 8));
    detectSecretEgress("origin quote", quote!.text, [seed]);
  });

  it("the persisted story.json bytes and the rendered markdown are clean (capture-time re-scrub of titles/headlines included)", async () => {
    state = await makeTempStateHome({ name: "cf-inv-011-story" });
    const seeds = makeAllSeeds();
    const slack = seeds.find((seed) => seed.kind === "slack-token")!;
    await plantL3(state, "output.md", `verbatim L3 with ${seeds.map((s) => s.value).join(" ")}`);

    const quote = await readRunQuote(state.stateHome, APP, RUN_ID, "output.md");
    // Non-quote capture text (ticket titles, journal stop reasons) goes
    // through the leaf's ONE re-scrub — write-time scrubbing used whatever
    // list existed THEN; captures outlive sources by years (sources.ts).
    const title = scrubCaptureText(`Ticket #12 — rotate ${slack.value}`);
    const story = storyWith(quote, title);

    const path = await writeCapturedStory(state.stateHome, story);
    await assertNonEmptyWalk(narrativeDir(state.stateHome, APP), /\.json$/);
    expect(path).toContain(storySlug(STORY_ID));

    const bytes = await readFile(path, "utf8");
    detectSecretEgressInJson("narrative/<app>/story.json", bytes, seeds);
    expect(bytes).toContain("[REDACTED:slack-token]");

    // Round-trip through the real reader, then the shareable markdown render.
    const reread = await readCapturedStory(state.stateHome, APP, STORY_ID);
    expect(reread).toBeDefined();
    const markdown = renderStoryMarkdown(reread!);
    detectSecretEgress("narrative story markdown", markdown, seeds);
    expect(markdown).toContain("[REDACTED:");
  });

  it("negative control: a quote built WITHOUT boundQuote (weakened capture) persists the leak and the detector FIRES on the bytes", async () => {
    state = await makeTempStateHome({ name: "cf-inv-011-story-neg" });
    const leak = makeSyntheticSecret("aws-access-key-id");
    const rawL3 = `verbatim L3: ${leak.value}`;
    await plantL3(state, "output.md", rawL3);

    // The bypass: read the L3 file directly and embed it unscrubbed —
    // exactly what a capture path forking around sources.ts would do.
    const weakenedQuote: NarrativeQuote = {
      source: `runs/${APP}/${RUN_ID}/output.md`,
      text: rawL3,
      truncated: false,
    };
    const path = await writeCapturedStory(state.stateHome, storyWith(weakenedQuote, "Ticket #12"));

    const bytes = await readFile(path, "utf8");
    expect(() => detectSecretEgressInJson("weakened story.json", bytes, [leak])).toThrow(
      SecretEgressViolation,
    );
    expect(() => detectSecretEgressInJson("weakened story.json", bytes, [leak])).toThrow(
      /aws-access-key-id/,
    );
  });
});
