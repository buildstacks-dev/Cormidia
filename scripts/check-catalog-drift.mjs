#!/usr/bin/env node

// Validation-authority drift gate (HB-140, CF-HARNESS-CI, #465).
//
// Before #465 cutover, the legacy YAML must regenerate byte-identically from
// its authored Markdown. As soon as any checked-model file exists, fallback is
// forbidden: all eight model files must exist, legacy root authority/tooling
// must be absent, and the public compiler must accept the model and generated
// views with zero diagnostics. Partial, corrupt, stale, or empty state is red.

import { spawn } from "node:child_process";
import { lstat, readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertCanonicalCompilerReport, COMPILER_REPORT } from "./lib/checked-model-compiler-report.mjs";

const REGENERATION_COMMAND =
  "awk -f validation-design/case-catalog-generator.awk " +
  "validation-design/case-catalog.md validation-design/harness-backlog.md " +
  "> validation-design/case-catalog.yaml";

const INPUTS = ["case-catalog-generator.awk", "case-catalog.md", "harness-backlog.md"];
const COMMITTED = "case-catalog.yaml";
const MODEL_FILES = [
  "project.yaml",
  "owners.yaml",
  "sources.yaml",
  "structures.yaml",
  "policy.yaml",
  "controls.yaml",
  "families.yaml",
  "backlog.yaml",
];
const GENERATED_VIEWS = [
  "case-catalog.md",
  "harness-backlog.md",
  "owner-briefing.md",
  "owner-backlog.md",
  "planned-trace.md",
];
const GENERATED_ARTIFACTS = [...GENERATED_VIEWS, COMPILER_REPORT];
const FORBIDDEN_MODEL_MODE_FILES = ["validation-policy.yaml", "case-catalog.yaml", "case-catalog-generator.awk"];
const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const architectCli = join(scriptRoot, "node_modules", ".bin", "validation-architect");

async function readRequired(path) {
  try {
    return await readFile(path);
  } catch (error) {
    throw new Error(`catalog drift check is fail-closed on a missing or unreadable file: ${path}: ${String(error)}`);
  }
}

async function exists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw new Error(`catalog drift check cannot inspect authority file ${path}: ${String(error)}`);
  }
}

async function run(command, args) {
  return await new Promise((resolveResult, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) =>
      resolveResult({
        exitCode: code ?? -1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      }),
    );
  });
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

async function checkModelDrift(root, designRoot, present) {
  if (present.length !== MODEL_FILES.length) {
    const missing = MODEL_FILES.filter((name) => !present.includes(name));
    throw new Error(
      `checked-model authority selected by ${present.join(", ")}; partial state cannot fall back to legacy authority. ` +
        `Missing: ${missing.join(", ")}.`,
    );
  }
  const modelRoot = join(designRoot, "model");
  for (const [path, name] of [
    [designRoot, "validation-design"],
    [modelRoot, "validation-design/model"],
  ]) {
    let entry;
    try {
      entry = await lstat(path);
    } catch (error) {
      throw new Error(`checked-model drift check cannot inspect ${name}: ${String(error)}`);
    }
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new Error(`checked-model authority requires ${name} to be a regular directory, not a symlink`);
    }
  }
  let entries;
  try {
    entries = await readdir(modelRoot, { withFileTypes: true });
  } catch (error) {
    throw new Error(`checked-model drift check cannot inventory ${modelRoot}: ${String(error)}`);
  }
  const expected = new Set(MODEL_FILES);
  const unexpected = entries.filter((entry) => !expected.has(entry.name)).map((entry) => entry.name);
  const unsafe = entries.filter((entry) => expected.has(entry.name) && !entry.isFile()).map((entry) => entry.name);
  if (unexpected.length > 0 || unsafe.length > 0) {
    throw new Error(
      "checked-model authority must contain exactly the eight regular model files; " +
        `unexpected entries: ${unexpected.sort().join(", ") || "none"}; ` +
        `unsafe expected entries: ${unsafe.sort().join(", ") || "none"}.`,
    );
  }
  const forbidden = [];
  for (const name of FORBIDDEN_MODEL_MODE_FILES) {
    if (await exists(join(designRoot, name))) forbidden.push(name);
  }
  if (forbidden.length > 0) {
    throw new Error(
      `checked-model authority refuses legacy root authority: ${forbidden.join(", ")}. ` +
        "Move historical inputs and tooling under validation-design/migration/legacy; " +
        "generated Markdown views remain at the root.",
    );
  }
  const unsafeArtifacts = [];
  for (const name of GENERATED_ARTIFACTS) {
    const path = join(designRoot, name);
    let entry;
    try {
      entry = await lstat(path);
    } catch (error) {
      throw new Error(`checked-model drift check cannot inspect generated artifact ${path}: ${String(error)}`);
    }
    if (!entry.isFile() || entry.isSymbolicLink()) unsafeArtifacts.push(name);
  }
  if (unsafeArtifacts.length > 0) {
    throw new Error(
      `checked-model generated artifacts must be regular non-symlink files: ${unsafeArtifacts.sort().join(", ")}`,
    );
  }
  let compiled;
  try {
    compiled = await run(architectCli, ["compile", root]);
  } catch (error) {
    throw new Error(`checked-model drift check could not start the public validation-architect CLI: ${String(error)}`);
  }
  if (compiled.exitCode !== 0 || compiled.stderr !== "") {
    throw new Error(
      `checked-model drift check failed: public compiler exited ${compiled.exitCode} or emitted diagnostics.\n` +
        `${compiled.stderr}${compiled.stdout}`,
    );
  }
  const accepted = /^accepted: model ([a-f0-9]{64}) at revision ([a-f0-9]{40})$/.exec(compiled.stdout.trim());
  if (accepted === null) {
    throw new Error(`checked-model drift check received unexpected public compiler output:\n${compiled.stdout}`);
  }
  const revision = accepted[2];
  await assertCanonicalCompilerReport({
    designRoot,
    modelRoot,
    modelFiles: MODEL_FILES,
    views: GENERATED_VIEWS,
    revision,
    identity: accepted[1],
  });
  return { mode: "checked-model", identity: accepted[1], revision };
}

async function checkLegacyDrift(designRoot) {
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

  return { mode: "legacy", families, tickets, bytes: committed.length };
}

export async function checkCatalogDrift(root) {
  const designRoot = join(root, "validation-design");
  const modelRoot = join(designRoot, "model");
  const present = [];
  for (const name of MODEL_FILES) {
    if (await exists(join(modelRoot, name))) present.push(name);
  }
  return present.length > 0 ? await checkModelDrift(root, designRoot, present) : await checkLegacyDrift(designRoot);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1) throw new Error("usage: check-catalog-drift.mjs [root]");
  const root = resolve(args[0] ?? process.cwd());
  const result = await checkCatalogDrift(root);
  if (result.mode === "checked-model") {
    process.stdout.write(
      `Checked-model drift check passed (model ${result.identity}, revision ${result.revision}; ` +
        "all eight model files and six generated artifacts are compiler-clean).\n",
    );
  } else {
    process.stdout.write(
      `Catalog drift check passed (case-catalog.yaml matches its regeneration: ${result.families} families, ${result.tickets} tickets, ${result.bytes} bytes).\n`,
    );
  }
}

const entrypoint = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (entrypoint === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
