import { reviewEquivalenceProblems } from "./migration-review-equivalence.mjs";
import { hb155OutputPatchPlan, ticketDependencyPatchPlan } from "./review-fidelity.mjs";

const clone = (value) => structuredClone(value);

function expectProblems(controls, id, input, mutate, match) {
  const seeded = clone(input);
  mutate(seeded.review);
  const problems = reviewEquivalenceProblems(seeded);
  const selected = problems.find((problem) => problem.includes(match));
  if (!selected) throw new Error(`negative control ${id} did not detect ${match}: ${problems.join("; ")}`);
  controls.push({ id, result: "detected", detail: selected });
}

function sourceControls(input, controls) {
  for (const [id, mutate] of [
    ["review-source-path-drift", (review) => (review.sources[0].path = "validation-design/invariants.md")],
    ["review-source-kind-drift", (review) => (review.sources[0].kind = "proposed")],
    ["review-source-duplicate", (review) => (review.sources[1].id = review.sources[0].id)],
    [
      "review-source-provenance-dropped",
      (review) => (review.sources = review.sources.filter((source) => source.id !== "SOURCE-PROVENANCE")),
    ],
  ]) {
    expectProblems(controls, id, input, mutate, "reviewed source inventory/path/kind records drift");
  }
  expectProblems(
    controls,
    "family-output-source-dropped",
    input,
    (review) => review.families["CF-J01-S"].outputs[0].source_ids.pop(),
    "source references differ from its reviewed family source closure",
  );
  expectProblems(
    controls,
    "structure-source-reference-dropped",
    input,
    (review) => (review.structures.find((structure) => structure.id === "B-31").source_ids = []),
    "has no reviewed source reference",
  );
}

function productAndStructureControls(input, controls) {
  expectProblems(
    controls,
    "review-product-criticality-drift",
    input,
    (review) => (review.product.criticality = "C1"),
    "reviewed product facts drift",
  );
  expectProblems(
    controls,
    "review-owner-drift",
    input,
    (review) => (review.owners[0].responsibility += " MUTATED"),
    "reviewed owner facts drift",
  );
  expectProblems(
    controls,
    "structure-owner-drift",
    input,
    (review) => (review.structures[0].owner = "nobody"),
    "reviewed owner drift",
  );
  expectProblems(
    controls,
    "structure-criticality-drift",
    input,
    (review) => (review.structures[0].criticality = "C4"),
    "reviewed criticality override drift",
  );
  expectProblems(
    controls,
    "structure-impact-map-invented",
    input,
    (review) => (review.structures[0].changed_paths = ["src/invented.ts"]),
    "unreviewed implementation impact map",
  );
}

function ticketControls(input, controls) {
  const first = Object.values(input.review.ticket_reviews).find((review) => review.outputs?.length)?.outputs[0];
  if (!first) throw new Error("no reviewed ticket output available for negative controls");
  expectProblems(
    controls,
    "review-ticket-title-drift",
    input,
    (review) =>
      (Object.values(review.ticket_reviews).find((ticket) => ticket.outputs?.length).outputs[0].title += " MUTATED"),
    "ticket output titles drift",
  );
  for (const [field, mutate, match] of [
    ["owner", (output) => (output.owner = "nobody"), "owner differs from its exact family placement"],
    ["lane", (output) => (output.lane = "live-triggered"), "lane differs from its exact family placement"],
    ["layer", (output) => (output.layer = "L6"), "layer differs from its exact family placement"],
    ["family_ids", (output) => output.family_ids.push("CF-INVENTED"), "family_ids differ"],
  ]) {
    expectProblems(
      controls,
      `review-ticket-${field.replaceAll("_", "-")}-drift`,
      input,
      (review) => mutate(Object.values(review.ticket_reviews).find((ticket) => ticket.outputs?.length).outputs[0]),
      match,
    );
  }
  const relation = ticketDependencyPatchPlan({ review: input.review, backlogMarkdown: input.backlogMarkdown }).find(
    (candidate) => candidate.output_patches.length > 0,
  );
  const patch = relation?.output_patches[0];
  if (!relation || !patch) throw new Error("no dependency patch available for negative control");
  expectProblems(
    controls,
    "review-ticket-depends-on-drift",
    input,
    (review) => {
      review.ticket_reviews[relation.legacy_ticket_id].outputs.find(
        (output) => output.id === patch.output_id,
      ).depends_on = ["HB-INVENTED"];
    },
    "exact dependency patch drift",
  );
  const statusPatch = hb155OutputPatchPlan()[0];
  expectProblems(
    controls,
    "review-ticket-status-drift",
    input,
    (review) => {
      review.ticket_reviews[statusPatch.legacy_ticket_id].outputs.find(
        (output) => output.id === statusPatch.output_id,
      ).status = "pending";
    },
    "explicit status patch drift",
  );
}

export function runReviewNegativeControls(input) {
  const controls = [];
  sourceControls(input, controls);
  productAndStructureControls(input, controls);
  ticketControls(input, controls);
  return controls;
}
