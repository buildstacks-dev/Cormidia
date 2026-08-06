#!/usr/bin/env node

import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const SCHEMA_VERSION = 1;
const MAX_NEW_MODULE_EXPORTS = 10;
const MAX_NEW_MODULE_LINES = 300;

function exactKeys(value, expected, name) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(`${name} must contain exactly: ${wanted.join(", ")}`);
  }
}

function record(value, name) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value;
}

function nonNegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative safe integer`);
  return value;
}

async function walkTypeScriptFiles(directory) {
  const files = [];
  const walk = async (current) => {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, "en"))) {
      const path = join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`source walk refuses symbolic link: ${path}`);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(path);
    }
  };
  await walk(directory);
  return files.sort();
}

function physicalLineCount(source) {
  if (source.length === 0) return 0;
  const count = source.split(/\r\n?|\n/).length;
  return /(?:\r\n?|\n)$/.test(source) ? count - 1 : count;
}

export async function collectModuleMetrics(root) {
  const sourceRoot = join(root, "src");
  const files = await walkTypeScriptFiles(sourceRoot);
  if (files.length === 0) throw new Error(`size ratchet source walk is empty: ${sourceRoot}`);

  const program = ts.createProgram(files, {
    allowJs: false,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    skipLibCheck: true,
    target: ts.ScriptTarget.ESNext,
    types: [],
  });
  const checker = program.getTypeChecker();
  const modules = new Map();
  for (const file of files) {
    const sourceFile = program.getSourceFile(file);
    if (sourceFile === undefined) throw new Error(`TypeScript program omitted walked source: ${file}`);
    const symbol = checker.getSymbolAtLocation(sourceFile);
    const path = relative(root, file).replaceAll("\\", "/");
    modules.set(path, {
      exports: symbol === undefined ? 0 : checker.getExportsOfModule(symbol).length,
      lines: physicalLineCount(sourceFile.text),
    });
  }
  return modules;
}

export async function loadBaseline(path) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`size ratchet baseline is unreadable or malformed: ${path}: ${String(error)}`);
  }
  const baseline = record(parsed, "size ratchet baseline");
  exactKeys(baseline, ["schemaVersion", "modules"], "size ratchet baseline");
  if (baseline.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`size ratchet baseline schemaVersion must be ${SCHEMA_VERSION}`);
  }
  const rawModules = record(baseline.modules, "size ratchet baseline.modules");
  const paths = Object.keys(rawModules);
  if (paths.length === 0) throw new Error("size ratchet baseline.modules must not be empty");
  if (JSON.stringify(paths) !== JSON.stringify([...paths].sort())) {
    throw new Error("size ratchet baseline module paths must be sorted");
  }

  const modules = new Map();
  for (const path of paths) {
    if (!/^src\/(?:[^/]+\/)*[^/]+\.ts$/.test(path) || path.includes("..")) {
      throw new Error(`size ratchet baseline has invalid module path: ${path}`);
    }
    const rawEntry = record(rawModules[path], `size ratchet baseline ${path}`);
    exactKeys(rawEntry, ["exports", "lines", "newModule"], `size ratchet baseline ${path}`);
    if (typeof rawEntry.newModule !== "boolean") {
      throw new Error(`size ratchet baseline ${path}.newModule must be boolean`);
    }
    modules.set(path, {
      exports: nonNegativeInteger(rawEntry.exports, `size ratchet baseline ${path}.exports`),
      lines: nonNegativeInteger(rawEntry.lines, `size ratchet baseline ${path}.lines`),
      newModule: rawEntry.newModule,
    });
  }
  return modules;
}

export async function checkSizeRatchet({ root, baselinePath }) {
  const [current, baseline] = await Promise.all([collectModuleMetrics(root), loadBaseline(baselinePath)]);
  const currentPaths = [...current.keys()];
  const baselinePaths = [...baseline.keys()];
  const missing = currentPaths.filter((path) => !baseline.has(path));
  const stale = baselinePaths.filter((path) => !current.has(path));
  if (missing.length > 0 || stale.length > 0) {
    const problems = [
      ...missing.map((path) => `missing baseline coverage: ${path}`),
      ...stale.map((path) => `baseline covers no current source module: ${path}`),
    ];
    throw new Error(`size ratchet coverage failed:\n${problems.map((problem) => `- ${problem}`).join("\n")}`);
  }

  const violations = [];
  for (const path of currentPaths) {
    const actual = current.get(path);
    const ceiling = baseline.get(path);
    if (ceiling.newModule && ceiling.exports > MAX_NEW_MODULE_EXPORTS) {
      violations.push(`${path}: new-module export baseline ${ceiling.exports} exceeds ${MAX_NEW_MODULE_EXPORTS}`);
    }
    if (ceiling.newModule && ceiling.lines > MAX_NEW_MODULE_LINES) {
      violations.push(`${path}: new-module line baseline ${ceiling.lines} exceeds ${MAX_NEW_MODULE_LINES}`);
    }
    if (actual.exports > ceiling.exports) {
      violations.push(`${path}: exports grew from ${ceiling.exports} to ${actual.exports}`);
    }
    if (actual.lines > ceiling.lines) {
      violations.push(`${path}: lines grew from ${ceiling.lines} to ${actual.lines}`);
    }
  }
  if (violations.length > 0) {
    throw new Error(
      `size/export ratchet failed:\n${violations.map((violation) => `- ${violation}`).join("\n")}\n` +
        "An override requires an explicit baseline edit and a named justification in the PR body.",
    );
  }

  const totals = [...current.values()].reduce(
    (sum, metric) => ({ exports: sum.exports + metric.exports, lines: sum.lines + metric.lines }),
    { exports: 0, lines: 0 },
  );
  return { modules: current.size, ...totals };
}

function parseArguments(args) {
  let root = process.cwd();
  let baselinePath;
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[index + 1];
    if ((flag !== "--root" && flag !== "--baseline") || value === undefined) {
      throw new Error("usage: check-size-ratchet.mjs [--root <path>] [--baseline <path>]");
    }
    if (flag === "--root") root = resolve(value);
    else baselinePath = resolve(value);
    index += 1;
  }
  return { root, baselinePath: baselinePath ?? join(root, "scripts", "size-ratchet-baseline.json") };
}

async function main() {
  const result = await checkSizeRatchet(parseArguments(process.argv.slice(2)));
  process.stdout.write(
    `Size/export ratchet passed (${result.modules} modules, ${result.exports} exports, ${result.lines} lines).\n`,
  );
}

const entrypoint = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (entrypoint === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
