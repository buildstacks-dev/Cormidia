const exactProductRevision = "c4d9eb341cccaff59af84eb2589bfa37cbbfd1d7";
const authorizedLaneProcedure =
  "The seven-file reader bundle is insufficient by itself to authorize or run this lane. Leave the reader sandbox; consult canonical docs/qualification/design.md and docs/qualification/host-policy.yaml; prepare a reviewed absolute configuration; run the required dry-run and preflight; obtain exact per-run human authorization; bind every evidence artifact to the exact candidate; and obtain the required aggregate attestation before any release use. Missing any prerequisite means refuse—never infer authority from this bundle, a prior run, or a landed ticket.";

export const fidelityConfig = {
  stagingRevision: exactProductRevision,
  readerIntendedUse: `Installable private-org runtime whose standing AI team develops and operates software under human-gated critical operations and fail-closed validation evidence. This checked graph is bound to exact product revision ${exactProductRevision}. Model identity is exact-candidate identity: it hashes the complete checked model, including that product.revision; changing the candidate changes the model identity. Reader start: use owner-briefing.md for policy, lane authorization, status semantics, and unresolved decisions; owner-backlog.md for owner/status; harness-backlog.md for acceptance and explicit dependencies; case-catalog.md for families and controls; planned-trace.md for provenance and routing; compiler-report.json and reader-bundle-identity.json bind the exact generated graph and seven-file bundle. Navigation correction: the generated owner-briefing section titled “The decisions on your desk” is a family disposition inventory, mostly resolved PRUNED rows; it is not the human-action queue. Actual unresolved human decisions are under “What is still unknown,” and executable engineering selection additionally requires the full ticket navigation/status rule in harness-backlog.md. The bundle is standalone navigation, not normative or editable authority: validation-design/model/*.yaml remains sole checked Validation Architect authority. The seven-file bundle proves only its own bytes and their compiled graph identity; it does not prove current GitHub state, current test or qualification evidence, production authorization, or release permission. IMPLEMENTABLE means a required family has a canonical implementation or evidence slot; it does not mean an open product-truth or sampling decision, code, execution, or evidence is complete, and an owning ticket/finding may still make it non-actionable. landed means the implementation record landed, not that evidence is current; pending, blocked, and parked remain incomplete; complete, incomplete, inconclusive, and unobserved evidence states never collapse into one another. Compiler accepted proves graph consistency only, never test passage, current assurance, production readiness, or release permission. ${authorizedLaneProcedure} RQ-1 additionally requires the current exact-candidate aggregate attestation and a separate exact human release approval.`,
  ownerResponsibility:
    "Product owner and accountable ratifier for validation policy, structures, evidence status, open product-truth decisions, and release-shaped decisions. build-agent means the repository coding agent operating through reviewed PRs; human + build-agent splits the named human decision or artifact authorship from reversible implementation; campaign means an explicitly authorized campaign runner. Escalate unresolved product truth, human-only artifacts, per-run authorization, and release decisions to this owner. Ordinary offline implementation begins only from a pending ticket after every depends_on output is landed, every owned family is unblocked, all product-truth/sampling/activation/split conditions are resolved, and the lane needs no missing per-run authorization; the build-order list alone never selects work.",
  readerClarifications:
    "Bundle-binding correction: reader-bundle-identity.json hashes the other six payload files and binds their model_identity/product_revision, but cannot recursively hash itself. Before reader-reviews.yaml exists, the seven-file root is not self-authenticating. The external bundle SHA is SHA-256 over the exact reader-bundle-identity.json bytes including its final newline; a conforming reader-reviews.yaml records that digest and the model identity, completing the reviewed seven-file byte binding. Even then the record proves only those bytes and identities, never current GitHub state, authorization, evidence freshness, or release permission. Checked-model edit map: validation-design/model/project.yaml owns product/version facts; validation-design/model/owners.yaml owners; validation-design/model/sources.yaml source records; validation-design/model/structures.yaml structure meaning/acceptance/source_ids/changed_paths; validation-design/model/policy.yaml layers, lanes, triggers, commands, and authorization; validation-design/model/controls.yaml negative controls; validation-design/model/families.yaml family status/lane/control_ids/ticket/planned_tests/evidence; validation-design/model/backlog.yaml ticket status/depends_on/family_ids/acceptance. A transition is not precisely staged until the affected fields in those named files are identified; generated views are never edited.",
  readerIntendedUseReplacement: [
    "The seven-file bundle proves only its own bytes and their compiled graph identity;",
    "Before reader review, reader-bundle-identity.json binds only the other six payload files plus their compiled graph identity; the external reader-review digest is required to bind the identity file as the seventh byte payload;",
  ],
  laneReasons: new Map([
    [
      "inner-loop",
      "Run from the repository root with no human authorization; this is an offline test lane, not release evidence.",
    ],
    [
      "per-commit",
      "Run from the repository root with no human authorization; CI repeats it. A green lane is necessary but not an aggregate release verdict.",
    ],
    [
      "live-triggered",
      `${authorizedLaneProcedure} This is a non-RQ-1 live sandbox lane; the owning ticket and reviewed config select the intended subset.`,
    ],
    [
      "live-release",
      `${authorizedLaneProcedure} This lane supplies the exact RQ-1 L3 denominator only after those prerequisites are satisfied.`,
    ],
    [
      "eval-triggered",
      `${authorizedLaneProcedure} Eval spend bounds apply, and missing or inconclusive evidence is never green.`,
    ],
    [
      "soak-triggered",
      `${authorizedLaneProcedure} The config must also name sandbox targets and ceilings; never infer natural rotation or elapsed-time evidence.`,
    ],
    [
      "triggered",
      `${authorizedLaneProcedure} This is a record-only certification lane with no universal command; follow the owning adapter or seam runbook and bind its exact artifact and runtime version.`,
    ],
    [
      "release",
      `${authorizedLaneProcedure} This record-only RQ-1 aggregate lane has no direct runner command and never substitutes for the separate exact human release approval.`,
    ],
    [
      "scheduled",
      `This is a record-only L5 evidence lane with no universal command. HB-072 threat-model authorship and independent human review are governance-artifact preparation, not execution of a provider, campaign, soak, or scheduled command: they require the checked template, distinct attributable human identities, timestamps, review flag, artifact digest, and threat-model-status.yaml, but no runtime config, dry-run, campaign authorization, or spend. Its deterministic admission detector runs on the offline per-commit lane. Soak collection uses soak-triggered, and any later threat-model-driven abuse execution remains blocked until HB-073 is pending and must follow the full authorized-lane procedure: ${authorizedLaneProcedure}`,
    ],
    [
      "outcome-acceptance",
      `${authorizedLaneProcedure} First append \`--dry-run\` to the displayed command for the non-spending preflight. The command without \`--dry-run\` is the real invocation; L-ACC remains advisory outside RQ-1.`,
    ],
    [
      "evaluation-advisory",
      `${authorizedLaneProcedure} Conditioning-sensitivity results are advisory and cannot become release green.`,
    ],
  ]),
  laneCommands: new Map([
    ["outcome-acceptance", "pnpm test:acceptance -- --config <reviewed-absolute-config>"],
    ["evaluation-advisory", "pnpm test:eval"],
  ]),
  legacySource: /^SOURCE-LEGACY-/,
  retiredSourceIds: new Set([
    "SOURCE-HB155-L3-CERTIFICATION",
    "SOURCE-PROPOSED-FPT-012",
    "SOURCE-PROPOSED-FPT-013",
    "SOURCE-PROPOSED-FPT-014",
    "SOURCE-PROPOSED-FPT-015",
    "SOURCE-PROPOSED-FPT-016",
    "SOURCE-PROPOSED-FPT-018",
  ]),
  sourceTicketProvenancePrefix:
    "Archived source-ticket text (provenance only; dependency words here are non-operative): ",
  journeyMeaningOverrides: new Map([
    [
      "J-07",
      "Per-turn cap is an immediate synchronous stop. F-PT-003 resolved-ratified on 2026-07-31: monthly-cap enforcement converges after a crash to the effective pause plus exactly one budget-exceeded item, with HB-P1 carrying the recovery cases. The 80% Planner warning remains distinct from the 100% pause.",
    ],
    [
      "J-13",
      "Crash recovery follows durable artifact authority and never invents progress. F-PT-004 resolved-ratified on 2026-07-31: ambiguous scratch-versus-protected worktree bytes are preserved for inspection and are never reset, cleaned, or discarded by recovery. Pre-provider claims may auto-repair without consuming allowance; post-provider ambiguity requires explicit rearm.",
    ],
    [
      "J-17",
      "A release handoff accepts only exact content-bound approval and invokes the typed executor at most once. The effect is reported executed only when completion evidence proves it; accepted, executing, failed, and ambiguous remain distinct durable states, and an ambiguous attempt is never retried blindly. Deployment and release authorization remain human-gated.",
    ],
    [
      "J-21",
      "Outcome-acceptance work emits a durable report for the work actually reached. A plan-gate stop is complete for the plan arm and incomplete for the unrun build arm; it is never a whole-campaign pass or complete build campaign. Every absent axis remains ungraded, every threshold-dependent verdict remains inconclusive, and L-ACC stays outside RQ-1.",
    ],
  ]),
  journeyAdditionalCriteria: new Map([
    [
      "J-13",
      [
        "Given a crash leaves uncommitted bytes whose ownership is ambiguous, recovery preserves the exact bytes, reports them for inspection, and performs no reset, checkout, clean, or deletion; F-PT-004 is resolved-ratified, so preserve-and-inspect is the contract rather than an open choice. [F-PT-004, B-15, INV-010/013]",
      ],
    ],
  ]),
  structureMeaningOverrides: new Map([
    [
      "B-23",
      "OpenCode has real L3 observations for auth, hook-seam denial, session resume, ambient-rule isolation, subagent gating, and the OpenAI-family smoke. Its checked certification evidence remains incomplete: the Anthropic-family representative-model smoke and non-zero-priced live cost/budget path were not observed. Close CF-B23-L3 only by re-certifying an exact OpenCode runtime/version on a sandbox install with the missing credential/profile under a reviewed absolute config and exact per-run human authorization, then deposit the resulting exact-candidate evidence; until then no surface may call the complete matrix proven.",
    ],
  ]),
  contractAcceptanceReplacements: new Map([
    [
      "CONTRACT-B-31",
      [
        "The per-harness L3 modality proof remains pending under HB-155 / CF-B31-L3.",
        "The per-harness L3 modality proof is blocked under HB-155-L3 / CF-B31-L3 until its adapter dependencies land and a checked-model revision changes it to pending.",
      ],
    ],
  ]),
  ticketOutputOverrides: new Map([
    [
      "HB-013-L3",
      {
        status: "blocked",
        title: "B-17 non-GitHub live round-trip (blocked: no ratified disposable target)",
        criterion:
          "Deliberate deferral and ordered transition: no disposable non-GitHub target is ratified, so CF-J17-A remains BLOCKED:B-17-L3 and this implementation record is not live evidence. First the human names the disposable sandbox target; a checked-model revision binds that target plus the absolute-config requirements and changes HB-013-L3 to pending. The operator then prepares the reviewed absolute config and runs the non-spending dry-run/preflight. Only after those exact outputs exist may the human grant fresh per-run authorization for that candidate/config; then the operator may run the spend-bounded round trip, deposit exact-candidate evidence, and later land the ticket/family. Target/config-shape ratification is not per-run authorization. Until every ordered step exists, refuse; blocked never transitions directly to execution or landed.",
      },
    ],
    [
      "HB-133",
      {
        status: "parked",
        title:
          "[simulated], provisional interpretation pending human ratification — not an owner ruling; implementation observation parked",
        sourceFact:
          "Current reader disposition superseding the legacy ticket's former authorization language: [simulated] provider-family separation was implemented conservatively with a swappable unit and is pending attributable human ratification. It is an observed refusal in the product, not ratified policy; it confers no authority and remains parked for an attributable human YES/NO decision. Only F-PT-038's independently ratified no-policy fail-close clause is current contract truth.",
        criterion:
          "Ratification boundary: this pending-ratification simulated interpretation is not ratified product policy; this is not an owner ruling. Existing implementation/tests are pinned observations only: they do not authorize or govern product policy, may not be cited as policy, and may not be extended into new behavior. Human YES ratifies the family unit; human NO names the replacement unit and the implementation/detectors must change red-then-green. F-PT-038's ratified no-policy fail-close rule remains operative either way.",
      },
    ],
    [
      "HB-133-L2",
      {
        status: "parked",
        title:
          "[simulated], provisional interpretation pending human ratification — not an owner ruling; L2 implementation observation parked",
        sourceFact:
          "Current reader disposition superseding the legacy ticket's former authorization language: [simulated] provider-family separation was implemented conservatively with a swappable unit and is pending attributable human ratification. It is an observed refusal in the product, not ratified policy; it confers no authority and remains parked for an attributable human YES/NO decision. Only F-PT-038's independently ratified no-policy fail-close clause is current contract truth.",
        criterion:
          "Ratification boundary: this pending-ratification simulated interpretation is not ratified product policy; this is not an owner ruling. Existing implementation/tests are pinned observations only: they do not authorize or govern product policy, may not be cited as policy, and may not be extended into new behavior. Human YES ratifies the family unit; human NO names the replacement unit and the implementation/detectors must change red-then-green. F-PT-038's ratified no-policy fail-close rule remains operative either way.",
      },
    ],
    [
      "HB-061",
      {
        status: "blocked",
        title: "Reviewer seeded-defect and clean sets (blocked: mixed F-PT-009 scope)",
        dependsOn: [],
        criterion:
          "No corpus-authoring subset is claimable from this mixed output while F-PT-009 remains unresolved. To authorize threshold-independent corpus work earlier, first revise the checked model to split disjoint family_ids, controls, acceptance, and depends_on edges into a separate pending output; otherwise the owner ratifies F-PT-009 and the same revision changes HB-061 to pending. Until then the build agent refuses the entire ticket.",
      },
    ],
    [
      "HB-062",
      {
        status: "blocked",
        title: "Conditioning sensitivity sampling design (blocked: F-PT-011)",
        dependsOn: [],
        criterion:
          "Exact unblock action: the product owner must ratify F-PT-011's brief-conditioning sampling design and its inconclusive rule; the next checked-model revision then updates CF-COND's acceptance/control and changes HB-062 to pending. Until that revision exists, no conditioning implementation or evidence run is engineering-ready.",
      },
    ],
    [
      "HB-062-L4",
      {
        status: "blocked",
        title: "Planner quality scaffolds (blocked: mixed F-PT-010/F-PT-011 and S-11 timing scope)",
        dependsOn: ["HB-062"],
        criterion:
          "No partial subset is claimable from this mixed output. Unblock only after HB-062 lands, F-PT-010 is ratified for both S-1 Planner and S-4 SRE, every owned F-PT-011 site section for S-2 Builder, S-5 Audience, S-6 Distiller, and S-7 Learning Reviewer is ratified, and the S-11 timing condition is satisfied. Otherwise first revise the checked model to create a separate pending output with disjoint family_ids, controls, acceptance, and depends_on edges for the exact independently ratified subset. Until then the build agent refuses the entire ticket.",
      },
    ],
    [
      "HB-090",
      {
        status: "blocked",
        title: "Comparison contracts and hermetic skeleton (blocked: comparison-wave activation)",
        dependsOn: [],
        criterion:
          "After the owner ratifies SOURCE-PROPOSED-COMPARISON, a checked-model revision must change this output to pending before engineering starts. It is the first comparison implementation output; activation text alone is not executable authority.",
      },
    ],
    [
      "HB-090-L2",
      {
        status: "blocked",
        title: "Comparison contracts and hermetic skeleton (L2; blocked: HB-090 and activation)",
        dependsOn: ["HB-090"],
        criterion:
          "This output follows HB-090. It becomes pending only in the checked-model revision that records comparison-wave activation and preserves the HB-090 dependency; activation text alone is not executable authority.",
      },
    ],
    [
      "HB-091",
      {
        status: "blocked",
        title: "Standalone Builder slice (blocked: HB-090 and comparison-wave activation)",
        dependsOn: ["HB-090"],
        criterion:
          "This output starts only after HB-090 lands and a checked-model revision records comparison-wave activation by changing it to pending. No standalone slice may precede the comparison identity/contracts skeleton.",
      },
    ],
    [
      "HB-091-L2",
      {
        status: "blocked",
        title: "Standalone Builder slice (L2; blocked: HB-090-L2, HB-091, and activation)",
        dependsOn: ["HB-090-L2", "HB-091"],
        criterion:
          "This output starts only after both HB-090-L2 and HB-091 land and the checked model changes it to pending after comparison-wave activation.",
      },
    ],
    [
      "HB-093",
      {
        status: "blocked",
        title: "S-8 selection corpus and calibration (blocked: activation and mixed F-PT-011 scope)",
        dependsOn: [],
        criterion:
          "This output mixes threshold-independent corpus work with unresolved F-PT-011 calibration. After comparison-wave activation, either ratify F-PT-011 or first split disjoint corpus-only family_ids, controls, acceptance, and ticket dependencies into a separate pending checked-model output. Until one of those model revisions lands, no subset is engineering-ready.",
      },
    ],
    [
      "HB-093-L2",
      {
        status: "blocked",
        title: "S-8 selection corpus and calibration (L2; blocked: HB-093 and F-PT-011)",
        dependsOn: ["HB-093"],
        criterion:
          "This output follows HB-093 and remains blocked by the same mixed-scope/F-PT-011 condition. It becomes pending only through the checked-model revision that resolves or splits that scope.",
      },
    ],
    [
      "HB-093-L4",
      {
        status: "blocked",
        title: "S-8 selection corpus and calibration (L4; blocked: HB-093-L2 and F-PT-011)",
        dependsOn: ["HB-093-L2"],
        criterion:
          "This output follows HB-093-L2 and cannot produce a threshold-dependent verdict before F-PT-011 is ratified. It becomes pending only through the checked-model revision that records that ruling and preserves the dependency.",
      },
    ],
    [
      "HB-P6",
      {
        status: "landed",
        title:
          "HB-P3 / HB-P5 / HB-P6 — UNPARKED 2026-08-12 by your rulings; F-PT-006 clarified by you 2026-08-16, excluding transport filename and producer id; HB-P6 LANDED 2026-08-12",
        criterion:
          "Resolved mirror: F-PT-008 clause was parked until it was unparked and implemented under HB-P5 on 2026-08-12. HB-P3 later landed them on 2026-08-12. HB-015 is landed while its app-reset execute-order clause remains parked on F-PT-012. The identity-field clarification 2026-08-16 preserves pre-clarification id-inclusive bare/per-role content marks and alias-keyed durable scheduler evidence without refiring.",
      },
    ],
    [
      "HB-137-L3",
      {
        status: "blocked",
        title: "Adapter L3 certification follow-ups (blocked: OpenCode and Muse closure)",
        dependsOn: [],
        criterion:
          "Per-leg closure and transition rule: Cursor is complete historical evidence and needs no rerun. Grok remains sandbox-only pending #339; its sandbox evidence never proves real-repository use. OpenCode lacks the Anthropic-family representative-model smoke and non-zero-priced cost/budget crossing. Muse lacks a supported adapter tool gate. HB-137-L3 is blocked and authorizes none of that work. The exact next action is a checked-model revision that creates or designates a separate pending Muse tool-gate implementation/certification output with exact family, control, path, and dependency ownership; after that prerequisite is represented, the revision may change HB-137-L3 to pending for the remaining separately authorized OpenCode/Muse certifications. Only a pending HB-137-L3 may execute those sandbox certifications, deposit partial evidence, and later become landed; blocked never transitions directly to execution or landed.",
      },
    ],
    [
      "HB-155-L3",
      {
        status: "blocked",
        title: "Per-harness planning-source modality proof (blocked: adapter certification matrix)",
        dependsOn: ["HB-137-L3", "HB-155-L2"],
        criterion:
          "Aggregate closure and transition rule: HB-137-L3 must first land the incomplete adapter certification work, including the separately owned Muse tool-gate support/certification, and HB-155-L2 must remain landed. Partial visual/media rows stay unsupported or unproven and cannot land this ticket. After both dependencies land, a checked-model revision must change HB-155-L3 from blocked to pending before any certification run. Only then does each still-unproven harness require its own current runtime/version evidence, reviewed absolute live config, exact per-run human authorization, sandbox target, image/PDF fixture, gate-observed read, and proof the model saw a visual fact; blocked never transitions directly to execution or landed.",
      },
    ],
    [
      "HB-094",
      {
        status: "blocked",
        title: "Comparison sampling/parallelism (blocked: harness revision and control required)",
        dependsOn: ["HB-090-L2", "HB-091-L2", "HB-093-L4"],
        criterion:
          "Structural gate: CF-OPS-COMP is correctly pruned only for sequential V1 and carries no present detector. Before sticky sampling or parallel candidates activate, re-enter validation-harness-design in harness-revision mode, ratify the comparison-specific risk allocation, emit an implementable comparison family at the cheapest falsifying layer with a red-capable negative control and owned test/evidence path, and replace this pruned placeholder. HB-094 is not engineering-ready merely because HB-090-L2, HB-091-L2, and HB-093-L4 complete. HB-092 currently has no canonical output; the same checked-model revision must either create its actionable output and add the dependency, or record an owner decision that HB-092 is unnecessary and remove the source prerequisite. Missing any revision, control, owner ruling, or HB-092 disposition means remain blocked.",
      },
    ],
  ]),
  comparisonLocator:
    "Human activation required before engineering: the product owner must explicitly ratify SOURCE-PROPOSED-COMPARISON and authorize the HB-090..094 comparison wave. Every output remains blocked until a checked-model revision changes the intended work to pending; prose activation alone is not executable authority. Operative order after that revision: HB-090 → HB-090-L2; HB-091 depends on HB-090 and HB-091-L2 depends on HB-090-L2 plus HB-091; HB-093 → HB-093-L2 → HB-093-L4 remains blocked until F-PT-011 is ratified or the threshold-independent corpus is split into disjoint outputs; HB-094 depends on HB-090-L2, HB-091-L2, and HB-093-L4 and separately requires its harness revision. HB-092 has no canonical output, so HB-094 cannot unblock until a checked-model revision either creates it or records that it is unnecessary and removes the source prerequisite. Design facts live at validation-design/system-map.md J-19 and boundary-map.md B-18/B-19.",
  openObligationsHandoff:
    "Superseding ratification-to-engineering handoff: the earlier ‘pending tickets whose depends_on outputs are landed’ sentence is shorthand and never selects work by itself; apply the complete navigation/status rule. These open findings authorize no code now. When the owner rules, the same checked-model revision must update the named existing output, change it to pending only if every readiness predicate holds, and bind exact family/control/planned-test-or-evidence paths and depends_on edges before a build agent acts: F-PT-009 → HB-061; F-PT-010 → HB-062-L4; F-PT-011 → HB-062, HB-062-L4, and HB-093/HB-093-L2/HB-093-L4 (plus HB-108 only if its already-landed S-10 threshold contract changes); F-PT-012 → HB-015; F-PT-013 → HB-010 and HB-010-L2; F-PT-014 → HB-011; F-PT-015 → HB-P4; F-PT-016 → HB-P4 when B-14 owns the seam or HB-025 when B-15 owns it; F-PT-018 → HB-P7; F-PT-033 → HB-005. A ruling that omits this model/ticket update is incomplete, and the build agent refuses. The #339 disposition updates the Grok scope recorded in HB-137-L3 but never widens it implicitly.",
  fpt033Handoff:
    "Ratification handoff: the same checked-model revision must update HB-005, change it from landed history to pending only if implementation is required, and bind the selected parser clause to its exact control and tests/unit/cf-inv-012/s3-verdict-marker.test.ts red-then-green change. Until that revision lands, no parser or regression-test edit is engineering-ready.",
  blockedTransitionHandoff:
    "Blocked-transition correction: clearing a blocker or landing dependencies never authorizes execution by itself. HB-013-L3, HB-073, HB-137-L3, HB-155-L3, and every other blocked output require a checked-model revision to pending before any implementation, certification, or evidence run; only pending work may later become landed. Any earlier ‘then run’ wording is conditional on that mandatory intermediate transition.",
  grokRiskBrief:
    "#339 standalone Grok vendor-risk decision brief. Decision: whether Grok Build may move beyond its current throwaway-sandbox-only scope to any real repository. Permitted attributable human outcomes are retain-sandbox-only, approve-bounded-real-repository-use, reject-real-repository-use, or needs-more-evidence (which leaves the item open and sandbox-only). Assess vendor terms; code/input retention and training use; confidentiality and deletion; network, subprocess, filesystem, and tool isolation; PreToolUse/gate integrity; telemetry/logging; incident response; version drift; and revocation. Completion artifact: research/adapters/grok-build-vendor-risk-review.md, authored or approved by the human product owner and carrying reviewer identity, reviewed_at, exact Grok runtime/version profile, evidence/source links, every criterion's disposition, chosen outcome, allowed repository/data/tool/network scope, expiry or re-review trigger, revocation conditions, and artifact SHA-256. retain/reject/needs-more-evidence preserves CF-B25-L3 sandbox-only scope. approve requires a checked-model revision updating B-25/CF-B25-L3 and affected tickets from the exact artifact; it never authorizes a run or real-repository use by itself, and every live run still needs its declared reviewed config and per-run human authorization. Missing artifact fields or model transition means remain sandbox-only.",
  modelRevisionProcedure:
    "Checked-model revision field map for every ratification handoff: update validation-design/model/sources.yaml when decision provenance changes; validation-design/model/structures.yaml for the affected clause/source_ids while preserving changed_paths: [] unless a separately ratified complete map exists; validation-design/model/controls.yaml for the red-capable expected failure; validation-design/model/families.yaml for status, lane, control_ids, ticket, exact planned_tests or evidence; and validation-design/model/backlog.yaml for ticket status, depends_on, family_ids, and acceptance. Update validation-design/model/policy.yaml only when lane/trigger/authorization changes, validation-design/model/owners.yaml only when ownership changes, and validation-design/model/project.yaml only for product/version facts. Regenerate, never edit views. A blocked/parked-to-pending transition is incomplete unless backlog status/dependencies and every owned family/control/path/source field agree in the same checked-model revision.",
  evalDecisionBriefs:
    "Exact F-PT-009/010/011 ratification payloads. F-PT-009 is one S-3 Reviewer ruling and must record corpus/version, serious-defect classes, per-severity catch thresholds, clean false-positive threshold, N, defect/clean counts, builder×reviewer pairing strata, aggregation, uncertainty/inconclusive rule, cadence, owner, date, and resulting HB-061/CF-S3-qual/CF-S3-judge transition or explicit corpus-only split. F-PT-010 requires two explicit site sections, S-1 Planner and S-4 SRE; each records corpus/version, metric, threshold, N, sample composition, aggregation, uncertainty/inconclusive rule, cadence, owner, and date. Omission leaves that site open; HB-062-L4 cannot become pending until both are ratified or its families are split. F-PT-011 is an umbrella, not one blanket YES/NO: record a separate complete section for CF-COND brief conditioning and for each S-2 Builder, S-5 Audience (Support, Marketing content, Marketing analysis), S-6 Distiller, S-7 Learning Reviewer, S-8 Selection Judge, and S-10 Validation Designer site. Every section carries corpus/version, metric/threshold, N, case counts/composition, strata, aggregation, calibration/reference procedure, uncertainty/inconclusive rule, cadence/trigger, owner, date, and affected ticket/family transition. Sites may ratify independently; omitted sites remain inconclusive and blocked. The same checked-model revision updates HB-062/062-L4, HB-093/093-L2/093-L4, and HB-108 only for the exact site families it changes, splitting mixed outputs before any partial subset becomes pending.",
  liveAuthorizationOrder:
    "Live authorization order correction: target/config-shape ratification and exact per-run authorization are distinct. For HB-013-L3, first the human names the disposable sandbox target and the checked-model revision binds the target plus config requirements and changes the ticket to pending. The operator then prepares the reviewed absolute config and runs non-spending dry-run/preflight. Only after those exact outputs exist may the human issue fresh per-run authorization for that candidate/config; then, and only then, the spend-bounded live run may start. A config review before preflight is not per-run authorization, and no prior authorization carries forward.",
  journeyFamily: /^CF-J(\d{2})(?:-|$)/,
  j13RecoveryFamily: /^CF-J(?:0[1-9]|1[0-24-9]|2[0-3])-(?:I|RC)(?:-L2)?$/,
  forbiddenFailureLabel:
    /^\*\*(?:Boundary test|State\/consistency|Scope|Ownership|Why|Journeys|Honest fake|Unproven real|Layer|Open product truth|Novelty|Three escape routes)/i,
  sources: [
    { id: "SOURCE-HOST-POLICY", kind: "doc", path: "docs/qualification/host-policy.yaml" },
    {
      id: "SOURCE-AUTHORITY-DOMAIN-SPLIT",
      kind: "doc",
      path: "research/2026-08-16_validation-authority-domain-split.md",
    },
    { id: "SOURCE-EPISODES-CONTRACT", kind: "doc", path: "docs/episodes/contract.md" },
    { id: "SOURCE-APPROVALS-DESIGN", kind: "doc", path: "docs/approvals/design.md" },
    { id: "SOURCE-QUALIFICATION-DESIGN", kind: "doc", path: "docs/qualification/design.md" },
    { id: "SOURCE-CORE-CHECKS", kind: "doc", path: ".github/workflows/core-checks.yml" },
    { id: "SOURCE-ROLES", kind: "doc", path: "roles.yaml" },
    {
      id: "SOURCE-OPEN-OBLIGATIONS",
      kind: "proposed",
      path: "validation-design/harness-design-state.md",
      locator:
        "Current unresolved and human-action queue; every decision below remains unratified and must not be encoded as behavior. F-PT-012 decision brief: choose registry-before-local-clear or local-clear-first with the registry update as commit point; the choice determines crash authority/recovery; completion requires the chosen contract and implementation plus red-then-green crash cases at every step boundary. F-PT-013 decision brief: classify an agent direct push to the remote default branch as routine or critical and choose gate-classifier or delivery-loop-guard enforcement; the choice fixes authority ownership and refusal/audit locus; completion requires the ratified policy/contract, implementation, and a seeded refused direct-push detector. F-PT-014 decision brief: map outside-worktree behavior to the existing never-scopeable rule or explicitly named narrower classes; the choice determines whether grants can be widened; completion requires invariant/approval-contract mapping, rule implementation, and a seeded refusal detector. F-PT-015 decision brief: choose outright bootstrap-rerun refusal or deterministic idempotent exact-marked-block replacement preserving all other bytes; the choice determines legal recovery and foreign-content protection; completion requires B-14/implementation alignment plus rerun, byte-preservation, foreign-block, symlink, and interruption controls. F-PT-016 decision brief: assign wrong-remote comparison to B-14 bootstrap publication or B-15 remote identity; the choice names one owning seam; completion requires the owning contract/implementation and matching, mismatch, missing-identity, symlink, and remote-move comparison/refusal coverage. F-PT-018 decision brief: retain the bounded human-protected-merge plus exact-tag-rerun limitation without claiming mechanical merge blocking, or require branch protection; only the latter closes the finding, and completion requires durable protected-state observation plus a seeded red PR observed to be merge-blocked followed by green; this cutover performs no infrastructure action. B-17-L3 deliberate deferral: the non-GitHub real round-trip remains blocked because no disposable target is ratified. Unblock only when the human names that sandbox target and authorizes an exact reviewed absolute live config; then run the spend-bounded preflight/campaign, deposit exact-candidate evidence, and update HB-013-L3/CF-J17-A. Other open items: F-PT-009/010/011 threshold/sample designs; F-PT-033 marker compatibility; #339 Grok real-repository vendor-risk review; the simulated provider-family interpretation (its current implementation is a parked observation, not ratified policy); HB-072 distinct human author and independent reviewer before HB-073; and HB-090..094 comparison-wave activation. HB-155-L3 visual/media certification plan (not authorized here): exact harness matrix claude, codex, cursor, opencode, pi, grok, muse; media_read remains unsupported per exact runtime/version unless current adapter/tool-gate evidence, a reviewed absolute live config, exact per-run human authorization, sandbox target, image/PDF fixture, gate-observed read, and proof the model saw a visual fact all exist. Unsupported/unproven remains unsupported; Grok is sandbox-only pending #339; Muse cannot progress while its tool gate is unsupported. Human next actions are the named decisions and artifacts. Engineering next actions are pending tickets whose explicit depends_on outputs are landed; prose-only HB/F-PT references are provenance unless the backlog declares an edge.",
    },
    {
      id: "SOURCE-PROPOSED-FPT-033",
      kind: "proposed",
      locator:
        "Human decision required — F-PT-033. Existing [doc] facts—review values approve|findings and the three documented predecessor status formats—are not reopened. Decide each remaining compatibility rule independently: (1) ratify duplicate-identical operative markers, or require exactly one operative marker; (2) retain Verdict-before-Status precedence, or state the replacement cross-keyword rule; (3) ratify the bare-line marker form, or reject it and name the accepted replacement form. Rejected current behavior requires parser and pinned-regression changes red-then-green. Until decided, current tests record behavior only; no new test may turn either reading into contract truth.",
    },
    {
      id: "SOURCE-SIMULATED-REVIEW-INDEPENDENCE",
      kind: "simulated",
      locator:
        "Human YES/NO required — should different provider mean provider FAMILY for Builder and Reviewer in autonomous code delivery? YES ratifies the current conservative, swappable implementation: same or unresolvable family refuses before provider construction; distinct adapters sharing one upstream family count as the same family; different families pass; jobs and manual-only routes are exempt. NO must state the exact replacement unit, such as vendor product or account, and whether the current family guard remains as an additional tighten-only check. F-PT-038's separately ratified no-policy fail-close rule is not reopened.",
    },
  ],
  currentFactSources: ["SOURCE-AUTHORITY-DOMAIN-SPLIT", "SOURCE-HOST-POLICY"],
  familySourceLinks: new Map([
    ["CF-HARNESS-CI", ["SOURCE-CORE-CHECKS", "SOURCE-OPEN-OBLIGATIONS"]],
    ["CF-J14-S", ["SOURCE-OPEN-OBLIGATIONS"]],
    ["CF-INV-002", ["SOURCE-OPEN-OBLIGATIONS"]],
    ["CF-SM-GRANT-L", ["SOURCE-OPEN-OBLIGATIONS"]],
    ["CF-SM-GRANT-I", ["SOURCE-OPEN-OBLIGATIONS"]],
    ["CF-SM-GRANT-R", ["SOURCE-OPEN-OBLIGATIONS"]],
    ["CF-SM-GRANT-C", ["SOURCE-OPEN-OBLIGATIONS"]],
    ["CF-B14", ["SOURCE-OPEN-OBLIGATIONS"]],
    ["CF-B15", ["SOURCE-OPEN-OBLIGATIONS"]],
    ["CF-J17-A", ["SOURCE-OPEN-OBLIGATIONS"]],
    ["CF-B31-L3", ["SOURCE-OPEN-OBLIGATIONS"]],
    ["CF-B25-L3", ["SOURCE-OPEN-OBLIGATIONS"]],
  ]),
  structureSourceLinks: new Map([
    ["CONTRACT-OP-LOOP", ["SOURCE-PROPOSED-FPT-033"]],
    ["S-3", ["SOURCE-PROPOSED-FPT-033"]],
    ["OP-REVIEW-INDEPENDENCE", ["SOURCE-SIMULATED-REVIEW-INDEPENDENCE"]],
    ["J-14", ["SOURCE-OPEN-OBLIGATIONS"]],
    ["CORMIDIA-INV-002", ["SOURCE-OPEN-OBLIGATIONS"]],
    ["CORMIDIA-INV-003", ["SOURCE-OPEN-OBLIGATIONS"]],
    ["SM-GRANT", ["SOURCE-OPEN-OBLIGATIONS"]],
    ["B-14", ["SOURCE-OPEN-OBLIGATIONS"]],
    ["CONTRACT-B-14", ["SOURCE-OPEN-OBLIGATIONS"]],
    ["B-15", ["SOURCE-OPEN-OBLIGATIONS"]],
    ["CONTRACT-B-15", ["SOURCE-OPEN-OBLIGATIONS"]],
    ["B-17", ["SOURCE-OPEN-OBLIGATIONS"]],
    ["B-31", ["SOURCE-OPEN-OBLIGATIONS"]],
    ["OP-HARNESS", ["SOURCE-OPEN-OBLIGATIONS"]],
  ]),
  interfaceFamilyLinks: new Map([
    ["INTERFACE-GITHUB", ["CF-B01", "CF-C-B01"]],
    ["INTERFACE-EVENT-INBOX", ["CF-B13", "CF-C-B13"]],
    ["INTERFACE-OS-TIMER", ["CF-B05", "CF-C-B05", "CF-J09-A"]],
  ]),
  releaseFactFamilies: new Set([
    "CF-HARNESS-CI",
    "CF-HARNESS-REPORT",
    "CF-HARNESS-RQ",
    "CF-HARNESS-CURRENCY",
    "CF-HARNESS-ATTEST",
    "CF-HARNESS-RELEASE",
    "CF-INV-002",
    "CF-INV-ACC-3",
  ]),
  addedTests: new Map([
    ["CF-HARNESS-CI", "tests/policy/cf-harness-ci/validation-architect-046-contract.test.ts"],
    ["CF-B27", "tests/hermetic/cf-b27-durable/cf-b27-report-store-boundary.test.ts"],
    [
      "CF-J21-R",
      "tests/hermetic/cf-c-b27-cf-inv-acc-4-cf-inv-acc-7a-cf-j21-r-cf-j21-rc-cf-j21-s/cf-j21-config-boundary.test.ts",
    ],
    ["CF-HARNESS-REPORT", "tests/hermetic/cf-harness-report-cf-reg-291/repository-binding-symlink.test.ts"],
    ["CF-INV-ACC-7b", "tests/hermetic/cf-inv-acc-7b/packaged-proof-boundary.test.ts"],
    ["CF-REG-278", "tests/policy/cf-reg-278/qualification-policy-pin.test.ts"],
  ]),
  rqTests: [
    "tests/unit/cf-harness-rq/live-host-policy.test.ts",
    "tests/unit/cf-harness-rq/release-policy-authority.test.ts",
  ],
  expectedDependencyDispositions: [
    "HB-104/HB-104:HB-103:no-layer-local-output",
    "HB-105:source-fact-only:no-actionable-output",
    "HB-106:source-fact-only:no-actionable-output",
    "HB-107:source-fact-only:no-actionable-output",
    "HB-108/HB-108:HB-105:historical-or-no-output",
    "HB-108/HB-108:HB-106:historical-or-no-output",
    "HB-108/HB-108:HB-107:historical-or-no-output",
    "HB-109:source-fact-only:no-actionable-output",
    "HB-110:source-fact-only:no-actionable-output",
    "HB-111:source-fact-only:no-actionable-output",
    "HB-114:source-fact-only:no-actionable-output",
    "HB-116/HB-116:HB-114:historical-or-no-output",
    "HB-116/HB-116-L2:HB-114:historical-or-no-output",
    "HB-118:source-fact-only:no-actionable-output",
    "HB-094/HB-094:HB-092:historical-or-no-output",
  ],
  expectedLaneFacts: new Map([
    ["inner-loop", ["Local fail-closed suite", "test", "none"]],
    ["per-commit", ["Core Checks L1/L2 and deterministic higher-layer protocols", "test", "none"]],
    ["live-triggered", ["Human-authorized non-RQ-1 live sandbox conformance", "test", "per-run-human"]],
    ["live-release", ["Human-authorized exact RQ-1 L3 denominator", "test", "per-run-human"]],
    ["eval-triggered", ["Human-authorized evaluation runner", "test", "per-run-human"]],
    ["soak-triggered", ["Human-authorized soak collector", "test", "per-run-human"]],
    ["triggered", ["Authorized non-test certification evidence", "evidence", "per-run-human"]],
    ["release", ["RQ-1 release qualification evidence", "evidence", "per-run-human"]],
    ["scheduled", ["Future L5 soak, rotation, threat and abuse evidence", "evidence", "per-run-human"]],
    ["outcome-acceptance", ["L-ACC disclosed outcome evidence outside RQ-1", "evidence", "per-run-human"]],
    ["evaluation-advisory", ["Non-gating conditioning sensitivity evidence", "evidence", "per-run-human"]],
  ]),
};
