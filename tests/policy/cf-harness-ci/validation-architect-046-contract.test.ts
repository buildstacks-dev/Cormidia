// CF-HARNESS-CI — HB-P7 (legacy) / HB-140 (checked model) — #465 exact 0.4.6 migration and fresh-reader contract.

import { compile, CORPUS_SCHEMA, FakeRepositoryPort, migrate, type LegacyModelImportInput } from "validation-architect";
import { describe, expect, it } from "vitest";
import { registerValidationArchitect046OutputContractTests } from "./validation-architect-046-output-contract.js";

const revision = "a".repeat(40);
const catalog = `## Migration contract

| Cell | Family | Layer | Oracle | Risk |
| --- | --- | --- | --- | --- |
| CF-BASE | Compact dependency follow-up | 1 | state | E1 |
| CF-SPLIT | Split deterministic obligation | 1/2 | state | E1 |
`;
const backlog = `## Wave cutover

HB-BASE LANDED
HB-SPLIT PENDING

**HB-BASE — Compact dependency follow-up.** CF-BASE.

**HB-SPLIT — Split deterministic obligation.** CF-SPLIT.
`;

const control = (familyId: string) => ({
  id: `NC-${familyId}`,
  title: `${familyId} seeded violation`,
  owner: "OWNER",
  expected_failure: "The corresponding detector turns red",
});

function review(): LegacyModelImportInput {
  return {
    product: {
      id: "cormidia-046-contract",
      name: "Cormidia 0.4.6 contract fixture",
      revision,
      intended_use: "Exercise the exact migration and fresh-reader surfaces required by #465.",
      criticality: "C1",
      criticality_reason: "Offline deterministic fixture with no external effect.",
    },
    inner_loop_command: "pnpm test",
    owners: [{ id: "OWNER", name: "Validation owner", responsibility: "Own the cutover fixture." }],
    sources: [
      {
        id: "SOURCE-A-UNUSED",
        kind: "proposed",
        locator: "Owner review queue",
      },
      {
        id: "SOURCE-CONTRACT",
        kind: "doc",
        path: "docs/PRODUCT|CONTRACT.md",
        locator: "Fresh-reader | contract",
        quote: "Preserve every reviewed field | exactly.",
      },
    ],
    structures: [
      {
        id: "CON-CUTOVER",
        kind: "contract",
        title: "Cutover fidelity",
        meaning: "Every reviewed migration fact remains visible to a fresh reader.",
        owner: "OWNER",
        source_ids: ["SOURCE-CONTRACT"],
        acceptance_criteria: ["Preserve dependency order", "Render complete source records"],
        failure_modes: ["A split status silently inherits stale legacy state"],
        changed_paths: ["validation-design/**"],
      },
      {
        id: "IF-OPTIONAL-EMPTY",
        kind: "interface",
        title: "Optional-list projection",
        meaning: "Absent optional lists remain visibly absent.",
        owner: "OWNER",
        source_ids: ["SOURCE-CONTRACT"],
      },
    ],
    policy: {
      default: "blocking",
      inheritance: "tighten-only",
      layers: [
        { id: "L1", title: "Contract", status: "active" },
        { id: "L2", title: "Hermetic", status: "active" },
        { id: "L3", title: "Live", status: "declared-empty", reason: "No live target." },
        { id: "L4", title: "Evaluation", status: "declared-empty", reason: "No model target." },
        { id: "L5", title: "Operations", status: "declared-empty", reason: "No operations target." },
        { id: "L6", title: "Outcome", status: "declared-empty", reason: "No outcome target." },
      ],
      lanes: [
        {
          id: "inner-loop",
          title: "Inner loop",
          kind: "test",
          status: "active",
          requirement: "blocking",
          triggers: ["before-push"],
          command: "pnpm test",
        },
        {
          id: "per-commit",
          title: "Per commit",
          kind: "test",
          status: "active",
          requirement: "blocking",
          triggers: ["per-commit"],
          command: "pnpm test",
        },
        {
          id: "triggered",
          title: "Triggered",
          kind: "evidence",
          status: "declared-empty",
          requirement: "blocking",
          triggers: [],
          reason: "No triggered obligation.",
        },
        {
          id: "release",
          title: "Release",
          kind: "evidence",
          status: "declared-empty",
          requirement: "blocking",
          triggers: [],
          reason: "No release obligation.",
        },
        {
          id: "scheduled",
          title: "Scheduled",
          kind: "evidence",
          status: "declared-empty",
          requirement: "blocking",
          triggers: [],
          reason: "No scheduled obligation.",
        },
      ],
      exceptions: [],
    },
    families: {
      "CF-BASE": {
        title: "Compact dependency follow-up",
        meaning: "The compact legacy ticket retains its reviewed prerequisite.",
        structure_ids: ["CON-CUTOVER"],
        owner: "OWNER",
        source_ids: ["SOURCE-CONTRACT"],
        control: control("CF-BASE"),
        planned_tests: ["tests/cf-base.test.ts"],
      },
      "CF-SPLIT": {
        title: "Split deterministic obligation",
        meaning: "One legacy obligation has distinct L1 and L2 completion state.",
        structure_ids: ["CON-CUTOVER"],
        owner: "OWNER",
        source_ids: ["SOURCE-CONTRACT"],
        outputs: [
          {
            id: "CF-SPLIT",
            layer: "L1",
            lane: "per-commit",
            owner: "OWNER",
            structure_ids: ["CON-CUTOVER"],
            source_ids: ["SOURCE-CONTRACT"],
            ticket: "HB-SPLIT",
            control: control("CF-SPLIT"),
            planned_tests: ["tests/cf-split-l1.test.ts"],
          },
          {
            id: "CF-SPLIT-L2",
            layer: "L2",
            lane: "per-commit",
            owner: "OWNER",
            structure_ids: ["CON-CUTOVER"],
            source_ids: ["SOURCE-CONTRACT"],
            ticket: "HB-SPLIT-L2",
            control: control("CF-SPLIT-L2"),
            planned_tests: ["tests/cf-split-l2.test.ts"],
          },
        ],
      },
    },
    ticket_reviews: {
      "HB-BASE": {
        executor: "standing coding agent",
        acceptance_criteria: ["The compact follow-up runs after the L2 split detector."],
        depends_on: ["HB-SPLIT-L2"],
      },
      "HB-SPLIT": {
        outputs: [
          {
            id: "HB-SPLIT",
            title: "L1 split detector",
            owner: "OWNER",
            executor: "standing coding agent",
            lane: "per-commit",
            layer: "L1",
            status: "landed",
            acceptance_criteria: ["The L1 detector remains landed."],
            family_ids: ["CF-SPLIT"],
          },
          {
            id: "HB-SPLIT-L2",
            title: "L2 split detector",
            owner: "OWNER",
            executor: "standing coding agent",
            lane: "per-commit",
            layer: "L2",
            status: "pending",
            acceptance_criteria: ["The L2 detector remains pending."],
            family_ids: ["CF-SPLIT-L2"],
            depends_on: ["HB-SPLIT"],
          },
        ],
      },
    },
  };
}

async function compileReview(value: LegacyModelImportInput) {
  const migrated = migrate(
    { kind: "legacy-catalog", catalogMarkdown: catalog, backlogMarkdown: backlog, review: value },
    CORPUS_SCHEMA,
  );
  const files = Object.fromEntries(migrated.files.map((file) => [file.path, file.content]));
  return await compile(new FakeRepositoryPort({ revision, files }));
}

function splitOutput(value: LegacyModelImportInput) {
  const output = value.ticket_reviews["HB-SPLIT"]?.outputs?.find((candidate) => candidate.id === "HB-SPLIT");
  if (!output) throw new Error("split fixture output missing");
  return output;
}

describe("CF-HARNESS-CI — HB-140 — #465 — Validation Architect 0.4.6 contract", () => {
  it("preserves reviewed ticket order and renders complete fresh-reader facts", async () => {
    const compiled = await compileReview(review());
    expect(compiled.accepted, compiled.findings.map((finding) => finding.message).join("\n")).toBe(true);
    const backlogView = compiled.views["harness-backlog.md"];
    const trace = compiled.views["planned-trace.md"];
    if (!backlogView || !trace) throw new Error("0.4.6 generated views missing");
    expect(backlogView).toContain("**HB-BASE — Compact dependency follow-up** (landed;");
    expect(backlogView).toContain("Depends on `HB-SPLIT-L2`.");
    expect(backlogView).toContain("**HB-SPLIT — L1 split detector** (landed;");
    expect(backlogView).toContain("**HB-SPLIT-L2 — L2 split detector** (pending;");
    expect(backlogView).toContain("Depends on `HB-SPLIT`.");
    expect(trace).toContain("## Provenance registry");
    expect(trace).toContain(
      "| SOURCE-CONTRACT | doc | docs/PRODUCT\\|CONTRACT.md | Fresh-reader \\| contract | Preserve every reviewed field \\| exactly. |",
    );
    expect(trace).toContain("| SOURCE-A-UNUSED | proposed | — | Owner review queue | — |");
    expect(trace.indexOf("| SOURCE-A-UNUSED |")).toBeLessThan(trace.indexOf("| SOURCE-CONTRACT |"));
    expect(trace).toContain(
      "| CON-CUTOVER | contract | Every reviewed migration fact remains visible to a fresh reader. | Preserve dependency order, Render complete source records | A split status silently inherits stale legacy state | validation-design/** | SOURCE-CONTRACT | OWNER |",
    );
    expect(trace).toContain(
      "| IF-OPTIONAL-EMPTY | interface | Absent optional lists remain visibly absent. | — | — | — | SOURCE-CONTRACT | OWNER |",
    );
  });

  it("rejects malformed and duplicate reviewed dependencies during migration", async () => {
    const malformed = review();
    Object.assign(splitOutput(malformed), { depends_on: "HB-SPLIT-L2" });
    await expect(compileReview(malformed)).rejects.toThrow(/non-empty dependency ids/);

    const duplicate = review();
    splitOutput(duplicate).depends_on = ["HB-SPLIT-L2", "HB-SPLIT-L2"];
    await expect(compileReview(duplicate)).rejects.toThrow(/duplicate dependency ids/);
  });

  it.each([
    { name: "unknown", dependencies: ["HB-MISSING"], message: "depends on missing ticket" },
    { name: "self-referential", dependencies: ["HB-SPLIT"], message: "cannot depend on itself" },
    { name: "cyclic", dependencies: ["HB-SPLIT-L2"], message: "Ticket dependency cycle" },
  ])("rejects $name canonical dependencies", async ({ dependencies, message }) => {
    const value = review();
    splitOutput(value).depends_on = dependencies;
    const compiled = await compileReview(value);
    expect(compiled.accepted).toBe(false);
    expect(compiled.findings.map((finding) => finding.message).join("\n")).toContain(message);
  });
});

registerValidationArchitect046OutputContractTests({ catalog, backlog, review });
