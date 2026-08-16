// The host registry keeps product-canonical IDs. The checked graph represents
// those same reviewed facts with compiler-safe structure IDs; this total map
// composes the domains without changing either authority.
const REVISION_REGISTRY_ROWS = [
  { registry_id: "M17", model_structure_ids: ["SM-ROADMAP", "SM-VALIDATION"] },
  { registry_id: "J-20", model_structure_ids: ["J-20"] },
  { registry_id: "CORMIDIA-INV-016", model_structure_ids: ["CORMIDIA-INV-016"] },
  { registry_id: "B-20", model_structure_ids: ["B-20"] },
  { registry_id: "B-21", model_structure_ids: ["B-21"] },
  { registry_id: "B-22", model_structure_ids: ["B-22"] },
  { registry_id: "CORMIDIA-C-B20-001", model_structure_ids: ["CONTRACT-B-20"] },
  { registry_id: "CORMIDIA-C-B21-001", model_structure_ids: ["CONTRACT-B-21"] },
  { registry_id: "CORMIDIA-C-B22-001", model_structure_ids: ["CONTRACT-B-22"] },
  { registry_id: "CORMIDIA-C-OPBATCH-001", model_structure_ids: ["CONTRACT-OP-BATCHING"] },
  {
    registry_id: "CORMIDIA-C-OPVALIDATION-001",
    model_structure_ids: ["CONTRACT-OP-VALIDATION-LIFECYCLE"],
  },
  { registry_id: "S-10", model_structure_ids: ["S-10"] },
] as const;

export const REVISION_REGISTRY_IDS = REVISION_REGISTRY_ROWS.map((row) => row.registry_id);
export const REVISION_REGISTRY_MODEL_STRUCTURE_IDS = REVISION_REGISTRY_ROWS.flatMap((row) => row.model_structure_ids);

export function missingRevisionRegistryModelStructures(
  actual: ReadonlySet<string>,
  rows: ReadonlyArray<{ registry_id: string; model_structure_ids: readonly string[] }> = REVISION_REGISTRY_ROWS,
): string[] {
  return rows
    .filter(
      (row) =>
        row.model_structure_ids.length === 0 || row.model_structure_ids.some((id) => id === "" || !actual.has(id)),
    )
    .map((row) => row.registry_id);
}
