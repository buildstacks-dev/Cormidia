# HB-072 threat model — owner authoring template

Status: **OWNER-AUTHORING TEMPLATE — NOT HB-072 EVIDENCE**

This Phase 1 artifact is a worksheet for the product owner. It was prepared by an
AI and therefore does **not** satisfy HB-072, does not unblock HB-073, and must not
be named as a human-authored or human-reviewed threat model. Do not change
`validation-design/threat-model-status.yaml` or any backlog status from this file.

The owner may copy, correct, prune, extend, and rewrite this template. HB-072 is
eligible for its separate hash-bound admission step only after attributable human
authorship and review cover all ten canonical surfaces and produce owner-selected
abuse-case IDs. Until then, `CF-OPS-ABUSE` keeps its intentionally unresolved
`mixed` oracle.

## 1. Review metadata

| Field | Owner entry |
| --- | --- |
| Human author / date | |
| Human reviewer / date | |
| Exact commit and deployment shape | |
| Boundary-map version or digest | |
| Runtime/provider versions in scope | |
| First non-sandbox target, if any | |
| Accepted residual-risk owner | |
| Review trigger acknowledged | Material change to a trust boundary, deployment shape, adapter capability, or externally reachable surface |

## 2. Model boundary and assets

Fill these before rating individual threats.

| Topic | Owner entry |
| --- | --- |
| Protected outcomes | Authority remains attributable and bounded; secrets and private source stay contained; cross-app/worktree boundaries hold; approvals, effects, and evidence remain distinct and truthful; irreversible effects occur at most once under exact authorization. |
| Actors in scope | Solo operator; ordinary repository contributor; malicious GitHub user; compromised dependency maintainer; malicious or compromised provider/vendor/CLI; local process with the operator's user privileges; confused or prompt-injected agent; honest operator under fatigue. Correct, prune, or extend. |
| Entry channels in scope | GitHub issue bodies and comments; PR bodies/review comments; repository files including README; dependency metadata/changelogs/install output; provider responses and resumed sessions; file-drop event inbox; approval queue; provider tool/hook transports; managed worktrees and symlinks; learning and observer inputs. Correct, prune, or extend. |
| Authority/effect surfaces | Runtime gate and adapter bridges; approval store and grants; objective grants; configured GitHub repositories; merge/release executors; allowlisted network egress; provider-global memory; active learning bundle; human-ratified protocol files; org/app state; managed clones/worktrees; observer exports. Correct, prune, or extend. |
| Explicit exclusions | Historical material under `archive-do-not-read/**`; HB-073 implementation; release qualification under RQ-1. Add only exclusions that do not remove a ratified TM surface. |

## 3. Canonical surface closure

Every final threat row cites one or more of these IDs. Every surface must cite at
least one final threat ID; a surface may never be marked covered merely because its
name appears here.

| Surface | Ratified scope | Final threat IDs |
| --- | --- | --- |
| TM-01 | Authority, gates, grants, approvals, and critical-effect execution | |
| TM-02 | Secrets and credentials | |
| TM-03 | Cross-org/app identity and isolation | |
| TM-04 | Untrusted GitHub, event, repository, and model content; prompt injection and evidence forgery | |
| TM-05 | Provider tool calls, gate bridges, and app-owned subprocess/toolchain execution | |
| TM-06 | Managed workspace, filesystem, symlink, and checkout boundaries | |
| TM-07 | Merge authorization and false-evidence attacks | |
| TM-08 | Learning capture and promotion injection | |
| TM-09 | Observer capability and confidentiality | |
| TM-10 | Replay, confused-deputy, resource-exhaustion, and denial paths | |

Note: issue #198 calls its Pi symlink defect threat `TM-002`. That issue-local
label is not the canonical surface ID `TM-02`; in this worksheet the defect maps
to canonical surface `TM-06` (and may also affect TM-01/TM-03/TM-05).

## 4. Rating and disposition vocabulary

- STRIDE tags: `S` spoofing, `T` tampering, `R` repudiation, `I` information
  disclosure, `D` denial of service, `E` elevation of privilege.
- Draft likelihood and impact: `low | medium | high | critical`. The owner must
  define or replace this scale before ratification; candidate ratings are not policy.
- Residual disposition: `accepted | mitigated | transferred | blocking`. Every
  disposition names a human owner and rationale.
- Consequence tier: `routine | budgeted | grantable | human-only | un-grantable`,
  using the live per-rule table in `src/runtime/gate.ts`, plus any refinement in
  the composed gate. `human-only` and `un-grantable` are never agent-decidable;
  `un-grantable` admits no standing grant.
- C3 control points: T-1 gate false negatives; T-2 approval integrity; T-3
  authority/protocol protection; T-4 secret containment; T-5 settlement/budget;
  T-6 app/worktree isolation; T-7 merge/base truth; T-8 destructive containment;
  T-9 evidence truthfulness; T-10 learning activation; T-11 adapter enforcement;
  T-12 irreversible execution.

Treat a control as **detector-pinned** only when the evidence names an executable
detector with a seeded negative control. A design statement, prompt instruction,
version note, or one successful live run is not a regression detector.

## 5. Threat register — one row per threat

Duplicate the blank row for every distinct attacker goal × entry channel ×
authority surface. Split rows when channels have materially different controls or
residual risk. Do not collapse “prompt injection” into one row if issue content,
repository content, and dependency content reach different turns or guardrails.

| Owner threat ID | Status | Canonical TM surface(s) + STRIDE | Attacker and goal | Entry channel, trust boundary, and data flow | Authority/effect surface; consequence tier; C3 points | Preconditions and attack path | Existing controls and detector evidence | Unpinned assumptions / gap IDs | Residual likelihood / impact / rating | Human disposition, owner, rationale | How the abuse lane would test this | Owner-selected oracle / cheapest honest layer |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| OWNER-T-___ | OWNER-EDITING | TM-__ · S/T/R/I/D/E | Who can act, what access they need, and the outcome they seek. | Name the exact untrusted channel, parser/assembler, downstream consumer, and durable hop. | Name the exact rule/tier or state authority and T-# points; do not infer authority from module ownership. | A concrete sequence with prerequisites, confused-deputy step, and terminal harm. | Name preventive/detective controls and exact test/evidence paths. Mark prompt-only, live-only, or detector-pinned. | GAP-__ or `none found`, with evidence. | L=__; I=__; draft/final rating=__. Describe remaining harm after controls. | accepted/mitigated/transferred/blocking; human owner; why. | Seed the hostile input/effect, name the negative control that proves the detector can fire, then state the expected bounded outcome and evidence. No green by absence. | Owner chooses `state`, `evid`, `refusal`, `diff`, `det`, `stat`, `live`, or a valid composition, plus L1–L5. Leave unresolved until authored. |

## 6. Per-row authoring checks

For each row, the author and reviewer confirm:

- The attack names an actor, goal, prerequisite, entry channel, authority/effect
  surface, and consequence—not only a vulnerability label.
- The row distinguishes steering from successful effect. A model obeying injected
  text is one failure; an unclassified effect, forged approval, secret leak, merge,
  or false-green record is the terminal failure.
- Existing controls are separated into prevention, detection, recovery, and human
  process. Prompt prose is not represented as deterministic enforcement.
- The control evidence points to the exact detector and its seeded negative
  control. Component tests do not establish a composed path unless the composition
  itself is exercised.
- INV-002 is respected: every critical route, including direct APIs, new provider
  tools, nested/encoded shell, and classifier-bypass routes, is in scope.
- INV-003 is respected: approval is distinct from execution; exact-content,
  single-use or explicitly scoped grant shapes do not drift; ambiguity never causes
  blind re-performance.
- INV-015 is respected: missing, corrupt, unknown, unparseable, or unavailable
  state narrows capability and claims; it never widens either.
- Every residual risk is explicitly accepted, mitigated, transferred, or blocking,
  with a human owner. “Covered by the gate” is not a residual-risk disposition.
- “How the abuse lane would test this” names a seeded hostile case, a real oracle,
  and the evidence of bounded behavior. Missing, skipped, or ceiling-stopped work
  is incomplete/inconclusive, never pass.

## 7. Whole-model review gates

The human author/reviewer should not advance the canonical status unless all are true:

- All TM-01…TM-10 surfaces close to at least one threat row.
- GitHub issues, PR comments, README content, dependency changelogs, provider
  output, and event-inbox content are separately considered.
- Gate bypass, allowed egress, approval fatigue, symlink escape, and compromised
  provider update paths are explicitly dispositioned.
- Every assumed control is either detector-pinned or listed as a gap; component
  controls are not used to claim an untested composition.
- Any new product-truth ambiguity has been routed as a finding before expected
  behavior is encoded. Any structural mismatch has followed the binding harness
  revision route rather than being improvised here.
- The final model says whether it is sufficient for future HB-073 authoring,
  droplet migration, and first non-sandbox onboarding. This conclusion does not
  activate RQ-1 or count as release evidence.
- The separate admission record, if later changed by the human, identifies the
  exact reviewed artifact bytes, all ten surface IDs, attributable author/reviewer,
  owner-authored abuse-case IDs, and the matching SHA-256.

## 8. Binding sources for the owner pass

- `validation-design/harness-backlog.md` — HB-072/HB-073 acceptance and gate.
- `validation-design/routing.md` — blocked-work, tighten-only, finding, and
  structural-revision procedure.
- `validation-design/risk-allocation.md` §6 — ten-surface scope, timing, owner, and
  review trigger.
- `validation-design/invariants.md` — INV-002, INV-003, and INV-015.
- `validation-design/system-map.md` §5.2 — T-1…T-12 C3 control points.
- `docs/approvals/design.md` and `src/runtime/gate.ts` — approval lifecycle,
  consequence tiers, classifier routes, and current implementation comments.
- `validation-design/threat-model-template.md` and
  `validation-design/threat-model-status.yaml` — canonical scaffold and current
  awaiting-human state.

