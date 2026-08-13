// Traceability: CF-REG-388 · HB-139 · case-catalog.md §10.3.

// CF-REG-388 — the committed-org-home inventory is closed.
//
// #388's systemic gap was that "the org home is committed configuration" was
// prose: no mechanism forced a new writer to say whether its destination is
// committed configuration or runtime state, so `new-app` could write
// `apps.yaml` and report a terminal `app-created-and-registered` while the
// remote still said `apps: {}`.
//
// This is the architectural guard. It walks `src/` for every org-home path
// literal and requires each one to classify as a declared committed surface or
// as a declared state prefix. An unclassified writer fails here, in CI, rather
// than shipping a third silent category.
//
// Detector honesty (README rule 4 / rule 5): the walk asserts it found source
// files AND at least one org-home join, and two named negative controls prove
// the guard fires on a seeded unclassified writer and on a traversal path.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  COMMITTED_ORG_SURFACES,
  classifyOrgHomeWrite,
  committedOrgSurface,
} from "../../../src/org/committed-org-surfaces.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

interface OrgHomeJoin {
  file: string;
  line: number;
  path: string;
}

/** Every `join(<something org-home-ish>, "literal", …)` in a TypeScript source.
 *
 *  Literal segments only, and it stops at the first non-literal argument: a
 *  dynamic segment makes the destination unknowable statically, and guessing
 *  would be worse than the honest gap the sweep assertion below keeps visible. */
function orgHomeJoins(sourceText: string, fileLabel: string): OrgHomeJoin[] {
  const sourceFile = ts.createSourceFile(fileLabel, sourceText, ts.ScriptTarget.ESNext, true);
  const found: OrgHomeJoin[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const callee = node.expression.text;
      if (callee === "join" || callee === "resolve") {
        const [first, ...rest] = node.arguments;
        const receiver = first === undefined ? "" : first.getText(sourceFile);
        if (/orgHome|org_home|orgRoot/i.test(receiver) && !/state/i.test(receiver)) {
          const segments: string[] = [];
          for (const argument of rest) {
            if (!ts.isStringLiteral(argument)) break;
            segments.push(argument.text);
          }
          if (segments.length > 0) {
            const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
            found.push({ file: fileLabel, line: line + 1, path: segments.join("/") });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function walkTypeScriptFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkTypeScriptFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(path);
  }
  return files;
}

function sweepSource(): OrgHomeJoin[] {
  const files = walkTypeScriptFiles(join(REPO_ROOT, "src"));
  expect(files.length, "source walk must not be empty").toBeGreaterThan(100);
  return files.flatMap((file) =>
    orgHomeJoins(readFileSync(file, "utf8"), relative(REPO_ROOT, file).replaceAll("\\", "/")),
  );
}

describe("CF-REG-388 — every org-home write destination is classified", () => {
  it("classifies every org-home path literal in src/ as committed configuration or runtime state", () => {
    const joins = sweepSource();
    expect(joins.length, "sweep found no org-home joins — the detector cannot have fired").toBeGreaterThan(20);
    const unclassified = joins
      .filter((entry) => classifyOrgHomeWrite(entry.path).kind === "unclassified")
      .map((entry) => `${entry.file}:${entry.line} -> ${entry.path}`);
    expect(unclassified).toEqual([]);
  });

  it("negative control: a seeded unclassified org-home writer fires the guard", () => {
    const seeded = orgHomeJoins(
      ['import { join } from "node:path";', 'const p = join(orgHome, "secrets.yaml");'].join("\n"),
      "seeded/unclassified-writer.ts",
    );
    expect(seeded.map((entry) => entry.path)).toEqual(["secrets.yaml"]);
    expect(seeded.map((entry) => classifyOrgHomeWrite(entry.path).kind)).toEqual(["unclassified"]);
  });

  it("negative control: a traversal path never inherits a surface", () => {
    expect(classifyOrgHomeWrite("../../etc/passwd").kind).toBe("unclassified");
    expect(classifyOrgHomeWrite("learning/../../escape").kind).toBe("unclassified");
    expect(classifyOrgHomeWrite("/absolute/apps.yaml").kind).toBe("unclassified");
  });

  it("classifies the known committed surfaces and the known state prefixes", () => {
    expect(classifyOrgHomeWrite("apps.yaml")).toEqual({
      kind: "committed",
      surface: committedOrgSurface("app-registry"),
    });
    expect(classifyOrgHomeWrite("roles.yaml").kind).toBe("committed");
    expect(classifyOrgHomeWrite("learning/concepts/org/x.md").kind).toBe("committed");
    expect(classifyOrgHomeWrite("memory/roles/planner/denial-lessons.md").kind).toBe("committed");
    expect(classifyOrgHomeWrite("retro/2026-08-12.md").kind).toBe("committed");
    expect(classifyOrgHomeWrite("telemetry/2026-08-12.jsonl").kind).toBe("state");
    expect(classifyOrgHomeWrite("state/budget-overlay.json").kind).toBe("state");
  });

  it("every declared surface names its writers and keeps the reviewed-branch policy", () => {
    expect(COMMITTED_ORG_SURFACES.length).toBeGreaterThan(0);
    for (const surface of COMMITTED_ORG_SURFACES) {
      expect(surface.paths.length, `${surface.id} declares no paths`).toBeGreaterThan(0);
      expect(surface.writers.length, `${surface.id} declares no writers`).toBeGreaterThan(0);
      // A direct default-branch publication route is unratified (F-PT-013):
      // widening this is a human decision, and this assertion is where a
      // silent widening would be caught.
      expect(surface.policy).toBe("reviewed-branch");
      for (const path of surface.paths) {
        expect(path.startsWith("/"), `${surface.id} declares an absolute path`).toBe(false);
        expect(path.includes(".."), `${surface.id} declares a traversal path`).toBe(false);
      }
    }
    const ids = COMMITTED_ORG_SURFACES.map((surface) => surface.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
