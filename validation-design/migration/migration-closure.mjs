import { isDeepStrictEqual } from "node:util";

import { SPEC_SUFFIXES } from "validation-architect";

function sameSet(left, right) {
  return isDeepStrictEqual([...left].sort(), [...right].sort());
}

function exactPartialProblems(graph, code, expectedSubjects) {
  const problems = [];
  const findings = graph.findings.filter((finding) => finding.code === code);
  const subjects = findings.map((finding) => finding.subject_id);
  if (subjects.length !== new Set(subjects).size || !sameSet(subjects, expectedSubjects)) {
    problems.push(`${code} subjects differ from the exact model-derived set`);
  }
  if (findings.some((finding) => finding.level !== "partial")) {
    problems.push(`${code} contains a non-partial finding`);
  }
  return problems;
}

function structuralEvidenceProblems(graph, factFiles) {
  const problems = [];
  const nodes = graph.nodes.filter((node) => node.kind === "evidence" && node.details?.scope === "structural");
  const expectedPaths = Object.keys(factFiles)
    .filter((path) => path.startsWith("tests/") && SPEC_SUFFIXES.some((suffix) => path.endsWith(suffix)))
    .sort();
  const paths = nodes.map((node) => node.path);
  if (
    nodes.some((node) => node.state !== "complete" || typeof node.path !== "string") ||
    paths.length !== new Set(paths).size ||
    !sameSet(paths, expectedPaths)
  ) {
    problems.push("structural evidence nodes differ from the exact repository spec-file set");
  }
  problems.push(
    ...exactPartialProblems(
      graph,
      "STRUCTURAL_EVIDENCE_ONLY",
      nodes.map((node) => node.id),
    ),
  );
  return problems;
}

export function closureProblems({ result, graph, model, factFiles, modelIdentity, productRevision }) {
  const problems = [];
  if (result.verdict !== "inconclusive" || result.completeness !== "incomplete") {
    problems.push(`base check expected inconclusive/incomplete, found ${result.verdict}/${result.completeness}`);
  }
  if (result.identity?.product_revision !== productRevision || graph.identity?.product_revision !== productRevision) {
    problems.push("base check product revision drift");
  }
  if (graph.identity?.model_identity !== modelIdentity) problems.push("base check model identity drift");
  if (graph.structurally_closed !== true || graph.assurance_complete !== false) {
    problems.push("base relationship trace has unexpected structural/assurance closure");
  }
  const red = graph.findings.filter((finding) => ["red", "unresolved"].includes(finding.level));
  if (red.length > 0) problems.push(`base relationship trace contains ${red.length} red/unresolved findings`);
  const allowed = new Set(["IMPLEMENTATION_PENDING", "EVIDENCE_PARTIAL", "STRUCTURAL_EVIDENCE_ONLY"]);
  const unexpected = graph.findings.filter((finding) => !allowed.has(finding.code));
  if (unexpected.length > 0) problems.push(`base relationship trace contains unexpected finding ${unexpected[0].code}`);

  const tickets = new Map(model.tickets.map((ticket) => [ticket.id, ticket]));
  const expectedPending = model.families
    .filter((family) => {
      const observedTest = (family.planned_tests ?? []).some((path) => factFiles[path] !== undefined);
      const observedEvidence = family.evidence && factFiles[family.evidence.path] !== undefined;
      const ticketStatus = tickets.get(family.ticket)?.status;
      return (
        family.status === "implementable" &&
        !observedTest &&
        !observedEvidence &&
        ["pending", "blocked", "parked"].includes(ticketStatus)
      );
    })
    .map((family) => family.id);
  const expectedEvidence = model.families
    .filter(
      (family) =>
        family.evidence && family.evidence.state !== "complete" && factFiles[family.evidence.path] !== undefined,
    )
    .map((family) => `EVIDENCE-${family.id}`);
  problems.push(...exactPartialProblems(graph, "IMPLEMENTATION_PENDING", expectedPending));
  problems.push(...exactPartialProblems(graph, "EVIDENCE_PARTIAL", expectedEvidence));
  problems.push(...structuralEvidenceProblems(graph, factFiles));
  return problems;
}
