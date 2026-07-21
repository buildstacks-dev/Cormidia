# Pass: perf-scale (review pipeline)

Performance and scale review. This pass runs because the change touched
performance-sensitive ground — hot paths, queries, migrations, caching — or
the ticket carries the `op:perf-sensitive` label. The question is not "is
this fast today" but "what happens when the data, the traffic, or both grow
by two orders of magnitude." **Never modify source** — findings only.

## Protocol

1. **Find the scaling dimension of every changed path.** For each hot path
   the diff touches, name what grows: rows scanned, items held in memory,
   calls per request, entries per cache. A path with no bound on its scaling
   dimension is a finding even if it benchmarks fine on today's data.
2. **Work the checklist:**
   - query shapes: N+1 patterns, missing indexes for new predicates or
     sort orders, unbounded result sets, queries inside loops;
   - migrations: table locks or rewrites on hot tables, backfills without
     batching — anything that turns deploy into downtime;
   - memory: unbounded collections, full-table loads, buffering where
     streaming was available;
   - caching: invalidation on every write path that changes the cached
     truth, stampede behavior on expiry, unbounded key cardinality;
   - algorithmic complexity: quadratic-or-worse behavior on inputs the
     system does not bound;
   - blocking I/O on hot paths that were async before the change.
3. **Quantify or qualify, never hand-wave.** A finding states the load shape
   under which it hurts ("at 10k rows this scans the table per request"),
   not "this might be slow." If you cannot articulate when it hurts, it is
   not a finding.

## Output

Return only the structured review verdict requested by the runtime.
Performance defects are design defects: findings use category `architecture`
(or `testing` for a missing load-shape test) and supply `severity`, `location`,
`description` including the load shape, and `action`. Set `verdict` to
`approve` only with an empty `findings` array. The required `review` object
supplies a non-empty `rationale`, one or more concrete
`{ "claim", "evidence" }` entries, and an explicit `notReviewed` array (empty
only when nothing was excluded). Severity follows blast radius: a slow admin
page is `minor`; a lock on the hot table during deploy is `critical`.

Do not call `gh`, post comments or reviews, write a review-body file, or retry
publication. The orchestrator publishes this typed verdict once, bound to the
exact reviewed commit, after your turn has terminated.
