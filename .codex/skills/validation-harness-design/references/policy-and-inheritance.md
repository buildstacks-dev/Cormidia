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

**Parent holds:** criticality tier map, product-level invariant registry, cross-cutting gate requirements, CI cost tiering defaults, tooling selection, and a `modules:` list naming each child policy path. Enumeration lives in one place; editing does not.

**Module holds:** `extends:` pointer, module-scoped invariants, boundary and contract locations, golden-set paths, and any tightened gate requirements.

## Parent skeleton

```yaml
schema_version: 1
scope: product
product: operon
default_tier: T2

tiers:
  learning-loop: T2
  billing: T3            # per-component override
  scratch-tools: T1

invariants:
  - id: OPERON-INV-001
    statement: "No work item is leased by more than one worker at a time."
    enforcement: [runtime_guardrail, test]
    applies_to: [work-source, learning-loop]

gates:
  unit:            {requirement: blocking}
  integration:     {requirement: blocking}
  llm_contract:    {requirement: blocking, frequency: per_commit}
  llm_quality:     {requirement: blocking, frequency: [prompt_change, model_change, nightly]}
  judge_meta_eval: {requirement: blocking, frequency: judge_change}

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

gates:
  llm_quality: {requirement: blocking, threshold: 0.95}   # tightened from parent default
```

## Resolution semantics

**Order:** parent defaults → module overrides → per-component overrides. Later wins, subject to the tighten-only rule.

**Tighten-only (rule 9).** A module may make an inherited requirement stricter — advisory→blocking, threshold 0.90→0.95, adding a gate. A module may **not** loosen one — blocking→advisory, threshold downward, waiving an inherited gate. A loosening child is a policy load failure, not a merge. This single rule is what keeps distributed files from silently diverging into weaker-than-parent states.

**Waivers are explicit and expiring.** If a module genuinely must waive an inherited gate, it is not a policy edit — it is a `waivers:` entry with an owner, a reason, and an expiry date, surfaced by the audit as an active finding until it lapses or is renewed. Silence is never a waiver.

**Effective policy.** Any tool consuming these files resolves the chain and can emit the effective policy for a given path. Design for that read: nothing in the format should require a human to mentally merge three files to know whether a gate is blocking.

**Fail-closed defaults.** A gate class present in the parent but absent from a module resolves to the parent's requirement, not to "unspecified." An unrecognized key fails load rather than being ignored — silent key drift is how policy files rot.

**ID namespacing.** Product invariants take the product prefix; module invariants take the module prefix. IDs are never reused after retirement — a retired invariant is marked `retired: <date, reason>` and kept, so historical audit findings stay traceable.

## Interop with validation-harness-audit

If `validation-harness-audit` is installed, use the schema in its `references/validation-policy-schema.md` as authoritative and treat the skeletons above as the inheritance layer on top of it. If not installed, derive an equivalent structure and state the derivation explicitly in the deliverables, so a future audit knows what it's reading.
