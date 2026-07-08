// Tests the approvals CLI surface wired through src/cli.ts and ApprovalStore.
// Covers empty listings, age formatting, interactive approve/deny input, and
// showing persisted decisions/grants.
// Uses a subprocess and temp org homes; it depends on local node tooling only,
// not network, auth, real org state, or wall-clock time.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ApprovalStore } from "../src/org/approvals.js";
import { makeOrgHome } from "./fixtures/orgHome.js";

const CLI_PATH = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const CWD = fileURLToPath(new URL("..", import.meta.url));

async function runCli(args: string[], input?: string) {
  return new Promise<{ stdout: string; stderr: string; code: number }>((resolve, reject) => {
    const child = spawn("npx", ["tsx", CLI_PATH, ...args], { cwd: CWD });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, stderr, code: code ?? 1 }));
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

describe("approvals CLI", () => {
  it("empty home prints a header and zero pending", async () => {
    const home = makeOrgHome();
    try {
      const { stdout, code } = await runCli(["approvals", "--home", home.root]);
      expect(code).toBe(0);
      expect(stdout).toContain("ID");
      expect(stdout).toContain("0 pending");
    } finally {
      home.cleanup();
    }
  });

  it("lists seeded items with app role rule and age columns", async () => {
    const home = makeOrgHome({ approvals: true });
    const store = new ApprovalStore(home.root, { idSource: () => "item1" });
    try {
      await store.raise({
        app: "alpha",
        role: "builder",
        rule: "secrets-or-auth",
        action: { tool: "bash", input: { command: "cat .env" } },
        now: new Date("2026-07-06T00:00:00Z"),
      });
      const { stdout } = await runCli([
        "approvals",
        "--home",
        home.root,
        "--now",
        "2026-07-06T02:00:00Z",
      ]);
      expect(stdout).toContain("alpha");
      expect(stdout).toContain("builder");
      expect(stdout).toContain("secrets-or-auth");
      expect(stdout).toContain("2h");
    } finally {
      home.cleanup();
    }
  });

  it("review approves from stdin and show reports the grant id", async () => {
    const home = makeOrgHome({ approvals: true });
    const store = new ApprovalStore(home.root, { idSource: () => "approve1" });
    try {
      await store.raise({
        app: "alpha",
        role: "builder",
        rule: "secrets-or-auth",
        action: { tool: "bash", input: { command: "cat .env" } },
      });
      expect((await runCli(["approvals", "--home", home.root, "review"], "a\n")).stdout).toContain(
        "grant=grant-approve1",
      );
      const show = await runCli(["approvals", "--home", home.root, "show", "approve1"]);
      expect(show.stdout).toContain('"grantId": "grant-approve1"');
    } finally {
      home.cleanup();
    }
  });

  it("review denies from stdin and persists the reason", async () => {
    const home = makeOrgHome({ approvals: true });
    const store = new ApprovalStore(home.root, { idSource: () => "deny1" });
    try {
      await store.raise({
        app: "alpha",
        role: "builder",
        rule: "dns-or-domain",
        action: { tool: "bash", input: { command: "dns record" } },
      });
      await runCli(["approvals", "--home", home.root, "review"], "d\nnot safe\n");
      const show = await runCli(["approvals", "--home", home.root, "show", "deny1"]);
      expect(show.stdout).toContain('"reason": "not safe"');
    } finally {
      home.cleanup();
    }
  });
});
