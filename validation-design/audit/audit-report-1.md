# Independent design-conformance audit — Cormidia replacement validation harness (campaign cormidia-2026-07-31)

Audited object: the design corpus under `./validation-design/` (16 registered artifacts, 23 contract files, 11 golden-set scaffolds), in the validation-harness-audit skill's design-conformance capacity. No harness exists; no code was run. Findings are ordered most-severe first.

---

AUD-101 (blocking) — validation-design/contracts/B-06-clock.md — the missed-window reconciliation clause carries a `[rambling]` provenance tag, but no such content exists in ./rambling.txt

Evidence. B-06-clock.md line 15:

> "Missed windows: one reconciled firing keyed by **(app, role, trigger, window)** with the missed-window count — never one firing per missed window `[doc][rambling]`."

The same false tag appears in `boundary-map.md` B-06: "missed-window reconciliation (one reconciled firing with the missed count, never a catch-up storm `[rambling]`)".

I searched ./rambling.txt for any missed-window, reconciliation, catch-up, or sleep-through-windows content (`catch-up|missed[- ]window|sleep|reconcil`, case-insensitive). The only hit is line 127, "scheduled turn while I sleep, and in the morning the evidence tells me…" — the "winning" vision paragraph. The nearest rambling content of any kind is "Multi-hour live runs WILL be interrupted — auth, rate limits, me closing a laptop… checkpoint and resume, not restart," which is about live *validation-run* checkpointing, not dispatch missed-window semantics. The actual source of this clause is the AI stakeholder's Phase 1 walk (elicitation-log.md: "If the laptop slept through ten windows, I want one reconciled firing with the missed-window count, not ten frantic catch-up runs") — and the corpus itself attributes it correctly elsewhere: system-map.md §1.2 tags the identical claim `[doc] [walk]`.

Why blocking. The provenance system's entire purpose is to tell the ratifying human which claims trace to their own notes (`[rambling]` = "real human input, unratified", ratification-package.md §2) versus AI-stakeholder judgment (`[elicited]`/`[walk]`). This tag upgrades AI-seat elicitation into human input. Worse, the error is institutionalized: ratification-package.md §2 tells the human "The contracts row's `[rambling]` occurrence is B-06's missed-window reconciliation clause (`[doc][rambling]`, B-06-clock.md line 15…)" with a changelog claiming "verified by grep." Grep verified the tag's *location and count* (I reproduced: contracts contain exactly one `[rambling]`), not that the cited content exists in rambling.txt — it does not. The final-gate record in harness-design-state.md ("verified provenance attribution") is overstated in the same way. The `[doc]` half of the tag appears sound (system-map carries it as `[doc]`); the defect is solely the `[rambling]` attribution, in three artifacts: contracts/B-06-clock.md, boundary-map.md (B-06), ratification-package.md (§2).

---

AUD-102 (significant) — validation-design/boundary-map.md — B-12's `[rambling]` citation attributes elicited elaboration to rambling.txt; only the PR #182 anchor exists there

Evidence. Boundary-map B-12 failure modes:

> "`[rambling: PR #182 as the emotional center — GitHub-unavailable rendered as empty queue, missing usage as zero]`"

rambling.txt does contain PR #182 ("the change claimed a green test suite and the suite was actually red in nine places") — the anchor is real. But "GitHub-unavailable rendered as empty queue, missing usage as zero" appears nowhere in rambling.txt; it is the AI stakeholder's Phase 1 consequence ramble ("healthy because it interpreted missing GitHub data as an empty queue, unavailable usage as zero" — elicitation-log.md) and the "emotional center" phrasing is likewise from the Phase 3/5 elicitation. Packing elicited elaboration inside a `[rambling: …]` bracket inflates its provenance in exactly the direction the label system exists to prevent. Not blocking because the cited incident genuinely exists in rambling.txt; the defect is the bracket's scope, not its anchor.

---

AUD-103 (significant) — validation-design/validation-policy.yaml — no gate in the policy carries a blocking/advisory/waived classification; the per-commit lane's merge-blocking status is undeclared

Evidence. The entire gate declaration is:

> `ci:` … `per_commit: [L1, L2, gitleaks]` … `rule: "trigger conditions live in CI config AND in this file - removing a gate in CI without a policy change is a policy violation"`

The skill's policy schema (harness-policy-conformance.md §2) requires "gate requirements (blocking/advisory/waived) with declared frequencies." Frequencies are declared throughout; blocking status never is — not in the `ci` block, not per lane, not in `harness_backlog.md` HB-001, whose acceptance criterion is only "an intentionally failing spec turns it red" (a red lane is not a required check). The one use of the word `blocking` (`release_gating.blocking`) is a sequencing constraint, not a gate class. As written, an implementer could wire the L1/L2/gitleaks lane as a non-required CI job and violate no sentence of the policy. The fail-closed rubric ("gates default blocking") needs this stated, not assumed. Mitigations exist — `verdict_semantics` forbids incomplete→pass, and the `ci.rule` forbids silent gate removal — but neither says a red per-commit lane blocks merge. Case-level: one declaration in the `ci:` block (e.g. `per_commit_blocking: true` / per-gate classes) closes it.

---

AUD-104 (minor) — validation-design/harness-design-state.md — PROPOSED-register header asserts a blanket expiry that contradicts the policy for items 9–12

Evidence. Header: "## PROPOSED register (provisional values/mechanisms; owner: human; **expiry: first harness build review**)" — followed by items 1–13. But validation-policy.yaml declares `expiry_items_9_to_12: "first eval-campaign design review"`, and ratification-package.md §5 agrees ("Items 1–8 and 13 come due at the first harness build review… Items 9–12 come due at the first eval-campaign design review"). The design-state header is the odd one out. A human working from design-state could believe the eval-threshold hypotheses (items 9–12) come due at HB-007, contradicting the eval plan's sequencing. (Secondary list-integrity nit in the same section: item "13." appears after two intervening prose paragraphs ("Owner-ratified this campaign…", "Struck by stakeholder…"), orphaning it from the numbered list it belongs to.)

---

AUD-105 (minor) — validation-design/invariants.md — phase-gate status headers across the derivation artifacts were never advanced after confirmation

Evidence. invariants.md: "Status: beat-4 synthesis **presented for Phase 2 confirmation**." Likewise system-map.md ("presented for Phase 1 gate confirmation"), boundary-map.md ("rev 4, presented for Phase 3 confirmation"), llm-eval-plan.md ("presented for Phase 5 confirmation"), risk-allocation.md ("presented at the Phase 6 HARD STOP"). harness-design-state.md records every one of these gates CONFIRMED on 2026-07-31 and the campaign CLOSED. The artifacts are simultaneously "awaiting confirmation" (their own headers) and "confirmed" (the state file). Draft-pending-human status is properly communicated elsewhere (README, policy `design_status`); the misleading part is specifically the never-updated in-campaign gate status, which a reader may misread as "this artifact never passed its gate."

---

AUD-106 (minor) — validation-design/case-catalog.md — §9's blocked-cell enumeration omits the five contract-matrix blocked cells it elsewhere declares

Evidence. §9: "**Blocked cells (all named at their cells, none silent):** F-PT-003 (CF-J07-I), F-PT-004 (in-cell blocks in CF-J04-I and CF-B15-\*), F-PT-006 (CF-J10-I, CF-SM-EVENT-\*, CF-B13-\*), F-PT-007 (CF-B14-\*), F-PT-008 (CF-J06-I, CF-B09a-\*), B-17-L3 (CF-J17-A, CF-B17-\*)." The §5 per-ID resolver additionally declares blocked remainders at CF-C-B09A (F-PT-008), CF-C-B13 (F-PT-006), CF-C-B14 (F-PT-007), CF-C-B15 (F-PT-004), and CF-C-B17 (B-17-L3) — none of which appear in the §9 roll-up that presents itself as the complete blocked-cell list. Matrix closure itself holds (the cells are named in place, so nothing is *silent*), but the summary register undercounts the blocked surface an implementer or ratifier would tally from §9 alone.

---

AUD-107 (minor) — validation-design/elicitation-log.md — the gate history omits the confirmation rounds for Phases 2 and 5 that harness-design-state asserts

Evidence. The log records Phase 2 through "confirmation, round 2: REFUSED (INV-003 only)" and Phase 5 through "round 3: REFUSED (ownership consistency only)" — then moves to the next phase with no entry for the confirming round. harness-design-state.md asserts "Phase 2 (invariants): **CONFIRMED** 2026-07-31 (round 3)" and "Phase 5 (LLM eval plan): **CONFIRMED** 2026-07-31 (round 4)". For Phases 1, 3, 6/7, and the final gate, the log does record the confirming round explicitly. A file that bills itself as the "near-verbatim record … and gate history" should not leave two confirmations evidenced only by the mirror file.

---

AUD-108 (minor) — validation-design/system-map.md — §4 "Open findings" table lists 4 of the 11 tracked findings without scoping itself

Evidence. §4 is titled "Open findings (product truth / architecture)" and lists only F-PT-001…004 — the findings that existed at Phase 1. The policy's `open_findings` block (self-declared "SINGLE SOURCE OF TRUTH for the finding list") carries 11, and README warns "Eleven product-truth findings are tracked." boundary-map.md handles the same situation correctly by scoping its list ("Findings raised at Phase 3"). The system-map table's unscoped title invites a reader at position 2 of the README reading order to conclude the finding set is four. A one-line scope note ("as of Phase 1; authoritative list: validation-policy.yaml") would close it.

---

AUD-109 (minor) — validation-design/README.md — warning sentence literally asserts an active incident

Evidence. Warnings box: "**B-17's live deploy/publication cell is BLOCKED** — a deploy/publication-shaped incident **is operating** in the least-verified part of the system." As written, this states an incident is currently in progress. The intended meaning (a deploy/publication-shaped incident, *should one occur*, would be operating in the least-verified part of the system) is recoverable from context, but this is the tired-operator-facing warnings box, where the literal reading — there is an active deploy incident — could genuinely misdirect. Flagged only because this specific sentence's job is operator orientation under stress.

---

## What I checked

**Artifacts read (complete):** `validation-design/` — README.md, scope-and-module-map.md, system-map.md, invariants.md, boundary-map.md, all 23 files under contracts/ (18 boundary contracts incl. B-09a/b split, provider-adapter-core, 3 OP contracts, journey-acceptance.md), risk-allocation.md, llm-eval-plan.md, all 12 READMEs under golden-sets/, case-catalog.md, validation-policy.yaml, harness-backlog.md, agents-md-contribution.md, elicitation-log.md, harness-design-state.md, ratification-package.md. Plus ./rambling.txt in full, and targeted greps into ./docs/ (PURPOSE.md v2.9 changelog; apps.yaml). Skill inputs: SKILL.md and references/harness-policy-conformance.md.

**Rubric points applied:**

- *Falsifiability of invariants* (invariants.md, validation-policy.yaml): all 15 non-retired invariants state a falsifying test shape and a Both (guardrail+test) enforcement class; adversarial seeds present per item; no goodwill-only invariant found. Policy registry lists all 15 IDs; floors (INV-001/011/015) match risk-allocation §2.
- *Traceability, both directions* (invariants ↔ boundary-map ↔ contracts ↔ case-catalog ↔ policy ↔ backlog): every boundary B-01…B-17 has a contract file with a canonical ID; journey-acceptance alias table resolves every alias used; catalog closure arithmetic independently recomputed and verified — journeys 90 cells/86 rows (80 families + 10 pruned/blocked), state machines 8×4, invariants 15, boundaries 18 entries×7=126, contracts 22 canonical IDs = 23 files, LLM 8×4=32, ops 7 rows→5 families+2 prunes; policy L3 obligations (CF-B01/02/03/04-L3, CF-J16-A, CF-J18-A, B-17-L3) all resolve to catalog cells; blocked cells cross-checked against findings (one summary omission → AUD-106).
- *Policy discipline* (validation-policy.yaml): all five lanes declared with status; the empty/deferred lanes (abuse) carry reasons; `modules: []` so tighten-only trivially holds; no waivers exist; the PROPOSED register carries owner + expiry per item (one expiry contradiction in the mirror → AUD-104); release-gating suspension is a declared absence with an interim rule; gate blocking classification found undeclared → AUD-103.
- *Layer placement* (case-catalog, boundary-map, risk-allocation): L3 appears only where honest-fake verdicts left a named unproven-real remainder; L4 only statistical; CF-OPS-GROW correctly demoted to L2; CF-OPS-CONT's L5-by-question classification and the clean-slate coexistence posture are gate-ratified decisions and were not relitigated. No expensive-layer case a cheaper layer could falsify was found. Expansion gates checked per-layer (Wave L3/L4/L5 headers; HB-054's cross-layer dependency is explicitly flagged, conformant).
- *Provenance integrity*: every `[rambling]` citation in the corpus checked against ./rambling.txt (PR #182, default-branch scar, coin-flip gate, rotation races, "83-contract apparatus", "trust AND afford", "ZERO human approval decisions", "next turn must not eat it", "not a bank", "safe, boring operation", "evidence over assertion" — all verified present; two failures → AUD-101, AUD-102). `[stated]` grep: 4 hits, all meta-declarations that it is unused — conformant. `[simulated]` items: all flagged for human ratification (F-PT-005, clock anomaly, spend/soak/threat-model/contention rulings traced into ratification-package §3) — none laundered into `[doc]`. Ratification-package §2 grep statistics independently reproduced: contracts `[doc]`=89 (occurrence count), `[rambling]`=1, `[simulated]`=2; boundary-map 7/0; system-map 3/2; invariants 4/4; risk-allocation 1/5; llm-eval-plan 4/0 — all match the table.
- *Internal consistency*: 16 artifacts in the policy registry counted; 15 §3 decisions / 9 open findings / 13 register items in the ratification package verified against design-state's closing line; open_findings list (11 entries, 5 blocking cases) consistent across policy, design-state, README; spend bounds ($5/$15, 2/6 turns) consistent across policy, risk-allocation §5, agents-md, catalog CF-J18-A; B-16 output bounds, TTL/heartbeat/lock/force numbers consistent across B-06/B-07/B-14/system-map; verdict semantics identical in policy, risk-allocation §7, eval-plan §9; docs anchors verified (PURPOSE v2.9: clean slate, `archive-do-not-read/`, `claude-tests/`, release gating suspended; apps.yaml sandbox-class apps exist). Stale headers and log/mirror gaps → AUD-105/107/108.

**Not audited, per ground rules:** ratified decisions (tier calibration, E-family allocation, tooling selection, thin lanes, L5 classifications), the recorded open findings themselves (F-PT-001…011 are the discipline working — no artifact was found asserting what a finding declares unknown; the BLOCKED parking is consistently honored everywhere I checked), and anything requiring execution or CI, which do not exist for this corpus.

**Overall:** one blocking provenance defect (AUD-101) that should be corrected before the human works the ratification package — it sits directly on the table that tells the ratifier which clauses are their own words. Everything else is a conformance gap or bookkeeping drift on an otherwise unusually disciplined corpus: closure arithmetic checks out, blocked work is consistently parked rather than encoded, and the fail-closed verdict semantics are applied uniformly.
