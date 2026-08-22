// Composition root: one Cormidia org's learning loop on the governed-learning-
// loop kernel (@cormidia/learning-loop, vendored per governed-learning-loop
// Decision 0029 R7). This is the migration's seam (Cormidia #467, extraction
// plan §Phase 4): Cormidia code composes host adapters onto the kernel's
// public ports; the kernel never imports upward. Since phase B this is the
// ONLY learning engine: the CLI, the scheduled distiller/reviewer turns, and
// context assembly all compose here.
//
// State placement (compatibility policy, research/2026-08-21_learning-loop-
// migration-compatibility-policy.md): the kernel's own records live under
// `<state home>/learning-loop/` and touch no governed org-home surface; the
// org-home writes are the destinations' — the same concept bytes and manifest
// cuts the forked publisher wrote, at the same paths, plus proposal drafts
// under `proposals/**` and deduplicated tickets through the app's GhOps.
//
// Registrations are deterministic from apps.yaml (sorted app names), so the
// kernel registry revision a plan binds is stable across CLI invocations.

import { join } from "node:path";
import { conservativePolicy, createLearningLoop, defineSourceRegistration } from "@cormidia/learning-loop";
import type {
  Clock,
  DestinationRegistration,
  IdGenerator,
  IdentityPort,
  LearningLoop,
  PublicationDestination,
  RegisteredSource,
} from "@cormidia/learning-loop";
import { createFileStore } from "@cormidia/learning-loop/node";
import type { GhOps } from "../../loop/github.js";
import type { ApprovalStore } from "../approvals.js";
import { appLearningRoot, orgLearningRoot } from "../learning/concepts.js";
import type { LearningPolicy } from "../learning/policy.js";
import { createCormidiaAuthorityPort, LEARNING_LOOP_PUBLISH_RULE } from "./authority.js";
import { createOkfContentPolicy, OKF_CONTENT_POLICY_ID } from "./content-policy.js";
import { createOkfConceptDestination } from "./destination-okf.js";
import { createProposalDestination } from "./destination-proposal.js";
import { createTicketDestination } from "./destination-ticket.js";
import { createEpisodeEvidenceSource, type EpisodeEvidenceInput } from "./evidence-source.js";
import { createCormidiaIdentityPort } from "./identity.js";
import { createCormidiaReplayExecutor, type CormidiaReplayRunner } from "./replay-executor.js";
import { cormidiaScopePolicy } from "./scope.js";

export const LEARNING_LOOP_ROUTINE_RULE = "learning-loop-routine";

export interface CormidiaLearningApp {
  readonly name: string;
  /** The app checkout whose `.cormidia/learning` is a destination root. */
  readonly workdir: string;
  /** False when no local checkout resolved and `workdir` is the managed-clone
   *  location: the registration exists (registry stability) but nothing may
   *  be published into it until the checkout exists. */
  readonly resolved?: boolean;
  /** The app's GitHub seam, resolved lazily by the ticket destination. */
  readonly gh?: () => GhOps | undefined;
}

export interface CormidiaLearningLoopInput {
  readonly orgHome: string;
  readonly stateHome: string;
  /** The org name (`~/.cormidia/<org>`): the scope isolation segment. */
  readonly org: string;
  readonly approvals: ApprovalStore;
  readonly policy: LearningPolicy;
  /** Registered apps, in apps.yaml order; sorted here for a stable registry. */
  readonly apps?: readonly CormidiaLearningApp[];
  /** Absent means no experiment can run. */
  readonly replayRunner?: CormidiaReplayRunner;
  readonly clock?: Clock;
  readonly ids?: IdGenerator;
  /** Test seam at the destination port (B-32 §4): wraps each registered
   *  destination adapter — the crash-injection point for the journey's
   *  interruption families. Production never supplies it; the wrapper keeps
   *  the adapter id, so the registration digest is unchanged. */
  readonly wrapDestination?: (adapter: PublicationDestination) => PublicationDestination;
}

export interface CormidiaLearningLoop {
  readonly loop: LearningLoop;
  readonly identity: IdentityPort;
  readonly episodes: RegisteredSource<EpisodeEvidenceInput>;
  /** OKF destination ids: the org bundle and one per registered app. */
  readonly destinations: { readonly org: string; readonly apps: Readonly<Record<string, string>> };
  readonly stateDir: string;
  readonly orgHome: string;
  readonly stateHome: string;
  readonly org: string;
  readonly apps: readonly CormidiaLearningApp[];
  /** The configured replay executor's exact registration digest — what an
   *  experiment definition must name (decision 0028); absent without a runner. */
  readonly replayExecutorDigest?: string;
}

/** `<state home>/learning-loop` — every kernel-owned byte lives below it. */
export function learningLoopStateDir(stateHome: string): string {
  return join(stateHome, "learning-loop");
}

const ORG_TARGETS = ["bundle/org/*", "bundle/roles/*/*"];
const APP_TARGETS = ["bundle/apps/*/*", "bundle/apps/*/roles/*/*"];
const PROPOSAL_TARGETS = ["proposals/skills/*", "proposals/protocol/*", "proposals/gates/*"];
const TICKET_TARGETS = ["issues/*"];

function receiptsDirFor(stateDir: string, id: string): string {
  return join(stateDir, "receipts", id.split(":").join("-"));
}

function registration(
  adapter: PublicationDestination,
  effectClass: "context" | "proposal",
  patterns: readonly string[],
  rule: string,
  wrap: ((adapter: PublicationDestination) => PublicationDestination) | undefined,
): DestinationRegistration {
  const wrapped = wrap === undefined ? adapter : wrap(adapter);
  if (wrapped.id !== adapter.id) throw new Error("learning-loop: a destination wrapper must keep the adapter id");
  return {
    adapter: wrapped,
    effectClass,
    riskFloor: "T0",
    permittedTargetPatterns: [...patterns],
    authorizationRuleId: rule,
    contentPolicyId: OKF_CONTENT_POLICY_ID,
  };
}

export function createCormidiaLearningLoop(input: CormidiaLearningLoopInput): CormidiaLearningLoop {
  const stateDir = learningLoopStateDir(input.stateHome);
  const clockOption = input.clock !== undefined ? { clock: input.clock } : {};
  const identity = createCormidiaIdentityPort();
  const episodes = defineSourceRegistration({
    source: createEpisodeEvidenceSource(),
    trustCeiling: "observed",
    contentPolicyId: OKF_CONTENT_POLICY_ID,
  });
  const apps = [...(input.apps ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  const orgRoot = orgLearningRoot(input.orgHome);
  const destinations: DestinationRegistration[] = [];
  const okfApps: Record<string, string> = {};

  const okfOrgId = "okf-concept:org";
  destinations.push(
    registration(
      createOkfConceptDestination({
        id: okfOrgId,
        root: orgRoot,
        defaultScope: "org",
        receiptsDir: receiptsDirFor(stateDir, okfOrgId),
        ...clockOption,
      }),
      "context",
      ORG_TARGETS,
      LEARNING_LOOP_PUBLISH_RULE,
      input.wrapDestination,
    ),
    registration(
      createProposalDestination({
        id: "proposal:org",
        root: orgRoot,
        receiptsDir: receiptsDirFor(stateDir, "proposal:org"),
        ...clockOption,
      }),
      "proposal",
      PROPOSAL_TARGETS,
      LEARNING_LOOP_ROUTINE_RULE,
      input.wrapDestination,
    ),
  );
  for (const app of apps) {
    const root = appLearningRoot(app.workdir);
    const okfId = `okf-concept:app:${app.name}`;
    okfApps[app.name] = okfId;
    destinations.push(
      registration(
        createOkfConceptDestination({
          id: okfId,
          root,
          defaultScope: `apps/${app.name}`,
          receiptsDir: receiptsDirFor(stateDir, okfId),
          ...clockOption,
        }),
        "context",
        APP_TARGETS,
        LEARNING_LOOP_PUBLISH_RULE,
        input.wrapDestination,
      ),
      registration(
        createProposalDestination({
          id: `proposal:app:${app.name}`,
          root,
          receiptsDir: receiptsDirFor(stateDir, `proposal:app:${app.name}`),
          ...clockOption,
        }),
        "proposal",
        PROPOSAL_TARGETS,
        LEARNING_LOOP_ROUTINE_RULE,
        input.wrapDestination,
      ),
      registration(
        createTicketDestination({
          id: `ticket:app:${app.name}`,
          receiptsDir: receiptsDirFor(stateDir, `ticket:app:${app.name}`),
          gh: app.gh ?? (() => undefined),
          caps: input.policy.destinations.ticket,
          ...clockOption,
        }),
        "proposal",
        TICKET_TARGETS,
        LEARNING_LOOP_ROUTINE_RULE,
        input.wrapDestination,
      ),
    );
  }
  const replayExecutor =
    input.replayRunner !== undefined ? createCormidiaReplayExecutor(input.replayRunner) : undefined;
  const loop = createLearningLoop({
    store: createFileStore({ rootDir: join(stateDir, "store") }),
    policy: conservativePolicy(),
    identity,
    scopePolicy: cormidiaScopePolicy(),
    contentPolicies: [createOkfContentPolicy()],
    sources: [episodes],
    destinations,
    authority: createCormidiaAuthorityPort(input.approvals, clockOption),
    ...(replayExecutor !== undefined ? { replayExecutors: [replayExecutor] } : {}),
    queryCursorScope: `cormidia:${input.org}`,
    ...clockOption,
    ...(input.ids !== undefined ? { ids: input.ids } : {}),
  });
  return {
    loop,
    identity,
    episodes,
    destinations: { org: okfOrgId, apps: okfApps },
    stateDir,
    orgHome: input.orgHome,
    stateHome: input.stateHome,
    org: input.org,
    apps,
    ...(replayExecutor !== undefined ? { replayExecutorDigest: replayExecutor.registrationDigest } : {}),
  };
}
