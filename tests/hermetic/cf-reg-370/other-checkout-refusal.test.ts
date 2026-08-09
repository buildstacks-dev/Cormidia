// CF-REG-370 — --replace-source-links is consent for the invoking checkout,
// not permission to dismantle another Cormidia development loop.

import { spawnSync } from "node:child_process";
import { delimiter, dirname, join } from "node:path";
import { lstat, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const installer = join(repoRoot, "scripts", "install-packaged.mjs");
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("CF-REG-370 — other-checkout source ownership", () => {
  it("refuses every verified other-checkout link before mutation even with explicit replacement consent", async () => {
    const root = await mkdtemp(join(tmpdir(), "cormidia-cf-reg-370-other-checkout-"));
    roots.push(root);
    const prefix = join(root, "prefix");
    const bin = join(prefix, "bin");
    const other = join(root, "older-cormidia-checkout");
    const homes = { codex: join(root, "codex"), claude: join(root, "claude"), pi: join(root, "pi") };
    await mkdir(join(other, "src"), { recursive: true });
    for (const skill of ["cormidia", "cormidia-job"]) {
      await mkdir(join(other, "agent-skills", skill), { recursive: true });
    }
    await writeFile(
      join(other, "package.json"),
      `${JSON.stringify({
        name: "cormidia",
        version: "0.0.9",
        bin: { cormidia: "./src/cormidia.cjs", "cormidia-job": "./src/cormidia-job.cjs" },
      })}\n`,
    );
    for (const launcher of ["cormidia-local.cjs", "cormidia-job-local.cjs"]) {
      await writeFile(join(other, "src", launcher), "source launcher\n");
    }
    await mkdir(bin, { recursive: true });
    const targets: Array<readonly [string, string]> = [
      [join(bin, "cormidia"), join(other, "src", "cormidia-local.cjs")],
      [join(bin, "cormidia-job"), join(other, "src", "cormidia-job-local.cjs")],
    ];
    for (const home of Object.values(homes)) {
      for (const skill of ["cormidia", "cormidia-job"]) {
        targets.push([join(home, "skills", skill), join(other, "agent-skills", skill)]);
      }
    }
    for (const [target, source] of targets) {
      await mkdir(dirname(target), { recursive: true });
      await symlink(source, target);
    }
    const before = new Map(await Promise.all(targets.map(async ([path]) => [path, await readlink(path)] as const)));

    const result = spawnSync(process.execPath, [installer, "--dry-run", "--replace-source-links"], {
      encoding: "utf8",
      env: {
        ...process.env,
        npm_config_prefix: prefix,
        CODEX_HOME: homes.codex,
        CLAUDE_CONFIG_DIR: homes.claude,
        PI_CODING_AGENT_DIR: homes.pi,
        PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
      },
    });
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).not.toBe(0);
    expect(output).toContain("foreign collision(s) found before mutation (8)");
    expect(output.match(/verified other Cormidia source checkout cormidia@0\.0\.9/g)).toHaveLength(8);
    expect(output).toContain("ownership is checkout-scoped because this may be another active dev loop");
    for (const [path] of targets) {
      expect(output).toContain(`path: ${path}`);
      expect(output).toContain(`mv -- '${path}' '${path}.before-cormidia'`);
      expect(await readlink(path)).toBe(before.get(path));
    }
    await expect(lstat(join(prefix, "lib", "node_modules", "cormidia"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(other, "package.json"), "utf8")).toContain('"version":"0.0.9"');
  });
});
