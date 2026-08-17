import { bulletBlocks, cleanTitle, logical, markdownSections } from "./review-fidelity-markdown.mjs";

export function journeyFacts(systemMapText, journeyAcceptanceText) {
  const rows = new Map();
  for (const line of systemMapText.split("\n")) {
    const match = line.match(/^\| (J-\d{2}) \| (.*?) \| (.*) \|$/);
    if (match && !rows.has(match[1])) rows.set(match[1], { title: cleanTitle(match[2]), meaning: logical(match[3]) });
  }
  const criteria = new Map(
    markdownSections(journeyAcceptanceText, /^## (J-\d{2})\s+(.+)$/, /^## /).map(({ match, text }) => [
      match[1],
      bulletBlocks(text),
    ]),
  );
  return [...rows]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, row]) => ({
      id,
      kind: "journey",
      title: row.title,
      meaning: row.meaning,
      acceptance_criteria: criteria.get(id) ?? [],
      owner: "bikramgupta",
      source_ids: ["SOURCE-SYSTEM-MAP", "SOURCE-CONTRACT-JOURNEY-ACCEPTANCE"],
    }));
}

export function boundaryFacts(boundaryMapText) {
  return markdownSections(boundaryMapText, /^### (B-\d{2}[a-z]?) — (.+)$/, /^(?:### B-|## )/).map(({ match, text }) => {
    const blocks = bulletBlocks(text);
    const failureModes = blocks.filter((block) =>
      /^\*\*(?:Failure modes(?: to script)?|Filesystem failure modes|Git failure modes|Preflight failure modes|Run\/report failure modes)/i.test(
        block,
      ),
    );
    let meaning = blocks.filter((block) => !failureModes.includes(block)).join(" ");
    return { id: match[1].toUpperCase(), title: cleanTitle(match[2]), meaning, failure_modes: failureModes };
  });
}

export function ticketFacts(backlogMarkdown) {
  const matches = [...backlogMarkdown.matchAll(/\*\*(HB-(?:P\d+|\d+))\b/g)];
  const facts = new Map();
  for (let index = 0; index < matches.length; index += 1) {
    const start = matches[index].index ?? 0;
    const candidateEnd = matches[index + 1]?.index ?? backlogMarkdown.length;
    const headingEnd = backlogMarkdown.indexOf("**", start + 2);
    const sectionEnd = backlogMarkdown.slice(start, candidateEnd).search(/\n#{2,6} /);
    const end = sectionEnd < 0 ? candidateEnd : start + sectionEnd;
    let body = backlogMarkdown.slice(headingEnd + 2, end);
    const id = matches[index][1];
    if (id === "HB-002")
      body = body.replace(
        "text at validation-policy.yaml → harness_self_tests",
        "represented by checked-model controls and each family's negative-control links; field disposition recorded in `research/2026-08-16_validation-authority-domain-split.md`",
      );
    if (id === "HB-040")
      body = body.replace(
        /F-PT-006\s+clauses were parked at this snapshot, then unparked and implemented under\s+HB-P3 on 2026-08-12/,
        "F-PT-006 clauses were originally parked, then unblocked and landed under HB-P3 on 2026-08-12: content-derived identity and no producer atomicity obligation",
      );
    if (id === "HB-012")
      body = body.replace(
        /F-PT-008\s+clause was parked until it was unparked and implemented under HB-P5 on\s+2026-08-12/,
        "F-PT-008 was ratified and implemented under HB-P5 on 2026-08-12: an expired grant reopens the original item under its original id, appends rather than edits decision history, resolves grant TTL through org policy (48h default), and leaves the pending-item TTL independently pinned at 24h",
      );
    if (id === "HB-133")
      body =
        "rev-2026-08-10 [simulated] AI stakeholder-seat interpretation, implemented conservatively with a swappable unit and pending attributable human ratification. " +
        body;
    if (id === "HB-124")
      body = body
        .replace(
          "the table is read from `verdict_semantics.axis_score`",
          "the table is read from `docs/qualification/host-policy.yaml` → `outcome_acceptance.axis_score`",
        )
        .replace(
          "`validation-policy.yaml` `verdict_semantics.axis_score`",
          "`docs/qualification/host-policy.yaml` → `outcome_acceptance.axis_score`",
        );
    if (id === "HB-135")
      body = body.replace(
        /\*\*The ratified\s+classification rule is reproduced in full at `validation-policy\.yaml` →\s+`open_findings` → F-PT-019 → `resolution`, so this ticket is implementable from\s+the design corpus alone\.\*\*/,
        "**The ratified classification rule is reproduced in full in this ticket; current status and provenance live in `docs/PURPOSE.md` and `validation-design/harness-design-state.md`, while CF-SPLIT-SECRETS and CF-REG-204 bind the machine obligations.**",
      );
    if (id === "HB-140")
      body =
        "Checked-model compiler regeneration drift gate. The exact eight checked YAML sources are sole Validation Architect authority; the exact pinned public compiler regenerates five Markdown views plus compiler-report.json, and scripts/check-catalog-drift.mjs refuses missing, partial, stale, symlinked, or identity-mismatched artifacts. Acceptance: tests/policy/cf-harness-ci/catalog-drift.test.ts proves those seeded failures red and exact regeneration green in the per-commit lane. Family: CF-HARNESS-CI. Layer: 1 + CI. Executor: build-agent. Landed 2026-08-12; the final authority-cutover representation supersedes the retired AWK/YAML mechanism without changing the drift obligation.";
    body = body.replaceAll("tests/unit/s3-verdict-marker.test.ts", "tests/unit/cf-inv-012/s3-verdict-marker.test.ts");
    const fact = logical(body)
      .replace(/^[-—.:\s]+/, "")
      .replace(/\s+-$/, "");
    const existing = facts.get(id);
    if (!existing) facts.set(id, fact);
    else {
      const acceptance = fact.match(/\*Acceptance:\*[\s\S]*$/)?.[0];
      if (acceptance && !existing.includes(acceptance))
        facts.set(id, `${existing} Original acceptance facts: ${acceptance}`);
    }
  }
  return facts;
}

export function sourceTicketDependencies(backlogMarkdown) {
  const matches = [...backlogMarkdown.matchAll(/\*\*(HB-(?:P\d+|\d+))\b/g)];
  const relations = [];
  for (let index = 0; index < matches.length; index += 1) {
    const start = matches[index].index ?? 0;
    const end = matches[index + 1]?.index ?? backlogMarkdown.length;
    const section = backlogMarkdown.slice(start, end);
    const sourceFact =
      section.match(/\*Depends on:\*\s*([\s\S]*?)\.(?:\s|$)/)?.[1] ??
      (matches[index][1] === "HB-094" ? section.match(/\b(After HB-090…093),/)?.[1] : undefined);
    if (!sourceFact) continue;
    const dependencyTicketIds = [];
    for (const match of logical(sourceFact).matchAll(/HB-(\d+)(?:…(\d+))?((?:\/\d+)*)/g)) {
      const first = Number(match[1]);
      const last = Number(match[2] ?? match[1]);
      const width = match[1].length;
      for (let value = first; value <= last; value += 1)
        dependencyTicketIds.push(`HB-${String(value).padStart(width, "0")}`);
      for (const value of match[3].split("/").filter(Boolean))
        dependencyTicketIds.push(`HB-${value.padStart(width, "0")}`);
    }
    relations.push({
      legacy_ticket_id: matches[index][1],
      source_fact: logical(sourceFact),
      dependency_ticket_ids: [...new Set(dependencyTicketIds)],
    });
  }
  return relations;
}
