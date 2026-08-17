import {
  bulletBlocks,
  cleanTitle,
  familyClause,
  firstClause,
  logical,
  markdownSections,
  paragraphs,
  sectionFacts,
} from "./review-fidelity-markdown.mjs";

const interfaceRows = new Map([
  ["INTERFACE-CLI", "CLI (per subcommand)"],
  ["INTERFACE-JSON", "`--json` machine surfaces"],
  ["INTERFACE-UI", "Live UI (HTTP snapshot + SSE)"],
  ["INTERFACE-HTML", "Portable HTML report"],
  ["INTERFACE-GITHUB", "GitHub"],
  ["INTERFACE-EVENT-INBOX", "File-drop event inbox"],
  ["INTERFACE-OS-TIMER", "OS timer"],
  ["INTERFACE-SKILL", "Agent Skill (`$cormidia`) + `capabilities --json`"],
  ["INTERFACE-COMPARISON", "Standalone `cormidia compare` (proposed)"],
  ["INTERFACE-JOB", "`cormidia-job` CLI (second binary) + Agent Skill (`$cormidia-job`)"],
]);
const expectedInterfaces = [...interfaceRows.keys(), "INTERFACE-CROSS-SURFACE"];
const expectedOperations = [
  "OP-HARNESS",
  "OP-VALIDATION-LIFECYCLE",
  "OP-REGRESSION",
  "OP-CONTENTION",
  "OP-SOAK",
  "OP-ROTATION",
  "OP-ABUSE",
  "OP-OUTCOME-ACCEPTANCE",
  "OP-LLM-CONDITIONING",
  "OP-CONSEQUENCE-SPLIT",
  "OP-REVIEW-INDEPENDENCE",
];
const expectedStateMachines = [
  "APPR",
  "GRANT",
  "PLAN",
  "LADDER",
  "LEARN",
  "EVENT",
  "TURN",
  "COMP",
  "ROADMAP",
  "VALIDATION",
  "BATCH",
  "ACC",
  "JOB",
  "LOOP",
].map((id) => `SM-${id}`);
const expectedLlmSites = Array.from({ length: 11 }, (_, index) => `S-${index + 1}`);
const expectedContracts = [
  ...Array.from({ length: 8 }, (_, index) => `CONTRACT-B-${String(index + 1).padStart(2, "0")}`),
  "CONTRACT-B-09A",
  "CONTRACT-B-09B",
  ...Array.from({ length: 22 }, (_, index) => `CONTRACT-B-${String(index + 10).padStart(2, "0")}`),
  "CONTRACT-OP-BATCHING",
  "CONTRACT-OP-LIFECYCLE",
  "CONTRACT-OP-LOOP",
  "CONTRACT-OP-PLANNING",
  "CONTRACT-OP-VALIDATION-LIFECYCLE",
  "CONTRACT-JOURNEY-ACCEPTANCE",
  "CONTRACT-PROVIDER-CORE",
];

export const structureFidelity = {
  expectedContracts,
  expectedInterfaces,
  expectedLlmSites,
  expectedOperations,
  expectedStateMachines,
  unresolvedPathMeaning:
    "Implementation path mapping is unresolved, so no bounded subset is claimable and changed_paths stays empty rather than inventing paths. Deterministic discovery procedure: (1) describe the changed behavior and read the changed source; (2) match every relevant structure by its meaning and source_ids, resolving those source IDs in planned-trace.md; (3) traverse each matched structure → family → control → ticket through case-catalog.md and harness-backlog.md; (4) inspect the family's planned_tests or evidence path plus its cited source paths to locate the implementation and detector seams. Those inspection paths are discovery evidence, not invented changed_paths. If zero, multiple, or unresolved mappings remain, retain every semantic match and claim no bounded subset. If the traversal cannot resolve at least one owning family/control/ticket chain, do not select a ticket or guess a model edit: record the mapping gap as an F-PT finding in the authored harness-design-state register, keep the affected work blocked, and proceed only with structure-independent work. The exact safe operator action is therefore semantic traversal followed by either the resolved chain or refusal plus that finding—not intuition. Until implementation-path mappings are ratified, every changed product path widens planning to the authoritative full offline suite: run `pnpm test`, `pnpm validation:trace`, `pnpm check`, and `pnpm build`; L3-L6 live, eval, soak, and L-ACC lanes additionally run only when their declared trigger applies and an exact reviewed configuration plus per-run human authorization exist.",
  genericMeaning:
    /(?:complete ratified (?:contract|[^.]+ obligation)|recorded in the legacy|legacy [A-Z]+ state-machine family|remain testable exactly as written|this model does not rename or reinterpret)/i,
};

function contractPreambleFacts(text, hasSections) {
  const beforeFirstSection = text.split(/\n## /)[0] ?? "";
  const withoutTitle = beforeFirstSection.replace(/^# [^\n]+\n?/, "");
  const prose = hasSections ? withoutTitle : (withoutTitle.split(/\n- /)[0] ?? "");
  return paragraphs(prose);
}

export function contractFacts(text, providerCoreText = "") {
  const title = cleanTitle(text.match(/^# (.+)$/m)?.[1] ?? "Contract");
  const sections = sectionFacts(text);
  const preamble = contractPreambleFacts(text, sections.length > 0);
  const deltas = sections.length ? [] : bulletBlocks(text);
  const providerSections = sectionFacts(providerCoreText);
  const providerPreamble = contractPreambleFacts(providerCoreText, providerSections.length > 0);
  const criteria = sections.length
    ? [...preamble.map((fact) => `Contract preamble: ${fact}`), ...sections.map((item) => item.fact)]
    : [
        ...providerPreamble.map((fact) => `Shared provider core preamble: ${fact}`),
        ...providerSections.map((item) => `Shared provider core — ${item.fact}`),
        ...preamble.map((fact) => `Adapter preamble: ${fact}`),
        ...deltas.map((item) => `Adapter-specific clause — ${item}`),
      ];
  const primary = sections.length ? firstClause(sections[0].body) : deltas[0];
  return {
    title,
    meaning: `${title}: ${primary}`,
    acceptance_criteria: criteria,
    inherits_provider_core: !sections.length,
  };
}

export function interfaceFacts(systemMapText, families) {
  const section = markdownSections(systemMapText, /^### 1\.4 Entry and observation surfaces/, /^## /)[0]?.text ?? "";
  const rows = new Map(
    section
      .split("\n")
      .filter((line) => /^\|.+\|$/.test(line))
      .map((line) => line.split("|").slice(1, -1).map(logical))
      .filter((cells) => cells.length === 3 && cells[0] !== "Surface" && !/^---/.test(cells[0]))
      .map((cells) => [cells[0], { kind: cells[1], obligations: cells[2] }]),
  );
  const result = new Map();
  for (const [id, surface] of interfaceRows) {
    const row = rows.get(surface);
    if (row)
      result.set(id, {
        title: surface,
        meaning: `${surface} is a ${row.kind} surface. ${row.obligations}`,
        acceptance_criteria: [`Surface role: ${row.kind}.`, `Adapter obligations: ${row.obligations}`],
      });
  }
  const crossIds = ["INTERFACE-CLI", "INTERFACE-JSON", "INTERFACE-UI", "INTERFACE-HTML"];
  result.set("INTERFACE-CROSS-SURFACE", {
    title: "Cross-surface agreement",
    meaning: familyClause(families["CF-IF-XSURF"].meaning),
    acceptance_criteria: crossIds.map((id) => `${id}: ${result.get(id)?.meaning}`),
  });
  return result;
}

export function llmSiteFacts(llmEvalText) {
  const matches = [...llmEvalText.matchAll(/^### (S-\d+) ([\s\S]*?)(?=\n- )/gm)];
  return matches.map((match, index) => {
    const bodyStart = (match.index ?? 0) + match[0].length + 1;
    const nextSite = matches[index + 1]?.index ?? llmEvalText.length;
    const nextSection = llmEvalText.indexOf("\n## ", bodyStart);
    const bodyEnd = nextSection >= 0 && nextSection < nextSite ? nextSection : nextSite;
    const acceptanceCriteria = bulletBlocks(llmEvalText.slice(bodyStart, bodyEnd));
    return {
      id: match[1],
      title: cleanTitle(logical(`${match[1]} ${match[2]}`)),
      meaning: acceptanceCriteria.join(" "),
      acceptance_criteria: acceptanceCriteria,
    };
  });
}

export function operationFacts(sourceTexts, families) {
  const source = (id) => sourceTexts[id] ?? "";
  const currentRouting =
    markdownSections(source("SOURCE-ROUTING"), /^## Current checked-model procedure/, /^## /)[0]?.text ?? "";
  const routing = sectionFacts(currentRouting, /^### (.+)$/, /^### /);
  const route = (heading) => routing.find((item) => item.heading === heading);
  const risk = bulletBlocks(
    markdownSections(source("SOURCE-RISK"), /^## 6\. Future Layer-5 assurance outside RQ-1/, /^## /)[0]?.text ?? "",
  );
  const qualification = paragraphs(source("SOURCE-QUALIFICATION-DESIGN"));
  const validation = sectionFacts(source("SOURCE-CONTRACT-OP-VALIDATION-LIFECYCLE"));
  const rubric = sectionFacts(source("SOURCE-ACCEPTANCE-RUBRIC")).filter((item) => /^(?:[1-7]|9)\./.test(item.heading));
  const llm = sectionFacts(source("SOURCE-LLM-EVAL")).filter((item) =>
    /^(?:0\. Standing rules|4\. Model-swap procedure|9\. Decision-status rule)/.test(item.heading),
  );
  const consequence =
    markdownSections(source("SOURCE-APPROVALS-DESIGN"), /^### Who may decide$/, /^### /)[0]?.text ?? "";
  const roles = source("SOURCE-ROLES");
  const builder = roles.match(/\n  builder:\n([\s\S]*?)(?=\n  reviewer:)/)?.[0] ?? "";
  const reviewer = roles.match(/\n  reviewer:\n([\s\S]*?)(?=\n  [a-z][a-z-]+:)/)?.[0] ?? "";
  const reviewIndependence = familyClause(families["CF-REVIEW-PROVIDER"].meaning).replace(
    "rev-2026-08-10 owner ruling:",
    "rev-2026-08-10 AI stakeholder-seat interpretation, implemented provisionally and pending attributable human ratification:",
  );
  const selectRisk = (patterns) => risk.filter((block) => patterns.some((pattern) => pattern.test(block)));
  const harnessProcedure = routing.flatMap((item) => {
    if (item.heading === "Before any ticket")
      return [
        "Before any ticket — model sentinel command from validation-design/: `test -f model/project.yaml && test -f model/owners.yaml && test -f model/sources.yaml && test -f model/structures.yaml && test -f model/policy.yaml && test -f model/controls.yaml && test -f model/families.yaml && test -f model/backlog.yaml`.",
        "Before any ticket — separate blocker scan command from validation-design/: `rg -n 'BLOCKED:|PARKED:|Gate:|status: (blocked|parked)' model harness-design-state.md`.",
        "Before any ticket — after both commands succeed, read the matching ticket, every owned family, every negative control, and linked structures/sources; generated views are navigation only.",
      ];
    if (item.heading === "Regenerate and verify")
      return [
        "Regenerate command 1 from the repository root: `pnpm exec validation-architect compile . --write`.",
        "Verify command 2, separately and only after command 1 succeeds: `pnpm validation:trace`.",
        "Then run the repository-required tests for the change; never weaken a test or gate to obtain green.",
      ];
    return [item.fact];
  });
  const facts = new Map([
    ["OP-HARNESS", { meaning: route("Authority")?.fact, acceptance_criteria: harnessProcedure }],
    [
      "OP-VALIDATION-LIFECYCLE",
      {
        meaning: `${validation[0]?.heading}: ${firstClause(validation[0]?.body ?? "")}`,
        acceptance_criteria: validation.map((item) => item.fact),
        source_ids: ["SOURCE-CONTRACT-OP-VALIDATION-LIFECYCLE"],
      },
    ],
    [
      "OP-REGRESSION",
      {
        meaning: `Bug fixes: ${firstClause(route("Bug fixes")?.body ?? "")}`,
        acceptance_criteria: [route("Bug fixes")?.fact],
      },
    ],
  ]);
  for (const [id, patterns] of [
    ["OP-CONTENTION", [/^\*\*Contention exercise/, /^\*\*2026-08-03 revision trigger/]],
    [
      "OP-SOAK",
      [/^\*\*Soak /, /^\*\*Retention boundaries/, /^\*\*Soak repeat trigger/, /^\*\*2026-08-03 revision trigger/],
    ],
  ]) {
    const clauses = selectRisk(patterns);
    facts.set(id, { meaning: clauses[0], acceptance_criteria: clauses });
  }
  const rotation = qualification.find((item) => item.includes("CF-OPS-ROT"));
  const abuse = qualification.find((item) => item.includes("HB-072 remains future human work"));
  facts.set("OP-ROTATION", {
    meaning: rotation,
    acceptance_criteria: [rotation],
    source_ids: ["SOURCE-QUALIFICATION-DESIGN"],
  });
  facts.set("OP-ABUSE", { meaning: abuse, acceptance_criteria: [abuse], source_ids: ["SOURCE-QUALIFICATION-DESIGN"] });
  facts.set("OP-OUTCOME-ACCEPTANCE", {
    meaning: `${rubric[0]?.heading}: ${firstClause(rubric[0]?.body ?? "")}`,
    acceptance_criteria: rubric.map((item) => item.fact),
  });
  facts.set("OP-LLM-CONDITIONING", {
    meaning: `${llm[0]?.heading}: ${firstClause(llm[0]?.body ?? "")}`,
    acceptance_criteria: llm.map((item) => item.fact),
  });
  facts.set("OP-CONSEQUENCE-SPLIT", {
    meaning: firstClause(consequence),
    acceptance_criteria: [`Who may decide: ${logical(consequence)}`],
  });
  facts.set("OP-REVIEW-INDEPENDENCE", {
    meaning: reviewIndependence,
    acceptance_criteria: [
      `Builder seat: ${logical(builder)}`,
      `Reviewer seat: ${logical(reviewer)}`,
      `Enforcement: ${reviewIndependence}`,
    ],
    source_ids: ["SOURCE-ROLES"],
  });
  return facts;
}

export function stateMachineFacts(structureId, families) {
  const prefix = `CF-${structureId}-`;
  const labels = { L: "Legal", I: "Illegal", R: "Replay", C: "Interruption/recovery" };
  const criteria = Object.entries(labels)
    .map(([suffix, label]) =>
      families[`${prefix}${suffix}`] ? `${label}: ${familyClause(families[`${prefix}${suffix}`].meaning)}` : "",
    )
    .filter(Boolean);
  return { meaning: criteria[0]?.replace(/^Legal:\s*/, ""), acceptance_criteria: [...new Set(criteria)] };
}
