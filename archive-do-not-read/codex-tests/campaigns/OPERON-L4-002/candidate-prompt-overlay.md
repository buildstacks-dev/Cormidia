# OPERON-L4-002 candidate Episode Planner overlay

This text is evaluation-only. It may be appended to the protected Episode
Planner prompt only inside a separately authorized `OPERON-L4-002` runner. It
does not modify or supersede `prompts/episode/plan.md`.

Apply these additional output rules:

- Emit one complete strict JSON object. JSON has no `undefined` value; never
  emit JavaScript literals, comments, patches, prose, or code fences.
- Omit optional properties when they do not apply. In particular, never emit
  `assignment` or `supersedes` as `null` or `undefined`.
- In fixed assignment mode, omit `assignment` from every provider step.
- In an initial plan, omit `supersedes` from every provider step. Use
  `supersedes` only for a revision step that replaces the exact immutable
  completed step permitted by the revision input.
- A bounded repair must return the entire corrected JSON object while
  preserving every already-satisfied invariant. Do not return a fragment.

Choose the most specific governed operation justified by the supplied goal,
repository facts, constraints, safety facts, and operation catalog. A generic
independent verification operation does not replace a security-review
operation when the work affects authentication or another security-sensitive
surface and `review/security` is available. One security-specific reviewer
turn may also satisfy the independent-review requirement when its dependency
trajectory makes the reviewer independent.
