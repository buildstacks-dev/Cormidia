// CF-REG-369 (L2) — the scaffold filesystem/manifest/planning composition.
// It proves byte-exact placeholders, user replacements, and deletion remain
// distinct across preview, execution, and the pre-provider planning guard.

import { mkdtemp, mkdir, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeTempOrgHome } from "../../fixtures/org-home.js";
import { cmdApp } from "../../../src/cli/app.js";
import { createNewApp } from "../../../src/org/new-app.js";
import type { PlanningSourceManifest } from "../../../src/org/planning-inputs.js";
import { executeProductDocDisposition, planProductDocDisposition } from "../../../src/org/product-doc-disposition.js";
import { renderProductDocScaffoldRecord } from "../../../src/org/product-doc-record.js";
import { prepareProductDocPlanning } from "../../../src/org/product-doc-planning.js";

const APP = "atlas";
const REPO = "acme/atlas";
const GOAL = "deliver one observable atlas milestone";
const DOCS = ["docs/VISION.md", "docs/REQUIREMENTS.md", "docs/ARCHITECTURE.md"];
const CONTENT = new Map(DOCS.map((path) => [path, `generated placeholder for ${path}\n`]));
const temps: string[] = [];

afterEach(async () => {
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("CF-REG-369 — product-doc disposition lifecycle", () => {
  it("new-app wires the exact scaffold record and app-specific lifecycle guide", async () => {
    const org = await makeTempOrgHome({ name: "cf-reg-369" });
    temps.push(org.root);
    const target = join(org.root, APP);
    const result = await createNewApp({
      appName: APP,
      targetDir: target,
      repoSlug: REPO,
      goal: GOAL,
      template: "typescript-node",
      orgHome: org.orgHome,
      stateHome: org.stateHome,
    });
    expect(result.created).toContain(".cormidia/bootstrap/product-docs.json");
    expect(result.created).toContain(".cormidia/bootstrap/next-commands.md");
    expect(result.created).not.toContain(".cormidia/bootstrap/initial-issue.md");

    const manifest = JSON.parse(await readFile(join(target, ".cormidia/bootstrap/product-docs.json"), "utf8"));
    expect(manifest).toMatchObject({ app: APP, repository: REPO, template: "typescript-node", disposition: null });
    expect(manifest.documents.map((document: { path: string }) => document.path)).toEqual(DOCS);
    expect(
      manifest.documents.every((document: { scaffold_sha256: string }) =>
        /^[0-9a-f]{64}$/.test(document.scaffold_sha256),
      ),
    ).toBe(true);

    const guide = await readFile(join(target, ".cormidia/bootstrap/next-commands.md"), "utf8");
    expect(guide).toContain(`cormidia app product-docs '${APP}' --workdir '${target}'`);
    expect(guide).toContain(`gh repo create '${REPO}' --private --source '${target}'`);
    expect(guide).not.toContain("gh issue create --body-file .cormidia/bootstrap/initial-issue.md");

    const readme = await readFile(join(target, "README.md"), "utf8");
    expect(readme).toContain("Lifecycle guide: `.cormidia/bootstrap/next-commands.md`");
    expect(readme).toContain("Record exactly one product-document");
    expect(readme).not.toContain("Initial issue body:");

    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      const common = [
        "--workdir",
        target,
        "--disposition",
        "keep",
        "--json",
        "--org-home",
        org.orgHome,
        "--state-home",
        org.stateHome,
      ];
      expect(await cmdApp(["product-docs", APP, ...common])).toBe(0);
      expect(await cmdApp(["product-docs", APP, ...common, "--execute", "--confirm", `${APP}:keep`])).toBe(0);
    } finally {
      output.mockRestore();
    }
    expect((await readManifest(target)).disposition).toMatchObject({ value: "keep" });
  });

  it.each(["typescript-node", "bare"] as const)(
    "recognizes and migrates an exact pre-manifest %s new-app scaffold before planning",
    async (template) => {
      const org = await makeTempOrgHome({ name: "cf-reg-369-legacy" });
      temps.push(org.root);
      const target = join(org.root, APP);
      await createNewApp({
        appName: APP,
        targetDir: target,
        repoSlug: REPO,
        goal: GOAL,
        template,
        orgHome: org.orgHome,
        stateHome: org.stateHome,
      });
      await rm(join(target, ".cormidia/bootstrap/product-docs.json"));
      await writeFile(join(target, ".cormidia/planning/0001-greenfield-seed.md"), legacyPlanningSeed(template), "utf8");

      await expect(prepareProductDocPlanning({ workdir: target, app: APP, repository: REPO })).rejects.toThrow(
        /legacy scaffold product documents have no keep\/reconcile\/remove disposition/,
      );
      const preview = await planProductDocDisposition(input(target, "keep"));
      expect(preview.migrates_legacy_scaffold).toBe(true);
      expect(preview.documents.map((document) => document.status)).toEqual([
        "placeholder",
        "placeholder",
        "placeholder",
      ]);

      await executeProductDocDisposition(input(target, "keep"));
      const migrated = JSON.parse(await readFile(join(target, ".cormidia/bootstrap/product-docs.json"), "utf8"));
      expect(migrated.disposition.value).toBe("keep");
      await expect(prepareProductDocPlanning({ workdir: target, app: APP, repository: REPO })).resolves.toMatchObject({
        kind: "scaffolded",
        disposition: "keep",
        template,
      });
    },
  );

  it("negative control: ambiguous pre-manifest scaffold evidence fails closed instead of bypassing disposition", async () => {
    const org = await makeTempOrgHome({ name: "cf-reg-369-legacy-ambiguous" });
    temps.push(org.root);
    const target = join(org.root, APP);
    await createNewApp({
      appName: APP,
      targetDir: target,
      repoSlug: REPO,
      goal: GOAL,
      template: "typescript-node",
      orgHome: org.orgHome,
      stateHome: org.stateHome,
    });
    await rm(join(target, ".cormidia/bootstrap/product-docs.json"));
    await writeFile(join(target, ".cormidia/planning/0001-greenfield-seed.md"), "operator-edited seed\n", "utf8");

    await expect(prepareProductDocPlanning({ workdir: target, app: APP, repository: REPO })).rejects.toThrow(
      /legacy new-app scaffold requires explicit migration.*no longer matches generated bytes/,
    );
    await expect(planProductDocDisposition(input(target, "keep"))).rejects.toThrow(/explicit migration/);
  });

  it("distinguishes untouched, replaced, and intentionally deleted documents without mutation", async () => {
    const root = await scaffold();
    expect((await planProductDocDisposition(input(root, "keep"))).documents.map((doc) => doc.status)).toEqual([
      "placeholder",
      "placeholder",
      "placeholder",
    ]);

    await writeFile(join(root, DOCS[0]!), "operator replacement\n", "utf8");
    await unlink(join(root, DOCS[1]!));
    const removePreview = await planProductDocDisposition(input(root, "remove"));
    expect(removePreview.documents.map((doc) => doc.status)).toEqual(["replacement", "absent", "placeholder"]);
    expect(removePreview.remove_paths).toEqual(["docs/ARCHITECTURE.md"]);
    expect(removePreview.blockers).toEqual([
      "docs/VISION.md: remove never deletes a user-authored replacement; delete it explicitly first",
    ]);
    await expect(executeProductDocDisposition(input(root, "remove"))).rejects.toThrow(/never deletes/);
    expect(await readFile(join(root, DOCS[0]!), "utf8")).toBe("operator replacement\n");
    expect(await readFile(join(root, DOCS[2]!), "utf8")).toBe(CONTENT.get(DOCS[2]!));
  });

  it("fails closed before planning, binds keep to reviewed bytes, and detects later drift", async () => {
    const root = await scaffold();
    await expect(prepareProductDocPlanning({ workdir: root, app: APP, repository: REPO })).rejects.toThrow(
      /no keep\/reconcile\/remove disposition/,
    );
    await writeFile(join(root, DOCS[0]!), "reviewed replacement\n", "utf8");
    await executeProductDocDisposition(input(root, "keep"));
    await expect(prepareProductDocPlanning({ workdir: root, app: APP, repository: REPO })).resolves.toMatchObject({
      kind: "scaffolded",
      disposition: "keep",
    });

    await writeFile(join(root, DOCS[0]!), "unreviewed drift\n", "utf8");
    await expect(prepareProductDocPlanning({ workdir: root, app: APP, repository: REPO })).rejects.toThrow(
      /changed after their disposition was recorded/,
    );
  });

  it("remove deletes only exact placeholders and keeps every optional document absent", async () => {
    const root = await scaffold();
    const result = await executeProductDocDisposition(input(root, "remove"));
    expect(result.already_recorded).toBe(true);
    expect(result.documents.map((doc) => doc.status)).toEqual(["absent", "absent", "absent"]);
    await expect(prepareProductDocPlanning({ workdir: root, app: APP, repository: REPO })).resolves.toMatchObject({
      kind: "scaffolded",
      disposition: "remove",
    });
  });

  it("negative control: a replacement arriving after remove preview is preserved and no decision is recorded", async () => {
    const root = await scaffold();
    await expect(
      executeProductDocDisposition({
        ...input(root, "remove"),
        beforeRemove: () => writeFile(join(root, DOCS[0]!), "late replacement\n", "utf8"),
      }),
    ).rejects.toThrow(/never deletes a user-authored replacement/);
    expect(await readFile(join(root, DOCS[0]!), "utf8")).toBe("late replacement\n");
    expect(await readFile(join(root, DOCS[1]!), "utf8")).toBe(CONTENT.get(DOCS[1]!));
    expect((await readManifest(root)).disposition).toBeNull();
  });

  it("negative control: a mid-removal replacement rolls every staged placeholder back", async () => {
    const root = await scaffold();
    await expect(
      executeProductDocDisposition({
        ...input(root, "remove"),
        afterRemoveStage: async (index) => {
          if (index === 0) await writeFile(join(root, DOCS[1]!), "mid-transaction replacement\n", "utf8");
        },
      }),
    ).rejects.toThrow(/changed after preview; replacement preserved/);
    expect(await readFile(join(root, DOCS[0]!), "utf8")).toBe(CONTENT.get(DOCS[0]!));
    expect(await readFile(join(root, DOCS[1]!), "utf8")).toBe("mid-transaction replacement\n");
    expect(await readFile(join(root, DOCS[2]!), "utf8")).toBe(CONTENT.get(DOCS[2]!));
    expect((await readManifest(root)).disposition).toBeNull();
    await expect(
      readFile(join(root, ".cormidia/bootstrap/product-doc-remove-staging/transaction.json")),
    ).rejects.toThrow();
  });

  it("reconcile requires a consumed authoritative source outside the scaffold documents", async () => {
    const root = await scaffold();
    await executeProductDocDisposition(input(root, "reconcile"));
    await expect(prepareProductDocPlanning({ workdir: root, app: APP, repository: REPO })).rejects.toThrow(
      /requires at least one consumed --source outside/,
    );
    await expect(
      prepareProductDocPlanning({ workdir: root, app: APP, repository: REPO, sources: sources("docs/VISION.md") }),
    ).rejects.toThrow(/requires at least one consumed --source outside/);
    await expect(
      prepareProductDocPlanning({
        workdir: root,
        app: APP,
        repository: REPO,
        sources: sources("design/approved/spec.md"),
      }),
    ).resolves.toMatchObject({ kind: "scaffolded", disposition: "reconcile" });
  });

  it("negative control: rejects a tampered manifest path before it can escape the app root", async () => {
    const root = await scaffold();
    const path = join(root, ".cormidia/bootstrap/product-docs.json");
    const record = JSON.parse(await readFile(path, "utf8"));
    record.documents[0].path = "../../victim";
    await writeFile(path, `${JSON.stringify(record)}\n`, "utf8");
    await expect(planProductDocDisposition(input(root, "remove"))).rejects.toThrow(/not a valid v1 scaffold record/);
  });

  it("negative control: refuses a symlinked product-document directory", async () => {
    const root = await scaffold();
    const outside = join(root, "outside-docs");
    await mkdir(outside);
    await rm(join(root, "docs"), { recursive: true });
    await symlink(outside, join(root, "docs"));
    await expect(planProductDocDisposition(input(root, "remove"))).rejects.toThrow(/docs is a symbolic link/);
  });

  it("negative control: recovery never follows bootstrap metadata outside the checkout", async () => {
    const root = await scaffold();
    const bootstrap = join(root, ".cormidia/bootstrap");
    const manifest = await readFile(join(bootstrap, "product-docs.json"), "utf8");
    const record = JSON.parse(manifest);
    const outside = join(root, "outside-bootstrap");
    const staging = join(outside, "product-doc-remove-staging");
    await mkdir(staging, { recursive: true });
    await writeFile(join(outside, "product-docs.json"), manifest, "utf8");
    await writeFile(join(staging, "0-VISION.md"), CONTENT.get(DOCS[0]!)!, "utf8");
    await writeFile(
      join(staging, "transaction.json"),
      `${JSON.stringify({
        schema_version: 1,
        kind: "product-doc-removal-staging",
        entries: [
          {
            path: DOCS[0],
            staged: "0-VISION.md",
            scaffold_sha256: record.documents[0].scaffold_sha256,
          },
        ],
      })}\n`,
      "utf8",
    );
    await rm(bootstrap, { recursive: true });
    await symlink(outside, bootstrap);

    await expect(executeProductDocDisposition(input(root, "remove"))).rejects.toThrow(
      /.cormidia\/bootstrap is a symbolic link/,
    );
    await expect(readFile(join(staging, "0-VISION.md"), "utf8")).resolves.toBe(CONTENT.get(DOCS[0]!));
  });
});

async function scaffold(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "cormidia-cf-reg-369-"));
  temps.push(root);
  await mkdir(join(root, "docs"), { recursive: true });
  await mkdir(join(root, ".cormidia/bootstrap"), { recursive: true });
  for (const path of DOCS) await writeFile(join(root, path), CONTENT.get(path)!, "utf8");
  const manifest = renderProductDocScaffoldRecord({
    app: APP,
    repository: REPO,
    template: "typescript-node",
    documents: DOCS.map((path) => ({ path, content: CONTENT.get(path)! })),
  });
  await writeFile(join(root, ".cormidia/bootstrap/product-docs.json"), manifest, "utf8");
  return root;
}

function input(root: string, disposition: "keep" | "reconcile" | "remove") {
  return { workdir: root, app: APP, repository: REPO, disposition };
}

function sources(path: string): PlanningSourceManifest {
  return {
    schema_version: 1,
    kind: "planning-source-manifest",
    app: APP,
    trace_id: "trace",
    source_checkout: "/tmp/checkout",
    source_checkout_head: "0123456789abcdef0123456789abcdef01234567",
    budget_bytes: 1024,
    included_bytes: 4,
    manifest_sha256: "a".repeat(64),
    roots: [],
    sources: [
      {
        source_id: "source-1",
        root_index: 0,
        requested_path: path,
        canonical_path: `/tmp/checkout/${path}`,
        canonical_ref: `repo:${path}`,
        source_sha256: "b".repeat(64),
        source_bytes: 4,
        included_bytes: 4,
        trust: "operator-supplied-untrusted-data",
        provenance: "cli:--source",
        requirement: "required",
        availability: "available",
        selection: "selected",
        inclusion: "full",
        consumption: "consumed",
        reason: null,
      },
    ],
  };
}

async function readManifest(root: string): Promise<{ disposition: unknown }> {
  return JSON.parse(await readFile(join(root, ".cormidia/bootstrap/product-docs.json"), "utf8"));
}

function legacyPlanningSeed(template: "typescript-node" | "bare"): string {
  if (template === "bare") {
    return `# Greenfield Planning Seed - ${APP}

## Product Goal

${GOAL}

## Template Boundary

The operator explicitly selected the stack-neutral \`bare\` template. The
scaffold emitted no application/runtime skeleton and did not infer a stack from
the free-form goal.

## Planner Task

Refine docs/VISION.md and docs/REQUIREMENTS.md into a buildable first milestone.
The first implementation dependency must explicitly select and document the
stack, add real source and local workflows, and establish meaningful
stack-specific test and lint gates in \`.cormidia/config.yaml\`.

## Decomposition Guidance

- Start with a product-definition ticket only if the current PRD is too vague.
- Keep stack selection, the first observable slice, and non-vacuous gate setup
  together or encode explicit dependencies that prevent implementation from
  being certified before its gates exist.
- Add infrastructure tickets only when the first slice needs them.
- Keep Support and Marketing work tied to declared channels and real artifacts.
`;
  }
  return `# Greenfield Planning Seed - ${APP}

## Product Goal

${GOAL}

## Planner Task

Refine docs/VISION.md and docs/REQUIREMENTS.md into a buildable first milestone.
Prefer concrete GitHub issues with binary acceptance criteria and named tests.

## Decomposition Guidance

- Start with a product-definition ticket only if the current PRD is too vague.
- Next create one first-slice implementation ticket.
- Add infrastructure tickets only when the first slice needs them.
- Keep Support and Marketing work tied to declared channels and real artifacts.
`;
}
