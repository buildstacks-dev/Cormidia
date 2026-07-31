// The learning resolver (docs/learning-loop/learning-loop-spec.md §8, §8.1;
// design §5 "Resolve", §12.1 cache stability).
//
// One resolve per (app, role, turnId, episodeId), at turn/pipeline start;
// the result is pinned for the whole turn — promotion, disable, and rollback
// affect only subsequently started turns. Selection order is deliberate:
//
//   1. GATHER active concepts from the four applicable scopes' bundle dirs,
//      plus unexpired provisionals from quarantine (rendered under the
//      UNVERIFIED label). Expired provisionals are skipped with a
//      `provisional_expired` event — the resolver enforces the TTL, never a
//      compaction footnote. Bundle concepts additionally require a COMMITTED
//      publication — a manifest cut naming the concept id (INV-013, B-11 §3):
//      the publisher writes bundle/<scope> before its manifest cut, and a
//      mid-transaction artifact must never resolve as active.
//   2. RESOLVE CONFLICTS before budgeting: shared topic_key -> the narrower
//      scope wins, the loser is excluded NOW (`conflict_resolved`), so a
//      broad-scope loser can never consume budget that starves the winner.
//   3. BUDGET by per-scope shares; unused share redistributes
//      NARROWEST-FIRST, so apps/<app>/roles/<role> overflow is served before
//      org overflow, never after it.
//   4. Within a scope, order is deterministic (sorted by concept id) — the
//      rendered bundle must be byte-identical for the same (bundle versions,
//      role, app): no timestamps, no turn ids in rendered bytes (§12.1). The
//      resolved-context record lives in the state home, never prompt bytes.
//   5. Concepts an over-budget resolve drops emit `context_evicted`;
//      dropping a protected-tier (T2/T3) concept fails LOUD — the publisher's
//      bundle-size validation exists so this can never fire in a healthy org.
//
// Lineage is episode-sticky (M5, design §8.4): while a root runs a live
// canary, the episode's deterministic bucket — recorded once at first
// resolve — decides whether this turn sees the canary version (the full
// bundle) or the stable version (the bundle minus the trial's concepts).
// Every turn in one episode resolves the same lineage.

import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { writeFileAtomic } from "../atomic.js";
import { keywordsMatchTask, type OkfDocument } from "../memory.js";
import {
  canaryBucket,
  decideRootLineage,
  readCanaryAssignment,
  settleCanaryAssignmentRoot,
  writeCanaryAssignmentOnce,
  type BundleLineage,
  type CanaryAssignmentRecord,
  type CanaryRootKind,
  type RootLineageDecision,
} from "./canary.js";
import {
  appLearningRoot,
  loadConceptDir,
  orgLearningRoot,
  provisionalExpiry,
  quarantineDir,
  readManifest,
  bundleDir,
  type LearningManifest,
  type LearningRoot,
} from "./concepts.js";
import { appendLearningEventsDeduped, sanitizeIdSegment, type LearningEvent } from "./events.js";
import type { LearningPolicy, ScopeShareKey } from "./policy.js";

export interface ResolveInput {
  orgHome: string;
  /** App repo checkout — omitted when the app has none locally (its two
   *  scopes then contribute nothing). */
  appWorkdir?: string;
  app: string;
  role: string;
  turnId: string;
  episodeId: string;
  /** Tie-break relevance inside a scope that overflows its share. */
  taskText: string;
  policy: LearningPolicy;
  /** Caller-imposed hard ceiling on governed-context bytes (context
   *  assembly's memoryCapBytes) — the effective budget is the smaller of
   *  this and the policy budget, so an explicit caller cap always bounds
   *  the combined memory section. */
  budgetCapBytes?: number;
  /** When set, the resolver emits learning events and persists the
   *  resolved-context record; a dry resolve (CLI) omits it. */
  stateHome?: string;
  /** Force a lineage instead of the episode-sticky assignment (M5 replay
   *  arms: control resolves stable regardless of any running trial). No
   *  assignment record is read or written under an override. */
  lineageOverride?: BundleLineage;
  clock?: () => Date;
}

export interface ResolvedConcept {
  id: string;
  name: string;
  scope: string;
  scopeKey: ScopeShareKey;
  tier: string;
  provisional: boolean;
  keywords: string[];
  bytes: number;
  rendered: string;
}

export interface ResolvedLearningContext {
  turn_id: string;
  episode_id: string;
  app: string;
  role: string;
  bundle_versions: Record<string, string>;
  /** `canary` when any root's episode-sticky assignment put this episode in
   *  a running trial (design §8.4). */
  bundle_lineage: BundleLineage;
  concept_ids: string[];
  context_bytes: number;
  /** Rendered blocks in final deterministic order — the context assembler's
   *  memory-excerpt sections. Not part of the persisted record. */
  sections: string[];
  /** Budget left for the legacy memory layer (trust: legacy, lowest
   *  precedence). */
  bytes_remaining: number;
}

const SCOPE_ORDER: Array<{ key: ScopeShareKey; scope: (app: string, role: string) => string }> = [
  { key: "org", scope: () => "org" },
  { key: "role", scope: (_a, role) => `roles/${role}` },
  { key: "app", scope: (app) => `apps/${app}` },
  { key: "app_role", scope: (app, role) => `apps/${app}/roles/${role}` },
];

export function resolvedContextDir(stateHome: string): string {
  return join(stateHome, "learning", "resolved");
}

export function resolvedContextPath(stateHome: string, turnId: string): string {
  return join(resolvedContextDir(stateHome), `${sanitizeIdSegment(turnId)}.json`);
}

export async function resolveLearningContext(input: ResolveInput): Promise<ResolvedLearningContext> {
  const clock = input.clock ?? ((): Date => new Date());
  const orgRoot = orgLearningRoot(input.orgHome);
  const appRoot = input.appWorkdir !== undefined ? appLearningRoot(input.appWorkdir) : undefined;
  const events: LearningEvent[] = [];
  const now = clock();

  // -- lineage before gather (M5, design §8.4) -------------------------------
  // The episode's sticky assignment decides which version-set each root
  // resolves; the stable lineage excludes the running trial's concepts.
  // A root whose manifest cannot be read degrades LOUDLY to contributing
  // nothing (the skip-warn philosophy): a hand-edited manifest.yaml must
  // not wedge context assembly org-wide, and resolving its bundle with an
  // unknowable lineage could leak trial concepts into the control arm.
  const manifests: Partial<Record<CanaryRootKind, LearningManifest | null>> = {};
  const unreadable = new Set<CanaryRootKind>();
  const readRootManifest = async (kind: CanaryRootKind, root: LearningRoot): Promise<void> => {
    try {
      manifests[kind] = await readManifest(root);
    } catch (error) {
      unreadable.add(kind);
      process.stderr.write(
        `learning: skipping the ${kind} learning root this resolve — ` +
          `${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  };
  await readRootManifest("org", orgRoot);
  if (appRoot !== undefined) await readRootManifest("app", appRoot);

  const existingAssignment =
    input.stateHome !== undefined && input.lineageOverride === undefined
      ? await readCanaryAssignment(input.stateHome, input.episodeId)
      : undefined;
  const bucket = existingAssignment?.bucket ?? canaryBucket(input.episodeId);
  const decisions: Partial<Record<CanaryRootKind, RootLineageDecision>> = {};
  // Roots this resolve decided FRESH (no prior entry): recorded on the pin.
  // A root the pin marked undecided (its manifest was unreadable back then)
  // settles at the first resolve that can read it — never re-derives.
  const settleRoots: CanaryRootKind[] = [];
  for (const kind of ["org", "app"] as const) {
    const manifest = manifests[kind];
    if (manifest === undefined) continue;
    // A replay arm forces its lineage: an override reads as a pre-made
    // assignment for the running trial (or plain stable when none runs) —
    // never as a fresh assignment to record. An episode whose assignment
    // record predates this root's trial reads as stable: trials admit only
    // episodes whose FIRST governed resolve happens inside the window —
    // an episode already in flight when the trial starts must not flip
    // lineage mid-episode (design §8.4 stickiness).
    const undecidedHere =
      existingAssignment !== undefined &&
      existingAssignment.roots[kind] === undefined &&
      (existingAssignment.undecided ?? []).includes(kind);
    if (undecidedHere) settleRoots.push(kind);
    const existing =
      input.lineageOverride !== undefined && manifest !== null && manifest.canary !== null
        ? { version: manifest.canary, lineage: input.lineageOverride }
        : existingAssignment !== undefined && !undecidedHere
          ? (existingAssignment.roots[kind] ?? { version: "pre-trial", lineage: "stable" as const })
          : undefined;
    decisions[kind] = decideRootLineage({
      manifest,
      existing,
      bucket,
      now,
    });
  }
  const lineage: BundleLineage = Object.values(decisions).some((d) => d.lineage === "canary")
    ? "canary"
    : "stable";
  const excludedByRoot: Record<CanaryRootKind, Set<string>> = {
    org: new Set(decisions.org?.excluded ?? []),
    app: new Set(decisions.app?.excluded ?? []),
  };

  // INV-013 reader-side guardrail (B-11 §3): a publication is COMMITTED only
  // once its manifest cut lands. The publisher's artifact step writes the
  // activated concept into bundle/<scope> BEFORE the cut, so between those
  // two durable writes the file is on disk while the transaction is still
  // mid-flight — membership of the concept id in a history cut is the commit
  // receipt this resolver requires. A bundle file no cut names (crashed
  // mid-transaction, or hand-placed without a cut) fails closed: it never
  // resolves. Forward-completing a crashed journal (re-run publish) cuts the
  // manifest, after which the concept resolves normally — the recovery path
  // needs nothing from the resolver.
  const committedIds = (manifest: LearningManifest | null | undefined): Set<string> => {
    const ids = new Set<string>();
    for (const entry of manifest?.history ?? []) {
      for (const id of entry.concepts) ids.add(id);
    }
    return ids;
  };
  const committedByRoot: Record<CanaryRootKind, Set<string>> = {
    org: committedIds(manifests.org),
    app: committedIds(manifests.app),
  };

  // -- gather ---------------------------------------------------------------
  const gathered: ResolvedConceptInternal[] = [];
  for (const { key, scope } of SCOPE_ORDER) {
    const scopeName = scope(input.app, input.role);
    const root = key === "org" || key === "role" ? orgRoot : appRoot;
    if (root === undefined) continue;
    const rootKind: CanaryRootKind = key === "org" || key === "role" ? "org" : "app";
    if (unreadable.has(rootKind)) continue;

    // "skip-warn": one malformed governed file degrades that file with a
    // loud stderr line — it must never wedge context assembly for every
    // turn org-wide (the loadBundle precedent for memory docs).
    const dir = join(bundleDir(root), scopeName);
    if (existsSync(dir)) {
      for (const concept of await loadConceptDir(dir, "bundle", { onError: "skip-warn" })) {
        const loop = concept.doc.frontmatter.loop!;
        if (loop.status !== "active" || concept.doc.frontmatter.status !== "active") continue;
        if (loop.scope !== scopeName) continue;
        // Only committed publications resolve (INV-013, B-11 §3): no
        // manifest cut names this id — mid-transaction or never published.
        if (!committedByRoot[rootKind].has(loop.id)) {
          process.stderr.write(
            `learning: skipping bundle concept ${loop.id} (${scopeName}) — no manifest cut ` +
              `names it; its publication is mid-transaction or was never committed (INV-013)\n`,
          );
          continue;
        }
        // Stable lineage never sees the running trial's concepts.
        if (excludedByRoot[rootKind].has(loop.id)) continue;
        gathered.push(toResolved(concept.doc, scopeName, key, false, input));
      }
    }

    // Quarantine is flat per root; provisionals join the scope their
    // loop.scope names. Only visit each root's quarantine once.
    if (key === "org" || key === "app") {
      const qdir = quarantineDir(root);
      if (!existsSync(qdir)) continue;
      for (const concept of await loadConceptDir(qdir, "quarantine", { onError: "skip-warn" })) {
        const loop = concept.doc.frontmatter.loop!;
        const conceptScope = loop.scope;
        const match = SCOPE_ORDER.find((s) => s.scope(input.app, input.role) === conceptScope);
        if (match === undefined) continue; // scoped to another app/role — not this turn's
        const expiry = provisionalExpiry(concept.doc);
        if (expiry.getTime() <= now.getTime()) {
          events.push(
            resolveEvent(input, now, "provisional_expired", `expired-${loop.id}`, {
              concept_id: loop.id,
              scope: conceptScope,
              expired: expiry.toISOString(),
            }),
          );
          continue;
        }
        gathered.push(toResolved(concept.doc, conceptScope, match.key, true, input));
      }
    }
  }

  // -- conflicts before budgeting -------------------------------------------
  const byTopic = new Map<string, ResolvedConceptInternal[]>();
  for (const concept of gathered) {
    const topic = concept.topicKey;
    if (topic === undefined) continue;
    byTopic.set(topic, [...(byTopic.get(topic) ?? []), concept]);
  }
  const excluded = new Set<string>();
  for (const [topic, rivals] of byTopic) {
    if (rivals.length < 2) continue;
    // Narrower scope wins; same scope ties break to the lower id so the
    // outcome never depends on directory read order.
    const winner = [...rivals].sort(
      (a, b) => scopeIndex(b.scopeKey) - scopeIndex(a.scopeKey) || a.id.localeCompare(b.id),
    )[0]!;
    for (const loser of rivals) {
      if (loser.id === winner.id) continue;
      excluded.add(loser.id);
      events.push(
        resolveEvent(input, now, "conflict_resolved", `conflict-${topic}-${loser.id}`, {
          topic_key: topic,
          winner: winner.id,
          winner_scope: winner.scope,
          loser: loser.id,
          loser_scope: loser.scope,
        }),
      );
    }
  }
  const eligible = gathered.filter((concept) => !excluded.has(concept.id));

  // -- budget by scope share, redistribute narrowest-first ------------------
  const policyBudget =
    input.policy.context_budget.roles[input.role] ?? input.policy.context_budget.default_bytes;
  const totalBudget = Math.min(policyBudget, input.budgetCapBytes ?? Infinity);
  const selected = new Set<string>();
  let used = 0;

  const protectedTiers = input.policy.context_budget.eviction.protected_tiers;
  const inScopeOrder = (key: ScopeShareKey): ResolvedConceptInternal[] =>
    eligible
      .filter((concept) => concept.scopeKey === key)
      .sort(
        (a, b) =>
          // Protected tiers select FIRST: the publisher validated that a
          // scope's protected concepts always fit its share, and that check
          // is only sufficient if selection can never let an unprotected
          // concept crowd a protected one into the fail-loud eviction path.
          Number(protectedTiers.includes(b.tier as never)) -
            Number(protectedTiers.includes(a.tier as never)) ||
          // provisional_first eviction => active concepts are selected first;
          Number(a.provisional) - Number(b.provisional) ||
          // keyword relevance is ONLY a tie-breaker inside an overflowing
          // scope (spec §8.1), applied as selection priority here;
          Number(b.keywordHit) - Number(a.keywordHit) ||
          a.id.localeCompare(b.id),
      );

  // Pass 1: each scope fills its own share.
  const skipped: ResolvedConcept[] = [];
  for (const { key } of SCOPE_ORDER) {
    const share = Math.floor(totalBudget * input.policy.context_budget.shares[key]);
    let scopeUsed = 0;
    for (const concept of inScopeOrder(key)) {
      if (scopeUsed + concept.bytes <= share) {
        selected.add(concept.id);
        scopeUsed += concept.bytes;
        used += concept.bytes;
      } else {
        skipped.push(concept);
      }
    }
  }

  // Pass 2: unused share redistributes narrowest-first.
  for (const key of ["app_role", "app", "role", "org"] as ScopeShareKey[]) {
    for (const concept of skipped.filter((c) => c.scopeKey === key)) {
      if (used + concept.bytes <= totalBudget) {
        selected.add(concept.id);
        used += concept.bytes;
      }
    }
  }

  // Anything still dropped is an eviction; protected tiers fail loud.
  for (const concept of eligible) {
    if (selected.has(concept.id)) continue;
    if (protectedTiers.includes(concept.tier as never)) {
      throw new Error(
        `learning: resolve would evict protected ${concept.tier} concept ${concept.id} ` +
          `(scope ${concept.scope}) — protected tiers fail loud (spec §8.1); ` +
          `publish-time validation should have prevented this bundle state`,
      );
    }
    events.push(
      resolveEvent(input, now, "context_evicted", `evict-${concept.id}`, {
        concept_id: concept.id,
        scope: concept.scope,
        bytes: concept.bytes,
        budget_bytes: totalBudget,
      }),
    );
  }

  // -- deterministic final order + record ------------------------------------
  const final = eligible
    .filter((concept) => selected.has(concept.id))
    .sort((a, b) => scopeIndex(a.scopeKey) - scopeIndex(b.scopeKey) || a.id.localeCompare(b.id));

  // The resolve record reports the version each root's lineage actually
  // resolved: the stable pointer, or the trial version for a canary episode.
  const versionOf = (kind: CanaryRootKind): string =>
    unreadable.has(kind) ? "unreadable" : (decisions[kind]?.version ?? "unversioned");
  const bundleVersions: Record<string, string> = {
    org: versionOf("org"),
    ...(appRoot !== undefined ? { app: versionOf("app") } : {}),
  };

  const resolved: ResolvedLearningContext = {
    turn_id: input.turnId,
    episode_id: input.episodeId,
    app: input.app,
    role: input.role,
    bundle_versions: bundleVersions,
    bundle_lineage: lineage,
    concept_ids: final.map((concept) => concept.id),
    context_bytes: used,
    sections: final.map((concept) => concept.rendered),
    bytes_remaining: Math.max(0, totalBudget - used),
  };

  for (const concept of final) {
    events.push(
      resolveEvent(input, now, "concept_loaded", `load-${concept.id}`, {
        concept_id: concept.id,
        scope: concept.scope,
        tier: concept.tier,
        provisional: concept.provisional,
        bytes: concept.bytes,
      }),
    );
  }

  if (input.stateHome !== undefined && input.lineageOverride === undefined) {
    // The FIRST governed resolve pins the episode's assignment (design
    // §8.4) — one record, first write wins, and the record exists even when
    // no trial is running: an episode already in flight when a later trial
    // starts must read as pre-trial stable, never get admitted mid-episode.
    // A root whose manifest was unreadable pins as `undecided` and settles
    // at the first resolve that CAN read it — decided roots pin now either
    // way, so one corrupt manifest never disables pinning org-wide.
    const freshRoots: CanaryAssignmentRecord["roots"] = {};
    for (const kind of ["org", "app"] as const) {
      const assignment = decisions[kind]?.assignment;
      if (assignment !== undefined) freshRoots[kind] = assignment;
    }
    const admissionEvent = (roots: CanaryAssignmentRecord["roots"], suffix: string): void => {
      events.push({
        event_id: `evt_canary_${sanitizeIdSegment(input.episodeId)}_${suffix}`,
        episode_id: input.episodeId,
        turn_id: input.turnId,
        ts: now.toISOString(),
        app: input.app,
        agent_role: input.role,
        type: "canary_assigned",
        emitter: "resolver",
        source_channel: "internal",
        trust: "trusted",
        payload: { bucket, lineage, roots },
      });
    };
    if (existingAssignment === undefined) {
      await writeCanaryAssignmentOnce(input.stateHome, {
        episode_id: input.episodeId,
        app: input.app,
        turn_id: input.turnId,
        assigned_at: now.toISOString(),
        bucket,
        roots: freshRoots,
        ...(unreadable.size > 0 ? { undecided: [...unreadable].sort() } : {}),
        lineage,
      });
      // The event marks trial admission (either arm); a no-trial record is
      // bookkeeping, not a signal.
      if (Object.keys(freshRoots).length > 0) admissionEvent(freshRoots, "pin");
    } else {
      for (const kind of settleRoots) {
        const assignment = decisions[kind]?.assignment;
        await settleCanaryAssignmentRoot(input.stateHome, input.episodeId, kind, assignment);
        if (assignment !== undefined) admissionEvent({ [kind]: assignment }, kind);
      }
    }

    for (const event of events) {
      event.bundle_versions = bundleVersions;
      event.bundle_lineage = lineage;
    }
    await appendLearningEventsDeduped(input.stateHome, events);
    const path = resolvedContextPath(input.stateHome, input.turnId);
    await mkdir(dirname(path), { recursive: true });
    const { sections: _sections, ...record } = resolved;
    await writeFileAtomic(path, JSON.stringify(record, null, 2) + "\n");
  }

  return resolved;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function scopeIndex(key: ScopeShareKey): number {
  return SCOPE_ORDER.findIndex((entry) => entry.key === key);
}

interface ResolvedConceptInternal extends ResolvedConcept {
  topicKey?: string;
  /** Precomputed once per concept — never inside a sort comparator. */
  keywordHit: boolean;
}

function toResolved(
  doc: OkfDocument,
  scope: string,
  scopeKey: ScopeShareKey,
  provisional: boolean,
  input: ResolveInput,
): ResolvedConceptInternal {
  const loop = doc.frontmatter.loop!;
  const rendered = renderConcept(doc, scope, provisional, input.policy);
  const topicKey = typeof loop["topic_key"] === "string" ? loop["topic_key"] : undefined;
  return {
    id: loop.id,
    name: doc.frontmatter.name,
    scope,
    scopeKey,
    tier: loop.tier,
    provisional,
    keywords: [...doc.frontmatter.keywords],
    // Same matcher as the legacy memory selector (src/org/memory.ts) — the
    // two selection layers must not rank the same keyword differently.
    keywordHit: keywordsMatchTask(doc.frontmatter.keywords, input.taskText),
    bytes: Buffer.byteLength(rendered, "utf8"),
    rendered,
    ...(topicKey !== undefined ? { topicKey } : {}),
  };
}

/** Deterministic render (§12.1): no timestamps, no turn ids. The provisional
 *  label carries the expiry DATE — stable until the file changes. Exported
 *  for the M5 replay treatment overlay: an unpublished candidate must render
 *  EXACTLY as the resolver would render it once active, or the replay
 *  measures the rendering difference instead of the concept. */
export function renderConcept(
  doc: OkfDocument,
  scope: string,
  provisional: boolean,
  policy: LearningPolicy,
): string {
  const fm = doc.frontmatter;
  const lines = [
    `## Learning concept ${fm.name} (${scope})`,
    ...(provisional
      ? [
          `${policy.quarantine.context_label} — expires ${provisionalExpiry(doc).toISOString().slice(0, 10)}`,
        ]
      : []),
    `Description: ${fm.description}`,
    `Keywords: ${fm.keywords.join(", ")}`,
    ...(fm.evidence.length > 0 ? [`Evidence: ${fm.evidence.join("; ")}`] : []),
    "",
    doc.body.trimEnd(),
  ];
  return lines.join("\n").trimEnd();
}

function resolveEvent(
  input: ResolveInput,
  now: Date,
  type: LearningEvent["type"],
  idSuffix: string,
  payload: Record<string, unknown>,
): LearningEvent {
  return {
    event_id: `evt_resolve_${sanitizeIdSegment(input.turnId)}_${sanitizeIdSegment(idSuffix)}`,
    episode_id: input.episodeId,
    turn_id: input.turnId,
    ts: now.toISOString(),
    app: input.app,
    agent_role: input.role,
    type,
    emitter: "resolver",
    source_channel: "internal",
    trust: "trusted",
    payload,
  };
}
