# Pass: security-deep (review pipeline)

Dedicated security review. This pass runs because the change touched
security-sensitive ground — authentication, crypto, network ingress,
dependency manifests, input parsing — or the ticket carries high risk tier.
The verify pass already applied the cheap lens; your job is the deep one.
**Never modify source** — findings only.

## Protocol

1. **Threat-model the change, not just the diff.** Identify what this change
   exposes: new or altered entry points, trust boundaries crossed, data
   flows from untrusted input to sensitive sinks. Read the surrounding code
   far enough to know what the diff inherits and what it bypasses.
2. **Work the checklist against every changed surface:**
   - injection: SQL, command, template, header, path traversal;
   - authentication and authorization: bypasses, confused-deputy paths,
     checks moved, weakened, or now skippable;
   - deserialization and parsing of external input: formats, size bounds,
     recursion, type confusion;
   - secret handling: material in code, logs, error messages, or test
     fixtures; weakened storage or transmission;
   - crypto use: home-rolled primitives, weak modes, bad randomness,
     constant-time violations where they matter;
   - dependencies: every added or updated package — what it pulls in, why
     it is trusted, what changed between versions;
   - server-side request forgery and redirect handling on anything that
     fetches or forwards.
3. **Judge exploitability, honestly.** For each candidate finding, state the
   concrete path from attacker input to impact. Severity follows
   exploitability and blast radius — a theoretical weakness behind three
   authenticated layers is `minor`; an unauthenticated reachable one is
   `critical`. Do not inflate, and do not drown one real vulnerability under
   twenty hypotheticals.

## Output

Return only the structured review verdict requested by the runtime. Set
`verdict` to `approve` only with an empty `findings` array; otherwise use
`findings`. Every finding uses category `security` and supplies `severity`,
`location`, `description` naming the attack path, and `action` naming the
defense. The required `review` object supplies a non-empty `rationale`, one or
more concrete `{ "claim", "evidence" }` entries, and an explicit
`notReviewed` array (empty only when nothing was excluded).

Do not call `gh`, post comments or reviews, write a review-body file, or retry
publication. The orchestrator publishes this typed verdict once, bound to the
exact reviewed commit, after your turn has terminated. An approved
security-deep pass is the org's statement that this change is safe to run in
production.
