import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import {
  episodeIdFor,
  fingerprint,
} from "../loop/efficiency.js";
import type {
  CreatorEpisodeScope,
  CreatorScopeProvenance,
  JsonValue,
  ProposedProviderTurnStep,
} from "../loop/episode-plan.js";
import type { RoleConfig } from "../runtime/types.js";
import type { AppEntry } from "./apps.js";
import { assignmentsForRole, resolveAppAssignments } from "./execution-assignments.js";
import { readPersistedEpisodeIntent } from "./episode-planner/coordinator.js";
import {
  journalPath,
  readJournal,
  writeJournalPatch,
  type TurnJournal,
} from "./journal.js";
import { resolveTriggerRoute, type TriggerRoute } from "./trigger-routing.js";

const MAX_RUN_ROLE_TEMPLATE_BYTES = 64 * 1024;
const RUN_ROLE_STEP_ID = "run-role";
const RUN_ROLE_OUTPUT_ID = "role-result";

export interface PrepareStandaloneRunRoleScopeOptions {
  stateHome: string;
  app: AppEntry;
  roles: readonly RoleConfig[];
  role: RoleConfig;
  turnId: string;
  /** Exact adaptive selection, formatted as `<approved-candidate-id>@<effort>`. */
  assignmentSelector?: string;
  templatePath?: string;
  parentTaskId?: string;
  now?: () => Date;
}

export interface PreparedStandaloneRunRoleScope {
  journal: TurnJournal;
  route: TriggerRoute;
  creatorScope?: CreatorEpisodeScope;
  reusedPersistedIntent: boolean;
}

/**
 * Prepare the explicit episode-creator envelope for the standalone CLI.
 * Scheduled/event routes already name governed pipelines or ticket protocols,
 * so only the generic `skip` route is normalized into this one-step scope.
 *
 * The journal timestamp is the creator timestamp. That makes provenance stable
 * across process restarts, while an existing durable intent wins over mutable
 * template/config inputs so resume never changes an accepted plan.
 */
export async function prepareStandaloneRunRoleScope(
  options: PrepareStandaloneRunRoleScopeOptions,
): Promise<PreparedStandaloneRunRoleScope> {
  const journal = await ensureMatchingJournal(options);
  const route = resolveTriggerRoute({
    role: options.role.name,
    trigger: triggerFromJournal(journal),
  });
  if (route.kind !== "skip") {
    return { journal, route, reusedPersistedIntent: false };
  }

  const episodeId = episodeIdForJournal(options.app.name, journal, options.turnId);
  const persistedIntent = await readPersistedEpisodeIntent(options.stateHome, episodeId);
  if (persistedIntent !== undefined) {
    if (persistedIntent.app !== options.app.name) {
      throw new Error(
        `run-role: persisted episode ${episodeId} belongs to ${persistedIntent.app}, not ${options.app.name}`,
      );
    }
    const persistedRole = persistedIntent.requestedConstraints["dispatchRole"];
    if (persistedRole !== options.role.name) {
      throw new Error(
        `run-role: persisted episode ${episodeId} belongs to role ${String(persistedRole)}`,
      );
    }
    assertRequestedSelectionMatchesPersisted(options.assignmentSelector, persistedIntent.creatorScope);
    return {
      journal,
      route,
      ...(persistedIntent.creatorScope === undefined
        ? {}
        : { creatorScope: structuredClone(persistedIntent.creatorScope) }),
      reusedPersistedIntent: true,
    };
  }

  const template = options.templatePath === undefined
    ? undefined
    : await readBoundedTemplate(options.templatePath);
  const provenance = creatorProvenance(journal, options.parentTaskId, template?.sha256);
  const creatorScope = buildStandaloneRunRoleScope({
    app: options.app,
    roles: options.roles,
    role: options.role,
    turnId: options.turnId,
    provenance,
    ...(options.assignmentSelector === undefined
      ? {}
      : { assignmentSelector: options.assignmentSelector }),
    ...(template === undefined ? {} : { template }),
  });
  return { journal, route, creatorScope, reusedPersistedIntent: false };
}

export interface BuildStandaloneRunRoleScopeOptions {
  app: AppEntry;
  roles: readonly RoleConfig[];
  role: RoleConfig;
  turnId: string;
  provenance: CreatorScopeProvenance;
  assignmentSelector?: string;
  template?: {
    text: string;
    sha256: string;
  };
}

/** Pure creator-scope construction, exported for boundary tests. */
export function buildStandaloneRunRoleScope(
  options: BuildStandaloneRunRoleScopeOptions,
): CreatorEpisodeScope {
  const configuredRole = options.roles.find((role) => role.name === options.role.name);
  if (configuredRole === undefined) {
    throw new Error(`run-role: role ${options.role.name} is not present in current org configuration`);
  }
  if (fingerprint(configuredRole) !== fingerprint(options.role)) {
    throw new Error(`run-role: role ${options.role.name} differs from current org configuration`);
  }

  const resolved = resolveAppAssignments(options.app, options.roles);
  const approved = assignmentsForRole(resolved, options.role.name);
  const selected = selectAssignment(
    resolved.mode,
    approved,
    options.assignmentSelector,
    options.role.name,
  );
  const outputKind = firstNonEmpty(options.role.outputs) ?? RUN_ROLE_OUTPUT_ID;
  const expectedOutput = {
    id: RUN_ROLE_OUTPUT_ID,
    kind: outputKind,
    required: true,
  } as const;
  const templateRef = options.template === undefined
    ? undefined
    : `template:sha256:${options.template.sha256}`;
  const objective = [
    `Execute exactly one bounded ${options.role.name} role turn for ${options.app.name}.`,
    ...(options.template === undefined
      ? []
      : [
          "Creator-supplied turn instructions:",
          options.template.text,
        ]),
  ].join("\n\n");
  const step: ProposedProviderTurnStep = {
    kind: "provider_turn",
    id: RUN_ROLE_STEP_ID,
    operation: "manual/run-role",
    role: options.role.name,
    objective,
    dependsOn: [],
    requiredCapabilities: ["tool_gate"],
    inputRefs: [
      { ref: `turn:${options.turnId}`, required: true },
      ...(templateRef === undefined ? [] : [{ ref: templateRef, required: true }]),
    ],
    expectedOutputs: [expectedOutput],
    maxTurnBudgetUsd: selected?.maxTurnCostUsd ?? options.role.maxTurnBudgetUsd,
    selectionReason: selected === undefined
      ? "The creator requested one exact role turn; its atomic assignment resolves from fixed role configuration"
      : `The creator explicitly selected approved adaptive assignment ${options.assignmentSelector}`,
    ...(selected === undefined ? {} : { assignment: { ...selected.assignment } }),
  };
  const declaredConstraints: Record<string, JsonValue> = {
    standaloneRunRole: {
      role: options.role.name,
      providerTurns: 1,
      networkAccess: false,
      assignmentSelector: options.assignmentSelector ?? null,
      templateSha256: options.template?.sha256 ?? null,
    },
  };
  return {
    planningDisposition: "execution_ready",
    provenance: structuredClone(options.provenance),
    workKind: "standalone-role-turn",
    objective,
    inScope: [
      `one ${options.role.name} provider turn under the configured role authority`,
      ...(templateRef === undefined ? [] : [`the content-bound input ${templateRef}`]),
    ],
    outOfScope: [
      "additional provider roles or turns",
      "mechanical workflow gates not named by this invocation",
      "merging, deployment, external publication, or broadened authority",
    ],
    acceptanceCriteria: [
      `the accepted plan contains exactly one ${options.role.name} provider step`,
      `the turn records one required ${outputKind} result`,
    ],
    expectedArtifacts: [expectedOutput],
    declaredConstraints,
    safetyFacts: [],
    steps: [step],
  };
}

async function ensureMatchingJournal(
  options: PrepareStandaloneRunRoleScopeOptions,
): Promise<TurnJournal> {
  const path = journalPath(options.stateHome, options.turnId);
  const journal = existsSync(path)
    ? await readJournal(options.stateHome, options.turnId)
    : await writeJournalPatch(
        options.stateHome,
        options.turnId,
        {
          role: options.role.name,
          app: options.app.name,
          phase: "assembling",
          attempt: 0,
          triggerKind: "manual",
          trigger: "manual",
          pid: process.pid,
        },
        options.now?.() ?? new Date(),
      );
  if (journal.role !== options.role.name || journal.app !== options.app.name) {
    throw new Error(
      `run-role: turn ${options.turnId} already belongs to ${journal.app}/${journal.role}`,
    );
  }
  return journal;
}

function selectAssignment(
  mode: "fixed" | "adaptive",
  approved: ReturnType<typeof assignmentsForRole>,
  selector: string | undefined,
  role: string,
) {
  const choices = approved.map((candidate) =>
    `${candidate.candidateId}@${candidate.assignment.effort}`
  ).sort();
  if (mode === "fixed") {
    if (selector !== undefined) {
      throw new Error(
        `run-role: --assignment is invalid in fixed mode; ${role} resolves its configured atomic assignment`,
      );
    }
    return undefined;
  }
  if (selector === undefined) {
    throw new Error(
      `run-role: adaptive mode requires --assignment <candidate-id>@<effort>; approved for ${role}: ${choices.join(", ")}`,
    );
  }
  const matches = approved.filter((candidate) =>
    `${candidate.candidateId}@${candidate.assignment.effort}` === selector
  );
  if (matches.length !== 1) {
    throw new Error(
      `run-role: assignment ${JSON.stringify(selector)} is not one exact approved ${role} tuple; approved: ${choices.join(", ")}`,
    );
  }
  return matches[0]!;
}

async function readBoundedTemplate(path: string): Promise<{ text: string; sha256: string }> {
  const text = await readFile(path, "utf8");
  const bytes = Buffer.byteLength(text);
  if (bytes === 0 || text.trim().length === 0) {
    throw new Error(`run-role: template ${path} is empty`);
  }
  if (bytes > MAX_RUN_ROLE_TEMPLATE_BYTES) {
    throw new Error(
      `run-role: template ${path} is ${bytes} bytes; maximum is ${MAX_RUN_ROLE_TEMPLATE_BYTES}`,
    );
  }
  return {
    text,
    sha256: createHash("sha256").update(text).digest("hex"),
  };
}

function creatorProvenance(
  journal: TurnJournal,
  parentTaskId: string | undefined,
  templateSha256: string | undefined,
): CreatorScopeProvenance {
  const automated = parentTaskId !== undefined ||
    journal.triggerKind === "schedule" || journal.triggerKind === "event";
  const triggerEvidence = journal.event !== undefined
    ? `event:${journal.event.key}`
    : journal.triggerKind === "schedule" && journal.trigger !== undefined
      ? `schedule:${journal.trigger}`
      : "manual:run-role";
  return {
    source: automated ? "agent" : "human",
    creatorId: parentTaskId !== undefined
      ? `parent-task:${parentTaskId}`
      : automated
        ? "operon-dispatch"
        : "operon-cli",
    createdAt: journal.startedAt,
    evidenceRefs: [
      `turn:${journal.turnId}`,
      triggerEvidence,
      ...(parentTaskId === undefined ? [] : [`parent-task:${parentTaskId}`]),
      ...(templateSha256 === undefined ? [] : [`template:sha256:${templateSha256}`]),
    ],
  };
}

function episodeIdForJournal(app: string, journal: TurnJournal, turnId: string): string {
  if (journal.event !== undefined) {
    return episodeIdFor({
      app,
      traceId: `event:${journal.event.kind}:${journal.event.key}`,
    });
  }
  if (journal.ticketRef !== undefined) {
    return episodeIdFor({ app, ticket: journal.ticketRef, traceId: turnId });
  }
  return episodeIdFor({ app, traceId: turnId });
}

function triggerFromJournal(journal: TurnJournal) {
  if (journal.triggerKind === "event" && journal.trigger !== undefined) {
    return { event: journal.trigger };
  }
  if (journal.triggerKind === "schedule" && journal.trigger !== undefined) {
    return { schedule: journal.trigger };
  }
  return { manual: true as const };
}

function assertRequestedSelectionMatchesPersisted(
  requested: string | undefined,
  scope: CreatorEpisodeScope | undefined,
): void {
  if (requested === undefined) return;
  const standalone = scope?.declaredConstraints["standaloneRunRole"];
  const persisted = isRecord(standalone) ? standalone["assignmentSelector"] : undefined;
  if (persisted !== requested) {
    throw new Error(
      `run-role: --assignment ${JSON.stringify(requested)} conflicts with the persisted episode intent`,
    );
  }
}

function firstNonEmpty(values: readonly string[]): string | undefined {
  return values.find((value) => value.trim().length > 0);
}

function isRecord(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
