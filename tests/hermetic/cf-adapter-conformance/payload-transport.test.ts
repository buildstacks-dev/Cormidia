// CF-B02-PAYLOAD / CF-B03-PAYLOAD / CF-B04-PAYLOAD / CF-B23-PAYLOAD (#334,
// #337): a ~300 KB task brief transports BYTE-IDENTICAL through every adapter's
// payload channel — Claude's SDK prompt, Codex's turn/start JSON-RPC input, pi's
// in-process session.prompt(), OpenCode's HTTP message body parts[].text —
// never an argv-style bounded channel (the ARG_MAX lesson,
// docs/loop/design.md §2: "Adapters must accept multi-hundred-KB task
// payloads via a robust channel. This becomes a gate-conformance-suite case,
// not an implementation hope").
//
// Re-deposits the archived-suite 300 KB transport pin offline. The payload
// carries head/tail sentinels and position-varying content so truncation,
// reordering, or duplication cannot cancel out. Negative control per adapter:
// the SeededPayloadTruncationRuntime liar simulates an adapter that pushed
// the brief through an ARG_MAX-bounded channel — the shared
// checkTaskPayloadIntact detector must fire on the silently truncated brief.

import { afterEach, describe, expect, it } from "vitest";
import { claudeDouble, doubleRole, doubleTurnRequest } from "../../fixtures/adapters/claude-double.js";
import { codexDouble, type CodexRecordedTurn } from "../../fixtures/adapters/codex-double.js";
import { opencodeDouble, opencodeDoubleRequest } from "../../fixtures/adapters/opencode-double.js";
import { piDouble } from "../../fixtures/adapters/pi-double.js";
import {
  AdapterContractViolation,
  SEEDED_ARGV_TRUNCATION_BYTES,
  SeededPayloadTruncationRuntime,
  checkTaskPayloadIntact,
  script,
} from "../../fixtures/adapters/scenario.js";
import { makeTempGitRepo, type TempGitRepo } from "../../fixtures/git-repo.js";

let repo: TempGitRepo | undefined;
afterEach(async () => {
  await repo?.cleanup();
  repo = undefined;
});

/** ≥ 300 KB brief with sentinels and position-varying lines: any dropped,
 *  duplicated, or reordered chunk changes the bytes, so exact equality is a
 *  real integrity check — not a length check that repeats one character. */
const PAYLOAD_HEAD = "CORMIDIA-BRIEF-HEAD::";
const PAYLOAD_TAIL = "::CORMIDIA-BRIEF-TAIL";
const PAYLOAD_BYTES = 300 * 1024;

function briefPayload(): string {
  const parts: string[] = [PAYLOAD_HEAD];
  let length = PAYLOAD_HEAD.length;
  let line = 0;
  while (length < PAYLOAD_BYTES - PAYLOAD_TAIL.length) {
    const chunk = `brief-line-${line.toString(36).padStart(6, "0")} ${"lorem-".repeat(8)}\n`;
    parts.push(chunk);
    length += chunk.length;
    line += 1;
  }
  parts.push(PAYLOAD_TAIL);
  return parts.join("");
}

const PAYLOAD = briefPayload();

function codexTransportedTask(turn: CodexRecordedTurn): string | undefined {
  const start = turn.requests.find((request) => request.method === "turn/start");
  if (start === undefined || typeof start.params !== "object" || start.params === null) return undefined;
  const input = (start.params as Record<string, unknown>)["input"];
  if (!Array.isArray(input) || input[0] === null || typeof input[0] !== "object") return undefined;
  const text = (input[0] as Record<string, unknown>)["text"];
  return typeof text === "string" ? text : undefined;
}

const allowAll = { gate: () => ({ allow: true }) as const };

describe("CF-B02-PAYLOAD — 300 KB brief transports intact through the Claude adapter (SDK prompt payload)", () => {
  it("the provider observes the exact brief the orchestrator sent", async () => {
    repo = await makeTempGitRepo();
    expect(PAYLOAD.length).toBeGreaterThanOrEqual(PAYLOAD_BYTES);
    const dbl = claudeDouble([
      script.turn({
        sessionId: "sess-payload",
        outcome: script.success("done", { usage: { inputTokens: 10, outputTokens: 2 } }),
      }),
    ]);
    const result = await dbl.runtime.runTurn(doubleTurnRequest({ workdir: repo.dir, task: PAYLOAD }), allowAll);
    expect(result.status).toBe("completed");
    const transported = dbl.recorder.turns[0]!.prompt;
    expect(() => checkTaskPayloadIntact(PAYLOAD, transported)).not.toThrow();
    expect(transported).toBe(PAYLOAD);
    expect(transported.endsWith(PAYLOAD_TAIL)).toBe(true);
  });

  it("negative control: an ARG_MAX-truncating transport is caught by the payload detector", async () => {
    repo = await makeTempGitRepo();
    const dbl = claudeDouble([
      script.turn({
        sessionId: "sess-payload-trunc",
        outcome: script.success("done", { usage: { inputTokens: 10, outputTokens: 2 } }),
      }),
    ]);
    const liar = new SeededPayloadTruncationRuntime(dbl.runtime);
    await liar.runTurn(doubleTurnRequest({ workdir: repo.dir, task: PAYLOAD }), allowAll);
    const transported = dbl.recorder.turns[0]!.prompt;
    expect(transported.length).toBe(SEEDED_ARGV_TRUNCATION_BYTES); // silently cut at the argv bound
    expect(transported.endsWith(PAYLOAD_TAIL)).toBe(false);
    expect(() => checkTaskPayloadIntact(PAYLOAD, transported)).toThrow(AdapterContractViolation);
    expect(() => checkTaskPayloadIntact(PAYLOAD, transported)).toThrow(/payload-transport/);
  });
});

describe("CF-B03-PAYLOAD — 300 KB brief transports intact through the Codex adapter (turn/start JSON-RPC payload)", () => {
  const codexRole = () => doubleRole({ runtime: "codex", model: "gpt-5.6-sol" });

  it("the App Server observes the exact brief in the turn/start input payload", async () => {
    repo = await makeTempGitRepo();
    const dbl = codexDouble([
      script.turn({
        sessionId: "thread-payload",
        outcome: script.success("done", { usage: { inputTokens: 10, outputTokens: 2 } }),
      }),
    ]);
    const result = await dbl.runtime.runTurn(
      doubleTurnRequest({ workdir: repo.dir, role: codexRole(), task: PAYLOAD }),
      allowAll,
    );
    expect(result.status).toBe("completed");
    const transported = codexTransportedTask(dbl.recorder.turns[0]!);
    expect(() => checkTaskPayloadIntact(PAYLOAD, transported)).not.toThrow();
    expect(transported).toBe(PAYLOAD);
  });

  it("negative control: an ARG_MAX-truncating transport is caught by the payload detector", async () => {
    repo = await makeTempGitRepo();
    const dbl = codexDouble([
      script.turn({
        sessionId: "thread-payload-trunc",
        outcome: script.success("done", { usage: { inputTokens: 10, outputTokens: 2 } }),
      }),
    ]);
    const liar = new SeededPayloadTruncationRuntime(dbl.runtime);
    await liar.runTurn(doubleTurnRequest({ workdir: repo.dir, role: codexRole(), task: PAYLOAD }), allowAll);
    const transported = codexTransportedTask(dbl.recorder.turns[0]!);
    expect(transported?.length).toBe(SEEDED_ARGV_TRUNCATION_BYTES);
    expect(() => checkTaskPayloadIntact(PAYLOAD, transported)).toThrow(AdapterContractViolation);
    expect(() => checkTaskPayloadIntact(PAYLOAD, transported)).toThrow(/first divergence at byte 131072/);
  });
});

describe("CF-B04-PAYLOAD — 300 KB brief transports intact through the pi adapter (in-process prompt payload)", () => {
  const piRole = () => doubleRole({ runtime: "pi", model: "claude-scripted-model" });

  it("session.prompt() receives the exact brief the orchestrator sent", async () => {
    repo = await makeTempGitRepo();
    const dbl = piDouble([
      script.turn({
        sessionId: "pi-payload",
        outcome: script.success("done", { usage: { inputTokens: 10, outputTokens: 2 }, costUsd: 0.01 }),
      }),
    ]);
    const result = await dbl.runtime.runTurn(
      doubleTurnRequest({ workdir: repo.dir, role: piRole(), task: PAYLOAD }),
      allowAll,
    );
    expect(result.status).toBe("completed");
    const transported = dbl.recorder.turns[0]!.promptText;
    expect(() => checkTaskPayloadIntact(PAYLOAD, transported)).not.toThrow();
    expect(transported).toBe(PAYLOAD);
  });

  it("negative control: an ARG_MAX-truncating transport is caught by the payload detector", async () => {
    repo = await makeTempGitRepo();
    const dbl = piDouble([
      script.turn({
        sessionId: "pi-payload-trunc",
        outcome: script.success("done", { usage: { inputTokens: 10, outputTokens: 2 }, costUsd: 0.01 }),
      }),
    ]);
    const liar = new SeededPayloadTruncationRuntime(dbl.runtime);
    await liar.runTurn(doubleTurnRequest({ workdir: repo.dir, role: piRole(), task: PAYLOAD }), allowAll);
    const transported = dbl.recorder.turns[0]!.promptText;
    expect(transported?.length).toBe(SEEDED_ARGV_TRUNCATION_BYTES);
    expect(() => checkTaskPayloadIntact(PAYLOAD, transported)).toThrow(AdapterContractViolation);
    expect(() => checkTaskPayloadIntact(PAYLOAD, transported)).toThrow(/payload-transport/);
  });
});

describe("CF-B23-PAYLOAD — 300 KB brief transports intact through the OpenCode adapter (HTTP message body)", () => {
  it("the server observes the exact brief in the prompt request's text part", async () => {
    repo = await makeTempGitRepo();
    const dbl = opencodeDouble([
      script.turn({
        sessionId: "ses_payload",
        outcome: script.success("done", { usage: { inputTokens: 10, outputTokens: 2 }, costUsd: 0.01 }),
      }),
    ]);
    const result = await dbl.runtime.runTurn(opencodeDoubleRequest({ workdir: repo.dir, task: PAYLOAD }), allowAll);
    expect(result.status).toBe("completed");
    const transported = dbl.recorder.turns[0]!.promptText;
    expect(() => checkTaskPayloadIntact(PAYLOAD, transported)).not.toThrow();
    expect(transported).toBe(PAYLOAD);
  });

  it("negative control: an ARG_MAX-truncating transport is caught by the payload detector", async () => {
    repo = await makeTempGitRepo();
    const dbl = opencodeDouble([
      script.turn({
        sessionId: "ses_payload_trunc",
        outcome: script.success("done", { usage: { inputTokens: 10, outputTokens: 2 }, costUsd: 0.01 }),
      }),
    ]);
    const liar = new SeededPayloadTruncationRuntime(dbl.runtime);
    await liar.runTurn(opencodeDoubleRequest({ workdir: repo.dir, task: PAYLOAD }), allowAll);
    const transported = dbl.recorder.turns[0]!.promptText;
    expect(transported?.length).toBe(SEEDED_ARGV_TRUNCATION_BYTES);
    expect(() => checkTaskPayloadIntact(PAYLOAD, transported)).toThrow(AdapterContractViolation);
    expect(() => checkTaskPayloadIntact(PAYLOAD, transported)).toThrow(/first divergence at byte 131072/);
  });
});
