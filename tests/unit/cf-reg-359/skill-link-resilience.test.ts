// CF-REG-359-C — a single unusable provider target must not cost the others.
//
// Observed: `link-skills.mjs` linked six targets in one loop and let the first
// refusal propagate, so an operator with their OWN directory at
// `~/.codex/skills/cormidia` — an ordinary thing to have — got zero skills
// installed. Claude and pi were never attempted. On the published path
// (`npm install -g cormidia`) that is the whole skill install failing for a
// reason affecting one sixth of it.
//
// Partial success is the correct outcome here: refuse the path Cormidia does
// not own, link everything else, report specifically, exit non-zero. The
// refusal itself is NOT relaxed — that guard is contract B-14 §2 and stays
// exactly as strict.
//
// Binaries keep the opposite rule (fail-fast, nothing partial) and that
// asymmetry is pinned in tests/hermetic/cf-b14-cf-c-b14-cf-reg-359/cf-b14-link-ownership.test.ts.

import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { linkPackagedSkills } from "../../../scripts/lib/link-artifacts.mjs";

describe("CF-REG-359-C — skill linking survives one unusable target", () => {
  let roots: string[] = [];

  afterEach(async () => {
    for (const root of roots) await rm(root, { recursive: true, force: true });
    roots = [];
  });

  async function sandbox({ withSkills = true } = {}) {
    const root = await mkdtemp(join(tmpdir(), "cormidia-cf-reg-359c-"));
    roots.push(root);
    const packageRoot = join(root, "installed");
    if (withSkills) {
      for (const skill of ["cormidia", "cormidia-job"]) {
        await mkdir(join(packageRoot, "agent-skills", skill), { recursive: true });
      }
    }
    const env = {
      CODEX_HOME: join(root, "codex"),
      CLAUDE_CONFIG_DIR: join(root, "claude"),
      PI_CODING_AGENT_DIR: join(root, "pi"),
    } as NodeJS.ProcessEnv;
    return { root, packageRoot, env };
  }

  it("baseline: a clean machine links all six targets and creates provider homes that do not exist yet", async () => {
    const { packageRoot, env } = await sandbox();
    const { linked, refused } = await linkPackagedSkills(packageRoot, env);

    expect(refused).toEqual([]);
    expect(linked).toHaveLength(6);
    for (const row of linked) expect(await readlink(row.target)).toBe(row.source);
  });

  it("an operator's OWN directory at one target is refused, and the other five still link", async () => {
    const { root, packageRoot, env } = await sandbox();
    // SEEDED: a real directory with the operator's content, at the first
    // target the loop reaches. Pre-fix this aborted the entire run.
    const occupied = join(root, "codex", "skills", "cormidia");
    await mkdir(occupied, { recursive: true });
    await writeFile(join(occupied, "SKILL.md"), "the operator's own skill\n", "utf8");

    const { linked, refused } = await linkPackagedSkills(packageRoot, env);

    expect(linked).toHaveLength(5);
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ skill: "cormidia", provider: "Codex" });
    expect(refused[0]?.reason).toMatch(/refusing to replace existing path/);

    // Untouched: the operator's bytes survive, still a real directory.
    expect(await readlink(join(root, "claude", "skills", "cormidia"))).toBe(
      join(packageRoot, "agent-skills", "cormidia"),
    );
    expect(await readlink(join(root, "pi", "skills", "cormidia-job"))).toBe(
      join(packageRoot, "agent-skills", "cormidia-job"),
    );
    expect(existsSync(join(occupied, "SKILL.md"))).toBe(true);
  });

  it("a mis-packed install never produces dangling links — a missing source refuses instead of linking to nothing", async () => {
    // A skill that exists and cannot load is worse than one that is absent:
    // the agent routes to it and then fails.
    const { packageRoot, env } = await sandbox({ withSkills: false });
    const { linked, refused } = await linkPackagedSkills(packageRoot, env);

    expect(linked).toEqual([]);
    expect(refused).toHaveLength(6);
    for (const row of refused) expect(row.reason).toMatch(/packaged skill directory is missing/);
  });

  it("re-running over links this package already owns is a clean no-op — upgrades do not churn", async () => {
    const { packageRoot, env } = await sandbox();
    await linkPackagedSkills(packageRoot, env);

    const { linked, refused } = await linkPackagedSkills(packageRoot, env);
    expect(refused).toEqual([]);
    expect(linked.every((row) => row.action === "current")).toBe(true);
  });

  it("a dangling link left by a deleted install is adopted, not refused — the uninstall/reinstall path", async () => {
    const { root, packageRoot, env } = await sandbox();
    const deletedInstall = join(root, "gone", "lib", "node_modules", "cormidia", "agent-skills", "cormidia");
    await mkdir(join(root, "codex", "skills"), { recursive: true });
    await symlink(deletedInstall, join(root, "codex", "skills", "cormidia"), "dir");

    const { linked, refused } = await linkPackagedSkills(packageRoot, env);
    expect(refused).toEqual([]);
    expect(await readlink(join(root, "codex", "skills", "cormidia"))).toBe(
      join(packageRoot, "agent-skills", "cormidia"),
    );
    expect(linked).toHaveLength(6);
  });
});
