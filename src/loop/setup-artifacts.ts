// Detection of unresolved setup artifacts a tool left in a ticket worktree
// (ISSUE-029). Loop layer, pure fs + string scanning: no subprocess, no adapter,
// no org imports.
//
// The failure this exists for: pnpm 11, unable to ask whether a dependency's
// install script may run, writes the question into `pnpm-workspace.yaml` as
//
//     allowBuilds:
//       esbuild: set this to true or false
//       sharp: set this to true or false
//
// and fails. A builder that answers by appending its own `allowBuilds:` block
// leaves the file with a duplicated mapping key, which YAML forbids — so every
// later pnpm invocation dies at `[ERROR] duplicated mapping key (4:1)` before
// install, before tests, before lint. The tool needed to repair the file is the
// tool the file disables. `test/fixtures/setup-artifacts/issue-029-pnpm-workspace.yaml`
// is the real captured file, byte for byte.
//
// Both states are *setup* failures with a known remedy, not opaque build
// failures. `src/runtime/non-interactive-env.ts` prevents the placeholder on the
// default path; this module is the backstop that names the cause and the remedy
// when something reaches it anyway (an explicit `--no-ignore-scripts` opt-in, a
// pnpm invocation the builder composed itself, or a tree that arrived corrupt).

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Package-manager configuration files a tool may rewrite, relative to the
 *  worktree root. Deliberately a fixed root-level list: the scan runs on every
 *  setup gate and must stay O(a few files), never a tree walk. */
export const SCANNED_SETUP_FILES = [
  "pnpm-workspace.yaml",
  "pnpm-workspace.yml",
  "package.json",
  ".npmrc",
  ".yarnrc.yml",
] as const;

/** Files whose duplicate mapping keys are a hard parse error. */
const YAML_FILES = new Set<string>(["pnpm-workspace.yaml", "pnpm-workspace.yml", ".yarnrc.yml"]);

/** Literal text a tool writes when it needed an answer and could not ask.
 *  Matching is exact-substring and case-insensitive — a marker is a fixed
 *  string emitted by a program, never a phrase a human would type by accident. */
export const UNRESOLVED_SETUP_MARKERS: readonly UnresolvedMarker[] = [
  {
    text: "set this to true or false",
    tool: "pnpm",
    what: "an unanswered dependency build decision",
    remedy:
      "replace each `set this to true or false` with an explicit `true` or `false` in a " +
      "single `allowBuilds` mapping, then re-run the setup command. Operon's sandbox " +
      "denies dependency build scripts by default (PNPM_CONFIG_IGNORE_SCRIPTS=true); a " +
      "dependency that genuinely needs its install script must opt in through the app's " +
      "setup_command, not by answering this placeholder",
  },
];

export interface UnresolvedMarker {
  text: string;
  tool: string;
  what: string;
  remedy: string;
}

export type SetupArtifactKind = "unresolved-marker" | "duplicate-mapping-key";

/** One unusable-tree finding. `cause` and `remedy` are the whole point: the
 *  gate reports these instead of a raw parser error three attempts later. */
export interface SetupArtifact {
  kind: SetupArtifactKind;
  /** Worktree-relative path — named in the failure so the fix is unambiguous. */
  file: string;
  /** 1-based line of the offending text. */
  line: number;
  cause: string;
  remedy: string;
}

/** Scan a worktree's package-manager configuration for unresolved markers and
 *  duplicated YAML mapping keys. Missing and unreadable files are simply not
 *  findings — this never throws, and a clean tree returns an empty array. */
export function scanSetupArtifacts(worktree: string): SetupArtifact[] {
  const artifacts: SetupArtifact[] = [];
  for (const file of SCANNED_SETUP_FILES) {
    const text = readIfSmallFile(join(worktree, file));
    if (text === undefined) continue;
    artifacts.push(...markerArtifacts(file, text));
    if (YAML_FILES.has(file)) artifacts.push(...duplicateKeyArtifacts(file, text));
  }
  return artifacts;
}

/** One-line summary plus the per-artifact cause/remedy lines, in the shape the
 *  gate's `detail` / `outputTail` want.
 *
 *  `when` distinguishes the two real situations, because they call for different
 *  reading: `before` means the worktree arrived unusable and the setup command
 *  was never run (running it would only reproduce the tool's own parse error);
 *  `after` means the setup command itself is what left the artifact behind. */
export function describeSetupArtifacts(
  artifacts: readonly SetupArtifact[],
  when: "before" | "after" = "before",
): { detail: string; evidence: string } {
  const files = [...new Set(artifacts.map((artifact) => artifact.file))];
  const kinds = [...new Set(artifacts.map((artifact) => artifact.kind))];
  const detail =
    `setup failed: ${describeKinds(kinds)} in ${files.join(", ")} — ` +
    (when === "before"
      ? "the worktree arrived in a state the setup command's own tooling cannot parse, " +
        "so the command was not run"
      : "the setup command left the worktree in a state it cannot itself repair");
  const evidence = artifacts
    .map(
      (artifact) =>
        `${artifact.file}:${artifact.line} ${artifact.kind}\n  cause: ${artifact.cause}\n  remedy: ${artifact.remedy}`,
    )
    .join("\n");
  return { detail, evidence };
}

function describeKinds(kinds: readonly SetupArtifactKind[]): string {
  const names = kinds.map((kind) =>
    kind === "unresolved-marker" ? "an unresolved tool placeholder" : "a duplicated mapping key",
  );
  return names.join(" and ");
}

// ---------------------------------------------------------------------------
// Unresolved markers
// ---------------------------------------------------------------------------

function markerArtifacts(file: string, text: string): SetupArtifact[] {
  const artifacts: SetupArtifact[] = [];
  const lines = text.split(/\r?\n/);
  for (const marker of UNRESOLVED_SETUP_MARKERS) {
    const needle = marker.text.toLowerCase();
    for (const [index, line] of lines.entries()) {
      if (!line.toLowerCase().includes(needle)) continue;
      artifacts.push({
        kind: "unresolved-marker",
        file,
        line: index + 1,
        cause:
          `${marker.tool} wrote ${marker.what} into ${file} instead of asking — the literal ` +
          `placeholder "${marker.text}" is on this line, so the file is not a real answer`,
        remedy: marker.remedy,
      });
      // One finding per marker per file: the remedy is file-wide, and a
      // placeholder block repeats the same string on every entry.
      break;
    }
  }
  return artifacts;
}

// ---------------------------------------------------------------------------
// Duplicated YAML mapping keys
// ---------------------------------------------------------------------------

interface Frame {
  indent: number;
  seen: Map<string, number>;
}

/** Deliberately a conservative line scanner, not a YAML parse: a conforming
 *  parser *rejects* the duplicate rather than reporting it, which is the very
 *  failure being diagnosed. Keys inside sequences and block scalars are not
 *  tracked at all — a missed duplicate is acceptable, a false accusation that
 *  blocks a healthy ticket is not. */
export function duplicateMappingKeys(text: string): Array<{ key: string; line: number; firstLine: number }> {
  const duplicates: Array<{ key: string; line: number; firstLine: number }> = [];
  const frames: Frame[] = [];
  let blockScalarIndent: number | undefined;
  let sequenceIndent: number | undefined;

  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    if (raw.trim() === "" || raw.trimStart().startsWith("#")) continue;
    const indent = raw.length - raw.trimStart().length;

    if (blockScalarIndent !== undefined) {
      if (indent > blockScalarIndent) continue;
      blockScalarIndent = undefined;
    }
    if (sequenceIndent !== undefined) {
      if (indent > sequenceIndent) continue;
      sequenceIndent = undefined;
    }

    const trimmed = raw.trim();
    if (trimmed === "-" || trimmed.startsWith("- ")) {
      sequenceIndent = indent;
      continue;
    }

    const match = /^([^:#]+):(?:\s(.*))?$/.exec(trimmed);
    if (match === null) continue;
    const key = unquote(match[1]!.trim());
    const value = (match[2] ?? "").trim();

    while (frames.length > 0 && frames[frames.length - 1]!.indent > indent) frames.pop();
    if (frames.length === 0 || frames[frames.length - 1]!.indent < indent) {
      frames.push({ indent, seen: new Map() });
    }
    const frame = frames[frames.length - 1]!;
    const firstLine = frame.seen.get(key);
    if (firstLine !== undefined) {
      duplicates.push({ key, line: index + 1, firstLine });
    } else {
      frame.seen.set(key, index + 1);
    }

    if (/^[|>][-+]?\d*$/.test(value)) blockScalarIndent = indent;
  }

  return duplicates;
}

function duplicateKeyArtifacts(file: string, text: string): SetupArtifact[] {
  return duplicateMappingKeys(text).map((duplicate) => ({
    kind: "duplicate-mapping-key" as const,
    file,
    line: duplicate.line,
    cause:
      `${file} defines the mapping key \`${duplicate.key}\` twice (first at line ` +
      `${duplicate.firstLine}, again at line ${duplicate.line}). YAML forbids duplicate ` +
      "mapping keys, so every invocation of the tool that reads this file fails at parse " +
      "time — before install, before tests, before lint — including the invocations that " +
      "would repair it",
    remedy:
      `consolidate ${file} to a single \`${duplicate.key}\` mapping holding one explicit ` +
      "entry per package, delete the superseded block, then re-run the setup command",
  }));
}

function unquote(key: string): string {
  const first = key[0];
  if ((first === '"' || first === "'") && key.length > 1 && key.endsWith(first)) {
    return key.slice(1, -1);
  }
  return key;
}

/** 1 MiB ceiling: these are configuration files, and the scan must never read an
 *  arbitrarily large blob that happens to sit at one of these paths. */
const MAX_SCANNED_BYTES = 1024 * 1024;

function readIfSmallFile(path: string): string | undefined {
  try {
    const stats = statSync(path);
    if (!stats.isFile() || stats.size > MAX_SCANNED_BYTES) return undefined;
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}
