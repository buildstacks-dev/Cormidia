import { ledgerBindingProblems, ledgerEquivalenceProblems } from "./migration-ledger-equivalence.mjs";

const clone = (value) => structuredClone(value);

function changed(value) {
  if (typeof value === "string") return `${value} MUTATED`;
  if (Array.isArray(value)) return [...value, "MUTATED"];
  return "MUTATED";
}

function expectProblems(controls, id, operation, match) {
  const problems = operation();
  const selected = problems.find((problem) => problem.includes(match));
  if (!selected) throw new Error(`negative control ${id} did not detect ${match}: ${problems.join("; ")}`);
  controls.push({ id, result: "detected", detail: selected });
}

function ticketControls(input, model, ledger, controls) {
  for (const field of [
    "title",
    "wave",
    "status",
    "owner",
    "executor",
    "lane",
    "layer",
    "acceptance_criteria",
    "family_ids",
  ]) {
    const seeded = clone(model);
    seeded.tickets[0][field] = changed(seeded.tickets[0][field]);
    expectProblems(
      controls,
      `ticket-${field.replaceAll("_", "-")}-drift`,
      () => ledgerEquivalenceProblems(input, seeded, ledger),
      `exact ${field} drift`,
    );
  }
  const dependency = clone(model);
  dependency.tickets[0].depends_on = ["HB-INVENTED"];
  expectProblems(
    controls,
    "ticket-dependency-drift",
    () => ledgerEquivalenceProblems(input, dependency, ledger),
    "exact depends_on drift",
  );
  const hb155Status = clone(model);
  const hb155 = hb155Status.tickets.find((ticket) => ticket.id === "HB-155-L2");
  if (!hb155) throw new Error("HB-155-L2 is unavailable for the status-override negative control");
  hb155.status = hb155.status === "landed" ? "pending" : "landed";
  expectProblems(
    controls,
    "ticket-status-override-drift",
    () => ledgerEquivalenceProblems(input, hb155Status, ledger),
    "HB-155-L2 exact status drift",
  );
  const invented = clone(model);
  invented.tickets.push({ ...invented.tickets[0], id: "HB-INVENTED" });
  expectProblems(
    controls,
    "ticket-output-invented",
    () => ledgerEquivalenceProblems(input, invented, ledger),
    "ticket outputs are not",
  );
}

function ledgerRowsControls(input, model, ledger, controls) {
  const seeds = [
    ["family-ledger-output", (value) => (value.families[0].output_ids = []), "family ledger output closure drift"],
    [
      "ticket-ledger-citation",
      (value) => value.tickets[0].legacy_family_ids.push("CF-INVENTED"),
      "legacy_family_ids drift",
    ],
    [
      "ticket-ledger-owned",
      (value) => value.tickets.find((entry) => entry.owned_legacy_family_ids.length).owned_legacy_family_ids.pop(),
      "owned_legacy_family_ids drift",
    ],
    [
      "ticket-ledger-disposition",
      (value) => (value.tickets.find((entry) => entry.disposition === "historical").disposition = "actionable"),
      "disposition drift",
    ],
    [
      "ticket-ledger-reason",
      (value) => (value.tickets.find((entry) => entry.disposition === "historical").reason += " MUTATED"),
      "reason drift",
    ],
    [
      "ticket-id-retention",
      (value) => {
        const entry = value.tickets.find((candidate) => candidate.disposition === "actionable");
        entry.output_ids = entry.output_ids.filter((id) => id !== entry.legacy_id);
      },
      "not retained exactly once",
    ],
  ];
  for (const [id, mutate, match] of seeds) {
    const seeded = clone(ledger);
    mutate(seeded);
    expectProblems(controls, id, () => ledgerEquivalenceProblems(input, model, seeded), match);
  }
}

function bindingControls(ledger, expectedLedger, ledgerText, expectedLedgerText, controls) {
  for (const [id, mutate] of [
    ["ledger-product-revision-binding", (value) => (value.product_revision = "0".repeat(40))],
    ["ledger-upstream-artifact-binding", (value) => (value.upstream.artifact_sha256 = "0".repeat(64))],
    ["ledger-reviewed-source-binding", (value) => (value.source.reviewed_mapping_sha256 = "0".repeat(64))],
    ["ledger-compiler-report-binding", (value) => (value.compiler.report_sha256 = "0".repeat(64))],
  ]) {
    const seeded = clone(ledger);
    mutate(seeded);
    expectProblems(
      controls,
      id,
      () => ledgerBindingProblems(seeded, expectedLedger, ledgerText, expectedLedgerText),
      "complete migration ledger object drift",
    );
  }
}

export function runLedgerNegativeControls({ input, model, ledger, expectedLedger, ledgerText, expectedLedgerText }) {
  const controls = [];
  ticketControls(input, model, ledger, controls);
  ledgerRowsControls(input, model, ledger, controls);
  bindingControls(ledger, expectedLedger, ledgerText, expectedLedgerText, controls);
  return controls;
}
