import { reviewFidelityProblems, ticketDependencyPatchPlan } from "./review-fidelity.mjs";

const clone = (value) => structuredClone(value);

function expectProblems(controls, id, operation, match) {
  const problems = operation();
  const selected = problems.find((problem) => problem.includes(match));
  if (!selected) throw new Error(`negative control ${id} did not detect ${match}: ${problems.join("; ")}`);
  controls.push({ id, result: "detected", detail: selected });
}

function structureControls(input, shared, controls) {
  const journey = clone(input.review);
  journey.structures = journey.structures.filter((structure) => structure.id !== "J-01");
  expectProblems(
    controls,
    "missing-journey-structure",
    () => reviewFidelityProblems({ ...shared, review: journey }),
    "journey ids differ",
  );
  const boundary = clone(input.review);
  boundary.structures = boundary.structures.filter((structure) => structure.id !== "B-31");
  expectProblems(
    controls,
    "missing-b31-boundary",
    () => reviewFidelityProblems({ ...shared, review: boundary }),
    "boundary ids differ",
  );
  for (const [id, structureId, mutate, match] of [
    ["source-exact-interface", "INTERFACE-GITHUB", (value) => (value.meaning += " MUTATED"), "exact interface facts"],
    ["source-exact-llm-site", "S-1", (value) => (value.meaning += " MUTATED"), "exact LLM-site facts"],
    [
      "source-exact-invariant",
      "CORMIDIA-INV-ACC-2",
      (value) => (value.meaning += " MUTATED"),
      "differs from exact invariant clauses",
    ],
  ]) {
    const review = clone(input.review);
    const structure = review.structures.find((item) => item.id === structureId);
    if (!structure) throw new Error(`${structureId} unavailable for negative control`);
    mutate(structure);
    expectProblems(controls, id, () => reviewFidelityProblems({ ...shared, review }), match);
  }
  const impactMap = clone(input.review);
  impactMap.structures[0].changed_paths = ["src/invented.ts"];
  expectProblems(
    controls,
    "unreviewed-structure-impact-map",
    () => reviewFidelityProblems({ ...shared, review: impactMap }),
    "claims an unreviewed implementation impact map",
  );
}

function contractControls(input, shared, controls) {
  const contractPreamble = clone(input.review);
  const b31 = contractPreamble.structures.find((structure) => structure.id === "CONTRACT-B-31");
  const preambleIndex = b31?.acceptance_criteria.findIndex((criterion) => criterion.startsWith("Contract preamble:"));
  if (preambleIndex === undefined || preambleIndex < 0) {
    throw new Error("CONTRACT-B-31 preamble unavailable for negative control");
  }
  b31.acceptance_criteria[preambleIndex] += " MUTATED";
  expectProblems(
    controls,
    "contract-preamble-drift",
    () => reviewFidelityProblems({ ...shared, review: contractPreamble }),
    "CONTRACT-B-31 differs from exact contract clauses",
  );
}

function resolvedFindingControls(input, shared, controls) {
  const boundary = clone(input.review);
  const b13 = boundary.structures.find((structure) => structure.id === "B-13");
  if (!b13) throw new Error("B-13 unavailable for negative control");
  b13.meaning = "Open product truth — F-PT-006: producer visibility is unknown.";
  expectProblems(
    controls,
    "resolved-fpt006-boundary-regression",
    () => reviewFidelityProblems({ ...shared, review: boundary }),
    "resolved F-PT-006 content-identity/no-atomicity contract",
  );

  const contract = clone(input.review);
  const b13Contract = contract.structures.find((structure) => structure.id === "CONTRACT-B-13");
  if (!b13Contract) throw new Error("CONTRACT-B-13 unavailable for negative control");
  b13Contract.acceptance_criteria = [
    "Event identity is never a producer-supplied id; exactly one firing per real-world event.",
  ];
  expectProblems(
    controls,
    "resolved-fpt006-contract-regression",
    () => reviewFidelityProblems({ ...shared, review: contract }),
    "exact clarified identity and suppressive migration semantics",
  );

  const ticket = clone(input.review);
  const hb040 = ticket.ticket_reviews["HB-040"]?.outputs?.[0];
  if (!hb040) throw new Error("HB-040 unavailable for negative control");
  hb040.acceptance_criteria[0] = "Exact source-ticket facts: Event inbox (F-PT-006 clauses parked).";
  expectProblems(
    controls,
    "resolved-fpt006-ticket-regression",
    () => reviewFidelityProblems({ ...shared, review: ticket }),
    "resolved F-PT-006 ticket disposition",
  );

  const grant = clone(input.review);
  const hb012 = grant.ticket_reviews["HB-012"]?.outputs?.[0];
  if (!hb012) throw new Error("HB-012 unavailable for negative control");
  hb012.acceptance_criteria[0] = "Exact source-ticket facts: Continuation/resume (F-PT-008 clause parked).";
  expectProblems(
    controls,
    "resolved-fpt008-ticket-regression",
    () => reviewFidelityProblems({ ...shared, review: grant }),
    "resolved F-PT-008 ticket disposition",
  );
}

function ownerDecisionControls(input, shared, controls) {
  for (const [id, sourceId, locator, match] of [
    ["fpt033-actionable-source", "SOURCE-PROPOSED-FPT-033", "Choose strict or lenient.", "F-PT-033 owner decision"],
    [
      "provider-family-actionable-source",
      "SOURCE-SIMULATED-REVIEW-INDEPENDENCE",
      "Provider family is the owner ruling.",
      "provider-family owner decision",
    ],
  ]) {
    const review = clone(input.review);
    review.sources.find((source) => source.id === sourceId).locator = locator;
    expectProblems(controls, id, () => reviewFidelityProblems({ ...shared, review }), match);
  }
  const providerTicket = clone(input.review);
  const hb133 = providerTicket.ticket_reviews["HB-133"]?.outputs?.[0];
  if (!hb133) throw new Error("HB-133 unavailable for negative control");
  hb133.acceptance_criteria[0] = hb133.acceptance_criteria[0]
    .replace("[simulated]", "[human-ratified]")
    .replace("pending attributable human ratification", "owner ruling");
  expectProblems(
    controls,
    "provider-family-ticket-ratification-drift",
    () => reviewFidelityProblems({ ...shared, review: providerTicket }),
    "HB-133 does not preserve",
  );
}

function familyOutputSemanticControls(input, shared, controls) {
  for (const [id, field, value] of [
    ["statistical-oracle", "oracle", "evid+state"],
    ["mechanical-risk", "risk", "L4Q"],
  ]) {
    const review = clone(input.review);
    const outputId = id === "statistical-oracle" ? "CF-ACC-S3" : "CF-ACC-S3-L1";
    const output = review.families["CF-ACC-S3"].outputs.find((candidate) => candidate.id === outputId);
    output[field] = value;
    expectProblems(
      controls,
      `family-output-${id}-drift`,
      () => reviewFidelityProblems({ ...shared, review }),
      "statistical/mechanical oracle and risk split",
    );
  }
}

function ownerTicketControls(input, shared, controls) {
  const review = clone(input.review);
  const hb140 = review.ticket_reviews["HB-P7"]?.outputs?.find((output) => output.id === "HB-140");
  if (!hb140) throw new Error("HB-140 unavailable for negative control");
  hb140.acceptance_criteria[0] =
    "Exact source-ticket facts: rerun case-catalog-generator.awk and compare case-catalog.yaml.";
  expectProblems(
    controls,
    "checked-model-hb140-representation",
    () => reviewFidelityProblems({ ...shared, review }),
    "HB-140 does not preserve",
  );

  for (const [id, mutate, match] of [
    [
      "abuse-admission-ticket-fact",
      (value) => {
        value.ticket_reviews["HB-073"].outputs.find((output) => output.id === "HB-073-L5").acceptance_criteria[0] =
          "Exact source-ticket facts: Abuse cases remain gated on HB-072.";
      },
      "HB-073 ticket outputs differ",
    ],
    [
      "abuse-admission-status",
      (value) => {
        value.ticket_reviews["HB-073"].outputs.find((output) => output.id === "HB-073-L5").status = "pending";
      },
      "HB-073 ticket outputs differ",
    ],
    [
      "abuse-admission-dependency",
      (value) => {
        value.ticket_reviews["HB-073"].outputs.find((output) => output.id === "HB-073-L5").depends_on = ["HB-072"];
      },
      "HB-073 ticket outputs differ",
    ],
    [
      "abuse-output-oracle",
      (value) => {
        value.families["CF-OPS-ABUSE"].outputs.find((output) => output.id === "CF-OPS-ABUSE-ADMISSION").oracle =
          "mixed";
      },
      "CF-OPS-ABUSE family outputs differ",
    ],
  ]) {
    const mutated = clone(input.review);
    mutate(mutated);
    expectProblems(controls, id, () => reviewFidelityProblems({ ...shared, review: mutated }), match);
  }
}

function dependencyControls(input, shared, controls) {
  const dependencyPlan = ticketDependencyPatchPlan({
    review: input.review,
    backlogMarkdown: shared.backlogMarkdown,
  });
  const actionableRelation = dependencyPlan.find((relation) => relation.output_patches.length > 0);
  const actionablePatch = actionableRelation?.output_patches[0];
  if (!actionableRelation || !actionablePatch) {
    throw new Error("no actionable dependency disposition available for negative control");
  }
  const actionableDependency = clone(input.review);
  const actionableOutput = actionableDependency.ticket_reviews[actionableRelation.legacy_ticket_id].outputs.find(
    (output) => output.id === actionablePatch.output_id,
  );
  actionableOutput.acceptance_criteria = actionableOutput.acceptance_criteria.filter(
    (criterion) => criterion !== actionablePatch.acceptance_disposition,
  );
  expectProblems(
    controls,
    "actionable-dependency-disposition",
    () => reviewFidelityProblems({ ...shared, review: actionableDependency }),
    "omits its explicit dependency representation disposition",
  );

  const historicalRelation = dependencyPlan.find((relation) => relation.reason_disposition);
  if (!historicalRelation) throw new Error("no historical dependency disposition available for negative control");
  const historicalDependency = clone(input.review);
  historicalDependency.ticket_reviews[historicalRelation.legacy_ticket_id].historical.reason =
    "MUTATED: source dependency disposition removed";
  expectProblems(
    controls,
    "historical-dependency-disposition",
    () => reviewFidelityProblems({ ...shared, review: historicalDependency }),
    "omits its source-fact-only dependency disposition",
  );
}

export function runFidelityNegativeControls(input, fidelitySources) {
  const controls = [];
  const shared = { ...fidelitySources, sourceTexts: fidelitySources.sourceTexts };
  const archive = clone(input.review);
  const actionable = Object.values(archive.ticket_reviews).find((review) => review.outputs?.length);
  actionable.outputs[0].acceptance_criteria[0] = "Satisfy validation-design/migration/legacy/harness-backlog.md.";
  expectProblems(
    controls,
    "archive-delegating-ticket",
    () => reviewFidelityProblems({ ...shared, review: archive }),
    "exact self-contained acceptance",
  );
  structureControls(input, shared, controls);
  contractControls(input, shared, controls);
  resolvedFindingControls(input, shared, controls);
  ownerDecisionControls(input, shared, controls);
  familyOutputSemanticControls(input, shared, controls);
  ownerTicketControls(input, shared, controls);
  dependencyControls(input, shared, controls);
  return controls;
}
