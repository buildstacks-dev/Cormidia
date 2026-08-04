// fixtures/org-home.ts — temp org homes the REAL product resolver accepts.
//
// The org home is built by the product's own init transaction
// (`initOrgHome` = planOrgInit + executeOrgInit, src/org/home.ts) against the
// packaged template root, so this fixture can never drift from what
// `cormidia org init` actually produces or from what
// resolveCormidiaHomes/validateOrgHome actually accept. It also writes the real
// active-org pointer (`<homeDir>/.cormidia/config`), giving B-10a suites all
// three identity inputs: pointer, env overrides, explicit options.
//
// Corruption knobs script the B-10 failure modes named in
// validation-design/boundary-map.md (invalid YAML; package/org schema skew;
// missing AUTHORITY.md; mid-edit torn read) for the CF-B10-* sweep. Knobs only
// stage the state — the detector is always product code (loaders/resolver),
// asserted in the suites.

import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthorityProfile } from "../../src/org/authority.js";
import {
  initOrgHome,
  ORG_REQUIRED_FILES,
  type CormidiaHomeOptions,
} from "../../src/org/home.js";

/** The human-ratified YAML surfaces the resolver validates. */
export type OrgYamlSurface = "apps.yaml" | "roles.yaml" | "pipelines.yaml";

export type OrgRequiredEntry = (typeof ORG_REQUIRED_FILES)[number] | "prompts";

export interface OrgHomeCorruption {
  /** B-10 "invalid YAML": overwrite a ratified surface with unparseable YAML. */
  invalidYaml(file?: OrgYamlSurface): Promise<void>;
  /** B-10 "missing AUTHORITY.md": the org still resolves, and authority
   *  resolution must fail closed to legacy-conservative (INV-015). */
  missingAuthority(): Promise<void>;
  /** Remove a required surface (or the prompts/ tree) entirely. */
  removeRequired(target: OrgRequiredEntry): Promise<void>;
  /** B-10 "mid-edit torn read": a non-atomic in-place editor died mid-write.
   *  The target keeps only a prefix cut mid-content and the editor's temp
   *  sibling survives beside it. Returns both paths for assertions. */
  tornMidEdit(file?: OrgYamlSurface): Promise<{ target: string; strayTemp: string }>;
  /** B-10 "package/org schema skew during upgrade": apps.yaml written by a
   *  different package generation carries an app field this package's loader
   *  does not know. The loader must refuse, not ignore. */
  schemaSkew(): Promise<void>;
}

export interface TempOrgHome {
  /** Temp root containing org/, state/, and home/ — removed by cleanup(). */
  root: string;
  orgHome: string;
  stateHome: string;
  /** Fake $HOME whose `.cormidia/config` is the real active-org pointer. */
  homeDir: string;
  pointerPath: string;
  orgName: string;
  /** Env overrides for spawned subprocesses (B-10a override identity path). */
  env: { CORMIDIA_ORG_HOME: string; CORMIDIA_STATE_HOME: string };
  /** Ready-to-pass options for resolveCormidiaHomes: ambient process.env is
   *  blocked (empty env) so resolution flows through the fixture pointer. */
  resolveOptions: CormidiaHomeOptions;
  corrupt: OrgHomeCorruption;
  cleanup(): Promise<void>;
}

export interface MakeTempOrgHomeOptions {
  /** Org name (also names the state home). Keep to [A-Za-z0-9._-]. */
  name?: string;
  authorityProfile?: AuthorityProfile;
}

export async function makeTempOrgHome(
  options: MakeTempOrgHomeOptions = {},
): Promise<TempOrgHome> {
  const root = await mkdtemp(join(tmpdir(), "cormidia-fixture-org-"));
  const name = options.name ?? "fixture-org";
  const homeDir = join(root, "home");
  const orgHome = join(root, "org");
  const stateHome = join(root, "state");
  const pointerPath = join(homeDir, ".cormidia", "config");

  await initOrgHome({
    target: orgHome,
    name,
    stateHome,
    homeDir,
    pointerPath,
    ...(options.authorityProfile !== undefined
      ? { authorityProfile: options.authorityProfile }
      : {}),
  });

  const surfacePath = (file?: OrgYamlSurface): string => join(orgHome, file ?? "apps.yaml");

  const corrupt: OrgHomeCorruption = {
    async invalidYaml(file) {
      // Unterminated flow collection — the yaml package must throw, and the
      // loaders (loadApps/loadRoles/loadPipelines) surface it.
      await writeFile(surfacePath(file), "org: {name: [unterminated\napps: {\n", "utf8");
    },
    async missingAuthority() {
      await rm(join(orgHome, "AUTHORITY.md"), { force: true });
    },
    async removeRequired(target) {
      await rm(join(orgHome, target), { recursive: true, force: true });
    },
    async tornMidEdit(file) {
      const target = surfacePath(file);
      const before = await readFile(target, "utf8");
      const cut = Math.max(1, Math.floor(before.length / 2));
      const strayTemp = `${target}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
      await writeFile(strayTemp, before, "utf8");
      await writeFile(target, before.slice(0, cut).replace(/\n$/, ""), "utf8");
      return { target, strayTemp };
    },
    async schemaSkew() {
      const skewed = [
        "schema_version: 1",
        `org: {name: ${name}, max_concurrent_turns: 2}`,
        "defaults: {budget_usd_month: 1000}",
        "apps:",
        "  skewed-app:",
        "    repo: fixture/skewed",
        "    status: live",
        "    from_a_newer_package_schema: true",
        "",
      ].join("\n");
      await writeFile(join(orgHome, "apps.yaml"), skewed, "utf8");
    },
  };

  return {
    root,
    orgHome,
    stateHome,
    homeDir,
    pointerPath,
    orgName: name,
    env: { CORMIDIA_ORG_HOME: orgHome, CORMIDIA_STATE_HOME: stateHome },
    resolveOptions: { env: {}, homeDir, pointerPath },
    corrupt,
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
    },
  };
}
