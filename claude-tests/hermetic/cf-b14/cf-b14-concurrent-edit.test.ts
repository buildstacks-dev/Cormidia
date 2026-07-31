// CF-B14-CE / CF-C-B14 concurrent-edit clause — F-PT-007, RATIFIED 2026-07-31
// (contracts/B-14-human-checkout.md §3; harness-backlog HB-P4; INV-010).
//
// Ratified contract truth: a concurrent human edit of a bootstrap-owned path
// between a lifecycle command's validation and its write yields
// COMPARE-AND-REFUSE preserving human bytes — never overwritten, never merged
// silently.
//
// INTERLEAVING MECHANISM (honest disclosure, per HB-P4): `bootstrapRun`
// exposes no in-process hook between validation and write, so the hold is
// built from an injectable product seam plus a FIFO:
//   - `options.templateRoot` points at a temp root whose
//     `docs/policy.yaml.template` is a POSIX FIFO (mkfifo);
//   - inside `emitAppArtifacts`, `readPolicyTemplate` opens that FIFO AFTER
//     both validations (bootstrapRun's assertNotExists + pre-flight compose,
//     and emitAppArtifacts' own assertNotExists) and BEFORE the first write
//     to the checkout;
//   - the test's `open(fifo, "w")` resolves exactly when the product's read
//     side is open, i.e. when the command is provably parked inside the
//     validation→write window; the product cannot proceed until the test
//     writes the template bytes and closes.
// The "human" edit is therefore made while the command is deterministically
// held between validation and write — no timing races. The mechanism itself
// is proven by a plain (non-tripwire) self-test below, so a broken hold can
// never silently keep the it.fails tripwires green.
//
// PRODUCT DEFECT TRIPWIRES: the product performs no compare at write time
// (src/org/bootstrap.ts emit/writeFile paths), so today the human bytes are
// clobbered (generated path) or silently merged (instruction file). The
// it.fails tests assert the RATIFIED clause: green while the defect exists,
// red once compare-and-refuse lands — then remove .fails.

import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, open, rm, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AUTHORITY_BLOCK_START } from "../../../src/org/authority.js";
import { bootstrapRun, type BootstrapRunResult } from "../../../src/org/bootstrap.js";
import { loadRoles } from "../../../src/org/roles.js";
import { makeTempGitRepo, type TempGitRepo } from "../../fixtures/git-repo.js";
import { makeTempOrgHome, type TempOrgHome } from "../../fixtures/org-home.js";
import { answersFor, assertHumanBytesPreserved } from "./helpers.js";

const REAL_TEMPLATE_PATH = fileURLToPath(
  new URL("../../../docs/policy.yaml.template", import.meta.url),
);
const AGENTS_SEED = "# Fixture app AGENTS.md\n\nHuman-authored content.\n";
const APP = "cf-b14-ce-app";

interface HeldRun {
  repo: TempGitRepo;
  org: TempOrgHome;
  /** The in-flight bootstrapRun, currently parked between validation and write. */
  run: Promise<BootstrapRunResult>;
  /** Write side of the template FIFO — the product resumes when release() runs. */
  release(): Promise<void>;
}

describe("CF-B14-CE / CF-C-B14 — concurrent human edit between validation and write (F-PT-007, ratified 2026-07-31)", () => {
  let cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    cleanups = [];
  });

  /** Start a bootstrapRun and park it inside the validation→write window.
   *  Resolves once the product is provably held on the template FIFO. */
  async function startHeldRun(): Promise<HeldRun> {
    const repo = await makeTempGitRepo({
      defaultBranch: "trunk",
      seedFiles: [
        { path: "README.md", contents: "# fixture app\n" },
        { path: "AGENTS.md", contents: AGENTS_SEED },
      ],
    });
    cleanups.push(() => repo.cleanup());
    const org = await makeTempOrgHome();
    cleanups.push(() => org.cleanup());
    const role = (await loadRoles(join(org.orgHome, "roles.yaml"))).roles[0]!.name;

    // Template root whose policy template is a FIFO: the product's
    // readPolicyTemplate blocks on it after validation, before any write.
    const templateRoot = await mkdtemp(join(tmpdir(), "operon-cf-b14-tpl-"));
    cleanups.push(() => rm(templateRoot, { recursive: true, force: true }));
    await mkdir(join(templateRoot, "docs"), { recursive: true });
    const fifoPath = join(templateRoot, "docs", "policy.yaml.template");
    execFileSync("mkfifo", [fifoPath]);

    const run = bootstrapRun(repo.dir, answersFor(role), {
      orgHome: org.orgHome,
      appName: APP,
      repoSlug: `fixture/${APP}`,
      templateRoot,
    });
    // Rejections are asserted later; never let one become unhandled while held.
    run.catch(() => {});

    // Rendezvous: this open(w) resolves exactly when the product opened the
    // FIFO's read side — i.e. it passed validation and is parked pre-write.
    let heldHandle: FileHandle | undefined;
    const holdOpen = open(fifoPath, "w").then((handle) => {
      heldHandle = handle;
      return handle;
    });
    const winner = await Promise.race([
      holdOpen.then(() => "held" as const),
      run.then(
        () => "resolved-early" as const,
        () => "rejected-early" as const,
      ),
    ]);
    if (winner !== "held") {
      // The command settled before reaching the hold — the interleaving is
      // broken and no tripwire below may be trusted. Fail loudly. (The
      // never-resolving open(w) is abandoned; the worker reaps it at exit.)
      throw new Error(`CF-B14-CE interleaving failed: bootstrapRun ${winner} before the template hold`);
    }
    cleanups.push(async () => {
      // Belt and braces for assertion-failure paths: close the write side if
      // release() never ran, so the held product read cannot outlive the test.
      if (heldHandle !== undefined) await heldHandle.close().catch(() => {});
    });

    return {
      repo,
      org,
      run,
      release: async () => {
        const handle = await holdOpen;
        await handle.write(readFileSync(REAL_TEMPLATE_PATH, "utf8"));
        await handle.close();
        heldHandle = undefined;
      },
    };
  }

  it("mechanism self-test: the FIFO hold parks the command strictly between validation and the first checkout write", async () => {
    const held = await startHeldRun();

    // While held: validation AND org registration are behind us…
    expect(readFileSync(join(held.org.orgHome, "apps.yaml"), "utf8")).toContain(APP);
    // …but not one byte has been written into the human checkout.
    expect(existsSync(join(held.repo.dir, ".operon"))).toBe(false);
    expect(readFileSync(join(held.repo.dir, "AGENTS.md"), "utf8")).toBe(AGENTS_SEED);

    // No interference this time: released, the command completes normally —
    // proving the hold sits on the ordinary success path, not an error path.
    await held.release();
    const result = await held.run;
    expect(result.created).toContain(".operon/TASTE.md");
    expect(existsSync(join(held.repo.dir, ".operon", "TASTE.md"))).toBe(true);
  });

  it.fails("RATIFIED TRIPWIRE (generated path): human creates .operon/TASTE.md mid-window → compare-and-refuse, human bytes intact — never overwritten", async () => {
    const held = await startHeldRun();

    // THE CONCURRENT HUMAN EDIT — made while the command is provably parked
    // between its validation (both assertNotExists checks passed: no
    // .operon/TASTE.md existed) and its write.
    const humanBytes = "# MY taste file — the human wrote this mid-command\n";
    mkdirSync(join(held.repo.dir, ".operon"), { recursive: true });
    writeFileSync(join(held.repo.dir, ".operon", "TASTE.md"), humanBytes);

    await held.release();

    // Ratified F-PT-007: the command must COMPARE at write time, detect the
    // drift, and refuse with a typed error…
    let refusal: Error | undefined;
    try {
      await held.run;
    } catch (error) {
      refusal = error as Error;
    }
    expect(refusal).toBeInstanceOf(Error); // today: resolves — no compare exists
    // …and the human's bytes survive, never overwritten.
    assertHumanBytesPreserved(join(held.repo.dir, ".operon", "TASTE.md"), humanBytes);
  });

  it.fails("RATIFIED TRIPWIRE (instruction file): human edits AGENTS.md mid-window → compare-and-refuse — never merged silently", async () => {
    const held = await startHeldRun();

    // THE CONCURRENT HUMAN EDIT of a bootstrap-owned instruction file, made
    // strictly after the command validated (and pre-flight-composed) the
    // version it believed it was working against.
    const humanEdited = `${AGENTS_SEED}\nA line the human added mid-command.\n`;
    writeFileSync(join(held.repo.dir, "AGENTS.md"), humanEdited);

    await held.release();

    // Ratified F-PT-007: drift between validation and write → typed refusal…
    let refusal: Error | undefined;
    try {
      await held.run;
    } catch (error) {
      refusal = error as Error;
    }
    expect(refusal).toBeInstanceOf(Error); // today: resolves — the drifted file is re-read and merged
    // …and the file stays exactly as the human left it: no marked block was
    // silently merged into a version the command never validated.
    assertHumanBytesPreserved(join(held.repo.dir, "AGENTS.md"), humanEdited);
    expect(readFileSync(join(held.repo.dir, "AGENTS.md"), "utf8")).not.toContain(
      AUTHORITY_BLOCK_START,
    );
  });

  it("negative control: a seeded mid-window clobber violation — the clobber detector FIRES", async () => {
    // Proves the detector the tripwires rely on actually fires on the exact
    // violation shape F-PT-007 names (README rule 3: a detector that has
    // never fired is an assumption). The violation is seeded BY THE TEST —
    // it must not depend on the product defect, so it stays a valid control
    // after compare-and-refuse lands.
    const held = await startHeldRun();
    const humanBytes = "# human bytes written mid-window\n";
    mkdirSync(join(held.repo.dir, ".operon"), { recursive: true });
    writeFileSync(join(held.repo.dir, ".operon", "TASTE.md"), humanBytes);

    // SEEDED VIOLATION: a clobbering writer replaces the human's bytes with
    // generated content while the command is still held.
    writeFileSync(join(held.repo.dir, ".operon", "TASTE.md"), "# generated charter content\n");
    expect(() =>
      assertHumanBytesPreserved(join(held.repo.dir, ".operon", "TASTE.md"), humanBytes),
    ).toThrow(/clobber detector: human bytes .* were altered/);

    await held.release();
    await held.run.catch(() => {});
  });
});
