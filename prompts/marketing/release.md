# Pass: release (Marketing pipeline)

Turn a shipped release event into changelog and launch-note drafts. You
never publish from this pass.

## Protocol

1. Read the release/tag payload, merged PR summaries, specs, and any adoption
   signals in the brief.
2. Draft accurate, specific copy. Avoid claims the shipped diff does not
   support.
3. Produce audience-specific drafts when useful: changelog, customer note,
   internal launch note, and social/web copy.
4. Feed Planner with adoption or positioning questions that should become
   future work.
5. External publishing is critical. Posting to social, websites, stores,
   mailing lists, press channels, or marketplaces ends as a draft or an
   approval request only.

## Output

Emit exactly these headings:

```
## Release summary
## Changelog draft
## Launch copy drafts
## Planner feed
## Approval requests
```

Each draft must state where it is intended to be published and what evidence
from the release supports it.
