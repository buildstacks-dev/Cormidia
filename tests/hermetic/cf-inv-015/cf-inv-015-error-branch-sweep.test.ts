// Traceability: CF-INV-015 · HB-150 · invariants.md CORMIDIA-INV-015 · F-PT-036.
//
// CF-INV-015 — the conservative cross-family error-branch sweep (HB-150): one
// floor invariant across four ratified adversarial seeds — under any error or
// absence, Cormidia may do LESS, never more, and never reports a greener
// result than the evidence supports.
//
//   (a) corrupt/linked self-approval HMAC key  → fails closed (no signer, no
//       silent regeneration over the corrupt bytes);
//   (b) org with no charter                    → legacy-conservative authority,
//       never the newer delegated default;
//   (c) classifier throws                      → deny + ESCALATE, on all three
//       socket gate bridges (Codex, Cursor, OpenCode) — the escalation half is
//       the F-PT-036 product change (owner-ratified 2026-08-12: "a classifier
//       that throws is an anomaly a human must see; silent denial can mask a
//       persistently broken classifier as universal refusal with no signal");
//   (d) budget state unreadable                → no admission (`unknown` is a
//       fail-closed over-cap state, never `ok`; turn admission consumes it via
//       isBudgetBlocking — src/org/turn-runner.ts:659/1085/1710/2082).
//
// Risk FLOOR. Layer 1/2 — real modules over real temp state and real Unix
// sockets; no provider, no tokens, no network. Seeds (b) and (d) compose with
// (never duplicate) the journey-specific coverage in tests/fixtures/org-home.test.ts,
// tests/hermetic/cf-c-oplife/ and tests/hermetic/cf-b10/ (authority fail-closed)
// — this file is the unified sweep the CF-INV-015 catalog row owes.
//
// Negative controls (standing rule 4 — red-then-green, honest bytes restored):
//   - FREE RED (2026-08-12, pre-fix): the seed (c) escalation assertions ran
//     red against the then-current no-escalation bridge catch branches before
//     the F-PT-036 product change landed.
//   - SEEDED PERMISSIVE FALLBACK (2026-08-12): a bridge catch branch answering
//     `allow: true` on classifier throw, an authority fallback resolving to the
//     delegated default, a corrupt secret accepted, and `isBudgetBlocking`
//     treating `unknown` as non-blocking each turned their arm red before the
//     conservative paths were restored green.

import { createConnection } from "node:net";
import { chmod, link, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startCodexGateBridge } from "../../../src/runtime/adapters/codex-gate-bridge.js";
import { startCursorGateBridge } from "../../../src/runtime/adapters/cursor-gate-bridge.js";
import { startOpencodeGateBridge } from "../../../src/runtime/adapters/opencode-gate-bridge.js";
import { startMuseGateBridge } from "../../../src/runtime/adapters/muse-gate-bridge.js";
import { startGrokGateBridge } from "../../../src/runtime/adapters/grok-gate-bridge.js";
import { piToolCallGateHandler } from "../../../src/runtime/adapters/pi-gate.js";
import { cursorDenyRulesForRole } from "../../../src/runtime/role-shaping.js";
import type { GateDecision, GateEscalation } from "../../../src/runtime/types.js";
import { LEGACY_CONSERVATIVE_VERSION, resolveAuthority } from "../../../src/org/authority.js";
import { isBudgetBlocking, rollupBudgets, type BudgetRow } from "../../../src/org/budget.js";
import { resolveReviewAuthorizationSecret } from "../../../src/org/review-authorization-secret.js";
import type { AppsFile } from "../../../src/org/apps.js";
import { makeTempGitRepo, type TempGitRepo } from "../../fixtures/git-repo.js";

interface BridgeReply {
  allow: boolean;
  reason?: string;
}

/** Parse-don't-cast reply validation: throw on anything that is not the wire
 *  contract, never coerce. */
function parseBridgeReply(raw: string): BridgeReply {
  const parsed: unknown = JSON.parse(raw);
  if (parsed === null || typeof parsed !== "object") throw new Error(`bridge reply is not an object: ${raw}`);
  if (!("allow" in parsed) || typeof parsed.allow !== "boolean") {
    throw new Error(`bridge reply has no boolean allow: ${raw}`);
  }
  const reason = "reason" in parsed ? parsed.reason : undefined;
  return typeof reason === "string" ? { allow: parsed.allow, reason } : { allow: parsed.allow };
}

/** Codex/Cursor wire protocol (mirrors codex-gate-hook.ts / cursor-gate-hook.ts):
 *  connect, half-close with the payload, read the JSON reply written on end. */
/** Muse answers in its vendor hook envelope rather than the shared
 *  `{allow, reason}` shape, so its reply is read raw. */
function askMuseBridge(socketPath: string, payload: unknown): Promise<{ decision?: string; reason?: string }> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let out = "";
    socket.setTimeout(10_000, () => {
      socket.destroy();
      reject(new Error("bridge client timed out"));
    });
    socket.on("connect", () => socket.end(JSON.stringify(payload)));
    socket.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
    });
    socket.on("error", reject);
    socket.on("end", () => {
      const parsed: unknown = JSON.parse(out);
      if (typeof parsed !== "object" || parsed === null) {
        reject(new Error(`muse bridge reply is not an object: ${out}`));
        return;
      }
      const envelope: Record<string, unknown> = { ...parsed };
      const output = envelope["hookSpecificOutput"];
      const fields: Record<string, unknown> = typeof output === "object" && output !== null ? { ...output } : {};
      const decision = fields["permissionDecision"];
      const reason = fields["permissionDecisionReason"];
      resolve({
        ...(typeof decision === "string" ? { decision } : {}),
        ...(typeof reason === "string" ? { reason } : {}),
      });
    });
  });
}

function askHalfCloseBridge(socketPath: string, payload: unknown, raw = false): Promise<BridgeReply> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let out = "";
    socket.setTimeout(10_000, () => {
      socket.destroy();
      reject(new Error("bridge client timed out"));
    });
    socket.on("connect", () => socket.end(raw ? String(payload) : JSON.stringify(payload)));
    socket.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
    });
    socket.on("error", reject);
    socket.on("end", () => {
      try {
        resolve(parseBridgeReply(out));
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}

/** OpenCode wire protocol (mirrors opencode-gate-client.ts): newline-delimited
 *  both ways, the client never half-closes. */
function askOpencodeBridge(socketPath: string, payload: unknown): Promise<BridgeReply> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let out = "";
    socket.setTimeout(10_000, () => {
      socket.destroy();
      reject(new Error("opencode bridge client timed out"));
    });
    socket.on("connect", () => socket.write(`${JSON.stringify(payload)}\n`));
    socket.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
      const newline = out.indexOf("\n");
      if (newline < 0) return;
      socket.destroy();
      try {
        resolve(parseBridgeReply(out.slice(0, newline)));
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    socket.on("error", reject);
  });
}

/** INV-015's throwing classifier: the gate itself is broken, not merely strict. */
function throwingGate(): GateDecision {
  throw new Error("classifier boom");
}

const VALID_SECRET = "A".repeat(43); // matches the generated base64url shape

async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

async function writeSecretFile(stateHome: string, content: string, mode = 0o600): Promise<string> {
  const dir = join(stateHome, "state");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, "self-approval-secret");
  await writeFile(path, content, { encoding: "utf8", mode });
  return path;
}

describe("CF-INV-015 (L1/L2, HB-150) — every error branch reduces capability, never widens it", () => {
  describe("seed (a): corrupt/linked self-approval HMAC key fails closed", () => {
    it("corrupt secret bytes are refused — and never silently regenerated into a fresh signer", async () => {
      const stateHome = await tempDir("cf-inv-015-secret-corrupt-");
      const path = await writeSecretFile(stateHome, "not-a-generated-secret\n");
      await expect(resolveReviewAuthorizationSecret(stateHome)).rejects.toThrow(/corrupt/);
      // The wider outcome would be replacing the corrupt key with a fresh one
      // (error → more capability). The corrupt bytes must survive untouched.
      expect(await readFile(path, "utf8")).toBe("not-a-generated-secret\n");
    });

    it("a symlinked secret is refused (O_NOFOLLOW), not followed", async () => {
      const stateHome = await tempDir("cf-inv-015-secret-symlink-");
      const dir = join(stateHome, "state");
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const real = join(stateHome, "elsewhere-secret");
      await writeFile(real, `${VALID_SECRET}\n`, { encoding: "utf8", mode: 0o600 });
      await symlink(real, join(dir, "self-approval-secret"));
      await expect(resolveReviewAuthorizationSecret(stateHome)).rejects.toThrow(/must not be a symlink/);
    });

    it("a hard-linked secret (nlink > 1) is refused", async () => {
      const stateHome = await tempDir("cf-inv-015-secret-hardlink-");
      const path = await writeSecretFile(stateHome, `${VALID_SECRET}\n`);
      await link(path, join(stateHome, "state", "second-name"));
      await expect(resolveReviewAuthorizationSecret(stateHome)).rejects.toThrow(/must not have hard links/);
    });

    it("group/other-readable key material is refused", async () => {
      const stateHome = await tempDir("cf-inv-015-secret-perms-");
      const path = await writeSecretFile(stateHome, `${VALID_SECRET}\n`);
      await chmod(path, 0o644);
      await expect(resolveReviewAuthorizationSecret(stateHome)).rejects.toThrow(/permissions are unsafe/);
    });

    it("discriminator: a well-formed secret resolves — the detector is not a constant deny", async () => {
      const stateHome = await tempDir("cf-inv-015-secret-ok-");
      await writeSecretFile(stateHome, `${VALID_SECRET}\n`);
      await expect(resolveReviewAuthorizationSecret(stateHome)).resolves.toBe(VALID_SECRET);
    });
  });

  describe("seed (b): org with no charter fails closed to legacy-conservative, never delegated", () => {
    it("missing AUTHORITY.md resolves to the built-in conservative charter", async () => {
      const orgHome = await tempDir("cf-inv-015-no-charter-");
      const authority = await resolveAuthority({ orgHome });
      expect(authority.version).toBe(LEGACY_CONSERVATIVE_VERSION);
      expect(authority.profile).toBe("conservative");
      // The wider outcome would be inheriting the newer delegated default
      // without an attributable human choice.
      expect(authority.version).not.toContain("delegated");
      expect(authority.text).toContain("fails closed");
      expect(authority.sources).toEqual([`builtin:${LEGACY_CONSERVATIVE_VERSION}`]);
    });
  });

  describe("seed (c): classifier throw → deny + ESCALATE on every socket gate bridge (F-PT-036)", () => {
    const cleanups: Array<() => Promise<void>> = [];
    let repo: TempGitRepo | undefined;

    afterEach(async () => {
      for (const cleanup of cleanups.splice(0)) await cleanup();
      await repo?.cleanup();
      repo = undefined;
    });

    it("Codex bridge: a throwing gate denies AND appends the GateEscalation", async () => {
      const escalations: GateEscalation[] = [];
      const bridge = await startCodexGateBridge(
        "/tmp/cf-inv-015-wd",
        "gpt-5.6-sol",
        { gate: throwingGate },
        escalations,
      );
      cleanups.push(() => bridge.close());

      const reply = await askHalfCloseBridge(bridge.socketPath, {
        tool_name: "Bash",
        tool_input: { command: "cat .env" },
      });
      expect(reply.allow).toBe(false);
      expect(reply.reason).toContain("failed closed");
      // The escalation half — the F-PT-036 product change. Ran RED against the
      // pre-fix bridge (silent denial) on 2026-08-12 before turning green.
      expect(escalations).toHaveLength(1);
      expect(escalations[0]?.action.tool).toBe("bash");
      expect(escalations[0]?.reason).toContain("classifier boom");
    });

    it("Codex bridge: a payload the bridge cannot even normalize denies AND escalates as unclassifiable", async () => {
      const escalations: GateEscalation[] = [];
      const bridge = await startCodexGateBridge(
        "/tmp/cf-inv-015-wd",
        "gpt-5.6-sol",
        { gate: throwingGate },
        escalations,
      );
      cleanups.push(() => bridge.close());

      const reply = await askHalfCloseBridge(bridge.socketPath, "{not valid json", true);
      expect(reply.allow).toBe(false);
      expect(reply.reason).toContain("failed closed");
      expect(escalations).toHaveLength(1);
      expect(escalations[0]?.action.tool).toBe("unclassifiable");
    });

    it("Cursor bridge: a throwing gate denies AND appends the GateEscalation", async () => {
      repo = await makeTempGitRepo();
      const globalDir = await tempDir("cf-inv-015-cursor-global-");
      const globalConfigPath = join(globalDir, "cli-config.json");
      await writeFile(globalConfigPath, JSON.stringify({}), "utf8");
      const escalations: GateEscalation[] = [];
      const bridge = await startCursorGateBridge(repo.dir, { gate: throwingGate }, escalations, {
        denyRules: cursorDenyRulesForRole("builder"),
        globalConfigPath,
      });
      cleanups.push(() => bridge.close());

      const reply = await askHalfCloseBridge(bridge.socketPath, {
        tool_name: "Shell",
        tool_input: { command: "cat .env" },
      });
      expect(reply.allow).toBe(false);
      expect(reply.reason).toContain("failed closed");
      expect(escalations).toHaveLength(1);
      expect(escalations[0]?.action.tool).toBe("bash");
      expect(escalations[0]?.reason).toContain("classifier boom");
      // The handshake probes above never consult (or escalate through) the org
      // gate: exactly one escalation exists and it is the classifier failure.
      expect(bridge.allowed).toBe(0);
    });

    it("OpenCode bridge: a throwing gate denies AND appends the GateEscalation", async () => {
      const workdir = await tempDir("cf-inv-015-opencode-wd-");
      const escalations: GateEscalation[] = [];
      const bridge = await startOpencodeGateBridge(workdir, { gate: throwingGate }, escalations);
      cleanups.push(() => bridge.close());

      const reply = await askOpencodeBridge(bridge.socketPath, {
        op: "gate",
        tool: "bash",
        args: { command: "cat .env" },
      });
      expect(reply.allow).toBe(false);
      expect(reply.reason).toContain("failed closed");
      expect(escalations).toHaveLength(1);
      expect(escalations[0]?.action.tool).toBe("bash");
      expect(escalations[0]?.reason).toContain("classifier boom");
    });

    // F-PT-037 (owner ruling 2026-08-12) extends seed (c) to the three seams
    // F-PT-036 did not reach. muse and grok denied fail-closed in their own
    // catches WITHOUT escalating; pi had no catch at all.
    it("Muse bridge (F-PT-037): a throwing gate denies AND appends the GateEscalation", async () => {
      const escalations: GateEscalation[] = [];
      const bridge = await startMuseGateBridge("/tmp/cf-inv-015-muse-wd", { gate: throwingGate }, escalations);
      cleanups.push(() => bridge.close());

      const reply = await askMuseBridge(bridge.socketPath, {
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command: "cat .env" },
      });
      expect(reply.decision).toBe("deny");
      expect(reply.reason).toContain("failed closed");
      // SEEDED CONTROL for this seam: before the ruling this list stayed empty,
      // so a persistently broken classifier read as universal refusal with no
      // signal anywhere.
      expect(escalations).toHaveLength(1);
      expect(escalations[0]?.reason).toContain("classifier boom");
    });

    it("Grok bridge (F-PT-037): a throwing gate denies AND appends the GateEscalation", async () => {
      const escalations: GateEscalation[] = [];
      const bridge = await startGrokGateBridge("/tmp/cf-inv-015-grok-wd", { gate: throwingGate }, escalations);
      cleanups.push(() => bridge.close());

      const reply = await askHalfCloseBridge(bridge.socketPath, {
        hookEventName: "pre_tool_use",
        toolName: "shell",
        toolInput: { command: "cat .env" },
      });
      expect(reply.allow).toBe(false);
      expect(reply.reason).toContain("failed closed");
      expect(escalations).toHaveLength(1);
      expect(escalations[0]?.reason).toContain("classifier boom");
    });

    it("pi extension (F-PT-037): Cormidia's OWN catch blocks and escalates, not the vendor's", () => {
      // The load-bearing case. pi is fail-closed today only because the vendor
      // SDK catches downstream — a version-banded behavior one bump could
      // invert, with no escalation either way. This drives the gate decision
      // directly, so it asserts that CORMIDIA's code produces the block.
      const escalations: GateEscalation[] = [];
      const decide = piToolCallGateHandler("/tmp/cf-inv-015-pi-wd", { gate: throwingGate }, escalations);

      const result = decide({ toolName: "bash", input: { command: "cat .env" } });
      // SEEDED CONTROL: without Cormidia's own catch this THROWS instead of
      // returning a block, and the guarantee belongs to the vendor.
      expect(result?.block).toBe(true);
      expect(result?.reason).toContain("failed closed");
      expect(escalations).toHaveLength(1);
      expect(escalations[0]?.reason).toContain("classifier boom");
    });
  });

  describe("seed (d): unreadable budget state → no admission", () => {
    const NOW = new Date("2026-08-12T12:00:00Z");

    const apps: AppsFile = {
      org: { name: "sweep-org", maxConcurrentTurns: 1 },
      defaults: { budgetUsdMonth: 100, objectiveBudgetUsd: 10 },
      apps: [
        { name: "alpha", repo: "o/alpha", status: "live", budgetUsdMonth: 100, objectiveBudgetUsd: 10, cadence: {} },
        { name: "beta", repo: "o/beta", status: "live", budgetUsdMonth: 100, objectiveBudgetUsd: 10, cadence: {} },
      ],
    };

    function row(rows: BudgetRow[], app: string): BudgetRow {
      const found = rows.find((candidate) => candidate.app === app);
      if (found === undefined) throw new Error(`no budget row for ${app}`);
      return found;
    }

    it("an app whose month total cannot be computed is `unknown` and BLOCKS admission; a computable sibling stays admitted", async () => {
      const orgHome = await tempDir("cf-inv-015-budget-");
      await mkdir(join(orgHome, "telemetry"), { recursive: true });
      const month = NOW.toISOString().slice(0, 7);
      await writeFile(
        join(orgHome, "telemetry", `${month}.jsonl`),
        // alpha's ledger row has no costUsd: its month total is unverifiable.
        `${JSON.stringify({ app: "alpha" })}\n${JSON.stringify({ app: "beta", costUsd: 1.25 })}\n`,
        "utf8",
      );

      const rows = await rollupBudgets(orgHome, apps, NOW);
      const alpha = row(rows, "alpha");
      expect(alpha.status).toBe("unknown");
      // `unknown` is fail-closed over-cap: no admission (turn-runner consults
      // exactly this predicate before dispatch).
      expect(isBudgetBlocking(alpha.status)).toBe(true);
      // Discriminator: the readable sibling is not swept up in the block.
      const beta = row(rows, "beta");
      expect(beta.status).toBe("ok");
      expect(isBudgetBlocking(beta.status)).toBe(false);
    });

    it("the blocking truth table is pinned: unknown/exceeded block, ok/warning admit", () => {
      // "I could not compute the spend" must never read as "the spend is fine"
      // (A-004): a permissive re-mapping of `unknown` turns this red.
      expect(isBudgetBlocking("unknown")).toBe(true);
      expect(isBudgetBlocking("exceeded")).toBe(true);
      expect(isBudgetBlocking("ok")).toBe(false);
      expect(isBudgetBlocking("warning")).toBe(false);
    });
  });
});
