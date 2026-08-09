import { createHash } from "node:crypto";
import type { TicketPlan } from "../loop/plan-tickets.js";
import { inspectProductDocScaffold, type ProductDocDisposition } from "./product-doc-record.js";
import type { PlanningSourceManifest } from "./planning-inputs.js";

export type ProductDocPlanningState =
  | { kind: "unscaffolded" }
  | {
      kind: "scaffolded";
      disposition: ProductDocDisposition;
      decisionHash: string;
      template: "typescript-node" | "bare";
      documentPaths: string[];
    };

const RECONCILIATION_GROUP = "product-doc-reconciliation-v1";
const BARE_STACK_GROUP = "bare-stack-and-gates-v1";

export async function prepareProductDocPlanning(input: {
  workdir: string;
  app: string;
  repository: string;
  sources?: PlanningSourceManifest;
}): Promise<ProductDocPlanningState> {
  const inspected = await inspectProductDocScaffold(input);
  if (inspected === undefined) return { kind: "unscaffolded" };
  const { record, documents, legacy } = inspected;
  if (record.disposition === null) {
    throw new Error(
      `plan: ${legacy ? "legacy " : ""}scaffold product documents have no keep/reconcile/remove disposition; ` +
        "run `cormidia app product-docs` before automated planning",
    );
  }
  const decided = record.disposition.documents;
  const current = documents.map(({ path, current_sha256 }) => ({ path, current_sha256 }));
  if (JSON.stringify(decided) !== JSON.stringify(current)) {
    throw new Error(
      "plan: product documents changed after their disposition was recorded; preview and record it again",
    );
  }
  if (record.disposition.value === "keep" && documents.some((document) => document.status === "absent")) {
    throw new Error("plan: keep disposition requires every reviewed scaffold product document to remain present");
  }
  if (record.disposition.value === "remove" && documents.some((document) => document.status !== "absent")) {
    throw new Error("plan: remove disposition requires optional scaffold product documents to remain absent");
  }
  if (record.disposition.value === "reconcile" && !hasAuthoritativeSource(input.sources, record.documents)) {
    throw new Error(
      "plan: reconcile disposition requires at least one consumed --source outside the scaffold product documents",
    );
  }
  return {
    kind: "scaffolded",
    disposition: record.disposition.value,
    decisionHash: createHash("sha256").update(JSON.stringify(record.disposition)).digest("hex"),
    template: record.template,
    documentPaths: record.documents.map((document) => document.path),
  };
}

export function renderProductDocPlanningBrief(state: ProductDocPlanningState): string {
  if (state.kind === "unscaffolded") return "";
  if (state.disposition === "keep") {
    return (
      commonPlanningBrief(state) +
      "\n\nDisposition: keep. The operator reviewed the scaffold documents. " +
      "Do not create disposition-driven reconciliation work; add ordinary docs work only when the bounded goal requires it."
    );
  }
  if (state.disposition === "remove") {
    return (
      commonPlanningBrief(state) +
      "\n\nDisposition: remove. These documents are optional and intentionally absent. " +
      "Do not recreate or require them; plan from the goal and supplied authoritative sources."
    );
  }
  return [
    commonPlanningBrief(state),
    "",
    "Disposition: reconcile. The TicketPlan must contain exactly one documentation ticket with " +
      `executionGroup ${JSON.stringify(RECONCILIATION_GROUP)} and fileScope covering ${state.documentPaths.join(", ")}.` +
      (state.template === "bare"
        ? ` It must depend on the ${JSON.stringify(BARE_STACK_GROUP)} ticket.`
        : " It must be dependency-free."),
    "That ticket must reconcile the documents from the operator-supplied authoritative sources through the ordinary " +
      "Builder and independent Reviewer path. Every product implementation ticket must depend on it.",
  ].join("\n");
}

export function productDocPlanProblems(plan: TicketPlan, state: ProductDocPlanningState): string[] {
  if (state.kind === "unscaffolded") return [];
  const bareStack = plan.tickets
    .map((ticket, index) => ({ ticket, index }))
    .filter(({ ticket }) => ticket.executionGroup === BARE_STACK_GROUP);
  const problems: string[] = [];
  if (state.template === "bare") {
    if (bareStack.length !== 1) problems.push("bare scaffold requires exactly one stack-and-gates ticket");
    else if (bareStack[0]!.ticket.dependsOn.length > 0)
      problems.push("bare stack-and-gates ticket must be dependency-free");
  } else if (bareStack.length > 0) {
    problems.push("typescript-node scaffold must not create bare stack-and-gates work");
  }
  const reconciliation = plan.tickets
    .map((ticket, index) => ({ ticket, index }))
    .filter(({ ticket }) => ticket.executionGroup === RECONCILIATION_GROUP);
  if (state.disposition !== "reconcile") {
    if (reconciliation.length > 0) problems.push("product-doc reconciliation work is unnecessary");
    if (state.template === "bare" && bareStack.length === 1) {
      for (const { ticket, index } of plan.tickets.map((ticket, index) => ({ ticket, index }))) {
        if (index !== bareStack[0]!.index && !ticket.dependsOn.includes(bareStack[0]!.index)) {
          problems.push(`ticket ${index} does not depend on bare stack-and-gates ticket ${bareStack[0]!.index}`);
        }
      }
    }
    if (state.disposition === "remove") {
      for (const ticket of plan.tickets) {
        for (const path of ticket.fileScope.filter((candidate) => state.documentPaths.includes(candidate))) {
          problems.push(`remove disposition forbids planned regeneration of ${path}`);
        }
      }
    }
    return problems;
  }
  if (reconciliation.length !== 1) {
    problems.push("reconcile requires exactly one product-doc reconciliation ticket");
    return problems;
  }
  const { ticket, index } = reconciliation[0]!;
  const stackIndex = bareStack[0]?.index;
  if (state.template === "bare") {
    if (stackIndex === undefined || !ticket.dependsOn.includes(stackIndex)) {
      problems.push("bare product-doc reconciliation ticket must depend on stack-and-gates work");
    }
  } else if (ticket.dependsOn.length > 0) {
    problems.push("product-doc reconciliation ticket must be dependency-free");
  }
  for (const path of state.documentPaths) {
    if (!ticket.fileScope.includes(path)) problems.push(`product-doc reconciliation ticket does not cover ${path}`);
  }
  plan.tickets.forEach((candidate, candidateIndex) => {
    if (candidateIndex !== index && candidateIndex !== stackIndex && !candidate.dependsOn.includes(index)) {
      problems.push(`ticket ${candidateIndex} does not depend on product-doc reconciliation ticket ${index}`);
    }
  });
  return problems;
}

export async function assertCurrentProductDocTicketPlan(
  input: { workdir: string; app: string; repository: string; sources?: PlanningSourceManifest },
  expected: ProductDocPlanningState,
  plan: TicketPlan,
): Promise<void> {
  const current = await prepareProductDocPlanning(input);
  if (JSON.stringify(current) !== JSON.stringify(expected)) {
    throw new Error("plan: product-document disposition changed during planning; no issues were published");
  }
  const problems = productDocPlanProblems(plan, current);
  if (problems.length > 0) {
    throw new Error(
      `plan: durable TicketPlan no longer satisfies the current product-document disposition: ${problems.join("; ")}`,
    );
  }
}

function commonPlanningBrief(state: Extract<ProductDocPlanningState, { kind: "scaffolded" }>): string {
  const bare =
    state.template === "bare"
      ? " The TicketPlan must contain exactly one dependency-free stack-and-gates ticket with " +
        `executionGroup ${JSON.stringify(BARE_STACK_GROUP)}. Every later ticket must depend on it, directly or through the reconciliation ticket.`
      : "";
  return `## Product-document disposition\n\nTemplate: ${state.template}.${bare}`;
}

function hasAuthoritativeSource(
  manifest: PlanningSourceManifest | undefined,
  documents: Array<{ path: string }>,
): boolean {
  if (manifest === undefined) return false;
  return manifest.sources.some(
    (source) =>
      source.selection === "selected" &&
      source.consumption === "consumed" &&
      !documents.some((document) => source.canonical_ref.endsWith(`:${document.path}`)),
  );
}
