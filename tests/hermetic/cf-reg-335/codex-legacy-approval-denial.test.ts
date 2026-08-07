// CF-REG-335 — the @openai/codex 0.144.4 → 0.147.0 bump silently changed the
// LEGACY approval denial wire shape. `ReviewDecision::Denied` stopped being the
// bare string "denied" and became the struct variant
// `{ denied: { rejection: string } }`. The adapter still answered
// `execCommandApproval` / `applyPatchApproval` with `{ decision: "denied" }`,
// which 0.147.0 can no longer deserialize — so a gate DENY would have stopped
// arriving as a deny. That is a fail-open gate defect (INV-002 family), found by
// the version refresh rather than by any existing case: the shared conformance
// walk and the codex transport double only ever exercise the MODERN
// `item/*/requestApproval` methods, leaving both legacy methods uncovered.
//
// Risk E-1 / T-11. Layer 2 — the REAL CodexRuntime driven through a scripted
// transport, plus the REAL installed Codex binary as the schema oracle. No
// provider, no tokens, no network.
//
// Detector family = "every approval decision the adapter emits is a member of
// the installed Codex version's own decision schema". Pinning against the
// vendor-generated schema (not a hand-copied literal) is what makes this catch
// the NEXT shape change too. Negative controls: (i) the pre-fix encoder — a bare
// "denied" — is rejected by the same check, and (ii) the modern accept/decline
// strings are asserted to remain plain strings, so the fix cannot be
// over-applied to the `item/*` paths.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CodexRuntime } from "../../../src/runtime/adapters/codex.js";
import type { CodexAppServerClient, CodexServerMessage, JsonRpcId } from "../../../src/runtime/adapters/codex.js";
import type { GateEscalation, RoleConfig, ToolAction, TurnRequest } from "../../../src/runtime/types.js";

const DENY_REASON = "critical operation requires human approval";

// ---------------------------------------------------------------------------
// Schema oracle: the installed Codex package's own generated protocol schema.
// ---------------------------------------------------------------------------

interface SchemaVariant {
  enum?: string[];
  required?: string[];
  properties?: Record<string, { properties?: Record<string, unknown>; required?: string[] }>;
}

let schemaDir: string;

function codexBin(): string {
  return createRequire(import.meta.url).resolve("@openai/codex/bin/codex.js");
}

function decisionVariants(file: string, definition: string): SchemaVariant[] {
  const doc = JSON.parse(readFileSync(join(schemaDir, file), "utf8")) as {
    definitions: Record<string, { oneOf?: SchemaVariant[] }>;
  };
  const variants = doc.definitions[definition]?.oneOf;
  if (variants === undefined) throw new Error(`${file} has no ${definition}.oneOf`);
  return variants;
}

/** String members of a decision enum (e.g. "approved", "decline"). */
function stringMembers(variants: SchemaVariant[]): string[] {
  return variants.flatMap((variant) => variant.enum ?? []);
}

/** Struct members keyed by their single required property (e.g. "denied"). */
function structMembers(variants: SchemaVariant[]): string[] {
  return variants.filter((variant) => variant.enum === undefined).flatMap((variant) => variant.required ?? []);
}

/** Is `decision` a member of this decision schema? Mirrors serde's untagged
 *  enum acceptance closely enough to catch a shape regression in either
 *  direction (string sent where a struct is required, or vice versa). */
function schemaAccepts(variants: SchemaVariant[], decision: unknown): boolean {
  if (typeof decision === "string") return stringMembers(variants).includes(decision);
  if (decision === null || typeof decision !== "object" || Array.isArray(decision)) return false;
  const keys = Object.keys(decision as Record<string, unknown>);
  if (keys.length !== 1) return false;
  const key = keys[0] as string;
  const variant = variants.find((candidate) => candidate.enum === undefined && candidate.required?.includes(key));
  if (variant === undefined) return false;
  const body = (decision as Record<string, unknown>)[key];
  const required = variant.properties?.[key]?.required ?? [];
  if (required.length === 0) return true;
  if (body === null || typeof body !== "object") return false;
  return required.every((field) => field in (body as Record<string, unknown>));
}

beforeAll(() => {
  schemaDir = mkdtempSync(join(tmpdir(), "cormidia-codex-schema-"));
  // Token-free and offline: serializes the binary's compiled-in protocol types.
  execFileSync(process.execPath, [codexBin(), "app-server", "generate-json-schema", "--out", schemaDir], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
});

afterAll(() => {
  if (schemaDir !== undefined) rmSync(schemaDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Scripted transport: issues ONLY the legacy approval methods.
// ---------------------------------------------------------------------------

type ApprovalScript = Array<{ method: string; params: unknown }>;

class LegacyApprovalClient implements CodexAppServerClient {
  readonly responses: Array<{ id: JsonRpcId; result: unknown }> = [];
  private started = false;

  constructor(private readonly script: ApprovalScript) {}

  async request(method: string, _params?: unknown): Promise<unknown> {
    if (method === "thread/start" || method === "thread/resume") return { thread: { id: "thread-cf-reg-335" } };
    if (method === "turn/start") this.started = true;
    return {};
  }

  async notify(): Promise<void> {}

  async respond(id: JsonRpcId, result: unknown): Promise<void> {
    this.responses.push({ id, result });
  }

  async close(): Promise<void> {}

  async *[Symbol.asyncIterator](): AsyncIterator<CodexServerMessage> {
    if (!this.started) throw new Error("iterator consumed before turn/start");
    let id = 500;
    for (const entry of this.script) {
      yield { id: id++, method: entry.method, params: entry.params };
    }
    yield {
      method: "turn/completed",
      params: { turn: { status: "completed", durationMs: 5, items: [] } },
    };
  }
}

function turnRequest(workdir: string): TurnRequest {
  const role: RoleConfig = {
    name: "cf-reg-335-probe",
    runtime: "codex",
    model: "gpt-5.4-mini",
    effort: "low",
    delegation: { allow: [] },
    triggers: [],
    outputs: [],
    maxTurnBudgetUsd: 1,
  };
  return {
    role,
    assignment: { harness: "codex", model: "gpt-5.4-mini", effort: "low" },
    workdir,
    task: "cf-reg-335",
    context: { taste: [], memoryExcerpts: [] },
    maxTurns: 1,
    networkAccess: false,
  };
}

/** Run one turn with a gate that denies everything, returning the decisions the
 *  adapter put on the wire. */
async function decisionsForDenyAll(script: ApprovalScript): Promise<unknown[]> {
  const workdir = mkdtempSync(join(tmpdir(), "cormidia-cf-reg-335-"));
  const client = new LegacyApprovalClient(script);
  const escalations: GateEscalation[] = [];
  try {
    const runtime = new CodexRuntime({ clientFactory: () => client });
    await runtime.runTurn(turnRequest(workdir), {
      gate: (_action: ToolAction) => ({ allow: false, reason: DENY_REASON, escalate: true }),
      onEvent: () => undefined,
      onProgress: () => undefined,
    });
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
  void escalations;
  return client.responses.map((entry) => (entry.result as { decision: unknown }).decision);
}

async function decisionsForAllowAll(script: ApprovalScript): Promise<unknown[]> {
  const workdir = mkdtempSync(join(tmpdir(), "cormidia-cf-reg-335-"));
  const client = new LegacyApprovalClient(script);
  try {
    const runtime = new CodexRuntime({ clientFactory: () => client });
    await runtime.runTurn(turnRequest(workdir), {
      gate: () => ({ allow: true }),
      onEvent: () => undefined,
      onProgress: () => undefined,
    });
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
  return client.responses.map((entry) => (entry.result as { decision: unknown }).decision);
}

const LEGACY_SCRIPT: ApprovalScript = [
  { method: "execCommandApproval", params: { command: ["rm", "-rf", "/"], reason: "scripted" } },
  {
    method: "applyPatchApproval",
    params: { fileChanges: { "roles.yaml": { type: "update", unified_diff: "@@" } }, reason: "scripted" },
  },
];

describe("CF-REG-335 — Codex legacy approval denials use the 0.147 struct variant", () => {
  it("the installed Codex version requires the struct denial (schema oracle)", () => {
    for (const file of ["ExecCommandApprovalResponse.json", "ApplyPatchApprovalResponse.json"]) {
      const variants = decisionVariants(file, "ReviewDecision");
      // The regression in one line: "denied" must NOT be a bare string member.
      expect(stringMembers(variants)).not.toContain("denied");
      expect(structMembers(variants)).toContain("denied");
      const denied = variants.find((v) => v.enum === undefined && v.required?.includes("denied"));
      expect(denied?.properties?.["denied"]?.required).toEqual(["rejection"]);
    }
  });

  it("emits { denied: { rejection } } carrying the gate's reason on both legacy methods", async () => {
    const decisions = await decisionsForDenyAll(LEGACY_SCRIPT);
    expect(decisions).toHaveLength(2);
    for (const decision of decisions) {
      expect(decision).toEqual({ denied: { rejection: DENY_REASON } });
    }
  });

  it("every emitted legacy decision is accepted by the installed version's schema", async () => {
    const denied = await decisionsForDenyAll(LEGACY_SCRIPT);
    const approved = await decisionsForAllowAll(LEGACY_SCRIPT);
    const exec = decisionVariants("ExecCommandApprovalResponse.json", "ReviewDecision");
    const patch = decisionVariants("ApplyPatchApprovalResponse.json", "ReviewDecision");
    for (const decision of denied) {
      expect(schemaAccepts(exec, decision)).toBe(true);
      expect(schemaAccepts(patch, decision)).toBe(true);
    }
    for (const decision of approved) {
      expect(decision).toBe("approved");
      expect(schemaAccepts(exec, decision)).toBe(true);
    }
  });

  it('negative control: the pre-fix bare "denied" string is rejected by the same check', () => {
    const exec = decisionVariants("ExecCommandApprovalResponse.json", "ReviewDecision");
    const patch = decisionVariants("ApplyPatchApprovalResponse.json", "ReviewDecision");
    // Exactly what the adapter used to send. The detector must fire on it,
    // otherwise the assertions above prove nothing.
    expect(schemaAccepts(exec, "denied")).toBe(false);
    expect(schemaAccepts(patch, "denied")).toBe(false);
    // ...and a struct missing the required rejection is equally invalid.
    expect(schemaAccepts(exec, { denied: {} })).toBe(false);
    // The oracle still accepts genuine members, so it is not vacuously false.
    expect(schemaAccepts(exec, "approved")).toBe(true);
  });

  it("does not over-apply the struct form to the modern item/* approvals", async () => {
    const modernScript: ApprovalScript = [
      { method: "item/commandExecution/requestApproval", params: { command: "rm -rf /", reason: "scripted" } },
      { method: "item/fileChange/requestApproval", params: { path: "roles.yaml", reason: "scripted" } },
    ];
    const decisions = await decisionsForDenyAll(modernScript);
    expect(decisions).toEqual(["decline", "decline"]);

    const command = decisionVariants(
      "CommandExecutionRequestApprovalResponse.json",
      "CommandExecutionApprovalDecision",
    );
    const fileChange = decisionVariants("FileChangeRequestApprovalResponse.json", "FileChangeApprovalDecision");
    // Still plain strings in 0.147.0 — the legacy fix must not leak here.
    expect(stringMembers(command)).toContain("decline");
    expect(stringMembers(fileChange)).toContain("decline");
    expect(schemaAccepts(command, "decline")).toBe(true);
    expect(schemaAccepts(fileChange, "decline")).toBe(true);
  });
});
