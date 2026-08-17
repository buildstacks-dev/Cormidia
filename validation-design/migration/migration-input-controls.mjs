import { MIGRATION, assertPinnedInputs, migrateReviewedCorpus } from "./migration-contract.mjs";
import { runFidelityNegativeControls } from "./migration-fidelity-controls.mjs";
import { runLedgerNegativeControls } from "./migration-ledger-controls.mjs";
import {
  activeAuthorityProblems,
  modelEquivalenceProblems,
  policyProblems,
  retiredAuthorityProblems,
  reviewedLegacyMeaningProblems,
} from "./migration-model-equivalence.mjs";
import { runReviewNegativeControls } from "./migration-review-controls.mjs";

const clone = (value) => structuredClone(value);

function changed(value) {
  if (typeof value === "string") return `${value} MUTATED`;
  if (Array.isArray(value)) return [...value, "MUTATED"];
  if (value !== null && typeof value === "object") return { ...value, mutated: true };
  return "MUTATED";
}

function detected(controls, id, detail) {
  controls.push({ id, result: "detected", detail });
}

function expectThrow(controls, id, operation) {
  try {
    operation();
  } catch (error) {
    detected(controls, id, error instanceof Error ? error.message : String(error));
    return;
  }
  throw new Error(`negative control ${id} did not fail`);
}

function expectProblems(controls, id, operation, match) {
  const problems = operation();
  const selected = problems.find((problem) => problem.includes(match));
  if (!selected) throw new Error(`negative control ${id} did not detect ${match}: ${problems.join("; ")}`);
  detected(controls, id, selected);
}

function inputBoundaryControls(input, modelIdentity, controls) {
  const archive = clone(input);
  archive.legacy["case-catalog.md"] = `${archive.legacy["case-catalog.md"]}\nMUTATED\n`;
  expectThrow(controls, "archived-source-hash", () => assertPinnedInputs(archive));

  const artifact = clone(input);
  artifact.artifact[0] ^= 1;
  expectThrow(controls, "artifact-bytes", () => assertPinnedInputs(artifact));

  const support = clone(input);
  support.hostPolicyText = `${support.hostPolicyText}\nMUTATED\n`;
  expectThrow(controls, "host-policy-hash", () => assertPinnedInputs(support));

  const revision = clone(input);
  revision.review.product.revision = "0".repeat(40);
  expectThrow(controls, "product-revision", () => assertPinnedInputs(revision));

  const review = clone(input);
  review.reviewText = `${review.reviewText}\n# MUTATED\n`;
  expectThrow(controls, "review-mapping-hash", () =>
    assertPinnedInputs(review, { requireFinalPins: true, modelIdentity }),
  );
  expectThrow(controls, "model-identity-pin", () =>
    assertPinnedInputs(input, { requireFinalPins: true, modelIdentity: "0".repeat(64) }),
  );
}

function migrateInputControls(input, migration, controls) {
  const dropped = clone(input.review);
  delete dropped.families["CF-J01-S"];
  expectThrow(controls, "dropped-legacy-family", () => migrateReviewedCorpus(input, dropped));

  const missingControl = clone(input.review);
  delete missingControl.families["CF-J01-S"].outputs[0].control;
  expectThrow(controls, "missing-negative-control", () => migrateReviewedCorpus(input, missingControl));

  const missingProvenance = clone(input.review);
  missingProvenance.families["CF-J01-S"].outputs[0].source_ids = [];
  expectThrow(controls, "missing-provenance", () => migrateReviewedCorpus(input, missingProvenance));

  const duplicate = clone(input.review);
  duplicate.families["CF-J01-S"].outputs[0].id = input.review.families["CF-J01-R"].outputs[0].id;
  expectThrow(controls, "duplicate-family-output", () => migrateReviewedCorpus(input, duplicate));
  for (const field of ["oracle", "risk"]) {
    const malformed = clone(input.review);
    malformed.families["CF-ACC-S3"].outputs[0][field] = "";
    expectThrow(controls, `empty-family-output-${field}`, () => migrateReviewedCorpus(input, malformed));
  }

  const historical = migration.evidence.migration_ledger.tickets.find((ticket) => ticket.disposition === "historical");
  if (!historical) throw new Error("no historical ticket available for negative control");
  const historicalAction = clone(input.review);
  delete historicalAction.ticket_reviews[historical.legacy_id].historical;
  historicalAction.ticket_reviews[historical.legacy_id].executor = "build-agent";
  historicalAction.ticket_reviews[historical.legacy_id].acceptance_criteria = ["must not become actionable"];
  expectThrow(controls, "no-owner-ticket-actionability", () => migrateReviewedCorpus(input, historicalAction));
}

function policyControls(model, hostPolicy, controls) {
  const seeds = [
    [
      "policy-requirement",
      (policy) => (policy.lanes.find((lane) => lane.id === "per-commit").requirement = "advisory"),
    ],
    ["policy-authorization", (policy) => delete policy.lanes.find((lane) => lane.id === "live-release").authorization],
    ["policy-trigger", (policy) => policy.lanes.find((lane) => lane.id === "live-release").triggers.pop()],
    [
      "policy-lacc",
      (policy) => (policy.lanes.find((lane) => lane.id === "outcome-acceptance").requirement = "blocking"),
    ],
    ["policy-exception", (policy) => policy.exceptions.push({ id: "EX-LOOSE" })],
  ];
  for (const [id, mutate] of seeds) {
    const policy = clone(model.policy);
    mutate(policy);
    expectProblems(controls, id, () => policyProblems(policy, { ...model, policy }, hostPolicy), "drift");
  }
  const laneFamily = clone(model);
  laneFamily.families.find((family) => family.id === "CF-J16-A").lane = "live-triggered";
  expectProblems(
    controls,
    "release-lane-membership",
    () => policyProblems(laneFamily.policy, laneFamily, hostPolicy),
    "denominator",
  );
}

function modelControls(input, model, controls) {
  const seeds = [
    ["product-drift", (value) => (value.product.name += " MUTATED"), "reviewed product object drift"],
    ["owner-record-drift", (value) => (value.owners[0].name += " MUTATED"), "reviewed owners object drift"],
    ["source-record-drift", (value) => (value.sources[0].kind = "proposed"), "reviewed sources object drift"],
    [
      "structure-record-drift",
      (value) => (value.structures[0].meaning += " MUTATED"),
      "reviewed structures object drift",
    ],
    ["control-record-drift", (value) => (value.controls[0].title += " MUTATED"), "negative-control record drift"],
    [
      "family-layer-drift",
      (value) => (value.families.find((item) => item.id === "CF-J01-S").layer = "L6"),
      "exact layer drift",
    ],
    [
      "family-lane-drift",
      (value) => (value.families.find((item) => item.id === "CF-J01-S").lane = "inner-loop"),
      "exact lane drift",
    ],
    [
      "family-exclusion-drift",
      (value) => (value.families.find((item) => item.id === "CF-J01-S").exclusions = ["MUTATED"]),
      "exact exclusions drift",
    ],
    [
      "family-output-invented",
      (value) => value.families.push({ ...value.families[0], id: "CF-INVENTED" }),
      "family IDs differ",
    ],
    ["family-output-dropped", (value) => value.families.shift(), "family IDs differ"],
  ];
  for (const [id, mutate, match] of seeds) {
    const seeded = clone(model);
    mutate(seeded);
    expectProblems(controls, id, () => modelEquivalenceProblems(input, seeded), match);
  }
  for (const field of [
    "title",
    "meaning",
    "structure_ids",
    "owner",
    "source_ids",
    "status",
    "oracle",
    "risk",
    "control_ids",
    "ticket",
    "planned_tests",
    "evidence",
    "blocked_by",
    "reason",
  ]) {
    const seeded = clone(model);
    const family = seeded.families.find((candidate) => candidate[field] !== undefined);
    if (!family) throw new Error(`no family ${field} value available for negative control`);
    family[field] = changed(family[field]);
    expectProblems(
      controls,
      `family-${field.replaceAll("_", "-")}-drift`,
      () => modelEquivalenceProblems(input, seeded),
      `exact ${field} drift`,
    );
  }
  const archive = clone(model);
  archive.sources[0].path = "./validation-design/migration/legacy/case-catalog.md";
  expectProblems(
    controls,
    "canonical-archive-path",
    () => activeAuthorityProblems(archive),
    "migration archive active",
  );
  for (const retired of MIGRATION.retiredRootNames) {
    expectProblems(
      controls,
      `retired-root-${retired}`,
      () => retiredAuthorityProblems([retired]),
      "retired root authority",
    );
  }
  const reviewedMeaning = clone(input);
  reviewedMeaning.review.families["CF-J01-S"].meaning += " MUTATED";
  expectProblems(
    controls,
    "reviewed-family-meaning-normalization",
    () => reviewedLegacyMeaningProblems(reviewedMeaning),
    "does not equal its unique complete archived catalog row",
  );
}

export function runInputNegativeControls({
  input,
  migration,
  model,
  ledger,
  expectedLedger,
  ledgerText,
  expectedLedgerText,
  fidelitySources,
}) {
  const controls = [];
  inputBoundaryControls(input, ledger.model_identity, controls);
  migrateInputControls(input, migration, controls);
  policyControls(model, input.hostPolicy, controls);
  modelControls(input, model, controls);
  controls.push(...runLedgerNegativeControls({ input, model, ledger, expectedLedger, ledgerText, expectedLedgerText }));
  controls.push(...runReviewNegativeControls(input));
  controls.push(...runFidelityNegativeControls(input, fidelitySources));
  return controls;
}
