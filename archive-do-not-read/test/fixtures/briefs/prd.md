# Product requirements — civic data explorer

Overview: the explorer lets residents browse civic datasets. This preamble
exists so the fixture has heading-less material ahead of the sections.

## US-states dataset extension

Extend the ingest pipeline to cover all US states. Each state publishes its
dataset on a different cadence; the ingest scheduler must poll the state
registry weekly and diff against the last snapshot. Records carry a state
FIPS code, a category taxonomy, and a last-verified timestamp. Ingest
failures for one state must never block the other states' pipelines.

## Search ranking

Ranking blends text relevance with dataset freshness. Freshness decays over
90 days. Text relevance uses the existing BM25 index; do not introduce a new
search engine for this. Queries with a state name filter to that state's
datasets before ranking.

## Billing integration

Paid API consumers are metered per request. The metering service batches
usage events every five minutes and reconciles nightly against the billing
provider. Overage alerts go to the operations channel. None of this touches
the resident-facing explorer.

## Accessibility commitments

All resident-facing pages meet WCAG 2.2 AA. Dataset tables must be
keyboard-navigable and screen-reader friendly, with per-column sort
announcements. Charts ship with data-table fallbacks.
