// The greenfield scaffold's PATH set, split from its content (#382).
//
// `generatedFiles` in new-app.ts renders paths and bytes together, which is
// right for scaffolding and wrong for provisioning: a provisioning preflight
// needs to declare what a template owns without an app name, a goal, or a
// repository slug to render content from.
//
// This table is that declaration. It is not a second source of truth — the
// agreement test in tests/unit/cf-reg-382/ asserts it equals
// `generatedFiles(template, …).map((file) => file.rel)` exactly, so a template
// that gains or loses a file fails there rather than silently dropping out of
// the provisioning scope.

/** Kept structurally identical to new-app.ts's own union; imported from here by
 *  provisioning so the preflight does not pull in the whole scaffold renderer. */
export type NewAppTemplate = "typescript-node" | "bare";

export const NEW_APP_SCAFFOLD_PATHS: Readonly<Record<NewAppTemplate, readonly string[]>> = {
  bare: [
    ".gitignore",
    "AGENTS.md",
    "README.md",
    "docs/VISION.md",
    "docs/REQUIREMENTS.md",
    "docs/ARCHITECTURE.md",
    "docs/RUNBOOK.md",
    "docs/TESTING.md",
  ],
  "typescript-node": [
    ".gitignore",
    "AGENTS.md",
    "README.md",
    "package.json",
    "tsconfig.json",
    "index.html",
    "styles.css",
    "src/domain.ts",
    "src/client.ts",
    "test/domain.test.ts",
    "scripts/lint.mjs",
    "scripts/server.mjs",
    "docs/VISION.md",
    "docs/REQUIREMENTS.md",
    "docs/ARCHITECTURE.md",
    "docs/RUNBOOK.md",
    "docs/TESTING.md",
  ],
};
