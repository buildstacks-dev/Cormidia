---
paths:
  - "TASTE.md"
  - "roles.yaml"
  - "pipelines.yaml"
  - "prompts/**"
  - "docs/PURPOSE.md"
---
# Human-ratified surfaces — Claude workflow
These files are human-ratified (AGENTS.md → Working rules): propose, never
silently rewrite. Claude-specific handling:
- Never edit these as a side effect of another task. Make the change its own
  focused diff with written rationale (a proposal commit/PR); plan mode is a
  good fit before touching them.
- Never reformat, reorder, or "clean up" these files while passing through.
- `docs/PURPOSE.md` is a decision log: append new dated decisions; do not
  rewrite ratified Decided entries.
- The org runtime treats agent writes to these as critical ops — apply the
  same etiquette when working on the repo itself.
