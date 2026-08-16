// Traceability: CF-REG-385 · HB-139 · case-catalog.md §10.3, defect #385
// (owning structure J-02 success/refusal · INV-008 · INV-015 · B-01).

// CF-REG-385 (L1) — the ONE repository-identity rule, and the two surfaces that
// can only ever emit an outward target: the generated guide and GhCliOps.

import { describe, expect, it } from "vitest";
import { GhCliOps } from "../../../src/loop/github.js";
import { renderNextCommandsGuide } from "../../../src/org/new-app-guide.js";
import {
  classifyRepositoryIdentity,
  isRepositoryIdentity,
  parseRepositoryIdentity,
  placeholderRepositorySlug,
  RepositoryIdentityError,
} from "../../../src/runtime/repo-identity.js";

// The exact E2E value, both components of the runbook's sentinel pair, the
// bootstrap fallback literal, and their case/separator/whitespace variants.
const REFUSED: Array<[string, string]> = [
  ["buildstacks-dev/YOUR_APP_REPOSITORY", "placeholder-repository"],
  ["buildstacks-dev/your_app_repository", "placeholder-repository"],
  ["buildstacks-dev/your-app-repository", "placeholder-repository"],
  ["buildstacks-dev/Your.App.Repository", "placeholder-repository"],
  ["YOUR_GITHUB_OWNER_OR_ORG/atlas", "placeholder-owner"],
  ["your-github-owner-or-org/atlas", "placeholder-owner"],
  ["YOUR_GITHUB_OWNER_OR_ORG/YOUR_APP_REPOSITORY", "placeholder-owner"],
  ["OWNER/atlas", "placeholder-owner"],
  ["owner/atlas", "placeholder-owner"],
  ["Owner/atlas", "placeholder-owner"],
  ["acme/REPO", "placeholder-repository"],
  ["acme/repository", "placeholder-repository"],
  ["acme/TODO", "placeholder-repository"],
  ["acme/CHANGEME", "placeholder-repository"],
  ["acme/your-repo-name-here", "placeholder-repository"],
  ["organization/atlas", "placeholder-owner"],
  ["username/atlas", "placeholder-owner"],
  ["", "empty"],
  ["   ", "empty"],
  [" acme/atlas", "malformed-slug"],
  ["acme/atlas ", "malformed-slug"],
  ["acme", "malformed-slug"],
  ["acme/atlas/extra", "malformed-slug"],
  ["/atlas", "invalid-owner"],
  ["acme/", "invalid-repository"],
  ["https://github.com/acme/atlas", "malformed-slug"],
  ["git@github.com:acme/atlas", "invalid-owner"],
  ["../acme/atlas", "malformed-slug"],
  ["-acme/atlas", "invalid-owner"],
  ["acme-/atlas", "invalid-owner"],
  ["ac me/atlas", "invalid-owner"],
  ["acme/atlas.git", "invalid-repository"],
  ["acme/..", "invalid-repository"],
  ["a_cme/atlas", "invalid-owner"],
];

// The precision half: legitimate slugs that a broad substring ban on "your",
// "owner", "repo", or "app" would wrongly refuse.
const ACCEPTED = [
  "acme/atlas",
  "buildstacks-dev/buildstacks-web",
  "github/docs",
  "acme/app",
  "acme/docs",
  "acme/app-repository-scanner",
  "buildstacks-dev/your-appraisal-service",
  "owner-operator-tools/repo-insights",
  "your-story-inc/story-engine",
  "someone-else/other-repo",
  "cormidia/Cormidia",
  "o/alpha",
  "a1/b2",
  "local/atlas",
];

describe("CF-REG-385 — repository identity is decided in exactly one place", () => {
  it.each(REFUSED)("refuses %s as %s", (value, code) => {
    const result = classifyRepositoryIdentity(value);
    expect(isRepositoryIdentity(result)).toBe(false);
    if (isRepositoryIdentity(result)) return;
    expect(result.code).toBe(code);
    expect(result.remediation).toContain("exact owner/repo slug");
    expect(() => parseRepositoryIdentity(value, "probe")).toThrow(RepositoryIdentityError);
  });

  it.each(ACCEPTED)("accepts the legitimate slug %s unchanged", (value) => {
    const result = classifyRepositoryIdentity(value);
    expect(isRepositoryIdentity(result)).toBe(true);
    if (!isRepositoryIdentity(result)) return;
    // Byte-preserving: the accepted slug is what later commands emit.
    expect(result.slug).toBe(value);
    expect(`${result.owner}/${result.repository}`).toBe(value);
  });

  it("refuses non-string identities instead of stringifying them", () => {
    for (const value of [undefined, null, 42, {}, ["acme/atlas"]]) {
      const result = classifyRepositoryIdentity(value);
      expect(isRepositoryIdentity(result)).toBe(false);
      if (!isRepositoryIdentity(result)) expect(result.code).toBe("not-a-string");
    }
  });

  it("marks the bootstrap no-remote fallback as the one non-actionable literal", () => {
    const slug = placeholderRepositorySlug("atlas");
    expect(slug).toBe("OWNER/atlas");
    const result = classifyRepositoryIdentity(slug);
    expect(isRepositoryIdentity(result)).toBe(false);
    if (!isRepositoryIdentity(result)) expect(result.code).toBe("placeholder-owner");
  });

  it("seeded negative control: the pre-fix shape regex accepted every refused placeholder", () => {
    // This is the rule #385 replaced. It is asserted here so the detector fires
    // against the real defect rather than against a rule nobody shipped.
    const preFix = (value: string) => /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value);
    const placeholdersThePreFixRuleAccepted = REFUSED.filter(
      ([, code]) => code === "placeholder-owner" || code === "placeholder-repository",
    ).filter(([value]) => preFix(value));
    expect(placeholdersThePreFixRuleAccepted.length).toBe(
      REFUSED.filter(([, code]) => code.startsWith("placeholder-")).length,
    );
    expect(placeholdersThePreFixRuleAccepted.map(([value]) => value)).toContain("buildstacks-dev/YOUR_APP_REPOSITORY");
  });
});

describe("CF-REG-385 — no outward surface can emit an unresolved target", () => {
  const guide = (repoSlug: string) =>
    renderNextCommandsGuide({
      appName: "atlas",
      repoSlug,
      targetDir: "/work/atlas",
      goal: "deliver one observable atlas milestone",
      template: "bare",
      packageRoot: "/pkg/cormidia",
      orgHome: "/org/cormidia",
      stateHome: "/state/cormidia",
      setupCommand: null,
      testCommand: null,
      lintCommand: null,
    });

  it("refuses to render the generated guide for a placeholder identity", () => {
    expect(() => guide("buildstacks-dev/YOUR_APP_REPOSITORY")).toThrow(RepositoryIdentityError);
    expect(() => guide("OWNER/atlas")).toThrow(/new-app guide/);
  });

  it("renders the exact resolved identity everywhere, with no operator mass-edit step", () => {
    const rendered = guide("buildstacks-dev/buildstacks-web");
    for (const command of [
      "gh repo create 'buildstacks-dev/buildstacks-web'",
      "gh pr list --repo 'buildstacks-dev/buildstacks-web'",
      "gh issue list --repo 'buildstacks-dev/buildstacks-web'",
    ]) {
      expect(rendered).toContain(command);
    }
    // Immutable onboarding identities carry no operator-substitution step; the
    // remaining `<…>` inputs are later runtime values (a not-yet-existing PR
    // number, an authoritative corpus path), which legitimately stay explicit.
    expect(rendered).not.toMatch(/YOUR_|<owner\/|<repo>|<app-repo|OWNER\//i);
    expect(rendered).not.toMatch(/^.*--repo '(?!buildstacks-dev\/buildstacks-web')/m);
  });

  it("refuses to construct a GitHub command surface bound to a placeholder", () => {
    expect(() => new GhCliOps("buildstacks-dev/YOUR_APP_REPOSITORY")).toThrow(RepositoryIdentityError);
    expect(() => new GhCliOps("OWNER/atlas")).toThrow(/github/);
    // ...and the injected-executor path is guarded identically, so a double can
    // never prove behavior the product would refuse in production.
    expect(() => new GhCliOps("OWNER/atlas", async () => ({ stdout: "", stderr: "", exitCode: 0 }))).toThrow(
      RepositoryIdentityError,
    );
    expect(new GhCliOps("buildstacks-dev/buildstacks-web").repo).toBe("buildstacks-dev/buildstacks-web");
  });
});
