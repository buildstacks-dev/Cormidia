#!/usr/bin/env node

// Deterministic, one-time reader-fidelity normalization for the reviewed
// legacy-to-model mapping. Runtime compilation consumes review.yaml only; this
// helper is also imported by verify-migration.mjs to reject regression.

import { pathToFileURL } from "node:url";
import { fidelityConfig } from "./review-fidelity-config.mjs";
import { runReviewFidelityCli } from "./review-fidelity-cli.mjs";
import {
  contractFacts,
  interfaceFacts,
  llmSiteFacts,
  operationFacts,
  stateMachineFacts,
  structureFidelity,
} from "./review-fidelity-extract.mjs";
import { boundaryFacts, journeyFacts, ticketFacts } from "./review-fidelity-source.mjs";
import { invariantFacts } from "./review-fidelity-invariant.mjs";
import {
  applyFamilyOutputSemantics,
  applyOwnerTicketRepresentations,
  ticketNavigationCriterion,
} from "./review-fidelity-owner.mjs";
import { hb155OutputPatchPlan, ticketDependencyPatchPlan } from "./review-fidelity-ticket-plan.mjs";
import { collectReviewFidelityProblems } from "./review-fidelity-verify.mjs";

export { hb155OutputPatchPlan, ticketDependencyPatchPlan };

const { stagingRevision, legacySource: LEGACY_SOURCE, journeyFamily: JOURNEY } = fidelityConfig;
const { expectedStateMachines, unresolvedPathMeaning } = structureFidelity;
const fidelitySources = fidelityConfig.sources;
const currentFactSources = fidelityConfig.currentFactSources;
const releaseFactFamilies = fidelityConfig.releaseFactFamilies;
const addedTests = fidelityConfig.addedTests;
const rqTests = fidelityConfig.rqTests;
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
const genericControlExpectedFailure =
  "Removing or falsifying the protected behavior makes the exact planned detector fail; header prose alone cannot preserve green.";
const comparisonActivationCriterion =
  "Comparison-wave activation and order: every HB-090..094 output is blocked before owner ratification of SOURCE-PROPOSED-COMPARISON. Activation alone authorizes no code: the same checked-model revision must change the intended outputs to pending. The operative order is HB-090 → HB-090-L2; HB-091 depends on HB-090 and HB-091-L2 depends on both HB-091 and HB-090-L2; HB-093 → HB-093-L2 → HB-093-L4, but that mixed corpus/calibration chain remains blocked until it is split or F-PT-011 is ratified; HB-094 depends on HB-090-L2, HB-091-L2, and HB-093-L4 and also remains blocked on its harness revision. HB-092 has no canonical output: before HB-094 can unblock, a checked-model revision must either create its actionable output or record an owner decision that it is unnecessary and remove that source prerequisite.";
const conditioningDecisionCriterion =
  "HB-062 mixed-scope refusal: HB-062/CF-COND is blocked on its F-PT-011 site ruling. HB-062-L4 is separately blocked until F-PT-010 is ratified for both S-1 Planner and S-4 SRE, every owned F-PT-011 site section (S-2, S-5, S-6, S-7) is ratified, HB-062 is landed, and the S-11 timing condition is satisfied. No scaffold subset is claimable from HB-062-L4 as currently modeled. To authorize a smaller threshold-independent or independently ratified subset, first revise the checked model to split disjoint family_ids, controls, acceptance, and depends_on edges into a separate pending output; until that split exists, the exact engineering action is refuse and the exact human action is complete the named site rulings/timing.";

const unique = (values) => [...new Set(values.filter(Boolean))];
const normalizeLegacyMeaning = (value) =>
  value
    .replace(
      /^Exact ratified legacy row \(archived line \d+; secret-shape-safe typography only\):\s*/,
      "Protected family contract: ",
    )
    .replaceAll("risk review gated", "risk-review-gated");
const exactScenarioPaths = (value) =>
  value
    .replaceAll("`…/S-ACC-2-corpus-refresh.md`", "`acceptance/scenarios/S-ACC-2-corpus-refresh.md`")
    .replaceAll("`…/S-ACC-3-research-viz-job.md`", "`acceptance/scenarios/S-ACC-3-research-viz-job.md`");

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

function archivedFamilyMeaning(catalogMarkdown, id) {
  if (intentionalFamilyMeaningChanges.has(id)) return null;
  const rows = catalogMarkdown
    .split("\n")
    .filter((line) => /^\|.+\|$/.test(line))
    .filter((line) => sourceCellCoversId(line.split("|")[1]?.trim() ?? "", id));
  return rows.length === 1 ? `Protected family contract: ${rows[0]}` : null;
}

function firstSourceQuote(text) {
  if (typeof text !== "string") return undefined;
  return text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line && line !== "---");
}

function implementationPointer(output) {
  if (output.planned_tests?.length) return output.planned_tests.join(", ");
  if (output.evidence?.path) return `${output.evidence.path} (${output.evidence.state})`;
  return "the owning ticket's named implementation";
}

function clarifyGenericControls(review) {
  for (const [legacyId, family] of Object.entries(review.families)) {
    for (const output of family.outputs ?? []) {
      if (output.control?.expected_failure !== genericControlExpectedFailure) continue;
      output.control.expected_failure = `Seed ${output.control.id} for ${output.id} by changing its named fixture, implementation, or evidence so it contradicts the protected ${legacyId} meaning in this catalog; ${implementationPointer(output)} must fail or preserve an incomplete, inconclusive, or unobserved state. The exact planned implementation is the injection point and oracle; prose or a landed ticket can never preserve green.`;
    }
  }
}

function fallbackSources(id) {
  if (/^CF-SM-(?:APPR|GRANT)/.test(id))
    return [
      "SOURCE-CONTRACT-B-09A-APPROVAL-CONTINUATION",
      "SOURCE-CONTRACT-B-09B-APPROVAL-DECISION-ENTRY",
      "SOURCE-APPROVALS-DESIGN",
    ];
  if (/^CF-SM-LOOP/.test(id)) return ["SOURCE-CONTRACT-OP-LOOP"];
  if (/^CF-SM-PLAN/.test(id)) return ["SOURCE-CONTRACT-OP-PLANNING"];
  if (/^CF-SM-LADDER/.test(id)) return ["SOURCE-CONTRACT-OP-LIFECYCLE"];
  if (/^CF-SM-LEARN/.test(id)) return ["SOURCE-CONTRACT-B-11-LEARNING-PUBLISHER"];
  if (/^CF-SM-EVENT/.test(id)) return ["SOURCE-CONTRACT-B-13-EVENT-INBOX"];
  if (/^CF-SM-TURN/.test(id)) return ["SOURCE-EPISODES-CONTRACT"];
  if (/^CF-SM-COMP/.test(id))
    return ["SOURCE-CONTRACT-B-18-COMPARISON-CANDIDATES", "SOURCE-CONTRACT-B-19-SELECTION-MATERIALIZATION"];
  if (/^CF-SM-ROADMAP/.test(id)) return ["SOURCE-CONTRACT-B-20-ROADMAP-ADMISSION", "SOURCE-CONTRACT-OP-PLANNING"];
  if (/^CF-SM-VALIDATION/.test(id))
    return ["SOURCE-CONTRACT-B-21-VALIDATION-HANDOFF", "SOURCE-CONTRACT-OP-VALIDATION-LIFECYCLE"];
  if (/^CF-SM-BATCH/.test(id)) return ["SOURCE-CONTRACT-B-22-BATCH-EPISODES", "SOURCE-CONTRACT-OP-BATCHING"];
  if (/^CF-SM-ACC/.test(id)) return ["SOURCE-CONTRACT-B-27-ACCEPTANCE-CAMPAIGN", "SOURCE-ACCEPTANCE-RUBRIC"];
  if (/^CF-SM-JOB/.test(id)) return ["SOURCE-CONTRACT-B-30-JOB-CONFIG-JOURNAL", "SOURCE-JOBS"];
  if (/^CF-IF-/.test(id)) return ["SOURCE-SYSTEM-MAP", ...(id.includes("JOB") ? ["SOURCE-JOBS"] : [])];
  if (/^CF-SPLIT-/.test(id)) return ["SOURCE-APPROVALS-DESIGN", "SOURCE-PURPOSE"];
  return [];
}

function fallbackStructureSources(id) {
  const familyLike = id.startsWith("SM-")
    ? `CF-${id}`
    : id.startsWith("INTERFACE-")
      ? `CF-IF-${id.slice("INTERFACE-".length)}`
      : id === "OP-CONSEQUENCE-SPLIT"
        ? "CF-SPLIT-PUBLISHING"
        : "";
  if (familyLike) return fallbackSources(familyLike);
  if (id === "OP-REVIEW-INDEPENDENCE") return ["SOURCE-SYSTEM-MAP", "SOURCE-SIMULATED-REVIEW-INDEPENDENCE"];
  return [];
}

function stripLegacySources(ids, fallback = []) {
  const current = (ids ?? []).filter((id) => !LEGACY_SOURCE.test(id) && !fidelityConfig.retiredSourceIds.has(id));
  return unique(current.length ? current : fallback);
}

export function applyReviewFidelity({
  review,
  catalogMarkdown,
  backlogMarkdown,
  systemMapText,
  journeyAcceptanceText,
  boundaryMapText,
  sourceTexts = {},
}) {
  review.product.revision = stagingRevision;
  review.product.intended_use = `${fidelityConfig.readerIntendedUse.replace(
    ...fidelityConfig.readerIntendedUseReplacement,
  )} ${fidelityConfig.readerClarifications}`;
  review.owners[0].responsibility = fidelityConfig.ownerResponsibility;
  for (const lane of review.policy.lanes)
    if (["inner-loop", "per-commit"].includes(lane.id)) lane.authorization = "none";
  for (const lane of review.policy.lanes) {
    lane.reason = fidelityConfig.laneReasons.get(lane.id);
    const command = fidelityConfig.laneCommands.get(lane.id);
    if (command) lane.command = command;
  }
  review.sources = review.sources.filter(
    (source) => !LEGACY_SOURCE.test(source.id) && !fidelityConfig.retiredSourceIds.has(source.id),
  );
  for (const source of fidelitySources) {
    const index = review.sources.findIndex((item) => item.id === source.id);
    if (index < 0) review.sources.push(source);
    else review.sources[index] = { ...source };
  }
  const comparisonSource = review.sources.find((source) => source.id === "SOURCE-PROPOSED-COMPARISON");
  if (!comparisonSource) throw new Error("review lacks SOURCE-PROPOSED-COMPARISON");
  comparisonSource.locator = fidelityConfig.comparisonLocator;
  comparisonSource.quote = fidelityConfig.comparisonLocator;
  const openObligations = review.sources.find((source) => source.id === "SOURCE-OPEN-OBLIGATIONS");
  if (!openObligations) throw new Error("review lacks SOURCE-OPEN-OBLIGATIONS");
  openObligations.locator = `${openObligations.locator} ${fidelityConfig.openObligationsHandoff} ${fidelityConfig.blockedTransitionHandoff} ${fidelityConfig.grokRiskBrief} ${fidelityConfig.modelRevisionProcedure} ${fidelityConfig.evalDecisionBriefs} ${fidelityConfig.liveAuthorizationOrder}`;
  openObligations.quote = openObligations.locator;
  const fpt033 = review.sources.find((source) => source.id === "SOURCE-PROPOSED-FPT-033");
  if (!fpt033) throw new Error("review lacks SOURCE-PROPOSED-FPT-033");
  fpt033.locator = `${fpt033.locator} ${fidelityConfig.fpt033Handoff}`;
  fpt033.quote = fpt033.locator;
  for (const source of review.sources) {
    if (source.path && !source.locator)
      source.locator = `Exact checked source: ${source.path}. Resolve cited IDs and headings in that file; this reader bundle carries navigation and an exact source quote, not the source bytes.`;
    if (!source.quote) source.quote = firstSourceQuote(sourceTexts[source.id]) ?? source.locator;
  }
  // Refresh family facts before deriving structures from those families. This
  // keeps a single normalization pass closed over the exact archived catalog
  // instead of requiring a second pass to update state-machine clauses.
  for (const [legacyId, family] of Object.entries(review.families)) {
    family.meaning = exactScenarioPaths(
      archivedFamilyMeaning(catalogMarkdown, legacyId) ?? normalizeLegacyMeaning(family.meaning),
    );
    const journey = legacyId.match(JOURNEY)?.[1];
    const additions = [
      ...fallbackSources(legacyId),
      ...(journey ? ["SOURCE-SYSTEM-MAP", "SOURCE-CONTRACT-JOURNEY-ACCEPTANCE"] : []),
      ...(releaseFactFamilies.has(legacyId) ? currentFactSources : []),
      ...(fidelityConfig.familySourceLinks.get(legacyId) ?? []),
    ];
    family.source_ids = stripLegacySources(family.source_ids, additions);
    if (additions.length) family.source_ids = unique([...family.source_ids, ...additions]);
    if (journey)
      family.structure_ids = unique([...family.structure_ids.filter((id) => !/^J-\d{2}$/.test(id)), `J-${journey}`]);
    for (const output of family.outputs ?? []) {
      if (typeof output.meaning === "string") output.meaning = exactScenarioPaths(output.meaning);
      output.source_ids = stripLegacySources(output.source_ids, family.source_ids);
      if (additions.length) output.source_ids = unique([...output.source_ids, ...additions]);
      if (journey)
        output.structure_ids = unique([...output.structure_ids.filter((id) => !/^J-\d{2}$/.test(id)), `J-${journey}`]);
    }
  }
  review.structures = review.structures.filter((structure) => structure.kind !== "journey");
  const boundaries = new Map(boundaryFacts(boundaryMapText).map((boundary) => [boundary.id, boundary]));
  const interfaces = interfaceFacts(systemMapText, review.families);
  const llmSites = new Map(llmSiteFacts(sourceTexts["SOURCE-LLM-EVAL"] ?? "").map((site) => [site.id, site]));
  const invariants = new Map(
    invariantFacts(sourceTexts["SOURCE-INVARIANTS"] ?? "").map((invariant) => [invariant.id, invariant]),
  );
  review.families["CF-REVIEW-PROVIDER"].meaning =
    "Observed provisional product restriction, not validation or policy authority: current code/tests refuse same or unresolvable provider-family Builder/Reviewer pairs before provider construction, pass disjoint families, and exempt jobs/manual-only routes. Its sole decision provenance is a simulated stakeholder seat; this remains a provisional interpretation pending human ratification and is not an owner ruling. HB-133/HB-133-L2 are parked, so no new behavior, authorization, or policy claim may depend on this family unit. F-PT-038's separately ratified no-policy fail-close clause remains operative regardless of the later human YES/NO decision.";
  const j13Mappings = Object.values(review.families)
    .flatMap((family) => family.outputs ?? [])
    .filter((output) => fidelityConfig.j13RecoveryFamily.test(output.id) && output.control?.id && output.ticket)
    .sort((left, right) => left.id.localeCompare(right.id));
  for (const output of j13Mappings) output.structure_ids = unique([...output.structure_ids, "J-13"]);
  const j13MappingText = j13Mappings
    .map((output) => `${output.id} → ${output.control.id} → ${output.ticket}`)
    .join("; ");
  review.families["CF-J13"].meaning =
    `J-13 is pruned only as a duplicate routing node, not as absent coverage. Its exact interruption/recovery closure is the following existing family → red-capable control → owning-ticket map across J-01…J-12 and J-14…J-23: ${j13MappingText}. Each mapped family also links J-13 directly. The J-13 structure supplies the shared authority order, pre-provider allowance rule, post-provider explicit-rearm rule, external-effect no-blind-replay rule, and F-PT-004 preserve-and-inspect disposition; a mapped family that omits one of those applicable clauses is a trace defect, not a reason to infer coverage.`;
  review.families["CF-J13"].exclusions = unique([
    ...(review.families["CF-J13"].exclusions ?? []),
    "The immutable legacy prune reason named only J-01…J-12 and J-14…J-17 and overclaimed that every RC row stated the full authority order. That reason is superseded for reader navigation by the exact mapped closure above, which includes J-18…J-23 and relies on J-13's own shared clauses plus each mapped negative control.",
  ]);
  review.families["CF-OPS-COMP"].meaning =
    "Comparison operational risk is pruned only for explicit-tuple, sequential V1. It routes to J-19, B-18, B-19, and OP-CONTENTION rather than the abuse operation. Sticky sampling or parallel candidates are a structural/risk-allocation change and cannot activate from this placeholder: HB-094 remains blocked until harness-revision ratifies the comparison-specific contention/cost obligation and emits an implementable family with a red-capable control and owned test/evidence path.";
  review.families["CF-OPS-COMP"].structure_ids = ["J-19", "B-18", "B-19", "OP-CONTENTION"];
  review.families["CF-OPS-COMP"].exclusions = unique([
    ...(review.families["CF-OPS-COMP"].exclusions ?? []),
    "No current control is claimed: sequential V1 keeps this obligation not-applicable, while any sampling/parallel activation must replace the pruned placeholder through harness-revision before HB-094 becomes ready.",
  ]);
  for (const output of review.families["CF-OPS-COMP"].outputs ?? [])
    output.structure_ids = ["J-19", "B-18", "B-19", "OP-CONTENTION"];
  const operations = operationFacts(sourceTexts, review.families);
  for (const id of structureFidelity.expectedInterfaces) {
    if (review.structures.some((structure) => structure.id === id)) continue;
    const facts = interfaces.get(id);
    if (!facts) continue;
    review.structures.push({
      id,
      kind: "interface",
      ...facts,
      owner: "bikramgupta",
      source_ids: ["SOURCE-SYSTEM-MAP"],
      changed_paths: [],
    });
  }
  for (const structure of review.structures) {
    structure.meaning = structure.meaning.replace(` ${unresolvedPathMeaning}`, "");
    const structureFallback = fallbackStructureSources(structure.id);
    structure.source_ids = stripLegacySources(structure.source_ids, structureFallback);
    if (structureFallback.length) structure.source_ids = unique([...structure.source_ids, ...structureFallback]);
    const sourceLinks = fidelityConfig.structureSourceLinks.get(structure.id) ?? [];
    if (sourceLinks.length) structure.source_ids = unique([...structure.source_ids, ...sourceLinks]);
    const boundary = boundaries.get(structure.id.toUpperCase());
    if (boundary) Object.assign(structure, boundary);
    if (structure.kind === "contract") {
      const contractSource = structure.source_ids.find((id) => id.startsWith("SOURCE-CONTRACT-"));
      const contractText = sourceTexts[contractSource];
      if (contractText) {
        const { inherits_provider_core: inheritsProviderCore, ...facts } = contractFacts(
          contractText,
          sourceTexts["SOURCE-CONTRACT-PROVIDER-ADAPTER-CORE"],
        );
        Object.assign(structure, facts);
        if (inheritsProviderCore)
          structure.source_ids = unique([...structure.source_ids, "SOURCE-CONTRACT-PROVIDER-ADAPTER-CORE"]);
      }
    }
    const interfaceFact = interfaces.get(structure.id);
    if (interfaceFact) Object.assign(structure, interfaceFact);
    const llmSite = llmSites.get(structure.id);
    if (llmSite) Object.assign(structure, llmSite);
    const invariant = invariants.get(structure.id);
    if (invariant) Object.assign(structure, invariant);
    const operation = operations.get(structure.id);
    if (operation?.meaning) {
      Object.assign(structure, {
        meaning: operation.meaning,
        acceptance_criteria: operation.acceptance_criteria.filter(Boolean),
      });
      structure.source_ids = unique([...structure.source_ids, ...(operation.source_ids ?? [])]);
    }
    if (expectedStateMachines.includes(structure.id)) {
      const stateMachine = stateMachineFacts(structure.id, review.families);
      structure.meaning = stateMachine.meaning ?? structure.meaning;
      structure.acceptance_criteria = stateMachine.acceptance_criteria;
    }
    const structureMeaningOverride = fidelityConfig.structureMeaningOverrides.get(structure.id);
    if (structureMeaningOverride) structure.meaning = structureMeaningOverride;
    const contractAcceptanceReplacement = fidelityConfig.contractAcceptanceReplacements.get(structure.id);
    if (contractAcceptanceReplacement)
      structure.acceptance_criteria = structure.acceptance_criteria.map((criterion) =>
        criterion.replace(...contractAcceptanceReplacement),
      );
    // A path-shaped citation proves that a file participates in one clause; it
    // does not prove a complete impact map. Keep every mapping unresolved so
    // the public planner widens to the full suite until a separately reviewed
    // complete mapping exists.
    structure.changed_paths = [];
    structure.meaning = `${structure.meaning} ${unresolvedPathMeaning}`;
  }
  const journeys = journeyFacts(systemMapText, journeyAcceptanceText);
  const firstNonBoundary = review.structures.findIndex((structure) => structure.kind !== "boundary");
  review.structures.splice(
    firstNonBoundary,
    0,
    ...journeys.map((journey) => ({
      ...journey,
      meaning: `${fidelityConfig.journeyMeaningOverrides.get(journey.id) ?? journey.meaning} ${unresolvedPathMeaning}`,
      acceptance_criteria: [
        ...journey.acceptance_criteria,
        ...(fidelityConfig.journeyAdditionalCriteria.get(journey.id) ?? []),
      ],
      changed_paths: [],
    })),
  );
  for (const structure of review.structures) {
    const sourceLinks = fidelityConfig.structureSourceLinks.get(structure.id) ?? [];
    if (sourceLinks.length) structure.source_ids = unique([...structure.source_ids, ...sourceLinks]);
  }
  for (const [structureId, familyIds] of fidelityConfig.interfaceFamilyLinks)
    for (const familyId of familyIds)
      for (const output of review.families[familyId].outputs ?? [])
        output.structure_ids = unique([...output.structure_ids, structureId]);
  review.families["CF-HARNESS-CI"].meaning =
    "Per-commit workflow shape, fail-closed jobs, detector canaries, GitHub-orchestrated runner routing, and merge-boundary enforcement. HB-140 now proves complete eight-file checked-model presence, public-compiler regeneration of all five projections, compiler-report/model identity, and fail-closed partial-graph or drift behavior through scripts/check-catalog-drift.mjs and tests/policy/cf-harness-ci/catalog-drift.test.ts; no AWK or legacy manifest is operational authority. The #431 transition command and workflow refusal checks remain implemented. Mechanical merge blocking remains KNOWN-LIMITATION:F-PT-018, bounded for RQ-1 by protected human merge plus exact-tag rerun.";
  review.families["CF-REVIEW-PROVIDER"].exclusions = unique([
    ...(review.families["CF-REVIEW-PROVIDER"].exclusions ?? []),
    "BLOCKED:SOURCE-SIMULATED-REVIEW-INDEPENDENCE — the provider-family unit is a pinned observed implementation only. It cannot be cited as authoritative product policy or extended into new behavior before the human YES/NO decision. F-PT-038's separately ratified no-policy fail-close rule remains operative.",
  ]);
  review.families["CF-B23-L3"].meaning =
    "OpenCode real certification is incomplete. The 2026-08-07 walk observed real auth, hook-seam denial, exact session resume, ambient-rule isolation, subagent gating, and the OpenAI-family smoke. It did not observe the Anthropic-family representative-model smoke or a non-zero-priced live cost/budget crossing. Re-certification on an exact OpenCode runtime/version in a sandbox with the missing credential/profile, reviewed absolute config, exact per-run human authorization, and exact-candidate evidence is required before this family can be called complete.";
  review.families["CF-J17-A"].exclusions = unique([
    ...(review.families["CF-J17-A"].exclusions ?? []),
    "BLOCKED:B-17-L3 — no ratified disposable non-GitHub target exists. Unblock only through the human-named sandbox target, reviewed absolute live config, exact per-run authorization, spend-bounded preflight/run, and deposited exact-candidate evidence owned by HB-013-L3.",
  ]);
  review.families["CF-INV-002"].exclusions = review.families["CF-INV-002"].exclusions.map((item) =>
    item.replace(
      "the exact live boundary families in the archived policy",
      "exact live-boundary families on checked-model lanes; release selection and conditional admission come from the tighten-only Cormidia host policy",
    ),
  );
  review.families["CF-INV-ACC-3"].meaning = review.families["CF-INV-ACC-3"].meaning.replace(
    "an untracked canonical policy blob",
    "an absent, incomplete, untracked, or changed selected Validation Architect authority or Cormidia host-policy binding",
  );
  review.families["CF-C-B31"].meaning = review.families["CF-C-B31"].meaning.replace(
    "design-only, product change owed under HB-155 / #386",
    "L1/L2 product change and hermetic detector landed 2026-08-12; CF-B31-L3 is blocked under HB-155-L3 until its adapter dependencies land and a checked-model revision changes it to pending",
  );
  review.families["CF-C-B31"].meaning = review.families["CF-C-B31"].meaning.replace(
    "CF-B31-L3 remains pending per-harness live proof",
    "CF-B31-L3 is blocked under HB-155-L3 until its adapter dependencies land and a checked-model revision changes it to pending",
  );
  review.families["CF-B31-L3"].meaning =
    "Per-harness visual/media certification is blocked under HB-155-L3 for the exact matrix claude, codex, cursor, opencode, pi, grok, and muse. media_read is unsupported for each exact runtime/version profile unless current evidence proves it. Certification requires current adapter/tool-gate evidence, a reviewed absolute live config, exact per-run human authorization, a sandbox target, an image/PDF fixture, a gate-observed read, and proof the model saw a visual fact. Unsupported or unproven remains unsupported; Grok is sandbox-only pending #339, and Muse cannot progress while its tool gate is unsupported. The adapter dependencies must land and a checked-model revision must change HB-155-L3 to pending before any run. No L3 lane is authorized by this model or reader bundle.";
  for (const [id, path] of addedTests)
    for (const output of review.families[id].outputs ?? [])
      if (["L1", "L2"].includes(output.layer))
        output.planned_tests = unique([
          ...(output.planned_tests ?? []).filter(
            (candidate) => candidate !== "tests/policy/cf-harness-ci/validation-architect-045-contract.test.ts",
          ),
          path,
        ]);
  for (const output of review.families["CF-HARNESS-RQ"].outputs ?? [])
    if (["L1", "L2"].includes(output.layer))
      output.planned_tests = unique([...(output.planned_tests ?? []), ...rqTests]);
  const facts = ticketFacts(backlogMarkdown);
  for (const [legacyId, ticket] of Object.entries(review.ticket_reviews))
    for (const output of ticket.outputs ?? []) {
      output.acceptance_criteria = [
        `${fidelityConfig.sourceTicketProvenancePrefix}${facts.get(legacyId)}`,
        `This ${output.layer}/${output.lane} output owns exactly these canonical families and no other layer gates it: ${output.family_ids.join(", ")}.`,
        "A missing implementation on pending, blocked, or parked work remains incomplete/inconclusive; landed work with an absent exact planned test or evidence artifact is red.",
      ];
      if (output.id === "HB-155")
        output.title = "Governed planning-source scope + harness-native reading (F-PT-039, #386)";
      if (output.id === "HB-155-L2")
        output.title = "Governed planning-source scope + harness-native reading (F-PT-039, #386) (L2/per-commit split)";
      if (output.id === "HB-155-L3")
        output.title = "Per-harness planning-source modality proof (HB-155 / CF-B31-L3) (L3/live-triggered split)";
      if (output.id === "HB-155-L3")
        output.acceptance_criteria.push(
          "Certification matrix and refusal rule: exercise claude, codex, cursor, opencode, pi, grok, and muse separately at an exact runtime/version profile. For each harness, media_read remains unsupported unless current adapter/tool-gate evidence plus a reviewed absolute live config, exact per-run human authorization, sandbox target, image/PDF fixture, gate-observed read, and proof the model saw a visual fact are all present. Unsupported or unproven remains unsupported. Grok may progress only against a sandbox target while #339 remains open and cannot prove real-repository use. Muse cannot progress while its tool gate is unsupported. Therefore this aggregate ticket is blocked on HB-137-L3 as well as HB-155-L2; blocked authorizes no run and partial matrix evidence cannot land HB-155-L3. After both dependencies land, a checked-model revision must change HB-155-L3 to pending; only that pending output may obtain fresh exact per-run human authorization for each still-unproven harness and run the authorized sandbox legs. Do not run this L3 lane from the reader bundle.",
        );
    }
  for (const relation of ticketDependencyPatchPlan({ review, backlogMarkdown })) {
    const ticket = review.ticket_reviews[relation.legacy_ticket_id];
    if (relation.reason_disposition) {
      const reason = (ticket.historical?.reason ?? "").replace(/\s*Dependency representation disposition:[\s\S]*$/, "");
      ticket.historical.reason = `${reason} ${relation.reason_disposition}`.trim();
      delete ticket.reason;
    }
    for (const patch of relation.output_patches) {
      const output = ticket.outputs.find((candidate) => candidate.id === patch.output_id);
      output.depends_on = patch.depends_on;
      output.acceptance_criteria.push(patch.acceptance_disposition);
    }
  }
  for (const patch of hb155OutputPatchPlan()) {
    const output = review.ticket_reviews[patch.legacy_ticket_id].outputs.find(
      (candidate) => candidate.id === patch.output_id,
    );
    output.status = patch.status;
    output.depends_on = patch.depends_on;
  }
  applyFamilyOutputSemantics(review);
  applyOwnerTicketRepresentations({ review, canonicalTicketFacts: facts });
  for (const [id, override] of fidelityConfig.ticketOutputOverrides) {
    const output = Object.values(review.ticket_reviews)
      .flatMap((ticket) => ticket.outputs ?? [])
      .find((candidate) => candidate.id === id);
    if (!output) throw new Error(`ticket output override ${id} has no reviewed output`);
    output.status = override.status;
    output.title = override.title;
    if (override.dependsOn) output.depends_on = [...override.dependsOn];
    if (override.sourceFact)
      output.acceptance_criteria[0] = `${fidelityConfig.sourceTicketProvenancePrefix}${override.sourceFact}`;
    if (!output.acceptance_criteria.includes(override.criterion)) output.acceptance_criteria.push(override.criterion);
  }
  for (const ticket of Object.values(review.ticket_reviews))
    for (const output of ticket.outputs ?? []) {
      if (!output.acceptance_criteria.includes(ticketNavigationCriterion))
        output.acceptance_criteria.push(ticketNavigationCriterion);
      if (/^HB-09[0-4](?:-|$)/.test(output.id)) output.acceptance_criteria.push(comparisonActivationCriterion);
      if (/^HB-062(?:-|$)/.test(output.id)) output.acceptance_criteria.push(conditioningDecisionCriterion);
    }
  clarifyGenericControls(review);
  return review;
}

export function reviewFidelityProblems({
  review,
  backlogMarkdown,
  systemMapText,
  journeyAcceptanceText,
  boundaryMapText,
  sourceTexts = {},
}) {
  return collectReviewFidelityProblems({
    review,
    backlogMarkdown,
    systemMapText,
    journeyAcceptanceText,
    boundaryMapText,
    sourceTexts,
  });
}

export function assertReviewFidelity(input) {
  const problems = reviewFidelityProblems(input);
  if (problems.length) throw new Error(`review fidelity failed:\n- ${problems.join("\n- ")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runReviewFidelityCli({ applyReviewFidelity, assertReviewFidelity });
}
