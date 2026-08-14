# Cormidia — consuming Validation Architect as an adapter

## Holding document for the third workstream

Status: **not yet designed.** This document parks the decisions already taken
and the questions that must be answered before Cormidia's integration is
designed. It is deliberately thin.

Date: 2026-08-13

Companion documents:
[core improvements](./validation-architect-core-improvements.md) — final ·
[package and API contract](./validation-architect-api-contract.md).

No implementation, ratified-surface edit, provider turn, or release-shaped
action was performed.

## 1. Scope

Cormidia operates a standing org that develops and runs its users'
applications. Those applications need validation designed for them, and
Cormidia should not reimplement a method that already exists — it should
install it.

This document covers only that: **Cormidia as one host of the
`validation-architect` package.** The package's own API, schemas, versioning,
packaging, and license are decided in the
[contract document](./validation-architect-api-contract.md) and are not
reopened here. If something in this document would change that contract, it
belongs there instead — a host requirement that only Cormidia can satisfy is a
sign the contract is wrong.

Work order: the contract lands first, then the library implements it, then this
integration is designed against that exact implemented API. Cormidia may use an
exact local package artifact while the integration is built; replacing it with
the registry package still waits for the separately approved publication.

## 2. What the contract already settles for Cormidia

Several things that looked like integration problems are answered by the
contract and need no Cormidia-specific design.

**Provider-turn ownership.** Cormidia must own atomic harness/model/effort
assignment, per-turn and per-app ceilings, critical-operation gates, run
envelopes, exactly-once settlement, and every required independence dimension.
The injected `TurnPort` gives it that boundary: the library requests one logical
seat instance with explicit provider/model/session separation, new-versus-resume
session semantics, and a stable idempotency key. Cormidia resolves the request to
one approved provider tuple, invokes its own Runtime, gates every tool action,
settles the key exactly once, and returns the actual provider, model, and native
session identities. Designer and Stakeholder are cross-provider; readers and
each Auditor iteration are fresh sessions, while the Auditor may use the
Designer's model. The library constructs no provider client and holds no
credential.

The published envelope contains either the exact C0–C2 turn sequence or the
finite C3/C4 state machine, plus its maximum turn count, permitted transitions,
terminal coverage, independence requirements, schemas, and method version.
Cormidia admits that envelope under its ordinary EpisodePlan and budget rules
before the first turn.

**Campaign persistence is explicit and remains Cormidia's.** The third injected
port, `CampaignStorePort`, stores compare-and-swap `design-run/v1` checkpoints in
the state home. The library records the next request before spend and the
accepted result afterward. A crash replays the same idempotency key and resumes
the exact persistent Designer or Stakeholder session; it never repeats a settled
turn. Fresh reader and Auditor requests remain fresh on recovery.

**Deterministic checks need no governance at all.** `check`, `plan`, `explain`,
and `ingest` spend nothing and reach nothing. They can run in ordinary CI and in
the build loop without an approval path.

**Cormidia installs only the core package.** The contract splits the published
software in two: an SDK-free core containing deterministic functions and the
provider-neutral campaign engine, and a standalone design package carrying the
provider adapters and SDKs. Because Cormidia injects its own repository, turn,
and checkpoint ports, it takes the core package alone and its dependency
footprint grows by nothing it does not already have.

**Publication stays Cormidia's.** `design` returns a bundle of unwritten files.
Cormidia lands it through its own crash-resumable planning and publication
transaction, resolved remote default branch, managed checkout, branch, and PR
authority. The package's standalone delivery command is that CLI's publisher,
not a second one for Cormidia to call.

## 3. Host decisions already settled

C1 survives the superseded 2026-08-12 record unchanged. C2 narrows that
record's deletion decision after contract review: prevent a second Validation
Architect authority without deleting Cormidia's unrelated generic skill surface.

**C1 — the accepted corpus lives in the application repository.** The canonical
corpus is `validation-design/` in the application repo. It survives a fresh
clone, participates in ordinary review, and is available to the managed checkout
once the ratification PR merges to the resolved remote default branch.

Cormidia's state home holds the in-progress bundle, run state, input manifest,
provider and runlog evidence, publication journal, and a pointer plus hash to
the accepted repository corpus. State is operational evidence, never a second
ratified corpus. Planning reads the accepted corpus from the freshly
synchronized managed checkout at the resolved default branch — never an
arbitrary working tree, never an unmerged draft branch.

**C2 — do not copy Validation Architect into the org-home `skills/` root.** The
canonical method arrives as data in the exact-pinned package; loading another
editable copy from org home would create a second version and prompt authority.
The adapter reads the package-owned method and schemas through the library only.

The generic org-home `skills/` root remains. It is already documented as the
future activation destination for promoted org skills, independently of this
integration, while `learning/proposals/skills/` contains unmerged drafts. `org
init` therefore continues generating `skills/.gitkeep`. User-global packaged
operator skills under provider skill homes, package-owned Validation Architect
skills, generic promoted org skills, and learning-loop proposals remain four
different authorities. Activating generic org skills still requires its own
design for selection, hash and version binding, native-harness loading,
authority, context manifests, resumption, and cross-provider equivalence; this
adapter neither implements nor removes that mechanism.

## 4. The open question: does an application get a validation corpus?

Cormidia manages many applications. Designing a validation corpus for one costs
real money and hours of wall clock. So the superseded record asked a reasonable
question — *should every application get one?* — and answered it with a switch.

**What the old design said.** Each application was labelled one of two ways at
onboarding:

- one label meant the application gets a designed corpus, and every
  product-behavior delivery unit inherits validation obligations derived from it;
- the other meant no corpus at all — just the Builder's ordinary tests, the
  Reviewer's independent evidence, and whatever gates the application already
  had configured.

Brand-new applications defaulted to the first; already-existing applications
defaulted to the second.

**Three problems.**

*The names are invented.* Neither label appears anywhere else in Cormidia or in
Validation Architect. They are two new terms a reader has to learn in order to
understand a distinction that amounts to "has a corpus" versus "doesn't."

*The default is backwards.* It keys off how old the application is, but risk
keys off what the application does. A five-year-old service moving customers'
money is far more consequential than a greenfield prototype, and this default
gives the prototype the corpus and the billing service none. It is not even a
capability limit — the method treats "existing application with existing tests"
as a first-class starting point and derives requirements from first principles
before looking at the suite it already has.

*The switch itself is obsolete.* The only reason to offer "no corpus" was cost:
a full campaign is a bounded designer–stakeholder relay with fresh readers and a
two-iteration audit, which is far too much for a throwaway app. The tier
profiles in the contract dissolve that. C0 is **one** Designer turn. The cheap
option is no longer *skip validation design*; it is *run the one-turn profile*.
The switch was a workaround for a cost problem that no longer exists.

**Recommendation: delete the switch. Use the tier.** Every application is
assigned a criticality tier from the C0–C4 model the method already uses, and
the tier selects the campaign profile — one turn at C0 through the full relay at
C3/C4. The default follows what the application does, not when it was created.
That removes two invented terms and a wrong default in a single move, and it
uses vocabulary that already exists in the ratified corpus.

**The one case that remains.** An application can still end up without an
accepted corpus: the design run failed, timed out, exhausted its budget, did not
have enough product truth, or reported that its admitted profile was too shallow
and has not completed the required higher profile. That is a visible degradation
with a stated reason attached — not a configuration mode, and never silent.
Ordinary Builder tests, independent Reviewer evidence, and the application's
configured gates apply in every case; they never depended on the corpus.

This is a recommendation, not a decision, because it changes what Cormidia asks
an owner during onboarding. It needs a ruling before the integration is
designed.

## 5. Remaining questions for the integration session

1. **How the criticality tier is elicited.** Onboarding has to ask the owner
   something they can answer without reading the criticality model. What is the
   question, and how does the answer map to C0–C4?
2. **Who ratifies a corpus.** The method's stakeholder seat is a simulated
   product owner. Where does Cormidia's real human owner ratify, and is that the
   same review as the RoadmapPlan?
3. **How obligations reach delivery units.** A product-behavior delivery unit
   should carry obligations derived from the accepted corpus. What is the exact
   mechanism, and what happens when a unit's obligations cannot be satisfied?
4. **Where `check` runs.** Deterministic closure is cheap enough to run on every
   application PR. Whether it is a required gate per application is a policy
   choice with an escape-hatch question attached.
5. **Revision triggers.** What in Cormidia's loop causes an existing corpus to
   be reopened, and does that spend require approval?

## 6. Consequences for ratified surfaces

No human-ratified surface was edited by this document or its predecessor.

Implementing this integration requires an exact, separately ratified proposal
for `pipelines.yaml` and `prompts/**`: the currently unreachable S-10 prompt
must become a thin governed transport or retire, rather than remaining a second
locally authored validation method beside the library. Those surfaces may not be
silently rewritten. No `docs/PURPOSE.md` change is required for the org-home
skill root because this corrected design preserves its generic purpose.

Nothing here authorizes an L3, L4, L5, or L-ACC campaign, a model-quality claim,
an npm publication, a version tag, or a release handoff.

## 7. Tickets

- `cormidia/Cormidia#381` — Phases 0–1 remain independent. Phases 2–4 exact-pin
  the package, implement `RepositoryPort`, `TurnPort`, and `CampaignStorePort`
  against managed checkouts, governed turns, and the state home, publish the
  accepted corpus through Cormidia's own path, keep package skills out of the
  generic org-home `skills/` root, and integrate joint review and steady state.
- `cormidia/Cormidia#431` — make deterministic trace closure green and enforced,
  then replace the vendored tarball with the exact public package. The closure
  work can proceed now; the dependency swap waits on publication.
- `cormidia/Cormidia#432` — read as the binding clarification of structural
  escalation mechanics. Unchanged by this document.
