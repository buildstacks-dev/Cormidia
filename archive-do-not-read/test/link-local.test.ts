import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const PACKAGE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const LINK_SCRIPT = join(PACKAGE_ROOT, "scripts", "link-local.mjs");
const CURRENT_LAUNCHER = join(PACKAGE_ROOT, "src", "operon-local.cjs");
const LEGACY_LAUNCHER = join(PACKAGE_ROOT, "scripts", "operon-local.mjs");

describe("source-backed local link installation", () => {
  const temporaryRoots: string[] = [];

  afterEach(() => {
    for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("creates a fresh install and leaves every exact current link untouched on rerun", () => {
    const fixture = createFixture("current");

    const first = runLink(fixture);
    expect(first.status).toBe(0);
    expect(resolveLink(fixture.binaryTarget)).toBe(CURRENT_LAUNCHER);
    for (const skillTarget of fixture.skillTargets) expect(resolveLink(skillTarget)).toBe(fixture.skillSource);

    const identities = [fixture.binaryTarget, ...fixture.skillTargets].map(linkIdentity);
    const second = runLink(fixture);

    expect(second.status).toBe(0);
    expect([fixture.binaryTarget, ...fixture.skillTargets].map(linkIdentity)).toEqual(identities);
  });

  it("atomically migrates the exact absolute legacy launcher link from this checkout", () => {
    const fixture = createFixture("legacy-absolute");
    mkdirSync(dirname(fixture.binaryTarget), { recursive: true });
    symlinkSync(LEGACY_LAUNCHER, fixture.binaryTarget);

    const result = runLink(fixture);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("binary link migrated from the legacy same-checkout launcher");
    expect(resolveLink(fixture.binaryTarget)).toBe(CURRENT_LAUNCHER);
    expect(readdirSync(dirname(fixture.binaryTarget))).toEqual(["operon"]);
  });

  it("migrates an equivalent relative legacy launcher link from this checkout", () => {
    const fixture = createFixture("legacy-relative");
    mkdirSync(dirname(fixture.binaryTarget), { recursive: true });
    symlinkSync(relative(dirname(fixture.binaryTarget), LEGACY_LAUNCHER), fixture.binaryTarget);

    const result = runLink(fixture);

    expect(result.status).toBe(0);
    expect(resolveLink(fixture.binaryTarget)).toBe(CURRENT_LAUNCHER);
    expect(readdirSync(dirname(fixture.binaryTarget))).toEqual(["operon"]);
  });

  it("refuses a legacy-looking link owned by another checkout without linking skills", () => {
    const fixture = createFixture("foreign");
    const foreignLauncher = join(fixture.root, "other-checkout", "scripts", "operon-local.mjs");
    mkdirSync(dirname(foreignLauncher), { recursive: true });
    writeFileSync(foreignLauncher, "foreign launcher\n", "utf8");
    mkdirSync(dirname(fixture.binaryTarget), { recursive: true });
    const foreignRelativeLink = relative(dirname(fixture.binaryTarget), foreignLauncher);
    symlinkSync(foreignRelativeLink, fixture.binaryTarget);

    const result = runLink(fixture);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`refusing to replace existing path: ${fixture.binaryTarget}`);
    expect(readlinkSync(fixture.binaryTarget)).toBe(foreignRelativeLink);
    expect(readFileSync(foreignLauncher, "utf8")).toBe("foreign launcher\n");
    expect(readdirSync(dirname(fixture.binaryTarget))).toEqual(["operon"]);
    for (const skillTarget of fixture.skillTargets) expect(existsSync(skillTarget)).toBe(false);
  });

  it("refuses a real file without changing it or linking skills", () => {
    const fixture = createFixture("file");
    mkdirSync(dirname(fixture.binaryTarget), { recursive: true });
    writeFileSync(fixture.binaryTarget, "keep me\n", "utf8");

    const result = runLink(fixture);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`refusing to replace existing path: ${fixture.binaryTarget}`);
    expect(readFileSync(fixture.binaryTarget, "utf8")).toBe("keep me\n");
    for (const skillTarget of fixture.skillTargets) expect(existsSync(skillTarget)).toBe(false);
  });

  it("refuses a directory without changing its contents or linking skills", () => {
    const fixture = createFixture("directory");
    mkdirSync(fixture.binaryTarget, { recursive: true });
    writeFileSync(join(fixture.binaryTarget, "sentinel"), "keep me\n", "utf8");

    const result = runLink(fixture);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`refusing to replace existing path: ${fixture.binaryTarget}`);
    expect(readFileSync(join(fixture.binaryTarget, "sentinel"), "utf8")).toBe("keep me\n");
    for (const skillTarget of fixture.skillTargets) expect(existsSync(skillTarget)).toBe(false);
  });

  function createFixture(name: string) {
    const root = mkdtempSync(join(tmpdir(), `operon-link-${name}-`));
    temporaryRoots.push(root);
    const binDir = join(root, "bin");
    const homes = {
      codex: join(root, "codex"),
      claude: join(root, "claude"),
      pi: join(root, "pi"),
    };
    return {
      root,
      binDir,
      binaryTarget: join(binDir, "operon"),
      skillSource: join(PACKAGE_ROOT, "agent-skills", "operon"),
      skillTargets: [
        join(homes.codex, "skills", "operon"),
        join(homes.claude, "skills", "operon"),
        join(homes.pi, "skills", "operon"),
      ],
      env: {
        ...process.env,
        HOME: join(root, "home"),
        OPERON_BIN_DIR: binDir,
        CODEX_HOME: homes.codex,
        CLAUDE_CONFIG_DIR: homes.claude,
        PI_CODING_AGENT_DIR: homes.pi,
      },
    };
  }
});

function runLink(fixture: { env: NodeJS.ProcessEnv }) {
  return spawnSync(process.execPath, [LINK_SCRIPT], {
    cwd: PACKAGE_ROOT,
    env: fixture.env,
    encoding: "utf8",
  });
}

function resolveLink(target: string): string {
  return resolve(dirname(target), readlinkSync(target));
}

function linkIdentity(target: string): { dev: number; ino: number; rawLink: string } {
  const info = lstatSync(target);
  return { dev: info.dev, ino: info.ino, rawLink: readlinkSync(target) };
}
