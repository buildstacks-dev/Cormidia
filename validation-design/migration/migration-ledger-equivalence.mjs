import { isDeepStrictEqual } from "node:util";

function mapById(values, key = "id") {
  return new Map(values.map((value) => [value[key], value]));
}

function sameSet(left, right) {
  return isDeepStrictEqual([...left].sort(), [...right].sort());
}

function exactFieldProblems(actual, expected, fields, subject) {
  const problems = [];
  for (const field of fields) {
    if (!isDeepStrictEqual(actual?.[field], expected?.[field])) problems.push(`${subject} exact ${field} drift`);
  }
  return problems;
}

export function ledgerBindingProblems(actual, expected, actualText, expectedText) {
  const problems = [];
  if (!isDeepStrictEqual(actual, expected)) problems.push("complete migration ledger object drift");
  if (actualText !== expectedText) problems.push("exact migration ledger bytes drift");
  return problems;
}

function expectedFamilyOutputs(review, legacyId) {
  return review?.outputs?.map((output) => output.id) ?? [legacyId];
}

function explicitTicket(legacy, reviewed) {
  return {
    id: reviewed.id,
    title: reviewed.title,
    wave: legacy.wave,
    status: reviewed.status ?? legacy.status,
    owner: reviewed.owner,
    executor: reviewed.executor,
    lane: reviewed.lane,
    layer: reviewed.layer,
    acceptance_criteria: reviewed.acceptance_criteria,
    family_ids: reviewed.family_ids,
    depends_on: reviewed.depends_on,
  };
}

function compactTicket(legacy, review, ownedOutputIds, familiesById, problems) {
  const families = ownedOutputIds.map((id) => familiesById.get(id)).filter(Boolean);
  const owners = [...new Set(families.map((family) => family.owner))];
  const lanes = [...new Set(families.map((family) => family.lane))];
  const layers = [...new Set(families.map((family) => family.layer))];
  if (owners.length !== 1 || lanes.length !== 1 || layers.length !== 1) {
    problems.push(`${legacy.id} compact ticket cannot derive one owner/lane/layer`);
  }
  return {
    id: legacy.id,
    title: legacy.name ?? legacy.id,
    wave: legacy.wave,
    status: legacy.status,
    owner: owners[0],
    executor: review.executor,
    lane: lanes[0],
    layer: layers[0],
    acceptance_criteria: review.acceptance_criteria,
    family_ids: ownedOutputIds,
    depends_on: review.depends_on,
  };
}

const ticketFields = [
  "id",
  "title",
  "wave",
  "status",
  "owner",
  "executor",
  "lane",
  "layer",
  "acceptance_criteria",
  "family_ids",
  "depends_on",
];

export function ledgerEquivalenceProblems(input, model, ledger) {
  const problems = [];
  const legacyFamilies = mapById(input.manifest.families);
  const legacyTickets = mapById(input.manifest.tickets);
  const familiesById = mapById(model.families);
  const ticketsById = mapById(model.tickets);
  const familyLedger = mapById(ledger.families, "legacy_id");
  const ticketLedger = mapById(ledger.tickets, "legacy_id");

  const legacyFamilyIds = [...legacyFamilies.keys()];
  if (
    ledger.families.length !== 409 ||
    familyLedger.size !== ledger.families.length ||
    !sameSet(familyLedger.keys(), legacyFamilyIds)
  ) {
    problems.push("legacy family ledger is not the exact 409-source set");
  }
  const expectedFamilyOutputIds = [];
  for (const legacyId of legacyFamilyIds) {
    const entry = familyLedger.get(legacyId);
    const expected = expectedFamilyOutputs(input.review.families[legacyId], legacyId);
    expectedFamilyOutputIds.push(...expected);
    if (!entry || !sameSet(entry.output_ids, expected) || entry.output_ids.length !== new Set(entry.output_ids).size) {
      problems.push(`${legacyId} family ledger output closure drift`);
      continue;
    }
    if (entry.output_ids.filter((id) => id === legacyId).length !== 1) {
      problems.push(`${legacyId} is not retained exactly once`);
    }
  }
  const actualFamilyOutputIds = ledger.families.flatMap((entry) => entry.output_ids);
  if (
    actualFamilyOutputIds.length !== new Set(actualFamilyOutputIds).size ||
    !sameSet(actualFamilyOutputIds, expectedFamilyOutputIds) ||
    !sameSet(actualFamilyOutputIds, familiesById.keys())
  ) {
    problems.push("canonical family outputs are not one complete unique ledger/model set");
  }

  const legacyTicketIds = [...legacyTickets.keys()];
  if (
    ledger.tickets.length !== 117 ||
    ticketLedger.size !== ledger.tickets.length ||
    !sameSet(ticketLedger.keys(), legacyTicketIds)
  ) {
    problems.push("legacy ticket ledger is not the exact 117-source set");
  }
  const expectedTicketOutputIds = [];
  for (const legacyId of legacyTicketIds) {
    const legacy = legacyTickets.get(legacyId);
    const review = input.review.ticket_reviews[legacyId];
    const entry = ticketLedger.get(legacyId);
    const ownedLegacyIds = legacy.families.filter((id) => legacyFamilies.get(id)?.ticket === legacyId);
    const ownedOutputIds = ownedLegacyIds.flatMap((id) => familyLedger.get(id)?.output_ids ?? []);
    const historical = ownedLegacyIds.length === 0;
    const reviewedOutputs = review?.outputs;
    const expectedOutputs = historical ? [] : (reviewedOutputs?.map((output) => output.id) ?? [legacyId]);
    expectedTicketOutputIds.push(...expectedOutputs);
    if (!entry) {
      problems.push(`${legacyId} ticket ledger entry missing`);
      continue;
    }
    const expectedLedger = {
      legacy_family_ids: [...legacy.families].sort(),
      owned_legacy_family_ids: [...ownedLegacyIds].sort(),
      disposition: historical ? "historical" : "actionable",
      output_ids: [...expectedOutputs].sort(),
      reason: historical ? review?.historical?.reason : undefined,
    };
    problems.push(
      ...exactFieldProblems(
        entry,
        expectedLedger,
        ["legacy_family_ids", "owned_legacy_family_ids", "disposition", "output_ids", "reason"],
        legacyId,
      ),
    );
    if (entry.output_ids.length !== new Set(entry.output_ids).size)
      problems.push(`${legacyId} ticket outputs duplicate`);
    if (!historical && entry.output_ids.filter((id) => id === legacyId).length !== 1) {
      problems.push(`${legacyId} actionable ticket id is not retained exactly once`);
    }
    const expectedTickets = historical
      ? []
      : (reviewedOutputs?.map((output) => explicitTicket(legacy, output)) ?? [
          compactTicket(legacy, review, ownedOutputIds, familiesById, problems),
        ]);
    for (const expected of expectedTickets) {
      const actual = ticketsById.get(expected.id);
      if (!actual) {
        problems.push(`${expected.id} ticket output missing`);
        continue;
      }
      problems.push(...exactFieldProblems(actual, expected, ticketFields, expected.id));
      if (actual.acceptance_criteria.some((criterion) => criterion.includes("migration/legacy"))) {
        problems.push(`${expected.id} makes the migration archive operational`);
      }
    }
  }
  const actualTicketOutputIds = ledger.tickets.flatMap((entry) => entry.output_ids);
  if (
    actualTicketOutputIds.length !== new Set(actualTicketOutputIds).size ||
    !sameSet(actualTicketOutputIds, expectedTicketOutputIds) ||
    !sameSet(actualTicketOutputIds, ticketsById.keys())
  ) {
    problems.push("canonical ticket outputs are not one complete unique ledger/model set");
  }
  if (!isDeepStrictEqual(model.versions, ledger.compiler.versions)) {
    problems.push("model versions differ from the canonical compiler ledger");
  }
  return problems;
}
