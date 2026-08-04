// CF-B14-* — human checkout ↔ managed workspace: bootstrap-side interference
// (contracts/B-14-human-checkout.md §§1–4; boundary-map.md §B-14; INV-010).
//
// L2 on real temp git checkouts (fixtures/git-repo.ts) and a real temp org
// home built by the product's own init (fixtures/org-home.ts). Product code
// runs unmodified: `bootstrapRun` is the lifecycle command under test, and
// the compose seam (`composeProjectInstructions`) is additionally pinned with
// direct pure-function calls — those assertions are L1-shaped but colocated
// here because HB-P4 assigns this family a single hermetic dir.
//
// Covered contract clauses:
// §1  ordinary bootstrap accepts a dirty/staged/detached checkout;
// §2  containment — only `.cormidia/**` + the marked instruction block; existing
//     bytes preserved outside the marker (byte-for-byte);
// §3  path overlap with generated artifacts → typed refusal before mutation;
//     symlinked paths → typed refusal before mutation (fixed with HB-P4;
//     the promoted ex-tripwire tests below pin the clause);
// §4  re-run: never duplicates the marked block, never silently overwrites.

import { afterEach, describe, expect, it } from "vitest";
import { existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AUTHORITY_BLOCK_END,
  AUTHORITY_BLOCK_START,
  composeProjectInstructions,
  projectAuthorityBlock,
} from "../../../src/org/authority.js";
import { bootstrapRun } from "../../../src/org/bootstrap.js";
import { loadRoles } from "../../../src/org/roles.js";
import { makeTempGitRepo, type TempGitRepo } from "../../fixtures/git-repo.js";
import { makeTempOrgHome, type TempOrgHome } from "../../fixtures/org-home.js";
import { walkFiles } from "../../fixtures/walk.js";
import {
  answersFor,
  assertHumanBytesPreserved,
  assertWritesContained,
  countOccurrences,
  diffSnapshots,
  snapshotTree,
} from "./helpers.js";

const AGENTS_SEED = "# Fixture app AGENTS.md\n\nHuman-authored naïve—バイト content stays put.\n";
const README_SEED = "# fixture app\n";

describe("CF-B14-* — bootstrap vs the human checkout (contract B-14 §§1–4)", () => {
  let cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    cleanups = [];
  });

  interface Walk {
    repo: TempGitRepo;
    org: TempOrgHome;
    role: string;
    appName: string;
    run(appName?: string): ReturnType<typeof bootstrapRun>;
  }

  async function makeWalk(options: { seedAgents?: string | false } = {}): Promise<Walk> {
    const repo = await makeTempGitRepo({
      defaultBranch: "trunk", // deliberately not main (#101)
      seedFiles: [
        { path: "README.md", contents: README_SEED },
        ...(options.seedAgents === false
          ? []
          : [{ path: "AGENTS.md", contents: options.seedAgents ?? AGENTS_SEED }]),
      ],
    });
    cleanups.push(() => repo.cleanup());
    const org = await makeTempOrgHome();
    cleanups.push(() => org.cleanup());
    const role = (await loadRoles(join(org.orgHome, "roles.yaml"))).roles[0]!.name;
    const appName = "cf-b14-app";
    return {
      repo,
      org,
      role,
      appName,
      run: (name = appName) =>
        bootstrapRun(repo.dir, answersFor(role), {
          orgHome: org.orgHome,
          appName: name,
          repoSlug: `fixture/${name}`,
        }),
    };
  }

  // -------------------------------------------------------------------------
  // §1 — ordinary bootstrap accepts what only publish refuses
  // -------------------------------------------------------------------------

  it("§1 accepts a dirty checkout with unrelated staged changes on a detached HEAD — the publish-only refusals are not bootstrap preconditions", async () => {
    const walk = await makeWalk();
    // Dirty: an uncommitted edit to a human file.
    const dirtyReadme = `${README_SEED}\nuncommitted human edit\n`;
    writeFileSync(join(walk.repo.dir, "README.md"), dirtyReadme);
    // Unrelated staged content.
    writeFileSync(join(walk.repo.dir, "staged-foreign.txt"), "human staged work\n");
    walk.repo.git(["add", "--", "staged-foreign.txt"]);
    // Detached HEAD.
    walk.repo.git(["checkout", "--detach"]);

    const result = await walk.run();

    expect(result.created).toContain(".cormidia/TASTE.md");
    expect(result.updated).toContain("AGENTS.md");
    // The human's in-flight work is untouched (clobber detector, green path).
    assertHumanBytesPreserved(join(walk.repo.dir, "README.md"), dirtyReadme);
    assertHumanBytesPreserved(join(walk.repo.dir, "staged-foreign.txt"), "human staged work\n");
    expect(walk.repo.git(["diff", "--cached", "--name-only"])).toBe("staged-foreign.txt");
  });

  // -------------------------------------------------------------------------
  // §2 — byte preservation + containment
  // -------------------------------------------------------------------------

  it("§2 preserves existing instruction-file content byte-for-byte outside the marked block", async () => {
    const walk = await makeWalk();
    await walk.run();

    const composed = readFileSync(join(walk.repo.dir, "AGENTS.md"), "utf8");
    // Everything before the marker is exactly the human file plus the one
    // separator newline the append path adds — no reflow, no normalization.
    const startIdx = composed.indexOf(AUTHORITY_BLOCK_START);
    expect(startIdx).toBeGreaterThan(0);
    expect(composed.slice(0, startIdx)).toBe(`${AGENTS_SEED}\n`);
    expect(countOccurrences(composed, AUTHORITY_BLOCK_START)).toBe(1);
    expect(countOccurrences(composed, AUTHORITY_BLOCK_END)).toBe(1);
    expect(composed.endsWith(`${AUTHORITY_BLOCK_END}\n`)).toBe(true);

    // CLAUDE.md did not pre-exist: bootstrap authors it whole, marker included.
    const claude = readFileSync(join(walk.repo.dir, "CLAUDE.md"), "utf8");
    expect(countOccurrences(claude, AUTHORITY_BLOCK_START)).toBe(1);
  });

  it("§2 containment sweep: the command's tree diff is exactly its created + updated sets", async () => {
    const walk = await makeWalk();
    const before = await snapshotTree(walk.repo.dir);
    const result = await walk.run();
    const after = await snapshotTree(walk.repo.dir);

    const diff = diffSnapshots(before, after);
    assertWritesContained(diff, { added: result.created, changed: result.updated });
    // And the authorized sets are honest: everything claimed created/updated
    // really appears in the diff (a created file that is a no-op would hide a
    // reporting drift).
    expect(diff.added.sort()).toEqual([...result.created].sort());
    expect(diff.changed.sort()).toEqual([...result.updated].sort());
  });

  it("§3 refuses a retired app-artifact root before creating a parallel Cormidia tree", async () => {
    const walk = await makeWalk();
    mkdirSync(join(walk.repo.dir, ".operon"));
    writeFileSync(join(walk.repo.dir, ".operon", "config.yaml"), "legacy app authority\n");
    const before = await snapshotTree(walk.repo.dir);

    await expect(walk.run()).rejects.toThrow(/retired app artifact directory.*rename it to \.cormidia/);

    expect(diffSnapshots(before, await snapshotTree(walk.repo.dir))).toEqual({
      added: [],
      removed: [],
      changed: [],
    });
    expect(existsSync(join(walk.repo.dir, ".cormidia"))).toBe(false);
  });

  it("negative control: a lifecycle command touching more than its authorized generated paths — the containment detector FIRES", async () => {
    const walk = await makeWalk();
    const before = await snapshotTree(walk.repo.dir);
    const result = await walk.run();
    // SEEDED VIOLATION: a rogue write outside the authorized set, as if the
    // command had touched a human file and dropped an unowned artifact.
    writeFileSync(join(walk.repo.dir, "README.md"), "clobbered by a rogue lifecycle write\n");
    writeFileSync(join(walk.repo.dir, "stray-artifact.txt"), "not bootstrap-owned\n");
    const after = await snapshotTree(walk.repo.dir);

    expect(() =>
      assertWritesContained(diffSnapshots(before, after), {
        added: result.created,
        changed: result.updated,
      }),
    ).toThrow(/containment detector: .*unauthorized add: stray-artifact\.txt/);
    expect(() =>
      assertWritesContained(diffSnapshots(before, after), {
        added: result.created,
        changed: result.updated,
      }),
    ).toThrow(/unauthorized change: README\.md/);
  });

  it("negative control: a seeded clobber of human bytes — the clobber detector FIRES", async () => {
    const walk = await makeWalk();
    // SEEDED VIOLATION: generated-style bytes written over the human's file.
    writeFileSync(join(walk.repo.dir, "AGENTS.md"), "# generated content\n");
    expect(() =>
      assertHumanBytesPreserved(join(walk.repo.dir, "AGENTS.md"), AGENTS_SEED),
    ).toThrow(/clobber detector: human bytes .* were altered/);
  });

  // -------------------------------------------------------------------------
  // §2/§4 — marked-block idempotency (compose seam + whole command)
  // -------------------------------------------------------------------------

  it("§4 replaces a pre-existing marked block in place — never duplicated, surrounding bytes untouched", async () => {
    const staleBlock = `${AUTHORITY_BLOCK_START}\nstale cormidia content\n${AUTHORITY_BLOCK_END}`;
    const seeded = `pre-block human text\n${staleBlock}\npost-block human text\n`;
    const walk = await makeWalk({ seedAgents: seeded });
    await walk.run();

    const composed = readFileSync(join(walk.repo.dir, "AGENTS.md"), "utf8");
    expect(countOccurrences(composed, AUTHORITY_BLOCK_START)).toBe(1);
    expect(countOccurrences(composed, AUTHORITY_BLOCK_END)).toBe(1);
    expect(composed).not.toContain("stale cormidia content");
    const startIdx = composed.indexOf(AUTHORITY_BLOCK_START);
    const endIdx = composed.indexOf(AUTHORITY_BLOCK_END) + AUTHORITY_BLOCK_END.length;
    expect(composed.slice(0, startIdx)).toBe("pre-block human text\n");
    expect(composed.slice(endIdx)).toBe("\npost-block human text\n");
  });

  it("compose seam is idempotent: composing the same block twice is byte-identical to composing it once", () => {
    const block = projectAuthorityBlock(".cormidia/AUTHORITY.md", {
      version: "delegated-operator/v1",
      sha256: "0".repeat(64),
      text: "charter projection",
    });
    const once = composeProjectInstructions(AGENTS_SEED, block);
    expect(composeProjectInstructions(once, block)).toBe(once);
    expect(countOccurrences(once, AUTHORITY_BLOCK_START)).toBe(1);
  });

  it("negative control: seeded malformed or duplicated markers — the compose guard FIRES instead of merging", () => {
    const block = projectAuthorityBlock(".cormidia/AUTHORITY.md", {
      version: "delegated-operator/v1",
      sha256: "0".repeat(64),
      text: "charter projection",
    });
    const malformed = [
      `only a start marker\n${AUTHORITY_BLOCK_START}\n`, // start without end
      `only an end marker\n${AUTHORITY_BLOCK_END}\n`, // end without start
      `${AUTHORITY_BLOCK_END}\nreversed\n${AUTHORITY_BLOCK_START}\n`, // end before start
      `${AUTHORITY_BLOCK_START}\n${AUTHORITY_BLOCK_START}\nx\n${AUTHORITY_BLOCK_END}\n`, // duplicate start
      `${AUTHORITY_BLOCK_START}\nx\n${AUTHORITY_BLOCK_END}\n${AUTHORITY_BLOCK_END}\n`, // duplicate end
    ];
    for (const existing of malformed) {
      expect(() => composeProjectInstructions(existing, block)).toThrow(
        /malformed Cormidia authority block/,
      );
    }
  });

  // -------------------------------------------------------------------------
  // §3 — path overlap with generated artifacts
  // -------------------------------------------------------------------------

  it("§3 refuses before mutation when a generated-artifact path already exists (path overlap)", async () => {
    const walk = await makeWalk();
    const humanTaste = "# Human file that happens to live at .cormidia/TASTE.md\n";
    mkdirSync(join(walk.repo.dir, ".cormidia"), { recursive: true });
    writeFileSync(join(walk.repo.dir, ".cormidia", "TASTE.md"), humanTaste);
    const appsBefore = readFileSync(join(walk.org.orgHome, "apps.yaml"), "utf8");
    const agentsBefore = readFileSync(join(walk.repo.dir, "AGENTS.md"), "utf8");

    await expect(walk.run()).rejects.toThrow(/\.cormidia\/TASTE\.md already exists .* refusing to overwrite/);

    // Refusal preceded every mutation: human bytes intact, no sibling
    // artifacts, no registration in the org home.
    assertHumanBytesPreserved(join(walk.repo.dir, ".cormidia", "TASTE.md"), humanTaste);
    assertHumanBytesPreserved(join(walk.repo.dir, "AGENTS.md"), agentsBefore);
    expect(existsSync(join(walk.repo.dir, ".cormidia", "config.yaml"))).toBe(false);
    expect(readFileSync(join(walk.org.orgHome, "apps.yaml"), "utf8")).toBe(appsBefore);
  });

  // -------------------------------------------------------------------------
  // §4 — re-run
  // -------------------------------------------------------------------------

  it("§4 re-run never duplicates the marked block and never silently overwrites — refused or regenerated, byte-stable either way", async () => {
    // AMBIGUITY, deliberately not decided here: contract §4 says a re-run is
    // "idempotent; marked block replaced in place; .cormidia/ regenerated
    // deterministically with preserved user-owned edits refused or reported".
    // The product today refuses a re-run outright (assertNotExists). Whether
    // §4 requires the re-run to SUCCEED (regenerate) or refusing satisfies it
    // is candidate-finding material for the owner (see the wave report); this
    // test asserts only the unambiguous half — never duplicated, never
    // silently overwritten, and a typed report on refusal.
    const walk = await makeWalk();
    await walk.run();
    const snapshotAfterFirst = await snapshotTree(walk.repo.dir);
    const appsAfterFirst = readFileSync(join(walk.org.orgHome, "apps.yaml"), "utf8");

    let refusal: Error | undefined;
    try {
      await walk.run();
    } catch (error) {
      refusal = error as Error;
    }

    const snapshotAfterSecond = await snapshotTree(walk.repo.dir);
    if (refusal !== undefined) {
      // Refusal leg: typed report, and the checkout is byte-identical.
      expect(refusal.message).toMatch(/already exists|refus/i);
      expect([...snapshotAfterSecond.entries()]).toEqual([...snapshotAfterFirst.entries()]);
      expect(readFileSync(join(walk.org.orgHome, "apps.yaml"), "utf8")).toBe(appsAfterFirst);
    }
    // Either leg: exactly one marked block, and human seed bytes still there.
    const agents = snapshotAfterSecond.get("AGENTS.md")!;
    expect(countOccurrences(agents, AUTHORITY_BLOCK_START)).toBe(1);
    expect(countOccurrences(agents, AUTHORITY_BLOCK_END)).toBe(1);
    expect(agents.startsWith(AGENTS_SEED)).toBe(true);
  });

  it("§2/§4 content bootstrap cannot compose cleanly is refused or reported — never silently overwritten", async () => {
    // A human AGENTS.md with trailing whitespace trips the product's emitted-
    // artifact validation. The contract does not promise acceptance; it
    // promises the human's bytes survive whichever way the command goes.
    const trailing = "# Fixture app AGENTS.md\n\na line with trailing space  \n";
    const walk = await makeWalk({ seedAgents: trailing });
    const appsBefore = readFileSync(join(walk.org.orgHome, "apps.yaml"), "utf8");

    let failed = false;
    try {
      await walk.run();
    } catch {
      failed = true;
    }

    const agents = readFileSync(join(walk.repo.dir, "AGENTS.md"), "utf8");
    if (failed) {
      // Refusal leg: full rollback — original bytes, no org registration.
      assertHumanBytesPreserved(join(walk.repo.dir, "AGENTS.md"), trailing);
      expect(existsSync(join(walk.repo.dir, ".cormidia", "TASTE.md"))).toBe(false);
      expect(readFileSync(join(walk.org.orgHome, "apps.yaml"), "utf8")).toBe(appsBefore);
    } else {
      // Acceptance leg: human bytes preserved outside the marker.
      expect(agents.startsWith(trailing)).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // §3 — symlinked paths (ratified: typed refusal before mutation)
  // -------------------------------------------------------------------------

  // PROMOTED TRIPWIRES (fix landed with this change, HB-P4): contract B-14
  // §3 — "Symlinked paths …: typed refusals before mutation." The product now
  // refuses at the validation phase (src/org/bootstrap.ts —
  // planProjectInstructionFiles lstats each instruction file;
  // assertNotSymlinked walks every generated-path segment, catching a
  // symlinked `.cormidia` that existsSync-based checks would follow) and
  // re-checks at write time. These started life as it.fails defect tripwires
  // and were promoted to plain tests in the same change as the fix
  // (detector-deposit rule, AGENTS.md / policy case_sourcing).

  it("§3 an instruction file that is a symlink out of the checkout → typed refusal, link target untouched", async () => {
    const walk = await makeWalk({ seedAgents: false });
    const outside = await mkdtemp(join(tmpdir(), "cormidia-cf-b14-outside-"));
    cleanups.push(() => rm(outside, { recursive: true, force: true }));
    const outsideFile = join(outside, "instructions.md");
    const outsideBytes = "# Human instructions that live OUTSIDE the checkout\n";
    writeFileSync(outsideFile, outsideBytes);
    symlinkSync(outsideFile, join(walk.repo.dir, "AGENTS.md"));

    // Ratified clause: typed refusal before mutation…
    await expect(walk.run()).rejects.toThrow(/sym(?:bolic ?)?link|refus/i);
    // …and the file outside the checkout is never written through the link.
    assertHumanBytesPreserved(outsideFile, outsideBytes);
    expect(lstatSync(join(walk.repo.dir, "AGENTS.md")).isSymbolicLink()).toBe(true);
  });

  it("§3 .cormidia as a symlink to a directory outside the checkout → typed refusal, outside directory untouched", async () => {
    const walk = await makeWalk();
    const outside = await mkdtemp(join(tmpdir(), "cormidia-cf-b14-outside-dir-"));
    cleanups.push(() => rm(outside, { recursive: true, force: true }));
    symlinkSync(outside, join(walk.repo.dir, ".cormidia"));

    // Ratified clause: typed refusal before mutation…
    await expect(walk.run()).rejects.toThrow(/sym(?:bolic ?)?link|refus/i);
    // …and nothing landed in the outside directory through the link.
    expect(await walkFiles(outside)).toEqual([]);
  });
});
