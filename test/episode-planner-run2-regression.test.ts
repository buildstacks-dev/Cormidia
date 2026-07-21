import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseNormalizedProposedEpisodePlan,
  type ProposedEpisodePlan,
} from "../src/loop/episode-plan.js";
import {
  TICKET_PROVIDER_OPERATIONS,
  validateTicketEpisodePlan,
} from "../src/loop/ticket-episode-plan.js";

const FIXTURE_DIR = join(import.meta.dirname, "fixtures", "episode-planner");

const CAPTURED_REVISIONS = [
  {
    file: "run2-ticket-diagnose-revision.json",
    sha256: "d58326ba84c1cd8978875ea66119aa3841e8e0752d6c2812dccbdd4f990b822e",
    operation: "ticket/diagnose",
  },
  {
    file: "run2-fix-fix-revision.json",
    sha256: "08314c1e665edbbf2df8a301e24c9b60e1d65486a153279b23da5a011af86208",
    operation: "fix/fix",
  },
] as const;

describe("run-2 ticket revision regressions", () => {
  for (const retained of CAPTURED_REVISIONS) {
    it(`accepts the exact registered ${retained.operation} revision without an internal TypeError`, async () => {
      const raw = await readFile(join(FIXTURE_DIR, retained.file), "utf8");
      expect(createHash("sha256").update(raw).digest("hex")).toBe(retained.sha256);
      const proposal = parseNormalizedProposedEpisodePlan(JSON.parse(raw) as unknown);

      expect(validateTicketEpisodePlan(proposal)).toEqual({ ok: true, issues: [] });
      expect(proposal.steps).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "provider_turn", operation: retained.operation }),
      ]));
    });
  }

  it("names a genuinely unregistered near-miss and the complete valid operation list", async () => {
    const raw = await readFile(
      join(FIXTURE_DIR, CAPTURED_REVISIONS[0].file),
      "utf8",
    );
    const proposal = parseNormalizedProposedEpisodePlan(JSON.parse(raw) as unknown);
    const invalid = structuredClone(proposal) as ProposedEpisodePlan;
    const diagnose = invalid.steps.find((step) =>
      step.kind === "provider_turn" && step.operation === "ticket/diagnose"
    );
    if (diagnose?.kind !== "provider_turn") throw new Error("captured diagnose step disappeared");
    diagnose.operation = "ticket/diagnose-typo";

    expect(validateTicketEpisodePlan(invalid).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "ticket_provider_operation_unknown",
        stepId: diagnose.id,
        message:
          `unknown provider operation "ticket/diagnose-typo"; valid operations are: ` +
          TICKET_PROVIDER_OPERATIONS.join(", "),
      }),
    ]));
  });
});
