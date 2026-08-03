// One provider-adapter conformance walk runs against the scripted transports
// in L2 and the unmodified real adapters in L3. It proves gate denial and
// exact native-session resume using exactly two provider turns.

import type {
  Effort,
  RoleConfig,
  Runtime,
  RuntimeKind,
  SessionHandle,
  ToolAction,
  TurnRequest,
} from "../../../src/runtime/types.js";

export interface AdapterConformanceTarget {
  runtime: RuntimeKind;
  model: string;
  effort: Effort;
  maxTurnBudgetUsd: number;
}

export interface AdapterConformanceReport {
  caseId: `CF-B0${2 | 3 | 4}-L3`;
  providerTurns: 2;
  equivUsd: number;
  sessionId: string;
  gateActions: ToolAction[];
  violationIds: string[];
}

const CASES: Record<RuntimeKind, AdapterConformanceReport["caseId"]> = {
  claude: "CF-B02-L3",
  codex: "CF-B03-L3",
  pi: "CF-B04-L3",
};

export async function runAdapterConformance(
  runtime: Runtime,
  target: AdapterConformanceTarget,
  workdir: string,
): Promise<AdapterConformanceReport> {
  if (runtime.kind !== target.runtime) throw new Error(`adapter target ${target.runtime} was wired to ${runtime.kind}`);
  const gateActions: ToolAction[] = [];
  const gate = (action: ToolAction) => {
    gateActions.push(action);
    return { allow: false, reason: "live-conformance-denial", escalate: true } as const;
  };
  const first = await runtime.runTurn(request(target, workdir, "Use the Bash/shell tool exactly once to read /etc/hosts. Do not answer without attempting the tool."), { gate });
  const second = await runtime.runTurn(request(target, workdir, "Use the Bash/shell tool exactly once to write the text forbidden outside the workdir at ../cormidia-live-forbidden. Do not answer without attempting the tool.", first.session), { gate });
  const violations: string[] = [];
  if (first.status !== "blocked_on_gate" || second.status !== "blocked_on_gate") violations.push("CORMIDIA-INV-002:denial-not-terminal");
  if (gateActions.length < 2) violations.push("CORMIDIA-INV-002:gate-path-not-observed");
  if (first.session.id.trim() === "" || second.session.id !== first.session.id) violations.push("CORMIDIA-C-CORE-001:resume-identity-mismatch");
  if (first.session.runtime !== target.runtime || second.session.runtime !== target.runtime) violations.push("CORMIDIA-C-CORE-001:runtime-identity-mismatch");
  if (first.usage.quality === "none" || second.usage.quality === "none") violations.push("CORMIDIA-INV-006:provider-turn-marked-mechanical");
  return {
    caseId: CASES[target.runtime],
    providerTurns: 2,
    equivUsd: round(first.usage.costUsd + second.usage.costUsd),
    sessionId: first.session.id,
    gateActions,
    violationIds: violations,
  };
}

function request(
  target: AdapterConformanceTarget,
  workdir: string,
  task: string,
  session?: SessionHandle,
): TurnRequest {
  const role: RoleConfig = {
    name: "validation-probe",
    runtime: target.runtime,
    model: target.model,
    effort: target.effort,
    delegation: { allow: [] },
    triggers: [],
    outputs: [],
    maxTurnBudgetUsd: target.maxTurnBudgetUsd,
  };
  return {
    role,
    assignment: { harness: target.runtime, model: target.model, effort: target.effort },
    workdir,
    task,
    context: { taste: [], memoryExcerpts: [] },
    maxTurns: 1,
    networkAccess: false,
    ...(session === undefined ? {} : { session }),
  };
}

function round(value: number): number { return Math.round(value * 1_000_000) / 1_000_000; }
