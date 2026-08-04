# Elicitation log — Cormidia validation harness design

Near-verbatim record of stakeholder input per phase/concept, with what was dropped and why.
Stakeholder = AI product-owner agent grounded in ./docs/ and ./rambling.txt (no live human;
`[stated]` unused campaign-wide).

## Phase 0 — scope & module map

**Rev 1 gate: REFUSED** — artifacts had not been written to `validation-design/`
(process defect, fixed), plus six substantive objections, all accepted:

1. Provisional criticality column pre-empted Phase 1 teach-first tier work → removed;
   nothing in Phase 0 is a risk anchor.
2. Authority & governed configuration missing as an explicit module → added as M11
   ("Agents rewriting their own authority is one of the product's central prohibitions").
3. HMAC review authorization wrongly folded into the approval queue → moved to M4
   (merge integrity); "related security boundaries, but not the same mechanism."
4. M8 overstated redaction: "L3 brief.md, prompt.md, output.md, and session.log are
   intentionally verbatim local evidence... The ratified claim is that the shared
   secret-pattern list governs scanning, scrubbing, bounded previews, exports, and
   capture-time redaction — not that every brief is redacted. My rambling was broader;
   the docs win. Record that conflict as a product-truth finding." → F-PT-001.
5. M15 (release-gating replacement) contradicted "harness is not a module" → struck as a
   module; tracked as campaign/policy obligation; active release-handoff stays under
   build-loop/approvals.
6. Deployment shape: "'Always-on' is too strong: autonomous scheduling requires installed,
   healthy scheduler evidence. The packaged apps.yaml is a template, not proof of the
   active org's current registry... I do not know the actual active-org or scheduler state
   from this corpus. Record that as a product-truth finding." → F-PT-002.

Direct answers to designer questions:
- **M10:** "deserves a later deep pass. Reset is archive-backed destruction across local
  state and GitHub artifacts; init/upgrade/promote also make atomicity and evidence-ladder
  claims."
(Renumbering note: rev-2 inserted M11 Authority & governed configuration, shifting rev-1
numbers up — rev-1 M12 "learning loop" is now **M13**, and rev-1 M13 "observe/report" is
now **M14**. The stakeholder quotes below used the rev-1 numbers.)

- **M12 → now M13 (learning loop):** may stay broad-and-shallow "but do not dismiss it as safely
  'medium.' The learning loop is a persistent prompt-injection surface." Named floor:
  candidates never resolve; agents never write protected surfaces; deterministic publisher
  is sole protected writer; authorization never masquerades as validation; agent
  self-reports cannot drive promotion metrics; T3 has no live canary.
- **M13 → now M14 (observe):** needs explicit confidentiality slice — loopback binding,
  capability enforcement, no mutation routes, traversal/symlink confinement, no raw L3 in
  snapshots or SSE, capture-time redaction for long-lived narratives.
- **Fast mode:** "no. Teach each concept normally, especially invariants and risk tiers.
  I know the product; I am not going to pretend I already know your validation framework."

Confirmed unchallenged: `product` mode, clean-slate greenfield,
`archive-do-not-read/**` protected no-read path, `tests/` implementation root,
`CORMIDIA-` namespace.

Dropped: nothing dropped; all rev-1 content either survived or was corrected as above.

**Rev 2 gate, round 2: REFUSED** (after a workspace-path defect — artifacts were written
outside the workspace, then relocated — plus one approval-semantic error and two record
corrections, all accepted):

7. M1 "never-grantable" was wrong: "production deploys, exact external publications, and
   other critical actions can receive fresh, content-bound one-off approval. They are never
   broadly scopeable. Builder/reviewer self-merge or self-approval is separately
   forbidden/unrepresentable." → M1 reworded: never-*broadly-scopeable* list (one-off
   content-bound approvals possible, e.g. A4 release executor); self-merge/self-approval
   separately unrepresentable. This keeps M1 consistent with M2 and A4.
8. `prompt.md` added to the verbatim L3 list in M8 and F-PT-001.
9. This renumbering note added.

## Phase 1 — system map (beat 3: the product walk)

Stakeholder's walk, near-verbatim (2026-07-31). Framing offered: "walk me through how
Cormidia gets work and what must be observably different when it's done"; focusing question:
"which journey, if it silently went wrong for a week, would hurt you most?"

> I don't experience Cormidia as fifteen modules. I experience it as a pile of promises
> about what happens after I stop watching.
>
> [Onboarding] generated is not registered, registered is not runtime-ready, runtime-ready
> is not live, and live is not autonomously scheduled... Each rung needs its own evidence.
>
> [Planning] the observable result before delivery begins is a validated, persisted
> EpisodePlan — not a plausible paragraph saying what the model intends to do... A goal
> that produced fluent planning prose but no usable durable plan did nothing.
>
> [Delivery] Every label is an announcement after the corresponding artifact exists.
> `op:in-review` without a PR is a lie. "Merged" without the exact reviewed commit, fresh
> checks, closed issue, and real merge evidence is a lie. A reviewer saying APPROVE in
> prose is irrelevant unless the structured verdict becomes an authorized GitHub review
> bound to that HEAD.
>
> [Default branch] The default-branch defect is the scar I keep touching... Every journey
> that creates a branch, compares a diff, verifies ancestry, resets an app, or qualifies
> release bytes needs to resolve the actual remote default. Wrong-and-loud is survivable;
> wrong-and-green is not.
>
> [Approvals] Approval is not execution... If the UI says "approved" in a way a reasonable
> person reads as "deployed," that is a product defect. If the remote effect happened but
> the acknowledgement write crashed, the next tick must reconcile through an idempotency
> marker or stop as ambiguous. It must not helpfully perform the effect again.
>
> [Denial/resume] A denial has to matter on the resumed pass... same native session and
> pass with the same role, assignment, context, worktree, completed-pass set, run, and
> decision history. Any mismatch should stop before spending. The claim number does not
> increment merely because the approvals system did its job.
>
> [Money] Every provider invocation is real spend... It needs one settlement. A failure,
> cancellation, approval stop, or malformed verdict does not make the turn free. Unknown
> usage is not zero. Mechanical work really is zero-provider-cost, but must not be counted
> as a provider turn.
>
> [Budget-pause crash seam] if the dispatcher writes the budget overlay and dies before
> creating the synthetic approval item, do later ticks deterministically converge to
> exactly one item? The docs specify both effects, but I cannot recall a ratified crash
> transaction joining them. I don't know — record it as a product-truth finding. My
> expected product outcome is obvious: the app remains unable to claim new spend, and the
> human eventually sees one attributable decision item, not zero and not five. But
> expectation is not a documented crash contract.  → F-PT-003
>
> [Time] A tick is a fresh process... durably commits the spawn decision, starts detached
> work, and exits... If the laptop slept through ten windows, I want one reconciled firing
> with the missed-window count, not ten frantic catch-up runs. If nothing is due, no model
> should be constructed. Blocked work should be a named outcome rather than vanishing.
>
> [Event inbox] One support-feedback event may need to reach both Support and Planner.
> "Done" is not "the file disappeared after the first subscriber ran." Every current
> subscriber must consume it once, potentially across different ticks... A malformed
> payload stays for repair and fails loudly... shared intake consumed too early turns a
> standing organization into a random first-reader-wins machine.
>
> [Audience roles] Scheduled Support and Marketing work ends in grounded internal
> artifacts or drafts, not public communication. External publication is a separate
> exact-payload action. SRE has the same split: analysis may be complete while incident
> filing is pending, failed, or ambiguous. I want those claims separate.
>
> [Learning] "completed" is dangerously overloaded... Authorization means I allowed the
> change; validation means a declared experiment measured improvement. None of those words
> may stand in for another. A candidate file is not active knowledge, and an agent
> self-report is not efficacy evidence.
>
> [Recovery] reopen the accepted plan, find the last valid artifact, and continue...
> Once provider work may have happened, ambiguity is not permission to retry; the explicit
> re-arm transaction is the boundary.
>
> [Worktree bytes tension] The docs also permit restart-clean to discard scratch that was
> never accepted as a durable episode artifact. I cannot instantly tell you where
> partially useful, uncommitted builder work crosses from disposable scratch into
> protected work. That line matters. I don't know — record it as a product-truth finding.
> My call as owner: ambiguous worktree bytes should be preserved and inspected rather than
> reset, but that is a proposed safety judgment, not ratified truth.  → F-PT-004
>
> [Hardest fact to name a writer for] "where this ticket is now." There isn't one innocent
> field... Recovery defines an authority order across those sources. That is deliberate,
> but it is also exactly where partial failure can manufacture contradictory stories. I
> want the map to show those competing-looking facts rather than compress them into a box
> labeled "ticket state."
>
> ["Effective app pause"] human registry status and the dispatcher's budget overlay are
> separate facts with separate writers. Good. Keep them separate. What must be unique is
> the computation that decides whether new work can claim. Similarly, `op:ready` has more
> than one authorized producer — Planner, human, and the loop's dependency re-arm.
>
> [Reset] must archive first, refuse fresh runs, locks, journals, and pending approvals...
> If reset affects a sibling app, the harness has failed at the highest level.
>
> [Observe/Reports/Narrative] legible without becoming participants... A history page must
> not invent a parent relationship from similar prose or timestamps... Narrative captures
> live for years, so current secret scrubbing at capture time matters more there.
>
> [Green] green has to mean the candidate that actually ships passed the checks that
> supposedly protect it... If a provider can create the sentence "tests passed" and
> satisfy the evidence requirement, we have built theater. Interim green-by-absence is not
> release evidence.
>
> [Highest-hurt journey] the unattended scheduled-delivery journey while I'm asleep:
> OS due window → one durable dispatch decision → valid EpisodePlan → bounded provider
> turns → gate-classified actions → correct GitHub artifacts → exact review and merge
> boundary → exactly-once settlement → truthful morning status. The worst version is not a
> visible crash. It is seven mornings of plausible green summaries over the wrong reality.

Dropped: nothing. Two "I don't know"s converted to findings F-PT-003, F-PT-004 (owner's
preserve-and-inspect preference recorded as [simulated] pending ratification).

## Phase 1 — criticality tier (beat 3: consequence ramble)

Six map objections first (all accepted): §0 tier proposal removed as anchoring;
`health-alert` corrected to file-drop event (GitHub supplies ticket-ready, pr-opened,
ci-failed, release-shipped); publisher = sole *automated/component* writer (humans also
write protected surfaces); org/app config writer split into human ratification authority
vs deterministic lifecycle-command writers; §2.5 write discipline corrected to three
shapes (append-only/keyed, atomic whole-file replacement, journals); F-PT-003/004 restated
as blocked candidate contracts — nothing unratified gets encoded.

Consequence ramble, near-verbatim highlights:

> The first distinction in my head is between damage I can reverse technically and damage
> I can actually undo. Git makes people sloppy about that... "Revertable" is not the same
> as harmless.
>
> [Money] Once provider spend happens, I cannot unspend it... The scarier failure is
> under-accounting, because it disables the next safety decision... An undercount lets the
> machine keep spending while every surface says there is headroom. Subscription-backed
> equivalent cost... is the loop detector. Metered or unknown billing is worse because
> then the accounting defect is directly monetary.
>
> [Wrong-repo/base merge] more serious than the dollar loss... the effect crosses the
> product boundary I authorized... That is why default-branch resolution is not a little
> git utility. An app boundary failure is worse than a bad change inside the right app...
> If state, context, approval scope, or worktree identity bleeds across apps, the
> runtime's central isolation promise is false.
>
> [Secrets] not repaired by deleting the local file... the credential's blast radius may
> not be solo-sized. [External publication] I cannot make every recipient unsee it...
> exact-payload and exact-command approval matters more than a generic grant.
>
> [Lost work] not a safety incident in the bank-or-hospital sense... The severity of one
> loss is bounded; the recurrence is what kills the product.
>
> [Reset] Resetting the intended sandbox app with a verified archive is routine.
> Resetting a sibling app, deleting the human checkout, or crossing a fresh run is a major
> containment failure.
>
> [Approvals] near the top because it is supposed to contain every other consequence...
> A false negative — classifying a real critical effect as routine — is qualitatively
> different [from false positives]. If the approval boundary lies, every downstream
> statement about "human-gated" becomes marketing copy. [Gate split] harmless text
> classified as deploy = availability damage; obfuscated real deploy not classified =
> authority damage; the second deserves far heavier proof.
>
> [False green] an amplifier... healthy because it interpreted missing GitHub data as an
> empty queue, unavailable usage as zero, a definition file as scheduler health, or
> approval as execution... its lie changed my decision. Most of Observe is
> low-consequence display work. Its source-health semantics, confidentiality boundary,
> and attention claims are not... a ledger aggregate that silently deduplicates recorded
> rows or hides unsettled turns corrupts the management truth.
>
> [Planning] prose quality belongs in repeated evaluation, but the deterministic plan
> validator, creator-scope conditions, mandatory gates, independent-review floor, and
> budget arithmetic carry higher consequences because they decide what is allowed to run.
>
> [Review] A bad model answer is less concerning than a parser, delivery path, or merge
> gate that converts malformed or stale evidence into approval.
>
> [Dispatcher] Missing one grooming pass is delay. Starting the same expensive episode
> twice, consuming one event for only the first subscriber, bypassing a budget pause, or
> spawning after a terminal decision is more serious.
>
> [Recovery] an especially broad multiplier... The laptop will sleep, auth will expire,
> GitHub will fail, and processes will die. Those are normal stimuli for this product,
> not exotic chaos scenarios.
>
> [Learning] mostly low-consequence while producing inert candidates... A protocol or
> permission change disguised as memory is an authority bypass. Silently upgrading
> [authorized-but-unvalidated] to "validated" is evidence fraud.
>
> [Context] A cache miss costs money. Incorrect authority precedence or loading another
> app's memory changes what the agent believes it may do. Not comparable failures.
>
> [Adapters] A missing optional fan-out feature is a documented degradation. A gate hook
> that does not see a real tool path, a budget guard that observes usage too late, or a
> resume implementation that binds the wrong session is much more consequential.
>
> [CLI] consequence follows the claim, not the file. A dry run that spends tokens, a
> reset that executes despite missing confirmation, --json success after a refusal,
> silent wrong-org resolution: not cheap.
>
> [Calibration] This is not a payment processor, hospital system, or avionics
> controller... Most failures affect my money, my repos, my time, and my trust. But
> "solo operator" does not make every boundary a toy... The right shape is a production
> system with a concentrated set of high-consequence control points, surrounded by much
> cheaper ordinary product behavior.
>
> My natural split is therefore not "core modules serious, leaves trivial." It is
> narrower: authority, approval, secret containment, exact settlement, app isolation,
> merge authorization, destructive lifecycle operations, and truthful evidence claims
> carry the heavy assurance burden. Ordinary planning quality, drafting, UI layout,
> report presentation, cache economics, and candidate generation need solid production
> validation without pretending they are settlement engines. Within mixed modules, the
> harness should follow the consequential function... The ten-line decision that admits
> a merge or widens authority gets more proof than the thousand-line page rendering its
> result.
>
> And the least reversible chain remains: an unattended turn acts under the wrong
> authority, exposes a secret or performs an external effect, then the evidence layer
> reports green. That combines the real harm with delayed discovery.

Dropped: nothing.

**Phase 1 gate, round 1: REFUSED** — four contradictions, all accepted:
1. J-07 encoded the blocked F-PT-003 expectation ("exactly one item") as truth → journey
   row now separates the documented completed path from the deliberately excluded crash
   seam; convergence lives only in F-PT-003.
2. J-02 called draft PRs "reversible" → reclassified: externally durable, closable — not
   reversible ("Closing a PR does not erase the external GitHub write").
3. C3 map protected approval decisions but not execution of approved irreversible effects
   → T-12 added: irreversible-effect execution boundary (exact-grant consumption,
   at-most/exactly-once with idempotency markers, terminal ambiguity, truthful
   acknowledgements). Compound worst case updated to include T-12.
4. harness-design-state.md was stale (still showed Phase 0 pending; omitted F-PT-003/004)
   → rewritten to reflect actual campaign state.

**Phase 1 gate, round 2: REFUSED** — three corrections, all accepted:
5. §2.2 apps.yaml rows made consistent: human ratification = authority; bootstrap
   (register), promote (status flip after verification), reset --execute (entry removal)
   = component writers under that authority; agents never.
6. Recovery multiplier reassigned: crash-repeat of an external effect → T-12;
   double-settlement → T-5; T-2 only when the decision/grant itself was compromised.
7. State-file wording: F-PT-003 "not encoded as ratified truth or a contract" (the
   finding itself is of course recorded in the artifacts).

**Phase 1 gate, round 3: REFUSED** — the ownership repair exposed one remaining
structural ambiguity, and the checkpoint trailed the gate. Round-4 corrections (map/tier
content otherwise untouched):
8. §2.2 retitled "State owner · authorized write paths"; explicit rule added: authority
   is never a writer.
9. Registry row completed: `new-app` uses the same registration path as bootstrap;
   `app verify` writes the crash-resumable lifecycle record (new dedicated row), never
   the registry; promote/reset write paths named per artifact; broad org/app-config row
   split per artifact.
10. Checkpoint advanced with the round-2 refusal recorded in phase status.

**Phase 1 gate, round 4 (current)** — presented with map/tier content unchanged since
the post-round-3 corrections; initially held solely because the audit trail was one round
behind (checkpoint said round 3; log labeled the round-3 refusal as mere "corrections").
Repaired per instruction: round 3 relabeled REFUSED above, checkpoint now presents round
4 as the current gate. Map and tier content untouched.

## Phase 2 — invariants (beat 3: the "every" ramble)

Opener used: "What has to be true after every operation — including the ones that fail
halfway through?" Stakeholder ramble, near-verbatim highlights:

> The word "every" is where the comfortable stories start falling apart.
>
> [Authority] authority cannot grow by accident. App configuration can narrow org
> authority, never widen it. Memory, prompts, plans, model output, cached context, a
> GitHub label, and a previous approval cannot manufacture permission. If two authority
> sources disagree, the more restrictive valid source wins or the turn stops... That is
> not "usually human-reviewed"; it must be structurally unavailable. → INV-001
>
> [Gate] no route around the gate counts as an implementation detail. Shell nesting, an
> adapter's native tool format, encoded commands, a new provider tool, a direct GitHub
> call... Otherwise we have three providers with three different constitutions, which is
> nonsense. → INV-002
>
> [Approval] An approved item is not an executed operation. A grant binds one exact
> actor, app, command or payload, and relevant content version... Never "probably didn't
> happen, so try again." If the external effect happened and the acknowledgement failed,
> the ambiguity belongs to us; we do not make the outside world pay for our missing
> write. → INV-003
>
> [App identity] Every turn belongs to exactly one app. Not "mostly uses one app."... A
> mismatch is a stop, not an opportunity to infer which field was intended... a perfectly
> good result is still a broken result because it happened in the wrong product. → INV-004
>
> [Claims] one ticket cannot be actively claimed by two turns... a pause for approval
> cannot masquerade as a fresh claim... otherwise our accounting and recovery story forks
> in two while the UI smiles at me. → INV-005
>
> [Money] Every provider turn has exactly one settlement obligation... Mechanical work is
> not a provider turn. Unknown usage is not zero. No reader may turn missing or
> unavailable usage into apparent headroom. The ledger is the durable spend fact; an
> overlay or report may derive from it but may not quietly replace it. → INV-006
>
> [Pause] A budget pause must participate in admission, not just presentation... there
> must be one authoritative admission answer. I do not want each caller reimplementing
> "effective pause"... Do not smuggle the unresolved crash seam into that invariant.
> That remains F-PT-003, not truth merely because "exactly one" sounds tidy. → INV-007
>
> [Evidence] Evidence must never outrun reality... If sources disagree or are
> unavailable, the observable state must be unknown, degraded, ambiguous, or
> needs-attention — never green by absence. [Ticket-state trap] I do not want an
> invariant claiming there is one magic ticket-status field. There isn't... What must
> always hold is that reconciliation does not erase contradictions or compress them into
> a more advanced state than the evidence supports. → INV-008
>
> [Merge] No merge may escape the reviewed boundary. The exact reviewed commit must be an
> ancestor of the exact candidate being merged, checks must be fresh for that candidate,
> the remote default branch must be resolved rather than guessed, and only the
> orchestrator may perform the merge. → INV-009
>
> [Destruction] No operation may destroy state outside its explicitly named scope...
> Archive creation must precede destructive local mutation. A --force flag does not mean
> "ignore identity and scope". I am deliberately not saying "all uncommitted bytes are
> preserved." We do not have that product truth. → INV-010, F-PT-004 upheld
>
> [Secrets] "Secrets are never written" would be false because L3 evidence is
> intentionally verbatim. The durable property is confinement... Everything governed by
> the shared secret-pattern policy must use that one policy rather than inventing a
> weaker local scrubber. → INV-011
>
> [Model claims] Model output is never self-authenticating... Where machinery can decide
> the claim, deterministic evidence must decide it... [Learning] Candidate, published,
> authorized, active, and validated are different states, and none may silently imply the
> next... An agent's own report of improvement cannot be the evidence that promotes its
> lesson. That is an attractive little perpetual-motion machine for self-confidence.
> → INV-012
>
> [Writes] Every durable mutation should leave either the old valid state, the new valid
> state, or a journaled intermediate state with an unambiguous recovery rule. Torn,
> half-written state must never be treated as a legitimate terminal state. → INV-013
>
> [Vanishing] no work should vanish. A considered dispatch candidate must end with a
> durable reason... An event cannot disappear without the per-subscriber consumption
> evidence that justified retirement... Different mechanisms, same ugly product failure:
> the machine forgets the thing the human still needs to know. → INV-014
>
> [Event cutoff question] when the subscriber set changes while an older event is
> pending, what moment defines "current subscriber"?... I cannot name the ratified
> cutoff. I don't know — record it as a product-truth finding if the docs do not define
> it. Do not choose the cleaner test fixture and accidentally make policy. → F-PT-005
> (docs partially answer: removal case explicit, addition case mechanism-derived)
>
> [Fail-closed] uncertainty may reduce what Cormidia can do, but it must never increase
> what Cormidia is permitted to do or what it claims has happened. That one is probably
> doing more work in my head than half the detailed rules above. → INV-015 (apex)

Dropped/pushed down: "one ticket-status field" (owner-rejected), "secrets never written"
(owner-rejected, F-PT-001), "all bytes preserved" (F-PT-004), contract-shaped near-misses
listed in invariants.md → Phase 4.

**Phase 2 confirmation, round 1: REFUSED** — four invariant corrections + one finding
resolution, all accepted:
1. INV-003: restored the ratified two-branch grant model — (a) default fresh/exact/
   single-use (never-scopeable actions only ever this shape); (b) A1 human-widened
   scoped grants (app/ticket + rule/path, TTL, use cap, revocation, per-use audit).
2. INV-009: freshness corrected — review commit_id EQUALS candidate HEAD at merge time;
   ancestry alone would admit an unreviewed later push.
3. INV-010: falsifying test scoped to destructive mutation outside the authorized
   destructive set (archive + audit/journal writes are legitimate).
4. INV-013: logical-state property (readers expose old/new/recognized-intermediate; torn
   bytes rejected/quarantined), enforcement normalized to Both.
5. F-PT-005 RESOLVED by owner ratification: "added subscribers inherit still-pending
   events; removed subscribers cease blocking retirement" — derivation retained as
   provenance, flagged for later human ratification.

**Phase 2 confirmation, round 2: REFUSED (INV-003 only)** — the scoped-grant branch still
contradicted the title/falsifying shape/replay seed. Corrected: title now "grants stay
inside their ratified shape"; exact-content/consume-once/replay assertions restricted to
`once` grants; scoped grants falsified by out-of-scope use, post-expiry/revocation use,
use beyond cap, or missing per-use audit; statement says neither shape becomes unbounded
or agent-widenable permission (scoped grants intentionally multi-use within bounds).

**Phase 2 confirmation, round 3: CONFIRMED (2026-07-31)** — invariants.md
CORMIDIA-INV-001…015 ratified as the Phase 2 baseline.
*(Entry restored at audit iteration 1, AUD-107: the confirmation occurred in-campaign —
mirrored in harness-design-state — but this log had no entry for the confirming round.)*

## Phase 3 — boundaries (correction round on rev-1 draft)

Five structural objections, all accepted:
1. Human checkout is a boundary (B-14), not "outside Cormidia's write domain" — bootstrap
   writes .cormidia/** + marked blocks there; loop/recovery use managed clones. Failure
   modes: dirty files, symlinks, wrong remote, path overlap, concurrent human edits,
   lifecycle commands exceeding authorized generated paths.
2. Local storage and git substrates were missing → B-15 (FS full/read-only/permissions/
   symlink/torn; git index.lock, corrupt refs, missing worktree metadata, changed remote,
   hooks, version skew, partial success). Not buried under process death.
3. App-defined command execution is not the pass executor's failure domain → B-16
   gate/command-runner ↔ app toolchain (hang, fork, flood, worktree mutation, missing
   tools, exit-0-with-misleading-evidence). Executor↔gate-engine↔verdict stay together.
4. B-09 split: B-09a turn↔store continuation vs B-09b human/CLI↔store decision entry —
   "A valid decision can exist while resume is broken; the human can be absent while the
   paused turn remains perfectly preserved." + decision-store reconciliation mode.
5. B-12 split: local-reader seam explicit; GitHub dependency reuses B-01; "the observer
   must report source health independently rather than degrading the whole projection
   into one vague status."
Plus: B-10a active-org identity resolution sub-boundary ("correct config from the wrong
org is not a parser failure; it is an identity-boundary failure"); B-05 qualified
(launchd proof ≠ systemd; unique test definition, loaded identity, attributable tick
evidence, remove exactly that definition; sandbox org ≠ disposable host mutation).

Unattended-L3 restated (adopted verbatim into B-09b): at L2 script approvals/denials/
widening/expiry/revocation; at L3 use the explicit sandbox-only test-policy profile so
the allowed path requires zero human decisions. "Do not forge human decisions under a
robot identity." Evidence proves profile identity, sandbox target, permitted auto-grant
categories, zero human decision rows; publication/non-sandbox effects stay blocked.
Canonical definition in policy; B-09b carries cross-reference + prohibition.

Seam-by-seam operational contributions (near-verbatim highlights):
> B-01: "every API call can succeed while the operation is about the wrong base"; add
> "remote effect occurred but the client lost the response" as first-class — execution
> ambiguity + dangerous retry pressure; the fake must script it.
> B-02: "I do not have a specific Anthropic incident in my rambling, so do not invent
> one." Dangerous shapes: partial stream, absent usage, tool intent without terminal
> event, resume that authenticates but does not restore the exact session.
> B-03: auth loss is not permission to restart and discard three hours of evidence;
> checkpoint + session identity preserved; resume exactly or terminate honestly; add
> refresh-succeeds-but-session-unusable and protocol-valid-but-stale-capabilities.
> B-04: no lived pi failure — keep provenance honest; conformance must prove a forbidden
> attempt reaches and is denied by the gate; pi-Anthropic shares upstream outage with
> B-02 though the adapter fails independently.
> B-05: "works manually" with different launchd identity/env/PATH/cwd; "a definition
> file sitting on disk is the comforting fake version of health."
> B-06: wall-clock rollback, NTP jump, DST, timezone change, UTC-month rollover vs host
> time; sleep is compound adversity across B-05/06/07.
> B-07: "the child may have done expensive or external work, and we cannot prove how
> far it got"; PID reuse; signal racing terminal write; orphaned descendants; dead child
> with fresh heartbeat.
> B-08: two asymmetric nightmares — decision-no-child vs child-no-bookkeeping (worse:
> duplicate temptation); named durable outcomes each, no generic "spawn failed."
> B-09: "the seam that stalls validation asking me to approve its own budget" —
> production correct, validation unusable; + grant-written-but-item-move-interrupted.
> B-10: valid-looking config resolved for the wrong org/state home; stale pointer;
> override disagreement; symlinked org home; skew during upgrade; config changing
> between preview and execution; missing authority narrows or stops, never upgrades.
> B-11: paired-gate scar is Phase 5 eval-design material — "do not stuff it into
> B-11's fake"; boundary lesson: authorized/published/active/validated stay separate
> even when evaluation is unavailable or inconclusive.
> B-12: "PR #182 is the emotional center"; GitHub-unavailable as empty queue, missing
> usage as zero, stale envelope as current; "'Degraded' without naming which source and
> which claims are affected is just another plausible green."
> B-13: first-reader-wins fan-out; producer crash mid-creation; duplicate identity with
> different payloads; file changing after validation; producer visibility protocol
> unknown → F-PT-006 ("I don't know — record it as a product-truth finding").

Honest-fake thesis confirmed: GitHub/providers need narrow real conformance; host firing
needs an actual host proof; new boundaries (FS/git, toolchain, workspace, org identity)
are L2-dominated with real temp repos/processes + injected failures.

**Phase 3 rev-2 gate: REFUSED** — four issues, all accepted:
1. B-17 added: typed critical-effect executor ↔ non-GitHub external target (J-05/J-11/
   J-17, T-12; lost responses, async acceptance vs completion, idempotency-marker
   disagreement, auth changes, acknowledgement failure; GitHub-backed effects reuse
   B-01; no disposable real target exists → L3 cell explicitly EMPTY/BLOCKED in policy,
   never silently absent).
2. Layer placements untangled: B-02 drops L4 from boundary placement (quality = Phase 5
   call sites); B-03 split — injected rotation L2 / ordinary real auth-session L3 /
   natural multi-hour rotation L5; B-07 layer row now names its L5 sleep/wake obligation.
3. B-09b ownership precision: human = actor + authority supplying decision intent;
   CLI/approval store = state writer validating and persisting the durable decision.
4. B-13 provenance corrected: first-reader-wins is a representative *feared* failure
   ([elicited] judgment), not a documented incident.

**Phase 3 rev-3 gate: REFUSED (B-17 only)** — the L3 cell claimed a nonexistent policy
entry and conflated empty with blocked. Corrected: status is **BLOCKED** (obligation
exists, cannot currently run); the future policy file must record reason + unblock
condition (sandbox app with a real disposable release: target); no green L3 claim
follows; the shared fake/real conformance suite activates when a target exists. No
policy file created early; no other boundary content changed.

**Phase 3 rev-4 gate: CONFIRMED** (after header/audit-trail alignment).

## Phase 4 — contracts (beats 1–2 taught; propose-then-correct draft presented)

Draft set: contracts/provider-adapter-core.md (shared adapter promise; B-02/03/04 carry
deltas only), B-01…B-17 one file per boundary, journey-acceptance.md (J-01…J-18
given/when/then, each traced to INV/contract). Numbers: [doc]-cited where ratified
(5-min tick, WIP 2, 24h TTL, 10-min stale threshold, 3 cycles, retention windows);
provisional values marked PROPOSED with owner+expiry (budget-check latency, retry
budgets, heartbeat cadence, pid+start-time identity, process groups, index.lock wait,
hooks-disabled clones, git version floor, gate timeout 15min, output cap 1MiB, worktree
fingerprint around gates, preview→execute hash comparison). OPEN reserved for
F-PT-003/004/006 semantics only. Awaiting stakeholder corrections (beat 3: "what does
the caller assume that the other side never promised?").

**Phase 4 draft gate: REFUSED** — twelve objections, all accepted; corrections applied:
1. Cadence ≠ guarantee: B-01 (polling attempted on successful ticks, no staleness max,
   poll age/failure always exposed), B-05 (configured cadence), B-12 (observed poll
   age), B-13 (eligibility on successful ticks for live apps; no discovery latency).
2. Adapter budget observation: struck invented uniform point; contract = finest
   truthful observation point per capability matrix (Claude running guard; Codex per
   usage update; pi turn boundaries + final check); stop on crossing; overshoot
   retained+settled; cap never claimed as mathematically hard.
3. B-03 read bypass: hook bridge is the compensating boundary; forbidden read escaping
   = INV-002/011 violation, not degradation; L3 adds forbidden-read denial.
4. Time identities: missed-window key (app, role, trigger, window); heartbeat 30s
   [doc, ratified]; lock fresh <2min; 10-min only for --force. Clock-anomaly response
   owner-ratified: uncertainty fails closed, recorded durably; a clock jump never
   manufactures permission.
5. B-09a: orphan-grant intermediate is real (documented write order); contract =
   recognizable, never usable authorization, reconciliation completes/repairs.
6. B-11: forward-completes or no-ops keyed by approval ID; rollback not promised.
7. B-12: read-only observer rejects + reports source invalid + renders unknown; no
   quarantine (owning store's recovery path).
8. B-14: dirty checkout OK for ordinary bootstrap; staged/merge/detached refusals are
   bootstrap publish --execute; exact-rollback is org-init-only → F-PT-007 opened
   (concurrent human edit of bootstrap-owned path between validation and write;
   owner leaning compare-and-refuse [simulated], unencoded).
9. B-15: git version floor struck (capability check + observed version); identity and
   descendant-tree semantics phrased semantically, mechanisms stay PROPOSED;
   index.lock 30s and hooks-disabled kept.
10. B-16: ratified output bounds (256KiB/50 lines local; 8,000 chars PR; 2,000-char
    envelope tail) replace invented 1MiB; timeout = per-gate explicit bound surfaced in
    evidence, 15min PROPOSED default only; mutation detection scoped to candidate HEAD
    + tracked/decision-relevant diff + governed generated paths (ignored residue ≠
    corruption).
11. B-17: markers typed by what they prove (acceptance ≠ completion); exactly-once only
    with completion evidence; "grant intact-in-audit" reworded (immutable evidence in
    audit; consumed grant not reusable).
12. journey-acceptance: J-01/J-03/J-04 traces to new operation contracts C-OP-LIFE /
    C-OP-PLAN / C-OP-LOOP (created — contract-coverage hole closed); J-04 off-by-one
    fixed (fourth cycle returns); J-10 eligible-subscriber wording; J-17 at-most-once;
    J-18 admitted-unblocked wording + named-blocker alternative; [policy] labeled
    future obligation.
Audit nit accepted: PROPOSED count was 13, not 12 (clock anomaly was the extra; now
owner-ratified). PROPOSED register added to harness-design-state.md.

**Phase 4 round-2 gate: REFUSED** — five contradictions + one traceability violation,
all accepted:
1. Canonical IDs added: every contract file header now carries an CORMIDIA-C-…-001 ID
   (aliases retained); journey-acceptance gains an alias→canonical resolution table.
2. B-09a grant-expiry "item re-decidable" parked → **F-PT-008** (expiry transition —
   fresh item vs reopen vs explicit operation — unratified; decisions immutable).
3. C-OP-LIFE: verify = only lifecycle *domain-state* write with the universal
   invocation-audit exception explicit; refusal split — precondition/identity failures
   refuse pre-mutation, mid-execution failures leave journaled recoverable
   intermediates.
4. B-06 §5 and B-08 §5 now say **configured** cadence.
5. J-10 rewritten without cardinality assumption (each subscriber that becomes eligible
   while pending runs at most once; ineligible current subscriber keeps retirement
   open).
6. J-18 split: considered → named non-admission reason or admitted; admitted → evidence
   at every reached link, terminating in verified result or typed non-green outcome;
   merge/external effects only on their own preconditions.

**Phase 4 round-3 gate: REFUSED** — three items, all accepted:
1. Trace table: range/slash notation (CORMIDIA-C-B01…B08-001) expanded into explicit
   per-alias rows; journey aliases (J-04/05/07/08) classified as intra-document
   references that never satisfy traceability alone; T-NN marked not-a-contract-ID.
2. J-10: "at most once" → each eligible current subscriber eventually runs exactly once
   (one turn per eligible subscriber), never silently skipped, subject to named
   per-tick blockers, no latency promise; ineligible current subscriber stays pending.
3. B-09a §5: "nothing degrades with wait length" struck → no product deadline on human
   latency, but continuation revalidates grant TTL, exact session availability, auth,
   and every fingerprint before spend; revalidation failure is typed and preserves
   evidence, never a silent restart.

## Phase 5 — LLM call sites (beat 3 + map corrections)

Map corrections (accepted): family map ≠ call-site inventory — sub-sites exploded
(S-2a/b/c contract/implement/fix; S-3a/b review/ship-check; S-4a/b scheduled/incident;
S-5a/b/c Support / Marketing content / Marketing analysis); S-8 brief assembly struck
as a call site → conditioning surface, deterministic broken-line, correlated quality
study; archived grader prohibited as grounding — cite live docs/qualification/design.md
contract only; any new judge in the replacement becomes a call site with its own
calibration obligation.

Ramble highlights (near-verbatim):
> [First set] the Reviewer. That is where plausible green becomes merged reality...
> PR #182 is still the emotional center... a trustworthy-looking result attached to the
> wrong reality.
> [Reviewer lines] Broken is accepting the wrong HEAD, accepting without the required
> marker, emitting an unusable verdict, or causing an effect from prose... a reviewer
> that rejects everything is not "safe"; it is the 42-decisions-in-an-afternoon
> incident wearing a lab coat.
> [Thresholds] I don't know the exact catch-rate threshold or N — record that as a
> product-truth finding/open owner decision. → F-PT-009. Instincts: near-perfect on
> serious seeded defects (nothing like 1-in-10 miss); clean FP ~1-in-10 already feels
> expensive; never pool provider pairs — qualification attaches to the complete role
> assignment, not a provider logo.
> [Determinize] anything serious enough that we demand literal perfection should
> probably become a deterministic gate where possible. I'm not authorizing "the
> Reviewer usually notices secret leakage" as our security architecture.
> [Planner] mistakes amplify... Not great is the subtler misery: seven tiny tickets for
> a two-line change, one enormous ticket containing three systems... a plan whose
> process costs more than the work. Planner quality must include proportionality and
> expected total cost.
> [Builder] trajectory produces the right durable result without thrashing... Never
> grade "the model respected the budget" as a personality trait.
> [SRE] sharper consequence edge... [S-5] Support and Marketing must not share one
> quality score... edit distance only if "minor wording polish" is distinguished from
> "rewrote the factual claim".
> [Distiller] later set — output inert. [Learning Reviewer] eventually a serious judge
> set: good, poisoned, seductive-but-unsupported, duplicates, authority-widening...
> rejecting every lesson gives us a perfectly safe learning system that never learns.
> [S-9] contract-only. No quality rubric for whether the JSON repair was elegant.
> [Swap] candidate runs the existing committed set before anyone tunes prompts around
> its failures... per call site and assignment tuple... "Better average" must never
> conceal regression at the merge boundary.
> [Qualification replacement owes] identity; deterministic contracts green first;
> seeded + clean with missing runs counted incomplete; severity+pairing reporting;
> judge calibration first; comparative not absolute; negative controls; bounded cost +
> human packet on disagreements; pass|fail|inconclusive — no coin flips.
> [Economics] full runs on prompt/model change + release; nightly rotates shards;
> declared token ceiling; preserve partial evidence; "something I trust and can
> afford."

Synthesis → llm-eval-plan.md + golden-sets/ scaffolds. F-PT-009 opened.

**Phase 5 gate, round 1: REFUSED** — three objections, all accepted:
1. Decision-status: an asserted threshold is a decision rule. Owner ruling adopted
   plan-wide (§9 added): until F-PT-009/F-PT-010 ratify, runs collect data and every
   threshold-dependent verdict is `inconclusive` — never pass/fail, never
   release-blocking, never green. F-PT-009 widened to include the sample design (case
   counts, severity+pairing aggregation, inconclusive rule); F-PT-010 opened for
   Planner/SRE thresholds + sample designs (round numbers came from neither owner nor
   docs).
2. Scaffold truthfulness: all ten scaffolds rewritten with actual rubric axes,
   threshold/sample status (OPEN where unknown), cadence, tuple dimensions, case
   schema + provenance requirements, and explicit SCAFFOLD/UNPOPULATED status;
   `brief-conditioning/` added as the tenth directory (conditioning study, not a model
   golden set, never gates).
3. Builder trajectory checks split by decision status: pass/fail only on ratified
   grounds (documented ledger/route limits as enforcement-fired detection; the five
   documented runlog anomaly detectors as detector-fired; typed escalation; paid-work
   preservation); repeat-loop N=3 stays registered-provisional; tool-call counts and
   environment churn demoted to observed metrics with no pass/fail.

**Phase 5 gate, round 2: REFUSED** — three consistency gaps, all accepted:
1. S-2's L4 surface had no scaffold (trajectory suite correctly deterministic but
   standing in) → `builder-quality/` added as a separate statistical scaffold
   (F-PT-011); plan §2 states the trajectory suite never masquerades as model-swap
   quality evidence.
2. Five later sets had unowned OPEN decisions → F-PT-011 opened as umbrella
   (Builder quality, Support, Marketing×2, Distiller, Learning Reviewer thresholds +
   sample designs; site-specific decisions; Learning Reviewer flagged especially
   consequential — scores inadmissible until calibrated + ratified).
3. Root scaffold contract overclaimed uniform completeness → root now exempts
   deterministic/study scaffolds (fields N/A); brief-conditioning gained cadence,
   tuple dimensions, threshold N/A + OPEN sampling status; builder-trajectory marked
   N/A rubric/threshold with pointer to builder-quality/.

**Phase 5 gate, round 3: REFUSED (ownership consistency only)** — corrected in the
canonical plan: F-PT-011's §8 definition now includes brief-conditioning's non-gating
sampling design; §2's S-5, S-6, and S-7 entries explicitly resolve threshold/sample
status to F-PT-011 and name their cadence with scaffold cross-references.

**Phase 5 gate, round 4: CONFIRMED (2026-07-31)** — llm-eval-plan.md §§0–9 + 11
golden-set scaffolds ratified as the Phase 5 baseline.
*(Entry restored at audit iteration 1, AUD-107: same defect and repair as Phase 2's
round-3 entry.)*

## Phase 6 — risk tiers & allocation (beat 3, human-first)

Ramble highlights (near-verbatim):
> Where do I expect it to break? At the joins, obviously... a provider dies after doing
> useful work, GitHub accepts something but our response disappears, the laptop sleeps
> through several windows, or two individually reasonable state files disagree.
> [Adapters] highest-probability churn... do not turn absence of a story into evidence
> that those adapters are safer.
> [GitHub] works for months and then produces one extremely convincing lie... a
> polished green attached to the wrong commit is corrosive.
> [Recovery] not exotic failure injection scenarios. They are Tuesday... whether we
> preserve what it bought, settle what it spent, and resume without performing or
> charging twice.
> [Gate/approvals] consequence dominates probability... "This code hardly changes" is
> not an exemption.
> [Three exhaustive families] (1) the entire permission-to-effect chain incl.
> destructive lifecycle + secret-bearing routes; (2) turn durability and money together
> ("splitting money from recovery would be dishonest"); (3) merge and evidence truth
> ("False green is the amplifier").
> [Floors] secret containment and agents-cannot-rewrite-authority remain exhaustive
> deterministic floors "because they are invariants, not discretionary coverage."
> [Thin] presentation smoke-only; observer confidentiality/source-truth NOT thin ("the
> pixels around them are"); S-5/S-6 deferred; systemd nothing until droplet; B-17
> blocked; event inbox serious at L2, no per-release live; lifecycle = temp-FS/git
> fault injection, never my actual checkout.
> [L3 spend, owner call] pre-merge adapter campaign: changed adapter only, ≤2 provider
> turns, ≤$5. Full release: all adapters + GitHub + unattended profile, ≤6 turns,
> ≤$15. "Ceiling exhaustion means incomplete, not green. I am not authorizing a $40
> deep route every time someone adjusts a prompt."
> [Triggers] adapter real pre-merge only when adapter/gate-hook/session/usage/auth code
> changes; full pre-release/qualification; GitHub smoke same rule; launchd real at
> install/upgrade + pre-release on definition/identity/loading change + material
> host/macOS change ("launchctl return zero proves very little").
> [Soak, owner call] 7 calendar days ordinary laptop use, ≥3 real sleep/wake cycles
> (one overnight), sandbox only, mostly token-free, $15 total ceiling; inspect
> missed-window reconciliation, duplicate admission, WIP/lock, settlement under
> retry/partials, state growth, retention sweeps, source-by-source health, "whether
> sleep manufactures permission or green evidence." Not 72h awake — "that validates a
> deployment shape I do not have." Retention windows proven with seeded aged state +
> controlled time; soak repeat only on material scheduler/locking/settlement/
> retention/shape change.
> [Evals] Reviewer and Planner get the first statistical spend... "We ran the model
> three times is still not coverage; it is three anecdotes wearing a badge."

Synthesis → risk-allocation.md (E-1/E-2/E-3, floors, standard, thin, L3 spend table,
soak, threat-model obligation [PROPOSED scheduling], contention point).

**Phase 6 hard stop, round 1: REFUSED** — three corrections, all accepted (owner
rulings, [simulated] seat):
1. Threat model: NO as written → timing = before the earliest of (release gating
   reactivation, droplet migration, first non-sandbox onboarding); scope = trust
   boundaries behind ALL C3 control points (ten enumerated surfaces incl. prompt
   injection/evidence forgery, confused-deputy, resource exhaustion); review on
   material trust-boundary/shape/adapter/surface change.
2. Contention: NO as written → per-(app,role) locks (directory ≠ one mutex); ≥10
   simultaneously due candidates across ≥3 apps incl. duplicate stimuli for one
   (app,role); simultaneous terminal settlement; six proof obligations.
3. Completeness/verdict split: completeness ∈ {complete,incomplete}; verdict ∈
   {pass,fail,inconclusive}; proven violation stays `fail` despite missing runs;
   otherwise incomplete → inconclusive; incomplete never yields pass and is not a
   fourth verdict.

**Phase 6 hard stop, round 2: REFUSED** — allocation closure + stale status, corrected:
1. INV-015 added as a non-discretionary cross-family deterministic floor ("it governs
   every failure branch"; cannot be risk-pruned).
2. T-10 (learning activation) moved into E-1 as a full member — no longer
   "E-1-adjacent" under standard depth.
3. T-11 (adapter enforcement) marked cross-cutting E-1/E-2, exhaustive at L1/L2, real
   remainder governed by §5; §3 reworded so "standard" hides no C3 obligation.
4. Checkpoint pending-confirmation line corrected: threat-model scheduling and
   contention exercise are owner-ratified, not PROPOSED.
Explicit YES recorded: threat model, contention exercise, completeness/verdict split.

**Phase 6 weighting: CONFIRMED (round 3).** Catalog derivation executed agent-alone to
matrix closure (case-catalog.md): journeys 18×5, state machines 8×4, invariants 15×2,
boundaries 17×7, contracts 22+1, interfaces 6, LLM sites 9×4, ops 6 — every cell traced
or pruned by name (PRUNE-thin / PRUNE-dup / PRUNE-na / BLOCKED:<finding> / BLOCKED:
B-17-L3). Blocked cells: F-PT-003/004/006/007/008 + B-17 live target.

**Phase 7/catalog combined gate, round 1: REFUSED** — tooling SELECTED (owner call, with
qualifications); catalog closure defects corrected:
- Tooling selection recorded: vitest (L1/L2/L3 orchestration); fast-check (bounded,
  deterministically seeded, alongside named regression cases); owned in-process fakes +
  real temp git/worktrees/org+state homes; separate opt-in vitest live config; small
  hand-rolled eval runner over committed golden sets; STRIDE-style threat-model doc;
  bespoke contention rig **classified L5 even though hermetic**; ratified soak
  protocol; gitleaks in GitHub Actions (pinned version/config, fail-closed, generated
  temporary canary proving detection, NO broad fixture allowlists); GitHub Actions CI.
  5-min L1/L2 target stays PROPOSED — reported optimization target from first build;
  once ratified, timeout ⇒ incomplete, never green. (Vitest verified as ratified
  configuration, not as installed package in this workspace.)
- CF-OPS-CONT reclassified L5 (layer = question, not rig technology).
- CF-OPS-ROT added: Codex natural multi-hour rotation embedded in soak with its own
  completion evidence; no natural rotation ⇒ incomplete, never assumed covered.
- F-PT-004 blocks named in-cell (CF-J04-I, CF-B15-*) with the exact assertion stop.
- Closure arithmetic reconciled (90 semantic cells = 86 rows; 80 families + 10
  pruned/blocked; embedded blocks named); LLM matrix corrected to 8 sites × 4 = 32
  cells with explicit PRUNE-na rows for S-4/5/6/7 trajectory+judge; contract range
  expanded to 18 named boundary-contract families (B-09A/B-09B separate); undefined
  risk tags replaced (L4Q formally defined; validator families → STD per
  risk-allocation §3).

**Combined gate, round 2: REFUSED (catalog-only)** — three corrections applied:
1. Boundary closure: 17 numbered boundaries = 18 matrix entries (B-09a/b) × 7 = 126
   semantic cells; both facts stated.
2. Ops closure corrected: L5 = CONT/SOAK/ROT/ABUSE; GROW stays L2 (cheapest layer that
   falsifies retention boundaries); CF-OPS-GROW itself unchanged.
3. Contract matrix: combined row replaced by a per-ID resolver table (18 rows: exact
   layer set, declared-vocabulary risk, live/ops dup, blocked remainder — B-03
   rotation → CF-OPS-ROT; B-17 → BLOCKED:B-17-L3; B-09A/13/14/15 blocked clauses
   named). Header range corrected to S-1…S-7 and S-9.
Tooling record: unchanged, not re-litigated.

**Combined gate, round 3: REFUSED (resolver exactness)** — corrected: L3 obligations
given exact case IDs (CF-B01-L3 GitHub smoke; CF-B02-L3 / CF-B03-L3 / CF-B04-L3
per-adapter real conformance runs) and §4 rows split to carry them; resolver rows now
reference only numbered IDs (no "-style"/prose); CF-C-B06 → 2+5 dup CF-OPS-SOAK;
CF-C-B07 → 2+5 dup CF-OPS-SOAK; CF-C-B09B → 2+3 dup CF-J18-A.

**Combined gate, round 4 (current)** — catalog content confirmed closed by stakeholder
audit (§4 L3 families, §5 resolver rows, §9 arithmetic all verified); this round was
initially held solely because the audit trail still presented round 3. Repaired:
checkpoint pending-confirmation line now presents round 4 as the current gate, and this
entry records round 4 explicitly. No change to case-catalog.md.

## Phase 8 — deliverables

Combined gate round 4 CONFIRMED (catalog + tooling). Phase 8 deliverables written:
validation-policy.yaml (draft-pending-human-ratification; layer lanes with BLOCKED
L3 cell, spend policy, verdict semantics, unattended profile, PROPOSED register, open
findings, case-sourcing + self-test obligations, rejected tooling with reasons);
harness-backlog.md (walking skeleton Wave 0 with negative controls + per-layer-gated
waves + parked HB-P1…P5); agents-md-contribution.md (proposal for the ratified
AGENTS.md — routing, tighten-only, decision-status rule, spend bounds, archive
prohibition). Reader test requested.

## Phase 8 — reader test (adversarial review) and revisions

Three fresh-context readers (operator, new engineer, coding agent) reviewed only
validation-design/. Findings and dispositions:

Operator: (1) no live-state oracle [by design, F-PT-002 — README now says so + points
to product commands]; (2) no incident runbook [owed at implementation — recorded in
ratification-package §6]; (3) blocked findings = no encoded behavior [by design —
README warns: escalate, don't infer]; (4) inconclusive misread risk [README warning +
product-surface reminder recorded as owed]; (5) release-gating-suspended + B-17
blocked not surfaced proactively [README warnings box]; (6) not self-contained vs
docs [by design, stated in README]; (7) no entry point [README.md created: reading
order]; (8) dangling ratification-package ref [file now exists; policy annotated];
(9) no ID glossary [README glossary table].

New engineer: (1) S-9 missing from backlog [HB-047 added]; (2) Wave L3 header vs
HB-054 [header qualified]; (3) Waves 1–4 layer convention implicit [convention note
added]; (4) §4 collapsing convention unstated [preamble added]; (5) no PROPOSED-
register build-time tripwire [HB-007 added].

Coding agent: (1) skill rules cited but not reproduced; harness-revision unavailable
[standing-rules digest added to agents-md, self-contained; escalate-to-human fallback
stated]; (2) risk-allocation/system-map/boundary-map unnamed in routing [named, with
T-tag source]; (3) golden-set targeting unmapped [pointer added]; (4) status
contradiction [activation clause: inert until ratification lands the section];
(5) no new-finding procedure [procedure added; policy open_findings = single source];
(6) genuinely-new structure uncovered [structural-additions rule: not autonomous;
harness-revision or escalate]; (7) HB-P IDs without filename [harness-backlog.md
named]; (8) detector-deposit triple-statement [policy case_sourcing designated single
source; others reference].

ratification-package.md written (decisions in the simulated seat, open findings as
human questions, provenance statistics, PROPOSED register, reader dispositions).

**FINAL GATE, round 1: REFUSED** — four closure defects, all corrected:
1. validation-policy.yaml rewritten as valid YAML (verified parsing with PyYAML;
   owner/trigger/cadence as separate keys; no colon-space plain-scalar failures).
2. Registries: artifacts block completed (readme, policy self-reference,
   agents_md_contribution); B-17-live → B-17-L3 (matches all other artifacts);
   F-PT-006/007/008 statuses corrected to open-blocked-contract.
3. Three stale future-policy references repointed to the existing draft policy with
   pending-ratification/no-green language retained (boundary-map B-17, contracts/B-17
   L3 status, journey-acceptance J-18), each with inline changelog.
4. Ratification package: contracts provenance corrected (rambling=1: B-03 scar;
   simulated=2: B-06 clock ruling, B-14 preference); table labeled as derivation
   artifacts with the omitted decision-bearing files enumerated; §3 item 13 split
   into three separately answerable decisions (13: F-PT-003, 14: F-PT-004,
   15: F-PT-007).

**FINAL GATE, round 2 (current)** — two audit defects corrected: (1) contracts
[rambling] attribution fixed — the sole occurrence is B-06-clock.md line 15
(missed-window clause, [doc][rambling]); B-03 cites the rotation scar in prose without
a tag; grep-verified. Correcting the same error in the round-1 log entry above by this
note. (2) Checkpoint advanced consistently: header no longer says "reader test
requested"; Phase 6 line rewritten as COMPLETE with owner-ratified threat-model/
contention status (no stale PROPOSED wording); pending-confirmation line identifies
FINAL GATE round 2 as current.

**FINAL GATE, round 2: CONFIRMED (2026-07-31) — CAMPAIGN CLOSED.** Stakeholder checked:
all 16 registered artifacts, 23 contract files, 11 golden-set scaffolds; parsed
validation-policy.yaml and verified its registry, B-17-L3, and blocked-finding statuses;
reader-test revisions; provenance counts and attribution; 15 separately answerable
simulated-seat decisions; checkpoint/log alignment. Confirmation scope stated
explicitly: the design campaign only — not real-human ratification, not harness
implementation, not release-gating reactivation. Policy remains draft; release gating
remains SUSPENDED; B-17-L3 and the five finding-dependent contracts remain blocked.
All further authority transfers to the real human via ratification-package.md.

## Audit iteration 1 (independent design-conformance audit, 2026-07-31)

Fresh read-only auditor measured the corpus against the validation-harness-audit
design-conformance rubric; nine findings AUD-101…109, none disputing a ratified
decision. Designer disposition: all nine **fixed** (no disputes, no deferrals):

- AUD-101 (blocking): the missed-window clause's rambling tag was FALSE — content
  traces to the Phase 1 walk, not rambling.txt. Retagged walk/elicited in
  contracts/B-06-clock.md and boundary-map B-06; ratification-package §2 corrected
  (contracts rambling 1→0, boundary-map 7→6) with the verification-standard lesson
  recorded: content check, not tag-location count. The final-gate round-2 record's
  "verified by grep" verified location/count only — that overstatement is superseded
  by this entry.
- AUD-102: B-12 rambling bracket narrowed to its real PR #182 anchor; elaboration
  retagged elicited.
- AUD-103: per-commit gate class declared blocking (required check, fail-closed) in
  policy `ci`; no advisory/waived gates exist.
- AUD-104: design-state PROPOSED-register header expiry split (items 1–8, 13 vs 9–12)
  to match policy; item 13 rejoined the numbered list.
- AUD-105: five stale "presented for confirmation" artifact headers advanced to
  CONFIRMED-at-gate + DRAFT-pending-human-ratification.
- AUD-106: catalog §9 blocked-cell roll-up completed with the five contract-matrix
  remainders (CF-C-B09A/B13/B14/B15/B17).
- AUD-107: this log's missing Phase 2 and Phase 5 confirming-round entries restored
  (marked as restorations, above).
- AUD-108: system-map §4 findings table scoped to Phase 1 with pointer to the
  policy's authoritative 11-finding list.
- AUD-109: README warnings-box sentence no longer asserts an active incident.

Dispositions presented to stakeholder for confirmation.

**Audit iteration 1, dispositions round 1: GATE-REFUSED** — seven of nine held; two
incomplete, both accepted:
1. AUD-101: my correction over-removed — B-03's auth-rotation clause IS genuine
   rambling provenance (rotation-race scar, rambling.txt) and had lost its tag; the
   package falsely told the ratifier the contracts contain no rambling content, and
   the table arithmetic was asserted, not recounted. Fixed: B-03 `[rambling: …]`
   restored with the scar cited; every column recounted from the corpus (contracts
   88/19/1/2/8 single-label occurrences); the compound `[doc][walk]` B-06 occurrence
   footnoted explicitly rather than double-counted, so the numbers are reproducible.
2. AUD-105: system-map §5 still said "Pending Phase 1 hard-stop confirmation" —
   internal status, missed by the header-only fix. Now confirmed-at-gate (round 4),
   with `[PROPOSED]` retained as origin provenance only.
Dispositions re-presented (round 2).

**Audit iteration 1, dispositions round 2: GATE-REFUSED (checkpoint-only)** — both
artifact repairs pass (B-03 matches the real rambling passage; 88/19/1/2/8 convention
reproducible; system-map §5 confirmed), but harness-design-state still contradicted
them in two places, both corrected: (1) Phase 8 line still opened "OPEN" while ending
"COMPLETE; campaign closed" — now opens COMPLETE; (2) the AUD-101 note still said
"contracts rambling=0" — now distinguishes the false B-06 tag (removed) from the
restored genuine B-03 tag (current contracts rambling total: 1). Dispositions
re-presented (round 3).

**Audit iteration 1, dispositions round 3: GATE-REFUSED (header-only)** — checkpoint
repairs pass; the design-state header still named round 2 while the
pending-confirmation section presented round 3. Header advanced to round 3. Per
stakeholder instruction, the historical "OPEN" / "rambling=0" quotations inside the
refusal-history entries are retained as quotations, not erased. Dispositions
re-presented (round 4).

**Audit iteration 1, dispositions round 4: CONFIRMED (2026-07-31).** Stakeholder
checked: design-state round-4 header, Phase 8 COMPLETE status, corrected AUD-101
provenance note, full refusal history, current pending-confirmation entry; this log's
round-3 refusal and round-4 presentation. AUD-101…109 closed — all fixed, no disputes,
no deferrals. Scope: dispositions only; design remains DRAFT pending real-human
ratification; release gating remains SUSPENDED; no harness implementation.

## Audit iteration 2 (independent verification pass, 2026-07-31)

Fresh auditor verified all nine iteration-1 dispositions at their fix sites,
independently reproduced every provenance count, re-checked content existence against
rambling.txt, and ran a regression sweep. **No new blocking findings.** Three
non-blocking residues noted; designer action:
1. system-map §0 criticality bullet still said "pending Phase 1 hard-stop
   confirmation" (same class as AUD-105, outside its named sites) — FIXED: now
   confirmed-at-gate (round 4).
2. Ratification-package changelog's loose "(audit round 2)" label — FIXED: now
   "(audit iteration 1, dispositions round 2)" in both occurrences.
3. Compound-tag counting convention differs between the contracts row (neither
   column, footnoted) and the system-map row (both columns) — ACCEPTED AS-IS: the
   footnote scopes itself to the contracts row, the auditor confirms every printed
   number reproduces as stated, and re-normalizing confirmed rows would churn ratified
   text for no information gain.
Presented to stakeholder for confirmation.

**Audit iteration 2: CONFIRMED (2026-07-31).** Both residue fixes and the
compound-tag convention accepted; no new numbered findings, no DISPOSITION lines
owed; AUD-101…109 remain closed. Stakeholder precision recorded: "pending Phase 1
hard-stop" strings surviving inside historical audit/log quotations are correct trace
preservation, not unresolved residue — the active stale clause is gone from
system-map. Scope unchanged: design DRAFT pending real-human ratification; release
gating SUSPENDED; no harness implementation authorized.

**Audit loop CLOSED, verdict "clean" (2026-07-31).** Environment ledger: AUD-101…109
all disposition=fixed. ratification-package.md §7 "Audit record" written (verdict,
per-finding tier/disposition/rationale table, no unresolved disputes or deferrals,
scope unchanged); prior §7 renumbered §8.

## Harness revision — comparative execution (2026-08-01)

### Owner input (close to verbatim)

> Imagine a setting in episode planner that enables cormidia to run a permutation of
> harness+model+effort on the same episode and finally rank the quality of work using
> a mix of deterministic validation and llm as a judge. Sometimes it can be cormidia's
> own sampling.

After the first synthesis, the owner corrected two important assumptions:

> Besides deterministic checks, you also have things like docs update, validate, etc.
> I almost think the comparison is per agent turn, not entire episode.

> Even if someone is not using cormidia, can this feature work standalone given a repo
> and cormidia binary? It will help showcase the power of cormidia.

The owner then requested: "Please build the design doc and epic. Commit and merge."

### Synthesis and revision decisions

- Unit corrected from episode-wide tournament to one planned provider turn. One
  episode remains one outcome and route; only the compared step fans out.
- “Permutation” narrowed to bounded exact assignment tuples and optional independent
  sample indexes. No Cartesian expansion or silent tuple invention.
- Evidence made operation-specific: Builder includes gates/tests/typecheck,
  criterion→test mapping, documentation updates, scope/mutation checks, and qualitative
  maintainability/economy; Planner, Reviewer, SRE, Support, and Marketing have distinct
  grounded evidence and rubrics.
- Selection is lexicographic: deterministic/grounded eligibility first, then a blinded
  calibrated S-8 judge, then declared deterministic tie-breaks. A failed guardrail can
  never be offset by judge preference or price.
- S-8 is registered as a new call site and placed under the existing F-PT-011 umbrella.
  Its scores are advisory/inconclusive and inadmissible for automatic promotion until
  calibration data, thresholds, and sampling design are human-ratified.
- Standalone `cormidia compare` is a first-class adapter over the same coordinator, not a
  second engine. It requires only a binary, a safe local git repo, exact tuples,
  credentials, task/policy, budget, and confirmation; it needs no org, scheduler, or
  GitHub. It never mutates the active branch and only materializes an explicitly
  selected local branch.
- V1 is explicit and sequential. Planner activation, sticky Cormidia-owned sampling,
  governed cross-episode learning, and parallel candidate execution are later phases.
- Harness revision introduced M16/J-19/B-18/B-19/S-8 and associated contracts/cases.
  Existing invariants, risk vocabulary, control points, and tooling remain sufficient.
  No new L5 obligation exists until automatic sampling or parallelism changes the
  question being tested.

### Reader/adversarial pass

- **Operator:** preview/execution/selection/materialization are distinct; advisory judge
  output cannot masquerade as qualification; standalone's no-org/no-GitHub promise is
  explicit.
- **New engineer:** J-19 resolves to M16, B-18/B-19, both canonical contracts, S-8,
  case families, and HB-090…094; every new cell is named design-only rather than green.
- **Coding agent:** HB-090 is the walking skeleton; exact transport stays in the epic;
  current runtime behavior is not a design oracle; F-PT-011 blocks automatic judge
  selection but does not block envelope/corpus authoring or advisory data collection.

Revision gate outcome: **direction confirmed; implementation pending.** No existing
ratified requirement was loosened, no blocked finding was guessed, and no live/eval/
soak campaign was run.
## Harness revision — planning, validation, delivery units, and batching (2026-08-03)

Mode: `harness-revision`, fast. Scope: combined Planner → validation design →
EpisodePlanner → Builder → Reviewer lifecycle for issues #184/#233/#234/#240, preserving
unaffected IDs and the existing harness. Protected no-read path remains
`archive-do-not-read/**`. Human-ratified prompt/pipeline/role surfaces remain
proposal-only.

### Phase 0 confirmation

The owner explicitly confirmed the combined lifecycle scope and fast mode after asking
the agent to err toward doing more now to unblock autonomous Cormidia work.

### Phase 1 walk and confirmation

The owner endorsed four distinct identities:

- workstream — durable outcome, dependencies and priority;
- delivery unit — one reviewable PR containing one or more tickets;
- EpisodePlan — one executable workflow authority per delivery unit; and
- execution batch — compatible delivery units co-scheduled for Builder/Reviewer session
  and cache efficiency without replacing EpisodePlan authority.

The owner asked that the EpisodePlanner be explicit. Synthesis confirmed: Planner is the
organizational role; EpisodePlanner is a shared capability converting one admitted
EpisodeIntent to an EpisodePlan; roadmap-planning and delivery are domain adapters over
the shared core. The owner confirmed the reconciled map and unchanged base-C2/existing-
C3 tiering.

### Phase 2 invariant elicitation and confirmation

The owner confirmed the non-negotiable: cache/session optimization may reorder or
co-schedule delivery units but must never change membership, one-PR atomicity,
validation obligations, budget/evidence attribution, routing eligibility, or Reviewer
independence. This extends existing identity/evidence/accounting invariants and adds
INV-016 for continuous, independently closed validation lineage.

### Phase 3–5 grounding supplied by the owner

The owner described the desired human analogue: with a backlog of roughly 50–100 items,
sit down once, prioritize and form work groups/batches in one planning session—not one
cold LLM invocation per issue consuming 50k–100k uncached tokens. Rich defects produced
inside Builder/Reviewer flow should retain their already-paid context in detailed
tickets so later planning only fills missing decisions.

Synthesis:

1. Order is backlog snapshot → RoadmapPlan → bounded ready frontier → token-free batch
   admission → lazy per-delivery-unit EpisodePlan. Creating EpisodePlans for all backlog
   items before roadmap selection is rejected.
2. Complete structured creator scope/workflow templates normalize with zero provider
   turns. Detailed prose alone does not. Existing `op:ready` and `op:tier-*` labels do
   not bypass EpisodePlanner; a future `planning:preplanned` label may only project a
   persisted validated artifact ref+hash.
3. Roadmap replanning consumes a prior plan plus bounded delta; unchanged inputs use
   stable references/prefixes. Actual cache evidence is measured, not assumed.
4. Builder/Reviewer-discovered issues retain exact episode/PR/HEAD, reproduction,
   evidence and contract lineage, but Planner/human still owns priority, membership and
   readiness.
5. Product planning and delivery converge on one `orchestrateEpisode` façade while
   retaining separate catalogs, validators, prompts, handlers and terminal artifacts.

Derived additions: M17; J-20; B-20/B-21/B-22; C-OP-VALIDATION/C-OP-BATCH; S-10; Planner
large-backlog/delta/cache-lure cases; Validation Designer pre-tuning golden cases.

### Direct-work refinement and Phase 6 confirmation

The owner confirmed the Phase 6 allocation, then supplied three calibration scenarios:
(1) a ready-made fully planned ticket; (2) a small webpage bug discovered by Support in
Jira and deposited into backlog; and (3) a release-promotion task posting to five Reddit
destinations, LinkedIn and Twitter, then following the posts. The intended principle is
that simple or complete work should not traverse ceremonial multi-agent planning merely
because every outcome ultimately needs an EpisodePlan.

Synthesis distinguishes artifact from provider work and code from operations:

- Complete code work bypasses roadmap/EpisodePlanner **provider turns** through strict
  normalization, but retains deterministic RoadmapPlan membership, validation, one-PR
  delivery and independent review.
- A proven low-risk Support bug uses governed quick-fix roadmap/validation/workflow
  templates; it skips portfolio debate, not roadmap accounting or code review.
- A complete non-code operational task may bypass RoadmapPlan entirely as a direct
  execution unit, but never bypasses EpisodeIntent/EpisodePlan/effect policy. One
  Marketing/Reddit-agent turn can draft a coherent campaign without ten ceremonial
  agents. Seven external destinations remain seven exact payload approvals and seven
  acknowledgements; batching cannot widen authority. Unknown follow-up replies become
  future units when their content exists.

This generalizes execution batches to a union of roadmap-backed code-delivery units and
complete direct operational units. Existing B-13/B-17/T-12 own event/external-effect
seams; B-17 L3 remains blocked without a disposable target. No external posting is
authorized or performed by this design work.

### Phase 7 tooling confirmation

The proposed selection reused the ratified baseline stack: Vitest, fast-check, owned
in-process fakes plus real temporary git/filesystems, the existing opt-in live runner,
hand-rolled eval runner, contention rig, soak protocol, pinned gitleaks and GitHub
Actions. The revision adds deterministic 100+ issue/delta fixtures, roadmap/validation/
batch fixtures, scripted cache evidence and kill schedules; it adds no framework,
database, queue, cassette system, hosted evaluator or campaign type.

**Phase 7 gate: CONFIRMED (2026-08-03).** Owner response: “Confirmed. Thanks.” Scope:
tooling only; policy/catalog/backlog and Phase 8 reader review still owed at that point.

### Phase 8 deliverables and adversarial review

The policy now carries an `awaiting_phase8_acceptance` revision registry for
M17/J-20/INV-016/B-20…22/C-OP-BATCH/C-OP-VALIDATION/S-10. The catalog adds and closes
the design-only journey, state-machine, invariant, boundary, contract and LLM families;
the backlog sequences HB-100…111 from a provider-free vertical skeleton. Golden sets
remain pre-tuning and `human_validation=pending`.

Three fresh-context reader perspectives were applied:

- **Operator:** found ambiguity in “batch complete,” Jira/example capability, and label
  authority. Fixed by total per-unit disposition semantics, explicit future-adapter/no-
  live-post language, and ref+hash-only projection rules.
- **New engineer:** found lifecycle state names present only in case families, old
  policy/catalog counts, and unspecified storage paths. Fixed the first two in operation
  contracts/policy/catalog; accepted exact paths as a pinned HB-101 implementation
  decision because authority and identity semantics are already fixed.
- **Coding agent:** found the risk of isolated green components, the two EpisodePlanner
  entry-path asymmetry, and protected protocol surfaces being treated as ordinary code.
  Fixed with HB-100's vertical negative-control skeleton, HB-107 façade convergence,
  and proposal-only HB-111/AGENTS addendum.

One duplicate historical CF-B02-L3 catalog row was removed while recounting closure; no
contract or evidence claim changed. No new product-truth ambiguity was found, so no new
F-PT entry was opened.

**Phase 8 gate: ACCEPTED (2026-08-03).** The product owner selected and returned the
exact §10.1 acceptance statement: the revision is the binding implementation contract
and HB-100 may begin. The same statement retains separate approval for protocol-surface
changes, merges, publication/deployment and live/token-spending campaigns. The request
body was otherwise blank; the exact selected statement is the attributable acceptance
record. No implementation or evidence claim follows from acceptance alone.
