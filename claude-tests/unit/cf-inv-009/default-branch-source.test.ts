// CF-INV-009 structural guard — consequential source code may not reintroduce
// a hardcoded main base after the legacy scanner was retired (HB-030).

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOTS = [resolve("src/loop"), resolve("src/org"), resolve("src/runtime")];

function sourceFiles(root: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    const stat = statSync(path);
    if (stat.isDirectory()) files.push(...sourceFiles(path));
    else if (name.endsWith(".ts")) files.push(path);
  }
  return files;
}

function violations(path: string): string[] {
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node) && node.text === "origin/main") {
      found.push(`${path}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}: origin/main`);
    }
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) {
      const consequential = ["base", "defaultBranch", "baseRefName"].includes(node.name.text);
      if (consequential && ts.isStringLiteralLike(node.initializer) && node.initializer.text === "main") {
        found.push(`${path}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}: ${node.name.text}=main`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("CF-INV-009 — resolved-default-branch structural pin", () => {
  it("contains no executable origin/main or consequential main-base literal", () => {
    const found = ROOTS.flatMap(sourceFiles).flatMap(violations);
    expect(found).toEqual([]);
  });

  it("negative control: the AST detector fires on a seeded guessed base", () => {
    const source = ts.createSourceFile(
      "seed.ts",
      'const base = { ref: "origin/main", defaultBranch: "main" };',
      ts.ScriptTarget.Latest,
      true,
    );
    const values: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isStringLiteralLike(node)) values.push(node.text);
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(values).toContain("origin/main");
    expect(values).toContain("main");
  });
});
