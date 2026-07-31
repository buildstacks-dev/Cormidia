import { execFileSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const HARNESS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const ARTIFACT_ROOT = resolve(HARNESS_ROOT, ".artifacts");

export interface ControlledWorld {
  id: string;
  root: string;
  stateRoot: string;
  orgRoot: string;
  workdir: string;
  promptsDir: string;
  cleanup(): Promise<void>;
}

export class FakeClock {
  private current: Date;

  constructor(at: string | Date = "2026-01-01T00:00:00.000Z") {
    this.current = new Date(at);
  }

  now = (): Date => new Date(this.current);

  advanceMs(milliseconds: number): Date {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) {
      throw new TypeError("FakeClock advance must be a finite non-negative number");
    }
    this.current = new Date(this.current.getTime() + milliseconds);
    return this.now();
  }
}

export async function createControlledWorld(id: string): Promise<ControlledWorld> {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) {
    throw new Error(`controlled-world id is unsafe: ${id}`);
  }
  const root = resolve(ARTIFACT_ROOT, "tmp", id);
  assertContained(root, resolve(ARTIFACT_ROOT, "tmp"), "controlled-world root");
  await rm(root, { recursive: true, force: true });

  const stateRoot = resolve(root, "state-home");
  const orgRoot = resolve(root, "org-home");
  const workdir = resolve(root, "worktree");
  const promptsDir = resolve(HARNESS_ROOT, "fixtures", "prompts");
  await Promise.all([
    mkdir(stateRoot, { recursive: true }),
    mkdir(orgRoot, { recursive: true }),
    mkdir(workdir, { recursive: true }),
  ]);

  execFileSync("git", ["init", "-q"], { cwd: workdir, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Operon Validation Harness"], {
    cwd: workdir,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "user.email", "validation@example.invalid"], {
    cwd: workdir,
    stdio: "ignore",
  });
  await writeFile(resolve(workdir, "README.md"), "# Controlled Operon world\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd: workdir, stdio: "ignore" });
  execFileSync("git", ["commit", "-q", "-m", "controlled baseline"], {
    cwd: workdir,
    stdio: "ignore",
  });

  return {
    id,
    root,
    stateRoot,
    orgRoot,
    workdir,
    promptsDir,
    async cleanup(): Promise<void> {
      assertContained(root, resolve(ARTIFACT_ROOT, "tmp"), "controlled-world cleanup");
      await rm(root, { recursive: true, force: true });
    },
  };
}

export function assertArtifactPath(path: string): string {
  const absolute = resolve(path);
  assertContained(absolute, ARTIFACT_ROOT, "generated artifact");
  return absolute;
}

function assertContained(path: string, parent: string, label: string): void {
  const childRelative = relative(parent, path);
  if (
    childRelative === "" ||
    childRelative === ".." ||
    childRelative.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    isAbsolute(childRelative)
  ) {
    throw new Error(`${label} must be a strict descendant of ${parent}`);
  }
}
