import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { parse } from "yaml";

it("J-REL-01 wires token-free PR/nightly checks and a deliberate strict release gate", () => {
  const path = fileURLToPath(new URL("../../.github/workflows/efficiency-qualification.yml", import.meta.url));
  const raw = readFileSync(path, "utf8"); const workflow = parse(raw) as Record<string, unknown>;
  expect(workflow).toBeTruthy();
  for (const command of ["pnpm eval:validate", "pnpm test:transformation", "pnpm eval:deterministic", "pnpm typecheck", "pnpm test:transformation:strict"]) expect(raw).toContain(command);
  expect(raw).not.toContain("eval:live");
  expect(raw).not.toContain("test:live");
});
