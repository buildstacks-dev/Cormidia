// Greenfield app creation: create a separate product repo skeleton, then reuse
// the normal bootstrap path so `.operon/` artifacts and org registration stay
// identical to an existing-app onboarding.

import { existsSync } from "node:fs";
import { appendFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
  appArtifactFiles,
  bootstrapRun,
  parseAnswers,
  type BootstrapAnswers,
} from "./bootstrap.js";
import { loadRoles } from "./roles.js";

export interface NewAppOptions {
  /** Operon app key. Defaults to the target directory basename. */
  appName?: string;
  /** Local directory to create. Must be absent or empty. */
  targetDir: string;
  /** GitHub owner/repo slug the app will use once pushed. */
  repoSlug: string;
  /** Human-provided product idea or mandate. */
  goal: string;
  /** Existing org home to join. */
  orgHome: string;
  /** Declaring at least one support channel enables the Support role. */
  supportChannels?: string[];
  /** Declaring at least one marketing channel enables the Marketing role. */
  marketingChannels?: string[];
  /** Plan the files and registration without writing. */
  dryRun?: boolean;
}

export interface NewAppResult {
  appName: string;
  targetDir: string;
  repoSlug: string;
  dryRun: boolean;
  created: string[];
  updated: string[];
  joinedOrgHome?: string;
}

interface GeneratedFile {
  rel: string;
  content: string;
}

const CORE_ROLES = ["planner", "builder", "reviewer", "sre"] as const;

export async function createNewApp(options: NewAppOptions): Promise<NewAppResult> {
  const targetDir = resolve(options.targetDir);
  const appName = sanitizeAppName(options.appName ?? basename(targetDir));
  const goal = options.goal.trim();
  if (goal.length === 0) throw new Error("new-app: --goal must be a non-empty string");
  if (!isRepoSlug(options.repoSlug)) {
    throw new Error(`new-app: --repo must be a GitHub owner/repo slug (got "${options.repoSlug}")`);
  }

  const orgHome = resolve(options.orgHome);
  const allRoles = (await loadRoles(join(orgHome, "roles.yaml"))).roles.map((role) => role.name);
  const answers = buildAnswers({
    appName,
    goal,
    allRoles,
    supportChannels: options.supportChannels ?? [],
    marketingChannels: options.marketingChannels ?? [],
  });
  const scaffold = generatedFiles(appName, options.repoSlug, goal);
  const bootstrapFiles = appArtifactFiles(answers, allRoles);
  const operonSeedFiles = [
    ".operon/bootstrap/initial-issue.md",
    ".operon/bootstrap/next-commands.md",
    ".operon/planning/0001-greenfield-seed.md",
  ];
  const plannedCreated = [
    ...scaffold.map((file) => file.rel),
    ...bootstrapFiles,
    ...operonSeedFiles,
  ];
  const plannedUpdated = [".operon/config.yaml", `${orgHome}/apps.yaml`];

  if (options.dryRun) {
    return {
      appName,
      targetDir,
      repoSlug: options.repoSlug,
      dryRun: true,
      created: plannedCreated,
      updated: plannedUpdated,
      joinedOrgHome: orgHome,
    };
  }

  await assertTargetAvailable(targetDir);
  await mkdir(targetDir, { recursive: true });
  for (const file of scaffold) await writeGeneratedFile(targetDir, file);

  const bootstrap = await bootstrapRun(targetDir, answers, {
    appName,
    repoSlug: options.repoSlug,
    orgHome,
  });

  await appendGateCommands(targetDir);
  const operonSeeds = generatedOperonSeedFiles(appName, options.repoSlug, goal, targetDir);
  for (const file of operonSeeds) await writeGeneratedFile(targetDir, file);

  return {
    appName,
    targetDir,
    repoSlug: options.repoSlug,
    dryRun: false,
    created: [...scaffold.map((file) => file.rel), ...bootstrap.created, ...operonSeeds.map((file) => file.rel)],
    updated: plannedUpdated,
    ...(bootstrap.joinedOrgHome ? { joinedOrgHome: bootstrap.joinedOrgHome } : {}),
  };
}

function buildAnswers(options: {
  appName: string;
  goal: string;
  allRoles: string[];
  supportChannels: string[];
  marketingChannels: string[];
}): BootstrapAnswers {
  const roles: string[] = CORE_ROLES.filter((role) => options.allRoles.includes(role));
  for (const role of CORE_ROLES) {
    if (!options.allRoles.includes(role)) throw new Error(`new-app: template roles.yaml has no ${role} role`);
  }
  const channels: Record<string, string[]> = {};
  if (options.supportChannels.length > 0) {
    roles.push("support");
    channels["support"] = options.supportChannels;
  }
  if (options.marketingChannels.length > 0) {
    roles.push("marketing");
    channels["marketing"] = options.marketingChannels;
  }

  return parseAnswers(
    {
      product:
        `${options.appName} is a greenfield product scaffolded from this goal: ` +
        `${options.goal}. The initial app is intentionally small: a documented web product skeleton, ` +
        "a starter domain model, and an Operon-ready first ticket packet.",
      good:
        "Good means the first vertical slice is buildable from GitHub issues, has explicit acceptance criteria, " +
        "keeps product truth in docs, and keeps every code change covered by the configured build, test, and lint gates.",
      roles,
      criticalOps: {
        deployCommands: [],
        publishTargets: [],
        secretLocations: [".env", ".env.local"],
      },
      ...(Object.keys(channels).length > 0 ? { channels } : {}),
    },
    options.allRoles,
  );
}

async function assertTargetAvailable(targetDir: string): Promise<void> {
  if (!existsSync(targetDir)) return;
  const info = await stat(targetDir);
  if (!info.isDirectory()) throw new Error(`new-app: target ${targetDir} exists and is not a directory`);
  const entries = await readdir(targetDir);
  if (entries.length > 0) {
    throw new Error(`new-app: target ${targetDir} already exists and is not empty`);
  }
}

async function writeGeneratedFile(root: string, file: GeneratedFile): Promise<void> {
  const path = join(root, file.rel);
  if (existsSync(path)) throw new Error(`new-app: ${file.rel} already exists in ${root}`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, file.content, "utf8");
}

async function appendGateCommands(targetDir: string): Promise<void> {
  const configPath = join(targetDir, ".operon", "config.yaml");
  await appendFile(
    configPath,
    `
# Gate commands used by Operon's loop in fresh worktrees.
setup_command: npm install
test_command: npm test
lint_command: npm run lint
`,
    "utf8",
  );
}

function generatedFiles(appName: string, repoSlug: string, goal: string): GeneratedFile[] {
  const packageName = npmPackageName(appName);
  return [
    { rel: ".gitignore", content: gitignore() },
    { rel: "AGENTS.md", content: agentsMd(appName) },
    { rel: "README.md", content: readmeMd(appName, repoSlug, goal) },
    { rel: "package.json", content: packageJson(packageName) },
    { rel: "tsconfig.json", content: tsconfigJson() },
    { rel: "index.html", content: indexHtml(appName) },
    { rel: "styles.css", content: stylesCss() },
    { rel: "src/domain.ts", content: domainTs(goal) },
    { rel: "src/client.ts", content: clientTs() },
    { rel: "test/domain.test.ts", content: domainTestTs(goal) },
    { rel: "scripts/lint.mjs", content: lintMjs() },
    { rel: "scripts/server.mjs", content: serverMjs() },
    { rel: "docs/VISION.md", content: visionMd(appName, goal) },
    { rel: "docs/REQUIREMENTS.md", content: requirementsMd(appName, goal) },
    { rel: "docs/ARCHITECTURE.md", content: architectureMd(appName) },
    { rel: "docs/RUNBOOK.md", content: runbookMd(appName) },
    { rel: "docs/TESTING.md", content: testingMd() },
  ];
}

function generatedOperonSeedFiles(
  appName: string,
  repoSlug: string,
  goal: string,
  targetDir: string,
): GeneratedFile[] {
  return [
    { rel: ".operon/bootstrap/initial-issue.md", content: initialIssueMd(appName, goal) },
    { rel: ".operon/bootstrap/next-commands.md", content: nextCommandsMd(appName, repoSlug, targetDir) },
    { rel: ".operon/planning/0001-greenfield-seed.md", content: planningSeedMd(appName, goal) },
  ];
}

function sanitizeAppName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned.length > 0 ? cleaned : "app";
}

function npmPackageName(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "");
  return cleaned.length > 0 ? cleaned : "app";
}

function isRepoSlug(value: string): boolean {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value);
}

function json(value: string): string {
  return JSON.stringify(value);
}

function html(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function gitignore(): string {
  return `node_modules/
dist/
.env
.env.*
!.env.example
`;
}

function agentsMd(appName: string): string {
  return `# AGENTS.md

## Scope
Applies to the whole ${appName} app repo.

## Product Truth
- Product vision starts in docs/VISION.md.
- Buildable requirements start in docs/REQUIREMENTS.md.
- Operon app policy and memory live under .operon/.

## Commands
- Install: npm install
- Build: npm run build
- Test: npm test
- Lint: npm run lint

## Working Rules
- Keep TypeScript strict.
- Keep changes mapped to an issue acceptance criterion.
- Update docs when product behavior, commands, or architecture changes.
`;
}

function readmeMd(appName: string, repoSlug: string, goal: string): string {
  return `# ${appName}

${goal}

This repo was scaffolded by \`operon new-app\` as a greenfield product target.
It is intentionally small: product docs, a strict TypeScript web shell, tests,
and Operon bootstrap artifacts.

## Local Development

\`\`\`bash
npm install
npm test
npm run lint
npm start
\`\`\`

The local server builds the app and serves it at http://localhost:4173.

## Operon

- GitHub repo slug: \`${repoSlug}\`
- App charter: \`.operon/TASTE.md\`
- App registry entry: \`.operon/config.yaml\`
- Initial issue body: \`.operon/bootstrap/initial-issue.md\`
- Planner seed: \`.operon/planning/0001-greenfield-seed.md\`

After creating and pushing the private GitHub repo, create the initial issue
from \`.operon/bootstrap/initial-issue.md\` and label it \`op:ready\`.
`;
}

function packageJson(packageName: string): string {
  return `${JSON.stringify(
    {
      name: packageName,
      version: "0.1.0",
      private: true,
      type: "module",
      scripts: {
        build: "tsc",
        test: "npm run build && node --test dist/test/domain.test.js",
        lint: "node scripts/lint.mjs",
        start: "npm run build && node scripts/server.mjs",
      },
      devDependencies: {
        "@types/node": "^22.10.0",
        typescript: "^5.7.0",
      },
    },
    null,
    2,
  )}
`;
}

function tsconfigJson(): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        target: "ES2023",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        noUncheckedIndexedAccess: true,
        exactOptionalPropertyTypes: true,
        forceConsistentCasingInFileNames: true,
        skipLibCheck: true,
        outDir: "dist",
        rootDir: ".",
      },
      include: ["src/**/*.ts", "test/**/*.ts"],
    },
    null,
    2,
  )}
`;
}

function indexHtml(appName: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${html(appName)}</title>
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <main id="app"></main>
    <script type="module" src="./dist/src/client.js"></script>
  </body>
</html>
`;
}

function stylesCss(): string {
  return `:root {
  color: #17202a;
  background: #f6f7f9;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

body {
  margin: 0;
}

main {
  max-width: 980px;
  margin: 0 auto;
  padding: 48px 24px;
}

.surface {
  background: #ffffff;
  border: 1px solid #d8dde5;
  border-radius: 8px;
  padding: 28px;
  box-shadow: 0 8px 24px rgb(23 32 42 / 8%);
}

h1 {
  margin: 0 0 12px;
  font-size: 2rem;
  line-height: 1.15;
}

p {
  color: #485464;
  line-height: 1.6;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px;
  margin-top: 24px;
}

.item {
  border: 1px solid #d8dde5;
  border-radius: 8px;
  padding: 16px;
  background: #fbfcfd;
}

.item h2 {
  margin: 0 0 8px;
  font-size: 1rem;
}
`;
}

function domainTs(goal: string): string {
  return `export type ProductAreaStatus = "planned" | "building" | "done";

export interface ProductArea {
  id: string;
  title: string;
  description: string;
  status: ProductAreaStatus;
}

export const productGoal = ${json(goal)};

export const starterProductAreas: ProductArea[] = [
  {
    id: "prd",
    title: "Product definition",
    description: "Turn the bootstrap vision into a reviewed PRD and milestone plan.",
    status: "planned",
  },
  {
    id: "first-slice",
    title: "First usable slice",
    description: "Implement the smallest workflow that proves the product can be used end to end.",
    status: "planned",
  },
  {
    id: "operations",
    title: "Operations baseline",
    description: "Keep build, test, lint, docs, and runbook checks green from the first commit.",
    status: "planned",
  },
];

export function openWorkItems(areas: readonly ProductArea[] = starterProductAreas): ProductArea[] {
  return areas.filter((area) => area.status !== "done");
}

export function summarizeGoal(): string {
  return \`\${productGoal} (\${starterProductAreas.length} starter areas)\`;
}
`;
}

function clientTs(): string {
  return `import { productGoal, starterProductAreas, summarizeGoal } from "./domain.js";

const app = document.querySelector<HTMLElement>("#app");
if (!app) throw new Error("Missing #app root");

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const cards = starterProductAreas
  .map(
    (area) => \`
      <section class="item">
        <h2>\${escapeHtml(area.title)}</h2>
        <p>\${escapeHtml(area.description)}</p>
        <p>Status: \${escapeHtml(area.status)}</p>
      </section>
    \`,
  )
  .join("");

app.innerHTML = \`
  <section class="surface">
    <h1>Greenfield Product</h1>
    <p>\${escapeHtml(productGoal)}</p>
    <p>\${escapeHtml(summarizeGoal())}</p>
    <div class="grid">\${cards}</div>
  </section>
\`;
`;
}

function domainTestTs(goal: string): string {
  return `import assert from "node:assert/strict";
import test from "node:test";
import { openWorkItems, productGoal, starterProductAreas, summarizeGoal } from "../src/domain.js";

test("product goal is preserved", () => {
  assert.equal(productGoal, ${json(goal)});
});

test("starter areas are actionable", () => {
  assert.equal(starterProductAreas.length, 3);
  assert.equal(openWorkItems().length, 3);
});

test("summary mentions the starter area count", () => {
  assert.match(summarizeGoal(), /3 starter areas/);
});
`;
}

function lintMjs(): string {
  return `import { access, readFile } from "node:fs/promises";

const required = ["src/domain.ts", "src/client.ts", "docs/VISION.md", "docs/REQUIREMENTS.md"];
for (const path of required) await access(path);

for (const path of required) {
  const text = await readFile(path, "utf8");
  if (text.includes("\\r\\n")) throw new Error(\`\${path} uses CRLF line endings\`);
  if (text.trim().length === 0) throw new Error(\`\${path} is empty\`);
}

console.log("lint: scaffold checks passed");
`;
}

function serverMjs(): string {
  return `import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const port = Number(process.env.PORT ?? 4173);
const types = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
]);

createServer(async (req, res) => {
  const rawPath = req.url === "/" ? "/index.html" : (req.url ?? "/index.html").split("?")[0] ?? "/index.html";
  const safePath = normalize(rawPath).replace(/^\\.\\.(\\/|$)/, "");
  const filePath = join(root, safePath);
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("not a file");
    res.setHeader("content-type", types.get(extname(filePath)) ?? "application/octet-stream");
    createReadStream(filePath).pipe(res);
  } catch {
    res.statusCode = 404;
    res.end("not found");
  }
}).listen(port, () => {
  console.log(\`listening on http://localhost:\${port}\`);
});
`;
}

function visionMd(appName: string, goal: string): string {
  return `# Vision - ${appName}

## Goal

${goal}

## Audience

- Primary users who need the core workflow completed with low friction.
- Operators who need clear status, support inputs, and release notes.
- The Operon agent team that will convert this seed into reviewed tickets.

## First Outcome

The first milestone should prove one complete product workflow from empty state
to a visible result. Keep scope narrow enough for one Builder PR and make the
acceptance criteria observable through tests or a local manual check.
`;
}

function requirementsMd(appName: string, goal: string): string {
  return `# Requirements - ${appName}

This is a bootstrap PRD seed generated from the initial goal. The Planner should
refine it before deep product work.

## Problem

${goal}

## Initial Requirements

- Define the first persona and the workflow they complete.
- Implement a minimal web UI for the first workflow.
- Persist only the state needed to prove the workflow, or document why the
  first slice is intentionally static.
- Keep \`npm test\` and \`npm run lint\` green.
- Update docs when product behavior changes.

## Acceptance Contract For First Ticket

- AC1: The app renders the product goal and starter work areas.
- AC2: A domain test verifies the product goal and starter backlog.
- AC3: The README explains local setup and Operon next steps.
- AC4: Operon gate commands are configured in \`.operon/config.yaml\`.
`;
}

function architectureMd(appName: string): string {
  return `# Architecture - ${appName}

## Current Shape

- Static HTML entry point served locally by \`scripts/server.mjs\`.
- Strict TypeScript domain code in \`src/domain.ts\`.
- Browser rendering in \`src/client.ts\`.
- Node built-in tests in \`test/domain.test.ts\`.

## Evolution

The first Planner pass should decide whether the product needs a backend,
database, auth, queue, or third-party integrations. Add those only when a ticket
has explicit acceptance criteria and matching gates.
`;
}

function runbookMd(appName: string): string {
  return `# Runbook - ${appName}

## Local Start

\`\`\`bash
npm install
npm start
\`\`\`

## Quality Gates

\`\`\`bash
npm test
npm run lint
\`\`\`

## Operon Loop

After this repo is pushed and an \`op:ready\` issue exists, run from any
directory (Operon resolves the active org home):

\`\`\`bash
operon loop --app ${appName} --once
\`\`\`
`;
}

function testingMd(): string {
  return `# Testing

The scaffold uses Node's built-in test runner after compiling TypeScript.

\`\`\`bash
npm test
npm run lint
\`\`\`

Add focused tests with each feature ticket. Acceptance criteria in GitHub issues
should map to named tests or a documented manual check.
`;
}

function initialIssueMd(appName: string, goal: string): string {
  return `## Goal

Build the first usable product slice for ${appName}.

Seed goal:

> ${goal}

## Context

- Product seed: docs/VISION.md
- Bootstrap PRD: docs/REQUIREMENTS.md
- Architecture seed: docs/ARCHITECTURE.md
- Local runbook: docs/RUNBOOK.md

## Acceptance Criteria

- [ ] AC1: The app renders the product goal and starter work areas locally.
- [ ] AC2: The first product workflow is represented in the domain model or a reviewed follow-up ticket exists.
- [ ] AC3: \`npm test\` passes.
- [ ] AC4: \`npm run lint\` passes.
- [ ] AC5: Docs are updated for any behavior added beyond the scaffold.

## Suggested Implementation Notes

- Keep the first PR narrow.
- Prefer one end-to-end vertical slice over broad placeholders.
- If the Planner needs to split this, create child issues and leave this issue as the milestone tracker.
`;
}

function nextCommandsMd(appName: string, repoSlug: string, targetDir: string): string {
  return `# Next Commands

Run these from the generated app repo after reviewing the scaffold.

\`\`\`bash
git init
git add .
git commit -m "Bootstrap ${appName}"
gh repo create ${repoSlug} --private --source . --remote origin --push
gh issue create --repo ${repoSlug} --title "Build first usable product slice" --label op:ready --label p2 --body-file .operon/bootstrap/initial-issue.md
\`\`\`

Then run these from any directory:

\`\`\`bash
operon plan ${appName} --topic "Refine the greenfield PRD and decompose the first milestone" --workdir ${targetDir}
operon loop --app ${appName} --once
\`\`\`
`;
}

function planningSeedMd(appName: string, goal: string): string {
  return `# Greenfield Planning Seed - ${appName}

## Product Goal

${goal}

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
