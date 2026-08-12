#!/usr/bin/env node

// case-catalog.yaml regeneration drift gate (HB-140, CF-HARNESS-CI).
//
// The machine catalog is DERIVED: case-catalog-generator.awk extracts it from
// case-catalog.md + harness-backlog.md, and the two surfaces MUST agree
// (case-catalog.md front matter; traceability convention 5). Agreement held by
// construction until now — this gate makes it enforced: regenerating the YAML
// must be byte-identical to the committed file, so a hand-edit to either
// markdown without rerunning the generator (or a hand-edit to the YAML itself)
// turns the per-commit lane red. The HB-006 artifact-pin discipline applied to
// the machine catalog.
//
// Fail-closed: a missing input, a missing committed YAML, a generator failure,
// generator diagnostics on stderr (MISSING-OWNER/DUPFAM are corpus bugs), and
// an empty extraction walk are all red — never green by absence.

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REGENERATION_COMMAND =
  "awk -f validation-design/case-catalog-generator.awk " +
  "validation-design/case-catalog.md validation-design/harness-backlog.md " +
  "> validation-design/case-catalog.yaml";

const INPUTS = ["case-catalog-generator.awk", "case-catalog.md", "harness-backlog.md"];
const COMMITTED = "case-catalog.yaml";

async function readRequired(path) {
  try {
    return await readFile(path);
  } catch (error) {
    throw new Error(`catalog drift check is fail-closed on a missing or unreadable file: ${path}: ${String(error)}`);
  }
}

async function regenerate(generatorPath, catalogPath, backlogPath) {
  return await new Promise((resolveResult, reject) => {
    const child = spawn("awk", ["-f", generatorPath, catalogPath, backlogPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => {
      reject(new Error(`catalog drift check could not run awk (is it on PATH?): ${String(error)}`));
    });
    child.on("close", (code) => {
      resolveResult({
        exitCode: code ?? -1,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

function firstDifference(committed, regenerated) {
  const committedLines = committed.toString("utf8").split("\n");
  const regeneratedLines = regenerated.toString("utf8").split("\n");
  const lineCount = Math.max(committedLines.length, regeneratedLines.length);
  for (let index = 0; index < lineCount; index += 1) {
    if (committedLines[index] !== regeneratedLines[index]) {
      return {
        line: index + 1,
        committed: committedLines[index] ?? "<end of file>",
        regenerated: regeneratedLines[index] ?? "<end of file>",
      };
    }
  }
  return { line: 0, committed: "<byte-level difference>", regenerated: "<byte-level difference>" };
}

export async function checkCatalogDrift(root) {
  const designRoot = join(root, "validation-design");
  const [generatorPath, catalogPath, backlogPath] = INPUTS.map((name) => join(designRoot, name));
  for (const path of [generatorPath, catalogPath, backlogPath]) await readRequired(path);
  const committed = await readRequired(join(designRoot, COMMITTED));

  const result = await regenerate(generatorPath, catalogPath, backlogPath);
  if (result.exitCode !== 0) {
    throw new Error(`catalog drift check failed: the generator exited ${result.exitCode}.\n${result.stderr}`.trimEnd());
  }
  if (result.stderr !== "") {
    throw new Error(
      "catalog drift check failed: the generator reported corpus diagnostics on stderr " +
        "(MISSING-OWNER means an implementable family has no owning backlog ticket; DUPFAM a duplicate family row). " +
        "Fix the markdown corpus — the diagnostics are corpus bugs, not noise:\n" +
        result.stderr.trimEnd(),
    );
  }

  const generated = result.stdout;
  const families = generated
    .toString("utf8")
    .split("\n")
    .filter((line) => line.startsWith("  - {id: CF")).length;
  const tickets = generated
    .toString("utf8")
    .split("\n")
    .filter((line) => line.startsWith("  - {id: HB")).length;
  if (families === 0 || tickets === 0) {
    throw new Error(
      `catalog drift check failed: the regeneration walk came back empty (${families} families, ${tickets} tickets). ` +
        "An empty extraction is never green — the inputs are truncated or the generator is broken.",
    );
  }

  if (!committed.equals(generated)) {
    const difference = firstDifference(committed, generated);
    throw new Error(
      "catalog drift check failed: validation-design/case-catalog.yaml is not byte-identical to its regeneration " +
        `from case-catalog.md + harness-backlog.md (committed ${committed.length} bytes, regenerated ${generated.length} bytes; ` +
        `first difference at line ${difference.line}:\n` +
        `  committed:   ${difference.committed}\n` +
        `  regenerated: ${difference.regenerated}\n` +
        "The YAML is derived — never hand-edit it, and never edit either markdown without regenerating. Run:\n" +
        `  ${REGENERATION_COMMAND}\n` +
        "and commit the regenerated file in the same change.",
    );
  }

  return { families, tickets, bytes: committed.length };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1) throw new Error("usage: check-catalog-drift.mjs [root]");
  const root = resolve(args[0] ?? process.cwd());
  const result = await checkCatalogDrift(root);
  process.stdout.write(
    `Catalog drift check passed (case-catalog.yaml matches its regeneration: ${result.families} families, ${result.tickets} tickets, ${result.bytes} bytes).\n`,
  );
}

const entrypoint = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (entrypoint === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
