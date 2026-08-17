import { freshReaderProblems, readerReviewProblems } from "./migration-reader.mjs";
import { structureFidelity } from "./review-fidelity-extract.mjs";

const clone = (value) => structuredClone(value);

function expectProblems(controls, id, problems, match) {
  const selected = problems.find((problem) => problem.includes(match));
  if (!selected) throw new Error(`negative control ${id} did not detect ${match}: ${problems.join("; ")}`);
  controls.push({ id, result: "detected", detail: selected });
}

function registryControls(model, views, controls) {
  const tracePath = "validation-design/planned-trace.md";
  const registry = { ...views };
  const start = registry[tracePath].indexOf("## Provenance registry");
  registry[tracePath] = `${registry[tracePath].slice(0, start)}${registry[tracePath]
    .slice(start)
    .replace(model.sources[0].id, "SOURCE-MISSING")}`;
  expectProblems(controls, "provenance-registry-row", freshReaderProblems(model, registry), "source IDs differ");

  const backticked = { ...views };
  backticked[tracePath] = backticked[tracePath].replace(`| ${model.sources[0].id} |`, `| \`${model.sources[0].id}\` |`);
  expectProblems(
    controls,
    "provenance-registry-backticked-id",
    freshReaderProblems(model, backticked),
    "source IDs differ",
  );

  const registryOrder = { ...views };
  const traceLines = registryOrder[tracePath].split("\n");
  const firstRow = traceLines.findIndex((line) => line.startsWith(`| ${model.sources[0].id} |`));
  const secondRow = traceLines.findIndex((line) => line.startsWith(`| ${model.sources[1].id} |`));
  if (firstRow < 0 || secondRow < 0) throw new Error("provenance row-order seed lacks two source rows");
  [traceLines[firstRow], traceLines[secondRow]] = [traceLines[secondRow], traceLines[firstRow]];
  registryOrder[tracePath] = traceLines.join("\n");
  expectProblems(
    controls,
    "provenance-registry-order",
    freshReaderProblems(model, registryOrder),
    "byte-stably sorted",
  );

  const registryField = clone(model);
  registryField.sources[0].kind = `${registryField.sources[0].kind}-mutated`;
  expectProblems(
    controls,
    "provenance-registry-field",
    freshReaderProblems(registryField, views),
    "registry fields drift",
  );

  const divider = { ...views };
  divider[tracePath] = divider[tracePath].replace("| --- | --- | --- | --- | --- |", "| -- | --- | --- | --- | --- |");
  expectProblems(
    controls,
    "provenance-registry-divider",
    freshReaderProblems(model, divider),
    "complete five-column header",
  );
}

function structureControls(model, views, controls) {
  const structureFields = clone(model);
  structureFields.structures[0].meaning += " MUTATED";
  expectProblems(
    controls,
    "product-structure-routing-field",
    freshReaderProblems(structureFields, views),
    "product structure routing fields drift",
  );

  const route = clone(model);
  const unresolved = route.structures.find((structure) =>
    structure.meaning.includes("Implementation path mapping is unresolved"),
  );
  if (!unresolved) throw new Error("no unresolved implementation route available for negative control");
  unresolved.meaning = unresolved.meaning.replace(structureFidelity.unresolvedPathMeaning, "");
  expectProblems(controls, "unresolved-route-disclosure", freshReaderProblems(route, views), "omits its unresolved");
}

function reviewControls(readerRecord, bundleText, modelIdentity, controls) {
  const review = clone(readerRecord);
  review.bundle_sha256 = "0".repeat(64);
  expectProblems(
    controls,
    "reader-review-bundle-binding",
    readerReviewProblems(review, bundleText, modelIdentity),
    "exact bundle bytes",
  );
  const unknown = clone(readerRecord);
  unknown.unknown = true;
  expectProblems(
    controls,
    "reader-review-unknown-field",
    readerReviewProblems(unknown, bundleText, modelIdentity),
    "unknown root fields",
  );
  for (const [id, mutate, match] of [
    ["reader-review-model-binding", (value) => (value.model_identity = "0".repeat(64)), "exact model identity"],
    ["reader-review-hash-case", (value) => (value.bundle_sha256 = "A".repeat(64)), "lowercase SHA-256"],
    ["reader-review-row-field", (value) => (value.reviews[0].unknown = true), "unknown fields"],
    ["reader-review-role-closure", (value) => (value.reviews[1].role = value.reviews[0].role), "exactly once"],
    ["reader-review-reviewer", (value) => (value.reviews[0].reviewer = ""), "reviewer identity"],
    ["reader-review-verdict", (value) => (value.reviews[0].verdict = "fail"), "verdict is not pass"],
    ["reader-review-findings", (value) => value.reviews[0].findings.push("unresolved"), "retains unresolved"],
    ["reader-review-findings-shape", (value) => (value.reviews[0].findings = [1]), "string array"],
  ]) {
    const seeded = clone(readerRecord);
    mutate(seeded);
    expectProblems(controls, id, readerReviewProblems(seeded, bundleText, modelIdentity), match);
  }
}

export function runReaderNegativeControls(model, views, readerRecord, bundleText, modelIdentity) {
  const controls = [];
  registryControls(model, views, controls);
  structureControls(model, views, controls);
  reviewControls(readerRecord, bundleText, modelIdentity, controls);
  return controls;
}
