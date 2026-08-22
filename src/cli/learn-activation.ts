// `cormidia learn` M4 verbs — the manual governed-activation surface
// (docs/learning-loop/learning-loop-design.md § Bootstrap M4): review, publish,
// resolve, disable, rollback, provisional. Split from learn.ts so the M1-M3
// capture/episode window and the M4 write path stay separately readable;
// learn.ts dispatches here. Since Cormidia #467 phase B every governed
// transition runs on the vendored learning kernel through the adapter layer
// (src/org/learning-loop/): a review mints the kernel candidate and its
// decisive review, publish drives the content-bound plan and journaled
// publish, and disable/rollback of a kernel activation are kernel reversal
// plans authorized by the operator lane. Forked-engine (legacy) activations
// keep their direct manifest operations (compatibility policy §3a).

import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { resolveAppWorkdir } from "../org/app-workdir.js";
import { ApprovalStore } from "../org/approvals.js";
import type { CormidiaHomes } from "../org/home.js";
import { publishPlanIdOf } from "../org/learning-loop/authority.js";
import { composeLearningLoop } from "../org/learning-loop/compose.js";
import { listHostCandidateIndexes } from "../org/learning-loop/host-index.js";
import { legacyPublishBindingOf } from "../org/learning-loop/legacy.js";
import { learningLoopStateDir, type CormidiaLearningLoop } from "../org/learning-loop/loop.js";
import { disableOkfActivation, findOkfActivationForConcept } from "../org/learning-loop/okf-lineage.js";
import { publishCandidate, type PublishDeps } from "../org/learning-loop/publish.js";
import { prepareKernelCandidate } from "../org/learning-loop/publish-prepare.js";
import {
  candidateArtifactPath,
  findCandidateArtifact,
  listCandidateArtifacts,
} from "../org/learning/candidate-store.js";
import {
  appLearningRoot,
  disableConcept,
  orgLearningRoot,
  provisionalExpiry,
  readManifest,
  rollbackRoot,
  scopeApp,
  writeProvisionalConcept,
  type LearningRoot,
} from "../org/learning/concepts.js";
import { loadLearningPolicy, type LearningPolicy } from "../org/learning/policy.js";
import { appendRejection, readRejections } from "../org/learning/rejections.js";
import { resolveLearningContext } from "../org/learning/resolver.js";
import {
  listReviewerVerdicts,
  reviewDisposition,
  writeReviewerVerdict,
  type ReviewerVerdict,
} from "../org/learning/review.js";
import type { OkfDocument } from "../org/memory.js";
import { definedProps } from "../runtime/optional-properties.js";

export interface Flags {
  values: Map<string, string[]>;
  positionals: string[];
}

export function parseFlags(args: string[], command: string): Flags {
  const values = new Map<string, string[]>();
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg.startsWith("--")) {
      const value = args[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${command}: ${arg} requires a value`);
      }
      values.set(arg.slice(2), [...(values.get(arg.slice(2)) ?? []), value]);
      i++;
    } else {
      positionals.push(arg);
    }
  }
  return { values, positionals };
}

export function flag(flags: Flags, name: string): string | undefined {
  return flags.values.get(name)?.at(-1);
}

export function requireFlag(flags: Flags, name: string, command: string): string {
  const value = flag(flags, name);
  if (value === undefined) throw new Error(`${command}: --${name} is required`);
  return value;
}

/** Org root plus every registered app with a resolvable local checkout. */
export function learningRoots(homes: CormidiaHomes): {
  orgRoot: LearningRoot;
  appRoots: Record<string, LearningRoot>;
} {
  const appRoots: Record<string, LearningRoot> = {};
  for (const app of homes.appsFile.apps) {
    try {
      appRoots[app.name] = appLearningRoot(
        resolveAppWorkdir(app, { orgRoot: homes.orgHome, runtimeHome: homes.stateHome }),
      );
    } catch {
      // No local checkout — the app's scopes are unreachable from this CLI.
    }
  }
  return { orgRoot: orgLearningRoot(homes.orgHome), appRoots };
}

/** The composed kernel loop plus the deps every kernel-path verb shares. */
async function kernelDeps(
  homes: CormidiaHomes,
  options: { readonly ticketApp?: string; readonly actor?: string } = {},
): Promise<PublishDeps & { readonly learning: CormidiaLearningLoop }> {
  const policy = await loadLearningPolicy(homes.orgHome);
  const approvals = new ApprovalStore(homes.stateHome);
  const learning = await composeLearningLoop(homes, { approvals, policy });
  return {
    learning,
    policy,
    approvals,
    appRoots: learningRoots(homes).appRoots,
    ...definedProps({ ticketApp: options.ticketApp }),
    ...definedProps({ actor: options.actor }),
  };
}

// ---------------------------------------------------------------------------
// review
// ---------------------------------------------------------------------------

export async function learnReview(homes: CormidiaHomes, args: string[]): Promise<number> {
  const flags = parseFlags(args, "learn review");
  const candidateId = flags.positionals[0];
  if (candidateId === undefined) throw new Error("learn review: <candidate-id> is required");
  const { orgRoot, appRoots } = learningRoots(homes);
  const found = await findCandidateArtifact([orgRoot, ...Object.values(appRoots)], candidateId);
  if (found === undefined) {
    console.error(`learn review: no candidate ${candidateId} in any learning root`);
    return 1;
  }
  const candidate = found.candidate;

  let verdictSpec: Record<string, unknown>;
  const file = flag(flags, "file");
  if (file !== undefined) {
    verdictSpec = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  } else {
    const by = requireFlag(flags, "by", "learn review");
    const word = requireFlag(flags, "verdict", "learn review");
    const rubric: Record<string, unknown> = {
      correctness: 3,
      generality: 3,
      scope_fit: 3,
      destination_fit: 3,
      provenance_trust: 3,
      injection_screen: flag(flags, "injection") ?? "clean",
    };
    for (const pair of (flag(flags, "rubric") ?? "").split(",").filter((p) => p !== "")) {
      const [key, value] = pair.split("=");
      if (key === undefined || value === undefined || Number.isNaN(Number(value))) {
        throw new Error(`learn review: --rubric entries must be key=0..5, got "${pair}"`);
      }
      rubric[key.trim()] = Number(value);
    }
    verdictSpec = {
      schema_version: 1,
      candidate_id: candidateId,
      verdict: word,
      proposed_destination: flag(flags, "destination") ?? candidate.destination,
      proposed_tier: flag(flags, "tier") ?? candidate.proposed_tier,
      proposed_scope: flag(flags, "scope") ?? candidate.proposed_scope,
      experiment_required: candidate.claims_efficacy,
      rubric,
      conflicts_with: [],
      duplicates: [],
      eval_required: false,
      eval_present: candidate.experiment_ref !== null,
      rationale: requireFlag(flags, "rationale", "learn review"),
      reviewed_by: by,
      reviewed_at: new Date().toISOString(),
    };
  }

  const verdict = await writeReviewerVerdict(homes.orgHome, verdictSpec);
  const disposition = reviewDisposition(verdict);
  console.log(`recorded review for ${candidateId}: ${verdict.verdict} → disposition ${disposition}`);
  if (verdict.rubric.injection_screen !== "clean") {
    console.log(`  injection screen "${verdict.rubric.injection_screen}" — escalates regardless of verdict (spec §15)`);
  }
  if (disposition === "reject") {
    const entry = await appendRejection(homes.orgHome, {
      candidate,
      reason: verdict.rationale,
      by: verdict.reviewed_by,
    });
    console.log(`  rejection recorded (suppress key "${entry.suppress_key}"; window per policy §13)`);
    return 0;
  }
  // The verdict file is the evidence; the kernel review is the governed fact.
  const deps = await kernelDeps(homes, definedProps({ ticketApp: flag(flags, "app") }));
  const prepared = await prepareKernelCandidate(deps, candidateId, { requireProceed: false });
  if (prepared.status === "refused") {
    console.error(`learn review: kernel review not recorded — ${prepared.reason}`);
    return 1;
  }
  if (prepared.status === "prepared") {
    console.log(
      `  kernel candidate ${prepared.prepared.kernelCandidateId} reviewed: ${prepared.prepared.reviewDisposition}`,
    );
  }
  if (disposition === "proceed") console.log(`  next: cormidia learn publish ${candidateId}`);
  return 0;
}

// ---------------------------------------------------------------------------
// publish
// ---------------------------------------------------------------------------

export async function learnPublish(homes: CormidiaHomes, args: string[]): Promise<number> {
  const flags = parseFlags(args, "learn publish");
  const candidateId = flags.positionals[0];
  if (candidateId === undefined) throw new Error("learn publish: <candidate-id> is required");
  const deps = await kernelDeps(homes, {
    ...definedProps({ ticketApp: flag(flags, "app") }),
    ...definedProps({ actor: flag(flags, "by") }),
  });
  const waiver = flag(flags, "waiver");
  const outcome = await publishCandidate(deps, candidateId, { ...definedProps({ waiver }) });

  switch (outcome.status) {
    case "published": {
      const destination = outcome.intervention.routing?.destination ?? "unknown";
      console.log(
        `published ${candidateId} → ${destination} (${outcome.refs.join(", ")}); intervention ${outcome.intervention.id}`,
      );
      if (outcome.intervention.claimLabel !== undefined) {
        console.log(`  activation claim: ${outcome.intervention.claimLabel}`);
      }
      console.log(`  trace it with: cormidia learn show ${outcome.intervention.id}`);
      return 0;
    }
    case "rejected":
      console.log(
        `candidate ${candidateId} routed to the rejection ledger (suppress key "${outcome.entry.suppress_key}")`,
      );
      return 0;
    case "raised":
      console.log(
        `raised content-bound approval ${outcome.approvalId} — decide with \`cormidia approvals\`, ` +
          `then re-run: cormidia learn publish ${candidateId}`,
      );
      return 0;
    case "awaiting_approval":
      console.log(`approval ${outcome.approvalId} is still pending — decide with \`cormidia approvals\``);
      return 0;
    case "denied":
      console.error(
        `approval ${outcome.approvalId} was denied${outcome.reason !== undefined ? `: ${outcome.reason}` : ""}`,
      );
      return 1;
    case "refused":
      console.error(`learn publish: ${outcome.reason}`);
      return 1;
  }
}

// ---------------------------------------------------------------------------
// resolve (dry run — what would this turn load?)
// ---------------------------------------------------------------------------

export async function learnResolve(homes: CormidiaHomes, args: string[]): Promise<number> {
  const flags = parseFlags(args, "learn resolve");
  const app = requireFlag(flags, "app", "learn resolve");
  const role = requireFlag(flags, "role", "learn resolve");
  const appEntry = homes.appsFile.apps.find((a) => a.name === app);
  let appWorkdir: string | undefined;
  if (appEntry !== undefined) {
    try {
      appWorkdir = resolveAppWorkdir(appEntry, {
        orgRoot: homes.orgHome,
        runtimeHome: homes.stateHome,
      });
    } catch {
      // Org scopes still resolve without a checkout.
    }
  }
  const resolved = await resolveLearningContext({
    orgHome: homes.orgHome,
    ...definedProps({ appWorkdir }),
    app,
    role,
    turnId: "dry-resolve",
    episodeId: `ep_${app}_turn_dry-resolve`,
    taskText: flag(flags, "task") ?? `${role} turn for ${app}`,
    policy: await loadLearningPolicy(homes.orgHome),
    // No stateHome: a dry resolve emits no events, pins nothing, and asks
    // the kernel for no receipt.
  });
  console.log(
    `resolve(${app}, ${role}) — versions ${JSON.stringify(resolved.bundle_versions)}, ` +
      `lineage ${resolved.bundle_lineage}, ${resolved.context_bytes} bytes used, ` +
      `${resolved.bytes_remaining} remaining for legacy memory`,
  );
  if (resolved.concept_ids.length === 0) {
    console.log("  no governed concepts resolve for this (app, role) yet");
  }
  for (const section of resolved.sections) {
    console.log("");
    console.log(section);
  }
  return 0;
}

// ---------------------------------------------------------------------------
// disable / rollback
// ---------------------------------------------------------------------------

export async function learnDisable(homes: CormidiaHomes, args: string[]): Promise<number> {
  const flags = parseFlags(args, "learn disable");
  const conceptId = flags.positionals[0];
  if (conceptId === undefined) throw new Error("learn disable: <concept-id> is required");
  const { orgRoot, appRoots } = learningRoots(homes);
  const roots: Array<readonly [string, LearningRoot]> = [["org", orgRoot] as const, ...Object.entries(appRoots)];
  const deps = await kernelDeps(homes);
  const activation = await findOkfActivationForConcept(
    deps.learning,
    roots.map(([, root]) => root),
    conceptId,
  );
  if (activation !== undefined) {
    const result = await disableOkfActivation(deps.learning, activation, flag(flags, "by") ?? "operator");
    if ("refused" in result) {
      console.error(`learn disable: ${result.refused}`);
      return 1;
    }
    console.log(`disabled ${conceptId} (${activation.root.kind} root, version ${result.version})`);
    console.log(`  kernel intervention ${activation.intervention.id} disabled through an operator-authorized plan`);
    console.log("  takes effect for every subsequently resolved turn; in-flight turns keep their pin");
    return 0;
  }
  for (const [name, root] of roots) {
    const result = await disableConcept(root, conceptId);
    if (result === undefined) continue;
    console.log(`disabled ${conceptId} (${name} root, version ${result.version}; forked-engine activation)`);
    console.log(`  ${result.path}`);
    console.log("  takes effect for every subsequently resolved turn; in-flight turns keep their pin");
    return 0;
  }
  console.error(`learn disable: no active concept ${conceptId} in any bundle`);
  return 1;
}

export async function learnRollback(homes: CormidiaHomes, args: string[]): Promise<number> {
  const flags = parseFlags(args, "learn rollback");
  const rootKind = requireFlag(flags, "root", "learn rollback");
  if (rootKind !== "org" && rootKind !== "app") {
    throw new Error('learn rollback: --root must be "org" or "app"');
  }
  let root: LearningRoot;
  if (rootKind === "org") {
    root = orgLearningRoot(homes.orgHome);
  } else {
    const app = requireFlag(flags, "app", "learn rollback");
    const { appRoots } = learningRoots(homes);
    const appRoot = appRoots[app];
    if (appRoot === undefined) {
      console.error(`learn rollback: no local checkout for app "${app}"`);
      return 1;
    }
    root = appRoot;
  }
  const manifest = await readManifest(root);
  const last = manifest?.history.at(-1);
  if (last === undefined) {
    console.error(`learn rollback: the ${rootKind} root has no version cuts to roll back`);
    return 1;
  }
  const deps = await kernelDeps(homes);
  const identity = flag(flags, "by") ?? "operator";
  const kernelCuts = await Promise.all(
    last.concepts.map(async (conceptId) => ({
      conceptId,
      activation: await findOkfActivationForConcept(deps.learning, [root], conceptId),
    })),
  );
  if (kernelCuts.every((cut) => cut.activation === undefined)) {
    const result = await rollbackRoot(root);
    console.log(
      `rolled back ${result.revertedVersion} → new version ${result.newVersion}; ` +
        `deactivated: ${result.deactivated.join(", ") || "(none still active)"}`,
    );
    return 0;
  }
  // The latest cut activated kernel interventions: each reverses through
  // its own operator-authorized disable plan (one cut each, journaled by the
  // kernel); a forked-engine concept sharing the cut is deprecated directly.
  for (const cut of kernelCuts) {
    if (cut.activation !== undefined) {
      const result = await disableOkfActivation(deps.learning, cut.activation, identity);
      if ("refused" in result) {
        console.error(`learn rollback: ${cut.conceptId}: ${result.refused}`);
        return 1;
      }
      console.log(`rolled back ${last.version}: disabled ${cut.conceptId} → version ${result.version} (kernel)`);
    } else {
      const result = await disableConcept(root, cut.conceptId);
      console.log(
        result === undefined
          ? `rolled back ${last.version}: ${cut.conceptId} was already inactive`
          : `rolled back ${last.version}: disabled ${cut.conceptId} → version ${result.version}`,
      );
    }
  }
  return 0;
}

// ---------------------------------------------------------------------------
// provisional — the urgent human lane (design §7, §10.1)
// ---------------------------------------------------------------------------

export async function learnProvisional(homes: CormidiaHomes, args: string[]): Promise<number> {
  const flags = parseFlags(args, "learn provisional");
  const scope = requireFlag(flags, "scope", "learn provisional");
  const name = requireFlag(flags, "name", "learn provisional");
  const by = requireFlag(flags, "by", "learn provisional");
  const ttl = Number(requireFlag(flags, "ttl-days", "learn provisional"));
  const bodyFile = flag(flags, "file");
  const body = bodyFile !== undefined ? await readFile(bodyFile, "utf8") : flag(flags, "body");
  if (body === undefined || body.trim() === "") {
    throw new Error("learn provisional: --body <text> or --file <md> is required");
  }
  const today = new Date().toISOString().slice(0, 10);
  const tier = flag(flags, "tier") ?? "T1";
  if (tier !== "T0" && tier !== "T1" && tier !== "T2" && tier !== "T3") {
    throw new Error("learn provisional: --tier must be T0, T1, T2, or T3");
  }
  const doc: OkfDocument = {
    frontmatter: {
      name,
      description: requireFlag(flags, "description", "learn provisional"),
      type: "lesson",
      keywords: (flag(flags, "keywords") ?? "")
        .split(",")
        .map((k) => k.trim())
        .filter((k) => k !== ""),
      evidence: flags.values.get("evidence") ?? [],
      status: "active",
      created: today,
      updated: today,
      loop: {
        id: `lrn_${today.replaceAll("-", "")}_${Math.random().toString(36).slice(2, 8)}`,
        tier,
        status: "provisional",
        scope,
        version: 1,
        claim: "authorized",
        ttl_days: ttl,
        author: by,
      },
    },
    body: body.trim() + "\n",
  };
  const { orgRoot, appRoots } = learningRoots(homes);
  const app = scopeApp(scope);
  const root = app !== undefined ? appRoots[app] : orgRoot;
  if (root === undefined) {
    console.error(`learn provisional: no local checkout for the app in scope "${scope}"`);
    return 1;
  }
  const policy = await loadLearningPolicy(homes.orgHome);
  const path = await writeProvisionalConcept(root, { doc, policy });
  console.log(`quarantined provisional ${doc.frontmatter.loop?.id ?? name} (${basename(path)})`);
  console.log(`  ${path}`);
  console.log(
    // provisionalExpiry is the same computation the resolver enforces — the
    // printed date can never drift from the honored one.
    `  renders under "${policy.quarantine.context_label}" until ` +
      `${provisionalExpiry(doc).toISOString().slice(0, 10)}; ` +
      "it never silently promotes (design §7)",
  );
  return 0;
}

// ---------------------------------------------------------------------------
// report sections (activation, review SLA, agreement)
// ---------------------------------------------------------------------------

interface ActivationReport {
  pendingReview: Array<{ candidate_id: string; ageHours: number; overSla: boolean }>;
  slaHours: number;
  agreement: { compared: number; agreed: number };
  suppressions: number;
}

export async function activationReport(
  homes: CormidiaHomes,
  policy: LearningPolicy,
  /** Already-loaded verdicts (the report reads them once for its Reviews
   *  section); omitted, they load here. */
  verdicts?: ReviewerVerdict[],
  now: Date = new Date(),
): Promise<ActivationReport> {
  const { orgRoot, appRoots } = learningRoots(homes);
  const roots = [orgRoot, ...Object.values(appRoots)];
  const allVerdicts = verdicts ?? (await listReviewerVerdicts(homes.orgHome));
  const reviewed = new Set(allVerdicts.map((verdict) => verdict.candidate_id));

  const pendingReview: ActivationReport["pendingReview"] = [];
  for (const root of roots) {
    for (const candidate of await listCandidateArtifacts(root)) {
      if (reviewed.has(candidate.candidate_id)) continue;
      const path = candidateArtifactPath(root, candidate.candidate_id);
      const ageMs = existsSync(path) ? now.getTime() - (await stat(path)).mtime.getTime() : 0;
      const ageHours = ageMs / (60 * 60 * 1000);
      pendingReview.push({
        candidate_id: candidate.candidate_id,
        ageHours,
        overSla: ageHours > policy.reviewer_sla_hours,
      });
    }
  }

  // Reviewer-human agreement (spec §18): compare each verdict with the human
  // decision on the same candidate's publish approval — the kernel-path
  // `learning_loop_publish` item (via the host index's plan ids) or the
  // forked engine's `learning_publish` item (compatibility reader).
  const store = new ApprovalStore(homes.stateHome);
  const decided = await store.listDecidedReadOnly();
  const planOwners = new Map<string, string>();
  for (const index of await listHostCandidateIndexes(learningLoopStateDir(homes.stateHome))) {
    for (const entry of index.entries)
      if (entry.plan_id !== undefined) planOwners.set(entry.plan_id, index.artifact_id);
  }
  const ownerOf = (item: (typeof decided)[number]): string | undefined => {
    const planId = publishPlanIdOf(item);
    if (planId !== undefined) return planOwners.get(planId);
    return legacyPublishBindingOf(item)?.candidate_id;
  };
  let compared = 0;
  let agreed = 0;
  for (const verdict of allVerdicts) {
    const item = decided.filter((entry) => ownerOf(entry) === verdict.candidate_id).at(-1);
    if (item === undefined || item.decision === undefined) continue;
    compared++;
    const reviewerSaysYes = reviewDisposition(verdict) === "proceed";
    const humanSaysYes = item.decision === "approved";
    if (reviewerSaysYes === humanSaysYes) agreed++;
  }

  const suppressions = (await readRejections(homes.orgHome)).length;

  return { pendingReview, slaHours: policy.reviewer_sla_hours, agreement: { compared, agreed }, suppressions };
}

export function renderVerdictLine(verdict: ReviewerVerdict): string {
  return (
    `  ${verdict.candidate_id}: ${verdict.verdict} → ${verdict.proposed_destination} ` +
    `(tier ${verdict.proposed_tier}, scope ${verdict.proposed_scope}) by ${verdict.reviewed_by}`
  );
}
