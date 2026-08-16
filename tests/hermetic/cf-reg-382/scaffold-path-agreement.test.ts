// CF-REG-382 — HB-139 · HB-156 — the drift pin between the scaffold's PATH table and
// the scaffold itself.
//
// `src/org/new-app-paths.ts` declares what each greenfield template owns, so
// provisioning can compute a declared path set without an app name, a goal, or
// a repository slug to render content from. That table is a projection of
// `generatedFiles`, not a second source of truth — and a projection that can
// drift silently is worse than no projection at all: a template that GAINS a
// file would quietly drop it out of the bootstrap commit, and the repository
// would be provisioned missing a file nobody noticed.
//
// So this asserts set containment against the real scaffold, per template.
//
// L2 — hermetic; runs the real `new-app` dry run against a temp org home.
// Risk REG.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createNewApp, NEW_APP_TEMPLATES } from "../../../src/org/new-app.js";
import { NEW_APP_SCAFFOLD_PATHS } from "../../../src/org/new-app-paths.js";
import { provisionDeclaredPaths } from "../../../src/org/repo-provision.js";
import { makeTempOrgHome, type TempOrgHome } from "../../fixtures/org-home.js";

let org: TempOrgHome | undefined;
let workspace: string | undefined;

afterEach(async () => {
  await org?.cleanup();
  org = undefined;
  if (workspace !== undefined) await rm(workspace, { recursive: true, force: true });
  workspace = undefined;
});

describe("CF-REG-382 — NEW_APP_SCAFFOLD_PATHS agrees with the real scaffold", () => {
  for (const template of NEW_APP_TEMPLATES) {
    it(`${template}: every declared scaffold path is really created`, async () => {
      org = await makeTempOrgHome({ name: "cf-reg-382-org" });
      workspace = await mkdtemp(join(tmpdir(), "cormidia-cf-reg-382-scaffold-"));
      const result = await createNewApp({
        appName: "widget",
        targetDir: join(workspace, "widget"),
        repoSlug: "cormidia-fixture/widget",
        goal: "a deliberately unremarkable goal",
        template,
        orgHome: org.orgHome,
        stateHome: org.stateHome,
        dryRun: true,
      });

      // Containment, not equality: `created` also carries the app-owned
      // `.cormidia/` artifacts, which the declaration covers by PREFIX rather
      // than by listing every file. A declared path that new-app does not
      // create is the drift that matters here.
      for (const declared of NEW_APP_SCAFFOLD_PATHS[template]) {
        expect(result.created, `${template} declares ${declared}`).toContain(declared);
      }
    });

    it(`${template}: the provisioning declaration covers every path new-app creates`, async () => {
      // The other direction, and the one that would silently lose a file: a
      // scaffold path outside the declaration would never enter the bootstrap
      // commit, so the repository would be provisioned incomplete.
      org = await makeTempOrgHome({ name: "cf-reg-382-org" });
      workspace = await mkdtemp(join(tmpdir(), "cormidia-cf-reg-382-scaffold-"));
      const result = await createNewApp({
        appName: "widget",
        targetDir: join(workspace, "widget"),
        repoSlug: "cormidia-fixture/widget",
        goal: "a deliberately unremarkable goal",
        template,
        orgHome: org.orgHome,
        stateHome: org.stateHome,
        dryRun: true,
      });

      const declared = provisionDeclaredPaths("app", template);
      const owns = (path: string): boolean =>
        declared.some((entry) => (entry.endsWith("/") ? path.startsWith(entry) : path === entry));
      const uncovered = result.created.filter((path) => !owns(path));
      expect(uncovered, `${template} creates paths the provisioning declaration does not own`).toEqual([]);
    });
  }
});
