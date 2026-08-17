import { MIGRATION, sha256 } from "./migration-contract.mjs";
import { hasImplementationPath } from "./migration-model-equivalence.mjs";
import { redFindings } from "./migration-repository.mjs";
import { hb155OutputPatchPlan, ticketDependencyPatchPlan } from "./review-fidelity.mjs";

const unresolvedPathMeaning =
  "Implementation path mapping is unresolved, so no bounded subset is claimable. Any changed product path widens planning to the full offline suite: run `pnpm test`, `pnpm validation:trace`, `pnpm check`, and `pnpm build`; L3-L6 live, eval, soak, and L-ACC lanes additionally run only when their declared trigger applies and an exact reviewed configuration plus per-run human authorization exist.";
const recoveredInterfaces = ["INTERFACE-GITHUB", "INTERFACE-EVENT-INBOX", "INTERFACE-OS-TIMER"];

function exactStructureRecord(structure) {
  if (!structure) return null;
  return {
    id: structure.id,
    kind: structure.kind,
    title: structure.title,
    meaning: structure.meaning,
    acceptance_criteria: structure.acceptance_criteria ?? [],
    failure_modes: structure.failure_modes ?? [],
    changed_paths: structure.changed_paths ?? [],
    owner: structure.owner,
    source_ids: structure.source_ids,
  };
}

function exactRecordSet(records, sourceId) {
  const exact = records.map(exactStructureRecord);
  return {
    source_id: sourceId,
    ids: exact.map((record) => record.id),
    exact_records_sha256: sha256(JSON.stringify(exact)),
    verified_fields: [
      "kind",
      "title",
      "meaning",
      "acceptance_criteria",
      "failure_modes",
      "changed_paths",
      "owner",
      "source_ids",
    ],
  };
}

function structureRepresentation(model) {
  const byId = new Map(model.structures.map((structure) => [structure.id, structure]));
  const llmSites = model.structures
    .filter((structure) => structure.kind === "llm-site")
    .sort((left, right) => left.id.localeCompare(right.id));
  const invariants = model.structures
    .filter((structure) => structure.kind === "invariant")
    .sort((left, right) => left.id.localeCompare(right.id));
  return {
    impact_mapping: {
      structure_count: model.structures.length,
      exact_reviewed_path_mappings: model.structures.filter((structure) => structure.changed_paths?.length).length,
      full_suite_disclosures: model.structures.filter((structure) => structure.meaning.includes(unresolvedPathMeaning))
        .length,
      disposition:
        "Every structure has an empty reviewed changed_paths set; until a separately reviewed complete map exists, any changed product path widens planning to the named full offline suite, with triggered L3-L6 work remaining separately human-authorized.",
    },
    ownership: {
      exact_structure_owners: [...new Set(model.structures.map((structure) => structure.owner))].sort(),
      structure_specific_criticality_overrides: 0,
    },
    recovered_source_exact_interfaces: recoveredInterfaces.map((id) => exactStructureRecord(byId.get(id))),
    source_exact_llm_sites: exactRecordSet(llmSites, "SOURCE-LLM-EVAL"),
    source_exact_invariants: exactRecordSet(invariants, "SOURCE-INVARIANTS"),
    source_corrections: {
      "J-21/F-PT-030": {
        disposition:
          "A declared plan_gate policy may resolve the scored gate unattended only under the ratified rubric criteria and with durable resolution before build-arm spend; silence still refuses, and L-ACC remains non-gating.",
        exact_structure_record: exactStructureRecord(byId.get("J-21")),
      },
    },
  };
}

function pointerDispositions() {
  return {
    "HB-002/harness_self_tests": {
      canonical_binding:
        "validation-design/model/controls.yaml plus each validation-design/model/families.yaml control_ids relationship",
      decision_ledger: "research/2026-08-16_validation-authority-domain-split.md",
    },
    "HB-124/axis_score": {
      canonical_binding: "docs/qualification/host-policy.yaml → outcome_acceptance.axis_score",
    },
    "HB-135/F-PT-019": {
      rule_location: "inlined exact source-ticket acceptance fact",
      status_and_provenance: ["docs/PURPOSE.md", "validation-design/harness-design-state.md"],
      machine_bindings: ["CF-SPLIT-SECRETS", "CF-REG-204"],
    },
  };
}

export function buildSemanticReport({
  input,
  version,
  compilation,
  model,
  ledger,
  baseResult,
  baseGraph,
  bundleText,
  readerRecord,
  readerRecordText,
  controls,
}) {
  return {
    schema: "cormidia/validation-architect-semantic-equivalence/v1",
    package_version: version,
    product_revision: MIGRATION.productRevision,
    model_identity: compilation.identity,
    public_api: "migrate(kind=legacy-catalog) + compile().views/report + check()",
    upstream: { revision: MIGRATION.upstreamRevision, artifact: MIGRATION.artifact },
    authority: {
      canonical: "validation-design/model/*.yaml",
      generated_artifacts: [
        ...MIGRATION.viewNames.map((name) => `validation-design/${name}`),
        "validation-design/compiler-report.json",
      ],
      host_policy: "docs/qualification/host-policy.yaml",
      legacy_inputs: "validation-design/migration/legacy/ (byte-preserved history only; absent from model sources)",
      retired_root_inputs: MIGRATION.retiredRootNames,
    },
    identity: {
      exact_upstream_package: version,
      exact_product_revision: MIGRATION.productRevision,
      exact_review_sha256: sha256(input.reviewText),
      exact_archived_input_hashes: MIGRATION.legacySourceHashes,
      deterministic_migration: "two identical public calls byte-identical",
      deterministic_compile: "two identical public calls byte-identical",
      compiler_report_sha256: sha256(compilation.report.content),
      compiler_diagnostics: 0,
      source_normalization: "none",
    },
    mapping: {
      legacy_family_sources: ledger.families.length,
      canonical_family_outputs: model.families.length,
      legacy_ticket_sources: ledger.tickets.length,
      actionable_ticket_sources: ledger.tickets.filter((ticket) => ticket.disposition === "actionable").length,
      historical_ticket_sources: ledger.tickets.filter((ticket) => ticket.disposition === "historical").length,
      owners: model.owners.length,
      provenance_sources: model.sources.length,
      product_structures: model.structures.length,
      journeys: model.structures.filter((structure) => structure.kind === "journey").length,
      source_backed_changed_path_routes: model.structures.filter(
        (structure) => (structure.changed_paths ?? []).length > 0,
      ).length,
      implementation_path_gaps: model.structures
        .filter((structure) => !hasImplementationPath(structure))
        .map((structure) => structure.id),
      negative_controls: model.controls.length,
    },
    preserved: [
      "All 409 legacy family IDs and 117 legacy ticket IDs are uniquely ledgered; every reviewed canonical split and current model output forms one exact closed set.",
      "Reviewed product, owners, sources, structures, policy, controls, family placement and semantics, ticket fields, citations, statuses, dependencies, and dispositions are exact.",
      "Legacy family status, oracle, risk, blocker, reason, evidence declaration, exclusions, and known limitations are retained without source-byte normalization.",
      "Current implementation links arise only from model planned_tests/evidence; source-code trace headers remain non-authoritative annotations.",
      "All six layers and the complete reviewed lane object remain active; live-release equals the host RQ-1 denominator and L-ACC remains advisory outside release.",
    ],
    representation_dispositions: {
      legacy_family_meaning_changes: {
        "CF-HARNESS-CI":
          "Replaces the retired AWK/legacy-manifest regeneration claim with exact public-compiler eight-model/five-view/report drift closure while retaining F-PT-018.",
        "CF-INV-ACC-3":
          "Replaces the untracked policy-blob check with binding to the complete checked Validation Architect authority and the tighten-only Cormidia host policy.",
        "CF-C-B31":
          "Records the landed L1/L2 planning-source implementation and keeps the per-harness L3 modality proof pending.",
      },
      non_meaning_changes: {
        "CF-INV-002":
          "Only its exclusion maps the legacy broad live trigger to exact checked-model lanes and host-policy release selection; its family meaning remains archived-exact.",
        "B-17": "Its former draft-policy pointer resolves to the checked-model family blocker.",
        "B-27":
          "Its authority binding resolves to the ordered eight-file model identity plus the separate Cormidia host-policy bytes.",
      },
      general: [
        "Composite legacy placements are explicit canonical layer/lane outputs, with each source ID retained exactly once.",
        "CF-HARNESS-CI replaces active AWK/legacy-manifest regeneration with public checked-model, five-view, and compiler-report drift detection; exact AWK bytes remain history only.",
        "B-17's former draft-policy pointer resolves to the model family blocker; B-27 and CF-INV-ACC-3 bind the ordered eight-file identity plus host policy.",
        "CF-INV-002's former archived-policy pointer resolves to checked-model lanes and tighten-only host-policy composition.",
        "CF-B02-L3 remains the explicit reviewed L3 split of CF-C-B02 and belongs to the exact live-release denominator.",
        "Every actionable backlog output embeds exact current scope and acceptance facts; migration history is never an operational dependency.",
      ],
      hb155_status_and_dependencies: hb155OutputPatchPlan(),
      dependency_mapping: ticketDependencyPatchPlan({ review: input.review, backlogMarkdown: input.backlogMarkdown }),
      retired_pointer_repairs: pointerDispositions(),
      structure_extraction: structureRepresentation(model),
    },
    closure: {
      result: `${baseResult.verdict}/${baseResult.completeness}`,
      red_or_unresolved_findings: redFindings(baseGraph).length,
      partial_findings: baseGraph.findings.filter((finding) => finding.level === "partial").length,
      rule: "Pending/blocked/parked absence and incomplete evidence remain partial; landed absence is red.",
    },
    reader_bundle: {
      manifest_sha256: sha256(bundleText),
      artifact_count: MIGRATION.viewNames.length + 1,
      review_record_sha256: sha256(readerRecordText),
      reviews: readerRecord.reviews.map((review) => ({
        role: review.role,
        reviewer: review.reviewer,
        verdict: review.verdict,
      })),
    },
    seeded_negative_controls: controls,
  };
}
