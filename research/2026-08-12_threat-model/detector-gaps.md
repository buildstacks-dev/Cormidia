# Threat-model control and detector gaps

Status: **DRAFT-FOR-OWNER — ANALYSIS ONLY**

This gap list supports the owner pass on HB-072. It neither creates HB-073 cases
nor changes any harness status. A “detector gap” means no current executable test
was found that pins the stated hostile composition; it does not mean no nearby
control or test exists. “Control absent / owner decision” is stronger: the current
source does not implement the assumed property, so a future test must not invent
the expected behavior before the owner ratifies it.

Audit snapshot: 2026-08-12. The review covered the replacement `tests/**` corpus,
the case catalog/backlog, the required invariants/control documents, the relevant
runtime/org source, and GitHub issues #20, #198, #339, and #423. It did not read or
search `archive-do-not-read/**`.

## Gap register

| Gap | Kind | Control the model must not assume is pinned | Current evidence and nearby pins | What is not pinned / current observation | Candidate rows |
| --- | --- | --- | --- | --- | --- |
| GAP-01 | Detector gap | “Untrusted content is treated only as data” across GitHub issues, PR comments, ordinary README files, and dependency changelogs. | `prompts/episode/plan.md`, `src/org/turn-runner.ts`, and `src/org/planning-inputs.ts` frame bounded inputs as untrusted data. `tests/hermetic/cf-inv-001/cf-inv-001-seeds.test.ts` proves injected memory text cannot alter resolved authority or the gate. | No named-channel walk was found that plants hostile text in each of the four required channels, carries the exact bytes into an actual consuming turn, and observes both semantic steering and attempted routine/critical effects. The current pin establishes authority containment for memory, not ingestion behavior or outcome for these channels. | DFO-001…004 |
| GAP-02 | Detector gap | A schema-valid provider output cannot become instruction/authority for a later turn. | Structured verdict markers, immutable resume identity, independent review, and governed learning are tested; e.g. `tests/unit/cf-inv-012/s3-verdict-marker.test.ts` and learning state-machine/publisher families. | No general turn-N hostile output → durable handoff/resume/brief → turn-N+1 unsafe action detector was found. Envelope validity and provenance do not establish semantic truth or safe downstream interpretation. | DFO-005, DFO-015 |
| GAP-03 | Control absent / owner decision | A schema-valid event inbox file came from an authorized producer, and its `source` field is authenticated. | B-13/J-10/SM-EVENT pin closed kind/schema parsing, malformed/unknown retention, subscribers, marks, replay, and retirement. | `src/org/event-schemas.ts` requires only a non-empty `source`; `src/org/events.ts` accepts any schema-valid matching-app file. No MAC/signature/producer identity or directory-writer provenance check exists in the reader, and no detector pins an external ACL assumption. The owner must decide the intended trust/provenance rule before an expected refusal is encoded. | DFO-006, DFO-017 |
| GAP-04 | Detector gap + unsafe affordance observation | Batch approval lets the human distinguish every payload and cannot conceal a malicious outlier. | Exact-content hashes and per-item audit survive batching; one-by-one is the default; noninteractive decision paths require an identity, reason, exact ID, and confirmation. | `src/cli/approvals.ts` groups only by `(rule, app)`, prints each action truncated to 100 characters, and applies one answer/reason to the entire group. No hostile-outlier batch detector was found. A dangerous tail can be invisible in the preview even though the resulting grants are individually content-bound. | DFO-007 |
| GAP-05 | Detector/process gap | Approval TTL, exact binding, and denial lessons prevent fatigue/rubber-stamping under a fresh high-volume flood. | Pending TTL/expiry, content binding, reasons, denial lessons, WIP, and replay/dedup have deterministic pins. | No pin was found for fresh unique-item volume, anomaly surfacing, semantic justification quality, or operator attention. Rejecting an empty reason does not establish a meaningful decision; expiry bounds stale state, not fatigue before expiry. | DFO-007, DFO-017 |
| GAP-06 | Composed detector gap | Secret containment plus destination allowlisting prevents exfiltration even when acquisition and egress are separate actions. | `tests/unit/cf-split-secrets/secrets-split.test.ts` covers secret emission and same-command `cat .env \| curl`; CF-REG-204 covers operation-aware reads and fail-closed unknown emission. `tests/unit/cf-split-network/network-split.test.ts` covers destination parsing, and `tests/hermetic/cf-split-network/allowlist-budgeted.test.ts` proves allowlisted hosts proceed as budgeted. Surface-specific publication/report scrubbers also exist. | No generic body/content-flow detector was found for a synthetic secret acquired earlier and then sent in a separate allowlisted request that no longer names the secret path. The independent pins do not prove the composition. | DFO-008, DFO-016 |
| GAP-07 | Composed detector gap | F-PT-019/#20 route coverage plus network controls prevents every adapter-native read-bypass → egress chain. | `tests/hermetic/cf-inv-002/codex-hook-bridge.test.ts` pins the compensating Codex hook for forbidden reads/writes; shared adapter conformance and per-adapter bridges pin reported tool traversal and seeded omissions. | No all-adapter hostile composition was found that acquires a synthetic secret through each native tool/read/subagent route and then attempts allowed egress. Gate traversal, classification, and destination parsing are tested separately; content continuity is not. | DFO-008, DFO-010 |
| GAP-08 | Known open defect + missing replacement detector | Provider context/config writes are contained to the admitted worktree even when a repository controls symlink ancestors. | Other subsystems have symlink tests (B-14 bootstrap, B-10 identity, observer artifact routes), and `writeMaskedWorktreeFile()` rejects lexical absolute/`..` paths. | `src/runtime/worktree-context.ts` then calls `mkdirSync`/`writeFileSync` without `lstat`/realpath containment. Pi, Cursor, Grok, Muse, and OpenCode use it. No current `CORMIDIA-CASE-DET-001` occurrence or test of this writer was found; issue #198 remains open. Unrelated subsystem symlink detectors do not pin this seam. | DFO-009, DFO-011, DFO-013 |
| GAP-09 | Open ratified finding | An action that resolves outside the worktree is always mapped to a never-scopeable rule. | Absolute, home, parent-escape, foreign-repository, and many destructive/effect classes are classified; disposition tiers and scope refusal are tested. | INV-003 and `validation-design/validation-policy.yaml` explicitly record F-PT-014: “outside-worktree actions” has no `NEVER_SCOPEABLE_RULES` mapping, and the nearest live classes are human-widenable. The guardrail leg is parked; the threat model must not describe it as enforced. | DFO-009, DFO-012, DFO-013 |
| GAP-10 | Control absent / containment-only | A user-installed provider binary is the certified binary, not a malicious replacement that reports the same version. | Auto-update suppression, version floors, isolated provider homes, expected hook configuration, fail-closed handshakes, doubles, and sandbox live certification are pinned. Grok real-repo use remains blocked on #339. | Installed-binary identity is self-reported. No binary digest, signature, provenance pin, or hostile-update simulation was found. Versions newer than `testedWith` are reported rather than blocked; a malicious binary can advertise the accepted version and cooperate with the handshake while acting out of band. | DFO-010 |
| GAP-11 | Composed containment gap | An agent/provider cannot forge approval authority by writing store bytes outside the reported gate path. | Direct agent writes to approval files classify `un-grantable`; orphan grants refuse; forged un-grantable objective grants refuse; item/grant state machines are extensively tested. | `tests/hermetic/cf-inv-001/cf-inv-001-seeds.test.ts` deliberately shows that a byte-valid decided record plus its matching live grant, planted directly in the store, authorizes once. No detector proves every provider/OS route cannot plant that pair out of band. This is the approval store's root-of-trust assumption, not a defect in action-hash matching. | DFO-010, DFO-011 |
| GAP-12 | Detector gap | Dependency documentation and install output cannot alter instruction precedence or induce a tool/effect after scripts are disabled. | Dependency scripts default off and dependency/script manifest changes trigger stronger review/gate routing. | No detector was found that seeds hostile package README/changelog/install text and follows it through the actual review/build context. `PNPM_CONFIG_IGNORE_SCRIPTS` prevents execution by the package manager; it does not make the bytes safe instructions for a model. | DFO-004 |
| GAP-13 | Detector gap | A hostile provider output cannot create a plausible false-green record that passes all later human/reporting surfaces. | Structured output validators, exact-HEAD evidence, release attestations, incomplete/inconclusive rules, observer health, and independent review each have seeded detectors. | No single composition was found in which a compromised provider supplies schema-valid false evidence through review, durable state, observer/report, and the next decision point. Component truthfulness tests do not prove the compound T-9 amplifier is closed. | DFO-002, DFO-005, DFO-014, DFO-016 |

## Controls that are already pinned — do not list these as wholly absent

- Obfuscated/nested critical effects, direct GitHub mutation routes, new/unknown
  tool shapes, classifier/disposition parity, and gate-source writes have CF-INV-002
  coverage with seeded permissive-classifier controls.
- Exact-content approval identity, single-use replay, scoped/objective scope/TTL/cap/
  revocation, orphan grants, per-use audit, and ambiguous-execution behavior have
  CF-INV-003/SM-APPR/SM-GRANT/typed-executor coverage.
- Secret metadata-vs-content classification and fail-closed unknown emissions have
  CF-REG-204/CF-SPLIT-SECRETS coverage; destination resolution and allowlist
  refinement have CF-SPLIT-NETWORK coverage. GAP-06/GAP-07 concern their composition.
- Event schema, kinds, per-role delivery, idempotency, and retirement are covered.
  GAP-03 concerns producer authenticity, which those controls do not claim.
- Grok isolation, auto-update suppression, expected hooks, handshake failure, and
  sandbox certification are covered. GAP-10 concerns a hostile/replaced binary that
  behaves outside those observations.
- Bootstrap/observer/org-home symlink refusal is covered at those seams. GAP-08 is
  specifically the shared provider context writer used by issue #198.

## Owner decisions required before future detector authoring

These are questions, not proposed contract truth:

1. What authenticates a file-drop event producer: filesystem ownership/ACL,
   content MAC/signature, a typed producer API, or explicit treatment as untrusted?
2. May allowlisted egress carry arbitrary worktree/provider-context bytes, or is a
   broker/content-flow boundary required for secrets and private source?
3. Is same-rule/app batch approval retained; if so, what full-payload distinction
   and confirmation must the human see before one decision covers several actions?
4. What establishes provider binary identity, and which version/provenance changes
   block real-repo turns versus merely trigger a note or recertification?
5. What is the ratified outside-worktree disposition mapping for F-PT-014?
6. Which downstream handoffs must preserve and enforce untrusted provenance for
   provider output, not merely its content hash and schema?

Until the owner answers these, HB-073 must not encode one side as expected behavior.
