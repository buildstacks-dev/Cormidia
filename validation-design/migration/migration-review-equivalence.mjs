import { isDeepStrictEqual } from "node:util";

import { MIGRATION, sha256 } from "./migration-contract.mjs";
import { fidelityConfig } from "./review-fidelity-config.mjs";
import { structureFidelity } from "./review-fidelity-extract.mjs";
import { ownerTicketOutputPlan } from "./review-fidelity-owner.mjs";
import { hb155OutputPatchPlan, ticketDependencyPatchPlan } from "./review-fidelity.mjs";

const expectedSourcesSha256 = "9b37d35c8e5e60fefe9fd0462251e83145f422222665026a8a05d36adc0bd2c2";
const expectedTicketTitlesSha256 = "190c7365c1167b2c491287b5480f08e6816a49fc360d7c693fb8f2df47facdcf";
const expectedProduct = {
  id: "cormidia",
  name: "Cormidia",
  revision: MIGRATION.productRevision,
  intended_use: `${fidelityConfig.readerIntendedUse.replace(
    ...fidelityConfig.readerIntendedUseReplacement,
  )} ${fidelityConfig.readerClarifications}`,
  criticality: "C2",
  criticality_reason:
    "Incorrect authority, settlement, review, release, or evidence claims can spend money, mutate repositories, or mislead a human operator; C3 control points inherit stricter obligations without changing the product base tier.",
};
const expectedOwners = [
  {
    id: "bikramgupta",
    name: "Bikram Gupta",
    responsibility: fidelityConfig.ownerResponsibility,
  },
];
const fullSuiteDisclosure = structureFidelity.unresolvedPathMeaning;

const sameSet = (left, right) => isDeepStrictEqual([...left].sort(), [...right].sort());

function sourceClosureProblems(review) {
  const problems = [];
  if (sha256(JSON.stringify(review.sources)) !== expectedSourcesSha256) {
    problems.push("reviewed source inventory/path/kind records drift from the exact ratified set");
  }
  const ids = review.sources.map((source) => source.id);
  if (ids.length !== new Set(ids).size) problems.push("reviewed source IDs are duplicated");
  const known = new Set(ids);
  for (const structure of review.structures) {
    if (!structure.source_ids?.length) problems.push(`${structure.id} has no reviewed source reference`);
    for (const id of structure.source_ids ?? []) {
      if (!known.has(id)) problems.push(`${structure.id} cites unknown source ${id}`);
    }
    if (structure.owner !== "bikramgupta") problems.push(`${structure.id} reviewed owner drift`);
    if (structure.criticality !== undefined || structure.criticality_reason !== undefined) {
      problems.push(`${structure.id} reviewed criticality override drift`);
    }
    if (!isDeepStrictEqual(structure.changed_paths, []) || !structure.meaning.includes(fullSuiteDisclosure)) {
      problems.push(`${structure.id} claims an unreviewed implementation impact map/full-suite disposition`);
    }
  }
  for (const [legacyId, family] of Object.entries(review.families)) {
    if (!family.source_ids?.length) problems.push(`${legacyId} has no reviewed source reference`);
    for (const id of family.source_ids ?? []) {
      if (!known.has(id)) problems.push(`${legacyId} cites unknown source ${id}`);
    }
    for (const output of family.outputs ?? []) {
      if (!sameSet(output.source_ids ?? [], family.source_ids ?? [])) {
        problems.push(`${legacyId}/${output.id} source references differ from its reviewed family source closure`);
      }
    }
  }
  for (const [legacyId, ticket] of Object.entries(review.ticket_reviews)) {
    for (const [index, output] of (ticket.outputs ?? []).entries()) {
      for (const id of output.source_ids ?? []) {
        if (!known.has(id)) problems.push(`${legacyId}/output-${index} cites unknown source ${id}`);
      }
    }
    for (const id of ticket.source_ids ?? []) {
      if (!known.has(id)) problems.push(`${legacyId} cites unknown source ${id}`);
    }
  }
  return problems;
}

function familyPlacements(input) {
  const legacy = new Map(input.manifest.families.map((family) => [family.id, family]));
  return Object.entries(input.review.families).flatMap(([legacyId, review]) =>
    (review.outputs ?? []).map((output) => ({
      ...output,
      ticket: output.ticket ?? legacy.get(legacyId)?.ticket,
    })),
  );
}

function exactPatchMaps(input) {
  const dependencies = new Map();
  for (const relation of ticketDependencyPatchPlan({
    review: input.review,
    backlogMarkdown: input.backlogMarkdown,
  })) {
    for (const patch of relation.output_patches) dependencies.set(patch.output_id, patch.depends_on);
  }
  const statuses = new Map();
  for (const patch of hb155OutputPatchPlan()) {
    statuses.set(patch.output_id, patch.status);
    dependencies.set(patch.output_id, patch.depends_on);
  }
  for (const patch of ownerTicketOutputPlan()) {
    statuses.set(patch.output_id, patch.status);
    dependencies.set(patch.output_id, patch.depends_on);
  }
  for (const [id, override] of fidelityConfig.ticketOutputOverrides) {
    statuses.set(id, override.status);
    if (override.dependsOn) dependencies.set(id, override.dependsOn);
  }
  return { dependencies, statuses };
}

function ticketMappingProblems(input) {
  const problems = [];
  const titleProjection = Object.entries(input.review.ticket_reviews).flatMap(([legacyId, review]) =>
    (review.outputs ?? []).map((output) => ({ legacy_id: legacyId, id: output.id, title: output.title })),
  );
  if (sha256(JSON.stringify(titleProjection)) !== expectedTicketTitlesSha256) {
    problems.push("reviewed ticket output titles drift from the exact ratified set");
  }
  const placements = familyPlacements(input);
  const placementsById = new Map(placements.map((placement) => [placement.id, placement]));
  const { dependencies, statuses } = exactPatchMaps(input);
  const materializedReview = Object.values(input.review.ticket_reviews).some((review) =>
    (review.outputs ?? []).some((output) => output.status !== undefined || output.depends_on !== undefined),
  );
  if (materializedReview && MIGRATION.packageVersion !== "0.4.6") {
    problems.push("reviewed split status/dependency and family semantics require public validation-architect 0.4.6");
  }
  for (const [legacyId, review] of Object.entries(input.review.ticket_reviews)) {
    for (const output of review.outputs ?? []) {
      const expectedFamilyIds = placements
        .filter((placement) => placement.ticket === output.id)
        .map((placement) => placement.id);
      if (!sameSet(output.family_ids, expectedFamilyIds)) {
        problems.push(`${legacyId}/${output.id} family_ids differ from exact reviewed family ownership`);
      }
      const families = output.family_ids.map((id) => placementsById.get(id)).filter(Boolean);
      for (const field of ["owner", "lane", "layer"]) {
        const values = [...new Set(families.map((family) => family[field]))];
        if (values.length !== 1 || output[field] !== values[0]) {
          problems.push(`${legacyId}/${output.id} ${field} differs from its exact family placement`);
        }
      }
      const expectedStatus = statuses.get(output.id);
      if (output.status !== expectedStatus) problems.push(`${legacyId}/${output.id} explicit status patch drift`);
      const expectedDependencies = dependencies.get(output.id);
      if (!isDeepStrictEqual(output.depends_on, expectedDependencies)) {
        problems.push(`${legacyId}/${output.id} exact dependency patch drift`);
      }
    }
  }
  return problems;
}

export function reviewEquivalenceProblems(input) {
  const problems = [];
  if (!isDeepStrictEqual(input.review.product, expectedProduct)) problems.push("reviewed product facts drift");
  if (!isDeepStrictEqual(input.review.owners, expectedOwners)) problems.push("reviewed owner facts drift");
  if (input.review.inner_loop_command !== "pnpm test") problems.push("reviewed inner-loop command drift");
  problems.push(...sourceClosureProblems(input.review));
  problems.push(...ticketMappingProblems(input));
  return problems;
}
