import { describe, expect, it } from "vitest";
import { assertGitHubTarget, assertLiveConfirmation } from "../../scripts/eval/safety.js";

describe("external eval safety", () => {
  it("accepts only exact private operon-eval targets", () => {
    expect(() => assertGitHubTarget({ owner: "acme", repo: "operon-eval-c1", isPrivate: true }, { owner: "acme", repo_pattern: "operon-eval-*" })).not.toThrow();
    expect(() => assertGitHubTarget({ owner: "other", repo: "operon-eval-c1", isPrivate: true }, { owner: "acme", repo_pattern: "operon-eval-*" })).toThrow("owner_not_allowlisted");
    expect(() => assertGitHubTarget({ owner: "acme", repo: "production", isPrivate: true }, { owner: "acme", repo_pattern: "operon-eval-*" })).toThrow("repo_not_allowlisted");
    expect(() => assertGitHubTarget({ owner: "acme", repo: "operon-eval-c1", isPrivate: false }, { owner: "acme", repo_pattern: "operon-eval-*" })).toThrow("must_be_private");
  });
  it("requires env, exact id, and a cap no larger than the manifest", () => {
    expect(() => assertLiveConfirmation({ envEnabled: true, campaignId: "c1", confirmedId: "c1", requestedMaxUsd: 10, manifestMaxUsd: 10 })).not.toThrow();
    expect(() => assertLiveConfirmation({ envEnabled: false, campaignId: "c1", confirmedId: "c1", requestedMaxUsd: 10, manifestMaxUsd: 10 })).toThrow("env_not_enabled");
    expect(() => assertLiveConfirmation({ envEnabled: true, campaignId: "c1", confirmedId: "wrong", requestedMaxUsd: 10, manifestMaxUsd: 10 })).toThrow("confirmation_mismatch");
    expect(() => assertLiveConfirmation({ envEnabled: true, campaignId: "c1", confirmedId: "c1", requestedMaxUsd: 11, manifestMaxUsd: 10 })).toThrow("cap_exceeds_manifest");
  });
});
