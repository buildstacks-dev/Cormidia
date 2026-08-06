import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const dependencySections = ["dependencies", "devDependencies", "optionalDependencies"];
const exactVersionPattern = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const ignoredDirectories = new Set([".git", "archive-do-not-read", "dist", "node_modules"]);

function collectPackageJsonFiles(directory, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        collectPackageJsonFiles(join(directory, entry.name), files);
      }
      continue;
    }

    if (entry.isFile() && entry.name === "package.json") {
      files.push(join(directory, entry.name));
    }
  }
  return files;
}

function versionSpecifier(specifier) {
  if (!specifier.startsWith("npm:")) return specifier;
  const aliasTarget = specifier.slice("npm:".length);
  const versionSeparator = aliasTarget.lastIndexOf("@");
  return versionSeparator > 0 ? aliasTarget.slice(versionSeparator + 1) : specifier;
}

const root = resolve(process.argv[2] ?? ".");
const failures = [];
let checkedDependencies = 0;

for (const file of collectPackageJsonFiles(root).sort()) {
  const packageJson = JSON.parse(readFileSync(file, "utf8"));
  for (const section of dependencySections) {
    const dependencies = packageJson[section];
    if (dependencies === undefined) continue;
    if (dependencies === null || typeof dependencies !== "object") {
      failures.push(`${file}: ${section} must be an object`);
      continue;
    }

    for (const [name, specifier] of Object.entries(dependencies)) {
      checkedDependencies += 1;
      if (typeof specifier !== "string" || !exactVersionPattern.test(versionSpecifier(specifier))) {
        failures.push(`${file}: ${section}.${name} must be pinned, found ${String(specifier)}`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error("Direct external dependencies must use exact versions:");
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}

console.log(`Pinned dependency check passed (${checkedDependencies} dependencies).`);
