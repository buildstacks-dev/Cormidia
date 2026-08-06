// HB-045 — deliberately thin presentation smokes. Truthfulness,
// confidentiality, and cross-surface semantics live in the exhaustive E-3
// families; this file pins representative shell/Markdown behavior only.

import { describe, expect, it } from "vitest";
import { OBSERVE_CSS, OBSERVE_HTML, OBSERVE_JS } from "../../../src/observe/assets.js";
import { renderIndexMarkdown, renderStoryMarkdown } from "../../../src/narrative/render.js";
import type { NarrativeStory } from "../../../src/narrative/types.js";

function story(overrides: Partial<NarrativeStory> = {}): NarrativeStory {
  return {
    schema_version: 1,
    story_id: "episode-1",
    app: "app",
    kind: "ticket",
    title: "Deliver the bounded change",
    opened: "2026-07-31T12:00:00.000Z",
    closed: "2026-07-31T12:10:00.000Z",
    status: "completed",
    origin: {
      kind: "parent_task",
      ref: "tasks/task-1/prompt.md",
      quote: { source: "tasks/task-1/prompt.md", text: "Implement the accepted scope.", truncated: false },
    },
    moments: [
      {
        at: "2026-07-31T12:05:00.000Z",
        run_id: "run-1",
        pipeline: "build",
        pass: "implement",
        role: "builder",
        status: "completed",
        headline: "Implementation completed",
        evidence: "runs/app/run-1/",
      },
    ],
    delivery: {
      stages: [{ boundary: "merged", status: "completed", at: "2026-07-31T12:10:00.000Z", attempt: 1 }],
      status: "completed",
      outcome: "merged",
    },
    cost: { usd: 1.25, provider_turns: 1, unmeasured_turns: 0 },
    captured_at: "2026-07-31T12:10:00.000Z",
    ...overrides,
  };
}

describe("HB-045 presentation smokes", () => {
  it("renders a deterministic, readable Markdown story and newest-first index", () => {
    const current = story();
    const prior = story({
      story_id: "episode-0",
      title: "Earlier work",
      opened: "2026-06-01T12:00:00.000Z",
      captured_at: "2026-06-01T12:10:00.000Z",
    });
    const markdown = renderStoryMarkdown(current);
    expect(markdown).toContain("# Deliver the bounded change");
    expect(markdown).toContain("## Origin");
    expect(markdown).toContain("> Implement the accepted scope.");
    expect(markdown).toContain("## Timeline");
    expect(markdown).toContain("## Delivery");
    expect(markdown).toContain("$1.25 settled across 1 provider turn(s)");
    expect(markdown).not.toMatch(/\n{3,}/);
    expect(renderStoryMarkdown(current)).toBe(markdown);

    const index = renderIndexMarkdown("app", [prior, current]);
    expect(index.indexOf("Deliver the bounded change")).toBeLessThan(index.indexOf("Earlier work"));
    expect(renderIndexMarkdown("app", [])).toContain("No stories captured yet");
  });

  it("ships one read-only accessible Live UI shell with reconnect/resync and reduced-motion affordances", () => {
    expect(OBSERVE_HTML).toContain("READ ONLY");
    expect(OBSERVE_HTML).toContain('aria-live="polite"');
    expect(OBSERVE_HTML).toContain('role="dialog"');
    expect(OBSERVE_HTML).toContain('href="/assets/observe.css"');
    expect(OBSERVE_HTML).toContain('src="/assets/observe.js"');
    expect(OBSERVE_HTML).not.toMatch(/https?:\/\//);
    expect(OBSERVE_CSS).toContain("prefers-reduced-motion:reduce");
    expect(OBSERVE_JS).toContain("Reconnecting…");
    expect(OBSERVE_JS).toContain("resynchronizing from durable state");
    expect(OBSERVE_HTML).toContain("Nothing is dropped while paused");
  });
});
