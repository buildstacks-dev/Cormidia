import { isDeepStrictEqual } from "node:util";

import { MIGRATION, sha256 } from "./migration-contract.mjs";
import { hasImplementationPath } from "./migration-model-equivalence.mjs";
import { structureFidelity } from "./review-fidelity-extract.mjs";

export const READER_ROLES = Object.freeze(["production operator", "new engineer", "coding agent"]);
const unresolvedRouteNotice = structureFidelity.unresolvedPathMeaning;

function sameSet(left, right) {
  return isDeepStrictEqual([...left].sort(), [...right].sort());
}

function splitMarkdownRow(line) {
  const cells = [];
  let cell = "";
  const content = line.slice(1, -1);
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (character === "\\" && content[index + 1] === "|") {
      cell += "|";
      index += 1;
    } else if (character === "|") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += character;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function flattened(value) {
  if (value === undefined) return "—";
  return value.replace(/\r?\n/g, " ").trim();
}

function flattenedList(value) {
  if (!Array.isArray(value) || value.length === 0) return "—";
  return value.map((item) => flattened(item)).join(", ");
}

function tableSection(trace, heading) {
  const lines = trace.split("\n");
  const start = lines.findIndex((line) => line === heading);
  if (start < 0) return null;
  const relativeEnd = lines.slice(start + 1).findIndex((line) => line.startsWith("## "));
  const end = relativeEnd < 0 ? lines.length : start + 1 + relativeEnd;
  return lines.slice(start + 1, end);
}

function structureRegistryProblems(model, trace) {
  const problems = [];
  const section = tableSection(trace, "## Product structure routing");
  if (section === null) return ["planned trace lacks product structure routing"];
  const header =
    "| Structure | Kind | Protected meaning | Acceptance criteria | Failure modes | Changed paths | Provenance | Owner |";
  const divider = "| --- | --- | --- | --- | --- | --- | --- | --- |";
  if (!section.includes(header) || !section.includes(divider)) {
    problems.push("product structure routing lacks the complete eight-column header");
  }
  const rows = new Map();
  for (const line of section) {
    if (!line.startsWith("|") || /^\|\s*(?:Structure|---)/.test(line)) continue;
    const cells = splitMarkdownRow(line);
    if (cells.length !== 8) {
      problems.push(`malformed product structure routing row: ${line}`);
      continue;
    }
    if (rows.has(cells[0])) problems.push(`duplicate product structure routing row ${cells[0]}`);
    rows.set(cells[0], cells);
  }
  if (
    !sameSet(
      rows.keys(),
      model.structures.map((structure) => structure.id),
    )
  ) {
    problems.push("product structure routing IDs differ from the complete model structure set");
  }
  for (const structure of model.structures) {
    const row = rows.get(structure.id);
    if (!row) continue;
    const expected = [
      structure.id,
      structure.kind,
      flattened(structure.meaning),
      flattenedList(structure.acceptance_criteria),
      flattenedList(structure.failure_modes),
      flattenedList(structure.changed_paths),
      flattenedList(structure.source_ids),
      structure.owner,
    ];
    if (!isDeepStrictEqual(row, expected)) problems.push(`${structure.id} product structure routing fields drift`);
  }
  return problems;
}

function provenanceRegistryProblems(model, trace) {
  const problems = [];
  const heading = "## Provenance registry";
  const section = tableSection(trace, heading);
  if (section === null) return ["planned trace lacks a provenance registry"];
  const header = "| Source | Kind | Path | Locator | Quote |";
  const divider = "| --- | --- | --- | --- | --- |";
  if (!section.includes(header) || !section.includes(divider)) {
    problems.push("provenance registry lacks the complete five-column header");
  }
  const rows = new Map();
  const rowOrder = [];
  for (const line of section) {
    if (!line.startsWith("|") || /^\|\s*(?:Source|---)/.test(line)) continue;
    const cells = splitMarkdownRow(line);
    if (cells.length !== 5) {
      problems.push(`malformed provenance registry row: ${line}`);
      continue;
    }
    const id = cells[0];
    if (rows.has(id)) problems.push(`duplicate provenance registry source ${id}`);
    rows.set(id, cells);
    rowOrder.push(id);
  }
  if (
    !sameSet(
      rows.keys(),
      model.sources.map((source) => source.id),
    )
  ) {
    problems.push("provenance registry source IDs differ from the complete model source set");
  }
  if (!isDeepStrictEqual(rowOrder, model.sources.map((source) => source.id).sort())) {
    problems.push("provenance registry is not byte-stably sorted by source ID");
  }
  for (const source of model.sources) {
    const row = rows.get(source.id);
    if (!row) continue;
    const expected = [
      source.id,
      source.kind,
      flattened(source.path),
      flattened(source.locator),
      flattened(source.quote),
    ];
    if (!isDeepStrictEqual(row, expected)) problems.push(`${source.id} provenance registry fields drift`);
  }
  return problems;
}

export function generatedArtifactProblems(compilation, views, reportText) {
  const problems = [];
  if (!sameSet(Object.keys(compilation.views), MIGRATION.viewNames)) {
    problems.push("compiler returned a generated-view set other than the exact five views");
  }
  for (const name of MIGRATION.viewNames) {
    if (views[`validation-design/${name}`] !== compilation.views[name]) problems.push(`${name} is missing or stale`);
  }
  if (reportText !== compilation.report.content) problems.push("compiler-report.json is missing or stale");
  return problems;
}

export function freshReaderProblems(model, views) {
  const problems = [];
  const backlog = views["validation-design/harness-backlog.md"];
  const trace = views["validation-design/planned-trace.md"];
  problems.push(...structureRegistryProblems(model, trace));
  problems.push(...provenanceRegistryProblems(model, trace));
  if (backlog.includes("migration/legacy") || backlog.includes("Satisfy the complete HB-")) {
    problems.push("generated backlog delegates acceptance to migration history");
  }
  if (trace.includes("The complete ratified") && trace.includes("validation-design/")) {
    problems.push("planned trace contains authored-document pointer placeholders");
  }
  const journeyIds = model.structures
    .filter((structure) => structure.kind === "journey")
    .map((structure) => structure.id);
  const expectedJourneys = Array.from({ length: 23 }, (_, index) => `J-${String(index + 1).padStart(2, "0")}`);
  if (!sameSet(journeyIds, expectedJourneys)) problems.push("journey structure inventory is not exactly J-01..J-23");
  for (const family of model.families.filter((candidate) => /^CF-J\d{2}-/.test(candidate.id))) {
    const journey = `J-${family.id.slice(4, 6)}`;
    if (!family.structure_ids.includes(journey)) problems.push(`${family.id} does not link ${journey}`);
  }
  const gaps = model.structures.filter((structure) => !hasImplementationPath(structure));
  for (const structure of gaps) {
    if (!structure.meaning.includes(unresolvedRouteNotice)) {
      problems.push(`${structure.id} omits its unresolved implementation-path/full-suite disposition`);
    }
  }
  if (gaps.length > 0 && !trace.includes(unresolvedRouteNotice)) {
    problems.push("fresh-reader trace hides unresolved implementation-path/full-suite widening");
  }
  for (const [id, status] of [
    ["HB-155", "landed"],
    ["HB-155-L2", "landed"],
    ["HB-155-L3", "blocked"],
  ]) {
    const ticket = model.tickets.find((candidate) => candidate.id === id);
    if (ticket?.status !== status) problems.push(`${id} must be ${status}`);
    if (["pending", "blocked"].includes(status) && ticket?.title.includes("LANDED"))
      problems.push(`${id} incomplete title claims LANDED`);
  }
  return problems;
}

function exactKeys(value, expected) {
  return isDeepStrictEqual(Object.keys(value).sort(), [...expected].sort());
}

export function readerReviewProblems(record, bundleText, modelIdentity) {
  if (record === null) {
    return [
      "reader-reviews.yaml is pending: review the exact reader-bundle SHA as production operator, new engineer, and coding agent",
    ];
  }
  const problems = [];
  if (typeof record !== "object" || Array.isArray(record)) return ["reader review record root must be an object"];
  if (!exactKeys(record, ["schema", "bundle_sha256", "model_identity", "reviews"])) {
    problems.push("reader review record has missing or unknown root fields");
  }
  if (record.schema !== "cormidia/validation-architect-reader-reviews/v1") {
    problems.push("reader review record schema drift");
  }
  if (typeof record.bundle_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(record.bundle_sha256)) {
    problems.push("reader review bundle identity must be lowercase SHA-256");
  }
  if (typeof record.model_identity !== "string" || !/^[a-f0-9]{64}$/.test(record.model_identity)) {
    problems.push("reader review model identity must be lowercase SHA-256");
  }
  if (record.bundle_sha256 !== sha256(bundleText)) problems.push("reader reviews do not bind the exact bundle bytes");
  if (record.model_identity !== modelIdentity) problems.push("reader reviews do not bind the exact model identity");
  if (!Array.isArray(record.reviews)) return [...problems, "reader review record lacks reviews"];
  const roles = record.reviews.map((review) => review?.role);
  if (roles.length !== new Set(roles).size || !sameSet(roles, READER_ROLES)) {
    problems.push("reader review record does not contain each required role exactly once");
  }
  for (const review of record.reviews) {
    if (review === null || typeof review !== "object" || Array.isArray(review)) {
      problems.push("reader review row must be an object");
      continue;
    }
    if (!exactKeys(review, ["role", "reviewer", "verdict", "findings"])) {
      problems.push(`${String(review.role)} reader review has missing or unknown fields`);
    }
    if (!READER_ROLES.includes(review.role)) problems.push(`${String(review.role)} is not a recognized reader role`);
    if (typeof review.reviewer !== "string" || review.reviewer.trim() === "") {
      problems.push(`${String(review.role)} reader review lacks reviewer identity`);
    }
    if (review.verdict !== "pass") problems.push(`${String(review.role)} reader verdict is not pass`);
    if (!Array.isArray(review.findings) || !review.findings.every((finding) => typeof finding === "string")) {
      problems.push(`${String(review.role)} reader findings must be a string array`);
    } else if (review.findings.length !== 0) {
      problems.push(`${String(review.role)} reader review retains unresolved findings`);
    }
  }
  return problems;
}
