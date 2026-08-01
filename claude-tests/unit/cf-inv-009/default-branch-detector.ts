// The default-branch literal detector (CF-INV-009 structural pin, HB-030).
//
// AGENTS.md: "Never hardcode a default branch. Resolve with
// `resolveRemoteDefaultBranch()` … and thread the resulting `BaseRevision`
// through." The scanner that enforced this was frozen with the legacy suite;
// this is its replacement, and #203 is the reason it covers more than
// `origin/main`.
//
// AST-based, deliberately. A regex over source text cannot tell a git argument
// from an HTML landmark (`<main id="main">` in a rendered template) or from the
// prose that carries this repo's memory of #60/#101 — and that memory must stay
// quotable, so comments are structurally out of scope here rather than stripped
// by hand.
//
// Exported as a pure function over (path, source) so the negative control can
// seed a violation and prove the detector FIRES. A structural guard whose sweep
// over a clean tree is its only exercise is an assumption, not a test.

import ts from "typescript";

/** Branch names that must never be written down as a git ref.
 *
 *  `master` and `trunk` are here with `main` because hardcoding any of them
 *  simply picks a different repository to break: a stock `git init` with no
 *  `init.defaultBranch` produces `master`, which is precisely the repo that
 *  crashed its first tick in #101. */
export const RESERVED_DEFAULT_BRANCHES = ["main", "master", "trunk"] as const;

/** Property names whose value is consequentially a base/branch decision. */
const CONSEQUENTIAL_PROPERTIES = ["base", "baseBranch", "baseRefName", "defaultBranch", "ref"];

function isReserved(text: string): boolean {
  return (RESERVED_DEFAULT_BRANCHES as readonly string[]).includes(text);
}

/** `origin/<reserved>` anywhere inside a string literal's VALUE — not just as
 *  the whole value. The shape that matters is often embedded: a diff range
 *  (`origin/main...HEAD`) or a rev spec (`origin/main^{commit}`) is the same
 *  guessed base as the bare ref. Matching on the literal's parsed text, rather
 *  than on source bytes, is what keeps comments and template markup out. */
const REMOTE_TRACKING = new RegExp(
  `(^|[^\\w./-])origin/(${RESERVED_DEFAULT_BRANCHES.join("|")})(?![\\w-])`,
);

function remoteTrackingRefIn(text: string): string | undefined {
  const match = REMOTE_TRACKING.exec(text);
  return match === null ? undefined : `origin/${match[2]}`;
}

/** True when this call is a git invocation, so a bare `"main"` among its
 *  arguments is a ref rather than an unrelated string. Matches the shapes this
 *  repo actually uses: the local `git(cwd, ...args)` helpers and
 *  `execFileSync("git", [...])`. */
function isGitCall(node: ts.CallExpression): boolean {
  const callee = node.expression;
  const name = ts.isIdentifier(callee)
    ? callee.text
    : ts.isPropertyAccessExpression(callee)
      ? callee.name.text
      : "";
  if (/^git/i.test(name) || /git$/i.test(name)) return true;
  const first = node.arguments[0];
  return first !== undefined && ts.isStringLiteralLike(first) && first.text === "git";
}

/** Every hardcoded default-branch literal in one source file, as
 *  `<path>:<line>: <what>` strings. */
export function defaultBranchViolations(path: string, sourceText: string): string[] {
  const source = ts.createSourceFile(path, sourceText, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const at = (node: ts.Node): number =>
    source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

  const visit = (node: ts.Node): void => {
    // 1. The remote-tracking ref #101 removed. It has no correct hardcoded
    //    form, in any position.
    if (ts.isStringLiteralLike(node)) {
      const ref = remoteTrackingRefIn(node.text);
      if (ref !== undefined) found.push(`${path}:${at(node)}: ${ref}`);
    }
    // 2. A branch name assigned to a consequential property.
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      CONSEQUENTIAL_PROPERTIES.includes(node.name.text) &&
      ts.isStringLiteralLike(node.initializer) &&
      isReserved(node.initializer.text)
    ) {
      found.push(`${path}:${at(node)}: ${node.name.text}=${node.initializer.text}`);
    }
    // 3. A branch name passed straight to git — `git(dir, "checkout", "main")`
    //    and `execFileSync("git", ["fetch", "origin", "main"])`.
    if (ts.isCallExpression(node) && isGitCall(node)) {
      const literals = node.arguments.flatMap((argument) =>
        ts.isArrayLiteralExpression(argument) ? [...argument.elements] : [argument],
      );
      for (const literal of literals) {
        if (ts.isStringLiteralLike(literal) && isReserved(literal.text)) {
          found.push(`${path}:${at(literal)}: git argument ${literal.text}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...new Set(found)].sort();
}
