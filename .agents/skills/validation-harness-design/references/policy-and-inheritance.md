# Policy File Layout and Inheritance

Read during Phase 0 (module scope) and Phase 8 (all scopes).

`validation-policy.yaml` is the machine-readable output of this skill and the contract a later audit diffs conformance against. Prose design docs describe intent; this file is what gates behavior.

## Layout: distributed files, one registry

For anything larger than a single module, a single monolithic policy file becomes a merge-conflict hotspot the moment two modules evolve in parallel. Use distributed files with a parent registry:

```
validation-policy.yaml              # product: tiers, global invariants, cross-cutting gates, module registry
learning-loop/
  validation-policy.yaml            # module: extends parent, adds/tightens
work-source/
  validation-policy.yaml
```

**Parent holds:** criticality tier map, product-level invariant registry, artifact locations, cross-cutting gate requirements, CI cost tiering defaults, tooling selection, optional incumbent-harness coexistence constraints, and a `modules:` list naming each child policy path. Enumeration lives in one place; editing does not.

**Module holds:** `extends:` pointer, module-scoped invariants, boundary and contract locations, golden-set paths, and any tightened gate requirements.

## Parent skeleton

```yaml
schema_version: 1
scope: product
product: operon
default_tier: C2

tiers:
  learning-loop: C2
  billing: C3            # per-component override
  scratch-tools: C1

artifacts:
  system_map: ./system-map.md
  invariants: ./invariants.md
  boundary_map: ./boundary-map.md
  contracts: ./contracts/
  case_catalog: ./case-catalog.md
  harness_backlog: ./harness-backlog.md
  llm_eval_plan: ./llm-eval-plan.md
  golden_sets: ./golden-sets/

# Optional: use while a replacement harness is intentionally isolated.
coexistence:
  posture: parallel-greenfield
  isolated_root: ./next-harness/
  protected_paths: [./incumbent-tests/, ./incumbent-evals/]
  incumbent_gates: read_only
  ci_integration: additive_opt_in
  cutover_requires: [equivalence_evidence, rollback_plan, human_ratification]

invariants:
  - id: OPERON-INV-001
    statement: "No work item is leased by more than one worker at a time."
    enforcement: [runtime_guardrail, test]
    applies_to: [work-source, learning-loop]

layers:                        # all five lanes declared; an empty lane carries a reason — never silently absent
  invariant_contract: {status: active}
  hermetic_system:    {status: active}
  live_sandbox:       {status: active, targets: [sandbox-repo], spend_bound: per_run_cap}
  eval_qualification: {status: active}
  # a product with no model call sites declares instead:
  # eval_qualification: {status: empty, reason: "no model call sites"}
  ops_hardening:      {status: active, obligations: [threat_model, contention_scale, soak]}

gates:
  invariant_contract: {requirement: blocking, frequency: per_commit}
  hermetic_system:    {requirement: blocking, frequency: per_commit}
  live_sandbox:       {requirement: blocking, frequency: [pre_merge, pre_release]}
  llm_contract:       {requirement: blocking, frequency: per_commit}
  llm_quality:        {requirement: blocking, frequency: [prompt_change, model_change, nightly]}
  judge_meta_eval:    {requirement: blocking, frequency: judge_change}
  ops_hardening:      {requirement: blocking, frequency: [pre_ga, recurring]}

tooling:
  runner: <selected>
  eval_framework: <selected>
  rejected:
    - option: <name>
      reason: <why>

modules:
  - path: learning-loop/validation-policy.yaml
  - path: work-source/validation-policy.yaml
```

## Module skeleton

```yaml
schema_version: 1
scope: module
module: learning-loop
extends: ../validation-policy.yaml
tier: inherit                       # or an explicit override with justification

inherits:
  - OPERON-INV-001                  # referenced, never restated

invariants:
  - id: LL-INV-001
    statement: "A learning attaches to an agent identity, never to an instance."
    enforcement: [runtime_guardrail, test]
  - id: LL-INV-002
    tightens: OPERON-INV-001
    statement: "A learning-promotion lease is held by exactly one worker and expires within 60s."

boundaries: ./boundary-map.md
contracts: ./contracts/
golden_sets: ./golden-sets/
case_catalog: ./case-catalog.md

gates:
  llm_quality: {requirement: blocking, threshold: 0.95}   # tightened from parent default
```

## Resolution semantics

**Order:** parent defaults → module overrides → per-component overrides. Later wins, subject to the tighten-only rule.

**Tighten-only (rule 9).** A module may make an inherited requirement stricter — advisory→blocking, threshold 0.90→0.95, adding a gate. A module may **not** loosen one — blocking→advisory, threshold downward, waiving an inherited gate. A loosening child is a policy load failure, not a merge. This single rule is what keeps distributed files from silently diverging into weaker-than-parent states.

**Waivers are explicit and expiring.** If a module genuinely must waive an inherited gate, it is not a policy edit — it is a `waivers:` entry with an owner, a reason, and an expiry date, surfaced by the audit as an active finding until it lapses or is renewed. Silence is never a waiver.

**Provisional values expire like waivers.** A `PROPOSED` numeric tolerance adopted to keep a contract testable (Phase 4) is recorded as a `provisional_values:` entry with the parameter, the value, an owner, and an expiry:

```yaml
provisional_values:
  - id: OPERON-PROV-001
    parameter: "BND-009 reconciliation freshness window"
    value: 120s
    owner: <human>
    expires: 2026-10-01
```

Tests assert the provisional value; an expired provisional is an active finding. `OPEN` is reserved for parameters whose *semantics* are undecided — an `OPEN` that merely awaits tuning is a conformance finding.

**Layer lanes follow the same asymmetry.** A module inherits each lane's status. It may *activate* a lane the parent declared empty (e.g. the module introduces the product's first model call site) — that is an addition, recorded in the module policy with its own golden sets and gates. It may never *empty* an active inherited lane except through an expiring waiver. An undeclared-absent lane anywhere in the chain is an audit finding; a declared-empty lane with a reason is a decision.

**Effective policy.** Any tool consuming these files resolves the chain and can emit the effective policy for a given path. Design for that read: nothing in the format should require a human to mentally merge three files to know whether a gate is blocking.

**Fail-closed defaults.** A gate class present in the parent but absent from a module resolves to the parent's requirement, not to "unspecified." An unrecognized key fails load rather than being ignored — silent key drift is how policy files rot.

**ID namespacing.** Product invariants take the product prefix; module invariants take the module prefix. IDs are never reused after retirement — a retired invariant is marked `retired: <date, reason>` and kept, so historical audit findings stay traceable.

**Parallel-greenfield coexistence.** `coexistence` is optional. When present, `isolated_root` is the only writable location for new harness artifacts and implementation until cutover. `protected_paths` and incumbent gates remain read-only; a child policy may add protected paths but never remove one. `ci_integration: additive_opt_in` forbids redirecting existing required commands or gates — it constrains integration with the *incumbent's* pipelines only; the isolated root's own additive CI lane is walking-skeleton scope and expected from the first skeleton ticket. Cutover is a separate human-ratified change that must satisfy every declared `cutover_requires` item and preserve a rollback path.

## Interop with validation-harness-audit

The layout above is the authoritative schema for `validation-policy.yaml`; validation-harness-audit consumes it rather than defining its own (its `references/harness-policy-conformance.md` describes the consuming side). The audit ingests the policy chain during discovery, seeds its claim catalog from the invariants and contracts — keeping the namespaced IDs — and diffs the built system against the declared lanes, gates, and waivers: an undeclared-absent lane is a finding, a declared-empty lane is a decision, an expired waiver is an active finding. Criticality tiers use the shared C0–C4 scale; the audit's `references/criticality-model.md` is the canonical rubric. If the audit skill is not installed, any reviewer can perform the same diff by hand: resolve the chain to the effective policy and compare each declared gate with what CI actually enforces.
