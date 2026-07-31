// CF-INV-011 — bounded previews and envelope fields are scrubbed at write
// time: L2 composition on a temp state home (HB-016, FLOOR).
//
// OPERON-INV-011 (validation-design/invariants.md): L3 stays verbatim and
// local; everything the envelope (L1) and event stream (L2) carry OUT of the
// run dir is a bounded, scrubbed derivation. The write-time scrub in
// src/runtime/runlog/envelope.ts + events.ts is the guardrail every
// downstream egress (observe, reports, narrative) builds on — a dirty
// envelope would poison all of them at once.
//
// Composition under test: REAL `startRun` → `updateEnvelope` → `finalizeRun`
// and the REAL `createEventWriter`, on a fixture temp state home. Seeds are
// planted in every free-text input: selection reason, previews, artifacts,
// verdict summary (prose AND structured JSON), terminal reason, event
// detail. The assertion runs on the exact durable BYTES (envelope.json,
// events.jsonl) — what any later reader will see.
//
// Layer: 2 (real temp home, real writers; no network, no tokens).

import { afterEach, describe, expect, it } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import {
  finalizeRun,
  readEnvelope,
  startRun,
  updateEnvelope,
} from "../../../src/runtime/runlog/envelope.js";
import { createEventWriter } from "../../../src/runtime/runlog/events.js";
import { runPaths } from "../../../src/runtime/runlog/paths.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";
import { assertNonEmptyWalk } from "../../fixtures/walk.js";
import { makeSyntheticSecret, type SyntheticSecret } from "../../fixtures/synthetic-secret.js";
import {
  detectSecretEgressInJson,
  findSecretEgress,
  makeAllSeeds,
} from "../../unit/cf-inv-011/secret-egress-detector.js";

const APP = "cf-inv-011-app";
const RUN_ID = "20260731-120000-build-implement";
const NOW = new Date("2026-07-31T12:00:00.000Z");
const LATER = new Date("2026-07-31T12:05:00.000Z");

function seedByKind(seeds: readonly SyntheticSecret[], kind: SyntheticSecret["kind"]): SyntheticSecret {
  const seed = seeds.find((candidate) => candidate.kind === kind);
  if (seed === undefined) throw new Error(`missing seed kind ${kind}`);
  return seed;
}

/** Drive the full real write path with all 8 kinds planted. */
async function writeSeededRun(state: TempStateHome, seeds: readonly SyntheticSecret[]): Promise<void> {
  const aws = seedByKind(seeds, "aws-access-key-id");
  const ghToken = seedByKind(seeds, "github-token");
  const sk = seedByKind(seeds, "sk-api-key");
  const slack = seedByKind(seeds, "slack-token");
  const npm = seedByKind(seeds, "npm-token");
  const jwt = seedByKind(seeds, "jwt");
  const pem = seedByKind(seeds, "pem-private-key");
  const generic = seedByKind(seeds, "generic-assignment");

  await startRun(
    state.stateHome,
    {
      runId: RUN_ID,
      traceId: "trace-cf-inv-011",
      app: APP,
      pipeline: "build",
      pass: "implement",
      role: "builder",
      runtime: "claude",
      model: "claude-scripted-model",
      selectionReason: `picked because staging exports ${generic.value}`,
    },
    NOW,
  );

  const events = createEventWriter(
    state.stateHome,
    {
      runId: RUN_ID,
      trace_id: "trace-cf-inv-011",
      span_id: "span-1",
      app: APP,
      pipeline: "build",
      pass: "implement",
      role: "builder",
    },
    () => LATER,
  );
  await events.append({
    type: "gate.failed",
    severity: "error",
    detail: { gate: "security-scan", stderr: `stderr tail: ${slack.value} and ${npm.value}` },
  });

  await updateEnvelope(state.stateHome, APP, RUN_ID, {
    previews: {
      output: `pass output starts ${jwt.value} ${"filler ".repeat(80)}end`,
      brief: `brief cites ${sk.value}`,
      prompt: `prompt embeds a signing key\n${pem.value}`,
    },
    artifacts: [{ kind: "note", ref: `note-${aws.value}`, summary: `rotated ${ghToken.value}` }],
  });

  await finalizeRun(
    state.stateHome,
    APP,
    RUN_ID,
    {
      status: "failed",
      // Structured verdict: the secret hides inside a JSON string value —
      // durableVerdictSummary must scrub the parsed values, not raw bytes.
      verdictSummary: JSON.stringify({
        verdict: "REQUEST_CHANGES",
        rationale: `diff hunk still contains ${ghToken.value}`,
      }),
      reason: `provider refused after ${aws.value} appeared`,
    },
    LATER,
  );
}

describe("CF-INV-011 — envelope + event bytes are scrubbed and previews bounded at write time (L2, HB-016)", () => {
  let state: TempStateHome;

  afterEach(async () => {
    await state.cleanup();
  });

  it("the durable envelope.json bytes carry no seed and no canonical-pattern match; previews are bounded", async () => {
    state = await makeTempStateHome({ name: "cf-inv-011-envelope" });
    const seeds = makeAllSeeds();
    await writeSeededRun(state, seeds);

    // Non-empty walk: the run dir actually materialized (no green by absence).
    await assertNonEmptyWalk(state.path("runs", APP), /envelope\.json$/);

    const bytes = await readFile(runPaths(state.stateHome, APP, RUN_ID).envelope, "utf8");
    detectSecretEgressInJson("runs/<app>/<run>/envelope.json", bytes, seeds);
    // Non-vacuous: the seeded fields flowed through the scrub.
    expect(bytes).toContain("[REDACTED:generic-assignment]"); // selection_reason
    expect(bytes).toContain("[REDACTED:github-token]"); // artifact summary + verdict
    expect(bytes).toContain("[REDACTED:aws-access-key-id]"); // artifact ref + terminal reason

    // Bounded previews: the envelope preview cap is ~120 chars (redact.ts
    // truncatePreview default), so a long L3 excerpt can never ride along.
    const envelope = await readEnvelope(state.stateHome, APP, RUN_ID);
    for (const [name, preview] of Object.entries(envelope.previews ?? {})) {
      expect(preview.length, `preview "${name}" exceeds the bounded-preview cap`).toBeLessThanOrEqual(120);
      expect(findSecretEgress(preview, seeds)).toEqual([]);
    }
    expect(Object.keys(envelope.previews ?? {})).toHaveLength(3);
  });

  it("the durable events.jsonl bytes are scrubbed line by line", async () => {
    state = await makeTempStateHome({ name: "cf-inv-011-events" });
    const seeds = makeAllSeeds();
    await writeSeededRun(state, seeds);

    const lines = (await readFile(runPaths(state.stateHome, APP, RUN_ID).events, "utf8"))
      .split("\n")
      .filter((line) => line.trim().length > 0);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      detectSecretEgressInJson("runs/<app>/<run>/events.jsonl line", line, seeds);
    }
    expect(lines.join("\n")).toContain("[REDACTED:slack-token]");
    expect(lines.join("\n")).toContain("[REDACTED:npm-token]");
  });

  it("negative control: bytes written through a weakened (bypassing) writer make the detector FIRE on the same file", async () => {
    state = await makeTempStateHome({ name: "cf-inv-011-envelope-neg" });
    const seeds = makeAllSeeds();
    await writeSeededRun(state, seeds);

    // The bypass: splice a raw seed into the durable previews exactly where
    // a scrub-less writer would have put it. Test-side only — never src.
    const path = runPaths(state.stateHome, APP, RUN_ID).envelope;
    const tampered = JSON.parse(await readFile(path, "utf8")) as { previews?: Record<string, string> };
    const leak = makeSyntheticSecret("github-token");
    tampered.previews = { ...tampered.previews, output: `raw: ${leak.value}` };
    await writeFile(path, JSON.stringify(tampered), "utf8");

    const bytes = await readFile(path, "utf8");
    expect(() => detectSecretEgressInJson("tampered envelope.json", bytes, [leak])).toThrow(
      /github-token/,
    );
  });
});
