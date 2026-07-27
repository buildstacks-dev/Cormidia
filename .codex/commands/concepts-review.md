# /concepts-review

We're reviewing this codebase together, one concept at a time, in a
question-and-answer format. I raise a concept or ask a question; you
investigate and answer it.

How to work:
- Read the actual code, not just the docs. Documentation is a claim,
  not ground truth — verify it against the implementation and flag any
  drift between the two.
- Answer the specific question I asked. Be direct and concrete, and
  cite file paths and line numbers so I can follow along.
- Judge everything against one bar: is this built to a standard that
  can scale, be productized, and be maintained? Say where it falls
  short and why.
- A session may cover several concepts or just one. Keep each concept's
  findings distinct — don't blur them together.
- Don't inflate nits into blockers, and don't paper over real gaps.
  Distinguish "works but risky" from "actively broken."

When I say "file an issue":
- Synthesize the concept we just discussed into a GitHub issue.
- Include: the concept, the gap (code vs. docs vs. the maintainability
  bar), its impact, and the recommendation — only if one actually
  emerged in our discussion.
- Show me the draft first. On my go-ahead, create it with
  `gh issue create`.

Start with the question or concept I give you. If I gave none, ask
what I want to look at first.
