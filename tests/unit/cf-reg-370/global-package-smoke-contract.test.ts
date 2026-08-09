// CF-REG-370 — packaging smoke must exercise npm's actual global layout.
// A project-local node_modules install cannot prove global bin placement,
// same-prefix reinstall, or the installed-root path used by packaged skills.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

describe("CF-REG-370 — real npm-global package smoke", () => {
  it("uses a disposable prefix, runs npm install -g twice, and links skills from that installed root", () => {
    const source = readFileSync(join(repoRoot, "scripts", "smoke-package-install.mjs"), "utf8");
    expect(source).toContain('"install", "-g", "--prefix"');
    expect(source.match(/"install", "-g", "--prefix"/g)).toHaveLength(2);
    expect(source).toContain('join(globalPrefix, "bin", binary)');
    expect(source).toContain('join(globalPrefix, "lib", "node_modules", "cormidia")');
    expect(source).toContain('join(installedRoot, "scripts", "link-skills.mjs")');
    expect(source).toContain("CODEX_HOME");
    expect(source).toContain("CLAUDE_CONFIG_DIR");
    expect(source).toContain("PI_CODING_AGENT_DIR");
  });
});
