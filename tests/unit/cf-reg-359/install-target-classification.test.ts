// CF-REG-359-B — HB-139 — the packaged installer must classify a checkout-owned SKILL
// link as replaceable, not foreign.
//
// Observed failure: `install-packaged.mjs --replace-source-links` cleared the
// shadowing BINARY link, ran the global npm install, then handed skills to the
// shipped `link-skills.mjs`, whose guard correctly refuses anything the package
// does not own. A skill link left by `pnpm link:local` therefore aborted the
// run AFTER two irreversible steps had already happened, stranding the operator
// with packaged binaries and source-backed skills.
//
// Two things were wrong and both are pinned here:
//   1. skill targets were never classified at all (only binaries were);
//   2. classification ran interleaved with mutation, so a refusal could land
//      after the install rather than before it.
//
// `classifyInstallTarget` is the seam: it answers "what is at this path" without
// touching it, which is what lets the shipped linker refuse and the dev
// installer adopt off one rule.

import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyInstallTarget, packagedSkillTargets } from "../../../scripts/lib/link-artifacts.mjs";

describe("CF-REG-359-B — install-target classification precedes mutation", () => {
  let roots: string[] = [];

  afterEach(async () => {
    for (const root of roots) await rm(root, { recursive: true, force: true });
    roots = [];
  });

  async function sandbox() {
    const root = await mkdtemp(join(tmpdir(), "cormidia-cf-reg-359b-"));
    roots.push(root);
    const checkout = join(root, "checkout");
    const installed = join(root, "global", "cormidia");
    const home = join(root, "provider", "skills");
    await mkdir(join(checkout, "agent-skills", "cormidia"), { recursive: true });
    await mkdir(join(installed, "agent-skills", "cormidia"), { recursive: true });
    await mkdir(home, { recursive: true });
    return { root, checkout, installed, target: join(home, "cormidia") };
  }

  it("a link:local skill link is 'checkout' — the state the installer is allowed to replace", async () => {
    const { checkout, installed, target } = await sandbox();
    await symlink(join(checkout, "agent-skills", "cormidia"), target, "dir");

    expect(
      await classifyInstallTarget(target, {
        intendedSource: join(installed, "agent-skills", "cormidia"),
        packageRoot: checkout,
      }),
    ).toBe("checkout");
  });

  it("an already-packaged link is 'current' — re-running must not churn it", async () => {
    const { checkout, installed, target } = await sandbox();
    await symlink(join(installed, "agent-skills", "cormidia"), target, "dir");

    expect(
      await classifyInstallTarget(target, {
        intendedSource: join(installed, "agent-skills", "cormidia"),
        packageRoot: checkout,
      }),
    ).toBe("current");
  });

  it("absent targets are 'absent', and a link owned by neither side stays 'foreign'", async () => {
    const { root, checkout, installed, target } = await sandbox();
    const intendedSource = join(installed, "agent-skills", "cormidia");
    expect(await classifyInstallTarget(target, { intendedSource, packageRoot: checkout })).toBe("absent");

    const otherCheckout = join(root, "someone-elses-checkout", "agent-skills", "cormidia");
    await mkdir(otherCheckout, { recursive: true });
    await symlink(otherCheckout, target, "dir");
    expect(await classifyInstallTarget(target, { intendedSource, packageRoot: checkout })).toBe("foreign");
  });

  it("a link into ANOTHER npm prefix's Cormidia install is 'prior-install' — the node-version-change case", async () => {
    // Changing node (nvm <-> homebrew) moves the npm prefix, stranding every
    // skill link at the old root. Refusing these leaves a real user with no
    // path forward but manual rm, so they are this package's to re-point.
    const { root, checkout, installed, target } = await sandbox();
    const oldPrefix = join(root, "old-prefix", "lib", "node_modules", "cormidia", "agent-skills", "cormidia");
    await mkdir(oldPrefix, { recursive: true });
    await symlink(oldPrefix, target, "dir");

    expect(
      await classifyInstallTarget(target, {
        intendedSource: join(installed, "agent-skills", "cormidia"),
        packageRoot: checkout,
      }),
    ).toBe("prior-install");
  });

  it("adoption is narrowed to the SAME skill name — a different skill's install directory stays foreign", async () => {
    const { root, checkout, installed, target } = await sandbox();
    const wrongSkill = join(root, "old-prefix", "lib", "node_modules", "cormidia", "agent-skills", "cormidia-job");
    await mkdir(wrongSkill, { recursive: true });
    await symlink(wrongSkill, target, "dir");

    expect(
      await classifyInstallTarget(target, {
        intendedSource: join(installed, "agent-skills", "cormidia"),
        packageRoot: checkout,
      }),
    ).toBe("foreign");
  });

  it("negative control: a REAL directory or file at the target is never adoptable", async () => {
    // SEEDED VIOLATION: the operator's own directory sits where a skill goes.
    // Classifying this as anything but foreign would let the installer delete
    // human-owned bytes (contract B-14 §2).
    const { checkout, installed, target } = await sandbox();
    const intendedSource = join(installed, "agent-skills", "cormidia");

    await mkdir(target, { recursive: true });
    await writeFile(join(target, "SKILL.md"), "the human's own skill\n", "utf8");
    expect(await classifyInstallTarget(target, { intendedSource, packageRoot: checkout })).toBe("foreign");

    await rm(target, { recursive: true, force: true });
    await writeFile(target, "a real file\n", "utf8");
    expect(await classifyInstallTarget(target, { intendedSource, packageRoot: checkout })).toBe("foreign");
  });

  it("the two self-owned states are distinguishable, because they carry different consent", async () => {
    // `--replace-source-links` means "dismantle my live dev loop", so only a
    // CHECKOUT link may demand it. A `prior-install` link is a dead pointer
    // from an install that no longer exists; link-skills.mjs re-points those
    // unprompted, and install-packaged must not be stricter than the shipped
    // path about the same artifact.
    const { root, checkout, installed, target } = await sandbox();
    const intendedSource = join(installed, "agent-skills", "cormidia");

    await symlink(join(checkout, "agent-skills", "cormidia"), target, "dir");
    expect(await classifyInstallTarget(target, { intendedSource, packageRoot: checkout })).toBe("checkout");

    await rm(target, { force: true });
    const gone = join(root, "deleted-prefix", "lib", "node_modules", "cormidia", "agent-skills", "cormidia");
    await symlink(gone, target, "dir");
    expect(await classifyInstallTarget(target, { intendedSource, packageRoot: checkout })).toBe("prior-install");
  });

  it("the planner enumerates every provider home x packaged skill, so none is discovered mid-install", async () => {
    const { installed } = await sandbox();
    const env = {
      CODEX_HOME: "/tmp/cf-reg-359b/codex",
      CLAUDE_CONFIG_DIR: "/tmp/cf-reg-359b/claude",
      PI_CODING_AGENT_DIR: "/tmp/cf-reg-359b/pi",
    };
    const targets = packagedSkillTargets(installed, env as NodeJS.ProcessEnv);

    // 2 packaged skills x 3 provider homes. The pi home is the one the observed
    // failure died on, so its presence in the PLAN is the regression.
    expect(targets).toHaveLength(6);
    expect(targets.map((row) => row.target)).toContain("/tmp/cf-reg-359b/pi/skills/cormidia");
    expect(targets.map((row) => row.target)).toContain("/tmp/cf-reg-359b/pi/skills/cormidia-job");
    for (const row of targets) expect(row.source.startsWith(installed)).toBe(true);
  });
});
