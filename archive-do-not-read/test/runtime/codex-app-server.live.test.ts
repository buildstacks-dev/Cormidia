// Live-smokes CodexRuntime against the real @openai/codex App Server over stdio.
// Covers a no-tool turn, Codex thread handle creation, and adapter completion
// with the live local Codex stack.
// Excluded from pnpm test; pnpm test:live runs it only when OPERON_CODEX_LIVE=1.
// It uses a temp workdir but depends on real Codex auth/local tooling and may
// spend OpenAI or ChatGPT account quota.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CodexRuntime } from "../../src/runtime/adapters/codex.js";
import { defaultGate } from "../../src/runtime/gate.js";
import type { RoleConfig, TurnEvent } from "../../src/runtime/types.js";

const enabled = process.env.OPERON_CODEX_LIVE === "1";
const model = process.env.OPERON_CODEX_LIVE_MODEL ?? "gpt-5.6-sol";

const role: RoleConfig = {
  name: "builder",
  runtime: "codex",
  model,
  effort: "low",
  delegation: { allow: [] },
  triggers: [],
  outputs: [],
  maxTurnBudgetUsd: 0.5,
};

if (!enabled) {
  console.warn("[codex-app-server.live] SKIPPING - set OPERON_CODEX_LIVE=1 to run the real App Server smoke.");
}

describe.skipIf(!enabled)("CodexRuntime live App Server smoke", () => {
  it("runs a no-tool turn and returns a Codex thread handle", async () => {
    const workdir = mkdtempSync(join(tmpdir(), "operon-codex-live-"));
    try {
      const result = await new CodexRuntime().runTurn(
        {
          role,
          workdir,
          task: "Do not use tools. Reply with exactly: OK",
          context: { taste: [], memoryExcerpts: [] },
          maxTurns: 1,
        },
        { gate: () => ({ allow: true }) },
      );

      expect(result.status).toBe("completed");
      expect(result.session.runtime).toBe("codex");
      expect(result.session.id.length).toBeGreaterThan(0);
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  it("runs a pnpm install with the canonical non-interactive sandbox environment", async () => {
    const workdir = mkdtempSync(join(tmpdir(), "operon-codex-pnpm-live-"));
    try {
      writeFileSync(
        join(workdir, "package.json"),
        `${JSON.stringify({ name: "operon-sandbox-env-probe", private: true, packageManager: "pnpm@11.10.0" }, null, 2)}\n`,
      );
      writeFileSync(
        join(workdir, "pnpm-lock.yaml"),
        "lockfileVersion: '9.0'\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\nimporters:\n  .: {}\n",
      );
      const events: TurnEvent[] = [];
      const command =
        'test "$CI" = "true" && ' +
        'test "$NPM_CONFIG_YES" = "true" && ' +
        'test "$DEBIAN_FRONTEND" = "noninteractive" && ' +
        'test "$GIT_TERMINAL_PROMPT" = "0" && ' +
        "pnpm install --offline --frozen-lockfile";

      const result = await new CodexRuntime().runTurn(
        {
          role,
          workdir,
          task:
            `Use the bash tool exactly once to run this exact command:\n${command}\n` +
            "Do not use any other tool, do not access the network, and do not edit package files. " +
            "After the command exits successfully, reply with exactly: OK",
          context: { taste: [], memoryExcerpts: [] },
          networkAccess: false,
        },
        {
          gate: defaultGate,
          onEvent: (event) => events.push(event),
        },
      );

      const successfulProbe = events.find(
        (event) =>
          event.type === "tool_use" &&
          event.name === "bash" &&
          event.success === true &&
          typeof (event.args as { command?: unknown } | undefined)?.command === "string" &&
          (event.args as { command: string }).command.includes("pnpm install --offline --frozen-lockfile"),
      );
      console.info(
        `[codex-app-server.live] ISSUE-017 evidence ${JSON.stringify({
          status: result.status,
          session: result.session,
          usage: result.usage,
          successfulProbe: successfulProbe !== undefined,
        })}`,
      );
      expect(result.status).toBe("completed");
      expect(result.summary.trim()).toBe("OK");
      expect(successfulProbe).toBeDefined();
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });
});
