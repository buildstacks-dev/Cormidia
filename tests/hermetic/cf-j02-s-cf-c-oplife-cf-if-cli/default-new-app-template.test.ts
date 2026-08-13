// Traceability: CF-J02-S · HB-042; CF-C-OPLIFE · HB-015; CF-IF-CLI · HB-033 ·
// contracts/journey-acceptance.md J-02, J-03 (bare orders stack-and-gates first).

// Derivation chain (validation-design/routing.md → "Feature changes"), #383:
// scope-and-module-map §2 places bootstrap/new-app in M10; reverse-reading
// system-map §3 gives M10 → J-01/J-02/J-14/J-21, narrowed by the changed call
// site (template resolution inside `createNewApp`) to J-02, with J-03 joined by
// the bare stack-and-gates ordering clause; journey-acceptance J-02 resolves to
// C-OP-LIFE §3a and INV-008/010. Rows derived: journey (§1 CF-J02-S), contract
// (§5 CF-C-OPLIFE), interface (§6 CF-IF-CLI). No new journey, boundary,
// invariant, or LLM call site — case-level additions against existing structure.

import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cmdNewApp } from "../../../src/cli/new-app.js";
import { DEFAULT_NEW_APP_TEMPLATE, createNewApp, NEW_APP_TEMPLATES } from "../../../src/org/new-app.js";
import { PACKAGE_ROOT } from "../../../src/org/home.js";
import { makeTempOrgHome, type TempOrgHome } from "../../fixtures/org-home.js";

const APP = "atlas";
const REPO = "acme/atlas";
const GOAL = "deliver one observable atlas milestone";

const homes: TempOrgHome[] = [];

afterEach(async () => {
  for (const home of homes.splice(0).reverse()) await home.cleanup();
});

async function org(name: string): Promise<TempOrgHome> {
  const home = await makeTempOrgHome({ name });
  homes.push(home);
  return home;
}

async function walk(dir: string, acc: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path, acc);
    else acc.push(path);
  }
  return acc;
}

/** Every absolute path a scaffold can legitimately embed. All four vary per
 * machine and per run, so all four are normalized before hashing: "byte
 * identical" must mean the scaffold, never the tmpdir or the checkout root. */
function normalizePaths(text: string, home: TempOrgHome): string {
  return text
    .split(home.root)
    .join("<ROOT>")
    .split(home.orgHome)
    .join("<ORG>")
    .split(home.stateHome)
    .join("<STATE>")
    .split(PACKAGE_ROOT)
    .join("<PACKAGE>");
}

async function scaffoldHashes(home: TempOrgHome, target: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const path of (await walk(target)).sort()) {
    const text = normalizePaths(await readFile(path, "utf8"), home);
    // Structural guard: an un-normalized absolute path makes the digest
    // machine-dependent, which is exactly how the first version of this fixture
    // passed locally and failed in CI.
    expect(text).not.toContain(home.root);
    expect(text).not.toContain(PACKAGE_ROOT.replace(/\/$/, ""));
    out.set(relative(target, path), createHash("sha256").update(text).digest("hex"));
  }
  return out;
}

/** `shasum -a 256` shape: digest first, then the path. Deliberately NOT a
 * `path: digest` map — that pairs a secret-ish keyword (`AUTHORITY`, `client`)
 * with a high-entropy value and trips the gitleaks generic-api-key rule, and
 * this repo's `.gitleaks.toml` is tighten-only: no fixture allowlists. */
function renderBaseline(hashes: Map<string, string>): string {
  return `${[...hashes].map(([path, digest]) => `${digest}  ${path}`).join("\n")}\n`;
}

function parseBaseline(text: string): Map<string, string> {
  const rows = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  return new Map(
    rows.map((line) => {
      const [digest, path] = line.split(/\s{2,}/);
      if (digest === undefined || path === undefined) throw new Error(`malformed baseline row: ${line}`);
      return [path, digest];
    }),
  );
}

describe("CF-J02-S/CF-C-OPLIFE — omitting --template resolves to bare", () => {
  it("pins the default and keeps both spellings supported", () => {
    expect(DEFAULT_NEW_APP_TEMPLATE).toBe("bare");
    expect([...NEW_APP_TEMPLATES]).toEqual(["typescript-node", "bare"]);
  });

  it("resolves omission to bare in preview and execution, with bare's pending gates", async () => {
    const home = await org("cf-j02-s-default-preview");
    const preview = await createNewApp({
      appName: APP,
      targetDir: join(home.root, "preview"),
      repoSlug: REPO,
      goal: GOAL,
      orgHome: home.orgHome,
      stateHome: home.stateHome,
      dryRun: true,
    });
    expect(preview.template).toBe("bare");
    // Dry-run truthfully reports the resolved template AND the gate state.
    expect(preview.qualityGates.status).toBe("pending");
    expect(preview.qualityGates.testCommand).toBeNull();
    expect(preview.qualityGates.lintCommand).toBeNull();
    expect(preview.created).not.toContain("package.json");

    const executed = await createNewApp({
      appName: APP,
      targetDir: join(home.root, "executed"),
      repoSlug: REPO,
      goal: GOAL,
      orgHome: home.orgHome,
      stateHome: home.stateHome,
    });
    expect(executed.template).toBe("bare");
    expect(executed.qualityGates.status).toBe("pending");
  });

  it("makes omission byte-identical to an explicit --template bare", async () => {
    const omitted = await org("cf-j02-s-omitted");
    const explicit = await org("cf-j02-s-explicit");
    const omittedDir = join(omitted.root, APP);
    const explicitDir = join(explicit.root, APP);
    await createNewApp({
      appName: APP,
      targetDir: omittedDir,
      repoSlug: REPO,
      goal: GOAL,
      orgHome: omitted.orgHome,
      stateHome: omitted.stateHome,
    });
    await createNewApp({
      appName: APP,
      targetDir: explicitDir,
      repoSlug: REPO,
      goal: GOAL,
      template: "bare",
      orgHome: explicit.orgHome,
      stateHome: explicit.stateHome,
    });
    expect([...(await scaffoldHashes(omitted, omittedDir))]).toEqual([
      ...(await scaffoldHashes(explicit, explicitDir)),
    ]);
  });

  it("bare's generated guide and planning seed carry the resolved template and gate prerequisite", async () => {
    const home = await org("cf-j02-s-guide");
    const target = join(home.root, APP);
    await createNewApp({
      appName: APP,
      targetDir: target,
      repoSlug: REPO,
      goal: GOAL,
      orgHome: home.orgHome,
      stateHome: home.stateHome,
    });
    const guide = await readFile(join(target, ".cormidia/bootstrap/next-commands.md"), "utf8");
    expect(guide).toContain("Template: `bare`");
    expect(guide).toContain("bare-stack-and-gates-v1");
    expect(guide).toContain(`cormidia app verify ${APP}\` is expected to remain blocked`);
    const seed = await readFile(join(target, ".cormidia/planning/0001-greenfield-seed.md"), "utf8");
    expect(seed).toContain("stack-neutral");
    const manifest = JSON.parse(await readFile(join(target, ".cormidia/bootstrap/product-docs.json"), "utf8"));
    expect(manifest).toMatchObject({ template: "bare" });
  });
});

describe("CF-J02-S — explicit typescript-node output is unchanged", () => {
  it("emits byte-identical files to the pre-flip baseline, path for path", async () => {
    const home = await org("cf-j02-s-tsnode");
    const target = join(home.root, APP);
    const result = await createNewApp({
      appName: APP,
      targetDir: target,
      repoSlug: REPO,
      goal: GOAL,
      template: "typescript-node",
      orgHome: home.orgHome,
      stateHome: home.stateHome,
    });
    expect(result.template).toBe("typescript-node");
    expect(result.qualityGates).toMatchObject({
      status: "configured",
      setupCommand: "npm install",
      testCommand: "npm test",
      lintCommand: "npm run lint",
    });
    // The fixture was captured from the implementation BEFORE the default
    // flipped, so this fails if the flip changed the explicit scaffold at all.
    const expected = parseBaseline(
      await readFile(join(PACKAGE_ROOT, "tests/fixtures/new-app/typescript-node-scaffold.sha256"), "utf8"),
    );
    const actual = await scaffoldHashes(home, target);
    expect(renderBaseline(actual)).toBe(renderBaseline(expected));
  });
});

describe("CF-IF-CLI — the CLI reports the resolved template honestly", () => {
  it("prints bare for an omitted --template and typescript-node when asked", async () => {
    const home = await org("cf-if-cli-default");
    const lines: string[] = [];
    const capture = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
    const original = console.log;
    console.log = capture;
    try {
      await cmdNewApp([
        GOAL,
        "--name",
        APP,
        "--target-dir",
        join(home.root, "cli-default"),
        "--repo",
        REPO,
        "--goal",
        GOAL,
        "--dry-run",
        "--org-home",
        home.orgHome,
      ]);
      expect(lines.join("\n")).toContain("template: bare");
      lines.length = 0;
      await cmdNewApp([
        GOAL,
        "--name",
        APP,
        "--target-dir",
        join(home.root, "cli-explicit"),
        "--repo",
        REPO,
        "--goal",
        GOAL,
        "--template",
        "typescript-node",
        "--dry-run",
        "--org-home",
        home.orgHome,
      ]);
      expect(lines.join("\n")).toContain("template: typescript-node");
    } finally {
      console.log = original;
    }
  });

  it("seeded negative control: the pre-flip default would fail every assertion above", () => {
    // The value #383 replaced. Asserting it explicitly keeps this suite honest
    // about which constant it is pinning.
    const preFlipDefault = "typescript-node";
    expect(DEFAULT_NEW_APP_TEMPLATE).not.toBe(preFlipDefault);
  });
});
