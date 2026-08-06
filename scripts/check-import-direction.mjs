import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, relative, resolve, sep } from "node:path";
import ts from "typescript";

const layerRank = new Map([
  ["runtime", 0],
  ["loop", 1],
  ["org", 2],
]);
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
let checkedImports = 0;

for (const file of collectSourceFiles(sourceRoot).sort()) {
  const sourceRelative = relative(sourceRoot, file);
  const sourceLayer = sourceRelative.split(sep)[0];
  const sourceRank = layerRank.get(sourceLayer);
  if (sourceRank === undefined) continue;

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

if (failures.length > 0) {
  console.error("Source imports must flow org -> loop -> runtime:");
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}

console.log(`Import-direction check passed (${checkedImports} relative imports).`);
