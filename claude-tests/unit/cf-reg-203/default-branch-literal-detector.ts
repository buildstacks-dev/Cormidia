// The restored default-branch literal scanner (detector for CF-REG-203-G).
//
// AGENTS.md carries a standing rule — "Never hardcode a default branch. Resolve
// with `resolveRemoteDefaultBranch()` … and thread the resulting `BaseRevision`
// through" — and notes that the literal scanner which used to enforce it was
// frozen with the legacy suite, leaving the rule guarded by nothing. #203 is
// the third breach of that rule's spirit (#60, #101 were the first two), so the
// guard comes back with the fix.
//
// Scope, deliberately narrow so it can be trusted rather than muted: a source
// file must not contain a literal naming a default branch in a git-ref
// position. Prose is not code — comments carry most of this repo's institutional
// memory ABOUT the scar and must stay quotable — so comments and JSDoc are
// stripped before scanning, and only whole-value string literals and
// unambiguous `origin/<branch>` spellings are flagged.

/** A branch name that must never be written down as a git ref. `master` is
 *  included because a stock `git init` with no `init.defaultBranch` produces it
 *  — hardcoding either name simply picks a different repo to break. */
const RESERVED_BRANCHES = ["main", "master", "trunk"] as const;

export interface DefaultBranchLiteral {
  /** 1-based line number in the ORIGINAL source. */
  line: number;
  /** The offending literal, as written. */
  literal: string;
}

export interface StripOptions {
  /** Also blank the BODY of every template literal (backticks retained).
   *  Needed for the whole-value scan: `<main id="main">` inside a rendered
   *  HTML template is markup, not a git argument. */
  templateBodies?: boolean;
}

/** Replace comment bodies with same-length blank runs so line numbers and
 *  column offsets survive. String literals are left intact — they are
 *  precisely what the scan is looking at.
 *
 *  A real tokenizer would be more faithful, but this repo's dependency budget
 *  is "minimal and boring" (TASTE.md §3) and the failure mode here is benign:
 *  a mis-stripped span can only produce a FALSE POSITIVE, which is a loud
 *  test failure a human reads, never a silent miss. */
export function stripComments(source: string, options: StripOptions = {}): string {
  let out = "";
  let index = 0;
  type Mode = "code" | "line-comment" | "block-comment" | "single" | "double" | "template";
  let mode: Mode = "code";
  const blank = (text: string): string => text.replace(/[^\n]/g, " ");

  while (index < source.length) {
    const rest = source.slice(index);
    if (mode === "code") {
      if (rest.startsWith("//")) {
        const end = source.indexOf("\n", index);
        const stop = end === -1 ? source.length : end;
        out += blank(source.slice(index, stop));
        index = stop;
        continue;
      }
      if (rest.startsWith("/*")) {
        const end = source.indexOf("*/", index + 2);
        const stop = end === -1 ? source.length : end + 2;
        out += blank(source.slice(index, stop));
        index = stop;
        continue;
      }
      const char = source[index]!;
      if (char === '"') mode = "double";
      else if (char === "'") mode = "single";
      else if (char === "`") mode = "template";
      out += char;
      index += 1;
      continue;
    }
    const char = source[index]!;
    if (char === "\\") {
      out += source.slice(index, index + 2);
      index += 2;
      continue;
    }
    if (
      (mode === "double" && char === '"') ||
      (mode === "single" && char === "'") ||
      (mode === "template" && char === "`")
    ) {
      mode = "code";
      out += char;
      index += 1;
      continue;
    }
    out += mode === "template" && options.templateBodies === true ? blank(char) : char;
    index += 1;
  }
  return out;
}

/** Every hardcoded default-branch literal in one source file.
 *
 *  Two shapes are flagged:
 *  1. a quoted string whose ENTIRE value is a reserved branch name — the
 *     `git("fetch", "origin", "main")` / `base: "master"` shape;
 *  2. the substring `origin/<reserved>` anywhere in a string or template
 *     literal — the `origin/main` remote-tracking ref that #101 removed and
 *     that has no correct hardcoded form.
 *
 *  A whole-value match is required for shape 1 so ordinary prose inside a
 *  bigger string ("the remote default branch") and unrelated HTML (`<main
 *  id="main">` inside a rendered template) are not swept up. */
export function findDefaultBranchLiterals(source: string): DefaultBranchLiteral[] {
  const names = RESERVED_BRANCHES.join("|");
  // Shape 1 is scanned with template bodies blanked; shape 2 keeps them,
  // because `origin/main` inside a template really is a git ref.
  const withTemplates = stripComments(source);
  const scans: Array<{ text: string; pattern: RegExp }> = [
    // Quoted whole-value, template bodies blanked: `<main id="main">` inside a
    // rendered HTML template is markup, not a git argument.
    {
      text: stripComments(source, { templateBodies: true }),
      pattern: new RegExp(`(['"])(${names})\\1`, "g"),
    },
    // Backtick whole-value: a template containing ONLY the branch name is a
    // git argument written the long way, and must not be a blind spot.
    { text: withTemplates, pattern: new RegExp("`(" + names + ")`", "g") },
    // The remote-tracking ref #101 removed; genuine inside templates too.
    { text: withTemplates, pattern: new RegExp(`origin/(${names})\\b`, "g") },
  ];
  const found: DefaultBranchLiteral[] = [];

  for (const { text, pattern } of scans) {
    const lineOf = (offset: number): number => {
      let line = 1;
      for (let i = 0; i < offset; i += 1) if (text[i] === "\n") line += 1;
      return line;
    };
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      found.push({ line: lineOf(match.index), literal: match[0] });
    }
  }
  return found.sort((left, right) => left.line - right.line || left.literal.localeCompare(right.literal));
}
