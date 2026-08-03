// Greenfield app creation: create a separate product repo skeleton, then reuse
// the normal bootstrap path so `.cormidia/` artifacts and org registration stay
// identical to an existing-app onboarding.

import { existsSync } from "node:fs";
import { appendFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
  CANONICAL_LABELS,
  type CanonicalLabelKind,
} from "../loop/plan-tickets.js";
import {
  appArtifactFiles,
  bootstrapRun,
  parseAnswers,
  validateEmittedArtifacts,
  type BootstrapAnswers,
} from "./bootstrap.js";
import {
  onboardingAnswersPath,
  onboardingSourcePath,
  storeOnboardingSource,
} from "./onboarding-answers.js";
import { loadRoles } from "./roles.js";

export const NEW_APP_TEMPLATES = ["typescript-node", "bare"] as const;
export type NewAppTemplate = (typeof NEW_APP_TEMPLATES)[number];
export const DEFAULT_NEW_APP_TEMPLATE: NewAppTemplate = "typescript-node";

export interface NewAppOptions {
  /** Cormidia app key. Defaults to the target directory basename. */
  appName?: string;
  /** Local directory to create. Must be absent or empty. */
  targetDir: string;
  /** GitHub owner/repo slug the app will use once pushed. */
  repoSlug: string;
  /** Human-provided product idea or mandate. */
  goal: string;
  /** Explicit scaffold shape. The existing TypeScript/Node scaffold remains the default. */
  template?: NewAppTemplate;
  /** Existing org home to join. */
  orgHome: string;
  /** Resolved runtime state used to preserve normalized recovery answers. */
  stateHome?: string;
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
  template: NewAppTemplate;
  dryRun: boolean;
  created: string[];
  updated: string[];
  stateCreated: string[];
  qualityGates: {
    status: "configured" | "pending";
    setupCommand: string | null;
    testCommand: string | null;
    lintCommand: string | null;
    detail: string;
  };
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
  const template = options.template ?? DEFAULT_NEW_APP_TEMPLATE;
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
    template,
    allRoles,
    supportChannels: options.supportChannels ?? [],
    marketingChannels: options.marketingChannels ?? [],
  });
  const scaffold = generatedFiles(template, appName, options.repoSlug, goal);
  const bootstrapFiles = appArtifactFiles(answers, allRoles);
  const cormidiaSeedFiles = [
    ".cormidia/LABELS.md",
    ".cormidia/bootstrap/initial-issue.md",
    ".cormidia/bootstrap/next-commands.md",
    ".cormidia/planning/0001-greenfield-seed.md",
  ];
  const plannedCreated = [
    ...scaffold.map((file) => file.rel),
    ...bootstrapFiles,
    "CLAUDE.md",
    ...cormidiaSeedFiles,
  ];
  const plannedUpdated = ["AGENTS.md", ".cormidia/config.yaml", `${orgHome}/apps.yaml`];
  const stateCreated = options.stateHome === undefined
    ? []
    : [
        onboardingAnswersPath(options.stateHome, appName),
        onboardingSourcePath(options.stateHome, appName),
      ];
  const qualityGates = qualityGatePlan(template);

  if (options.dryRun) {
    return {
      appName,
      targetDir,
      repoSlug: options.repoSlug,
      template,
      dryRun: true,
      created: plannedCreated,
      updated: plannedUpdated,
      stateCreated,
      qualityGates,
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
    ...(options.stateHome !== undefined ? { stateHome: options.stateHome } : {}),
  });

  // Record where this greenfield app was scaffolded so `cormidia app verify` can
  // synthesize a lifecycle record from the pushed remote (L0-01). new-app runs
  // before `git init`/push, so it cannot write the record itself.
  if (options.stateHome !== undefined) {
    await storeOnboardingSource(options.stateHome, appName, {
      repo: options.repoSlug,
      checkoutPath: targetDir,
    });
  }

  await appendGateCommands(targetDir, template);
  const cormidiaSeeds = generatedCormidiaSeedFiles(
    template,
    appName,
    options.repoSlug,
    goal,
    targetDir,
  );
  for (const file of cormidiaSeeds) await writeGeneratedFile(targetDir, file);
  await validateEmittedArtifacts(
    targetDir,
    appName,
    options.repoSlug,
    [...scaffold.map((file) => file.rel), ...bootstrap.created, ...cormidiaSeeds.map((file) => file.rel)],
    bootstrap.updated,
  );

  return {
    appName,
    targetDir,
    repoSlug: options.repoSlug,
    template,
    dryRun: false,
    created: [...scaffold.map((file) => file.rel), ...bootstrap.created, ...cormidiaSeeds.map((file) => file.rel)],
    updated: [...new Set([...plannedUpdated, ...bootstrap.updated])],
    stateCreated,
    qualityGates,
    ...(bootstrap.joinedOrgHome ? { joinedOrgHome: bootstrap.joinedOrgHome } : {}),
  };
}

function buildAnswers(options: {
  appName: string;
  goal: string;
  template: NewAppTemplate;
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

  const product = options.template === "bare"
    ? `${options.appName} is a greenfield product scaffolded from this goal: ${options.goal}. ` +
      "The repository is intentionally stack-neutral: it begins with product truth and Cormidia bootstrap artifacts only. " +
      "The first implementation work must select the stack and establish meaningful stack-specific build, test, and lint gates."
    : `${options.appName} is a greenfield product scaffolded from this goal: ` +
      `${options.goal}. The initial app is intentionally small: a documented web product skeleton, ` +
      "a starter domain model, and a Cormidia-ready first ticket packet.";
  const good = options.template === "bare"
    ? "Good means the first implementation explicitly records its stack, delivers one observable product slice, " +
      "and configures non-vacuous test and lint commands before Cormidia accepts the work. Missing gate commands remain a failure, not a green check."
    : "Good means the first vertical slice is buildable from GitHub issues, has explicit acceptance criteria, " +
      "keeps product truth in docs, and keeps every code change covered by the configured build, test, and lint gates.";

  return parseAnswers(
    {
      product,
      good,
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

function qualityGatePlan(template: NewAppTemplate): NewAppResult["qualityGates"] {
  if (template === "bare") {
    return {
      status: "pending",
      setupCommand: null,
      testCommand: null,
      lintCommand: null,
      detail:
        "Required test and lint commands are intentionally absent. Run only the generated stack-and-gates establishment issue through the loop first; app verification and promotion remain blocked until that change merges with meaningful stack-specific gates.",
    };
  }
  return {
    status: "configured",
    setupCommand: "npm install",
    testCommand: "npm test",
    lintCommand: "npm run lint",
    detail: "The TypeScript/Node scaffold includes executable setup, test, and lint commands.",
  };
}

async function appendGateCommands(targetDir: string, template: NewAppTemplate): Promise<void> {
  const configPath = join(targetDir, ".cormidia", "config.yaml");
  const content = template === "bare"
    ? `
# Quality gates for the bare template are intentionally pending.
# Required test and lint gates fail closed while these keys are absent. The
# first implementation must replace these examples with meaningful commands
# for its explicitly selected stack; do not use no-op or zero-test commands.
# These are TOP-LEVEL keys (siblings of \`apps\`), never \`apps.<name>\` fields.
# setup_command: <optional stack-specific setup command>
# test_command: <meaningful stack-specific test command>
# lint_command: <meaningful stack-specific lint or static-analysis command>
`
    : `
# Gate commands used by Cormidia's loop in fresh worktrees. These are TOP-LEVEL
# keys (siblings of \`apps\`), never \`apps.<name>\` fields.
setup_command: npm install
test_command: npm test
lint_command: npm run lint
`;
  await appendFile(
    configPath,
    content,
    "utf8",
  );
}

function generatedFiles(
  template: NewAppTemplate,
  appName: string,
  repoSlug: string,
  goal: string,
): GeneratedFile[] {
  if (template === "bare") {
    return [
      { rel: ".gitignore", content: bareGitignore() },
      { rel: "AGENTS.md", content: bareAgentsMd(appName) },
      { rel: "README.md", content: bareReadmeMd(appName, repoSlug, goal) },
      { rel: "docs/VISION.md", content: visionMd(appName, goal) },
      { rel: "docs/REQUIREMENTS.md", content: bareRequirementsMd(appName, goal) },
      { rel: "docs/ARCHITECTURE.md", content: bareArchitectureMd(appName) },
      { rel: "docs/RUNBOOK.md", content: bareRunbookMd(appName) },
      { rel: "docs/TESTING.md", content: bareTestingMd() },
    ];
  }

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

function generatedCormidiaSeedFiles(
  template: NewAppTemplate,
  appName: string,
  repoSlug: string,
  goal: string,
  targetDir: string,
): GeneratedFile[] {
  return [
    {
      rel: ".cormidia/LABELS.md",
      content: labelsMd(),
    },
    {
      rel: ".cormidia/bootstrap/initial-issue.md",
      content: template === "bare" ? bareInitialIssueMd(appName, goal) : initialIssueMd(appName, goal),
    },
    {
      rel: ".cormidia/bootstrap/next-commands.md",
      content: template === "bare"
        ? bareNextCommandsMd(appName, repoSlug, goal, targetDir)
        : nextCommandsMd(appName, repoSlug, goal, targetDir),
    },
    {
      rel: ".cormidia/planning/0001-greenfield-seed.md",
      content: template === "bare" ? barePlanningSeedMd(appName, goal) : planningSeedMd(appName, goal),
    },
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

function bareGitignore(): string {
  return `.env
.env.*
!.env.example
`;
}

function bareAgentsMd(appName: string): string {
  return `# AGENTS.md

## Scope
Applies to the whole ${appName} app repo.

## Product Truth
- Product vision starts in docs/VISION.md.
- Buildable requirements start in docs/REQUIREMENTS.md.
- Cormidia app policy and memory live under .cormidia/.

## Commands
- Status: pending; the bare template intentionally selects no stack.
- The first implementation must record exact install/build/test/lint commands here.
- It must also configure meaningful test and lint commands in .cormidia/config.yaml.

## Working Rules
- Select the implementation stack explicitly from product requirements and record it in docs/ARCHITECTURE.md.
- Do not use placeholder, no-op, or zero-test commands to make a quality gate pass.
- Keep changes mapped to an issue acceptance criterion.
- Update docs when product behavior, commands, or architecture changes.
`;
}

function bareReadmeMd(appName: string, repoSlug: string, goal: string): string {
  return `# ${appName}

${goal}

This repo was scaffolded by \`cormidia new-app --template bare\` as a stack-neutral
greenfield product target. It contains product truth and Cormidia bootstrap
artifacts, but deliberately chooses no framework, runtime, package manager, or
application skeleton.

## Implementation Baseline — Pending

The first implementation work must:

- select and document the stack in \`docs/ARCHITECTURE.md\`;
- add the stack's real source, manifest, and local commands;
- add meaningful automated tests and lint or static analysis; and
- set top-level \`test_command\` and \`lint_command\` (plus top-level
  \`setup_command\` when needed) in \`.cormidia/config.yaml\`; these keys are
  siblings of \`apps\`, never fields under \`apps.<name>\`.

Those required gate commands are intentionally absent. Cormidia treats them as
unconfigured failures, so this empty scaffold cannot certify itself with
vacuous green checks.

## Cormidia

- GitHub repo slug: \`${repoSlug}\`
- App charter: \`.cormidia/TASTE.md\`
- App registry entry: \`.cormidia/config.yaml\`
- GitHub label contract: \`.cormidia/LABELS.md\`
- Initial issue body: \`.cormidia/bootstrap/initial-issue.md\`
- Planner seed: \`.cormidia/planning/0001-greenfield-seed.md\`

After creating and pushing the private GitHub repo, create the initial issue
from \`.cormidia/bootstrap/initial-issue.md\` and label it \`op:ready\`.
Keep it as the only ready product-work issue and run it through the loop first.
Do not run app verification or promotion until it merges with meaningful gate
commands; both correctly remain blocked while this scaffold is pending.
`;
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
- Cormidia app policy and memory live under .cormidia/.

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

This repo was scaffolded by \`cormidia new-app\` as a greenfield product target.
It is intentionally small: product docs, a strict TypeScript web shell, tests,
and Cormidia bootstrap artifacts.

## Local Development

\`\`\`bash
npm install
npm test
npm run lint
npm start
\`\`\`

The local server builds the app and serves it at http://localhost:4173.

## Cormidia

- GitHub repo slug: \`${repoSlug}\`
- App charter: \`.cormidia/TASTE.md\`
- App registry entry: \`.cormidia/config.yaml\`
- GitHub label contract: \`.cormidia/LABELS.md\`
- Initial issue body: \`.cormidia/bootstrap/initial-issue.md\`
- Planner seed: \`.cormidia/planning/0001-greenfield-seed.md\`

After creating and pushing the private GitHub repo, create the initial issue
from \`.cormidia/bootstrap/initial-issue.md\` and label it \`op:ready\`.
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
- The Cormidia agent team that will convert this seed into reviewed tickets.

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
- AC3: The README explains local setup and Cormidia next steps.
- AC4: Cormidia gate commands are configured in \`.cormidia/config.yaml\`.
`;
}

function bareRequirementsMd(appName: string, goal: string): string {
  return `# Requirements - ${appName}

This is a stack-neutral bootstrap PRD seed generated from the initial goal. The
Planner should refine it before deep product work; \`cormidia new-app\` has not
inferred an implementation stack from the goal.

## Problem

${goal}

## Initial Requirements

- Define the first persona and the workflow they complete.
- Select an implementation stack explicitly and record the decision in
  \`docs/ARCHITECTURE.md\`.
- Implement the smallest observable end-to-end product slice appropriate to
  that stack.
- Add meaningful automated tests and lint or static analysis for the selected
  stack.
- Configure the resulting commands in \`.cormidia/config.yaml\`; a no-op or a
  command that succeeds while running zero tests is not acceptable.
- Update the runbook and this requirements document with the real commands and
  behavior.

## Acceptance Contract For First Implementation

- AC1: The selected stack and its rationale are documented.
- AC2: The repository contains the stack's real manifest, source, and local
  workflow rather than placeholder application files.
- AC3: \`test_command\` runs named behavior tests and fails when that behavior is
  broken.
- AC4: \`lint_command\` performs meaningful lint or static analysis.
- AC5: The first product workflow has an observable result and updated docs.
`;
}

function bareArchitectureMd(appName: string): string {
  return `# Architecture - ${appName}

## Current Shape

No application stack is selected. The bare template contains product truth and
Cormidia bootstrap artifacts only; it emits no runtime, package-manager,
framework, source, test, or server skeleton.

## First Implementation Decision

Choose a stack from the product requirements and any reviewed design sources,
then record the runtime, package/build tooling, source layout, test strategy,
and local execution path here. The scaffold does not infer that choice from
free-form goal text.

## Quality-Gate Boundary

\`.cormidia/config.yaml\` intentionally has no \`test_command\` or \`lint_command\`.
Cormidia's required gates therefore fail closed until the first implementation
adds meaningful stack-specific commands. Gate commands are top-level keys,
siblings of \`apps\`; never put them under \`apps.<name>\`. Add
\`setup_command\` only when a fresh worktree needs a deterministic setup step.

## Dependency Build Scripts

Cormidia runs every install with dependency build (postinstall) scripts **denied**
by default — a package that silently runs an install script is the more
dangerous default, and pnpm answers an unanswerable build question by writing a
placeholder into \`pnpm-workspace.yaml\` rather than by asking. If a dependency
genuinely needs its install script (a native binary download, for example), opt
in **explicitly and narrowly** in \`setup_command\`: commit the decision as an
\`allowBuilds\` entry and add \`--no-ignore-scripts\` to the install, for example
\`pnpm install --frozen-lockfile --no-ignore-scripts\`. Never answer a
\`set this to true or false\` placeholder by appending a second \`allowBuilds:\`
block — YAML forbids duplicate mapping keys, and the result is a file the
package manager can no longer parse, including on the run that would fix it.
`;
}

function bareRunbookMd(appName: string): string {
  return `# Runbook - ${appName}

## Local Start — Pending

The bare template selects no runtime or package manager. Replace this section
with the exact setup and start commands when the first implementation selects
the stack.

## Quality Gates — Pending

The first implementation must add real commands as top-level keys in
\`.cormidia/config.yaml\` (siblings of \`apps\`, never under \`apps.<name>\`):

\`\`\`yaml
setup_command: <optional stack-specific setup command>
test_command: <meaningful stack-specific test command>
lint_command: <meaningful stack-specific lint or static-analysis command>
\`\`\`

Do not copy the placeholders literally and do not use commands that pass
without exercising the implemented product. Until the required commands are
configured, Cormidia reports the test and lint gates as unconfigured failures.

## Cormidia Loop

After this repo is pushed and an \`op:ready\` issue exists, run from any
directory (Cormidia resolves the active org home):

\`\`\`bash
cormidia loop --app ${appName} --once
\`\`\`
`;
}

function bareTestingMd(): string {
  return `# Testing

No test framework is selected by the bare template. Missing test and lint
commands fail closed in Cormidia; this scaffold does not claim that an empty or
zero-test project is healthy.

The first implementation must:

- choose the stack's test and lint/static-analysis tools;
- add at least one named behavior test for the first product slice;
- prove that the test command fails when that behavior is broken;
- configure top-level \`test_command\` and \`lint_command\` in
  \`.cormidia/config.yaml\` as siblings of \`apps\`, never under
  \`apps.<name>\`; and
- replace this file with the exact local and CI workflow.

Acceptance criteria in GitHub issues should map to named tests or a documented
manual check where automation is genuinely inapplicable.
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

## Cormidia Loop

After this repo is pushed and an \`op:ready\` issue exists, run from any
directory (Cormidia resolves the active org home):

\`\`\`bash
cormidia loop --app ${appName} --once
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

function bareInitialIssueMd(appName: string, goal: string): string {
  return `## Goal

Establish the implementation stack, meaningful quality gates, and first usable
product slice for ${appName}.

Seed goal:

> ${goal}

## Context

- Product seed: docs/VISION.md
- Stack-neutral PRD: docs/REQUIREMENTS.md
- Pending architecture decision: docs/ARCHITECTURE.md
- Pending local workflow: docs/RUNBOOK.md
- Gate contract: docs/TESTING.md and .cormidia/config.yaml

The \`bare\` template was selected explicitly. It emitted no application/runtime
skeleton and did not infer a stack from the goal. Required test and lint gates
remain unconfigured and fail closed until this work establishes them.

## Acceptance Criteria

- [ ] AC1: The selected stack and rationale are recorded in docs/ARCHITECTURE.md.
- [ ] AC2: The stack's real manifest, source layout, and local workflow replace the pending guidance.
- [ ] AC3: .cormidia/config.yaml declares a meaningful stack-specific top-level \`test_command\` (a sibling of \`apps\`, never under \`apps.<name>\`) that runs at least one named behavior test and fails when the behavior breaks.
- [ ] AC4: .cormidia/config.yaml declares a meaningful stack-specific top-level \`lint_command\` (and top-level \`setup_command\` when fresh worktrees need it).
- [ ] AC5: The first product workflow has an observable result and docs explain how to run it.

## Suggested Implementation Notes

- Choose the stack from product requirements and reviewed sources, not from a scaffold assumption.
- Keep the first PR narrow enough to prove one end-to-end slice.
- Do not use placeholder, no-op, or zero-test commands to satisfy the gates.
- Parse YAML when testing this contract; do not assert indentation with a text regex.
- If the Planner needs to split this, keep stack selection and meaningful gates in the first implementation dependency.
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

function bareNextCommandsMd(
  appName: string,
  repoSlug: string,
  goal: string,
  targetDir: string,
): string {
  return `# Next Commands

The bare template's generated initial issue is the stack-and-gates
establishment path. Keep it as the only ready product-work issue until it
merges: the loop reloads gate commands from the Builder worktree before gates,
so that issue can introduce the first real commands without certifying the
empty scaffold.

Do not run \`cormidia app verify\` or \`cormidia app promote\` before that issue
merges. Verification intentionally fails while test/lint commands are absent,
and promotion requires a passing verification. Do not substitute placeholder,
no-op, or zero-test commands.

## Create The Repository And First Issue

Run these from the generated app repo after reviewing the scaffold. Label setup
is idempotent: \`--force\` creates missing labels and converges existing label
color and description. The full vocabulary is documented in
\`.cormidia/LABELS.md\`.

\`\`\`bash
${repositoryBootstrapCommands(appName, repoSlug)}
\`\`\`

## Run The Stack-And-Gates Issue

This first Builder invocation must select a stack and establish a real
dependency manifest in a fresh worktree, so it explicitly permits outbound
network access. The grant applies only to this invocation; omit it later unless
the accepted work itself requires egress.

\`\`\`bash
cormidia loop --app ${shellQuote(appName)} --once --allow-network
\`\`\`

## After The Stack-And-Gates Issue Merges

Verify the merged stack-specific checks before planning more product work:

\`\`\`bash
cormidia app verify ${shellQuote(appName)}
\`\`\`

The first planning command is a token-free preview. Review it before running
the second, live planning command. The required product-truth sources are
resolved relative to the exact \`--workdir\` checkout, so these commands work
from any current directory.

\`\`\`bash
${planningCommands(appName, goal, targetDir)}
\`\`\`
`;
}

function nextCommandsMd(
  appName: string,
  repoSlug: string,
  goal: string,
  targetDir: string,
): string {
  return `# Next Commands

## Create The Repository And First Issue

Run these from the generated app repo after reviewing the scaffold. Label setup
is idempotent: \`--force\` creates missing labels and converges existing label
color and description. The full vocabulary is documented in
\`.cormidia/LABELS.md\`.

\`\`\`bash
${repositoryBootstrapCommands(appName, repoSlug)}
\`\`\`

## Plan The First Milestone

The first planning command is a token-free preview. Review it before running
the second, live planning command. The required product-truth sources are
resolved relative to the exact \`--workdir\` checkout, so these commands work
from any current directory.

\`\`\`bash
${planningCommands(appName, goal, targetDir)}
\`\`\`
`;
}

function repositoryBootstrapCommands(appName: string, repoSlug: string): string {
  const labelCommands = CANONICAL_LABELS.map((label) =>
    [
      "gh label create",
      shellQuote(label.name),
      "--color",
      shellQuote(label.color),
      "--description",
      shellQuote(label.description),
      "--force",
      "--repo",
      shellQuote(repoSlug),
    ].join(" ")
  );
  return [
    "git init",
    "git add .",
    `git commit -m ${shellQuote(`Bootstrap ${appName}`)}`,
    `gh repo create ${shellQuote(repoSlug)} --private --source . --remote origin --push`,
    ...labelCommands,
    [
      "gh issue create",
      "--repo",
      shellQuote(repoSlug),
      "--title",
      shellQuote("Build first usable product slice"),
      "--label",
      shellQuote("op:ready"),
      "--label",
      shellQuote("p2"),
      "--body-file",
      shellQuote(".cormidia/bootstrap/initial-issue.md"),
    ].join(" "),
  ].join("\n");
}

function planningCommands(appName: string, goal: string, targetDir: string): string {
  const plan = [
    "cormidia plan",
    shellQuote(appName),
    "--auto",
    "--goal",
    shellQuote(goal),
    "--source",
    shellQuote("docs/VISION.md"),
    "--source",
    shellQuote("docs/REQUIREMENTS.md"),
    "--workdir",
    shellQuote(targetDir),
  ].join(" ");
  return [
    `${plan} --dry-run`,
    "# If you copied and reviewed another design source into this repo, add --source '<path>' to both plan commands.",
    plan,
    `cormidia loop --app ${shellQuote(appName)} --once`,
  ].join("\n");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function labelsMd(): string {
  const headings: Record<CanonicalLabelKind, string> = {
    state: "Workflow State",
    tier: "Derived Tier",
    priority: "Priority",
    domain: "Sensitive Domain",
    routing: "Autonomous Routing",
  };
  const sections = (["state", "tier", "priority", "domain", "routing"] as const).map((kind) => {
    const rows = CANONICAL_LABELS
      .filter((label) => label.kind === kind)
      .map((label) =>
        `| \`${label.name}\` | \`#${label.color}\` | ${markdownCell(label.description)} | ` +
          `${markdownCell(label.appliedBy)} | ${markdownCell(label.operatorResponse)} |`
      )
      .join("\n");
    return `## ${headings[kind]}

| Label | Color | Meaning | Applied by | Operator response |
| --- | --- | --- | --- | --- |
${rows}`;
  });
  return `# Cormidia GitHub Labels

This file is generated from Cormidia's canonical label contract. The idempotent
\`gh label create --force\` commands in
\`.cormidia/bootstrap/next-commands.md\` install exactly these definitions before
the first issue is created.

An open Cormidia issue should carry at most one workflow-state label. Tier labels
are durable reporting and safety metadata; the accepted EpisodePlan remains
the live workflow authority. Do not invent additional \`op:*\` states or remove
risk labels to bypass a plan or gate.

${sections.join("\n\n")}
`;
}

function markdownCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
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

function barePlanningSeedMd(appName: string, goal: string): string {
  return `# Greenfield Planning Seed - ${appName}

## Product Goal

${goal}

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
