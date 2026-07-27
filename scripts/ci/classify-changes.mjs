/**
 * Change-aware CI lane admission.
 *
 * Maps a set of changed repository paths (plus the triggering event) onto the
 * small set of CI lanes defined in `.github/workflows/efficiency-qualification.yml`.
 * Pure and dependency-free so it can be unit-tested without a runner
 * (`test/ci/classify-changes.test.ts`).
 *
 * SAFETY POSTURE — this file selects which tests run, so it is deliberately
 * *fail-open into more testing*, never less:
 *
 *  - Any event that is not a `pull_request` or a branch `push` (schedule, tag,
 *    manual dispatch) admits every lane. Path admission is a pull-request /
 *    push optimisation only.
 *  - An empty or unavailable diff (first push, force-push, unresolvable base)
 *    admits every lane rather than skipping.
 *  - A path that matches no rule is treated as CONSERVATIVE (admit everything),
 *    not as ignorable. Only paths that are provably incapable of changing
 *    graded behaviour — documentation, reviewer notes, editor/CI metadata that
 *    runs no tests — are allowed to admit nothing.
 *
 * The "documentation cannot alter graded behaviour" rule is the ratified
 * qualification-scope decision (docs/PURPOSE.md 2026-07-17) and AGENTS.md's
 * "Docs-only changes: nothing to run".
 *
 * Because this file governs test selection it is part of the executable suite
 * (`isExecutableSuitePath` in scripts/eval/candidate-hash.ts) for exactly the
 * reason `vitest.config.ts` is: a change here could otherwise silently stop the
 * red contract tests from running while CI still reported green.
 */

/** Packaged documentation: ships in the npm package, so it is product, not docs. */
const PACKAGED_DOCS = new Set(["docs/policy.yaml.template", "docs/scheduler/design.md", "README.md"]);

/** Paths that cannot alter graded behaviour and admit no lane. */
function isDocsOnlyPath(path) {
  if (PACKAGED_DOCS.has(path)) return false;
  return path.startsWith("docs/") ||
    path.startsWith("review/") ||
    // research/evals/** is promotion evidence, governed by the promotion
    // allowlist — it is never docs.
    (path.startsWith("research/") && !path.startsWith("research/evals/")) ||
    path.startsWith(".github/ISSUE_TEMPLATE/") ||
    path === ".github/PULL_REQUEST_TEMPLATE.md" ||
    path === ".gitignore" ||
    path === ".editorconfig" ||
    path === "CLAUDE.md" ||
    path === "AGENTS.md" ||
    (path.endsWith(".md") && !path.includes("/"));
}

/**
 * Paths that change how tests are selected, graded, built, or installed. These
 * admit every lane: a mistake here is exactly the failure mode that makes a
 * green run meaningless, so it is never optimised away.
 */
function isConservativePath(path) {
  return path === "package.json" ||
    path === "pnpm-lock.yaml" ||
    path === "pnpm-workspace.yaml" ||
    path.startsWith("tsconfig") ||
    path.startsWith("vitest.") ||
    path.startsWith("playwright.") ||
    path.startsWith(".github/workflows/") ||
    path.startsWith("scripts/ci/") ||
    path === "eval/contracts.yaml";
}

/**
 * Observer / Reports surfaces and the packaging + onboarding contract.
 * AGENTS.md requires the browser, smoke, build and pack checks for
 * `src/observe/**`, `src/report/**`, their CLI surfaces, and separately for
 * "packaging, home resolution, CLI discovery, or onboarding changes".
 */
function isObservePath(path) {
  return path.startsWith("src/observe/") ||
    path.startsWith("src/report/") ||
    path === "src/cli/observe.ts" ||
    path === "src/cli/report.ts" ||
    path.startsWith("test/observe/") ||
    path.startsWith("test/report/") ||
    path.startsWith("playwright.") ||
    // Packaging / home resolution / CLI discovery / onboarding.
    path === "src/org/home.ts" ||
    path === "src/cli.ts" ||
    path.startsWith("agent-skills/") ||
    path === "src/operon.cjs" ||
    path === "src/operon-local.cjs" ||
    path === "scripts/smoke-onboarding.mjs" ||
    path === "scripts/link-local.mjs" ||
    path === "scripts/operon-local.mjs" ||
    path.startsWith("config/launchd/") ||
    PACKAGED_DOCS.has(path);
}

/** Sources compiled into the shipped `dist` output — these require `pnpm build`. */
function isBuildPath(path) {
  return path.startsWith("src/") || path === "package.json" || path.startsWith("tsconfig");
}

/**
 * Classify a change set into lane admissions.
 *
 * @param {string[]} paths changed repository paths
 * @param {{event?: string, ref?: string, diffAvailable?: boolean}} context
 * @returns {{core: boolean, observe: boolean, build: boolean, nightly: boolean, reason: string}}
 */
export function classify(paths, context = {}) {
  const event = context.event ?? "push";
  const ref = context.ref ?? "";
  const diffAvailable = context.diffAvailable ?? true;

  const everything = (reason) => ({ core: true, observe: true, build: true, nightly: event === "schedule", reason });

  // Tags, schedules and manual dispatch are never path-optimised.
  if (ref.startsWith("refs/tags/")) return everything("release tag: full coverage");
  if (event === "schedule") return everything("scheduled run: full coverage");
  if (event === "workflow_dispatch") return everything("manual dispatch: full coverage");
  if (event !== "pull_request" && event !== "push") return everything(`unrecognised event ${event}: full coverage`);

  // No usable diff (first push, force-push, unresolvable base) -> assume the worst.
  if (!diffAvailable) return everything("changed paths unavailable: full coverage");
  const changed = paths.filter((path) => path.length > 0);
  if (changed.length === 0) return everything("empty diff: full coverage");

  if (changed.every(isDocsOnlyPath)) {
    return { core: false, observe: false, build: false, nightly: false, reason: "documentation-only change: no lane admitted" };
  }

  const conservative = changed.filter(isConservativePath);
  if (conservative.length > 0) {
    return everything(`test-selection or build surface changed (${conservative[0]}): full coverage`);
  }

  // Everything remaining is a source/test/eval/org change: the core lane runs.
  // Unknown paths land here too, which is the safe direction.
  return {
    core: true,
    observe: changed.some(isObservePath),
    build: changed.some(isBuildPath),
    nightly: false,
    reason: "source change: core lane" + (changed.some(isObservePath) ? " + observer/reports lane" : ""),
  };
}

export const __testing = { isDocsOnlyPath, isConservativePath, isObservePath, isBuildPath };

/**
 * CLI entry: reads the changed paths on stdin (one per line), classifies them
 * against $GITHUB_EVENT_NAME / $GITHUB_REF, appends `core`/`observe`/`build`/
 * `nightly` to $GITHUB_OUTPUT and prints the decision to the log.
 *
 * `diffAvailable` is signalled by the caller passing `--no-diff`, used when the
 * workflow could not resolve a merge base (first push, force-push).
 */
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const noDiff = process.argv.includes("--no-diff");
  const stdin = await new Promise((resolve) => {
    let buffer = "";
    if (process.stdin.isTTY) return resolve("");
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { buffer += chunk; });
    process.stdin.on("end", () => resolve(buffer));
  });
  const paths = stdin.split("\n").map((line) => line.trim()).filter(Boolean);
  const decision = classify(paths, {
    event: process.env.GITHUB_EVENT_NAME,
    ref: process.env.GITHUB_REF,
    diffAvailable: !noDiff,
  });
  const { appendFileSync } = await import("node:fs");
  const lines = `core=${decision.core}\nobserve=${decision.observe}\nbuild=${decision.build}\nnightly=${decision.nightly}\n`;
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### CI lane admission\n\n**${decision.reason}**\n\n| lane | admitted |\n| --- | --- |\n| core | ${decision.core} |\n| observer/reports | ${decision.observe} |\n| build | ${decision.build} |\n| nightly flake | ${decision.nightly} |\n\n<details><summary>${paths.length} changed path(s)</summary>\n\n\`\`\`\n${paths.join("\n")}\n\`\`\`\n\n</details>\n`);
  }
  console.log(`${decision.reason}\n${lines}`);
}
