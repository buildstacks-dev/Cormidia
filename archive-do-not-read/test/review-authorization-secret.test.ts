import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveReviewAuthorizationSecret,
  reviewAuthorizationSecretPath,
} from "../src/org/review-authorization-secret.js";
import { makeOrgHome } from "./fixtures/orgHome.js";

describe("durable review authorization secret", () => {
  it("publishes one race-safe 0600 state secret and reuses it", async () => {
    const home = makeOrgHome();
    try {
      const secrets = await Promise.all(
        Array.from({ length: 8 }, () => resolveReviewAuthorizationSecret(home.root)),
      );
      expect(new Set(secrets).size).toBe(1);
      expect(secrets[0]).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const path = reviewAuthorizationSecretPath(home.root);
      const stat = lstatSync(path);
      expect(stat.isFile()).toBe(true);
      expect(stat.nlink).toBe(1);
      expect(stat.mode & 0o777).toBe(0o600);
      await expect(resolveReviewAuthorizationSecret(home.root)).resolves.toBe(secrets[0]);
    } finally {
      home.cleanup();
    }
  });

  it("keeps dry-run read-only and preserves the explicit environment override", async () => {
    const home = makeOrgHome();
    try {
      const path = reviewAuthorizationSecretPath(home.root);
      await expect(resolveReviewAuthorizationSecret(home.root, { dryRun: true }))
        .resolves.toBeUndefined();
      expect(existsSync(path)).toBe(false);
      await expect(resolveReviewAuthorizationSecret(home.root, {
        dryRun: true,
        environmentSecret: "explicit-compatibility-secret",
      })).resolves.toBe("explicit-compatibility-secret");
      expect(existsSync(path)).toBe(false);
    } finally {
      home.cleanup();
    }
  });

  it("rejects a symlink instead of following it", async () => {
    const home = makeOrgHome();
    try {
      const path = reviewAuthorizationSecretPath(home.root);
      mkdirSync(dirname(path), { recursive: true });
      const outside = `${path}.outside`;
      writeFileSync(outside, `${"a".repeat(43)}\n`, { mode: 0o600 });
      symlinkSync(outside, path);
      await expect(resolveReviewAuthorizationSecret(home.root)).rejects.toThrow(/must not be a symlink/);
    } finally {
      home.cleanup();
    }
  });

  it("rejects hard links, unsafe modes, and corrupt contents", async () => {
    const linkedHome = makeOrgHome();
    try {
      const path = reviewAuthorizationSecretPath(linkedHome.root);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${"a".repeat(43)}\n`, { mode: 0o600 });
      linkSync(path, `${path}.copy`);
      await expect(resolveReviewAuthorizationSecret(linkedHome.root)).rejects.toThrow(/must not have hard links/);
    } finally {
      linkedHome.cleanup();
    }
    for (const invalid of [
      { mode: 0o644, body: `${"a".repeat(43)}\n`, error: /permissions are unsafe/ },
      { mode: 0o600, body: "not-a-generated-secret\n", error: /is corrupt/ },
    ]) {
      const invalidHome = makeOrgHome();
      try {
        const path = reviewAuthorizationSecretPath(invalidHome.root);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, invalid.body, { mode: invalid.mode });
        chmodSync(path, invalid.mode);
        await expect(resolveReviewAuthorizationSecret(invalidHome.root)).rejects.toThrow(invalid.error);
      } finally {
        invalidHome.cleanup();
      }
    }
  });
});
