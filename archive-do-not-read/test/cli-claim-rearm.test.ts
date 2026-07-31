import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cmdClaimRearm, type ClaimRearmIo } from "../src/cli/claim-rearm.js";
import type { OperonHomes } from "../src/org/home.js";
import { readTicketClaimState, writeTicketClaimState } from "../src/loop/rehydrate.js";
import { FakeGhOps } from "./support/fakeGhOps.js";

describe("operon loop rearm", () => {
  let root = "";
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function setup() {
    root = mkdtempSync(join(tmpdir(), "operon-cli-rearm-"));
    const gh = new FakeGhOps({
      repo: "owner/app",
      issues: [{ number: 7, title: "Parked", body: "body", labels: ["op:returned"] }],
    });
    writeTicketClaimState(root, "app", 7, { claims: 3, outcomes: [], claimAllowance: 3 });
    const homes: OperonHomes = {
      packageRoot: root,
      orgHome: root,
      stateHome: root,
      pointerPath: join(root, "pointer"),
      appsFile: {
        org: { name: "fixture", maxConcurrentTurns: 1 },
        defaults: { budgetUsdMonth: 10 },
        apps: [{
          name: "app",
          repo: "owner/app",
          status: "live",
          budgetUsdMonth: 10,
          cadence: {},
        }],
      },
    };
    return { gh, homes };
  }

  const args = [
    "--app", "app",
    "--ticket", "7",
    "--reason", "reviewed ambiguity",
    "--actor", "operator@example.com",
    "--from-allowance", "3",
    "--to-allowance", "4",
  ];

  it("is a non-mutating preview by default", async () => {
    const { gh, homes } = setup();
    const lines: string[] = [];
    await cmdClaimRearm(args, homes, io(false, lines), { ghFor: () => gh });
    expect(lines[0]).toContain("PREVIEW app#7");
    expect(lines[1]).toContain("No changes made");
    expect((await gh.readIssue(7)).labels).toContain("op:returned");
    expect(readTicketClaimState(root, "app", 7).claimAllowance).toBe(3);
  });

  it("requires every non-TTY execution field and exact confirmation", async () => {
    const { gh, homes } = setup();
    await expect(cmdClaimRearm([...args, "--execute"], homes, io(false, []), { ghFor: () => gh }))
      .rejects.toThrow("--confirm must exactly match app#7");
    await expect(cmdClaimRearm([...args, "--execute", "--confirm", "app#8"], homes, io(false, []), { ghFor: () => gh }))
      .rejects.toThrow("--confirm must exactly match app#7");
    await cmdClaimRearm([...args, "--execute", "--confirm", "app#7"], homes, io(false, []), { ghFor: () => gh });
    expect((await gh.readIssue(7)).labels).toContain("op:ready");
    expect(readTicketClaimState(root, "app", 7).claimAllowance).toBe(4);
  });

  it("accepts exact interactive confirmation and rejects a near miss", async () => {
    const first = setup();
    const prompts: string[] = [];
    await expect(cmdClaimRearm([...args, "--execute"], first.homes, {
      interactive: true,
      ask: async (prompt) => {
        prompts.push(prompt);
        return "app#70";
      },
      out: () => {},
    }, { ghFor: () => first.gh })).rejects.toThrow("--confirm must exactly match app#7");
    expect(prompts[0]).toContain("Type app#7");
    rmSync(root, { recursive: true, force: true });

    const second = setup();
    await cmdClaimRearm([...args, "--execute"], second.homes, {
      interactive: true,
      ask: async () => "app#7",
      out: () => {},
    }, { ghFor: () => second.gh });
    expect((await second.gh.readIssue(7)).labels).toContain("op:ready");
  });
});

function io(interactive: boolean, lines: string[]): ClaimRearmIo {
  return {
    interactive,
    ask: async () => "",
    out: (line) => lines.push(line),
  };
}
