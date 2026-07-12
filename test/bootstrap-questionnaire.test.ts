// Tests bootstrap answer parsing plus app-owned artifact emission.
// Covers questionnaire defaults and validation, .operon/TASTE.md/config/policy
// generation, onboarding reports, role memory indexes, full bootstrapRun, and
// scripted interactive input.
// Uses temp repos, injected streams, and repo-local templates only; no network,
// auth, real org state, or wall-clock time is required.

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import {
  appArtifactFiles,
  bootstrapRun,
  emitAppArtifacts,
  parseAnswers,
  type BootstrapAnswers,
} from "../src/org/bootstrap.js";
import { loadApps } from "../src/org/apps.js";
import { cmdBootstrap, collectAnswers } from "../src/cli/bootstrap.js";
import { initOrgHome } from "../src/org/home.js";

const ALL_ROLES = ["planner", "builder", "reviewer", "sre", "support", "marketing"];

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/** Write a file map (relative path -> content) into a fresh temp repo root. */
function makeRepo(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "operon-questionnaire-"));
  tempDirs.push(root);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
  return root;
}

async function makeCompleteOrg(name: string): Promise<string> {
  const orgHome = join(makeRepo(), "org");
  await initOrgHome({ target: orgHome, name, homeDir: makeRepo() });
  return orgHome;
}

const RAW_ANSWERS = {
  product: "A tiny sandbox app the org practices the build loop on.",
  good: "Small, well-tested changes; honest docs; green CI on every merge.",
  roles: ALL_ROLES,
  budgetUsdMonth: 250,
  criticalOps: {
    deployCommands: ["pnpm run deploy"],
    publishTargets: ["npmjs.com/package/sandbox-alpha"],
    secretLocations: [".env.production"],
  },
  channels: { support: ["github discussions"], marketing: ["release blog"] },
};

function answers(overrides: Record<string, unknown> = {}): BootstrapAnswers {
  return parseAnswers({ ...RAW_ANSWERS, ...overrides }, ALL_ROLES);
}

describe("parseAnswers", () => {
  it("applies defaults: budget 1000, empty cadence, empty critical-op lists", () => {
    const a = parseAnswers(
      { product: "A thing.", good: "It works.", roles: ["planner"] },
      ALL_ROLES,
    );
    expect(a.budgetUsdMonth).toBe(1000); // docs/PURPOSE.md → Budget & cadence
    expect(a.cadence).toEqual({});
    expect(a.criticalOps).toEqual({
      deployCommands: [],
      publishTargets: [],
      secretLocations: [],
    });
    expect(a.channels).toEqual({}); // no audience-facing role enabled
    expect(a.authority).toEqual({ mode: "inherit" });
  });

  it("gives enabled support/marketing explicit empty channel lists", () => {
    const a = parseAnswers(
      { product: "A thing.", good: "It works.", roles: ["support", "marketing"] },
      ALL_ROLES,
    );
    expect(a.channels).toEqual({ support: [], marketing: [] });
  });

  it("rejects a role not present in the org roles.yaml", () => {
    expect(() => answers({ roles: ["planner", "astrologer"] })).toThrow(
      /"astrologer" is not a role in the org roles\.yaml/,
    );
  });

  it("rejects an empty roles list", () => {
    expect(() => answers({ roles: [] })).toThrow(/roles must be a non-empty list/);
  });

  it("rejects a cadence entry for a role that is not enabled", () => {
    expect(() =>
      answers({ roles: ["planner"], cadence: { builder: [{ event: "ticket-ready" }] }, channels: {} }),
    ).toThrow(/cadence\.builder: "builder" is not an enabled role/);
  });

  it("rejects channels for a role that is not enabled", () => {
    expect(() =>
      answers({ roles: ["planner"], channels: { support: ["forum"] } }),
    ).toThrow(/channels\.support: role "support" is not enabled/);
  });

  it("rejects unknown top-level keys loudly", () => {
    expect(() => answers({ vibe: "good" })).toThrow(/unknown key "vibe"/);
  });

  it("rejects missing product or good text", () => {
    expect(() => answers({ product: "  " })).toThrow(/product is required/);
    expect(() => answers({ good: undefined })).toThrow(/good is required/);
  });

  it("accepts only app-level authority narrowing", () => {
    expect(
      answers({
        authority: {
          mode: "custom",
          restrictions: "Ask before changing public API contracts.",
        },
      }).authority,
    ).toEqual({
      mode: "custom",
      restrictions: "Ask before changing public API contracts.",
    });
    expect(() => answers({ authority: { mode: "custom" } })).toThrow(
      /authority\.restrictions is required/,
    );
    expect(() =>
      answers({ authority: { mode: "inherit", restrictions: "broader" } }),
    ).toThrow(/valid only when authority\.mode is custom/);
  });
});

describe("emitAppArtifacts", () => {
  it("charter renders answers", async () => {
    const target = makeRepo();
    await emitAppArtifacts(target, {
      appName: "sandbox-alpha",
      repoSlug: "bikramgupta/operon-sandbox-alpha",
      answers: answers(),
      allRoles: ALL_ROLES,
    });

    const charter = await readFile(join(target, ".operon", "TASTE.md"), "utf8");
    expect(charter).toContain("# TASTE.md — sandbox-alpha product charter");
    expect(charter).toContain("## What this product is");
    expect(charter).toContain(RAW_ANSWERS.product);
    expect(charter).toContain('## What "good" means here');
    expect(charter).toContain(RAW_ANSWERS.good);
  });

  it("config.yaml embeds schema_version, budget, and default-empty cadence", async () => {
    const target = makeRepo();
    await emitAppArtifacts(target, {
      appName: "sandbox-alpha",
      repoSlug: "bikramgupta/operon-sandbox-alpha",
      answers: answers(), // all roles enabled, no cadence overrides
      allRoles: ALL_ROLES,
    });

    const raw = parse(await readFile(join(target, ".operon", "config.yaml"), "utf8")) as Record<
      string,
      Record<string, Record<string, Record<string, unknown>>>
    >;
    expect(raw["schema_version"]).toBe(1);
    const entry = raw["apps"]!["sandbox-alpha"]!;
    expect(entry["budget_usd_month"]).toBe(250);
    expect(entry["cadence"]).toEqual({});
  });

  it("critical-op extensions included in the app entry", async () => {
    const target = makeRepo();
    await emitAppArtifacts(target, {
      appName: "sandbox-alpha",
      repoSlug: "bikramgupta/operon-sandbox-alpha",
      answers: answers(),
      allRoles: ALL_ROLES,
    });

    const raw = parse(await readFile(join(target, ".operon", "config.yaml"), "utf8")) as Record<
      string,
      Record<string, Record<string, unknown>>
    >;
    const entry = raw["apps"]!["sandbox-alpha"] as Record<string, unknown>;
    expect(entry["critical_ops"]).toEqual({
      deploy_commands: ["pnpm run deploy"],
      publish_targets: ["npmjs.com/package/sandbox-alpha"],
      secret_locations: [".env.production"],
    });
    expect(entry["channels"]).toEqual({
      support: ["github discussions"],
      marketing: ["release blog"],
    });
  });

  it("policy.yaml is emitted from docs/policy.yaml.template", async () => {
    const target = makeRepo();
    await emitAppArtifacts(target, {
      appName: "sandbox-alpha",
      repoSlug: "bikramgupta/operon-sandbox-alpha",
      answers: answers(),
      allRoles: ALL_ROLES,
    });

    const emitted = await readFile(join(target, ".operon", "policy.yaml"), "utf8");
    const template = await readFile(join(fileURLToPath(new URL("..", import.meta.url)), "docs", "policy.yaml.template"), "utf8");
    expect(emitted).toBe(template);
  });

  it("onboarding report inventories docs and setup gaps without product inference", async () => {
    const target = makeRepo({
      "README.md": "# Sandbox Alpha\n",
      "docs/architecture.md": "# Architecture\n",
      "docs/specs/api.md": "# API spec\n",
      "package.json": JSON.stringify({
        scripts: { test: "node --test" },
      }),
      ".github/workflows/ci.yml": "jobs:\n  ci:\n    steps:\n      - run: npm test\n",
    });

    await emitAppArtifacts(target, {
      appName: "sandbox-alpha",
      repoSlug: "bikramgupta/operon-sandbox-alpha",
      answers: answers({
        criticalOps: { deployCommands: [], publishTargets: [], secretLocations: [] },
        channels: { support: [], marketing: [] },
      }),
      allRoles: ALL_ROLES,
    });

    const report = await readFile(join(target, ".operon", "onboarding-report.md"), "utf8");
    expect(report).toContain("This report inventories existing documentation and setup signals.");
    expect(report).toContain("It does not infer product truth from source code.");
    expect(report).toContain("Gaps are onboarding guidance, not blockers");
    expect(report).toContain("README.md");
    expect(report).toContain("docs/architecture.md");
    expect(report).toContain("docs/specs/api.md");
    expect(report).toContain("Operations / runbook: Add runbook, deploy, or operations docs");
    expect(report).toContain("support (gap): Support is enabled but no support channels");
    expect(report).toContain("marketing (gap): Marketing is enabled but no marketing channels");
    expect(report).toContain("sre (warning): SRE is enabled but no operations/runbook docs");
  });

  it("one INDEX.md per enabled role; disabled roles get empty cadence overrides", async () => {
    const target = makeRepo();
    const enabled = ["planner", "builder", "reviewer"];
    await emitAppArtifacts(target, {
      appName: "sandbox-alpha",
      repoSlug: "bikramgupta/operon-sandbox-alpha",
      answers: answers({ roles: enabled, channels: {} }),
      allRoles: ALL_ROLES,
    });

    const memoryDirs = (await readdir(join(target, ".operon", "memory"))).sort();
    expect(memoryDirs).toEqual([...enabled].sort());
    for (const role of enabled) {
      const index = await readFile(join(target, ".operon", "memory", role, "INDEX.md"), "utf8");
      expect(index).toContain(`# ${role} — sandbox-alpha domain memory (INDEX)`);
    }

    // The registry schema's disable mechanism: an empty trigger list
    // (src/org/apps.ts — resolveTriggers) for every un-enabled role.
    const file = await loadApps(join(target, ".operon", "config.yaml"));
    expect(file.apps[0]!.cadence).toEqual({ sre: [], support: [], marketing: [] });
  });

  it("keeps answered cadence overrides for enabled roles", async () => {
    const target = makeRepo();
    await emitAppArtifacts(target, {
      appName: "sandbox-alpha",
      repoSlug: "bikramgupta/operon-sandbox-alpha",
      answers: answers({ cadence: { planner: [{ schedule: "weekly mon" }] } }),
      allRoles: ALL_ROLES,
    });

    const file = await loadApps(join(target, ".operon", "config.yaml"));
    expect(file.apps[0]!.cadence).toEqual({ planner: [{ schedule: "weekly mon" }] });
  });

  it("refuses to overwrite an existing app artifact before writing anything", async () => {
    const target = makeRepo({ ".operon/TASTE.md": "# already here\n" });
    await expect(
      emitAppArtifacts(target, {
        appName: "sandbox-alpha",
        answers: answers(),
        allRoles: ALL_ROLES,
      }),
    ).rejects.toThrow(/refusing to overwrite/);
    expect(existsSync(join(target, ".operon", "config.yaml"))).toBe(false);
    expect(existsSync(join(target, ".operon", "memory"))).toBe(false);
  });

  it("refuses to overwrite an existing onboarding report before writing anything", async () => {
    const target = makeRepo({ ".operon/onboarding-report.md": "# already here\n" });
    await expect(
      emitAppArtifacts(target, {
        appName: "sandbox-alpha",
        answers: answers(),
        allRoles: ALL_ROLES,
      }),
    ).rejects.toThrow(/onboarding-report\.md already exists/);
    expect(existsSync(join(target, ".operon", "TASTE.md"))).toBe(false);
    expect(existsSync(join(target, ".operon", "config.yaml"))).toBe(false);
    expect(existsSync(join(target, ".operon", "policy.yaml"))).toBe(false);
  });
});

const NODE_REPO_FILES: Record<string, string> = {
  "package.json": JSON.stringify({
    name: "sandbox-alpha",
    packageManager: "pnpm@11.10.0",
    scripts: { build: "tsc", test: "node --test", lint: "eslint ." },
    devDependencies: { typescript: "^5.0.0" },
  }),
  "tsconfig.json": "{}",
  "AGENTS.md": "# AGENTS\n",
  ".git/config": '[remote "origin"]\n\turl = git@github.com:bikramgupta/operon-sandbox-alpha.git\n',
};

describe("bootstrapRun", () => {
  it("full bootstrapRun writes the tree and config.yaml round-trips through the apps parser", async () => {
    const target = makeRepo(NODE_REPO_FILES);
    const orgHome = await makeCompleteOrg("questionnaire-library");
    const { scan, created, updated, joinedOrgHome } = await bootstrapRun(target, RAW_ANSWERS, { orgHome });

    expect(scan.repoSlug).toBe("bikramgupta/operon-sandbox-alpha");
    expect(joinedOrgHome).toBe(orgHome);
    // Memory bundle order comes from the selected org's roles.yaml.
    expect(created).toEqual([
      ".operon/TASTE.md",
      ".operon/AUTHORITY.md",
      ".operon/config.yaml",
      ".operon/policy.yaml",
      ".operon/onboarding-report.md",
      ...ALL_ROLES.map((r) => `.operon/memory/${r}/INDEX.md`),
      "CLAUDE.md",
    ]);
    expect(updated).toEqual(["AGENTS.md"]);
    for (const rel of created) expect(existsSync(join(target, rel))).toBe(true);

    const file = await loadApps(join(target, ".operon", "config.yaml"));
    expect(file.schemaVersion).toBe(1);
    expect(file.org.name).toBe(basenameOf(target));
    expect(file.apps).toHaveLength(1);
    expect(file.apps[0]!.repo).toBe("bikramgupta/operon-sandbox-alpha");
    expect(file.apps[0]!.status).toBe("onboarding");
    expect(file.apps[0]!.budgetUsdMonth).toBe(250);
    const agents = await readFile(join(target, "AGENTS.md"), "utf8");
    expect(agents.startsWith("# AGENTS\n")).toBe(true);
    expect(agents.match(/operon-authority:start/g)).toHaveLength(1);
    expect(await readFile(join(target, "CLAUDE.md"), "utf8")).toContain(
      ".operon/AUTHORITY.md",
    );
    expect(await readFile(join(target, ".operon", "onboarding-report.md"), "utf8")).toContain(
      "## Delegated Operator Authority",
    );
  });

  it("validates answers before writing anything", async () => {
    const target = makeRepo(NODE_REPO_FILES);
    const orgHome = await makeCompleteOrg("questionnaire-invalid");
    await expect(
      bootstrapRun(target, { ...RAW_ANSWERS, roles: ["astrologer"] }, { orgHome }),
    ).rejects.toThrow(/not a role in the org roles\.yaml/);
    expect(existsSync(join(target, ".operon"))).toBe(false);
  });

  it("rejects malformed instruction markers before app or org writes", async () => {
    const target = makeRepo({
      ...NODE_REPO_FILES,
      "AGENTS.md": "# Existing\n\n<!-- operon-authority:start -->\nbroken\n",
    });
    const orgHome = await makeCompleteOrg("questionnaire-malformed-instructions");
    await expect(bootstrapRun(target, RAW_ANSWERS, { orgHome })).rejects.toThrow(
      /malformed Operon authority block/,
    );
    expect(existsSync(join(target, ".operon"))).toBe(false);
    expect((await loadApps(join(orgHome, "apps.yaml"))).apps).toEqual([]);
  });
});

function basenameOf(path: string): string {
  return path.split("/").filter(Boolean).pop()!;
}

describe("cmdBootstrap --answers", () => {
  afterEach(() => vi.restoreAllMocks());

  it("creates the tree from an answers.json file", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const target = makeRepo(NODE_REPO_FILES);
    const answersFile = join(makeRepo(), "answers.json");
    writeFileSync(answersFile, JSON.stringify(RAW_ANSWERS));
    const orgHome = join(makeRepo(), "org");
    await initOrgHome({ target: orgHome, name: "questionnaire", homeDir: makeRepo() });

    const code = await cmdBootstrap([target, "--answers", answersFile, "--org-home", orgHome]);
    expect(code).toBe(0);

    const out = log.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toContain("created:");
    expect(out).toContain(".operon/TASTE.md");
    expect(out).toContain(".operon/config.yaml");
    expect(out).toContain(".operon/policy.yaml");
    expect(out).toContain(".operon/onboarding-report.md");
    expect(out).toContain(".operon/memory/planner/INDEX.md");
    expect(existsSync(join(target, ".operon", "TASTE.md"))).toBe(true);
    expect(existsSync(join(target, ".operon", "config.yaml"))).toBe(true);
    expect(existsSync(join(target, ".operon", "policy.yaml"))).toBe(true);
    expect(existsSync(join(target, ".operon", "onboarding-report.md"))).toBe(true);
    expect(existsSync(join(target, ".operon", "org", "apps.yaml"))).toBe(false);
  });

  it("fails loudly when the answers file is not valid JSON", async () => {
    const target = makeRepo(NODE_REPO_FILES);
    const answersFile = join(makeRepo(), "answers.json");
    writeFileSync(answersFile, "{not json");
    const orgHome = join(makeRepo(), "org");
    await initOrgHome({ target: orgHome, name: "invalid-answers", homeDir: makeRepo() });
    await expect(cmdBootstrap([target, "--answers", answersFile, "--org-home", orgHome])).rejects.toThrow(
      /is not valid JSON/,
    );
    expect(existsSync(join(target, ".operon"))).toBe(false);
  });

  it("rejects --answers without a path", async () => {
    await expect(cmdBootstrap(["--answers"])).rejects.toThrow(/--answers requires a path/);
  });
});

describe("collectAnswers (interactive questionnaire over injected streams)", () => {
  /** Answer each prompt as it appears — lines written while no question is
   * pending would be dropped by readline, so scripted input must be
   * prompt-driven. */
  function drive(lines: string[], knownRoles: string[]): Promise<Record<string, unknown>> {
    const input = new PassThrough();
    const output = new PassThrough();
    const queue = [...lines];
    output.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("> ") && queue.length > 0) {
        input.write(`${queue.shift()}\n`);
      }
    });
    return collectAnswers(input, output, knownRoles);
  }

  it("collects the questionnaire answers in §9 step-2 order", async () => {
    const raw = await drive(
      [
        "A sandbox app.", // product
        "Green tests, honest docs.", // good
        "planner, builder, support", // roles
        "500", // budget
        "inherit", // app authority
        "pnpm run deploy", // critical ops: deploy commands
        "", // critical ops: publish targets
        ".env", // critical ops: secret locations
        "github discussions, email", // support channels (support enabled)
        // no marketing question — marketing not enabled
      ],
      ALL_ROLES,
    );

    expect(raw).toEqual({
      product: "A sandbox app.",
      good: "Green tests, honest docs.",
      roles: ["planner", "builder", "support"],
      budgetUsdMonth: 500,
      authority: { mode: "inherit" },
      criticalOps: {
        deployCommands: ["pnpm run deploy"],
        publishTargets: [],
        secretLocations: [".env"],
      },
      channels: { support: ["github discussions", "email"] },
    });
    // The interactive shape is the --answers shape: same validation path.
    expect(() => parseAnswers(raw, ALL_ROLES)).not.toThrow();
  });

  it("empty roles and budget answers mean all roles and the default budget", async () => {
    const raw = await drive(
      ["A thing.", "It works.", "", "", "", "", "", "", "", ""],
      ALL_ROLES,
    );
    expect(raw["roles"]).toEqual(ALL_ROLES);
    expect(raw["budgetUsdMonth"]).toBeUndefined();
    expect(parseAnswers(raw, ALL_ROLES).budgetUsdMonth).toBe(1000);
  });
});

describe("appArtifactFiles", () => {
  it("lists charter, config, and one memory index per enabled role in roles.yaml order", () => {
    const files = appArtifactFiles(answers({ roles: ["reviewer", "planner"], channels: {} }), ALL_ROLES);
    expect(files).toEqual([
      ".operon/TASTE.md",
      ".operon/AUTHORITY.md",
      ".operon/config.yaml",
      ".operon/policy.yaml",
      ".operon/onboarding-report.md",
      ".operon/memory/planner/INDEX.md",
      ".operon/memory/reviewer/INDEX.md",
    ]);
  });
});
