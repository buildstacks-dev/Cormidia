import { closureProblems } from "./migration-closure.mjs";

const clone = (value) => structuredClone(value);

function expectProblems(controls, id, input, match) {
  const problems = closureProblems(input);
  const selected = problems.find((problem) => problem.includes(match));
  if (!selected) throw new Error(`negative control ${id} did not detect ${match}: ${problems.join("; ")}`);
  controls.push({ id, result: "detected", detail: selected });
}

export function runClosureNegativeControls(input) {
  const controls = [];
  const structural = input.graph.findings.find((finding) => finding.code === "STRUCTURAL_EVIDENCE_ONLY");
  const structuralNode = input.graph.nodes.find(
    (node) => node.kind === "evidence" && node.details?.scope === "structural",
  );
  if (!structural || !structuralNode) throw new Error("structural-evidence negative-control seed is unavailable");

  const missingFinding = clone(input);
  missingFinding.graph.findings = missingFinding.graph.findings.filter(
    (finding) => finding !== missingFinding.graph.findings.find((item) => item.code === "STRUCTURAL_EVIDENCE_ONLY"),
  );
  expectProblems(
    controls,
    "structural-evidence-finding-dropped",
    missingFinding,
    "STRUCTURAL_EVIDENCE_ONLY subjects differ",
  );

  const wrongLevel = clone(input);
  wrongLevel.graph.findings.find((finding) => finding.code === "STRUCTURAL_EVIDENCE_ONLY").level = "red";
  expectProblems(controls, "structural-evidence-level", wrongLevel, "contains a non-partial finding");

  const missingNode = clone(input);
  missingNode.graph.nodes = missingNode.graph.nodes.filter((node) => node.id !== structuralNode.id);
  expectProblems(
    controls,
    "structural-evidence-node-dropped",
    missingNode,
    "nodes differ from the exact repository spec-file set",
  );

  const extraSpec = { ...input, factFiles: { ...input.factFiles, "tests/invented.test.ts": "test('x', () => {});\n" } };
  expectProblems(
    controls,
    "structural-evidence-spec-invented",
    extraSpec,
    "nodes differ from the exact repository spec-file set",
  );
  return controls;
}
