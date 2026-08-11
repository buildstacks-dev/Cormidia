// Traceability: CF-REG-370 · HB-139 · case-catalog.md §10.3.

// CF-REG-370 — an existing Cormidia install must converge as one owned set.
// Every command below redirects npm's global prefix and all provider homes to
// one temp root. The host's actual global package, bins, and skills are never
// read or changed.

import { execFile as execFileCallback, spawnSync } from "node:child_process";
import { delimiter, join } from "node:path";
import { chmod, lstat, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { transactionalReplace } from "../../../scripts/lib/install-transaction.mjs";

const execFile = promisify(execFileCallback);
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const installer = join(repoRoot, "scripts", "install-packaged.mjs");
const linkLocal = join(repoRoot, "scripts", "link-local.mjs");
const linkSkills = join(repoRoot, "scripts", "link-skills.mjs");
const cleanups: string[] = [];

interface Sandbox {
  root: string;
  prefix: string;
  installedRoot: string;
  binDir: string;
  env: NodeJS.ProcessEnv;
  skill(provider: "codex" | "claude" | "pi", name: "cormidia" | "cormidia-job"): string;
}

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function sandbox(): Promise<Sandbox> {
  const root = await mkdtemp(join(tmpdir(), "cormidia-cf-reg-370-"));
  cleanups.push(root);
  const prefix = join(root, "prefix");
  const binDir = join(prefix, "bin");
  const homes = {
    codex: join(root, "codex"),
    claude: join(root, "claude"),
    pi: join(root, "pi"),
  };
  return {
    root,
    prefix,
    installedRoot: join(prefix, "lib", "node_modules", "cormidia"),
    binDir,
    env: {
      ...process.env,
      npm_config_prefix: prefix,
      CODEX_HOME: homes.codex,
      CLAUDE_CONFIG_DIR: homes.claude,
      PI_CODING_AGENT_DIR: homes.pi,
      PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
    },
    skill: (provider, name) => join(homes[provider], "skills", name),
  };
}

async function fixtureTarball(root: string, version: string): Promise<string> {
  const source = join(root, `fixture-${version}`);
  const destination = join(root, "tarballs");
  await mkdir(join(source, "src"), { recursive: true });
  await mkdir(join(source, "agent-skills", "cormidia"), { recursive: true });
  await mkdir(join(source, "agent-skills", "cormidia-job"), { recursive: true });
  await mkdir(destination, { recursive: true });
  await writeFile(
    join(source, "package.json"),
    `${JSON.stringify(
      {
        name: "cormidia",
        version,
        type: "module",
        bin: { cormidia: "./src/cormidia.cjs", "cormidia-job": "./src/cormidia-job.cjs" },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    join(source, "src", "cormidia.cjs"),
    `#!/usr/bin/env node\n` +
      `const { existsSync, writeFileSync } = require("node:fs");\n` +
      `const marker = process.env.CORMIDIA_TEST_FAIL_SECOND_RUN;\n` +
      `if (marker && existsSync(marker)) process.exit(23);\n` +
      `if (marker) writeFileSync(marker, "staged\\n");\n` +
      `console.log(${JSON.stringify(version)});\n`,
  );
  await writeFile(
    join(source, "src", "cormidia-job.cjs"),
    `#!/usr/bin/env node\nconsole.log(process.argv.includes("--help") ? "cormidia-job ${version}" : ${JSON.stringify(version)});\n`,
  );
  await chmod(join(source, "src", "cormidia.cjs"), 0o755);
  await chmod(join(source, "src", "cormidia-job.cjs"), 0o755);
  await writeFile(join(source, "agent-skills", "cormidia", "SKILL.md"), `name: cormidia-${version}\n`);
  await writeFile(join(source, "agent-skills", "cormidia-job", "SKILL.md"), `name: cormidia-job-${version}\n`);
  const packed = await execFile("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", destination], {
    cwd: source,
    encoding: "utf8",
  });
  const rows = JSON.parse(packed.stdout) as Array<{ filename: string }>;
  const filename = rows[0]?.filename;
  if (filename === undefined) throw new Error("fixture npm pack produced no tarball");
  return join(destination, filename);
}

function runInstaller(target: Sandbox, tarball: string, flags: string[] = [], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [installer, "--tarball", tarball, ...flags], {
    env: { ...target.env, ...env },
    encoding: "utf8",
    timeout: 30_000,
  });
}

async function expectPackaged(target: Sandbox, version: string): Promise<void> {
  const pkg = JSON.parse(await readFile(join(target.installedRoot, "package.json"), "utf8")) as { version: string };
  expect(pkg.version).toBe(version);
  expect((await execFile(join(target.binDir, "cormidia"), ["--version"])).stdout.trim()).toBe(version);
  expect((await execFile(join(target.binDir, "cormidia-job"), ["--help"])).stdout).toContain("cormidia-job");
  for (const provider of ["codex", "claude", "pi"] as const) {
    for (const skill of ["cormidia", "cormidia-job"] as const) {
      expect(await readlink(target.skill(provider, skill))).toBe(join(target.installedRoot, "agent-skills", skill));
    }
  }
}

describe("CF-REG-370 — packaged install ownership", () => {
  it("uses real npm-global staging for clean install, packaged upgrade, and same-version reinstall", async () => {
    const target = await sandbox();
    const oldTarball = await fixtureTarball(target.root, "0.1.0");
    const currentTarball = await fixtureTarball(target.root, "0.1.1");

    const clean = runInstaller(target, oldTarball);
    expect(clean.status, clean.stderr).toBe(0);
    await expectPackaged(target, "0.1.0");
    await writeFile(join(target.prefix, "operator-sentinel"), "human bytes\n", "utf8");

    const upgrade = runInstaller(target, currentTarball);
    expect(upgrade.status, upgrade.stderr).toBe(0);
    expect(upgrade.stdout).toContain("packaged upgrade: cormidia@0.1.0 -> cormidia@0.1.1");
    await expectPackaged(target, "0.1.1");
    expect(await readFile(join(target.prefix, "operator-sentinel"), "utf8")).toBe("human bytes\n");

    const reinstall = runInstaller(target, currentTarball);
    expect(reinstall.status, reinstall.stderr).toBe(0);
    expect(reinstall.stdout).toContain("same-version reinstall: cormidia@0.1.1");
    await expectPackaged(target, "0.1.1");
  });

  it("requires explicit consent before replacing one complete source-backed install", async () => {
    const target = await sandbox();
    const tarball = await fixtureTarball(target.root, "0.1.1");
    const linked = spawnSync(process.execPath, [linkLocal], {
      env: { ...target.env, CORMIDIA_BIN_DIR: target.binDir },
    });
    expect(linked.status).toBe(0);
    const sourceBinary = await readlink(join(target.binDir, "cormidia"));

    const refused = runInstaller(target, tarball);
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toContain("--replace-source-links");
    expect(await readlink(join(target.binDir, "cormidia"))).toBe(sourceBinary);
    expect(await readlink(target.skill("pi", "cormidia-job"))).toContain(repoRoot);

    const replaced = runInstaller(target, tarball, ["--replace-source-links"]);
    expect(replaced.status, replaced.stderr).toBe(0);
    await expectPackaged(target, "0.1.1");
  });

  it("reports every foreign collision with ownership evidence and exact move-aside remediation before mutation", async () => {
    const target = await sandbox();
    const tarball = await fixtureTarball(target.root, "0.1.1");
    const foreignSkill = join(target.root, "foreign-skill");
    await mkdir(target.binDir, { recursive: true });
    await mkdir(join(target.root, "codex", "skills"), { recursive: true });
    await mkdir(join(target.root, "claude", "skills"), { recursive: true });
    await mkdir(foreignSkill, { recursive: true });
    await writeFile(join(target.binDir, "cormidia"), "operator binary\n", "utf8");
    await symlink(foreignSkill, target.skill("codex", "cormidia"), "dir");
    await writeFile(target.skill("claude", "cormidia-job"), "operator skill\n", "utf8");

    const result = runInstaller(target, tarball);
    const output = `${result.stdout}${result.stderr}`;
    expect(result.status).not.toBe(0);
    for (const path of [
      join(target.binDir, "cormidia"),
      target.skill("codex", "cormidia"),
      target.skill("claude", "cormidia-job"),
    ]) {
      expect(output).toContain(`path: ${path}`);
      expect(output).toMatch(new RegExp(`evidence: [^\\n]*${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}|path:`));
      expect(output).toContain(`mv -- '${path}' '${path}.before-cormidia'`);
    }
    expect(await readFile(join(target.binDir, "cormidia"), "utf8")).toBe("operator binary\n");
    expect(await readlink(target.skill("codex", "cormidia"))).toBe(foreignSkill);
    expect(await readFile(target.skill("claude", "cormidia-job"), "utf8")).toBe("operator skill\n");
    await expect(lstat(target.installedRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("negative control: a failed multi-path promotion restores the complete prior generation", async () => {
    const target = await sandbox();
    const a = join(target.root, "a");
    const b = join(target.root, "b");
    await symlink("old-a", a);
    await symlink("old-b", b);

    await expect(
      transactionalReplace([a, b], async ({ promoteSymlink }) => {
        await promoteSymlink("new-a", a, "file");
        throw new Error("seeded promotion failure");
      }),
    ).rejects.toThrow("seeded promotion failure");
    expect(await readlink(a)).toBe("old-a");
    expect(await readlink(b)).toBe("old-b");
  });

  it("negative control: failed installed verification restores the complete source generation", async () => {
    const target = await sandbox();
    const tarball = await fixtureTarball(target.root, "0.1.1");
    const linked = spawnSync(process.execPath, [linkLocal], {
      env: { ...target.env, CORMIDIA_BIN_DIR: target.binDir },
    });
    expect(linked.status).toBe(0);
    const sourceTargets = [
      join(target.binDir, "cormidia"),
      join(target.binDir, "cormidia-job"),
      ...(["codex", "claude", "pi"] as const).flatMap((provider) =>
        (["cormidia", "cormidia-job"] as const).map((skill) => target.skill(provider, skill)),
      ),
    ];
    const before = new Map(await Promise.all(sourceTargets.map(async (path) => [path, await readlink(path)] as const)));
    const failed = runInstaller(target, tarball, ["--replace-source-links"], {
      CORMIDIA_TEST_FAIL_SECOND_RUN: join(target.root, "staged-version-ran"),
    });

    expect(failed.status).not.toBe(0);
    for (const path of sourceTargets) expect(await readlink(path)).toBe(before.get(path));
    await expect(lstat(target.installedRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("negative control: target drift after preflight is preserved and rejected before mutation", async () => {
    const target = await sandbox();
    const path = join(target.root, "owned-link");
    await symlink("owned-before-preflight", path);
    const info = await lstat(path);
    const expected = {
      target: path,
      entry: { type: "symlink", dev: info.dev, ino: info.ino, rawLink: await readlink(path) },
    };
    await rm(path);
    await symlink("foreign-after-preflight", path);
    let applied = false;

    await expect(
      transactionalReplace([expected], async () => {
        applied = true;
      }),
    ).rejects.toThrow("install target changed after preflight");
    expect(applied).toBe(false);
    expect(await readlink(path)).toBe("foreign-after-preflight");
  });

  it("the shipped npm skill step aggregates foreign collisions before linking any provider", async () => {
    const target = await sandbox();
    const codex = target.skill("codex", "cormidia");
    const pi = target.skill("pi", "cormidia-job");
    await mkdir(join(target.root, "codex", "skills"), { recursive: true });
    await mkdir(join(target.root, "pi", "skills"), { recursive: true });
    await writeFile(codex, "operator codex skill\n", "utf8");
    await writeFile(pi, "operator pi skill\n", "utf8");

    const result = spawnSync(process.execPath, [linkSkills], { env: target.env, encoding: "utf8" });
    const output = `${result.stdout}${result.stderr}`;
    expect(result.status).not.toBe(0);
    expect(output).toContain(`path: ${codex}`);
    expect(output).toContain(`path: ${pi}`);
    expect(output).toContain(`mv -- '${codex}' '${codex}.before-cormidia'`);
    expect(output).toContain(`mv -- '${pi}' '${pi}.before-cormidia'`);
    expect(await readFile(codex, "utf8")).toBe("operator codex skill\n");
    expect(await readFile(pi, "utf8")).toBe("operator pi skill\n");
    await expect(lstat(target.skill("claude", "cormidia"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
