// Traceability: CF-REG-251 · HB-139 · case-catalog.md §10.3; contracts/B-11-learning-publisher.md §3 (superseded — legacy readers); contracts/B-32-learning-kernel-ports.md.

// CF-REG-251 — #251: approval ids carry a base64url random suffix that can end
// in `-`; the forked publisher named its journal file through
// `sanitizeIdSegment` (which strips that trailing `-`) while the CF-J12-I
// journal reader once derived the path from the raw id — a ~1-in-64 flake.
// The forked publisher retired with Cormidia #467 phase B; the regression now
// pins the LEGACY journal reader (`src/org/learning-loop/legacy.ts`), which
// must keep deriving the path through the same sanitizer so every journal the
// fork ever wrote still reads by its raw approval id.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sanitizeIdSegment } from "../../../src/org/learning-loop/host/events.js";
import { listInFlightLegacyJournals, readLegacyPublishJournal } from "../../../src/org/learning-loop/legacy.js";
import { makeTempStateHome, type TempStateHome } from "../../fixtures/state-home.js";

const TRAILING_HYPHEN_APPROVAL_ID = "20260731T120000Z-ooh-";

describe("CF-REG-251 — a trailing-hyphen approval id round-trips through the legacy journal path (L2, REG)", () => {
  let state: TempStateHome;
  let journalDir: string;

  beforeAll(async () => {
    state = await makeTempStateHome({ name: "cf-reg-251" });
    journalDir = join(state.stateHome, "learning", "publish-journal");
    await mkdir(journalDir, { recursive: true });
    // The file the forked publisher wrote: named by the SANITIZED id.
    const journal = {
      journal_id: TRAILING_HYPHEN_APPROVAL_ID,
      candidate_id: "cand_reg251",
      destination: "okf_concept",
      scope: "org",
      approval_ref: TRAILING_HYPHEN_APPROVAL_ID,
      manifest_version: "v1",
      done_at: "2026-07-31T12:00:01.000Z",
    };
    await writeFile(
      join(journalDir, `${sanitizeIdSegment(TRAILING_HYPHEN_APPROVAL_ID)}.json`),
      `${JSON.stringify(journal, null, 2)}\n`,
      "utf8",
    );
  });

  afterAll(async () => {
    await state.cleanup();
  });

  it("precondition: the sanitizer really changes the id (the trailing `-` is stripped), so the raw-id and sanitized paths differ", () => {
    expect(TRAILING_HYPHEN_APPROVAL_ID.endsWith("-")).toBe(true);
    expect(sanitizeIdSegment(TRAILING_HYPHEN_APPROVAL_ID)).not.toBe(TRAILING_HYPHEN_APPROVAL_ID);
  });

  it("the legacy reader resolves the journal by its RAW approval id through the same sanitizer the publisher used", async () => {
    const journal = await readLegacyPublishJournal(state.stateHome, TRAILING_HYPHEN_APPROVAL_ID);
    expect(journal?.journal_id).toBe(TRAILING_HYPHEN_APPROVAL_ID);
    expect(journal?.done_at).toBeDefined();
    // A done journal is never reported as in flight.
    expect(await listInFlightLegacyJournals(state.stateHome, "org")).toEqual([]);
  });

  it("negative control: the raw-id path is ENOENT — a reader deriving the filename from the raw id reproduces #251", async () => {
    const rawPath = join(journalDir, `${TRAILING_HYPHEN_APPROVAL_ID}.json`);
    await expect(readFile(rawPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readLegacyPublishJournal(state.stateHome, "20260731T120000Z-never-written")).toBeUndefined();
  });
});
