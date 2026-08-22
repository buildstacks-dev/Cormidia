// Composition root: one Cormidia org's learning loop on the governed-learning-
// loop kernel (@cormidia/learning-loop, vendored per governed-learning-loop
// Decision 0029 R7). This is the migration's seam (Cormidia #467, extraction
// plan §Phase 4): Cormidia code composes host adapters onto the kernel's
// public ports; the kernel never imports upward. Phase A wires the adapters
// beside the forked engine under src/org/learning/ — it is a second path,
// not yet the operator path; phase B cuts over and retires the fork.
//
// State placement (compatibility policy, research/2026-08-21_learning-loop-
// migration-compatibility-policy.md): the kernel's own records live under
// `<state home>/learning-loop/` and touch no governed org-home surface; the
// only org-home writes are the OKF destination's — the same concept bytes and
// manifest cuts the forked publisher writes, at the same paths.

import { join } from "node:path";
import { conservativePolicy, createLearningLoop, defineSourceRegistration } from "@cormidia/learning-loop";
import type {
  Clock,
  DestinationRegistration,
  IdGenerator,
  IdentityPort,
  LearningLoop,
  RegisteredSource,
} from "@cormidia/learning-loop";
import { createFileStore } from "@cormidia/learning-loop/node";
import type { ApprovalStore } from "../approvals.js";
import { appLearningRoot, orgLearningRoot, type LearningRoot } from "../learning/concepts.js";
import { createCormidiaAuthorityPort, LEARNING_LOOP_PUBLISH_RULE } from "./authority.js";
import { createOkfContentPolicy, OKF_CONTENT_POLICY_ID } from "./content-policy.js";
import { createOkfConceptDestination } from "./destination-okf.js";
import { createEpisodeEvidenceSource, type EpisodeEvidenceInput } from "./evidence-source.js";
import { createCormidiaIdentityPort } from "./identity.js";
import { createCormidiaReplayExecutor, type CormidiaReplayRunner } from "./replay-executor.js";
import { cormidiaScopePolicy } from "./scope.js";

export interface CormidiaLearningLoopInput {
  readonly orgHome: string;
  readonly stateHome: string;
  /** The org name (`~/.cormidia/<org>`): the scope isolation segment. */
  readonly org: string;
  readonly approvals: ApprovalStore;
  /** Registered apps whose `.cormidia/learning` bundle is a destination. */
  readonly apps?: readonly { readonly name: string; readonly workdir: string }[];
  /** Absent means no experiment can run (phase B binds the loop replay). */
  readonly replayRunner?: CormidiaReplayRunner;
  readonly clock?: Clock;
  readonly ids?: IdGenerator;
}

export interface CormidiaLearningLoop {
  readonly loop: LearningLoop;
  readonly identity: IdentityPort;
  readonly episodes: RegisteredSource<EpisodeEvidenceInput>;
  /** Destination ids: the org bundle and one per registered app. */
  readonly destinations: { readonly org: string; readonly apps: Readonly<Record<string, string>> };
  readonly stateDir: string;
}

/** `<state home>/learning-loop` — every kernel-owned byte lives below it. */
export function learningLoopStateDir(stateHome: string): string {
  return join(stateHome, "learning-loop");
}

const ORG_TARGETS = ["bundle/org/*", "bundle/roles/*/*"];
const APP_TARGETS = ["bundle/apps/*/*", "bundle/apps/*/roles/*/*"];

function okfRegistration(
  id: string,
  root: LearningRoot,
  defaultScope: string,
  stateDir: string,
  patterns: readonly string[],
  clock: Clock | undefined,
): DestinationRegistration {
  const adapter = createOkfConceptDestination({
    id,
    root,
    defaultScope,
    receiptsDir: join(stateDir, "receipts", id.split(":").join("-")),
    ...(clock !== undefined ? { clock } : {}),
  });
  return {
    adapter,
    effectClass: "context",
    riskFloor: "T0",
    permittedTargetPatterns: [...patterns],
    authorizationRuleId: LEARNING_LOOP_PUBLISH_RULE,
    contentPolicyId: OKF_CONTENT_POLICY_ID,
  };
}

export function createCormidiaLearningLoop(input: CormidiaLearningLoopInput): CormidiaLearningLoop {
  const stateDir = learningLoopStateDir(input.stateHome);
  const identity = createCormidiaIdentityPort();
  const episodes = defineSourceRegistration({
    source: createEpisodeEvidenceSource(),
    trustCeiling: "observed",
    contentPolicyId: OKF_CONTENT_POLICY_ID,
  });
  const orgRegistration = okfRegistration(
    "okf-concept:org",
    orgLearningRoot(input.orgHome),
    "org",
    stateDir,
    ORG_TARGETS,
    input.clock,
  );
  const appRegistrations = (input.apps ?? []).map((app) => ({
    name: app.name,
    registration: okfRegistration(
      `okf-concept:app:${app.name}`,
      appLearningRoot(app.workdir),
      `apps/${app.name}`,
      stateDir,
      APP_TARGETS,
      input.clock,
    ),
  }));
  const destinations = [orgRegistration, ...appRegistrations.map((entry) => entry.registration)];
  const loop = createLearningLoop({
    store: createFileStore({ rootDir: join(stateDir, "store") }),
    policy: conservativePolicy(),
    identity,
    scopePolicy: cormidiaScopePolicy(),
    contentPolicies: [createOkfContentPolicy()],
    sources: [episodes],
    destinations,
    authority: createCormidiaAuthorityPort(input.approvals),
    ...(input.replayRunner !== undefined
      ? { replayExecutors: [createCormidiaReplayExecutor(input.replayRunner)] }
      : {}),
    queryCursorScope: `cormidia:${input.org}`,
    ...(input.clock !== undefined ? { clock: input.clock } : {}),
    ...(input.ids !== undefined ? { ids: input.ids } : {}),
  });
  return {
    loop,
    identity,
    episodes,
    destinations: {
      org: orgRegistration.adapter.id,
      apps: Object.fromEntries(appRegistrations.map((entry) => [entry.name, entry.registration.adapter.id])),
    },
    stateDir,
  };
}
