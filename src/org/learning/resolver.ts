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
//      compaction footnote.
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
// M4 lineage is always `stable`; episode-sticky canary assignment lands in
// M5 (design §8.4).

import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { writeFileAtomic } from "../atomic.js";
import type { OkfDocument } from "../memory.js";
import {
  appLearningRoot,
  loadConceptDir,
  orgLearningRoot,
  quarantineDir,
  readManifest,
  bundleDir,
  type LearningRoot,
} from "./concepts.js";
import { appendLearningEventsDeduped, type LearningEvent } from "./events.js";
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
  /** When set, the resolver emits learning events and persists the
   *  resolved-context record; a dry resolve (CLI) omits it. */
  stateHome?: string;
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
  bundle_lineage: "stable";
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

export function resolvedContextPath(stateHome: string, turnId: string): string {
  const safe = turnId.replace(/[^A-Za-z0-9._-]+/g, "-");
  return join(stateHome, "learning", "resolved", `${safe}.json`);
}

export async function resolveLearningContext(input: ResolveInput): Promise<ResolvedLearningContext> {
  const clock = input.clock ?? ((): Date => new Date());
  const orgRoot = orgLearningRoot(input.orgHome);
  const appRoot = input.appWorkdir !== undefined ? appLearningRoot(input.appWorkdir) : undefined;
  const events: LearningEvent[] = [];
  const now = clock();

  // -- gather ---------------------------------------------------------------
  const gathered: ResolvedConceptInternal[] = [];
  for (const { key, scope } of SCOPE_ORDER) {
    const scopeName = scope(input.app, input.role);
    const root = key === "org" || key === "role" ? orgRoot : appRoot;
    if (root === undefined) continue;

    const dir = join(bundleDir(root), scopeName);
    if (existsSync(dir)) {
      for (const concept of await loadConceptDir(dir, "bundle")) {
        const loop = concept.doc.frontmatter.loop!;
        if (loop.status !== "active" || concept.doc.frontmatter.status !== "active") continue;
        if (loop.scope !== scopeName) continue;
        gathered.push(toResolved(concept.doc, scopeName, key, false, input.policy));
      }
    }

    // Quarantine is flat per root; provisionals join the scope their
    // loop.scope names. Only visit each root's quarantine once.
    if (key === "org" || key === "app") {
      const qdir = quarantineDir(root);
      if (!existsSync(qdir)) continue;
      for (const concept of await loadConceptDir(qdir, "quarantine")) {
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
        gathered.push(toResolved(concept.doc, conceptScope, match.key, true, input.policy));
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
  const totalBudget = input.policy.context_budget.roles[input.role] ?? input.policy.context_budget.default_bytes;
  const selected = new Set<string>();
  let used = 0;

  const inScopeOrder = (key: ScopeShareKey): ResolvedConcept[] =>
    eligible
      .filter((concept) => concept.scopeKey === key)
      .sort(
        (a, b) =>
          // provisional_first eviction => active concepts are selected first;
          Number(a.provisional) - Number(b.provisional) ||
          // keyword relevance is ONLY a tie-breaker inside an overflowing
          // scope (spec §8.1), applied as selection priority here;
          Number(keywordHit(b, input.taskText)) - Number(keywordHit(a, input.taskText)) ||
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
    if (input.policy.context_budget.eviction.protected_tiers.includes(concept.tier as never)) {
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

  const bundleVersions: Record<string, string> = {
    org: (await readManifest(orgRoot))?.bundle_version ?? "unversioned",
    ...(appRoot !== undefined
      ? { app: (await readManifest(appRoot))?.bundle_version ?? "unversioned" }
      : {}),
  };

  const resolved: ResolvedLearningContext = {
    turn_id: input.turnId,
    episode_id: input.episodeId,
    app: input.app,
    role: input.role,
    bundle_versions: bundleVersions,
    bundle_lineage: "stable",
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

  if (input.stateHome !== undefined) {
    for (const event of events) {
      event.bundle_versions = bundleVersions;
      event.bundle_lineage = "stable";
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
}

function toResolved(
  doc: OkfDocument,
  scope: string,
  scopeKey: ScopeShareKey,
  provisional: boolean,
  policy: LearningPolicy,
): ResolvedConceptInternal {
  const loop = doc.frontmatter.loop!;
  const rendered = renderConcept(doc, scope, provisional, policy);
  const topicKey = typeof loop["topic_key"] === "string" ? loop["topic_key"] : undefined;
  return {
    id: loop.id,
    name: doc.frontmatter.name,
    scope,
    scopeKey,
    tier: loop.tier,
    provisional,
    keywords: [...doc.frontmatter.keywords],
    bytes: Buffer.byteLength(rendered, "utf8"),
    rendered,
    ...(topicKey !== undefined ? { topicKey } : {}),
  };
}

/** Deterministic render (§12.1): no timestamps, no turn ids. The provisional
 *  label carries the expiry DATE — stable until the file changes. */
function renderConcept(
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

/** TTL base is the `created` date (spec §3: quarantine concepts are
 *  short-lived by construction; `updated` would let a touch extend life). */
function provisionalExpiry(doc: OkfDocument): Date {
  const loop = doc.frontmatter.loop!;
  const ttlDays = typeof loop["ttl_days"] === "number" ? loop["ttl_days"] : 0;
  const created = new Date(`${doc.frontmatter.created}T00:00:00Z`);
  return new Date(created.getTime() + ttlDays * 24 * 60 * 60 * 1000);
}

function keywordHit(concept: ResolvedConcept, taskText: string): boolean {
  const lower = taskText.toLowerCase();
  return concept.keywords.some((keyword) => lower.includes(keyword.toLowerCase()));
}

function resolveEvent(
  input: ResolveInput,
  now: Date,
  type: LearningEvent["type"],
  idSuffix: string,
  payload: Record<string, unknown>,
): LearningEvent {
  const safeTurn = input.turnId.replace(/[^A-Za-z0-9._-]+/g, "-");
  const safeSuffix = idSuffix.replace(/[^A-Za-z0-9._-]+/g, "-");
  return {
    event_id: `evt_resolve_${safeTurn}_${safeSuffix}`,
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
