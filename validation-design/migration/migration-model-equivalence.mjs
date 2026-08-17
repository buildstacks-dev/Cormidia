import { isAbsolute, relative, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { MIGRATION, sha256 } from "./migration-contract.mjs";

const expectedPolicySha256 = "266eddf3fbe9493b7d4e28f51aa6486e72e2e71215455e6f5f0e2bae4a8568eb";
const intentionalFamilyMeaningChanges = new Set([
  "CF-J13",
  "CF-OPS-COMP",
  "CF-HARNESS-CI",
  "CF-INV-ACC-3",
  "CF-ACC-S2",
  "CF-ACC-S3",
  "CF-B23-L3",
  "CF-B31-L3",
  "CF-C-B31",
  "CF-OPS-ABUSE",
  "CF-REVIEW-PROVIDER",
]);
const legacyMeaningPrefix = "Protected family contract: ";

function sourceCellCoversId(cell, id) {
  if (cell === id || cell.startsWith(`${id}-`) || cell.startsWith(`${id}{`)) return true;
  const separator = cell.lastIndexOf("-");
  if (separator < 0) return false;
  const base = cell.slice(0, separator + 1);
  return cell
    .slice(separator + 1)
    .split(/[+/]/)
    .some((suffix) => `${base}${suffix}` === id);
}

function mapById(values) {
  return new Map(values.map((value) => [value.id, value]));
}

function sameSet(left, right) {
  return isDeepStrictEqual([...left].sort(), [...right].sort());
}

export function assembleModel(parsedFiles) {
  const policyFile = parsedFiles["policy.yaml"];
  if (policyFile.schema !== "validation-architect/model/policy/v1") {
    throw new Error(`unexpected policy schema: ${String(policyFile.schema)}`);
  }
  const { schema: _policySchema, ...policy } = policyFile;
  return {
    product: parsedFiles["project.yaml"].product,
    versions: parsedFiles["project.yaml"].versions,
    owners: parsedFiles["owners.yaml"].owners,
    sources: parsedFiles["sources.yaml"].sources,
    structures: parsedFiles["structures.yaml"].structures,
    policy,
    controls: parsedFiles["controls.yaml"].controls,
    families: parsedFiles["families.yaml"].families,
    tickets: parsedFiles["backlog.yaml"].tickets,
  };
}

function expectedFamily(legacy, review, placement) {
  return {
    id: placement.id,
    title: review.title,
    meaning: review.meaning,
    structure_ids: placement.structure_ids,
    owner: placement.owner,
    source_ids: placement.source_ids,
    lane: placement.lane,
    status: legacy.status,
    layer: placement.layer,
    oracle: placement.oracle ?? legacy.oracle,
    risk: placement.risk ?? legacy.risk,
    control_ids: placement.control ? [placement.control.id] : undefined,
    ticket: placement.ticket ?? legacy.ticket,
    planned_tests: placement.planned_tests,
    evidence: placement.evidence,
    blocked_by: legacy.blocked_by,
    reason: legacy.reason,
    exclusions: review.exclusions,
  };
}

const familyFields = [
  "id",
  "title",
  "meaning",
  "structure_ids",
  "owner",
  "source_ids",
  "lane",
  "status",
  "layer",
  "oracle",
  "risk",
  "control_ids",
  "ticket",
  "planned_tests",
  "evidence",
  "blocked_by",
  "reason",
  "exclusions",
];

function exactFamilyProblems(input, model) {
  const problems = [];
  const legacyById = mapById(input.manifest.families);
  const currentById = mapById(model.families);
  const expectedIds = [];
  const expectedControls = [];
  if (currentById.size !== model.families.length) problems.push("model family IDs are duplicated");
  for (const [legacyId, review] of Object.entries(input.review.families)) {
    const legacy = legacyById.get(legacyId);
    if (!legacy) {
      problems.push(`${legacyId} reviewed family has no legacy source`);
      continue;
    }
    if (!Array.isArray(review.outputs) || review.outputs.length === 0) {
      problems.push(`${legacyId} lacks explicit reviewed canonical outputs`);
      continue;
    }
    for (const placement of review.outputs) {
      expectedIds.push(placement.id);
      const current = currentById.get(placement.id);
      if (!current) {
        problems.push(`${legacyId} -> ${placement.id} family output missing`);
        continue;
      }
      const expected = expectedFamily(legacy, review, placement);
      for (const field of familyFields) {
        if (!isDeepStrictEqual(current[field], expected[field])) {
          problems.push(`${placement.id} exact ${field} drift`);
        }
      }
      if (placement.control) expectedControls.push({ ...placement.control, family_id: placement.id });
      for (const finding of legacy.known_limitation ?? []) {
        const text = `${current.meaning} ${(current.exclusions ?? []).join(" ")}`;
        if (!text.includes(finding)) problems.push(`${placement.id} dropped known limitation ${finding}`);
      }
    }
  }
  if (!sameSet(currentById.keys(), expectedIds)) problems.push("model family IDs differ from reviewed output closure");

  const controlsById = mapById(model.controls);
  const expectedControlsById = mapById(expectedControls);
  if (controlsById.size !== model.controls.length) problems.push("model control IDs are duplicated");
  if (!sameSet(controlsById.keys(), expectedControlsById.keys())) {
    problems.push("model control IDs differ from reviewed control closure");
  }
  for (const [id, expected] of expectedControlsById) {
    if (!isDeepStrictEqual(controlsById.get(id), expected)) problems.push(`${id} exact negative-control record drift`);
  }
  return problems;
}

export function modelEquivalenceProblems(input, model) {
  const problems = [];
  for (const [name, actual, expected] of [
    ["product", model.product, input.review.product],
    ["owners", model.owners, input.review.owners],
    ["sources", model.sources, input.review.sources],
    ["structures", model.structures, input.review.structures],
    ["policy", model.policy, input.review.policy],
  ]) {
    if (!isDeepStrictEqual(actual, expected)) problems.push(`reviewed ${name} object drift`);
  }
  problems.push(...exactFamilyProblems(input, model));
  return problems;
}

export function reviewedLegacyMeaningProblems(input) {
  const problems = [];
  for (const [id, family] of Object.entries(input.review.families)) {
    if (intentionalFamilyMeaningChanges.has(id)) continue;
    if (typeof family.meaning !== "string" || !family.meaning.startsWith(legacyMeaningPrefix)) {
      problems.push(`${id} lacks an exact archived family-meaning payload`);
      continue;
    }
    const payload = family.meaning.slice(legacyMeaningPrefix.length);
    const rows = input.catalogMarkdown.split("\n").filter((line) => line === payload);
    const sourceCell = payload.split("|")[1]?.trim() ?? "";
    if (rows.length !== 1 || !sourceCellCoversId(sourceCell, id)) {
      problems.push(`${id} family meaning does not equal its unique complete archived catalog row`);
    }
  }
  return problems;
}

export function policyProblems(policy, model, hostPolicy) {
  const problems = [];
  if (sha256(JSON.stringify(policy)) !== expectedPolicySha256) problems.push("complete reviewed policy object drift");
  const lanes = new Map(policy.lanes.map((lane) => [lane.id, lane]));
  const releaseLane = lanes.get("live-release");
  const nonReleaseLive = lanes.get("live-triggered");
  const denominator = [
    ...hostPolicy.release_qualification.required_l3_case_ids,
    ...hostPolicy.release_qualification.conditional_l3_case_ids,
  ];
  const releaseMembers = model.families.filter((family) => family.lane === "live-release").map((family) => family.id);
  if (!sameSet(releaseMembers, denominator))
    problems.push("live-release membership differs from the host RQ-1 denominator");
  if (
    releaseLane?.kind !== "test" ||
    releaseLane.status !== "active" ||
    releaseLane.requirement !== "blocking" ||
    releaseLane.command !== "pnpm test:live" ||
    releaseLane.authorization !== "per-run-human" ||
    !sameSet(releaseLane.triggers, [
      "changed-adapter-or-gate-seam",
      "release-qualification",
      "material-host-or-auth-change",
    ])
  ) {
    problems.push("live-release trigger/authorization/requirement drift");
  }
  if (nonReleaseLive?.triggers.includes("release-qualification")) {
    problems.push("non-RQ-1 live lane gained release qualification");
  }
  if (model.families.some((family) => denominator.includes(family.id) && family.lane !== "live-release")) {
    problems.push("an RQ-1 denominator family escaped live-release");
  }
  const outcome = lanes.get("outcome-acceptance");
  if (
    outcome?.requirement !== "advisory" ||
    outcome.authorization !== "per-run-human" ||
    outcome.triggers.some((trigger) => trigger.includes("release"))
  ) {
    problems.push("L-ACC advisory/non-release posture drift");
  }
  const skipFindings = hostPolicy.release_qualification.allowed_test_skip_findings.map((finding) => finding.id);
  const j14 = model.families.find((family) => family.id === "CF-J14-S");
  const j14Text = `${j14?.meaning ?? ""} ${(j14?.exclusions ?? []).join(" ")}`;
  for (const finding of skipFindings) {
    if (!j14Text.includes(finding)) problems.push(`${finding} is not bound to the exact CF-J14-S remainder`);
  }
  return problems;
}

function insideArchive(path) {
  const archive = resolve(MIGRATION.legacyRoot);
  const candidate = resolve(MIGRATION.repoRoot, path);
  const relation = relative(archive, candidate);
  return relation === "" || (!isAbsolute(relation) && relation !== ".." && !relation.startsWith(`..${sep}`));
}

export function activeAuthorityProblems(model) {
  const problems = [];
  for (const source of model.sources) {
    if (source.id.startsWith("SOURCE-LEGACY-") || (source.path && insideArchive(source.path))) {
      problems.push(`${source.id} keeps the migration archive active`);
    }
  }
  return problems;
}

export function retiredAuthorityProblems(present) {
  return MIGRATION.retiredRootNames
    .filter((name) => present.includes(name))
    .map((name) => `validation-design/${name} is retired root authority`);
}

export function hasImplementationPath(structure) {
  return (structure.changed_paths ?? []).some(
    (path) =>
      /^(?:src|scripts|agent-skills|\.github)\//.test(path) ||
      ["roles.yaml", "pipelines.yaml", "TASTE.md"].includes(path),
  );
}
