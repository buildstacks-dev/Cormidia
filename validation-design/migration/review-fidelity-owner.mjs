import { fidelityConfig } from "./review-fidelity-config.mjs";

const ABUSE_ADMISSION_TEST = "tests/hermetic/cf-ops-abuse/threat-model-gate.test.ts";
const ABUSE_CASE_STATUS = "validation-design/abuse-case-status.yaml";
const THREAT_MODEL_ARTIFACT = "validation-design/threat-model.md";
const MERGE_LIMITATION_TEST = "tests/policy/cf-reg-278/policy-pin.test.ts";
const SOURCE_FACT_PREFIX = fidelityConfig.sourceTicketProvenancePrefix;
const COMPLETION_PREFIX = "A missing implementation on pending, blocked, or parked work";
export const ticketNavigationCriterion =
  "Navigation and status rule: depends_on is the only operative ticket dependency; other HB/F-PT references are provenance, historical links, or textual prerequisites unless this output names an edge. A ticket is engineering-ready only when it is pending, every depends_on output is landed, none of its families is blocked, its acceptance names no unresolved product-truth, sampling, activation, or required ticket split, and its lane needs no missing per-run authorization. Blocked and parked tickets are never executable even when their dependencies are landed. The owner briefing's build-order list is inventory, not a ready queue: apply every predicate here before selecting work. Proposed-wave work remains design-only until its named activation is resolved and a checked-model revision changes its blocked outputs to pending. Ticket landed records implementation work, while family status and evidence state separately govern what is implemented, observed, current, or claimable.";
const ABUSE_MEANING =
  "Three-stage L5 abuse assurance: HB-072 creates validation-design/threat-model.md from the checked template; one human authors its ten surfaces and a distinct independent human reviews it. validation-design/threat-model-status.yaml must name artifact: threat-model.md and durably record author, reviewer, authored_at, reviewed_at, human_authored_reviewed, the artifact SHA-256 digest, and all required surface/case metadata. The landed deterministic admission gate rejects awaiting_human_author, digest or path drift, missing reviewed fields, and author/reviewer identity overlap. After admission, a checked-model revision marks HB-072 landed and CF-OPS-ABUSE-THREAT-MODEL evidence complete, then may change HB-073 to pending while binding the admitted digest. Only pending HB-073 may derive one behavior-falsifying abuse case and red-capable detector per admitted surface and record their case, control, test/evidence, result, and exact threat-model digest in validation-design/abuse-case-status.yaml. The threat-model status artifact cannot satisfy HB-073 by itself, and blocked never transitions directly to execution or landed. The interim floor remains CF-INV-001/002/011/015 adversarial coverage, and none of this work is inside RQ-1.";
const ADMISSION_GATE_FACT =
  "Threat-model admission-gate machinery landed: tests/hermetic/cf-ops-abuse/threat-model-gate.test.ts proves the checked awaiting_human_author status, digest/path drift, missing durable review fields, and author/reviewer identity overlap refuse. Admission requires distinct human author and independent human reviewer identities plus durable author, reviewer, authored_at, reviewed_at, human_authored_reviewed, artifact SHA-256 digest, and validation-design/threat-model-status.yaml. This output does not claim the human threat model or abuse cases complete.";
const HB072_SOURCE_FACT =
  "Threat model document. Executor: distinct human author + independent human reviewer. Acceptance: create validation-design/threat-model.md from validation-design/threat-model-template.md without treating the template as evidence; persist author, reviewer, authored_at, reviewed_at, human_authored_reviewed, artifact: threat-model.md, artifact SHA-256 digest, and all required fields in validation-design/threat-model-status.yaml; the admission gate must reject author/reviewer identity overlap as well as awaiting_human_author, missing fields, and digest/path drift. After admission, the checked-model transition marks HB-072 landed and its evidence complete before HB-073 can become pending. This human artifact is outside RQ-1.";

const TICKET_TITLES = new Map([
  ["HB-072", "Threat model document"],
  ["HB-073", "Threat-model-driven abuse cases"],
  ["HB-073-L5", "Threat-model admission gate"],
  ["HB-140", "Checked-model compiler regeneration drift gate"],
  ["HB-P7", "F-PT-018 mechanical merge-blocking enforcement"],
]);

const OWNER_TICKET_PLAN = new Map([
  ["HB-072", ["pending", []]],
  ["HB-073", ["blocked", ["HB-072"]]],
  ["HB-073-L5", ["landed", []]],
  ["HB-140", ["landed", []]],
  ["HB-P7", ["parked", []]],
]);

const FAMILY_OUTPUT_SEMANTICS = new Map([
  ["CF-ACC-S3", ["stat+evid", "L4Q"]],
  ["CF-ACC-S3-L1", ["evid+state", "E2"]],
  ["CF-ACC-S3-L2", ["evid+state", "E2"]],
]);
const ABUSE_OUTPUT_SEMANTICS = new Map([
  ["CF-OPS-ABUSE-THREAT-MODEL", ["evid", "E1"]],
  ["CF-OPS-ABUSE", ["mixed", "E1"]],
  ["CF-OPS-ABUSE-ADMISSION", ["refusal+det", "E1"]],
]);

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function required(value, label) {
  if (value === undefined || value === null) throw new Error(`missing ${label}`);
  return value;
}

function outputById(outputs, id, label) {
  const output = outputs?.find((candidate) => candidate.id === id);
  return required(output, `${label} output ${id}`);
}

function rejectUnexpectedIds(outputs, expectedIds, label) {
  const allowed = new Set(expectedIds);
  const unexpected = (outputs ?? []).map((output) => output.id).filter((id) => !allowed.has(id));
  if (unexpected.length) throw new Error(`${label} has unexpected outputs: ${unexpected.join(", ")}`);
}

function canonicalFact(canonicalTicketFacts, id) {
  if (!(canonicalTicketFacts instanceof Map)) throw new Error("canonicalTicketFacts must be a Map");
  const fact = canonicalTicketFacts.get(id);
  if (!nonEmpty(fact)) throw new Error(`missing canonical source-ticket fact ${id}`);
  return fact;
}

function ticketPlan(id) {
  const [status, dependsOn] = required(OWNER_TICKET_PLAN.get(id), `owner ticket plan ${id}`);
  return { status, dependsOn };
}

function familyOutputSemantics(id) {
  const [oracle, risk] = required(ABUSE_OUTPUT_SEMANTICS.get(id), `family-output semantics ${id}`);
  return { oracle, risk };
}

function sourceFact(template) {
  const criterion = template.acceptance_criteria?.find((item) => item.startsWith(SOURCE_FACT_PREFIX));
  if (!criterion) throw new Error(`ticket template ${template.id} lacks exact source-ticket facts`);
  return criterion.slice(SOURCE_FACT_PREFIX.length);
}

function completionCriterion(template) {
  const criterion = template.acceptance_criteria?.find((item) => item.startsWith(COMPLETION_PREFIX));
  if (!criterion) throw new Error(`ticket template ${template.id} lacks the status-honesty criterion`);
  return criterion;
}

function reviewedControl(template, familyId) {
  const control = structuredClone(required(template.control, `family template ${template.id} control`));
  control.expected_failure = control.expected_failure
    .replaceAll(template.control.id, `NC-${familyId}`)
    .replaceAll(template.id, familyId);
  control.id = `NC-${familyId}`;
  control.title = `Seeded violation for ${familyId}`;
  return control;
}

function reviewedFamilyOutput(template, { id, ticket, plannedTests, testLane, oracle, risk }) {
  const output = structuredClone(template);
  output.id = id;
  output.ticket = ticket;
  if (oracle !== undefined) output.oracle = oracle;
  if (risk !== undefined) output.risk = risk;
  output.control = reviewedControl(template, id);
  if (testLane) {
    output.planned_tests = [...plannedTests];
    delete output.evidence;
  } else {
    delete output.planned_tests;
    required(output.evidence, `evidence family template ${template.id}`);
  }
  return output;
}

function reviewedTicketOutput(template, { id, title, executor, status, dependsOn, familyIds, sourceTicketFact }) {
  const output = structuredClone(template);
  output.id = id;
  output.title = title;
  output.executor = executor;
  output.status = status;
  output.depends_on = [...dependsOn];
  output.family_ids = [...familyIds];
  output.acceptance_criteria = [
    `${SOURCE_FACT_PREFIX}${sourceTicketFact}`,
    `This ${output.layer}/${output.lane} output owns exactly these canonical families and no other layer gates it: ${familyIds.join(", ")}.`,
    completionCriterion(template),
    ticketNavigationCriterion,
  ];
  return output;
}

function historicalTicket(review, id) {
  const ticket = required(review.ticket_reviews?.[id], `legacy ticket review ${id}`);
  if (!nonEmpty(ticket.historical?.reason) || ticket.outputs !== undefined)
    throw new Error(`legacy ticket ${id} must remain historical and emit no outputs`);
}

/**
 * Apply the reviewed owner/ticket representation in place. All source
 * templates and both otherwise-unreachable canonical ticket facts are resolved
 * before any mutation, so malformed input cannot leave a partial rewrite.
 */
export function applyOwnerTicketRepresentations({ review, canonicalTicketFacts }) {
  const abuseFamily = required(review.families?.["CF-OPS-ABUSE"], "family CF-OPS-ABUSE");
  const ciFamily = required(review.families?.["CF-HARNESS-CI"], "family CF-HARNESS-CI");
  const hb073Review = required(review.ticket_reviews?.["HB-073"], "ticket review HB-073");
  const hbP7Review = required(review.ticket_reviews?.["HB-P7"], "ticket review HB-P7");

  rejectUnexpectedIds(
    abuseFamily.outputs,
    ["CF-OPS-ABUSE-THREAT-MODEL", "CF-OPS-ABUSE", "CF-OPS-ABUSE-ADMISSION"],
    "CF-OPS-ABUSE",
  );
  rejectUnexpectedIds(ciFamily.outputs, ["CF-HARNESS-CI", "CF-HARNESS-CI-MERGE-BLOCKING"], "CF-HARNESS-CI");
  rejectUnexpectedIds(hb073Review.outputs, ["HB-072", "HB-073", "HB-073-L5"], "HB-073");
  rejectUnexpectedIds(hbP7Review.outputs, ["HB-140", "HB-P7"], "HB-P7");

  const threatModelTemplate = outputById(abuseFamily.outputs, "CF-OPS-ABUSE-THREAT-MODEL", "CF-OPS-ABUSE");
  const abuse = outputById(abuseFamily.outputs, "CF-OPS-ABUSE", "CF-OPS-ABUSE");
  const admission = outputById(abuseFamily.outputs, "CF-OPS-ABUSE-ADMISSION", "CF-OPS-ABUSE");
  const ci = outputById(ciFamily.outputs, "CF-HARNESS-CI", "CF-HARNESS-CI");
  const mergeBlocking = outputById(ciFamily.outputs, "CF-HARNESS-CI-MERGE-BLOCKING", "CF-HARNESS-CI");
  const hb073 = outputById(hb073Review.outputs, "HB-073", "HB-073");
  const hb073L5 = outputById(hb073Review.outputs, "HB-073-L5", "HB-073");
  const hbP7 = outputById(hbP7Review.outputs, "HB-P7", "HB-P7");
  canonicalFact(canonicalTicketFacts, "HB-072");
  const hb140Fact = canonicalFact(canonicalTicketFacts, "HB-140");
  const hb073Fact = sourceFact(hb073);
  const hbP7Fact = sourceFact(hbP7);
  historicalTicket(review, "HB-072");
  historicalTicket(review, "HB-140");

  const retainedAbuse = reviewedFamilyOutput(abuse, {
    id: "CF-OPS-ABUSE",
    ticket: "HB-073",
    testLane: false,
    ...familyOutputSemantics("CF-OPS-ABUSE"),
  });
  retainedAbuse.evidence = { state: "unobserved", path: ABUSE_CASE_STATUS };
  retainedAbuse.control.expected_failure =
    "After an admitted threat model exists, omit a named surface's behavior-falsifying abuse case, red-capable detector, exact test/evidence path, result, or threat-model digest from validation-design/abuse-case-status.yaml; HB-073 must remain blocked/incomplete and cannot reuse threat-model-status.yaml as abuse-case evidence.";
  const threatModel = reviewedFamilyOutput(threatModelTemplate, {
    id: "CF-OPS-ABUSE-THREAT-MODEL",
    ticket: "HB-072",
    testLane: false,
    ...familyOutputSemantics("CF-OPS-ABUSE-THREAT-MODEL"),
  });
  threatModel.control.expected_failure = `Create or review any path other than ${THREAT_MODEL_ARTIFACT}, leave validation-design/threat-model-status.yaml artifact unequal to threat-model.md, omit a required human identity/timestamp/surface/case field, overlap author and reviewer, or drift the digest; the offline admission gate must refuse and HB-072 must remain pending with unobserved evidence.`;
  const retainedAdmission = reviewedFamilyOutput(admission, {
    id: "CF-OPS-ABUSE-ADMISSION",
    ticket: "HB-073-L5",
    plannedTests: [ABUSE_ADMISSION_TEST],
    testLane: true,
    ...familyOutputSemantics("CF-OPS-ABUSE-ADMISSION"),
  });
  const retainedCi = reviewedFamilyOutput(ci, {
    id: "CF-HARNESS-CI",
    ticket: "HB-140",
    plannedTests: [...required(ci.planned_tests, "CF-HARNESS-CI planned tests")],
    testLane: true,
  });
  const mergeLimitation = reviewedFamilyOutput(mergeBlocking, {
    id: "CF-HARNESS-CI-MERGE-BLOCKING",
    ticket: "HB-P7",
    plannedTests: [MERGE_LIMITATION_TEST],
    testLane: true,
  });

  const ticket = (template, fields) =>
    reviewedTicketOutput(template, { ...fields, ...ticketPlan(fields.id), title: TICKET_TITLES.get(fields.id) });
  const hb072 = ticket(hb073, {
    id: "HB-072",
    executor: "human (distinct author + independent reviewer)",
    familyIds: ["CF-OPS-ABUSE-THREAT-MODEL"],
    sourceTicketFact: HB072_SOURCE_FACT,
  });
  hb072.acceptance_criteria.splice(
    2,
    0,
    "Human-authorship procedure, not a lane run: create validation-design/threat-model.md from validation-design/threat-model-template.md; one human authors all ten surfaces and a distinct independent human reviews those exact bytes. Update validation-design/threat-model-status.yaml with artifact: threat-model.md, author, reviewer, authored_at, reviewed_at, human_authored_reviewed, the exact artifact SHA-256 digest, all ten covered_surfaces, human-authored abuse_case_ids, release_gating_acknowledged, and note. This step invokes no provider/campaign/scheduled command, needs no absolute runtime config, dry-run, spend authorization, or aggregate attestation. The offline admission detector must accept the exact path/digest and retain its drift/identity negative controls. The same checked-model PR then marks HB-072 landed, changes CF-OPS-ABUSE-THREAT-MODEL evidence from unobserved to complete at validation-design/threat-model-status.yaml, and—only if the human conclusions admit abuse-case work—changes HB-073 from blocked to pending while binding the digest. Any later abuse execution belongs to that pending HB-073 and its separately authorized L5 procedure.",
  );
  const retainedHb073 = ticket(hb073, {
    id: "HB-073",
    executor: "build-agent",
    familyIds: ["CF-OPS-ABUSE"],
    sourceTicketFact: hb073Fact,
  });
  retainedHb073.acceptance_criteria.splice(
    2,
    0,
    "Exact post-HB-072 transition and action: after the ten-surface threat model is admitted, a checked-model revision must bind its digest and change HB-073 from blocked to pending. Only that pending output may enumerate one behavior-falsifying abuse case and red-capable detector for every surface, bind each row to its control plus exact test/evidence path and the admitted threat-model digest, execute through the separately authorized L5 procedure, and record honest results in validation-design/abuse-case-status.yaml. Missing the pending transition, any row, detector, path, result, digest, or authorization keeps HB-073 blocked/incomplete; validation-design/threat-model-status.yaml proves admission only and never substitutes for abuse-case evidence.",
  );
  const retainedHb073L5 = ticket(hb073L5, {
    id: "HB-073-L5",
    executor: "build-agent",
    familyIds: ["CF-OPS-ABUSE-ADMISSION"],
    sourceTicketFact: ADMISSION_GATE_FACT,
  });
  const hb140 = ticket(hbP7, {
    id: "HB-140",
    executor: "build-agent",
    familyIds: ["CF-HARNESS-CI"],
    sourceTicketFact: hb140Fact,
  });
  const retainedHbP7 = ticket(hbP7, {
    id: "HB-P7",
    executor: "human + build-agent",
    familyIds: ["CF-HARNESS-CI-MERGE-BLOCKING"],
    sourceTicketFact: hbP7Fact,
  });

  abuseFamily.meaning = ABUSE_MEANING;
  abuseFamily.outputs = [threatModel, retainedAbuse, retainedAdmission];
  ciFamily.outputs = [retainedCi, mergeLimitation];
  hb073Review.outputs = [hb072, retainedHb073, retainedHb073L5];
  hbP7Review.outputs = [hb140, retainedHbP7];
  return review;
}

/** Return deterministic scoped drift without mutating the supplied review. */
export function ownerTicketRepresentationProblems({ review, canonicalTicketFacts }) {
  const expected = structuredClone(review);
  try {
    applyOwnerTicketRepresentations({ review: expected, canonicalTicketFacts });
  } catch (error) {
    return [
      `owner/ticket representation cannot be constructed: ${error instanceof Error ? error.message : String(error)}`,
    ];
  }
  const scopes = [
    ["CF-OPS-ABUSE family outputs", review.families?.["CF-OPS-ABUSE"], expected.families["CF-OPS-ABUSE"]],
    ["CF-HARNESS-CI family outputs", review.families?.["CF-HARNESS-CI"], expected.families["CF-HARNESS-CI"]],
    ["HB-073 ticket outputs", review.ticket_reviews?.["HB-073"], expected.ticket_reviews["HB-073"]],
    ["HB-P7 ticket outputs", review.ticket_reviews?.["HB-P7"], expected.ticket_reviews["HB-P7"]],
  ];
  return scopes
    .filter(([, actual, wanted]) => !same(actual, wanted))
    .map(([label]) => `${label} differ from the reviewed canonical owner/status representation`);
}

/** Apply exact per-output semantics where a composite legacy row spans unlike oracles. */
export function applyFamilyOutputSemantics(review) {
  const outputs = required(review.families?.["CF-ACC-S3"]?.outputs, "family CF-ACC-S3 outputs");
  rejectUnexpectedIds(outputs, FAMILY_OUTPUT_SEMANTICS.keys(), "CF-ACC-S3");
  for (const [id, [oracle, risk]] of FAMILY_OUTPUT_SEMANTICS) {
    const output = outputById(outputs, id, "CF-ACC-S3");
    output.oracle = oracle;
    output.risk = risk;
  }
  return review;
}

export function familyOutputSemanticProblems(review) {
  const expected = structuredClone(review);
  try {
    applyFamilyOutputSemantics(expected);
  } catch (error) {
    return [`family-output semantics cannot be constructed: ${error instanceof Error ? error.message : String(error)}`];
  }
  return same(review.families?.["CF-ACC-S3"], expected.families["CF-ACC-S3"])
    ? []
    : ["CF-ACC-S3 outputs differ from the reviewed statistical/mechanical oracle and risk split"];
}

export function ownerTicketOutputPlan() {
  return [...OWNER_TICKET_PLAN].map(([output_id, [status, depends_on]]) => ({
    output_id,
    status,
    depends_on: [...depends_on],
  }));
}
