// Tripwire: every declared LearningEventType must have a real emitter (#140).
//
// Four members (`env_fact`, `tool_outcome`, `retro_note`, `artifact_created`)
// were declared and never emitted anywhere in src/. Two of them were consumed
// by the distiller's evidence filter, so `isEvidenceEvent` contained branches
// that could never fire — the allowlist read as broad while the actual
// producer set was narrow, which is part of why an empty distillation looked
// plausible rather than alarming (#137).
//
// This test reads source text rather than exercising behaviour on purpose:
// the defect class is "declared surface with no producer", which no behavioural
// test can observe precisely because nothing produces it.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendLearningEventsDeduped, readLearningEvents, type LearningEvent } from "../../src/org/learning/events.js";
import { makeOrgHome } from "../fixtures/orgHome.js";

const SRC = fileURLToPath(new URL("../../src", import.meta.url));
const EVENTS_TS = join(SRC, "org", "learning", "events.ts");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

/** The `LearningEventType` union members, read from the declaration itself so
 *  the list can never drift from the type. */
function declaredEventTypes(): string[] {
  const source = readFileSync(EVENTS_TS, "utf8");
  const block = /export type LearningEventType =([\s\S]*?);/.exec(source);
  expect(block, "LearningEventType declaration not found").not.toBeNull();
  return [...block![1]!.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]!);
}

/** Files that actually deal in learning events. `src/` at large has plenty of
 *  unrelated `type:` / `event.type ===` literals (SSE frames, review cycles,
 *  runlog records); including them would make the tripwire both noisy and
 *  falsely satisfiable by a same-named literal in another domain. */
function learningAwareFiles(): string[] {
  return sourceFiles(SRC).filter((file) => {
    if (file === EVENTS_TS) return false;
    const source = readFileSync(file, "utf8");
    return source.includes("LearningEvent") || source.includes("learning/events.js");
  });
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Producing code for a type, in either form it is written today: a
 *  `type: "x"` property on an event literal (capture, episode) or a positional
 *  argument to an event-building helper such as the resolver's `resolveEvent`.
 *
 *  CONSUMER sites are stripped first. Without that, a dead branch like
 *  `event.type === "tool_outcome"` would count as its own producer and the
 *  tripwire would pass over exactly the defect it exists to catch. */
function producedTypeLiterals(): Set<string> {
  const out = new Set<string>();
  for (const file of learningAwareFiles()) {
    const source = stripComments(readFileSync(file, "utf8"))
      .replace(/\w+\.type\s*===\s*"[a-z_]+"/g, "");
    for (const match of source.matchAll(/"([a-z_]+)"/g)) out.add(match[1]!);
  }
  return out;
}

/** The consumer side. Scoped to src/org/learning/, the only place that
 *  branches on a LearningEvent's type — `event.type` elsewhere in src/ belongs
 *  to unrelated event domains (turn events, SSE frames). */
function comparedTypeLiterals(): Set<string> {
  const out = new Set<string>();
  const learningDir = join(SRC, "org", "learning");
  for (const file of learningAwareFiles().filter((path) => path.startsWith(learningDir))) {
    const source = stripComments(readFileSync(file, "utf8"));
    for (const match of source.matchAll(/event\.type\s*===\s*"([a-z_]+)"/g)) out.add(match[1]!);
  }
  return out;
}

describe("LearningEventType declared surface (#140)", () => {
  it("every declared type has at least one emitter in src/", () => {
    const declared = declaredEventTypes();
    const emitted = producedTypeLiterals();
    expect(declared.length).toBeGreaterThan(0);

    const orphans = declared.filter((type) => !emitted.has(type));
    expect(
      orphans,
      `declared LearningEventType members with no emitter in src/: ${orphans.join(", ")}. ` +
        "Either emit them or remove them — a declared-but-unemitted type is misleading dead code.",
    ).toEqual([]);
  });

  it("every type the distiller's evidence filter branches on is producible", () => {
    const declared = new Set(declaredEventTypes());
    const orphanBranches = [...comparedTypeLiterals()].filter((type) => !declared.has(type)).sort();
    expect(
      orphanBranches,
      `code branches on LearningEvent types that are not declared: ${orphanBranches.join(", ")}`,
    ).toEqual([]);
  });

  it("the four removed types are gone from the declaration", () => {
    const declared = new Set(declaredEventTypes());
    for (const removed of ["env_fact", "tool_outcome", "retro_note", "artifact_created"]) {
      expect(declared.has(removed), `${removed} should have been removed`).toBe(false);
    }
  });

  // Forward-compat on a 1825-day retention window: orgs already hold events
  // written under the old enum, and a removal must never make them unreadable.
  it("still reads historical events carrying a removed type", async () => {
    const state = makeOrgHome();
    try {
      const historical = {
        event_id: "evt_historical_tool_outcome",
        episode_id: "ep_alpha_ticket_0001",
        ts: "2026-07-12T10:00:00.000Z",
        app: "alpha",
        type: "tool_outcome",
        emitter: "orchestrator",
        source_channel: "internal",
        trust: "trusted",
        payload: { success: false },
      } as unknown as LearningEvent;
      await appendLearningEventsDeduped(state.root, [historical]);

      const events = await readLearningEvents(state.root);
      expect(events).toHaveLength(1);
      expect(events[0]!.event_id).toBe("evt_historical_tool_outcome");
      expect(events[0]!.type as string).toBe("tool_outcome");
    } finally {
      state.cleanup();
    }
  });
});
