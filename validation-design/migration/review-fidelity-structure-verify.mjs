import { fidelityConfig } from "./review-fidelity-config.mjs";
import {
  contractFacts,
  interfaceFacts,
  llmSiteFacts,
  operationFacts,
  stateMachineFacts,
  structureFidelity,
} from "./review-fidelity-extract.mjs";
import { boundaryFacts, journeyFacts } from "./review-fidelity-source.mjs";
import { expectedInvariantIds, invariantFacts } from "./review-fidelity-invariant.mjs";

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function checkIds(problems, label, actual, expected) {
  if (!same([...actual].sort(), [...expected].sort()))
    problems.push(
      `${label} ids differ: expected ${[...expected].sort().join(", ")}; found ${[...actual].sort().join(", ")}`,
    );
}

export function structureFidelityProblems({
  review,
  systemMapText,
  journeyAcceptanceText,
  boundaryMapText,
  sourceTexts,
}) {
  const problems = [];
  const journeys = review.structures.filter((structure) => structure.kind === "journey");
  const expectedJourneys = new Map(
    journeyFacts(systemMapText, journeyAcceptanceText).map((journey) => [journey.id, journey]),
  );
  const expectedBoundaries = new Map(boundaryFacts(boundaryMapText).map((boundary) => [boundary.id, boundary]));
  const withoutGap = (meaning) => meaning.replace(` ${structureFidelity.unresolvedPathMeaning}`, "");
  for (const [label, actual, expected] of [
    ["journey", journeys.map((item) => item.id), expectedJourneys.keys()],
    [
      "boundary",
      review.structures.filter((item) => item.kind === "boundary").map((item) => item.id),
      expectedBoundaries.keys(),
    ],
    [
      "invariant",
      review.structures.filter((item) => item.kind === "invariant").map((item) => item.id),
      expectedInvariantIds,
    ],
    [
      "contract",
      review.structures.filter((item) => item.kind === "contract").map((item) => item.id),
      structureFidelity.expectedContracts,
    ],
    [
      "interface",
      review.structures.filter((item) => item.kind === "interface").map((item) => item.id),
      structureFidelity.expectedInterfaces,
    ],
    [
      "LLM site",
      review.structures.filter((item) => item.kind === "llm-site").map((item) => item.id),
      structureFidelity.expectedLlmSites,
    ],
    [
      "operation",
      review.structures.filter((item) => structureFidelity.expectedOperations.includes(item.id)).map((item) => item.id),
      structureFidelity.expectedOperations,
    ],
    [
      "state machine",
      review.structures
        .filter((item) => structureFidelity.expectedStateMachines.includes(item.id))
        .map((item) => item.id),
      structureFidelity.expectedStateMachines,
    ],
  ])
    checkIds(problems, label, actual, expected);
  for (const journey of journeys) {
    const expected = expectedJourneys.get(journey.id);
    const expectedMeaning = fidelityConfig.journeyMeaningOverrides.get(journey.id) ?? expected?.meaning;
    const expectedAcceptanceCriteria = [
      ...(expected?.acceptance_criteria ?? []),
      ...(fidelityConfig.journeyAdditionalCriteria.get(journey.id) ?? []),
    ];
    if (
      !expected ||
      journey.title !== expected.title ||
      withoutGap(journey.meaning) !== expectedMeaning ||
      !same(journey.acceptance_criteria, expectedAcceptanceCriteria)
    )
      problems.push(`${journey.id} differs from exact journey sources`);
  }
  for (const structure of review.structures) {
    if ((structure.changed_paths ?? []).length)
      problems.push(`${structure.id} claims an unreviewed implementation impact map`);
    if (!structure.meaning.endsWith(structureFidelity.unresolvedPathMeaning))
      problems.push(`${structure.id} hides its unresolved implementation-path mapping`);
    if (!structure.title?.trim() || !structure.meaning?.trim() || structure.meaning.includes("undefined"))
      problems.push(`${structure.id} has truncated structure facts`);
    if (structureFidelity.genericMeaning.test(structure.meaning))
      problems.push(`${structure.id} retains a pointer/generic meaning`);
    if (["contract", "interface", "operation"].includes(structure.kind) && !structure.acceptance_criteria?.length)
      problems.push(`${structure.id} lacks self-contained clauses`);
  }
  for (const structure of review.structures.filter((item) => item.kind === "boundary")) {
    const expected = expectedBoundaries.get(structure.id);
    const expectedMeaning = fidelityConfig.structureMeaningOverrides.get(structure.id) ?? expected?.meaning;
    if (structure.title.endsWith("(")) problems.push(`${structure.id} has a truncated title`);
    if ((structure.failure_modes ?? []).some((mode) => fidelityConfig.forbiddenFailureLabel.test(mode)))
      problems.push(`${structure.id} misattributes non-failure metadata`);
    if (
      !expected ||
      structure.title !== expected.title ||
      withoutGap(structure.meaning) !== expectedMeaning ||
      !same(structure.failure_modes, expected.failure_modes)
    )
      problems.push(`${structure.id} differs from exact logical boundary extraction`);
  }
  const expectedInterfaces = interfaceFacts(systemMapText, review.families);
  for (const id of structureFidelity.expectedInterfaces) {
    const structure = review.structures.find((item) => item.id === id);
    const expected = expectedInterfaces.get(id);
    if (
      !structure ||
      !expected ||
      structure.title !== expected.title ||
      withoutGap(structure.meaning) !== expected.meaning ||
      !same(structure.acceptance_criteria, expected.acceptance_criteria)
    )
      problems.push(`${id} differs from exact interface facts`);
  }
  const expectedLlmSites = new Map(llmSiteFacts(sourceTexts["SOURCE-LLM-EVAL"] ?? "").map((site) => [site.id, site]));
  for (const id of structureFidelity.expectedLlmSites) {
    const structure = review.structures.find((item) => item.id === id);
    const expected = expectedLlmSites.get(id);
    if (
      !structure ||
      !expected ||
      structure.title !== expected.title ||
      withoutGap(structure.meaning) !== expected.meaning ||
      !same(structure.acceptance_criteria, expected.acceptance_criteria)
    )
      problems.push(`${id} differs from exact LLM-site facts`);
  }
  if (sourceTexts["SOURCE-INVARIANTS"]) {
    const expectedInvariants = new Map(
      invariantFacts(sourceTexts["SOURCE-INVARIANTS"]).map((invariant) => [invariant.id, invariant]),
    );
    checkIds(problems, "authored invariant", expectedInvariants.keys(), expectedInvariantIds);
    for (const id of expectedInvariantIds) {
      const structure = review.structures.find((item) => item.id === id);
      const expected = expectedInvariants.get(id);
      if (
        !structure ||
        !expected ||
        structure.title !== expected.title ||
        withoutGap(structure.meaning) !== expected.meaning ||
        !same(structure.acceptance_criteria, expected.acceptance_criteria) ||
        !same(structure.failure_modes, expected.failure_modes)
      )
        problems.push(`${id} differs from exact invariant clauses`);
    }
  }
  const expectedOperations = operationFacts(sourceTexts, review.families);
  if (Object.keys(sourceTexts).length)
    for (const id of structureFidelity.expectedOperations) {
      const structure = review.structures.find((item) => item.id === id);
      const expected = expectedOperations.get(id);
      if (
        expected?.meaning &&
        (!structure ||
          withoutGap(structure.meaning) !== expected.meaning ||
          !same(structure.acceptance_criteria, expected.acceptance_criteria.filter(Boolean)))
      )
        problems.push(`${id} differs from exact operation facts`);
    }
  for (const id of structureFidelity.expectedStateMachines) {
    const structure = review.structures.find((item) => item.id === id);
    const expected = stateMachineFacts(id, review.families);
    if (
      !structure ||
      withoutGap(structure.meaning) !== expected.meaning ||
      !same(structure.acceptance_criteria, expected.acceptance_criteria)
    )
      problems.push(`${id} differs from exact state-machine facts`);
  }
  for (const structure of review.structures.filter((item) => item.kind === "contract")) {
    const sourceId = structure.source_ids.find((id) => id.startsWith("SOURCE-CONTRACT-"));
    if (!sourceTexts[sourceId]) continue;
    const { inherits_provider_core: inheritsProviderCore, ...expected } = contractFacts(
      sourceTexts[sourceId],
      sourceTexts["SOURCE-CONTRACT-PROVIDER-ADAPTER-CORE"],
    );
    const contractAcceptanceReplacement = fidelityConfig.contractAcceptanceReplacements.get(structure.id);
    if (contractAcceptanceReplacement)
      expected.acceptance_criteria = expected.acceptance_criteria.map((criterion) =>
        criterion.replace(...contractAcceptanceReplacement),
      );
    if (inheritsProviderCore && !structure.source_ids.includes("SOURCE-CONTRACT-PROVIDER-ADAPTER-CORE"))
      problems.push(`${structure.id} omits shared provider-core clauses`);
    if (
      structure.title !== expected.title ||
      withoutGap(structure.meaning) !== expected.meaning ||
      !same(structure.acceptance_criteria, expected.acceptance_criteria)
    )
      problems.push(`${structure.id} differs from exact contract clauses`);
  }
  return problems;
}
