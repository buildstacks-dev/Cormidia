// Gate conformance seed. Today this tests the default gate directly; the same
// cases become the adapter conformance suite — every Runtime must demonstrate
// that these actions, attempted mid-turn (including by subagents), are
// blocked and escalated.

import { describe, expect, it } from "vitest";
import { classify, defaultGate } from "../src/runtime/gate.js";
import type { ToolAction } from "../src/runtime/types.js";

const bash = (command: string): ToolAction => ({ tool: "bash", input: { command } });

const CRITICAL_CASES: { action: ToolAction; rule: string }[] = [
  { action: bash("doctl apps create-deployment 1a2b"), rule: "production-deploy" },
  { action: bash("kubectl apply -f prod.yaml"), rule: "production-deploy" },
  { action: bash("rm -rf /workspace/data"), rule: "destructive-or-irreversible" },
  { action: bash("git push --force-push origin main"), rule: "destructive-or-irreversible" },
  { action: bash("npm publish --access public"), rule: "external-publishing" },
  { action: bash("cat .env"), rule: "secrets-or-auth" },
  {
    action: { tool: "edit", input: { path: "TASTE.md", old: "a", new: "b" } },
    rule: "protocol-self-edit",
  },
  {
    action: { tool: "write", input: { path: "roles.yaml", content: "..." } },
    rule: "protocol-self-edit",
  },
  // M0.5 — the seven protocol surfaces this build plan will create, before
  // any of them exist in the repo (docs/loop.md §2 rule 2; docs/loop.md §10;
  // docs/architecture.md §6).
  {
    action: { tool: "write", input: { path: "pipelines.yaml", content: "..." } },
    rule: "protocol-self-edit",
  },
  {
    action: { tool: "write", input: { path: "prompts/build/contract.md", content: "..." } },
    rule: "protocol-self-edit",
  },
  {
    // Path-qualified role taste addenda — the regression case for the fixed
    // regex: "taste/reviewer.md" has no "taste.md" substring.
    action: { tool: "write", input: { path: "taste/reviewer.md", content: "..." } },
    rule: "protocol-self-edit",
  },
  {
    action: { tool: "write", input: { path: "apps.yaml", content: "..." } },
    rule: "protocol-self-edit",
  },
  {
    action: { tool: "edit", input: { path: ".operon/config.yaml", old: "a", new: "b" } },
    rule: "protocol-self-edit",
  },
  {
    action: { tool: "edit", input: { path: ".operon/TASTE.md", old: "a", new: "b" } },
    rule: "protocol-self-edit",
  },
  {
    // Orchestrator-only writes (docs/architecture.md §6) — a distinct rule
    // from protocol-self-edit, not a rewording of it.
    action: {
      tool: "write",
      input: { path: "scorecards/civic/builder.jsonl", content: "..." },
    },
    rule: "scorecard-tamper",
  },
  // Shell-shaped writes to protocol surfaces (M2.2 review finding): the old
  // isWrite `\b>\s` alternative could never match a redirect after a space,
  // and cp/tee were absent — so these all classified routine.
  { action: bash("echo 'passes: []' > pipelines.yaml"), rule: "protocol-self-edit" },
  { action: bash("cat /tmp/new-rules >> TASTE.md"), rule: "protocol-self-edit" },
  { action: bash("cp /tmp/evil.md prompts/review/verify.md"), rule: "protocol-self-edit" },
  { action: bash("tee roles.yaml < /tmp/replacement"), rule: "protocol-self-edit" },
  { action: bash("echo '{}' > scorecards/civic/builder.jsonl"), rule: "scorecard-tamper" },
];

const ROUTINE_CASES: ToolAction[] = [
  bash("pnpm test"),
  bash("git commit -m 'feat: add parser'"),
  bash("git push origin feature/parser"),
  { tool: "read", input: { path: "src/cli.ts" } },
  { tool: "edit", input: { path: "src/org/roles.ts", old: "a", new: "b" } },
  { tool: "read", input: { path: "TASTE.md" } }, // READING protocol docs is fine
  // M0.5 — reading any protocol surface is fine; only writes are critical.
  { tool: "read", input: { path: "pipelines.yaml" } },
  { tool: "read", input: { path: "prompts/build/contract.md" } },
  { tool: "read", input: { path: "taste/reviewer.md" } },
  { tool: "read", input: { path: "apps.yaml" } },
  { tool: "read", input: { path: ".operon/config.yaml" } },
  { tool: "read", input: { path: ".operon/TASTE.md" } },
  { tool: "read", input: { path: "scorecards/civic/builder.jsonl" } },
  // M0.5 — memory dirs stay routine-writable even though other org-home /
  // app-repo writes are locked down (docs/architecture.md §6: "the
  // protocol-self-edit gate rule does not cover them").
  {
    tool: "write",
    input: { path: "memory/roles/reviewer/lesson.md", content: "..." },
  },
  {
    tool: "write",
    input: { path: ".operon/memory/builder/lesson.md", content: "..." },
  },
  // Near-misses for the redirect/cp/tee expansion: writes that touch no
  // protocol surface, and a protocol-surface read whose 2>&1 is fd
  // duplication, not a file write.
  bash("echo hi > /tmp/notes.md"),
  bash("cp src/a.ts src/b.ts"),
  bash("cat pipelines.yaml 2>&1"),
];

describe("critical-ops gate (default policy)", () => {
  for (const { action, rule } of CRITICAL_CASES) {
    it(`denies + escalates: ${rule} — ${JSON.stringify(action.input).slice(0, 60)}`, () => {
      expect(classify(action)).toEqual({ cls: "critical", rule });
      const decision = defaultGate(action);
      expect(decision.allow).toBe(false);
      if (!decision.allow) expect(decision.escalate).toBe(true);
    });
  }

  for (const action of ROUTINE_CASES) {
    it(`allows routine: ${JSON.stringify(action.input).slice(0, 60)}`, () => {
      expect(classify(action).cls).toBe("routine");
      expect(defaultGate(action)).toEqual({ allow: true });
    });
  }
});
