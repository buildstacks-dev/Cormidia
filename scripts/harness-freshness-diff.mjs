// Deterministic core of the upstream-freshness probe (#332).
//
// Everything here is pure: it takes already-fetched payloads plus the committed
// metadata and returns a report and (optionally) a proposed metadata document.
// No network, no filesystem writes, no clock beyond an injected timestamp — so
// the whole diff is unit-testable against recorded fixtures.
//
// Three rules the shape of this module encodes:
//
//  1. **A fetch failure is never freshness.** Any unreachable or malformed
//     source makes the whole report `failed`; it can never be reported as
//     "no changes". Silence about a source we could not read is the one
//     outcome this probe must never produce.
//  2. **The probe reads version bands, it never writes them.** Moving
//     `testedWith` is a re-certification claim (docs/harness/adding-updating.md
//     §6), so drift against the band is REPORTED and nothing more.
//  3. **Ratified surfaces get proposals, not edits.** Model ids in
//     `roles.yaml` and friends are human-ratified; a roster change becomes
//     prose in the pull-request body.

import ts from "typescript";

export const REPORT_SCHEMA_VERSION = 1;

/** The only file the probe may ever write. Everything else is a proposal. */
export const WRITABLE_METADATA_PATH = "src/runtime/harness-metadata.json";

/** Ratified surfaces automation must never touch (AGENTS.md → Working rules),
 *  plus the version bands, whose movement requires a certification run. */
export const PROTECTED_PATHS = [
  "roles.yaml",
  "TASTE.md",
  "docs/PURPOSE.md",
  "pipelines.yaml",
  "prompts/",
  "src/runtime/harness-support.ts",
];

const BREAKING_KEYWORDS = [
  "breaking change",
  "breaking:",
  "backwards incompatible",
  "backward incompatible",
  "incompatible change",
  "removed support",
  "no longer supported",
  "migration guide",
];

/**
 * Read `floor`/`testedWith` out of `harness-support.ts` by parsing it, rather
 * than duplicating the bands into a second file that could disagree with the
 * one the runtime actually enforces. A shape this reader cannot understand
 * throws — an unreadable declaration must not silently become "no drift".
 */
export function readHarnessBands(source, path = "harness-support.ts") {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  let literal;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "HARNESS_SUPPORT") {
      let initializer = node.initializer;
      while (initializer !== undefined && (ts.isAsExpression(initializer) || ts.isSatisfiesExpression(initializer))) {
        initializer = initializer.expression;
      }
      if (initializer === undefined || !ts.isObjectLiteralExpression(initializer)) {
        throw new Error(`${path}: HARNESS_SUPPORT is not an object literal`);
      }
      literal = initializer;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (literal === undefined) throw new Error(`${path}: no HARNESS_SUPPORT declaration found`);

  const bands = {};
  for (const property of literal.properties) {
    if (!ts.isPropertyAssignment(property)) throw new Error(`${path}: HARNESS_SUPPORT has a non-literal member`);
    const runtime =
      ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : undefined;
    if (runtime === undefined) throw new Error(`${path}: HARNESS_SUPPORT has a computed member name`);
    if (!ts.isObjectLiteralExpression(property.initializer)) {
      throw new Error(`${path}: ${runtime} declaration is not an object literal`);
    }
    const declaration = {};
    for (const field of property.initializer.properties) {
      if (!ts.isPropertyAssignment(field) || !ts.isIdentifier(field.name)) continue;
      if (ts.isStringLiteral(field.initializer)) declaration[field.name.text] = field.initializer.text;
    }
    if (typeof declaration.floor !== "string" || typeof declaration.testedWith !== "string") {
      throw new Error(`${path}: ${runtime} is missing a string floor/testedWith`);
    }
    bands[runtime] = { floor: declaration.floor, testedWith: declaration.testedWith };
  }
  if (Object.keys(bands).length === 0) throw new Error(`${path}: HARNESS_SUPPORT declared no harnesses`);
  return bands;
}

/** The one place a version-source URL is spelled: the planner and the differ
 *  must agree byte-for-byte, or a fetched response looks unrecorded. */
function versionSourceUrl(source) {
  return source.kind === "npm"
    ? `https://registry.npmjs.org/${source.package.replace("/", "%2F")}/latest`
    : `https://api.github.com/repos/${source.repo}/releases/latest`;
}

/** Every upstream request the committed metadata implies, deduplicated by URL
 *  so one document shared by two facts is fetched once. */
export function plannedRequests(metadata) {
  const requests = new Map();
  const add = (request) => {
    const existing = requests.get(request.url);
    if (existing === undefined) requests.set(request.url, request);
    else existing.uses.push(...request.uses);
  };
  for (const [harness, entry] of Object.entries(metadata.harnesses)) {
    for (const source of entry.upstream.versionSources) {
      if (source.kind === "manual") continue;
      add({
        url: versionSourceUrl(source),
        accept: "json",
        uses: [{ harness, purpose: source.kind === "npm" ? "npm_version" : "github_release", sourceId: source.id }],
      });
    }
    for (const purpose of ["pricing", "roster"]) {
      const fact = entry[purpose];
      if (fact === null || fact === undefined) continue;
      add({ url: fact.source.url, accept: "text", uses: [{ harness, purpose: `${purpose}_doc` }] });
    }
  }
  return [...requests.values()].sort((left, right) => (left.url < right.url ? -1 : 1));
}

/** Tags are not uniformly `vX.Y.Z` upstream — codex publishes `rust-v0.147.0`,
 *  others publish a bare number — so the first version-shaped token wins rather
 *  than a fixed prefix, which would report a readable release as unreadable. */
function parseVersion(value) {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(String(value).trim());
  return match === null ? undefined : { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function compareVersions(left, right) {
  for (const field of ["major", "minor", "patch"]) {
    if (left[field] !== right[field]) return left[field] < right[field] ? -1 : 1;
  }
  return 0;
}

function normalizeVersion(value) {
  const parsed = parseVersion(value);
  return parsed === undefined ? String(value).trim() : `${parsed.major}.${parsed.minor}.${parsed.patch}`;
}

/** Strip markup so a vendor's HTML page and its plain-text equivalent read the
 *  same. Deliberately crude: this feeds a REPORT, and anything it cannot read
 *  cleanly is reported as unreadable rather than guessed at. */
export function normalizeDocument(body) {
  return String(body)
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Attribute the dollar figures in a document to the model ids they follow.
 * A model whose segment does not carry exactly `fieldCount` figures, or whose
 * repeated mentions disagree, resolves to `"unreadable"` — never to a partial
 * guess, because these numbers back the per-turn budget cap.
 */
export function extractDocumentPrices(body, docIds, fieldCount) {
  const text = normalizeDocument(body);
  const haystack = text.toLowerCase();
  const ordered = [...new Set(docIds)].sort((left, right) => right.length - left.length);
  const hits = [];
  for (const docId of ordered) {
    const needle = docId.toLowerCase();
    for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) {
      if (!hits.some((hit) => at >= hit.at && at < hit.at + hit.length))
        hits.push({ docId, at, length: needle.length });
    }
  }
  hits.sort((left, right) => left.at - right.at);
  const found = new Map();
  for (const [index, hit] of hits.entries()) {
    const end = index + 1 < hits.length ? hits[index + 1].at : text.length;
    const figures = [...text.slice(hit.at, end).matchAll(/\$\s*(\d+(?:\.\d+)?)/g)].map((match) => Number(match[1]));
    const resolved = figures.length === fieldCount ? figures : "unreadable";
    const previous = found.get(hit.docId);
    if (previous === undefined) found.set(hit.docId, resolved);
    else if (JSON.stringify(previous) !== JSON.stringify(resolved)) found.set(hit.docId, "unreadable");
  }
  return found;
}

/** Model ids a documented roster page publishes, per the roster's own pattern. */
export function extractRosterModels(body, pattern) {
  const matches = normalizeDocument(body).match(new RegExp(pattern, "g"));
  return matches === null ? [] : [...new Set(matches)].sort();
}

function delta(kind, harness, severity, detail, proposal) {
  return { kind, harness, severity, detail, proposal };
}

function versionDeltas(context, harness, entry, bands) {
  const { responses, deltas, failures, unautomated, patch } = context;
  for (const source of entry.upstream.versionSources) {
    if (source.kind === "manual") {
      unautomated.push({ harness, sourceId: source.id, url: source.url ?? null, reason: source.reason });
      continue;
    }
    const url = versionSourceUrl(source);
    const response = responses.get(url);
    if (response === undefined || response.ok !== true) {
      failures.push({ harness, sourceId: source.id, url, reason: response?.reason ?? "no response recorded" });
      continue;
    }
    let latest;
    let notes = "";
    try {
      const payload = JSON.parse(response.body);
      latest = source.kind === "npm" ? payload.version : payload.tag_name;
      notes = source.kind === "npm" ? "" : String(payload.body ?? "");
    } catch (error) {
      failures.push({ harness, sourceId: source.id, url, reason: `payload is not JSON: ${String(error)}` });
      continue;
    }
    if (typeof latest !== "string" || parseVersion(latest) === undefined) {
      failures.push({ harness, sourceId: source.id, url, reason: `no readable version in payload (${latest})` });
      continue;
    }
    const version = normalizeVersion(latest);
    const seen = entry.upstream.observed[source.id];
    if (seen === undefined) {
      deltas.push(
        delta("first_observation", harness, "info", `${source.id}: first automated observation is ${version}`, {
          path: ["harnesses", harness, "upstream", "observed", source.id],
          value: { version, recordedAt: context.observedAt, evidence: `${url} (automated probe)` },
        }),
      );
    } else if (seen.version !== version) {
      const majorBump = parseVersion(seen.version)?.major !== parseVersion(version)?.major;
      deltas.push(
        delta(
          "upstream_version_changed",
          harness,
          majorBump ? "breaking" : "review",
          `${source.id}: upstream moved ${seen.version} → ${version}${majorBump ? " (MAJOR bump)" : ""}`,
          {
            path: ["harnesses", harness, "upstream", "observed", source.id],
            value: { version, recordedAt: context.observedAt, evidence: `${url} (automated probe)` },
          },
        ),
      );
    }
    driftAgainstBand(deltas, harness, source.id, version, bands[harness]);
    breakingSignal(deltas, harness, source.id, notes);
    patch.checked.push({ harness, sourceId: source.id, url, version });
  }
}

/** Drift is REPORTED against `testedWith` and never written back: moving the
 *  band means re-running certification (docs/harness/adding-updating.md §6). */
function driftAgainstBand(deltas, harness, sourceId, version, band) {
  if (band === undefined) return;
  const latest = parseVersion(version);
  const tested = parseVersion(band.testedWith);
  if (latest === undefined || tested === undefined) return;
  const order = compareVersions(latest, tested);
  if (order === 0) return;
  const majorBump = latest.major !== tested.major;
  deltas.push(
    delta(
      order > 0 ? "version_drift" : "upstream_behind_tested",
      harness,
      majorBump ? "breaking" : "review",
      order > 0
        ? `${sourceId}: upstream ${version} is newer than tested-with ${band.testedWith}${majorBump ? " across a MAJOR boundary" : ""} — re-certification owed (docs/harness/adding-updating.md §6); this probe never moves the band`
        : `${sourceId}: upstream ${version} is OLDER than tested-with ${band.testedWith} — a yanked or rolled-back release, worth a human look`,
      null,
    ),
  );
}

function breakingSignal(deltas, harness, sourceId, notes) {
  const haystack = notes.toLowerCase();
  const hit = BREAKING_KEYWORDS.find((keyword) => haystack.includes(keyword));
  if (hit === undefined) return;
  deltas.push(
    delta(
      "breaking_change_signal",
      harness,
      "breaking",
      `${sourceId}: release notes mention "${hit}" — read them before any bump`,
      null,
    ),
  );
}

function digestDelta(context, harness, fact, kind, digest) {
  const { deltas } = context;
  const proposal = { path: ["harnesses", harness, kind, "source", "contentDigest"], value: digest };
  if (fact.source.contentDigest === null) {
    deltas.push(
      delta(
        `${kind}_source_first_observation`,
        harness,
        "info",
        `${kind} source ${fact.source.url} has never been observed by the probe; recording its digest`,
        proposal,
      ),
    );
    return;
  }
  if (fact.source.contentDigest !== digest) {
    deltas.push(
      delta(
        `${kind}_source_changed`,
        harness,
        "review",
        `${kind} source ${fact.source.url} changed since the committed figures were transcribed`,
        proposal,
      ),
    );
  }
}

function pricingDeltas(context, harness, entry) {
  const pricing = entry.pricing;
  if (pricing === null || pricing === undefined) return;
  const response = context.responses.get(pricing.source.url);
  if (response === undefined || response.ok !== true) {
    context.failures.push({
      harness,
      sourceId: `${harness}.pricing`,
      url: pricing.source.url,
      reason: response?.reason ?? "no response recorded",
    });
    return;
  }
  digestDelta(context, harness, pricing, "pricing", response.digest);
  const allDocIds = pricing.rows.flatMap((row) => row.docIds);
  if (allDocIds.length === 0) return;
  const observed = extractDocumentPrices(response.body, allDocIds, pricing.fields.length);
  for (const [index, row] of pricing.rows.entries()) {
    const readable = row.docIds.map((docId) => observed.get(docId)).find((figures) => Array.isArray(figures));
    if (readable === undefined) {
      if (row.docIds.length > 0 && row.docIds.some((docId) => observed.has(docId))) {
        context.deltas.push(
          delta(
            "price_unreadable",
            harness,
            "review",
            `${row.prefix}: the pricing page mentions it but its rate could not be read unambiguously — transcribe by hand`,
            null,
          ),
        );
      }
      continue;
    }
    const proposed = Object.fromEntries(pricing.fields.map((field, position) => [field, readable[position]]));
    const changed = pricing.fields.filter((field) => row.price[field] !== proposed[field]);
    if (changed.length === 0) continue;
    context.deltas.push(
      delta(
        "price_change",
        harness,
        "review",
        `${row.prefix}: ${changed.map((field) => `${field} ${row.price[field]} → ${proposed[field]}`).join(", ")}`,
        { path: ["harnesses", harness, "pricing", "rows", index, "price"], value: proposed },
      ),
    );
  }
}

function rosterDeltas(context, harness, entry) {
  const roster = entry.roster;
  if (roster === null || roster === undefined) return;
  const response = context.responses.get(roster.source.url);
  if (response === undefined || response.ok !== true) {
    context.failures.push({
      harness,
      sourceId: `${harness}.roster`,
      url: roster.source.url,
      reason: response?.reason ?? "no response recorded",
    });
    return;
  }
  digestDelta(context, harness, roster, "roster", response.digest);
  const published = extractRosterModels(response.body, roster.pattern);
  if (published.length === 0) {
    // Never read an empty parse as "the vendor retired every model": that is
    // exactly how a moved page would silently empty a roster.
    context.failures.push({
      harness,
      sourceId: `${harness}.roster`,
      url: roster.source.url,
      reason: `no model id matched /${roster.pattern}/ — the page moved or its shape changed`,
    });
    return;
  }
  const added = published.filter((model) => !roster.models.includes(model));
  const retired = roster.models.filter((model) => !published.includes(model));
  if (added.length === 0 && retired.length === 0) return;
  context.deltas.push(
    delta(
      added.length > 0 ? "new_model" : "retired_model",
      harness,
      "review",
      [
        added.length > 0 ? `new: ${added.join(", ")}` : "",
        retired.length > 0 ? `no longer published: ${retired.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("; "),
      { path: ["harnesses", harness, "roster", "models"], value: published },
    ),
  );
  if (retired.length > 0) {
    context.proposals.push(
      `${harness}: the vendor's roster page no longer lists ${retired.join(", ")}. ` +
        "If any is assigned in roles.yaml, that is a human-ratified change — this probe never edits ratified surfaces.",
    );
  }
  if (added.length > 0) {
    context.proposals.push(
      `${harness}: ${added.join(", ")} newly published. Assignment stays ratified + qualification-gated; ` +
        "publishing a roster never assigns a model to a role.",
    );
  }
}

function applyProposal(document, proposal) {
  let cursor = document;
  for (const step of proposal.path.slice(0, -1)) cursor = cursor[step];
  cursor[proposal.path.at(-1)] = proposal.value;
}

/**
 * The whole probe verdict. `responses` maps URL → `{ ok, body, digest, reason }`.
 * Returns the report plus the metadata document the pull request would carry.
 */
export function diffUpstream({ metadata, bands, responses, generatedAt, observedAt }) {
  const metadataHarnesses = Object.keys(metadata.harnesses).sort();
  const bandHarnesses = Object.keys(bands).sort();
  if (metadataHarnesses.join(",") !== bandHarnesses.join(",")) {
    throw new Error(
      `harness sets disagree: harness-metadata.json has [${metadataHarnesses}], harness-support.ts has [${bandHarnesses}]`,
    );
  }
  const context = {
    responses,
    deltas: [],
    failures: [],
    unautomated: [],
    proposals: [],
    observedAt,
    patch: { checked: [] },
  };
  for (const harness of metadataHarnesses) {
    const entry = metadata.harnesses[harness];
    versionDeltas(context, harness, entry, bands);
    pricingDeltas(context, harness, entry);
    rosterDeltas(context, harness, entry);
  }
  const proposed = structuredClone(metadata);
  const applied = context.deltas.filter((item) => item.proposal !== null);
  for (const item of applied) applyProposal(proposed, item.proposal);
  const status = context.failures.length > 0 ? "failed" : context.deltas.length > 0 ? "delta" : "fresh";
  return {
    report: {
      schemaVersion: REPORT_SCHEMA_VERSION,
      generatedAt,
      status,
      checked: context.patch.checked,
      unautomated: context.unautomated,
      failures: context.failures,
      deltas: context.deltas,
      proposals: context.proposals,
      metadataChanged: applied.length > 0,
    },
    metadata: proposed,
  };
}

const STATUS_HEADLINE = {
  fresh: "No upstream change detected.",
  delta: "Upstream change detected — review the delta below.",
  failed: "PROBE FAILED — at least one upstream source could not be read. This is not a freshness result.",
};

/** Human-readable delta summary; also the pull-request body. */
export function renderReport(report) {
  const lines = [
    `# Harness upstream freshness — ${report.status.toUpperCase()}`,
    "",
    STATUS_HEADLINE[report.status],
    "",
  ];
  if (report.failures.length > 0) {
    lines.push("## Unreadable sources (fail-closed)", "");
    for (const failure of report.failures) {
      lines.push(`- **${failure.harness}** \`${failure.sourceId}\` — ${failure.url}: ${failure.reason}`);
    }
    lines.push("");
  }
  if (report.deltas.length > 0) {
    lines.push("## Delta", "");
    for (const item of report.deltas) {
      const proposal = item.proposal === null ? "report only" : `metadata: \`${item.proposal.path.join(".")}\``;
      lines.push(`- \`${item.kind}\` **${item.harness}** [${item.severity}] — ${item.detail} _(${proposal})_`);
    }
    lines.push("");
  }
  if (report.proposals.length > 0) {
    lines.push("## Proposals for human decision (no file was edited)", "");
    for (const proposal of report.proposals) lines.push(`- ${proposal}`);
    lines.push("");
  }
  if (report.unautomated.length > 0) {
    lines.push("## Not automatically checkable", "");
    for (const item of report.unautomated) {
      lines.push(`- **${item.harness}** \`${item.sourceId}\` — ${item.reason}`);
    }
    lines.push("");
  }
  lines.push("## Sources read", "");
  for (const item of report.checked) lines.push(`- **${item.harness}** \`${item.sourceId}\` → ${item.version}`);
  lines.push(
    "",
    "---",
    "",
    "Generated by `scripts/harness-freshness.mjs` (#332). This automation never merges, never edits a",
    "human-ratified surface (`roles.yaml`, `TASTE.md`, `docs/PURPOSE.md`, `pipelines.yaml`, `prompts/**`),",
    "and never moves a `testedWith` band — a band moves only with a re-certification run",
    "(`docs/harness/adding-updating.md` §6).",
    "",
    `Report generated at ${report.generatedAt}.`,
  );
  return lines.join("\n");
}

/** 0 fresh · 3 delta · 1 probe failure. A failure never shares an exit code
 *  with "nothing changed". */
export function exitCodeFor(status) {
  return status === "fresh" ? 0 : status === "delta" ? 3 : 1;
}
