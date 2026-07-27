import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("developer lifecycle policy and evidence never ship into an operated Operon org package", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { files: string[] };
  const shipped = pkg.files;
  for (const developerOnly of [
    "AGENTS.md",
    "docs/PURPOSE.md",
    "docs/DEVELOPMENT.md",
    "docs/episodes/contract.md",
    "docs/qualification/design.md",
    "eval/",
    "scripts/eval/",
    "test/",
  ]) expect(shipped, developerOnly).not.toContain(developerOnly);
  expect(shipped).toContain("agent-skills/operon/");
  expect(shipped).toContain("TASTE.md");
  expect(shipped).toContain("roles.yaml");
  expect(shipped).toContain("pipelines.yaml");
  const packagedSkill = readFileSync("agent-skills/operon/SKILL.md", "utf8");
  expect(packagedSkill).toMatch(/must not build or maintain Operon\s+itself/);
  expect(packagedSkill).not.toContain("pnpm eval:");
  expect(packagedSkill).not.toContain("OPERON_EVAL_");
});

it("the packaged skill matches the standalone run-role checkout contract", () => {
  const packagedSkill = readFileSync("agent-skills/operon/SKILL.md", "utf8");
  expect(packagedSkill).toMatch(
    /does not synchronize the\s+managed clone or create or verify the live worktree/,
  );
  expect(packagedSkill).toMatch(
    /executes in a durable per-turn worktree cut from that exact\s+resolved base/,
  );
  expect(packagedSkill).toMatch(
    /Governed scheduled, event, and ticket routes keep\s+their governed scope and existing checkout ownership/,
  );
  expect(packagedSkill).not.toMatch(
    /live execution always uses the\s+org-managed app clone/,
  );
});
