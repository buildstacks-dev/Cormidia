// Greenfield app creation: create a separate product repo skeleton, then reuse
// the normal bootstrap path so `.cormidia/` artifacts and org registration stay
// identical to an existing-app onboarding.

import { existsSync } from "node:fs";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { CANONICAL_LABELS, type CanonicalLabelKind } from "../loop/plan-tickets.js";
import {
  appArtifactFiles,
  bootstrapRun,
  parseAnswers,
  validateEmittedArtifacts,
  type BootstrapAnswers,
} from "./bootstrap.js";
import { onboardingAnswersPath, onboardingSourcePath, storeOnboardingSource } from "./onboarding-answers.js";
import { loadRoles } from "./roles.js";
import { definedProps } from "../runtime/optional-properties.js";
import { classifyRepositoryIdentity, isRepositoryIdentity } from "../runtime/repo-identity.js";
import { NewAppBlockedError, type NewAppBlocker } from "./new-app-blocked.js";
import { inspectNewAppTarget, targetPlanDrift, type NewAppTargetKind } from "./new-app-preflight.js";
import { PACKAGE_ROOT } from "./home.js";
import { renderNextCommandsGuide } from "./new-app-guide.js";
import { renderProductDocScaffoldRecord } from "./product-doc-record.js";
import { renderProductDocScaffoldDocuments } from "./product-doc-scaffold.js";

export const NEW_APP_TEMPLATES = ["typescript-node", "bare"] as const;
export type NewAppTemplate = (typeof NEW_APP_TEMPLATES)[number];
/** Omitting `--template` is not a stack decision, so the default must not make
 * one (#383). `bare` is stack-neutral; `typescript-node` stays available as an
 * explicit accelerator and its output is unchanged. */
export const DEFAULT_NEW_APP_TEMPLATE: NewAppTemplate = "bare";

interface NewAppOptions {
  /** Cormidia app key. Defaults to the target directory basename. */
  appName?: string;
  /** Local directory to scaffold into. Classified by content, never by
   * emptiness — see `new-app-preflight.ts`. */
  targetDir: string;
  /** GitHub owner/repo slug the app will use once pushed. */
  repoSlug: string;
  /** Human-provided product idea or mandate. */
  goal: string;
  /** Explicit scaffold shape. Omission resolves to the stack-neutral `bare`
   * template — absence of a choice never selects an architecture. */
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
  /** Fault-injection seam, invoked between target validation and the first
   * write so the revalidation branch is exercised by a real concurrent write.
   * Production never sets it. */
  beforeFirstWrite?: () => Promise<void>;
}

interface NewAppResult {
  appName: string;
  targetDir: string;
  repoSlug: string;
  template: NewAppTemplate;
  dryRun: boolean;
  /** How the preflight classified the target directory before any write. */
  target: NewAppTargetKind;
  created: string[];
  updated: string[];
  /** Existing target entries this run leaves byte-identical. */
  preserved: string[];
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
  // Identity first: preview and execution reach this before any plan is built,
  // any artifact is written, and any outward command is generated (#385).
  const identity = classifyRepositoryIdentity(options.repoSlug);
  if (!isRepositoryIdentity(identity)) {
    throw new NewAppBlockedError({
      schema_version: 1,
      kind: "new-app-refusal",
      app: appName,
      target_dir: targetDir,
      repository: typeof options.repoSlug === "string" ? options.repoSlug : String(options.repoSlug),
      dry_run: options.dryRun === true,
      blockers: [
        {
          code: `repository-identity:${identity.code}`,
          subject: identity.value,
          detail: identity.detail,
          remediation:
            `${identity.remediation}. Re-run new-app with the concrete slug; nothing was ` +
            "registered, so there is no generated guide or apps.yaml entry to repair.",
        },
      ],
    });
  }

  const orgHome = resolve(options.orgHome);
  const allRoles = (await loadRoles(join(orgHome, "roles.yaml"))).roles.map((role) => role.name);
  const answers = buildAnswers({
    allRoles,
    supportChannels: options.supportChannels ?? [],
    marketingChannels: options.marketingChannels ?? [],
  });
  const scaffold = generatedFiles(template, appName, options.repoSlug, goal);
  const bootstrapFiles = appArtifactFiles(answers, allRoles);
  const cormidiaSeedFiles = [
    ".cormidia/LABELS.md",
    ".cormidia/bootstrap/next-commands.md",
    ".cormidia/bootstrap/product-docs.json",
    ".cormidia/planning/0001-greenfield-seed.md",
  ];
  const plannedCreated = [...scaffold.map((file) => file.rel), ...bootstrapFiles, "CLAUDE.md", ...cormidiaSeedFiles];
  const plannedUpdated = ["AGENTS.md", ".cormidia/config.yaml", `${orgHome}/apps.yaml`];
  const stateCreated =
    options.stateHome === undefined
      ? []
      : [onboardingAnswersPath(options.stateHome, appName), onboardingSourcePath(options.stateHome, appName)];
  const qualityGates = qualityGatePlan(template);

  // The SAME preflight for preview and execution, and it runs BEFORE the
  // dry-run return: the previous order built the plan, returned it, and only
  // then validated the target, so a dry run could report a creation plan that
  // execution immediately refused (#384).
  const preflight = await inspectNewAppTarget(targetDir, plannedCreated);
  const refusal = (blockers: readonly NewAppBlocker[]) =>
    new NewAppBlockedError({
      schema_version: 1,
      kind: "new-app-refusal",
      app: appName,
      target_dir: targetDir,
      repository: identity.slug,
      dry_run: options.dryRun === true,
      blockers,
    });
  if (preflight.blockers.length > 0) throw refusal(preflight.blockers);

  if (options.dryRun) {
    return {
      appName,
      targetDir,
      repoSlug: options.repoSlug,
      template,
      dryRun: true,
      target: preflight.kind,
      created: plannedCreated,
      updated: plannedUpdated,
      preserved: [...preflight.preserved],
      stateCreated,
      qualityGates,
      joinedOrgHome: orgHome,
    };
  }

  // Revalidate immediately before the first write. An intervening human write
  // fails closed instead of being overwritten.
  await options.beforeFirstWrite?.();
  const drift = targetPlanDrift(preflight, await inspectNewAppTarget(targetDir, plannedCreated));
  if (drift !== undefined) throw refusal([drift]);
  await mkdir(targetDir, { recursive: true });
  for (const file of scaffold) await writeGeneratedFile(targetDir, file);

  const bootstrap = await bootstrapRun(targetDir, answers, {
    appName,
    repoSlug: options.repoSlug,
    orgHome,
    ...definedProps({ stateHome: options.stateHome }),
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
  const cormidiaSeeds = generatedCormidiaSeedFiles({
    template,
    appName,
    repoSlug: options.repoSlug,
    goal,
    targetDir,
    orgHome,
    stateHome: options.stateHome ?? null,
    qualityGates,
    scaffold,
  });
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
    target: preflight.kind,
    created: [...scaffold.map((file) => file.rel), ...bootstrap.created, ...cormidiaSeeds.map((file) => file.rel)],
    updated: [...new Set([...plannedUpdated, ...bootstrap.updated])],
    preserved: [...preflight.preserved],
    stateCreated,
    qualityGates,
    ...(bootstrap.joinedOrgHome ? { joinedOrgHome: bootstrap.joinedOrgHome } : {}),
  };
}

function buildAnswers(options: {
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
  const content =
    template === "bare"
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
  await appendFile(configPath, content, "utf8");
}

function generatedFiles(template: NewAppTemplate, appName: string, repoSlug: string, goal: string): GeneratedFile[] {
  const productDocs = new Map(
    renderProductDocScaffoldDocuments(appName, goal, template).map((document) => [document.path, document.content]),
  );
  if (template === "bare") {
    return [
      { rel: ".gitignore", content: bareGitignore() },
      { rel: "AGENTS.md", content: bareAgentsMd(appName) },
      { rel: "README.md", content: bareReadmeMd(appName, repoSlug, goal) },
      { rel: "docs/VISION.md", content: productDocs.get("docs/VISION.md")! },
      { rel: "docs/REQUIREMENTS.md", content: productDocs.get("docs/REQUIREMENTS.md")! },
      { rel: "docs/ARCHITECTURE.md", content: productDocs.get("docs/ARCHITECTURE.md")! },
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
    { rel: "docs/VISION.md", content: productDocs.get("docs/VISION.md")! },
    { rel: "docs/REQUIREMENTS.md", content: productDocs.get("docs/REQUIREMENTS.md")! },
    { rel: "docs/ARCHITECTURE.md", content: productDocs.get("docs/ARCHITECTURE.md")! },
    { rel: "docs/RUNBOOK.md", content: runbookMd(appName) },
    { rel: "docs/TESTING.md", content: testingMd() },
  ];
}

function generatedCormidiaSeedFiles(input: {
  template: NewAppTemplate;
  appName: string;
  repoSlug: string;
  goal: string;
  targetDir: string;
  orgHome: string;
  stateHome: string | null;
  qualityGates: NewAppResult["qualityGates"];
  scaffold: GeneratedFile[];
}): GeneratedFile[] {
  const productDocs = input.scaffold.filter((file) =>
    ["docs/VISION.md", "docs/REQUIREMENTS.md", "docs/ARCHITECTURE.md"].includes(file.rel),
  );
  return [
    {
      rel: ".cormidia/LABELS.md",
      content: labelsMd(),
    },
    {
      rel: ".cormidia/bootstrap/next-commands.md",
      content: renderNextCommandsGuide({
        appName: input.appName,
        repoSlug: input.repoSlug,
        targetDir: input.targetDir,
        goal: input.goal,
        template: input.template,
        packageRoot: PACKAGE_ROOT,
        orgHome: input.orgHome,
        stateHome: input.stateHome,
        setupCommand: input.qualityGates.setupCommand,
        testCommand: input.qualityGates.testCommand,
        lintCommand: input.qualityGates.lintCommand,
      }),
    },
    {
      rel: ".cormidia/bootstrap/product-docs.json",
      content: renderProductDocScaffoldRecord({
        app: input.appName,
        repository: input.repoSlug,
        template: input.template,
        documents: productDocs.map((file) => ({ path: file.rel, content: file.content })),
      }),
    },
    {
      rel: ".cormidia/planning/0001-greenfield-seed.md",
      content:
        input.template === "bare"
          ? barePlanningSeedMd(input.appName, input.goal)
          : planningSeedMd(input.appName, input.goal),
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

function json(value: string): string {
  return JSON.stringify(value);
}

function html(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
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
- Product-doc disposition: \`.cormidia/bootstrap/product-docs.json\`
- Lifecycle guide: \`.cormidia/bootstrap/next-commands.md\`
- Planner seed: \`.cormidia/planning/0001-greenfield-seed.md\`

Follow the checkpointed lifecycle guide. Record exactly one product-document
disposition before governed planning publishes implementation work. For this
bare template, the first implementation dependency must establish the stack
and meaningful quality gates.
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
- Product-doc disposition: \`.cormidia/bootstrap/product-docs.json\`
- Lifecycle guide: \`.cormidia/bootstrap/next-commands.md\`
- Planner seed: \`.cormidia/planning/0001-greenfield-seed.md\`

Follow the checkpointed lifecycle guide. Record exactly one product-document
disposition before governed planning publishes implementation work.
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

function labelsMd(): string {
  const headings: Record<CanonicalLabelKind, string> = {
    state: "Workflow State",
    tier: "Derived Tier",
    priority: "Priority",
    domain: "Sensitive Domain",
    routing: "Autonomous Routing",
  };
  const sections = (["state", "tier", "priority", "domain", "routing"] as const).map((kind) => {
    const rows = CANONICAL_LABELS.filter((label) => label.kind === kind)
      .map(
        (label) =>
          `| \`${label.name}\` | \`#${label.color}\` | ${markdownCell(label.description)} | ` +
          `${markdownCell(label.appliedBy)} | ${markdownCell(label.operatorResponse)} |`,
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

Honor the content-bound keep/reconcile/remove decision in
.cormidia/bootstrap/product-docs.json. Use kept documents as reviewed truth,
route reconcile through its governed documentation dependency, and never recreate
removed documents. Produce a buildable first milestone from the selected authoritative
sources, with concrete GitHub issues, binary acceptance criteria, and named tests.

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

Honor the content-bound keep/reconcile/remove decision in
\`.cormidia/bootstrap/product-docs.json\`. Use kept documents as reviewed truth,
route reconcile through its governed documentation dependency, and never recreate
removed documents. The first dependency must explicitly select and document the stack,
add real source and local workflows, and establish meaningful stack-specific test and
lint gates in \`.cormidia/config.yaml\`.

## Decomposition Guidance

- Start with a product-definition ticket only if the current PRD is too vague.
- Keep stack selection, the first observable slice, and non-vacuous gate setup
  together or encode explicit dependencies that prevent implementation from
  being certified before its gates exist.
- Add infrastructure tickets only when the first slice needs them.
- Keep Support and Marketing work tied to declared channels and real artifacts.
`;
}
