// The ONE place any surface decides whether an owner/repo slug is a concrete,
// deliberately chosen external-action target (#385). Onboarding accepted
// `buildstacks-dev/YOUR_APP_REPOSITORY` because a one-line shape regex is not
// an identity check: it persisted into apps.yaml and .cormidia/config.yaml and
// was emitted into executable `gh` commands. Parse, don't cast — every caller
// gets a validated value or a typed rejection; nobody re-derives the rule.

/** A validated, placeholder-free GitHub action target. */
export interface RepositoryIdentity {
  /** The exact accepted slug, preserved byte-for-byte for command emission. */
  readonly slug: string;
  readonly owner: string;
  readonly repository: string;
}

export type RepositoryIdentityCode =
  | "not-a-string"
  | "empty"
  | "malformed-slug"
  | "invalid-owner"
  | "invalid-repository"
  | "placeholder-owner"
  | "placeholder-repository";

/** Why a value may not be used as an external-action target. */
export interface RepositoryIdentityRejection {
  readonly code: RepositoryIdentityCode;
  /** What was inspected, rendered for the operator (never re-emitted as a target). */
  readonly value: string;
  readonly component: "slug" | "owner" | "repository";
  readonly detail: string;
  readonly remediation: string;
}

export class RepositoryIdentityError extends Error {
  readonly rejection: RepositoryIdentityRejection;

  constructor(context: string, rejection: RepositoryIdentityRejection) {
    super(`${context}: ${rejection.detail}`);
    this.name = "RepositoryIdentityError";
    this.rejection = rejection;
  }
}

// GitHub login rule: 1-39 chars, alphanumeric with single internal hyphens.
const OWNER_SHAPE = /^[A-Za-z\d](?:[A-Za-z\d]|-(?=[A-Za-z\d])){0,38}$/;
// GitHub repository rule: ASCII alphanumerics plus `.`, `-`, `_`, and at least
// one alphanumeric so `---` or `..` can never pass as a chosen name.
const REPOSITORY_SHAPE = /^(?=.*[A-Za-z0-9])[A-Za-z0-9_.-]{1,100}$/;

// Tokens that occur in documentation sentinels and are meaningless as an
// identity on their own. A component is a placeholder only when EVERY token is
// drawn from this list, so `acme/app-repository-scanner` (SCANNER is real
// vocabulary) and `github/docs` stay concrete.
const PLACEHOLDER_TOKENS = new Set([
  "YOUR",
  "YOURS",
  "OWNER",
  "OWNERS",
  "ORG",
  "ORGANIZATION",
  "USER",
  "USERNAME",
  "ACCOUNT",
  "HANDLE",
  "LOGIN",
  "REPO",
  "REPOSITORY",
  "PROJECT",
  "APP",
  "APPLICATION",
  "NAME",
  "SLUG",
  "GITHUB",
  "EXAMPLE",
  "PLACEHOLDER",
  "TODO",
  "TBD",
  "CHANGEME",
  "FIXME",
  "XXX",
  "HERE",
  "GOES",
  "OR",
  "AND",
  "INSERT",
  "REPLACE",
  "ENTER",
  "SET",
]);

// A single-token component is ambiguous: `github`, `app`, and `docs` are all
// real GitHub names. Only tokens that cannot plausibly stand alone as a chosen
// identity are refused on their own — this is what keeps the rule from being a
// broad substring ban.
const SINGLE_TOKEN_PLACEHOLDERS = new Set([
  "YOUR",
  "YOURS",
  "OWNER",
  "OWNERS",
  "REPO",
  "REPOSITORY",
  "USERNAME",
  "ORGANIZATION",
  "PLACEHOLDER",
  "TODO",
  "TBD",
  "CHANGEME",
  "FIXME",
  "XXX",
]);

const CONCRETE_REMEDIATION =
  "supply the exact owner/repo slug of the repository this app will really use; " +
  "an unresolved template value is never a valid target";

/**
 * The marked, deliberately non-actionable slug recorded when an app is
 * registered before its remote exists. It is a single literal so no surface can
 * invent its own, and it is refused by every outward path by construction.
 */
export function placeholderRepositorySlug(appName: string): string {
  return `OWNER/${appName}`;
}

/** Non-throwing classification. Surfaces that must report rather than crash —
 * dry-run previews, verification checks — read the rejection directly. */
export function classifyRepositoryIdentity(value: unknown): RepositoryIdentity | RepositoryIdentityRejection {
  if (typeof value !== "string") {
    return reject("not-a-string", String(value), "slug", `repository identity must be a string, got ${typeof value}`);
  }
  if (value.trim().length === 0) {
    return reject("empty", value, "slug", "repository identity is empty or whitespace only");
  }
  if (value !== value.trim()) {
    return reject("malformed-slug", value, "slug", `repository slug "${value}" has surrounding whitespace`);
  }
  const parts = value.split("/");
  const owner = parts.length === 2 ? parts[0] : undefined;
  const repository = parts.length === 2 ? parts[1] : undefined;
  if (owner === undefined || repository === undefined) {
    return reject("malformed-slug", value, "slug", `repository slug "${value}" is not exactly one owner/repo pair`);
  }
  // Placeholder before shape, per component: `YOUR_GITHUB_OWNER_OR_ORG` is
  // also an invalid GitHub login, and "unresolved placeholder" is the answer
  // the operator can act on.
  if (isPlaceholderComponent(owner)) {
    return reject(
      "placeholder-owner",
      value,
      "owner",
      `owner "${owner}" is an unresolved placeholder, not a chosen identity`,
    );
  }
  if (!OWNER_SHAPE.test(owner)) {
    return reject("invalid-owner", value, "owner", `"${owner}" is not a valid GitHub owner or organization name`);
  }
  if (isPlaceholderComponent(repository)) {
    return reject(
      "placeholder-repository",
      value,
      "repository",
      `repository "${repository}" is an unresolved placeholder, not a chosen identity`,
    );
  }
  if (!REPOSITORY_SHAPE.test(repository) || repository === "." || repository === ".." || /\.git$/i.test(repository)) {
    return reject("invalid-repository", value, "repository", `"${repository}" is not a valid GitHub repository name`);
  }
  return { slug: value, owner, repository };
}

/** True when classification produced an identity rather than a rejection. */
export function isRepositoryIdentity(
  result: RepositoryIdentity | RepositoryIdentityRejection,
): result is RepositoryIdentity {
  return Object.hasOwn(result, "slug");
}

/** Parse-don't-cast entry point: a validated identity or a typed throw. Used at
 * every outward seam so a contaminated legacy record fails before the network. */
export function parseRepositoryIdentity(value: unknown, context: string): RepositoryIdentity {
  const result = classifyRepositoryIdentity(value);
  if (isRepositoryIdentity(result)) return result;
  throw new RepositoryIdentityError(context, result);
}

function isPlaceholderComponent(component: string): boolean {
  const tokens = component
    .toUpperCase()
    .split(/[-._]+/)
    .filter((token) => token.length > 0);
  const first = tokens[0];
  // No tokens at all is a shape problem (`""`, `".."`, `"---"`), not an
  // unresolved sentinel — let the shape rules name it precisely.
  if (first === undefined) return false;
  if (tokens.length === 1) return SINGLE_TOKEN_PLACEHOLDERS.has(first);
  return tokens.every((token) => PLACEHOLDER_TOKENS.has(token));
}

function reject(
  code: RepositoryIdentityCode,
  value: string,
  component: RepositoryIdentityRejection["component"],
  detail: string,
): RepositoryIdentityRejection {
  return { code, value, component, detail, remediation: CONCRETE_REMEDIATION };
}
