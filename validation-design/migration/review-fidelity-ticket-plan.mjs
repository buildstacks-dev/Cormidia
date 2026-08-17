import { sourceTicketDependencies } from "./review-fidelity-source.mjs";

const unique = (values) => [...new Set(values.filter(Boolean))];
const layerNumber = (layer) => Number(layer.match(/^L([1-6])$/)?.[1] ?? Number.NaN);

function dependencyOutput(outputs, targetLayer) {
  const sameLayer = outputs.filter((candidate) => candidate.layer === targetLayer);
  if (sameLayer.length === 1) return { id: sameLayer[0].id };
  if (sameLayer.length > 1) return { problem: "ambiguous-layer-output" };
  const target = layerNumber(targetLayer);
  if (!Number.isFinite(target) || target <= 2) return { problem: "no-layer-local-output" };
  const cheaper = outputs.filter((candidate) => {
    const layer = layerNumber(candidate.layer);
    return Number.isFinite(layer) && layer < target;
  });
  if (!cheaper.length) return { problem: "no-cheaper-output" };
  const highest = Math.max(...cheaper.map((candidate) => layerNumber(candidate.layer)));
  const candidates = cheaper.filter((candidate) => layerNumber(candidate.layer) === highest);
  return candidates.length === 1 ? { id: candidates[0].id } : { problem: "ambiguous-cheaper-output" };
}

function representationCriterion(relation, patch) {
  const mapped = patch.depends_on.length
    ? `canonical dependency outputs are ${patch.depends_on.join(", ")}`
    : "no canonical ticket-output edge is representable";
  const unresolved = patch.unresolved.map((item) => {
    const [id, reason] = item.split(":");
    if (reason === "historical-or-no-output") return `${id} has no actionable canonical output`;
    if (reason === "no-layer-local-output") return `${id} has no same-layer output and is not pulled across layers`;
    if (reason === "no-cheaper-output") return `${id} has no same-layer or cheaper canonical output`;
    return `${id} is unresolved (${reason})`;
  });
  return `Dependency representation disposition: ${mapped}.${
    unresolved.length ? ` Unresolved source relations: ${unresolved.join("; ")}.` : ""
  } Exact source prerequisite retained: ${relation.source_fact}.`;
}

export function hb155OutputPatchPlan() {
  return [
    { legacy_ticket_id: "HB-155", output_id: "HB-155", status: "landed", depends_on: [] },
    { legacy_ticket_id: "HB-155", output_id: "HB-155-L2", status: "landed", depends_on: ["HB-155"] },
    {
      legacy_ticket_id: "HB-155",
      output_id: "HB-155-L3",
      status: "blocked",
      depends_on: ["HB-137-L3", "HB-155-L2"],
    },
  ];
}

export function ticketDependencyPatchPlan({ review, backlogMarkdown }) {
  return sourceTicketDependencies(backlogMarkdown).map((relation) => {
    const outputs = review.ticket_reviews[relation.legacy_ticket_id]?.outputs ?? [];
    const outputPatches = outputs.map((output) => {
      const dependencies = [];
      const unresolved = [];
      for (const legacyDependency of relation.dependency_ticket_ids) {
        const candidates = review.ticket_reviews[legacyDependency]?.outputs ?? [];
        if (!candidates.length) {
          unresolved.push(`${legacyDependency}:historical-or-no-output`);
          continue;
        }
        const binding = dependencyOutput(candidates, output.layer);
        if (binding.id) dependencies.push(binding.id);
        else unresolved.push(`${legacyDependency}:${binding.problem}`);
      }
      const patch = { output_id: output.id, layer: output.layer, depends_on: unique(dependencies), unresolved };
      return { ...patch, acceptance_disposition: representationCriterion(relation, patch) };
    });
    const representationDispositions = outputs.length
      ? outputPatches.flatMap((patch) =>
          patch.unresolved.map((unresolved) => `${relation.legacy_ticket_id}/${patch.output_id}:${unresolved}`),
        )
      : [`${relation.legacy_ticket_id}:source-fact-only:no-actionable-output`];
    return {
      ...relation,
      output_patches: outputPatches,
      disposition: outputs.length ? "layer-safe-patch-plan" : "source-fact-only",
      representation_dispositions: representationDispositions,
      reason_disposition: outputs.length
        ? undefined
        : `Dependency representation disposition: this historical source ticket has no actionable canonical output; its exact source prerequisite remains source-fact-only: ${relation.source_fact}.`,
    };
  });
}
