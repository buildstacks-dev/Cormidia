// Traceability: CF-B14 · HB-P4; CF-REG-359 · HB-139 · boundary-map.md B-14; case-catalog.md §10.3.

// CF-B14-* — link/artifact ownership (contracts/B-14-human-checkout.md §2):
// "`pnpm link:local`-class operations upgrade only artifacts owned by the
// same checkout; foreign-owned files/links are refused untouched."
//
// L2 at the real process seam: the actual `scripts/link-local.mjs` runs as a
// subprocess with every install location redirected into a temp sandbox via
// its own env seams (CORMIDIA_BIN_DIR, CODEX_HOME, CLAUDE_CONFIG_DIR,
// PI_CODING_AGENT_DIR) — the operator's real ~/.local, ~/.codex, ~/.claude,
// ~/.pi are never touched. The script's link SOURCE is this checkout
// (src/cormidia-local.cjs, agent-skills/cormidia), read-only.

import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readlinkSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertHumanBytesPreserved } from "./helpers.js";

const SCRIPT = fileURLToPath(new URL("../../../scripts/link-local.mjs", import.meta.url));
const BINARY_SOURCE = fileURLToPath(new URL("../../../src/cormidia-local.cjs", import.meta.url));
const SKILL_SOURCE = fileURLToPath(new URL("../../../agent-skills/cormidia", import.meta.url));
const JOB_BINARY_SOURCE = fileURLToPath(new URL("../../../src/cormidia-job-local.cjs", import.meta.url));
const JOB_SKILL_SOURCE = fileURLToPath(new URL("../../../agent-skills/cormidia-job", import.meta.url));

/** The provider skill homes link:local owns, in the order the script links
 *  them. Kept as one list so a newly packaged skill cannot be added to
 *  `agent-skills/` without a link target being asserted here too. */
const PROVIDERS = ["codex", "claude", "pi"] as const;

interface Sandbox {
  root: string;
  binDir: string;
  claudeSkill: string;
  codexSkill: string;
  piSkill: string;
  /** `<provider>/skills/<skill>` for every provider home × packaged skill. */
  skillTargets(skill: "cormidia" | "cormidia-job"): string[];
  run(): { status: number; output: string };
}

describe("CF-B14-* — link ownership: link:local-class operations refuse foreign-owned files/links untouched (contract B-14 §2)", () => {
  let cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    cleanups = [];
  });

  async function makeSandbox(): Promise<Sandbox> {
    const root = await mkdtemp(join(tmpdir(), "cormidia-cf-b14-link-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const binDir = join(root, "bin");
    const codexHome = join(root, "codex");
    const claudeHome = join(root, "claude");
    const piHome = join(root, "pi");
    const providerHomes: Record<(typeof PROVIDERS)[number], string> = {
      codex: codexHome,
      claude: claudeHome,
      pi: piHome,
    };
    return {
      root,
      binDir,
      claudeSkill: join(claudeHome, "skills", "cormidia"),
      codexSkill: join(codexHome, "skills", "cormidia"),
      piSkill: join(piHome, "skills", "cormidia"),
      skillTargets: (skill) => PROVIDERS.map((provider) => join(providerHomes[provider], "skills", skill)),
      run: () => {
        try {
          const output = execFileSync(process.execPath, [SCRIPT], {
            env: {
              ...process.env,
              CORMIDIA_BIN_DIR: binDir,
              CODEX_HOME: codexHome,
              CLAUDE_CONFIG_DIR: claudeHome,
              PI_CODING_AGENT_DIR: piHome,
            },
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
            timeout: 15_000,
          });
          return { status: 0, output };
        } catch (error) {
          const failure = error as { status?: number; stdout?: string; stderr?: string };
          return {
            status: failure.status ?? 1,
            output: `${failure.stdout ?? ""}${failure.stderr ?? ""}`,
          };
        }
      },
    };
  }

  it("§2 links into an empty sandbox and re-runs idempotently — same-checkout artifacts are upgraded in place", async () => {
    const sandbox = await makeSandbox();

    const first = sandbox.run();
    expect(first.status).toBe(0);
    expect(readlinkSync(join(sandbox.binDir, "cormidia"))).toBe(BINARY_SOURCE);
    for (const skill of [sandbox.claudeSkill, sandbox.codexSkill, sandbox.piSkill]) {
      expect(readlinkSync(skill)).toBe(SKILL_SOURCE);
    }

    // Re-run: idempotent, links unchanged — the ownership check recognizes
    // its own links and upgrades (here: keeps) them rather than refusing.
    const second = sandbox.run();
    expect(second.status).toBe(0);
    expect(readlinkSync(join(sandbox.binDir, "cormidia"))).toBe(BINARY_SOURCE);
    expect(readlinkSync(sandbox.claudeSkill)).toBe(SKILL_SOURCE);
  });

  // #359 shipped a SECOND binary (`cormidia-job`) and a second packaged skill
  // (`agent-skills/cormidia-job/`) but left link:local linking only the first
  // of each, so the job runner was unreachable from PATH after a source
  // install. Every packaged bin entry and every packaged skill must land.
  it("§2 links BOTH packaged binaries and BOTH packaged skills — no bin entry or skill is left unreachable", async () => {
    const sandbox = await makeSandbox();

    const result = sandbox.run();
    expect(result.status).toBe(0);

    expect(readlinkSync(join(sandbox.binDir, "cormidia"))).toBe(BINARY_SOURCE);
    expect(readlinkSync(join(sandbox.binDir, "cormidia-job"))).toBe(JOB_BINARY_SOURCE);

    for (const target of sandbox.skillTargets("cormidia")) {
      expect(readlinkSync(target)).toBe(SKILL_SOURCE);
    }
    for (const target of sandbox.skillTargets("cormidia-job")) {
      expect(readlinkSync(target)).toBe(JOB_SKILL_SOURCE);
    }

    // Each linked skill resolves to a real SKILL.md through the link, so a
    // provider can actually route to it — not merely a dangling symlink.
    for (const target of [...sandbox.skillTargets("cormidia"), ...sandbox.skillTargets("cormidia-job")]) {
      expect(existsSync(join(target, "SKILL.md"))).toBe(true);
    }
  });

  it("§2 refuses a foreign-owned link at the cormidia-job SKILL target — the second skill carries the same ownership guard as the first", async () => {
    const sandbox = await makeSandbox();
    // SEEDED VIOLATION at the job skill specifically: the guard must cover
    // every target the script writes, not just the ones that predate #359.
    const foreignTarget = join(sandbox.root, "some-other-checkout", "cormidia-job-skill");
    mkdirSync(foreignTarget, { recursive: true });
    mkdirSync(join(sandbox.root, "codex", "skills"), { recursive: true });
    symlinkSync(foreignTarget, join(sandbox.root, "codex", "skills", "cormidia-job"));

    const result = sandbox.run();
    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/refusing to replace existing path: .*codex\/skills\/cormidia-job/);
    expect(readlinkSync(join(sandbox.root, "codex", "skills", "cormidia-job"))).toBe(foreignTarget);
  });

  it("§2 refuses a foreign REGULAR FILE at the binary target — refused untouched, and no partial linking proceeds past the refusal", async () => {
    const sandbox = await makeSandbox();
    const foreignBytes = "#!/bin/sh\necho the human's own cormidia shim\n";
    mkdirSync(sandbox.binDir, { recursive: true });
    writeFileSync(join(sandbox.binDir, "cormidia"), foreignBytes);

    const result = sandbox.run();
    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/refusing to replace existing path: .*\/bin\/cormidia/);
    // Untouched: the human's file survives byte-for-byte, still a regular file.
    assertHumanBytesPreserved(join(sandbox.binDir, "cormidia"), foreignBytes);
    // The refusal stopped the run before any skill link was created.
    expect(existsSync(sandbox.claudeSkill)).toBe(false);
    expect(existsSync(sandbox.codexSkill)).toBe(false);
  });

  it("negative control: a seeded foreign-owned symlink at a skill target — the ownership guard FIRES and the link is untouched", async () => {
    const sandbox = await makeSandbox();
    // SEEDED VIOLATION: a symlink owned by some OTHER checkout/tool sits at
    // the Codex skill path (first skill target, so the guard is provably the
    // thing that stops the run).
    const foreignTarget = join(sandbox.root, "some-other-checkout", "skill");
    mkdirSync(foreignTarget, { recursive: true });
    mkdirSync(join(sandbox.root, "codex", "skills"), { recursive: true });
    symlinkSync(foreignTarget, sandbox.codexSkill);

    const result = sandbox.run();
    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/refusing to replace existing path: .*codex\/skills\/cormidia/);
    // The foreign link still points where its owner left it.
    expect(readlinkSync(sandbox.codexSkill)).toBe(foreignTarget);
  });
});
