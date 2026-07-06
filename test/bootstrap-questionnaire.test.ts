// `operon bootstrap` — questionnaire + app charter/config emission (M3.4):
// answers (docs/architecture.md §9 step 2) become `.operon/TASTE.md` (the
// product charter, TASTE layer [3]), `.operon/config.yaml` (the app's
// registry entry, apps.yaml schema), `.operon/policy.yaml` (app-owned gate
// policy), and one seeded OKF memory bundle per enabled role. bootstrapRun
// composes the org half (M3.3) with this app half.

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
  templateRoleNames,
  ORG_TEMPLATE_FILES,
  type BootstrapAnswers,
} from "../src/org/bootstrap.js";
import { loadApps } from "../src/org/apps.js";
import { cmdBootstrap, collectAnswers } from "../src/cli/bootstrap.js";

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
    const { scan, created } = await bootstrapRun(target, RAW_ANSWERS);

    expect(scan.repoSlug).toBe("bikramgupta/operon-sandbox-alpha");
    // Org skeleton first (M3.3), then the app half — and roles.yaml order
    // for the memory bundles comes from the real template roles.yaml.
    const roleNames = await templateRoleNames();
    expect(created).toEqual([
      ...ORG_TEMPLATE_FILES,
      ".operon/TASTE.md",
      ".operon/config.yaml",
      ".operon/policy.yaml",
      ...roleNames.map((r) => `.operon/memory/${r}/INDEX.md`),
    ]);
    for (const rel of created) expect(existsSync(join(target, rel))).toBe(true);

    const file = await loadApps(join(target, ".operon", "config.yaml"));
    expect(file.schemaVersion).toBe(1);
    expect(file.org.name).toBe(basenameOf(target));
    expect(file.apps).toHaveLength(1);
    expect(file.apps[0]!.repo).toBe("bikramgupta/operon-sandbox-alpha");
    expect(file.apps[0]!.status).toBe("onboarding");
    expect(file.apps[0]!.budgetUsdMonth).toBe(250);
  });

  it("validates answers before writing anything", async () => {
    const target = makeRepo(NODE_REPO_FILES);
    await expect(
      bootstrapRun(target, { ...RAW_ANSWERS, roles: ["astrologer"] }),
    ).rejects.toThrow(/not a role in the org roles\.yaml/);
    expect(existsSync(join(target, ".operon"))).toBe(false);
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

    const code = await cmdBootstrap([target, "--answers", answersFile]);
    expect(code).toBe(0);

    const out = log.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toContain("created:");
    expect(out).toContain(".operon/TASTE.md");
    expect(out).toContain(".operon/config.yaml");
    expect(out).toContain(".operon/policy.yaml");
    expect(out).toContain(".operon/memory/planner/INDEX.md");
    expect(existsSync(join(target, ".operon", "TASTE.md"))).toBe(true);
    expect(existsSync(join(target, ".operon", "config.yaml"))).toBe(true);
    expect(existsSync(join(target, ".operon", "policy.yaml"))).toBe(true);
    expect(existsSync(join(target, ".operon", "org", "apps.yaml"))).toBe(true);
  });

  it("fails loudly when the answers file is not valid JSON", async () => {
    const target = makeRepo(NODE_REPO_FILES);
    const answersFile = join(makeRepo(), "answers.json");
    writeFileSync(answersFile, "{not json");
    await expect(cmdBootstrap([target, "--answers", answersFile])).rejects.toThrow(
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
      ["A thing.", "It works.", "", "", "", "", "", "", ""],
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
      ".operon/config.yaml",
      ".operon/policy.yaml",
      ".operon/memory/planner/INDEX.md",
      ".operon/memory/reviewer/INDEX.md",
    ]);
  });
});
