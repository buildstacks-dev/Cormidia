// Traceability: CF-REG-389 · HB-139 · case-catalog.md §10.3.

// CF-REG-389 (L1) — the five decision states and, above all, what each refusal
// TELLS the operator.
//
// The defect was a remediation loop: an operator who had just recorded a
// disposition was told to record it again. So the load-bearing assertion here
// is not only that the state is classified correctly, but that a state reached
// BY recording never routes back to the disposition command.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  publicationJournalPath,
  writePublicationTransaction,
  type PublicationTransaction,
} from "../../../src/org/git-publication-journal.js";
import {
  PRODUCT_DOC_PUBLICATION_SURFACE,
  productDocPublicationBranch,
  productDocPublicationScope,
} from "../../../src/org/product-doc-publication.js";
import type { ProductDocSnapshot } from "../../../src/org/product-doc-record.js";
import {
  productDocDecisionRefusal,
  resolveProductDocDecision,
  type ProductDocDecisionState,
} from "../../../src/org/product-doc-reachability.js";

const APP = "atlas";
const BRANCH = productDocPublicationBranch(APP);
const DOCS = ["docs/VISION.md", "docs/REQUIREMENTS.md", "docs/ARCHITECTURE.md"];
const HASH = "a".repeat(64);

const temps: string[] = [];
afterEach(async () => {
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true });
});

function documents(overrides: Record<string, string | null> = {}): ProductDocSnapshot[] {
  return DOCS.map((path) => ({
    path,
    status: "placeholder" as const,
    current_sha256: path in overrides ? (overrides[path] ?? null) : HASH,
  }));
}

function decision(value: "keep" | "reconcile" | "remove") {
  return { value, documents: DOCS.map((path) => ({ path, current_sha256: HASH })) };
}

async function stateHomeWith(transaction: Partial<PublicationTransaction>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "cormidia-cf-reg-389-state-"));
  temps.push(root);
  const full: PublicationTransaction = {
    schema_version: 1,
    kind: "git-publication",
    content_id: "c".repeat(64),
    scope: productDocPublicationScope(APP),
    surface: PRODUCT_DOC_PUBLICATION_SURFACE,
    root: "/checkouts/atlas",
    origin_url: "https://github.com/acme/atlas.git",
    github_slug: "acme/atlas",
    base: { ref: "origin/trunk", default_branch: "trunk", commit: "b".repeat(40) },
    branch: BRANCH,
    owned_paths: [".cormidia/bootstrap/product-docs.json"],
    changed_paths: [".cormidia/bootstrap/product-docs.json"],
    phase: "committed",
    durability: "recorded_locally",
    commit: "d".repeat(40),
    pushed_commit: null,
    pull_request: null,
    next_action: "resume",
    created_at: "2026-08-12T00:00:00.000Z",
    updated_at: "2026-08-12T00:00:00.000Z",
    ...transaction,
  };
  await writePublicationTransaction(publicationJournalPath(root, full.scope, full.content_id), full);
  return root;
}

/** The loop this family exists to prevent: a state an operator reached BY
 *  recording must never hand them the disposition command again. The check is
 *  for the COMMAND, not for prose — "Do not record the disposition again" is a
 *  prohibition, and the stale-content branch legitimately asks for a re-record
 *  of named, changed bytes. */
function offersDispositionCommand(refusal: string): boolean {
  return refusal.includes("--disposition");
}

describe("CF-REG-389 — product-document decision reachability", () => {
  it("reports current when the managed base carries a decision bound to the current bytes", async () => {
    const state = await resolveProductDocDecision({ app: APP, decision: decision("keep"), documents: documents() });
    expect(state).toEqual<ProductDocDecisionState>({ kind: "current", disposition: "keep" });
    expect(productDocDecisionRefusal(state, APP)).toBeUndefined();
  });

  it("reports stale_content naming the changed path and both hashes", async () => {
    const drifted = "f".repeat(64);
    const state = await resolveProductDocDecision({
      app: APP,
      decision: decision("keep"),
      documents: documents({ "docs/VISION.md": drifted }),
    });
    expect(state.kind).toBe("stale_content");
    const refusal = productDocDecisionRefusal(state, APP) ?? "";
    expect(refusal).toContain("docs/VISION.md");
    expect(refusal).toContain(HASH.slice(0, 12));
    expect(refusal).toContain(drifted.slice(0, 12));
    expect(refusal).toContain("is stale");
    // Stale content IS a re-record: this is the one branch that legitimately
    // routes back, and it says so for a named, changed document.
    expect(refusal).toContain("record the disposition again for the current bytes");
  });

  it("reports absent with no decision and no journal, and asks for the disposition", async () => {
    const state = await resolveProductDocDecision({ app: APP, decision: null, documents: documents() });
    expect(state).toEqual<ProductDocDecisionState>({ kind: "absent" });
    const refusal = productDocDecisionRefusal(state, APP) ?? "";
    expect(refusal).toContain("no keep/reconcile/remove disposition reachable from the app remote");
    expect(refusal).toContain("--disposition keep|reconcile|remove");
    // The one state where offering the disposition command is correct.
    expect(offersDispositionCommand(refusal)).toBe(true);
  });

  it("reports recorded_locally from an unpublished journal entry and never asks for the disposition again", async () => {
    const stateHome = await stateHomeWith({});
    const state = await resolveProductDocDecision({ app: APP, decision: null, documents: documents(), stateHome });
    expect(state).toMatchObject({ kind: "recorded_locally", workdir: "/checkouts/atlas" });
    const refusal = productDocDecisionRefusal(state, APP) ?? "";
    expect(refusal).toContain("never published");
    expect(refusal).toContain("--publish --execute");
    expect(refusal).toContain("Do not record the disposition again");
    expect(offersDispositionCommand(refusal)).toBe(false);
  });

  it("reports pending_merge from a pushed journal entry and names the pull request, not the command", async () => {
    const stateHome = await stateHomeWith({
      phase: "pull_request_open",
      durability: "pending_merge",
      pushed_commit: "d".repeat(40),
      pull_request: { number: 7, url: "https://github.test/acme/atlas/pull/7" },
    });
    const state = await resolveProductDocDecision({ app: APP, decision: null, documents: documents(), stateHome });
    expect(state).toMatchObject({ kind: "pending_merge", branch: BRANCH, defaultBranch: "trunk" });
    const refusal = productDocDecisionRefusal(state, APP) ?? "";
    expect(refusal).toContain("https://github.test/acme/atlas/pull/7");
    expect(refusal).toContain("awaiting human merge into trunk");
    expect(offersDispositionCommand(refusal)).toBe(false);
  });

  it("a reachable decision wins over a stale journal entry from an earlier attempt", async () => {
    const stateHome = await stateHomeWith({});
    const state = await resolveProductDocDecision({
      app: APP,
      decision: decision("reconcile"),
      documents: documents(),
      stateHome,
    });
    expect(state).toEqual<ProductDocDecisionState>({ kind: "current", disposition: "reconcile" });
  });

  it("negative control: without a state home the resolver reports absent rather than guessing in flight", async () => {
    await stateHomeWith({});
    const state = await resolveProductDocDecision({ app: APP, decision: null, documents: documents() });
    expect(state.kind).toBe("absent");
  });

  it("negative control: a journal entry for a different app is not this app's decision", async () => {
    const stateHome = await stateHomeWith({ scope: productDocPublicationScope("other-app") });
    const state = await resolveProductDocDecision({ app: APP, decision: null, documents: documents(), stateHome });
    expect(state.kind).toBe("absent");
  });
});
