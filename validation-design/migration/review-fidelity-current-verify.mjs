const structure = (review, id) => review.structures.find((candidate) => candidate.id === id);
const ticketText = (review, legacyId, outputId = legacyId) =>
  review.ticket_reviews[legacyId]?.outputs?.find((output) => output.id === outputId)?.acceptance_criteria?.join(" ") ??
  "";

function fpt006Problems(review) {
  const problems = [];
  const boundary = structure(review, "B-13");
  const boundaryText = boundary?.meaning.toLowerCase() ?? "";
  if (
    !boundary ||
    ![
      "f-pt-006",
      "resolved",
      "content-derived",
      "canonical sorted-key",
      "raw validated producer payload",
      "top-level transport `filename`",
      "top-level producer `id`",
      "nested `id` and unknown fields",
      "delivered as provenance",
      "any other payload difference",
      "malformed_company_event",
      "re-read and fired",
      "legacy filename",
      "id-inclusive bare/per-role marks",
      "admission/recovery-only",
      "no atomic rename",
    ].every((token) => boundaryText.includes(token)) ||
    /open product truth\s*[—:-]\s*f-pt-006|producer visibility (?:protocol )?is (?:unspecified|unknown)/.test(
      boundaryText,
    )
  )
    problems.push("B-13 does not preserve the resolved F-PT-006 content-identity/no-atomicity contract");

  const contractText = JSON.stringify(structure(review, "CONTRACT-B-13")).toLowerCase();
  if (
    ![
      "removing only the top-level transport `filename` and top-level producer `id`",
      "nested `id` and unknown fields",
      "schema-required and is delivered as provenance",
      "exactly one firing occurs per event identity",
      "pre-clarification id-inclusive bare content key",
      "pre-clarification per-role content mark",
      "admission/recovery-only",
    ].every((token) => contractText.includes(token)) ||
    /after removing only the transport filename|producer `id` field remains ordinary payload content/.test(contractText)
  )
    problems.push("CONTRACT-B-13 does not preserve exact clarified identity and suppressive migration semantics");

  const hb040 = ticketText(review, "HB-040");
  if (
    !["HB-P3", "landed", "content-derived", "no producer atomicity"].every((token) =>
      hb040.toLowerCase().includes(token.toLowerCase()),
    ) ||
    /F-PT-006 clauses parked[).]/.test(hb040)
  )
    problems.push("HB-040 does not preserve the resolved F-PT-006 ticket disposition");
  return problems;
}

function ticketAndDecisionProblems(review) {
  const problems = [];
  const hb012 = ticketText(review, "HB-012");
  if (
    ![
      "HB-P5",
      "ratified and implemented",
      "original item under its original id",
      "appends rather than edits decision history",
      "org policy (48h default)",
      "pending-item TTL independently pinned at 24h",
    ].every((token) => hb012.includes(token)) ||
    /F-PT-008 clause parked[).]/.test(hb012)
  )
    problems.push("HB-012 does not preserve the resolved F-PT-008 ticket disposition");

  const fpt033 = review.sources.find((source) => source.id === "SOURCE-PROPOSED-FPT-033");
  if (
    fpt033?.kind !== "proposed" ||
    ![
      "Existing [doc] facts",
      "not reopened",
      "duplicate-identical operative markers",
      "Verdict-before-Status precedence",
      "bare-line marker form",
      "parser and pinned-regression changes red-then-green",
      "no new test may turn either reading into contract truth",
    ].every((token) => fpt033.locator?.includes(token))
  )
    problems.push("F-PT-033 owner decision source is not actionable");

  const provider = review.sources.find((source) => source.id === "SOURCE-SIMULATED-REVIEW-INDEPENDENCE");
  if (
    provider?.kind !== "simulated" ||
    ![
      "Human YES/NO required",
      "provider FAMILY",
      "same or unresolvable family refuses before provider construction",
      "distinct adapters sharing one upstream family count as the same family",
      "jobs and manual-only routes are exempt",
      "F-PT-038's separately ratified no-policy fail-close rule is not reopened",
    ].every((token) => provider.locator?.includes(token)) ||
    JSON.stringify(structure(review, "OP-REVIEW-INDEPENDENCE")).includes("owner ruling:")
  )
    problems.push("provider-family owner decision source or provisional posture is not actionable");

  const hb133 = ticketText(review, "HB-133");
  if (
    !["[simulated]", "implemented conservatively", "swappable unit", "pending attributable human ratification"].every(
      (token) => hb133.includes(token),
    ) ||
    hb133.includes("owner ruling:")
  )
    problems.push("HB-133 does not preserve the provisional provider-family disposition");
  return problems;
}

function compilerRepresentationProblems(review) {
  const problems = [];
  const hb140 = review.ticket_reviews["HB-P7"]?.outputs?.find((output) => output.id === "HB-140");
  const text = hb140?.acceptance_criteria?.join(" ") ?? "";
  if (
    hb140?.status !== "landed" ||
    !["eight checked YAML", "five Markdown views", "compiler-report.json", "scripts/check-catalog-drift.mjs"].every(
      (token) => text.includes(token),
    ) ||
    /case-catalog-generator\.awk|hand-edit to `case-catalog\.yaml`/.test(text) ||
    JSON.stringify(review).includes("validation-architect-045-contract.test.ts") ||
    !JSON.stringify(review).includes("validation-architect-046-contract.test.ts")
  )
    problems.push("HB-140 does not preserve the checked-model compiler drift representation");
  return problems;
}

export function currentFactProblems(review) {
  return [...fpt006Problems(review), ...ticketAndDecisionProblems(review), ...compilerRepresentationProblems(review)];
}
