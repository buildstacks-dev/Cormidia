import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const PACKAGE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const MISSING_CWD_ERROR =
  "operon: cannot resolve the current working directory (it may have been removed) — cd to an existing directory and retry\n";

describe("Operon pre-ESM launchers", () => {
  let root: string;
  let neutral: string;
  let sourceLauncher: string;
  let packagedLauncher: string;
  let sourceEnv: NodeJS.ProcessEnv;
  let goneSequence = 0;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "operon-launcher-"));
    neutral = join(root, "neutral");
    mkdirSync(neutral);

    const sourceBin = join(root, "source-bin");
    sourceEnv = {
      ...process.env,
      HOME: join(root, "home"),
      OPERON_BIN_DIR: sourceBin,
      CODEX_HOME: join(root, "codex"),
      CLAUDE_CONFIG_DIR: join(root, "claude"),
      PI_CODING_AGENT_DIR: join(root, "pi"),
    };
    execFileSync(process.execPath, [join(PACKAGE_ROOT, "scripts/link-local.mjs")], {
      cwd: PACKAGE_ROOT,
      env: sourceEnv,
      stdio: "pipe",
    });
    sourceLauncher = join(sourceBin, "operon");

    // Reproduce npm's installed layout: a PATH entry symlinks to the package's
    // declared bin, which resolves its compiled entry relative to the real file.
    const installRoot = join(root, "installed");
    const installedPackage = join(installRoot, "lib", "node_modules", "operon");
    const installedBin = join(installRoot, "bin");
    mkdirSync(join(installedPackage, "bin"), { recursive: true });
    mkdirSync(join(installedPackage, "dist"), { recursive: true });
    mkdirSync(installedBin, { recursive: true });
    mkdirSync(join(installedPackage, "src"), { recursive: true });
    copyFileSync(join(PACKAGE_ROOT, "src/operon.cjs"), join(installedPackage, "src/operon.cjs"));
    chmodSync(join(installedPackage, "src/operon.cjs"), 0o755);
    writeFileSync(
      join(installedPackage, "dist/cli.js"),
      [
        "const args = process.argv.slice(2);",
        "process.stdout.write(JSON.stringify(args));",
        'if (args.at(-1) === "exit:7") process.exitCode = 7;',
        "",
      ].join("\n"),
      "utf8",
    );
    packagedLauncher = join(installedBin, "operon");
    symlinkSync("../lib/node_modules/operon/src/operon.cjs", packagedLauncher);
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("catches a removed cwd before the source-linked ESM launcher starts", () => {
    const result = invokeAfterRemovingCwd(sourceLauncher, sourceEnv, `source-${goneSequence++}`);
    expectMissingCwdFailure(result);
  });

  it("catches a removed cwd before the packaged ESM CLI starts", () => {
    const result = invokeAfterRemovingCwd(packagedLauncher, process.env, `package-${goneSequence++}`);
    expectMissingCwdFailure(result);
  });

  it("keeps the source-linked command source-backed during normal invocation", () => {
    const result = spawnSync(sourceLauncher, ["--version"], {
      cwd: neutral,
      env: sourceEnv,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("0.1.0\n");
  });

  it("preserves argument bytes and the compiled CLI exit code in packaged layout", () => {
    const args = ["space value", "asterisk*", "$()", "quote'\"", "exit:7"];
    const result = spawnSync(packagedLauncher, args, {
      cwd: neutral,
      encoding: "utf8",
    });
    expect(result.status).toBe(7);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(JSON.stringify(args));
  });

  it("declares executable preflight launchers for package and source-link use", () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as {
      bin: { operon: string };
      files: string[];
    };
    expect(pkg.bin.operon).toBe("./src/operon.cjs");
    expect(pkg.files).toContain("src/operon.cjs");
    expect(pkg.files).toContain("src/operon-local.cjs");
    expect(lstatSync(join(PACKAGE_ROOT, "src/operon.cjs")).mode & 0o111).not.toBe(0);
    expect(lstatSync(join(PACKAGE_ROOT, "src/operon-local.cjs")).mode & 0o111).not.toBe(0);
  });

  function invokeAfterRemovingCwd(launcher: string, env: NodeJS.ProcessEnv, name: string) {
    const gone = join(root, `gone-${name}`);
    mkdirSync(gone);
    return spawnSync(
      "/bin/sh",
      [
        "-c",
        'gone=$1; launcher=$2; shift 2; cd "$gone" || exit 90; rmdir "$gone" || exit 91; exec "$launcher" "$@"',
        "operon-launcher-test",
        gone,
        launcher,
        "--version",
      ],
      { cwd: neutral, env, encoding: "utf8" },
    );
  }
});

function expectMissingCwdFailure(result: ReturnType<typeof spawnSync>): void {
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(result.signal).toBeNull();
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe(MISSING_CWD_ERROR);
  expect(result.stderr).not.toContain("node:");
  expect(result.stderr).not.toContain("Error:");
}
