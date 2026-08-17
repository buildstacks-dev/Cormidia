import { fidelityConfig } from "./review-fidelity-config.mjs";
import { currentFactProblems } from "./review-fidelity-current-verify.mjs";
import { ticketFacts } from "./review-fidelity-source.mjs";
import { structureFidelityProblems } from "./review-fidelity-structure-verify.mjs";
import {
  familyOutputSemanticProblems,
  ownerTicketOutputPlan,
  ownerTicketRepresentationProblems,
} from "./review-fidelity-owner.mjs";
import { hb155OutputPatchPlan, ticketDependencyPatchPlan } from "./review-fidelity-ticket-plan.mjs";

export function collectReviewFidelityProblems({
  review,
  backlogMarkdown,
  systemMapText,
  journeyAcceptanceText,
  boundaryMapText,
  sourceTexts = {},
}) {
  const problems = [];
  const sourceIds = new Set(review.sources.map((source) => source.id));
  const expectedTickets = ticketFacts(backlogMarkdown);
  const ownerTicketIds = new Set(ownerTicketOutputPlan().map((output) => output.output_id));
  problems.push(...familyOutputSemanticProblems(review));
  problems.push(...ownerTicketRepresentationProblems({ review, canonicalTicketFacts: expectedTickets }));
  problems.push(...currentFactProblems(review));
  const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const exactIds = (label, actual, expected) => {
    if (!same([...actual].sort(), [...expected].sort()))
      problems.push(
        `${label} ids differ: expected ${[...expected].sort().join(", ")}; found ${[...actual].sort().join(", ")}`,
      );
  };
  if (review.product.revision !== fidelityConfig.stagingRevision)
    problems.push(`product revision must be ${fidelityConfig.stagingRevision}`);
  problems.push(
    ...structureFidelityProblems({ review, systemMapText, journeyAcceptanceText, boundaryMapText, sourceTexts }),
  );
  if (
    [...sourceIds].some((id) => fidelityConfig.legacySource.test(id)) ||
    JSON.stringify(review).includes("SOURCE-LEGACY-")
  )
    problems.push("active review still cites legacy sources");
  for (const [id, family] of Object.entries(review.families)) {
    const journey = id.match(fidelityConfig.journeyFamily)?.[1];
    if (journey) {
      const expected = [`J-${journey}`];
      const linked = family.structure_ids.filter((structureId) => /^J-\d{2}$/.test(structureId));
      if (!same(linked, expected)) problems.push(`${id} has incorrect journey links`);
      for (const output of family.outputs ?? []) {
        const outputLinks = output.structure_ids.filter((structureId) => /^J-\d{2}$/.test(structureId));
        const expectedOutput =
          fidelityConfig.j13RecoveryFamily.test(output.id) && output.control?.id && output.ticket
            ? [...expected, "J-13"]
            : expected;
        if (!same(outputLinks, expectedOutput)) problems.push(`${output.id} has incorrect journey links`);
      }
    }
  }
  const j13MappedOutputs = Object.values(review.families)
    .flatMap((family) => family.outputs ?? [])
    .filter(
      (output) =>
        fidelityConfig.j13RecoveryFamily.test(output.id) &&
        output.control?.id &&
        output.ticket &&
        output.structure_ids.includes("J-13"),
    );
  const mappedJ13Journeys = new Set(j13MappedOutputs.map((output) => `J-${output.id.slice(4, 6)}`));
  const expectedJ13Journeys = new Set(
    Array.from({ length: 23 }, (_, index) => `J-${String(index + 1).padStart(2, "0")}`).filter((id) => id !== "J-13"),
  );
  if (!same([...mappedJ13Journeys].sort(), [...expectedJ13Journeys].sort())) {
    problems.push("CF-J13 does not map every other journey to an existing recovery control and ticket");
  }
  const j13Meaning = review.families["CF-J13"]?.meaning ?? "";
  for (const output of j13MappedOutputs) {
    const mapping = `${output.id} → ${output.control.id} → ${output.ticket}`;
    if (!j13Meaning.includes(mapping)) problems.push(`CF-J13 omits exact mapped closure ${mapping}`);
  }
  const comparisonOps = review.families["CF-OPS-COMP"];
  const expectedComparisonStructures = ["J-19", "B-18", "B-19", "OP-CONTENTION"];
  if (
    !same(comparisonOps?.structure_ids ?? [], expectedComparisonStructures) ||
    (comparisonOps?.outputs ?? []).some(
      (output) => !same(output.structure_ids, expectedComparisonStructures) || output.control !== undefined,
    ) ||
    !comparisonOps?.meaning.includes("harness-revision") ||
    comparisonOps?.meaning.includes("OP-ABUSE")
  ) {
    problems.push("CF-OPS-COMP omits its comparison-risk routing and pre-activation harness-revision boundary");
  }
  const linkedStructures = new Set(
    Object.values(review.families).flatMap((family) =>
      (family.outputs ?? []).flatMap((output) => output.structure_ids ?? []),
    ),
  );
  for (const structure of review.structures)
    if (!linkedStructures.has(structure.id)) problems.push(`${structure.id} has no canonical family owner`);
  for (const [structureId, expectedFamilyIds] of fidelityConfig.interfaceFamilyLinks) {
    const actualFamilyIds = Object.entries(review.families)
      .filter(([, family]) => (family.outputs ?? []).some((output) => output.structure_ids.includes(structureId)))
      .map(([id]) => id);
    if (!same(actualFamilyIds.sort(), [...expectedFamilyIds].sort()))
      problems.push(`${structureId} differs from exact reviewed interface-family ownership`);
    for (const familyId of expectedFamilyIds)
      if ((review.families[familyId].outputs ?? []).some((output) => !output.structure_ids.includes(structureId)))
        problems.push(`${familyId} does not link every output to ${structureId}`);
  }
  for (const [legacyId, ticket] of Object.entries(review.ticket_reviews))
    for (const output of ticket.outputs ?? []) {
      const expectedTicketFact = expectedTickets.get(output.id) ?? expectedTickets.get(legacyId);
      const expectedReaderFact = fidelityConfig.ticketOutputOverrides.get(output.id)?.sourceFact ?? expectedTicketFact;
      const exactSourceFact = ownerTicketIds.has(output.id)
        ? output.acceptance_criteria.some((criterion) =>
            criterion.startsWith(fidelityConfig.sourceTicketProvenancePrefix),
          )
        : output.acceptance_criteria.includes(`${fidelityConfig.sourceTicketProvenancePrefix}${expectedReaderFact}`);
      if (
        !exactSourceFact ||
        output.acceptance_criteria.some((item) => item.includes("migration/legacy")) ||
        output.acceptance_criteria.some((item) => item.includes("Ticket status register")) ||
        (!ownerTicketIds.has(output.id) &&
          expectedTicketFact?.includes("Gate:") &&
          !output.acceptance_criteria.join(" ").includes("Gate:"))
      )
        problems.push(`${legacyId}/${output.id} lacks exact self-contained acceptance`);
      else if (
        /checked Validation Architect model and tighten-only Cormidia host policy.{0,80}(?:harness_self_tests|verdict_semantics|open_findings)/.test(
          output.acceptance_criteria.join(" "),
        )
      )
        problems.push(`${legacyId}/${output.id} invents a retired-field authority path`);
    }
  exactIds(
    "policy lane",
    review.policy.lanes.map((lane) => lane.id),
    fidelityConfig.expectedLaneFacts.keys(),
  );
  if (review.policy.lanes.filter((lane) => lane.status === "active").length !== 11)
    problems.push("policy must contain exactly 11 active lanes");
  if (review.policy.lanes.filter((lane) => lane.authorization === "per-run-human").length !== 9)
    problems.push("policy must contain exactly 9 per-run-human lanes");
  for (const lane of review.policy.lanes) {
    const expected = fidelityConfig.expectedLaneFacts.get(lane.id);
    if (
      !expected ||
      lane.title !== expected[0] ||
      lane.kind !== expected[1] ||
      (expected[2] ? lane.authorization !== expected[2] : lane.authorization !== undefined)
    )
      problems.push(`${lane.id} has incorrect title, kind, or authorization`);
  }
  const dependencyPlan = ticketDependencyPatchPlan({ review, backlogMarkdown });
  if (dependencyPlan.length !== 20)
    problems.push(`expected 20 source dependency relations; found ${dependencyPlan.length}`);
  exactIds(
    "dependency representation disposition",
    dependencyPlan.flatMap((relation) => relation.representation_dispositions),
    fidelityConfig.expectedDependencyDispositions,
  );
  const outputLayers = new Map(
    Object.values(review.ticket_reviews).flatMap((ticket) =>
      (ticket.outputs ?? []).map((output) => [output.id, Number(output.layer.match(/^L([1-6])$/)?.[1] ?? Number.NaN)]),
    ),
  );
  for (const relation of dependencyPlan) {
    if (!relation.source_fact) problems.push(`${relation.legacy_ticket_id} loses its source dependency fact`);
    if (
      relation.reason_disposition &&
      !review.ticket_reviews[relation.legacy_ticket_id].historical?.reason?.endsWith(relation.reason_disposition)
    )
      problems.push(`${relation.legacy_ticket_id} omits its source-fact-only dependency disposition`);
    for (const patch of relation.output_patches) {
      const output = review.ticket_reviews[relation.legacy_ticket_id].outputs.find(
        (candidate) => candidate.id === patch.output_id,
      );
      if (!output?.acceptance_criteria.includes(patch.acceptance_disposition))
        problems.push(`${patch.output_id} omits its explicit dependency representation disposition`);
      if (!same(output?.depends_on ?? [], patch.depends_on))
        problems.push(`${patch.output_id} does not preserve its exact canonical dependency outputs`);
      if (patch.depends_on.length + patch.unresolved.length !== relation.dependency_ticket_ids.length)
        problems.push(`${patch.output_id} does not disposition every source dependency`);
      const targetLayer = Number(patch.layer.match(/^L([1-6])$/)?.[1] ?? Number.NaN);
      if (
        [1, 2].includes(targetLayer) &&
        patch.depends_on.some((id) => Number.isFinite(outputLayers.get(id)) && outputLayers.get(id) > targetLayer)
      )
        problems.push(`${patch.output_id} received a live/higher-layer dependency`);
    }
  }
  const hb108 = dependencyPlan.find((relation) => relation.legacy_ticket_id === "HB-108")?.output_patches[0];
  if (!same(hb108?.depends_on, ["HB-101-L2", "HB-102-L2", "HB-103", "HB-104-L2"]))
    problems.push("HB-108 must bind the highest available cheaper canonical outputs");
  const hb155Plan = hb155OutputPatchPlan();
  if (
    !same(hb155Plan, [
      { legacy_ticket_id: "HB-155", output_id: "HB-155", status: "landed", depends_on: [] },
      { legacy_ticket_id: "HB-155", output_id: "HB-155-L2", status: "landed", depends_on: ["HB-155"] },
      {
        legacy_ticket_id: "HB-155",
        output_id: "HB-155-L3",
        status: "blocked",
        depends_on: ["HB-137-L3", "HB-155-L2"],
      },
    ])
  )
    problems.push("HB-155 reviewed patch plan drifted");
  for (const patch of hb155Plan) {
    const output = review.ticket_reviews[patch.legacy_ticket_id]?.outputs?.find(
      (candidate) => candidate.id === patch.output_id,
    );
    if (!output || output.status !== patch.status || !same(output.depends_on ?? [], patch.depends_on))
      problems.push(`${patch.output_id} omits its reviewed status/dependency override`);
  }
  for (const [id, override] of fidelityConfig.ticketOutputOverrides) {
    const output = Object.values(review.ticket_reviews)
      .flatMap((ticket) => ticket.outputs ?? [])
      .find((candidate) => candidate.id === id);
    if (
      !output ||
      output.status !== override.status ||
      output.title !== override.title ||
      (override.dependsOn && !same(output.depends_on ?? [], override.dependsOn)) ||
      !output.acceptance_criteria.includes(override.criterion)
    ) {
      problems.push(`${id} omits its reviewed reader-fidelity override`);
    }
  }
  for (const id of fidelityConfig.currentFactSources) if (!sourceIds.has(id)) problems.push(`missing ${id}`);
  for (const [familyId, expectedSources] of fidelityConfig.familySourceLinks) {
    const family = review.families[familyId];
    for (const sourceId of expectedSources) {
      if (!family.source_ids.includes(sourceId)) problems.push(`${familyId} omits exact source ${sourceId}`);
      for (const output of family.outputs ?? [])
        if (!output.source_ids.includes(sourceId)) problems.push(`${output.id} omits exact source ${sourceId}`);
    }
  }
  for (const [structureId, expectedSources] of fidelityConfig.structureSourceLinks) {
    const structure = review.structures.find((item) => item.id === structureId);
    for (const sourceId of expectedSources)
      if (!structure?.source_ids.includes(sourceId)) problems.push(`${structureId} omits exact source ${sourceId}`);
  }
  for (const id of fidelityConfig.releaseFactFamilies) {
    const family = review.families[id];
    for (const sourceId of fidelityConfig.currentFactSources) {
      if (!family.source_ids.includes(sourceId)) problems.push(`${id} omits current source ${sourceId}`);
      for (const output of family.outputs ?? [])
        if (!output.source_ids.includes(sourceId)) problems.push(`${output.id} omits current source ${sourceId}`);
    }
  }
  for (const stale of [
    "case-catalog.yaml` from `case-catalog.md",
    "recorded in the draft policy file",
    "the canonical policy blob untracked",
    "families in the archived policy",
  ])
    if (JSON.stringify(review).includes(stale)) problems.push(`stale active claim remains: ${stale}`);
  for (const [id, path] of [
    ...fidelityConfig.addedTests,
    ...fidelityConfig.rqTests.map((path) => ["CF-HARNESS-RQ", path]),
  ]) {
    const outputs = (review.families[id].outputs ?? []).filter(
      (output) => output.id === id || output.id === `${id}-L2`,
    );
    if (!outputs.length || outputs.some((output) => !output.planned_tests?.includes(path)))
      problems.push(`${id} recommended base/L2 outputs do not all carry ${path}`);
  }
  return problems;
}
