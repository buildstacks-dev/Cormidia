import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, relative, resolve, sep } from "node:path";
import ts from "typescript";

// Every top-level directory under src/ MUST appear here or the check fails.
// Ranks are ascending "may import downward": a layer may import equal or lower
// ranks and never a higher one. The map was previously runtime/loop/org only,
// and an unranked directory was silently SKIPPED — which exempted cli, observe,
// report, and narrative from the rule AGENTS.md calls binding, with the check
// still reporting green. Unranked is now a hard failure (fail closed).
const layerRank = new Map([
  ["runtime", 0],
  ["loop", 1],
  ["org", 2],
  // Presentation-only leaves (AGENTS.md): they consume org/loop/runtime and
  // nothing below them may depend on them. observe imports report, so it ranks
  // above it. jobs is a peer leaf — ad-hoc job graphs read org config and
  // import downward; the governed loop must never depend on jobs.
  ["report", 3],
  ["narrative", 3],
  ["jobs", 3],
  ["observe", 4],
  // Command dispatch sits on top and may import anything below it.
  ["cli", 5],
]);
// Top-level entry FILES (src/cli.ts, src/cormidia.cjs) are not layers. They are
// exempt by shape, not by omission — a directory can never reach this set.
const entryFileExemptions = new Set(["cli.ts", "cormidia.cjs", "cormidia-local.cjs"]);
const sourceExtensions = new Set([".ts", ".tsx", ".mts", ".cts"]);

function collectSourceFiles(directory, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) collectSourceFiles(absolute, files);
    else if (entry.isFile() && sourceExtensions.has(extname(entry.name))) {
      files.push(absolute);
    }
  }
  return files;
}

function moduleSpecifiers(sourceFile) {
  const specifiers = [];
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0]);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      specifiers.push(node.argument.literal);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
}

const repositoryRoot = resolve(process.argv[2] ?? ".");
const sourceRoot = resolve(repositoryRoot, "src");
const failures = [];
const unrankedLayers = new Set();
let checkedImports = 0;

for (const file of collectSourceFiles(sourceRoot).sort()) {
  const sourceRelative = relative(sourceRoot, file);
  const segments = sourceRelative.split(sep);
  const sourceLayer = segments[0];
  // A path with one segment is a top-level entry file, not a layer.
  if (segments.length === 1) {
    if (!entryFileExemptions.has(sourceLayer)) {
      failures.push(
        `${sourceRelative}: new top-level src/ entry file is not exempted; ` +
          `add it to entryFileExemptions in ${relative(repositoryRoot, import.meta.filename)} ` +
          "or move it into a ranked layer directory",
      );
    }
    continue;
  }
  const sourceRank = layerRank.get(sourceLayer);
  if (sourceRank === undefined) {
    // Fail closed. A silent skip here is how a whole subsystem escapes the
    // one-way rule while `pnpm check` still passes.
    unrankedLayers.add(sourceLayer);
    continue;
  }

  const sourceFile = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  for (const node of moduleSpecifiers(sourceFile)) {
    const specifier = node.text;
    if (!specifier.startsWith(".")) continue;
    checkedImports += 1;

    const targetRelative = relative(sourceRoot, resolve(dirname(file), specifier));
    if (targetRelative.startsWith(`..${sep}`) || targetRelative === "..") continue;
    const targetLayer = targetRelative.split(sep)[0];
    const targetRank = layerRank.get(targetLayer);
    if (targetRank === undefined || targetRank <= sourceRank) continue;

    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    failures.push(`${sourceRelative}:${line + 1}: src/${sourceLayer} may not import src/${targetLayer} (${specifier})`);
  }
}

if (unrankedLayers.size > 0) {
  console.error("Every top-level src/ directory must declare its import-layer rank:");
  for (const layer of [...unrankedLayers].sort()) {
    console.error(
      `  src/${layer}: unranked, so its imports were never checked. ` +
        `Add "${layer}" to layerRank in scripts/check-import-direction.mjs with the rank it may import downward from.`,
    );
  }
  process.exit(1);
}

if (failures.length > 0) {
  console.error("Source imports must flow downward through the declared layer ranks:");
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}

console.log(`Import-direction check passed (${checkedImports} relative imports, ${layerRank.size} ranked layers).`);
