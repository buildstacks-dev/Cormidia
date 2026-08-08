import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CANONICAL_LABELS } from "../../../src/loop/plan-tickets.js";
import { campaignGitEnvironment } from "../../campaign/acceptance/campaign-git.js";
import {
  canonicalLabelCommands,
  installCanonicalLabels,
  reusePreparedGreenfieldRepository,
} from "../../campaign/acceptance/campaign-scenario-setup.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

describe("CF-B27-PROVISION — authenticated, resumable pre-baseline push", () => {
  it("negative control: keeps the configured gh credential helper visible to Git", () => {
    const env = campaignGitEnvironment({ GIT_CONFIG_GLOBAL: "/fixture/gh-credentials", PATH: "/usr/bin" });
    expect(env.GIT_CONFIG_GLOBAL).toBe("/fixture/gh-credentials");
    expect(env.GIT_TERMINAL_PROMPT).toBe("0");
    expect(env.GIT_CONFIG_NOSYSTEM).toBe("1");
  });

  it("resumes only an exact clean campaign-authored greenfield baseline", async () => {
    const root = await mkdtemp(join(tmpdir(), "l-acc-greenfield-resume-"));
    roots.push(root);
    git(root, ["init", "--initial-branch", "campaign-baseline"]);
    git(root, ["config", "user.name", "cormidia-campaign-provision"]);
    git(root, ["config", "user.email", "provision@cormidia.invalid"]);
    git(root, ["remote", "add", "origin", "https://github.com/cormidia/example.git"]);
    await writeFile(join(root, "README.md"), "prepared\n", "utf8");
    git(root, ["add", "-A"]);
    git(root, ["commit", "--no-gpg-sign", "-m", "provision: baseline S-ACC-1"]);

    expect(reusePreparedGreenfieldRepository(root, "S-ACC-1", "cormidia/example")).toBe(true);
    await writeFile(join(root, "README.md"), "supervisor edit\n", "utf8");
    expect(() => reusePreparedGreenfieldRepository(root, "S-ACC-1", "cormidia/example")).toThrow(/is dirty/);
  });

  it("installs every exact canonical label idempotently in the bounded GitHub provisioning step", () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    installCanonicalLabels("cormidia/example", (command, args) => calls.push({ command, args }));
    expect(calls).toHaveLength(CANONICAL_LABELS.length);
    expect(calls.map((call) => call.args[2])).toEqual(CANONICAL_LABELS.map((label) => label.name));
    expect(calls.every((call) => call.command === "gh" && call.args.includes("--force"))).toBe(true);
    expect(canonicalLabelCommands("cormidia/example").every((args) => args.at(-1) === "cormidia/example")).toBe(true);
  });
});
