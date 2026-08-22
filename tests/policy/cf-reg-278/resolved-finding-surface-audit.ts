import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { selectValidationAuthority } from "../../fixtures/validation-authority.js";

interface SurfaceRow {
  readonly path: string;
  readonly required: readonly string[];
  readonly stale: readonly string[];
}

const rows: readonly SurfaceRow[] = [
  {
    path: "docs/scheduler/event-schemas.md",
    required: [
      "owner's 2026-08-16 identity-field clarification",
      "removing transport `filename` and producer `id`",
      "All other fields remain identity-bearing",
      "Nested `id` and unknown validated JSON fields remain identity-bearing",
    ],
    stale: ["The inbox file is the transport and dedup identity (deduplicated by filename)"],
  },
  {
    path: "docs/scheduler/design.md",
    required: [
      "event:<sha256(canonical payload minus filename,id)>",
      "groups the complete sorted inbox before admission",
      "legacy filename/id-inclusive alias",
    ],
    stale: ["| file name |", "exact `(event, role)` as handled"],
  },
  {
    path: "validation-design/README.md",
    required: [
      "Thirty-nine product-truth findings are tracked; five park exact cells",
      "If an incident touches one of the five parked seams",
      "HB-P3/P5/P6 unparked and LANDED 2026-08-12; HB-P7 remains parked",
      "2026-08-16 owner clarification excludes transport filename and producer id",
      "`F-PT-001…039`",
    ],
    stale: [
      "Thirty-three product-truth findings are tracked",
      "one of the eight parked seams",
      "`F-PT-001…033`",
      "HB-P3/P5 still parked",
    ],
  },
  {
    path: "validation-design/agents-md-contribution.md",
    required: [
      "currently HB-P7; HB-P3/P5/P6 landed after the attributable 2026-08-12 owner rulings",
      "HB-P6 later landed that exact vocabulary and detector on 2026-08-12",
    ],
    stale: [
      "HB-P3 and HB-P5 (blocked on F-PT-006 and F-PT-008)",
      "finding-parked P-tickets** (HB-P3/P5/P6/P7)",
      "encodes one side of F-PT-017's contested enum",
    ],
  },
  {
    path: "validation-design/routing.md",
    required: [
      "originally relocated byte-identically. The 2026-08-16 status reconciliation",
      "currently HB-P7; HB-P3/P5/P6 landed after the attributable 2026-08-12 owner rulings",
      "HB-P6 later landed that exact vocabulary and detector on 2026-08-12",
    ],
    stale: [
      "HB-P3 and HB-P5 (blocked on F-PT-006 and F-PT-008)",
      "finding-parked P-tickets** (HB-P3/P5/P6/P7)",
      "encodes one side of F-PT-017's contested enum",
    ],
  },
  {
    path: "validation-design/harness-backlog.md",
    required: [
      "F-PT-008 clause was parked until it was unparked and implemented under HB-P5 on 2026-08-12",
      "HB-P3 later landed them on 2026-08-12",
      "HB-015 is landed while its app-reset execute-order clause remains parked on F-PT-012",
      "landed after the owner chose",
      "identity-field clarification 2026-08-16",
      "pre-clarification id-inclusive bare/per-role content marks",
      "alias-keyed durable scheduler evidence without refiring",
    ],
    stale: [
      "F-PT-008 clause parked",
      "F-PT-006 producer-visibility legs still parked; HB-012 with the F-PT-008 clause",
      "human + build-agent after the owner chooses",
    ],
  },
  {
    path: "validation-design/case-catalog.md",
    required: [
      "fresh-producer-id duplicate collapse",
      "identity-field clarification 2026-08-16",
      "legacy filename/id-inclusive bare+per-role suppression",
      "alias-keyed scheduler-evidence recovery",
    ],
    stale: ["identity-with-two-payloads is vacuous"],
  },
  {
    path: "validation-design/boundary-map.md",
    required: [
      "Resolved product truth — F-PT-006 (owner, 2026-08-12; identity-field clarification 2026-08-16)",
      "F-PT-006 (opened at Phase 3; RESOLVED-ratified and implemented 2026-08-12; identity-field clarification 2026-08-16)",
      "pre-clarification id-inclusive bare/per-role content marks remain suppressive",
    ],
    stale: ["Open product truth — F-PT-006", "F-PT-006 (open):"],
  },
  {
    path: "validation-design/contracts/B-13-event-inbox.md",
    required: [
      "clarification 2026-08-16 (owner)",
      "Deliveries that differ only in `filename` and/or `id` are one event",
      "Top-level `id` remains schema-required and is delivered as provenance",
      "Producers owe no atomicity",
      "pre-clarification id-inclusive bare content key",
      "pre-clarification per-role content mark",
      "Durable scheduler spawn evidence under any of those aliases",
    ],
    stale: [
      "F-PT-006 (open-blocked-contract)",
      "producer visibility protocol is unspecified",
      "Same identity, two payloads cannot arise",
    ],
  },
  {
    path: "validation-design/operator-triage-runbook.md",
    required: [
      "F-PT-006 resolved-ratified and implemented 2026-08-12",
      "identity-field clarification 2026-08-16",
      "legacy filename or pre-clarification content mark re-fires its event",
      "five findings currently park cells: F-PT-012…016",
      "F-PT-017 (RESOLVED-ratified and implemented 2026-08-12; HB-P6)",
      "prints all **39** id/status pairs (F-PT-001…039",
    ],
    stale: [
      "event never fires (OPEN F-PT-006)",
      "OPEN DESIGN QUESTION — F-PT-006",
      "nine findings currently park cells: F-PT-006/008/012…018",
      "F-PT-017 (open-blocked-contract)",
      "prints all **33** id/status pairs (F-PT-001…033",
    ],
  },
  {
    path: "validation-design/harness-design-state.md",
    required: [
      "HB-P3 later landed the owner-ratified content-identity/no-producer-atomicity contract on 2026-08-12",
      "Implemented 2026-08-12 — HB-P3 landed",
      "Owner clarification 2026-08-16",
      "pre-clarification id-inclusive bare/per-role content marks",
      "F-PT-017 was later ratified and implemented on 2026-08-12",
      "F-PT-006 and F-PT-008 were ratified and implemented on 2026-08-12",
      "F-PT-008 (grant expiry post-decision) is distinct and was resolved-ratified and implemented on 2026-08-12",
    ],
    stale: [
      "Implementation owed under HB-P3",
      "F-PT-017 and F-PT-018 remain parked exactly as recorded below",
      "Remaining human decision points: F-PT-006 and F-PT-008",
      "F-PT-008 (grant expiry post-decision) remains open and distinct",
    ],
  },
  {
    path: "docs/loop/design.md",
    required: ["`interrupted` with `interrupted_reason: time_limit` and error code `error_wall_clock_exceeded`"],
    stale: ["`timed_out(error_wall_clock_exceeded)`"],
  },
  {
    path: "docs/harness/adding-updating.md",
    required: ["`cancelled` or `interrupted` with a required `time_limit`/`provider_crash` reason"],
    stale: ["`cancelled`/`timed_out`"],
  },
  {
    path: "docs/episodes/contract.md",
    required: ["legacy `timed_out` records normalize to `interrupted` with `interrupted_reason: time_limit`"],
    stale: ["`blocked` and `timed_out` are excluded"],
  },
  {
    path: "validation-design/validation-policy.yaml",
    required: [
      "Implemented under HB-P3 on 2026-08-12 with product changes and red-then-green detectors",
      "OWNER CLARIFICATION 2026-08-16",
      "raw validated producer payload after removing only top-level transport `filename` and producer `id`",
      "pre-clarification id-inclusive bare and per-role content marks suppress the entire clarified-identity group",
      "aliases never enter downstream turns, journals, traces, learning ids, or artifacts",
      "Implemented under HB-P6 on 2026-08-12 with product changes and red-then-green detectors",
      "Implemented under HB-P5 on 2026-08-12 with product changes and red-then-green detectors",
      "At this 2026-08-03 ruling F-PT-008 remained unresolved and distinct; the later 2026-08-12 owner decision resolved and implemented it",
      "original conflict (resolved 2026-08-12)",
    ],
    stale: [
      "Implementation owed under HB-P3",
      "Implementation owed under HB-P6",
      "Implementation owed under HB-P5",
      "default 24h, matching the grant TTL",
      "F-PT-008 is adjacent but NOT resolved",
      "product meaning and compatibility path are undecided",
    ],
  },
  {
    path: "validation-design/owner-backlog.md",
    required: [
      "HB-P3 / HB-P5 / HB-P6 — UNPARKED 2026-08-12 by your rulings",
      "clarified by you 2026-08-16",
      "excluding transport filename and producer id",
    ],
    stale: ["HB-P3 / HB-P5 / HB-P6 — still parked"],
  },
  {
    path: "tests/README.md",
    required: [
      "F-PT-006, F-PT-008, and F-PT-017 are resolved-ratified and implemented",
      "content-derived event identity excluding transport filename and producer id",
    ],
    stale: ["F-PT-006 cells, the F-PT-017 provider-terminal enum clause"],
  },
  {
    path: "tests/policy/cf-reg-278/policy-loader.ts",
    required: ["F-PT-006/008/017 resolved status"],
    stale: ["blocked findings F-PT-006/F-PT-008"],
  },
  {
    path: "tests/policy/cf-reg-278/policy-pin.test.ts",
    required: ["F-PT-006/008/017 resolutions"],
    stale: ["blocked findings F-PT-006/F-PT-008"],
  },
  {
    path: "tests/hermetic/cf-b17-cf-c-b17/cf-b17.test.ts",
    required: ["F-PT-006 is resolved-ratified: event identity is content-derived"],
    stale: ["BLOCKED:F-PT-006 (event producer visibility / duplicate identity)"],
  },
  {
    path: "tests/hermetic/cf-c-b32-cf-j12-cf-sm-learn/cf-sm-learn-r.test.ts",
    required: ["F-PT-006 is resolved-ratified: company-event identity is content-derived"],
    stale: ["BLOCKED:F-PT-006 — the company-event INBOX"],
  },
];

const normalize = (text: string): string => text.replace(/\s+/g, " ").trim();

function surfaceProblems(textByPath: ReadonlyMap<string, string>): string[] {
  const problems: string[] = [];
  for (const row of rows) {
    const text = textByPath.get(row.path) ?? "";
    for (const required of row.required) {
      if (!text.includes(required)) problems.push(`${row.path} missing resolved truth: ${required}`);
    }
    for (const stale of row.stale) {
      if (text.includes(stale)) problems.push(`${row.path} retains stale mirror: ${stale}`);
    }
  }
  return problems;
}

const requiredSeeds = rows.flatMap((row) => row.required.map((phrase) => [row.path, phrase] as const));
const staleSeeds = rows.flatMap((row) => row.stale.map((phrase) => [row.path, phrase] as const));

export function registerResolvedFindingSurfaceTests(repoRoot: string): void {
  describe("CF-REG-278 — resolved finding surfaces stay reconciled", () => {
    const authority = selectValidationAuthority(repoRoot);
    const actual = new Map(
      rows.map((row) => {
        const readPath =
          authority.kind === "model" && row.path === "validation-design/validation-policy.yaml"
            ? "validation-design/migration/legacy/validation-policy.yaml"
            : row.path;
        return [row.path, normalize(readFileSync(join(repoRoot, readPath), "utf8"))];
      }),
    );

    it("pins active F-PT-006/008/017 mirrors and the exact checked-model migration source", () => {
      expect(surfaceProblems(actual)).toEqual([]);
    });

    it.each(requiredSeeds)("negative control: removing %s resolved truth goes red", (path, phrase) => {
      const seeded = new Map(actual);
      seeded.set(path, (seeded.get(path) ?? "").split(phrase).join(""));
      expect(surfaceProblems(seeded)).toContain(`${path} missing resolved truth: ${phrase}`);
    });

    it.each(staleSeeds)("negative control: restoring %s stale truth goes red", (path, phrase) => {
      const seeded = new Map(actual);
      seeded.set(path, `${seeded.get(path) ?? ""} ${phrase}`);
      expect(surfaceProblems(seeded)).toContain(`${path} retains stale mirror: ${phrase}`);
    });
  });
}
