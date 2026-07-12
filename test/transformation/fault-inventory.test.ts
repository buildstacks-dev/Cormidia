import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { expect, it } from "vitest";

it("the named fault inventory covers every ratified durable boundary without duplicates", () => {
  const value = parse(readFileSync(fileURLToPath(new URL("../../eval/faults.yaml", import.meta.url)), "utf8")) as { faults: string[] };
  expect(new Set(value.faults).size).toBe(value.faults.length);
  for (const family of ["archive", "registry", "provider", "commit", "push", "approval", "settlement", "scheduler", "learning"]) expect(value.faults.some((fault) => fault.includes(family)), family).toBe(true);
  expect(value.faults.every((fault) => fault.startsWith("before_") || fault.startsWith("after_"))).toBe(true);
});
