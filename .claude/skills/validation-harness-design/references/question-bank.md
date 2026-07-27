# Question Bank — elicitation openers and gap-closing probes

Structured to the concept loop. **Beat-3 openers** are what you ask after framing and grounding, to hand the floor over — ask one, then stop. **Beat-4 probes** are the categories you check the human's answer against during synthesis, and ask about only if their own thinking didn't reach them.

Never read a category list aloud during beat 3. Firing twenty questions at someone is interrogation, not elicitation — it produces short defensive answers instead of the rambling that actually contains the domain knowledge.

When an answer exposes something the architecture doc doesn't cover, record an architecture finding rather than filling the gap yourself.

---

## Phase 0 — Scope and inheritance

- Is this the whole product, or a module inside something larger?
- (Module) Does the parent already have a harness — tests, gates, a policy file? Where do those live?
- (Module) Which parent guarantees does this module have to keep honoring? Which does it need to make *stricter*?
- (Module) What does the rest of the product assume about this module that it would break the product to change?
- (Product, large) Which subsystems are big enough to deserve their own design pass later, rather than being covered here?

## Phase 1 — Inputs and tier

- Who gets hurt when this breaks, and how badly — an apology, a refund, a lawsuit, a person harmed?
- How is it deployed: one install with two users, or multi-tenant with strangers sharing infrastructure?
- Is any part of this materially higher-stakes than the rest? (Drives per-component tier override.)

---

## Phase 2 — Invariants

**Beat-3 openers** (pick one):

- "Where in this system would something being wrong be catastrophic rather than annoying?"
- "What has to be true after every operation — including the ones that fail halfway through?"
- "If you woke up to a production incident here, what would the worst possible headline be?"

**Beat-4 probes** — categories to check coverage against:

*Money and irreversible actions*
- Where does money move, or where does an action become impossible to undo (send, delete, deploy, charge, notify, merge)?
- What must be true immediately before and after each such action?
- If it ran twice with identical inputs, what must the world look like? (Surfaces idempotency invariants.)

*State machines*
- Which entities have a lifecycle? Every state, every legal transition.
- Can any transition be skipped, reversed, or repeated? Under what authority?
- What happens to in-flight work when an entity changes state?

*Resource conservation*
- What must never go negative, exceed a cap, or be created from nowhere (inventory, credits, budget, seats, tokens, leases)?
- When two actors claim the same resource concurrently, who wins and what does the loser observe?

*Uniqueness and mapping*
- What must map one-to-one (charge↔order, user↔account, message↔delivery)? One-to-at-most-one?
- What identifier makes each mapping checkable? If none exists, that's a design gap.

*Ordering and idempotency*
- Which events must be processed in order? What happens on out-of-order arrival, duplicates, or replays?

*Tenancy and authorization*
- What must one tenant/user never observe or affect about another?
- Which operations require which authority, and is that checkable at every entry path, not just the UI?

**Closing pass, per accepted invariant**
- "How could I violate this?" — each credible path becomes a seed test case.
- "Test, runtime guardrail, or both?" — anything violable at runtime by an external system or model needs the guardrail.
- (Module) "Is this new, or a tightening of a parent invariant? Which one?"

---

## Phase 3 — Boundaries

**Beat-3 openers** (pick one):

- "Walk me through what happens if each major piece here is down for five minutes — which other pieces keep working?"
- "Which parts of this system get deployed separately, or could be a version apart from each other?"

**Beat-4 probes:**

- Who owns this piece of state — exactly one component? If two can write it, why?
- Where does the consistency guarantee change (transactional → eventual, strong → cached)?
- **The boundary test:** can side A be down while side B is up? If unanswerable → architecture finding.
- Per confirmed boundary: what does a timeout look like from each side? A partial success? A duplicate delivery? A stale read? A version skew after a deploy?
- Which boundaries are external by definition (payment API, LLM provider, message queue, third-party tool)? These get failure-mode coverage regardless of vendor reliability claims.
- (Module) What crosses the seam between this module and the parent — calls, shared state, events, files? That seam is a boundary; enumerate it first.

---

## Phase 4 — Contracts and acceptance criteria

**Beat-3 openers** (pick one):

- "For this boundary — what does the caller assume that the other side never actually promised?"
- "What would someone integrating with this module get wrong on their first try?"

**Beat-4 probes, per boundary:**

- Complete set of valid inputs? What does the caller receive for each invalid class — error, silence, coercion?
- What's guaranteed about output — fields always present, ranges, ordering, freshness?
- Idempotent? Retryable? What key makes retries safe?
- What latency/ordering does the caller assume that the callee never promised?

**Per journey:**

- State it as given/when/then at the behavior level. Reject UI-level phrasing ("the button turns green") in favor of behavior ("the order fails atomically and the user is told which item").
- Which invariant or contract does this defend? If none, ask whether it matters or an invariant is missing.

---

## Phase 5 — LLM call sites

**Beat-3 openers** (pick one):

- "For this call — what would make you say the output is *broken*, versus merely *not great*?"
- "Where does this system trust a model's output enough to act on it without a human seeing it first?"

**Beat-4 probes:**

- Inventory: where does the product call a model, and what role does each site play (plan, generate, review, summarize, route, judge)?
- Per site: structural contract (schema, enums, budgets) vs quality bar (a rubric a grader could apply)?
- What happens when output fails to parse — retry, fallback, fail-closed halt? Is that path tested with a mocked provider?
- Is any site judging another model's output? Then: what seeded defects must it catch, what clean inputs must it pass? (Meta-eval.)
- Is any site inside a multi-step loop? Then: what makes a *trajectory* acceptable — legal tools, budget, escalation triggers — and where is the telemetry to assert on?
- If the model or provider were swapped tomorrow, what artifact proves the swap is safe? (If not "the golden-set delta," the golden set is missing or too thin.)
- Which invariants could the model violate at runtime? Each needs a guardrail in code, not an eval hoping it behaves.

---

## Phase 6 — Risk weighting

**Beat-3 opener:**

- "Which failures here cost money, trust, or a legal conversation — versus the ones where you'd apologize and ship a fix? And which are irreversible?"

**Beat-4 probes:**

- Which paths change most often, or have the most people touching them?
- Given the deployment shape from Phase 1, where's the real contention point under peak load — a throughput problem or a hot-resource problem?
- Present the matrix; the human confirms. Do not let the doc or your own inference settle business consequence.

---

## Phase 7 — Tooling

- What's already in the repo or the parent product? (Default; divergence needs justification.)
- Where does CI run today, and what's the tolerable wall-clock for the per-commit tier?
- Who else will read these test results — just you, or a team that didn't write them?
- Is there a budget ceiling on quality evals that should be encoded as a threshold rather than discovered later?
