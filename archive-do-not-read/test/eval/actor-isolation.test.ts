import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeEvalActorGate } from "../../scripts/eval/safety.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("hidden-answer actor sandbox boundary", () => {
  it("positive case allows ordinary actor worktree paths", () => {
    const { gate } = fixture();
    expect(gate({ tool: "write", input: { path: "src/fix.ts", content: "ok" } })).toEqual({ allow: true });
  });
  it("near-miss blocks parent, absolute verifier, encoded traversal, redirects, and symlink escapes without raising approval", () => {
    const { gate, verifier, workdir } = fixture();
    const actions = [
      { tool: "read", input: { path: "../verifier/answer.txt" } },
      { tool: "read", input: { path: join(verifier, "answer.txt") } },
      { tool: "read", input: { path: "%2e%2e%2fverifier%2fanswer.txt" } },
      { tool: "bash", input: { command: "cat answer > ../leak.txt" } },
      { tool: "read", input: { path: join(workdir, "escape", "answer.txt") } },
    ];
    for (const action of actions) expect(gate(action)).toMatchObject({ allow: false, escalate: false });
  });
  it("allows the Codex approval shell launcher without allowing its inner command to escape", () => {
    const { gate, verifier } = fixture();
    expect(gate({ tool: "bash", input: { command: "/bin/zsh -lc 'npm test'" } })).toEqual({ allow: true });
    const nearMisses = [
      { tool: "bash", input: { command: "/bin/zsh -lc 'cat /etc/passwd'" } },
      { tool: "bash", input: { command: "/bin/zsh -lc 'cat ../verifier/answer.txt'" } },
      { tool: "bash", input: { command: `/bin/zsh -lc 'cat ${join(verifier, "answer.txt")}'` } },
    ];
    for (const action of nearMisses) expect(gate(action)).toMatchObject({ allow: false, escalate: false });
  });
  it("honest failure keeps verifier identity out of actor environment and prompt material", () => {
    const { verifier } = fixture();
    const actorEnv = { HOME: "/synthetic/home", OPERON_ORG_HOME: "/synthetic/org" };
    expect(JSON.stringify(actorEnv)).not.toContain(verifier);
    expect(JSON.stringify(actorEnv)).not.toContain("OPERON_EVAL_ROOT");
  });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "operon-actor-isolation-")); roots.push(root);
  const workdir = join(root, "actor"); const verifier = join(root, "verifier"); mkdirSync(join(workdir, "src"), { recursive: true }); mkdirSync(verifier, { recursive: true });
  writeFileSync(join(verifier, "answer.txt"), "OPERON_HIDDEN_MARKER"); symlinkSync(verifier, join(workdir, "escape"));
  return { workdir, verifier, gate: makeEvalActorGate({ workdir, forbiddenRoots: [verifier] }) };
}
