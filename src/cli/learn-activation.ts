// `cormidia learn` M4 verbs — the manual governed-activation surface
// (docs/learning-loop/learning-loop-design.md § Bootstrap M4): review, publish,
// resolve, disable, rollback, provisional. Split from learn.ts so the M1-M3
// capture/episode window and the M4 write path stay separately readable;
// learn.ts dispatches here.

import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { GhCliOps } from "../loop/github.js";
import { resolveAppWorkdir } from "../org/app-workdir.js";
import { ApprovalStore } from "../org/approvals.js";
import type { CormidiaHomes } from "../org/home.js";
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
  rollbackRoot,
  scopeApp,
  writeProvisionalConcept,
  type LearningRoot,
} from "../org/learning/concepts.js";
import { loadLearningPolicy, type LearningPolicy } from "../org/learning/policy.js";
import { bindingOf } from "../org/learning/binding.js";
import { publishCandidate, type PublisherDeps } from "../org/learning/publisher.js";
import { appendRejection, readRejections } from "../org/learning/rejections.js";
import { resolveLearningContext } from "../org/learning/resolver.js";
import {
  listReviewerVerdicts,
  readReviewerVerdict,
  reviewDisposition,
  writeReviewerVerdict,
  type ReviewerVerdict,
} from "../org/learning/review.js";
import type { OkfDocument } from "../org/memory.js";

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
  } else if (disposition === "proceed") {
    console.log(`  next: cormidia learn publish ${candidateId}`);
  }
  return 0;
}

// ---------------------------------------------------------------------------
// publish
// ---------------------------------------------------------------------------

export async function learnPublish(homes: CormidiaHomes, args: string[]): Promise<number> {
  const flags = parseFlags(args, "learn publish");
  const candidateId = flags.positionals[0];
  if (candidateId === undefined) throw new Error("learn publish: <candidate-id> is required");
  const { orgRoot, appRoots } = learningRoots(homes);
  const policy = await loadLearningPolicy(homes.orgHome);

  // Tickets land in the repo of the scope's app (or --repo). The gh client
  // is optional — only the ticket destination needs it.
  let repo = flag(flags, "repo");
  if (repo === undefined) {
    const verdict = await readReviewerVerdict(homes.orgHome, candidateId);
    const app = verdict !== undefined ? scopeApp(verdict.proposed_scope) : undefined;
    if (app !== undefined) {
      repo = homes.appsFile.apps.find((a) => a.name === app)?.repo;
    }
  }

  const deps: PublisherDeps = {
    orgHome: homes.orgHome,
    stateHome: homes.stateHome,
    policy,
    approvals: new ApprovalStore(homes.stateHome),
    appRoots,
    ...(repo !== undefined && repo.includes("/") && !repo.startsWith("/") && !repo.startsWith(".")
      ? { gh: new GhCliOps(repo), repo }
      : {}),
  };
  const waiver = flag(flags, "waiver");
  const outcome = await publishCandidate(deps, candidateId, {
    ...(waiver !== undefined ? { waiver } : {}),
  });

  switch (outcome.status) {
    case "published":
      console.log(
        `published ${candidateId} → ${outcome.intervention.destination} ` +
          `(${outcome.refs.join(", ")}); intervention ${outcome.intervention.intervention_id}`,
      );
      if (outcome.intervention.activation !== null) {
        console.log(
          `  activation claim: ${outcome.intervention.activation.claim === "validated" ? "validated" : "authorized (unproven)"}`,
        );
      }
      console.log(`  trace it with: cormidia learn show ${outcome.intervention.intervention_id}`);
      return 0;
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
    ...(appWorkdir !== undefined ? { appWorkdir } : {}),
    app,
    role,
    turnId: "dry-resolve",
    episodeId: `ep_${app}_turn_dry-resolve`,
    taskText: flag(flags, "task") ?? `${role} turn for ${app}`,
    policy: await loadLearningPolicy(homes.orgHome),
    // No stateHome: a dry resolve emits no events and pins nothing.
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
  for (const [name, root] of [["org", orgRoot] as const, ...Object.entries(appRoots)]) {
    const result = await disableConcept(root, conceptId);
    if (result === undefined) continue;
    console.log(`disabled ${conceptId} (${name} root, version ${result.version})`);
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
  const result = await rollbackRoot(root);
  console.log(
    `rolled back ${result.revertedVersion} → new version ${result.newVersion}; ` +
      `deactivated: ${result.deactivated.join(", ") || "(none still active)"}`,
  );
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
        tier: (flag(flags, "tier") ?? "T1") as "T0" | "T1" | "T2" | "T3",
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
  console.log(`quarantined provisional ${doc.frontmatter.loop!.id} (${basename(path)})`);
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

export interface ActivationReport {
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
  // decision on the same candidate's learning_publish approval.
  const store = new ApprovalStore(homes.stateHome);
  const decided = await store.listDecidedReadOnly();
  let compared = 0;
  let agreed = 0;
  for (const verdict of allVerdicts) {
    const item = decided.filter((entry) => bindingOf(entry)?.candidate_id === verdict.candidate_id).at(-1);
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
