// CF-REG-375 (L1) — generated guide specialization and stale-command guard.

import { describe, expect, it } from "vitest";
import { renderNextCommandsGuide } from "../../../src/org/new-app-guide.js";

describe("CF-REG-375 — checkpointed new-app lifecycle guide", () => {
  it("specializes TypeScript commands, identities, checkpoints, and safety boundaries", () => {
    const guide = render("typescript-node");
    for (const value of [
      "atlas",
      "acme/atlas",
      "/work/atlas",
      "/pkg/cormidia",
      "/org/cormidia",
      "/state/cormidia",
      "npm install",
      "npm test",
      "npm run lint",
    ]) {
      expect(guide).toContain(value);
    }
    expect(checkpointNumbers(guide)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(guide).toContain("--disposition keep");
    expect(guide).toContain("--disposition reconcile");
    expect(guide).toContain("--disposition remove");
    expect(guide).toContain("choose exactly one mutually exclusive path");
    expect(guide.match(/^### If you chose /gm)).toHaveLength(3);
    expect(guide.match(/^cormidia app product-docs .*--execute --confirm .+$/gm)).toHaveLength(3);
    expect(guide).toContain("Run exactly one section: the pair matching the recorded disposition");
    expect(guide.match(/^### If the recorded disposition is /gm)).toHaveLength(3);
    expect(guide).toContain("cormidia approvals list --json");
    expect(guide).toContain("cormidia approvals review --by '<operator-identity>'");
    expect(combinedAlternativeBlocks(guide)).toBe(0);
    expect(guide).toContain("--dry-run");
    expect(guide).toContain("human merges");
    expect(guide).toContain("separate content-bound actions");
    expect(guide).toContain("until a human authorizes the exact");
    expect(guide).not.toMatch(/^cormidia loop.*--allow-network$/gm);
    expect(unsupportedCommands(guide)).toEqual([]);
  });

  it("specializes bare onboarding around governed stack establishment", () => {
    const guide = render("bare");
    expect(guide).toContain("executionGroup: bare-stack-and-gates-v1");
    expect(guide).toContain("--once --allow-network");
    expect(guide).toContain("omit `--allow-network` from later runs");
    expect(guide).toContain("no setup/test/lint command yet");
    expect(guide).not.toContain("npm install");
    expect(guide).not.toContain("npm test");
    expect(unsupportedCommands(guide)).toEqual([]);
  });

  it("negative control: detects the retired initial-ticket path and unsupported budget scope", () => {
    const seeded = `${render("typescript-node")}
cormidia budget --app atlas
gh issue create --body-file .cormidia/bootstrap/initial-issue.md
gh pr view <pr-number>
\`\`\`bash
cormidia app product-docs atlas --disposition keep --execute --confirm atlas:keep
cormidia app product-docs atlas --disposition reconcile --execute --confirm atlas:reconcile
cormidia app product-docs atlas --disposition remove --execute --confirm atlas:remove
\`\`\``;
    expect(unsupportedCommands(seeded)).toEqual([
      "budget does not accept --app",
      "initial implementation must be published by governed planning",
      "command contains an unquoted shell placeholder",
    ]);
    expect(combinedAlternativeBlocks(seeded)).toBe(1);
    expect(unsupportedCommands(render("typescript-node"))).toEqual([]);
  });
});

function render(template: "typescript-node" | "bare"): string {
  return renderNextCommandsGuide({
    appName: "atlas",
    repoSlug: "acme/atlas",
    targetDir: "/work/atlas",
    goal: "deliver an observable atlas milestone",
    template,
    packageRoot: "/pkg/cormidia",
    orgHome: "/org/cormidia",
    stateHome: "/state/cormidia",
    setupCommand: template === "typescript-node" ? "npm install" : null,
    testCommand: template === "typescript-node" ? "npm test" : null,
    lintCommand: template === "typescript-node" ? "npm run lint" : null,
  });
}

function checkpointNumbers(guide: string): number[] {
  return [...guide.matchAll(/^## Checkpoint (\d+)/gm)].map((match) => Number(match[1]));
}

function combinedAlternativeBlocks(guide: string): number {
  return [...guide.matchAll(/```bash\n([\s\S]*?)```/g)].filter((match) => {
    const lines = match[1]!.split("\n");
    const dispositions = lines.filter(
      (line) => line.startsWith("cormidia app product-docs ") && line.includes("--execute --confirm"),
    );
    const livePlans = lines.filter((line) => line.startsWith("cormidia plan ") && !line.includes("--dry-run"));
    return dispositions.length > 1 || livePlans.length > 1;
  }).length;
}

function unsupportedCommands(guide: string): string[] {
  return [
    ...(guide.includes("cormidia budget --app") ? ["budget does not accept --app"] : []),
    ...(guide.includes("gh issue create --body-file .cormidia/bootstrap/initial-issue.md")
      ? ["initial implementation must be published by governed planning"]
      : []),
    ...(guide
      .split("\n")
      .filter((line) => /^(?:cormidia|gh|git|npm|cd) /.test(line))
      .some((line) => /(?:^|\s)<[^>]+>/.test(line))
      ? ["command contains an unquoted shell placeholder"]
      : []),
  ];
}
