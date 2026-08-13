// Traceability: CF-REG-389 · HB-139 · case-catalog.md §10.3.
// Binds INV-008 (evidence never outruns reality), INV-010 (destruction stays
// inside its named scope), INV-013 (durable writes have an integrity story);
// boundaries B-14 (human checkout ↔ managed workspace), B-15 (git substrate),
// B-01 (GitHub); journeys J-02 and J-03 (planning inputs).

// CF-REG-389 — the product-document disposition is a publication-aware app
// repository transaction, and planning names the transition that is missing.
//
// The defect: `app product-docs --execute` wrote the decision only into the
// human checkout and reported `recorded`, while live planning — which reads
// Cormidia's MANAGED checkout, synchronized from the app remote — still saw
// `disposition: null` and told the operator to run the command they had just
// run. Write side and read side evaluated different repository views, and
// neither message exposed the publication boundary.
//
// Managed-checkout isolation is deliberate and is preserved here: nothing in
// this fix lets planning read a human working tree. The information planning
// gained is Cormidia's OWN publication journal, in the state home.

import { readFileSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { executeProductDocDisposition, planProductDocDisposition } from "../../../src/org/product-doc-disposition.js";
import { prepareProductDocPlanning } from "../../../src/org/product-doc-planning.js";
import {
  executeProductDocPublication,
  planProductDocPublication,
  productDocPublicationBranch,
} from "../../../src/org/product-doc-publication.js";
import { PRODUCT_DOC_RECORD_PATH } from "../../../src/org/product-doc-record.js";
import { PRODUCT_DOC_PATHS } from "../../../src/org/product-doc-scaffold.js";
import { cloneRemote, git, makePublicationGhDouble, remoteBlob, remoteTip } from "../cf-reg-388/helpers.js";
import { makeScaffoldedApp, type ScaffoldedApp } from "./helpers.js";

const APP = "cf-reg-389-app";
const BRANCH = productDocPublicationBranch(APP);

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function scaffolded(): Promise<ScaffoldedApp> {
  const app = await makeScaffoldedApp(APP);
  cleanups.push(() => app.cleanup());
  return app;
}

/** What live planning actually reads: a checkout synchronized from the app
 *  remote, never the operator's working tree. */
async function managedCheckout(app: ScaffoldedApp): Promise<string> {
  const clone = await cloneRemote(app.remoteDir);
  cleanups.push(() => clone.cleanup());
  return clone.dir;
}

describe("CF-REG-389 — a recorded disposition is not a planning input until it is reachable", () => {
  it("reproduces the E2E: a locally recorded decision refuses planning by naming the publication, not the disposition", async () => {
    const app = await scaffolded();
    // The exact operator sequence: preview/record pair against the human
    // checkout, with the app remote already carrying `disposition: null`. The
    // publication is then attempted and does not land — the state in which the
    // decision exists locally and the managed base has never seen it.
    await executeProductDocDisposition(app.dispositionInput("reconcile"));
    app.denyPush();
    await expect(app.publish("reconcile")).rejects.toThrow(/seeded push failure/);
    app.allowPush();
    expect(JSON.parse(readFileSync(join(app.workdir, PRODUCT_DOC_RECORD_PATH), "utf8")).disposition.value).toBe(
      "reconcile",
    );
    expect(JSON.parse(remoteBlob(app.remoteDir, app.defaultBranch, PRODUCT_DOC_RECORD_PATH) ?? "{}").disposition).toBe(
      null,
    );

    // Planning reads the managed checkout and must NOT say "no disposition".
    const managed = await managedCheckout(app);
    const failure = prepareProductDocPlanning({
      workdir: managed,
      app: APP,
      repository: app.repository,
      stateHome: app.stateHome,
    });
    await expect(failure).rejects.toThrow(/recorded in a local checkout but was never published/);
    await expect(failure).rejects.toThrow(/Do not record the disposition again/);
    await expect(failure).rejects.toThrow(/--publish --execute/);
  });

  it("publishes the manifest through the governed path and a fresh clone carries the exact decision", async () => {
    const app = await scaffolded();
    await executeProductDocDisposition(app.dispositionInput("reconcile"));
    const gh = makePublicationGhDouble();
    const { plan, transaction } = await executeProductDocPublication({
      workdir: app.workdir,
      app: APP,
      stateHome: app.stateHome,
      repository: app.repository,
      disposition: "reconcile",
      gh,
    });

    expect(plan.durability).toBe("pending_merge");
    expect(plan.preflight.changed_paths).toEqual([PRODUCT_DOC_RECORD_PATH]);
    expect(transaction?.pull_request?.number).toBe(1);
    expect(remoteTip(app.remoteDir, BRANCH)).toBe(transaction?.pushed_commit);

    const published = JSON.parse(remoteBlob(app.remoteDir, BRANCH, PRODUCT_DOC_RECORD_PATH) ?? "{}");
    expect(published.disposition.value).toBe("reconcile");
    expect(published.disposition.documents.map((entry: { path: string }) => entry.path)).toEqual([
      ...PRODUCT_DOC_PATHS,
    ]);
    // Still pending: the default branch does not carry it until a human merges.
    expect(JSON.parse(remoteBlob(app.remoteDir, app.defaultBranch, PRODUCT_DOC_RECORD_PATH) ?? "{}").disposition).toBe(
      null,
    );
  });

  it("names the awaiting-merge transition once published, and planning proceeds after the merge", async () => {
    const app = await scaffolded();
    await executeProductDocDisposition(app.dispositionInput("keep"));
    await executeProductDocPublication({
      workdir: app.workdir,
      app: APP,
      stateHome: app.stateHome,
      repository: app.repository,
      disposition: "keep",
      gh: makePublicationGhDouble(),
    });

    const pending = await managedCheckout(app);
    const awaiting = prepareProductDocPlanning({
      workdir: pending,
      app: APP,
      repository: app.repository,
      stateHome: app.stateHome,
    });
    await expect(awaiting).rejects.toThrow(/awaiting human merge/);
    await expect(awaiting).rejects.toThrow(/Do not record the disposition again/);

    await app.mergePublicationBranch(BRANCH);

    // No further disposition write: the same decision, now reachable.
    const merged = await managedCheckout(app);
    await expect(
      prepareProductDocPlanning({ workdir: merged, app: APP, repository: app.repository, stateHome: app.stateHome }),
    ).resolves.toMatchObject({ kind: "scaffolded", disposition: "keep" });
  });

  it("binds remove atomically: the placeholder deletions and the manifest update land in one commit", async () => {
    const app = await scaffolded();
    const preview = await planProductDocDisposition(app.dispositionInput("remove"));
    expect(preview.remove_paths).toEqual([...PRODUCT_DOC_PATHS]);
    await executeProductDocDisposition(app.dispositionInput("remove"));

    await executeProductDocPublication({
      workdir: app.workdir,
      app: APP,
      stateHome: app.stateHome,
      repository: app.repository,
      disposition: "remove",
      removePaths: preview.remove_paths,
      gh: makePublicationGhDouble(),
    });

    // One revision: manifest says removed AND the documents are gone from it.
    const published = JSON.parse(remoteBlob(app.remoteDir, BRANCH, PRODUCT_DOC_RECORD_PATH) ?? "{}");
    expect(published.disposition.value).toBe("remove");
    for (const path of PRODUCT_DOC_PATHS) {
      expect(
        remoteBlob(app.remoteDir, BRANCH, path),
        `${path} still present at the published revision`,
      ).toBeUndefined();
    }
    const changed = git(app.remoteDir, ["diff", "--name-only", app.defaultBranch, BRANCH]).split("\n").sort();
    expect(changed).toEqual([PRODUCT_DOC_RECORD_PATH, ...PRODUCT_DOC_PATHS].sort());
  });

  it("excludes unrelated app content and leaves the operator's checkout byte-identical", async () => {
    const app = await scaffolded();
    await writeFile(join(app.workdir, "src", "domain.ts"), "// operator work in flight\n", "utf8");
    await writeFile(join(app.workdir, "scratch.txt"), "untracked\n", "utf8");
    await executeProductDocDisposition(app.dispositionInput("keep"));
    const before = new Map(
      ["src/domain.ts", "scratch.txt", PRODUCT_DOC_RECORD_PATH].map((rel) => [
        rel,
        readFileSync(join(app.workdir, rel), "utf8"),
      ]),
    );
    const head = git(app.workdir, ["rev-parse", "HEAD"]);

    await executeProductDocPublication({
      workdir: app.workdir,
      app: APP,
      stateHome: app.stateHome,
      repository: app.repository,
      disposition: "keep",
      gh: makePublicationGhDouble(),
    });

    for (const [rel, bytes] of before) {
      expect(readFileSync(join(app.workdir, rel), "utf8"), `${rel} was mutated`).toBe(bytes);
    }
    expect(git(app.workdir, ["rev-parse", "HEAD"])).toBe(head);
    expect(git(app.remoteDir, ["diff", "--name-only", app.defaultBranch, BRANCH])).toBe(PRODUCT_DOC_RECORD_PATH);
    expect(remoteBlob(app.remoteDir, BRANCH, "scratch.txt")).toBeUndefined();
    expect(remoteBlob(app.remoteDir, BRANCH, "src/domain.ts")).not.toContain("operator work in flight");
  });

  it("recovers idempotently from a seeded push failure and a lost createPR response", async () => {
    const app = await scaffolded();
    await executeProductDocDisposition(app.dispositionInput("keep"));
    const publish = (gh: ReturnType<typeof makePublicationGhDouble>) =>
      executeProductDocPublication({
        workdir: app.workdir,
        app: APP,
        stateHome: app.stateHome,
        repository: app.repository,
        disposition: "keep",
        gh,
      });

    app.denyPush();
    const gh = makePublicationGhDouble();
    await expect(publish(gh)).rejects.toThrow(/seeded push failure/);
    app.allowPush();

    const lossy = makePublicationGhDouble({ loseCreateResponse: true });
    await expect(publish(lossy)).rejects.toThrow(/seeded lost success response/);
    const { plan } = await publish(lossy);

    expect(lossy.createdCount()).toBe(1);
    expect(plan.durability).toBe("pending_merge");
    expect(git(app.remoteDir, ["rev-list", "--count", `${app.defaultBranch}..${BRANCH}`])).toBe("1");
  });

  it("an app checkout with no remote reports the explicit local-only contract", async () => {
    const app = await scaffolded();
    git(app.workdir, ["remote", "remove", "origin"]);
    await executeProductDocDisposition(app.dispositionInput("keep"));
    const plan = await planProductDocPublication({ workdir: app.workdir, app: APP });
    expect(plan.preflight.mode).toBe("local_only");
    expect(plan.durability).toBe("local_only");
    expect(plan.next_action).toContain("local-only");
  });

  it("preserves managed-checkout isolation: planning never reads the human checkout", async () => {
    const app = await scaffolded();
    await executeProductDocDisposition(app.dispositionInput("reconcile"));
    app.denyPush();
    await expect(app.publish("reconcile")).rejects.toThrow(/seeded push failure/);
    app.allowPush();
    const managed = await managedCheckout(app);
    // Plant a DIFFERENT decision in the human checkout. Planning reads the
    // managed base and Cormidia's own journal; the human file is not an input.
    await writeFile(
      join(app.workdir, PRODUCT_DOC_RECORD_PATH),
      readFileSync(join(app.workdir, PRODUCT_DOC_RECORD_PATH), "utf8").replace('"reconcile"', '"keep"'),
      "utf8",
    );
    await expect(
      prepareProductDocPlanning({ workdir: managed, app: APP, repository: app.repository, stateHome: app.stateHome }),
    ).rejects.toThrow(/never published/);
    expect(JSON.parse(readFileSync(join(managed, PRODUCT_DOC_RECORD_PATH), "utf8")).disposition).toBe(null);
  });

  it("with no journal to consult, planning reports absent rather than inventing a state", async () => {
    const app = await scaffolded();
    const managed = await managedCheckout(app);
    await rm(join(app.stateHome, "publication"), { recursive: true, force: true });
    await expect(
      prepareProductDocPlanning({ workdir: managed, app: APP, repository: app.repository, stateHome: app.stateHome }),
    ).rejects.toThrow(/no keep\/reconcile\/remove disposition reachable from the app remote/);
  });
});
