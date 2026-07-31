// Tests the approvals CLI surface wired through src/cli.ts and ApprovalStore.
// Covers empty listings, age formatting, interactive approve/deny input,
// showing persisted decisions/grants, A5 denial lessons, and never-scopeable
// scope rejection mid-review.
// Uses a subprocess, a temp org home, and temp state homes; it depends on
// local node tooling only, not network, auth, real org state, or wall-clock
// time. The org home is created once per file and injected via
// OPERON_ORG_HOME so nothing resolves the host machine's active org (denial
// lessons write into the org home — an earlier version of this file leaked
// them into the real active org).

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApprovalStore } from "../src/org/approvals.js";
import { initOrgHome } from "../src/org/home.js";
import { makeOrgHome } from "./fixtures/orgHome.js";

const CLI_PATH = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const CWD = fileURLToPath(new URL("..", import.meta.url));
const TSX_LOADER = createRequire(import.meta.url).resolve("tsx");

const TEST_ROOT = mkdtempSync(join(tmpdir(), "operon-approvals-cli-"));
const ORG_HOME = join(TEST_ROOT, "org");

beforeAll(async () => {
  await initOrgHome({
    target: ORG_HOME,
    name: "approvals-cli-test",
    stateHome: join(TEST_ROOT, "state"),
    homeDir: join(TEST_ROOT, "home"),
  });
});

afterAll(() => rmSync(TEST_ROOT, { recursive: true, force: true }));

async function runCli(args: string[], input?: string) {
  return new Promise<{ stdout: string; stderr: string; code: number }>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", TSX_LOADER, CLI_PATH, ...args], {
      cwd: CWD,
      env: { ...process.env, OPERON_ORG_HOME: ORG_HOME, HOME: join(TEST_ROOT, "home") },
    });
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

  it("review deny persists an A5 denial lesson under the role's memory", async () => {
    const home = makeOrgHome({ approvals: true });
    const store = new ApprovalStore(home.root, { idSource: () => "lesson1" });
    try {
      await store.raise({
        app: "alpha",
        role: "builder",
        rule: "outbound-network",
        action: { tool: "bash", input: { command: "curl https://example.com" } },
      });
      const { stdout, code } = await runCli(
        ["approvals", "--home", home.root, "review"],
        "d\nno raw egress from build turns\n",
      );
      expect(code).toBe(0);
      expect(stdout).toContain("lesson recorded for role builder");
      const lessons = readFileSync(
        join(ORG_HOME, "memory", "roles", "builder", "denial-lessons.md"),
        "utf8",
      );
      expect(lessons).toContain("[outbound-network] no raw egress from build turns");
      const index = readFileSync(join(ORG_HOME, "memory", "roles", "builder", "INDEX.md"), "utf8");
      expect(index).toContain("denial-lessons.md");
    } finally {
      home.cleanup();
    }
  });

  it("a scope request on a never-scopeable rule leaves the item pending and the queue alive", async () => {
    const home = makeOrgHome({ approvals: true });
    let n = 0;
    const store = new ApprovalStore(home.root, { idSource: () => `scoped${++n}` });
    try {
      await store.raise({
        app: "alpha",
        role: "builder",
        rule: "self-merge-or-approve",
        action: { tool: "bash", input: { command: "gh pr merge 7 --squash" } },
        now: new Date("2026-07-11T00:00:00Z"),
      });
      await store.raise({
        app: "alpha",
        role: "builder",
        rule: "dns-or-domain",
        action: { tool: "bash", input: { command: "dns record" } },
        now: new Date("2026-07-11T00:00:01Z"),
      });
      const { stdout, code } = await runCli(
        ["approvals", "--home", home.root, "review"],
        "a app\na\n",
      );
      expect(code).toBe(0);
      expect(stdout).toContain("NOT decided scoped1");
      expect(stdout).toContain("never scopeable");
      expect(stdout).toContain("approved scoped2");
      const pending = await new ApprovalStore(home.root).listPending();
      expect(pending.map((item) => item.id)).toEqual(["scoped1"]);
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
