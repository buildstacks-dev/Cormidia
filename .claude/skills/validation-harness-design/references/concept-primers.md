# Concept Primers

Teaching material for **beat 1 (Frame)** and **beat 2 (Ground)** of the concept loop. Read the relevant entry before opening a concept with the human.

These are source material, not scripts. Compress to a few short paragraphs in delivery, adapt examples toward the human's domain literacy, and never read a section aloud wholesale. The goal is that a human meeting the term for the first time can think productively about it thirty seconds later — and that a human who already knows it doesn't feel lectured.

**Contents:** [Invariants](#invariants) · [Boundaries](#boundaries) · [Contracts](#contracts) · [LLM eval layers](#llm-eval-layers) · [Risk tiers](#risk-tiers)

---

## Invariants

**What it is.** A statement about your system that must be true at every observable moment, no matter what the code does, what the user does, or what fails. Not a goal, not a requirement, not a feature — a property that, if it ever became false, would mean something is broken in a way no amount of retrying fixes.

**Why it exists as a separate concept.** Test cases are infinite and features churn. Invariants are few and outlive both. They are the thing you write tests *from*: every invariant generates adversarial cases ("how could this be violated?") for the life of the product, and the ones that can be violated at runtime by something outside your control become runtime guardrails, not just tests.

**Canonical examples across domains:**

- *Banking:* the sum of all account balances equals the sum of all recorded transactions. No transfer creates or destroys money.
- *Ticketing:* no seat is assigned to two ticket-holders for the same showing.
- *Package manager:* an installed dependency tree resolves to exactly one version per package, or installation fails — never a half-installed tree.
- *Job queue:* every enqueued job is either pending, leased by exactly one worker, completed, or dead-lettered. Never leased by two, never silently vanished.
- *Agentic system:* no action with external side effects executes without a recorded approval token for that specific action.

**Common confusions — name these explicitly:**

| Not an invariant | Why | What it actually is |
|---|---|---|
| "The API responds in under 200ms" | Load can break it without anything being wrong | A contract term / SLO |
| "Users can reset their password" | A capability, not a property | A feature with acceptance criteria |
| "The system is reliable" | Nothing can falsify it | A wish |
| "The planner produces good plans" | Quality is statistical, not binary | An eval rubric |
| "Retries use exponential backoff" | Implementation detail | A contract term |

The most common failure mode is **contracts masquerading as invariants** — statements true of one component's interface rather than of the system as a whole. Push those down to the contracts phase rather than arguing about them.

**Grounding heuristic (beat 2).** In the architecture doc, look for: state that two components can both write; anything counted, budgeted, or leased; anything irreversible (send, charge, deploy, delete, merge); anything with a lifecycle diagram. Pick one, derive the invariant out loud in three lines, and mark it as illustration.

**Acceptance gate.** State it as something a test could violate. If you cannot describe the shape of the failing test, it does not pass. Then classify enforcement — test, runtime guardrail, or both — and run one adversarial pass to produce seed cases.

**Beat-3 framing to offer:** "Where in this system would something being wrong be *catastrophic* rather than annoying? What must be true after every operation, even the ones that fail halfway? Don't organize it — just talk."

---

## Boundaries

**What it is.** A line in the system across which failure is independent. Two things are on opposite sides of a boundary if one can be down, slow, stale, or a version behind while the other keeps running. Boundaries are discovered in the architecture, not chosen for testing convenience.

**Why it exists as a separate concept.** It answers the question people usually settle by taste: what is a unit test and what is an integration test. Inside a boundary, components fail together — test them as a block, because mocking your own internals just tests your mocks. Across a boundary, they fail independently — and the independent failure modes (timeout, partial success, duplicate delivery, stale read, version skew) are precisely what integration tests exist to cover and what happy-path integration tests always miss.

**The three signals that a boundary exists:**

1. **State ownership changes** — a different component becomes the writer of record.
2. **Consistency guarantee changes** — transactional becomes eventual, strong becomes cached.
3. **Failure domain changes** — one side can be unavailable while the other is up.

**Canonical examples across domains:**

- *E-commerce:* your order service and the payment processor. The processor can time out after having charged the card — partial success is the defining failure mode, and it is why idempotency keys exist.
- *Web app:* your app server and the database. Same box or not, the DB can be up while the app is deploying, and schema version skew is a real state during rollout.
- *Any LLM product:* your code and the model provider. Rate limits, malformed output, latency spikes — a boundary by definition, no matter how reliable the vendor claims to be.
- *Not a boundary:* two classes in the same module sharing a transaction and deploying together. They fail as one thing. Test them as one thing.

**Common confusion.** People draw boundaries at *code organization* lines (packages, folders, "layers") rather than failure lines. A repository class and the service that calls it are usually the same failure domain despite living in different directories — mocking across that line produces tests that pass while production breaks.

**Grounding heuristic (beat 2).** Take one component pair from the doc and ask the boundary test out loud: *can A be down while B is up?* Show both the yes case and a no case, so the human sees the discriminator rather than a verdict.

**Acceptance gate.** The boundary test is answered. If the human can't answer it, that's an architecture finding — record it, don't resolve it. Then enumerate the failure modes for each confirmed boundary.

**Module scope note.** The seam between the module and its parent product is always a boundary, and typically the most valuable one on the map: it is where the module's promises to everything else live, and where a future refactor will break things silently if the contract isn't written down.

**Beat-3 framing to offer:** "Walk me through what happens if each major piece of this is down for five minutes. Which other pieces keep working? Ramble — I'll structure it after."

---

## Contracts

**What it is.** The complete promise one side of a boundary makes to the other: what inputs are valid, what outputs are guaranteed, what happens on every class of error, whether the operation is safe to retry, and what ordering or freshness the caller may assume.

**Why it exists as a separate concept.** Most production integration bugs are not "the code was wrong" — they are **assumption mismatches**: the caller assumed ordering the callee never promised, assumed retries were safe, assumed a field was always present. Writing the contract makes the mismatch visible at design time. Contracts are also the source of unit-test scope: a unit test asks whether a component honors its own contract; an integration test asks whether two components' contracts actually fit.

**The five parts of a complete contract:**

1. **Valid input domain** — and what happens for each *invalid* class: error, silence, or coercion.
2. **Output guarantees** — fields always present, value ranges, ordering, freshness.
3. **Error behavior** — which errors are typed and retryable vs terminal; what the caller must do with each.
4. **Idempotency** — is repeating this safe, and what key makes it safe.
5. **Timing and ordering** — latency expectations, whether order is preserved, what "eventually" means numerically.

**Canonical examples across domains:**

- *Payment API:* accepts an idempotency key; guarantees at most one charge per key within 24h; returns typed decline vs network error; makes no ordering promise across keys. Every one of those clauses generates a test.
- *Message queue:* at-least-once delivery, no global ordering guarantee, visibility timeout of N seconds. The consumer's contract must therefore include deduplication — an obligation created purely by the producer's contract.
- *Internal search index:* eventual consistency with a stated lag bound. If the lag bound isn't stated, "stale read" bugs are unfalsifiable and will be argued about forever.

**Common confusion.** Contracts get written as *descriptions of the happy path* — the signature plus a sentence. A contract without error behavior and idempotency semantics is not a contract; it's documentation. The value is concentrated in the unhappy clauses.

**Acceptance criteria** are the journey-level sibling: given/when/then at the **behavior** level ("the order fails atomically and the user is told which item was unavailable"), never the UI level ("the button turns red"). Each must trace to an invariant or a contract; if one traces to neither, either it doesn't matter or an invariant is missing.

**Grounding heuristic (beat 2).** Take a boundary already confirmed in Phase 3 and fill in all five parts out loud — including deliberately leaving one unknown and marking it a finding, to model that gaps are recorded rather than invented.

**Acceptance gate.** All five parts present or explicitly marked unknown. No unhappy-path silence.

**Beat-3 framing to offer:** "For this boundary — what does the caller *assume* that the other side never actually promised? That's usually where the bugs live."

---

## LLM eval layers

**What it is.** Two separate validation surfaces for the same model call. The **contract layer** is deterministic and binary: did the output parse, match the schema, stay inside token and latency budgets, and did the surrounding code handle malformed output correctly. The **quality layer** is statistical: across a committed set of representative tasks, does the output meet a rubric at a stated threshold.

**Why the split matters.** Collapsing them produces a flaky CI that everyone eventually ignores. Contract-layer tests can run on every commit with a mocked provider and must be green — they test *your code*, not the model. Quality evals cost money and time, are non-deterministic, and belong on prompt change, model change, and nightly. A single green run of a quality eval means nothing; thresholds are stated over N runs.

**The load-bearing distinction:** *guardrails enforce invariants; evals measure quality.* If an invariant can be violated by the model — an unapproved side effect, a budget overrun, a cross-tenant leak — it gets enforced in code, fail-closed, and you test the guardrail. Never write an eval that hopes the model behaves and call it enforcement.

**Canonical examples:**

- *Summarizer:* contract layer — output is under N tokens, contains no URLs, parses as JSON with the expected keys. Quality layer — a 40-item golden set graded against a rubric for faithfulness, threshold ≥90%.
- *Review gate (LLM judging LLM):* needs a **meta-eval** — a seeded-defect set measuring catch rate, plus clean inputs measuring false-positive rate. An uncalibrated judge silently corrupts every metric downstream of it.
- *Agent loop:* needs **trajectory evals** — was every tool call legal, was the step and token budget respected, did it loop, did it escalate when it should have. Start with deterministic assertions over run telemetry; that's cheap and catches most of it.

**Common confusion.** Teams treat the golden set as a nice-to-have. It is in fact the **model-swap regression suite** — the artifact that makes "can we move this call to a different model?" answerable in an afternoon rather than a quarter. No golden set, no swappability. And it must be authored *before* prompt tuning, or you've tuned against your own grader.

**Grounding heuristic (beat 2).** Take one call site from the doc and split it into the two layers out loud, showing which failures land where.

**Beat-3 framing to offer:** "For this call — what would make you say the output is *broken*, versus merely *not great*? The first is the contract layer, the second is the quality layer, and I want your instinct on both."

---

## Risk tiers

**What it is.** An explicit allocation of testing effort across the system, built from probability of failure × cost of failure. It says out loud what every team does implicitly: some paths get exhaustive coverage, some get smoke tests, some get nothing.

**Why it exists as a separate concept.** Uniform coverage targets ("80% everywhere") allocate effort by code volume rather than by consequence, which reliably over-tests the boring parts and under-tests the money path. Making the allocation explicit also makes it *reviewable* — and it is the input a future audit uses to judge whether a gap is a finding or a deliberate choice.

**The two axes:**

- **Probability** — how often does this path change, how many people touch it, how complex is the state, how many external dependencies.
- **Cost** — is failure recoverable with a retry, or is it money, data loss, legal exposure, or reputational damage? Irreversibility is the dominant term: an action that cannot be undone belongs in the top tier almost regardless of probability.

**Canonical example.** In a checkout system, payment capture is low-frequency-change but catastrophic-cost — exhaustive. The recommendation carousel is high-frequency-change but low-cost — smoke tests and a visual check. Testing both to the same standard is how teams end up with 80% coverage and a payment bug.

**Scale testing is part of this.** Load testing uniform throughput is usually theater. Find the **contention point** implied by the deployment shape — one hot row, one lease, one queue everyone claims from — and test that.

**Why this is the human's call, not yours.** Business consequence is not fully encoded in any architecture doc. You propose the matrix from evidence; the human confirms it. Do not let your own inference or a doc's silence settle what a failure would actually cost.

**Beat-3 framing to offer:** "Which failures here would cost you money, trust, or a legal conversation — versus the ones where you'd just apologize and ship a fix? And which are irreversible?"
