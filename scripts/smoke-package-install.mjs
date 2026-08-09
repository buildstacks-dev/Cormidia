#!/usr/bin/env node
import { execFile as execFileCallback } from "node:child_process";
import { access, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
const execFile = promisify(execFileCallback);
async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--") args.shift();
  const raw = args[0];
  if (args.length !== 1 || raw === undefined || !isAbsolute(raw))
    throw new Error("package install smoke requires one absolute tarball path");
  const tarball = resolve(raw);
  const root = await mkdtemp(join(tmpdir(), "cormidia-package-smoke-"));
  const globalPrefix = join(root, "global-prefix");
  const installedRoot = join(globalPrefix, "lib", "node_modules", "cormidia");
  const linkEnv = {
    ...process.env,
    CODEX_HOME: join(root, "codex"),
    CLAUDE_CONFIG_DIR: join(root, "claude"),
    PI_CODING_AGENT_DIR: join(root, "pi"),
  };
  try {
    await execFile(
      "npm",
      ["install", "-g", "--prefix", globalPrefix, "--ignore-scripts", "--no-audit", "--no-fund", tarball],
      {
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
      },
    );
    const packageJson = JSON.parse(await readFile(join(installedRoot, "package.json"), "utf8"));
    await access(join(installedRoot, "dist", "runtime", "testing", "fakeRuntime.js"));
    try {
      await access(join(installedRoot, "dist", "org", "scheduler", "virtual-soak.js"));
      throw new Error("packed cormidia still contains the removed virtual scheduler soak module");
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    for (const binary of Object.keys(packageJson.bin ?? {})) await access(join(globalPrefix, "bin", binary));
    const version = await execFile(join(globalPrefix, "bin", "cormidia"), ["--version"], { encoding: "utf8" });
    if (version.stdout.trim() !== packageJson.version)
      throw new Error("installed cormidia --version does not match packed package.json");
    const job = await execFile(join(globalPrefix, "bin", "cormidia-job"), ["--help"], { encoding: "utf8" });
    if (!job.stdout.includes("cormidia-job"))
      throw new Error("installed cormidia-job --help did not render its own usage");
    const linker = join(installedRoot, "scripts", "link-skills.mjs");
    await execFile(process.execPath, [linker, "--dry-run"], { env: linkEnv, encoding: "utf8" });
    await execFile(process.execPath, [linker], { env: linkEnv, encoding: "utf8" });
    await execFile(
      "npm",
      ["install", "-g", "--prefix", globalPrefix, "--ignore-scripts", "--no-audit", "--no-fund", tarball],
      {
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
      },
    );
    await execFile(process.execPath, [linker], { env: linkEnv, encoding: "utf8" });
    for (const [home, provider] of [
      [linkEnv.CODEX_HOME, "Codex"],
      [linkEnv.CLAUDE_CONFIG_DIR, "Claude"],
      [linkEnv.PI_CODING_AGENT_DIR, "pi"],
    ]) {
      for (const skill of ["cormidia", "cormidia-job"]) {
        const target = join(home, "skills", skill);
        const expected = await realpath(join(installedRoot, "agent-skills", skill));
        if ((await realpath(target)) !== expected)
          throw new Error(`${provider} $${skill} did not resolve into the npm-global package`);
      }
    }
    for (const relative of [
      "scripts/link-skills.mjs",
      "scripts/lib/install-ownership.mjs",
      "scripts/lib/install-transaction.mjs",
      "scripts/lib/link-artifacts.mjs",
    ])
      await access(join(installedRoot, relative));
    process.stdout.write(
      `npm-global package smoke passed twice: cormidia@${packageJson.version} ` +
        `(bins: ${Object.keys(packageJson.bin ?? {}).join(", ")}; skills: 6)\n`,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
