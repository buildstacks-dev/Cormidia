# Recorded upstream corpus — harness freshness probe (#332)

Sample payloads for `scripts/harness-freshness.mjs`, so the probe's whole
diff is exercised offline. **Nothing under `tests/` may touch the network**
(tests/README.md → Spend); `--fixtures <dir>` swaps the fetcher for this corpus.

## Layout

`base/` is the complete corpus: one recorded payload per upstream source the
committed `src/runtime/harness-metadata.json` declares, plus `metadata.json`,
a snapshot whose observed versions and content digests already match those
payloads. Read together they are the "nothing changed" baseline.

Every other directory is an **overlay**: an `index.json` with
`"extends": "../base"` that re-records only the payload its name describes.
That keeps each scenario readable — the diff between it and the baseline *is*
the thing under test — and means a newly declared upstream source shows up as a
missing fixture rather than as a scenario that quietly stopped covering it.

| Scenario | Seeds |
|---|---|
| `base` | nothing — the fresh baseline |
| `version-drift` | codex publishes 0.148.0 while `testedWith` is 0.147.0 |
| `price-change` | the OpenAI pricing page reprices `gpt-5.4` |
| `new-model` | the Muse roster page publishes `muse-spark-1.3` |
| `retired-model` | the Muse roster page drops `muse-spark-1.1` |
| `unreachable` | **negative control** — a 503 registry and a 404 pricing page |
| `malformed` | **negative control** — two HTTP 200s the probe cannot read |
| `stale-snapshot` | **negative control** — baseline payloads, stale `metadata.json` |

The three negative controls carry the rule the probe exists to protect: a source
it could not read is a FAILURE, never "no changes", and an empty roster parse is
never a wholesale retirement.

## Payload realism

These are trimmed **samples**, not verbatim captures: registry manifests keep
only the fields the probe reads, and the documentation pages keep only the rows
Cormidia prices. Trimming is deliberate — a verbatim vendor page would be large,
would carry third-party copy, and would churn the diff on every unrelated
upstream edit.

One consequence is worth naming: price extraction reads dollar figures
positionally, in the order the harness declares in `pricing.fields`. A vendor
that reorders its columns produces *wrong* proposed numbers, not an error. That
is survivable only because every extracted figure lands in a human-reviewed pull
request showing old → new per field, and is why the probe never merges.

## Regenerating

`base/metadata.json` and `stale-snapshot/metadata.json` are derived, not typed:

1. edit the payloads (or `src/runtime/harness-metadata.json`);
2. re-derive `base/metadata.json` — every automated source's `observed` version
   from its recorded payload, and every `contentDigest` from the SHA-256 of the
   recorded document body;
3. re-seed `stale-snapshot/metadata.json` from `base/metadata.json` by staling
   exactly the four facts its `note` names;
4. `pnpm biome format --write tests/fixtures/harness-freshness/`.

`corpus.test.ts` is the guard on all of it: it fails on an empty walk, on a
payload an index references but does not ship, on a baseline that no longer
covers every declared upstream source, on a scenario snapshot that stops
validating for all seven harnesses, and on a `stale-snapshot` that has drifted
back into agreement with the baseline.
