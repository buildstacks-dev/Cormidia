// CF-REG-389 fixture — a real `cormidia new-app` scaffold in a real git
// checkout with a real file:// remote, pushed once so the remote carries the
// generated manifest with `disposition: null`.
//
// That is exactly the state the production E2E was in when `product-docs
// --execute` reported `recorded` and live planning reported "no disposition":
// two repository views of the same app, disagreeing.

import { rmSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PublicationGhOps } from "../../../src/org/git-publication-execute.js";
import { createNewApp } from "../../../src/org/new-app.js";
import { executeProductDocPublication } from "../../../src/org/product-doc-publication.js";
import type { ProductDocDisposition } from "../../../src/org/product-doc-record.js";
import { makeTempOrgHome, type TempOrgHome } from "../../fixtures/org-home.js";
import { cloneRemote, git } from "../cf-reg-388/helpers.js";

/** Addressed as GitHub, rewritten to the local bare repo — the configuration
 *  the product's two-source slug lookup exists for. */
const GITHUB_URL = "https://github.com/fixture/cf-reg-389-app.git";

export interface ScaffoldedApp {
  org: TempOrgHome;
  stateHome: string;
  /** The operator's app checkout. */
  workdir: string;
  remoteDir: string;
  defaultBranch: string;
  repository: string;
  dispositionInput(disposition: ProductDocDisposition): {
    workdir: string;
    app: string;
    repository: string;
    disposition: ProductDocDisposition;
  };
  /** Record-then-publish, the composition `--execute` performs. */
  publish(disposition: ProductDocDisposition, gh?: PublicationGhOps): Promise<unknown>;
  /** A human merges the draft, the way the real flow lands one. */
  mergePublicationBranch(branch: string): Promise<void>;
  denyPush(): void;
  allowPush(): void;
  cleanup(): Promise<void>;
}

export async function makeScaffoldedApp(app: string, defaultBranch = "trunk"): Promise<ScaffoldedApp> {
  const org = await makeTempOrgHome({ name: "cf-reg-389-org" });
  const repository = `fixture/${app}`;
  const workdir = join(org.root, app);
  await createNewApp({
    appName: app,
    targetDir: workdir,
    repoSlug: repository,
    goal: "deliver one observable milestone",
    template: "typescript-node",
    orgHome: org.orgHome,
    stateHome: org.stateHome,
  });

  const remoteRoot = await mkdtemp(join(tmpdir(), "cormidia-cf-reg-389-remote-"));
  const remoteDir = join(remoteRoot, "app.git");
  git(remoteRoot, ["init", "--bare", "-b", defaultBranch, remoteDir]);
  git(workdir, ["init", "-b", defaultBranch]);
  git(workdir, ["config", "user.name", "Cormidia Fixture"]);
  git(workdir, ["config", "user.email", "fixture@cormidia.invalid"]);
  git(workdir, ["config", "commit.gpgsign", "false"]);
  git(workdir, ["add", "--all"]);
  git(workdir, ["commit", "--quiet", "-m", "fixture: scaffold"]);
  git(workdir, ["remote", "add", "origin", GITHUB_URL]);
  git(workdir, ["config", `url.${remoteDir}.insteadOf`, GITHUB_URL]);
  git(workdir, ["push", "--quiet", "origin", `${defaultBranch}:${defaultBranch}`]);
  git(workdir, ["fetch", "--quiet", "origin"]);
  git(workdir, ["remote", "set-head", "origin", "-a"]);

  const hookPath = join(remoteDir, "hooks", "pre-receive");
  const cleanups: Array<() => Promise<void>> = [];
  return {
    org,
    stateHome: org.stateHome,
    workdir,
    remoteDir,
    defaultBranch,
    repository,
    dispositionInput: (disposition) => ({ workdir, app, repository, disposition }),
    publish: (disposition, gh) =>
      executeProductDocPublication({
        workdir,
        app,
        stateHome: org.stateHome,
        repository,
        disposition,
        ...(gh === undefined ? {} : { gh }),
      }),
    mergePublicationBranch: async (branch) => {
      const merge = await cloneRemote(remoteDir, defaultBranch);
      cleanups.push(() => merge.cleanup());
      git(merge.dir, ["config", "user.name", "Fixture Human"]);
      git(merge.dir, ["config", "user.email", "human@cormidia.invalid"]);
      git(merge.dir, ["merge", "--quiet", "--no-ff", "-m", "merge disposition", `origin/${branch}`]);
      git(merge.dir, ["push", "--quiet", "origin", defaultBranch]);
    },
    denyPush: () => {
      writeFileSync(hookPath, "#!/bin/sh\necho 'cf-reg-389: seeded push failure' >&2\nexit 1\n", {
        encoding: "utf8",
        mode: 0o755,
      });
    },
    allowPush: () => {
      rmSync(hookPath, { force: true });
    },
    cleanup: async () => {
      for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
      await org.cleanup();
      await rm(remoteRoot, { recursive: true, force: true });
    },
  };
}
