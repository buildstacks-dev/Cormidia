// Conformance seed for the CLI dispatch table (M0.1). Exercises the built
// entrypoint end-to-end so a new subcommand file that forgets its registry
// line, or a broken default case, shows up here.

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const CWD = fileURLToPath(new URL("..", import.meta.url));

async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execFileAsync("npx", ["tsx", CLI_PATH, ...args], { cwd: CWD });
    return { stdout, stderr, code: 0 };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; code?: number };
    return { stdout: err.stdout ?? "", stderr: err.stderr ?? "", code: err.code ?? 1 };
  }
}

describe("cli dispatch", () => {
  it("unknown command prints usage and exits 1", async () => {
    const { stdout, code } = await runCli(["bogus-command"]);
    expect(stdout).toContain("Usage:");
    expect(code).toBe(1);
  });

  it("no command prints usage and exits 0", async () => {
    const { stdout, code } = await runCli([]);
    expect(stdout).toContain("Usage:");
    expect(code).toBe(0);
  });

  it("roles subcommand still validates roles.yaml", async () => {
    const { stdout, code } = await runCli(["roles"]);
    expect(code).toBe(0);
    expect(stdout).toContain("roles.yaml: OK");
  });

  it("apps subcommand validates the root apps.yaml", async () => {
    const { stdout, code } = await runCli(["apps"]);
    expect(code).toBe(0);
    expect(stdout).toContain("apps.yaml: OK");
    expect(stdout).toMatch(/APP\s+REPO\s+STATUS\s+BUDGET/);
  });

  it("pipelines subcommand validates the root pipelines.yaml", async () => {
    const { stdout, code } = await runCli(["pipelines"]);
    expect(code).toBe(0);
    expect(stdout).toContain("pipelines.yaml: OK");
  });

  it("bootstrap --scan-only reports without writing", async () => {
    const target = mkdtempSync(join(tmpdir(), "operon-cli-bootstrap-"));
    try {
      const { stdout, code } = await runCli(["bootstrap", "--scan-only", target]);
      expect(code).toBe(0);
      expect(stdout).toContain("bootstrap scan:");
      expect(stdout).toContain("would create:");
      expect(existsSync(join(target, ".operon"))).toBe(false);
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });

  it("doctor subcommand still lists runtime adapters", async () => {
    const { stdout, code } = await runCli(["doctor"]);
    expect(code).toBe(0);
    expect(stdout).toContain("runtime adapters:");
  });

  it("loop is a documented stub that exits 1", async () => {
    const { stderr, code } = await runCli(["loop"]);
    expect(code).toBe(1);
    expect(stderr).toContain("not implemented yet");
  });
});
