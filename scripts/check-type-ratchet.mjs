#!/usr/bin/env node

// Monotone ratchet for TypeScript escape hatches (#402, audited
// research/2026-08-11_prompt-and-ts-posture-audit.md §A2.7).
//
// Counted per file, AST-exact (never grep): `as T` type assertions excluding
// `as const` and `as unknown`, and non-null `!` assertions. The committed
// baseline records today's debt; a file absent from the baseline has ceiling
// zero for both metrics, so NEW code lands with zero escape hatches. Counts
// may only fall: a drop must be committed via `--write` (which rewrites the
// baseline downward, never upward), and an increase requires an explicit
// human-approved baseline edit with a named justification in the PR body.

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const SCHEMA_VERSION = 1;
const SCOPES = ["src", "tests"];
const WRITE_COMMAND = "node scripts/check-type-ratchet.mjs --write";

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
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error !== null && typeof error === "object" && error.code === "ENOENT" && current === directory) {
        throw new Error(`type ratchet scope is missing: ${directory}`);
      }
      throw error;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, "en"))) {
      const path = join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`type ratchet walk refuses symbolic link: ${path}`);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(path);
    }
  };
  await walk(directory);
  return files.sort();
}

function countEscapeHatches(sourceFile) {
  let asAssertions = 0;
  let nonNull = 0;
  const visit = (node) => {
    if (ts.isAsExpression(node)) {
      const type = node.type;
      const isConstAssertion = ts.isTypeReferenceNode(type) && type.typeName.getText(sourceFile) === "const";
      const isUnknownAssertion = type.kind === ts.SyntaxKind.UnknownKeyword;
      if (!isConstAssertion && !isUnknownAssertion) asAssertions += 1;
    }
    if (ts.isNonNullExpression(node)) nonNull += 1;
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { as: asAssertions, nonNull };
}

export async function collectHatchMetrics(root) {
  const files = new Map();
  let walked = 0;
  for (const scope of SCOPES) {
    for (const file of await walkTypeScriptFiles(join(root, scope))) {
      walked += 1;
      const source = await readFile(file, "utf8");
      const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.ESNext, true);
      const counts = countEscapeHatches(sourceFile);
      if (counts.as > 0 || counts.nonNull > 0) {
        files.set(relative(root, file).replaceAll("\\", "/"), counts);
      }
    }
  }
  if (walked === 0)
    throw new Error(`type ratchet source walk is empty: ${SCOPES.map((s) => join(root, s)).join(", ")}`);
  return files;
}

export async function loadBaseline(path) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`type ratchet baseline is unreadable or malformed: ${path}: ${String(error)}`);
  }
  const baseline = record(parsed, "type ratchet baseline");
  exactKeys(baseline, ["schemaVersion", "files"], "type ratchet baseline");
  if (baseline.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`type ratchet baseline schemaVersion must be ${SCHEMA_VERSION}`);
  }
  const rawFiles = record(baseline.files, "type ratchet baseline.files");
  const paths = Object.keys(rawFiles);
  if (JSON.stringify(paths) !== JSON.stringify([...paths].sort())) {
    throw new Error("type ratchet baseline file paths must be sorted");
  }
  const files = new Map();
  for (const path of paths) {
    if (!/^(?:src|tests)\/(?:[^/]+\/)*[^/]+\.ts$/.test(path) || path.includes("..")) {
      throw new Error(`type ratchet baseline has invalid file path: ${path}`);
    }
    const rawEntry = record(rawFiles[path], `type ratchet baseline ${path}`);
    exactKeys(rawEntry, ["as", "nonNull"], `type ratchet baseline ${path}`);
    const entry = {
      as: nonNegativeInteger(rawEntry.as, `type ratchet baseline ${path}.as`),
      nonNull: nonNegativeInteger(rawEntry.nonNull, `type ratchet baseline ${path}.nonNull`),
    };
    if (entry.as === 0 && entry.nonNull === 0) {
      throw new Error(`type ratchet baseline ${path} is debt-free and must be removed (run ${WRITE_COMMAND})`);
    }
    files.set(path, entry);
  }
  return files;
}

function serializeBaseline(files) {
  const sorted = {};
  for (const path of [...files.keys()].sort()) sorted[path] = files.get(path);
  return `${JSON.stringify({ schemaVersion: SCHEMA_VERSION, files: sorted }, null, 2)}\n`;
}

async function loadBaselineIfPresent(path) {
  try {
    await readFile(path, "utf8");
  } catch (error) {
    if (error !== null && typeof error === "object" && error.code === "ENOENT") return undefined;
  }
  return await loadBaseline(path);
}

export async function checkTypeRatchet({ root, baselinePath, write }) {
  const current = await collectHatchMetrics(root);
  if (write) {
    // --write may only tighten: refuse when any count exceeds the committed
    // ceiling, so the automated path can never launder an increase. A missing
    // baseline is the one seeding case; a malformed one still fails loudly.
    const baseline = await loadBaselineIfPresent(baselinePath);
    if (baseline !== undefined) {
      const violations = collectViolations(current, baseline);
      if (violations.length > 0) {
        throw new Error(
          `type ratchet --write refused, counts exceed the baseline:\n${violations.map((v) => `- ${v}`).join("\n")}`,
        );
      }
    }
    await writeFile(baselinePath, serializeBaseline(current));
    return { files: current.size, ...totals(current), wrote: true };
  }

  const baseline = await loadBaseline(baselinePath);
  const violations = collectViolations(current, baseline);
  if (violations.length > 0) {
    throw new Error(
      `type ratchet failed:\n${violations.map((v) => `- ${v}`).join("\n")}\n` +
        "New code lands with zero new `as`/`!` — fix the type model, or narrow through a runtime validator. " +
        "An override requires an explicit baseline edit and a named justification in the PR body.",
    );
  }
  const slack = collectSlack(current, baseline);
  if (slack.length > 0) {
    throw new Error(
      `type ratchet can tighten:\n${slack.map((s) => `- ${s}`).join("\n")}\n` +
        `Run ${WRITE_COMMAND} and commit the tightened baseline in the same change.`,
    );
  }
  return { files: current.size, ...totals(current), wrote: false };
}

function collectViolations(current, baseline) {
  const violations = [];
  for (const [path, counts] of current) {
    const ceiling = baseline.get(path) ?? { as: 0, nonNull: 0 };
    if (counts.as > ceiling.as) {
      violations.push(`${path}: as-assertions grew from ${ceiling.as} to ${counts.as}`);
    }
    if (counts.nonNull > ceiling.nonNull) {
      violations.push(`${path}: non-null assertions grew from ${ceiling.nonNull} to ${counts.nonNull}`);
    }
  }
  return violations;
}

function collectSlack(current, baseline) {
  const slack = [];
  for (const [path, ceiling] of baseline) {
    const counts = current.get(path);
    if (counts === undefined) {
      slack.push(`${path}: baseline entry is stale (file removed or now debt-free)`);
      continue;
    }
    if (counts.as < ceiling.as) slack.push(`${path}: as-assertions fell from ${ceiling.as} to ${counts.as}`);
    if (counts.nonNull < ceiling.nonNull) {
      slack.push(`${path}: non-null assertions fell from ${ceiling.nonNull} to ${counts.nonNull}`);
    }
  }
  return slack;
}

function totals(files) {
  let asAssertions = 0;
  let nonNull = 0;
  for (const counts of files.values()) {
    asAssertions += counts.as;
    nonNull += counts.nonNull;
  }
  return { asAssertions, nonNull };
}

function parseArguments(args) {
  let root = process.cwd();
  let baselinePath;
  let write = false;
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--write") {
      write = true;
      continue;
    }
    const value = args[index + 1];
    if ((flag !== "--root" && flag !== "--baseline") || value === undefined) {
      throw new Error("usage: check-type-ratchet.mjs [--root <path>] [--baseline <path>] [--write]");
    }
    if (flag === "--root") root = resolve(value);
    else baselinePath = resolve(value);
    index += 1;
  }
  return { root, baselinePath: baselinePath ?? join(root, "scripts", "type-ratchet-baseline.json"), write };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const result = await checkTypeRatchet(options);
  process.stdout.write(
    result.wrote
      ? `Type ratchet baseline written (${result.files} files with debt, ${result.asAssertions} as-assertions, ${result.nonNull} non-null).\n`
      : `Type ratchet passed (${result.files} files with debt, ${result.asAssertions} as-assertions, ${result.nonNull} non-null).\n`,
  );
}

const entrypoint = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (entrypoint === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
