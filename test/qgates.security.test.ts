// Tests the security quality gate in src/loop/qgates.ts.
// Covers changed-file secret scanning with the shared secret-pattern list,
// file:line reporting, binary-file skipping, and clean-diff pass behavior.
// Uses temporary git repos only; no network, auth, real org state, or wall-clock
// time is required.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runSecurityGate } from "../src/loop/qgates.js";
import { makeWorkingRepo, type WorkingRepoFixture } from "./fixtures/gitRepo.js";

const repos: WorkingRepoFixture[] = [];
function repo(): WorkingRepoFixture {
  const r = makeWorkingRepo();
  repos.push(r);
  return r;
}

afterAll(() => {
  for (const r of repos) r.cleanup();
});

describe("runSecurityGate", () => {
  it("flags each shared secret family with file:line matches", () => {
    const r = repo();
    const base = r.head();
    const secret = `sk-${"a1".repeat(20)}`;
    const github = `ghp_${"A2".repeat(18)}`;
    r.commit("add secret fixtures", {
      "openai.env": `OPENAI_API_KEY=${secret}\n`,
      "github.txt": `token in prose: ${github}\n`,
      "aws.txt": "\nAKIAIOSFODNN7EXAMPLE\n",
      "key.pem": "-----BEGIN RSA PRIVATE KEY-----\nMIIB\n-----END RSA PRIVATE KEY-----\n",
      "password.env": 'password = "hunter2hunter2"\n',
    });

    const result = runSecurityGate(r.root, { baseRef: base, headRef: r.head() });

    expect(result.status).toBe("fail");
    expect(result.outputTail).toContain("aws.txt:2 aws-access-key-id");
    expect(result.matches).toBeDefined();
    const families = new Set(result.matches!.map((m) => m.pattern));
    expect(families).toEqual(
      new Set([
        "sk-api-key",
        "github-token",
        "aws-access-key-id",
        "private-key-block",
        "generic-assignment",
      ]),
    );
  });

  it("flags snake_case credential assignments (A-003) and the added credential families (A-007)", () => {
    const r = repo();
    const base = r.head();
    r.commit("add leaked credentials", {
      // A-003: `_` is a word character, so the old \b-anchored generic
      // assignment pattern missed every one of these — they passed this gate.
      ".env": [
        "GITHUB_TOKEN=ghSomeLongOpaqueValue123",
        "DB_PASSWORD=SuperSecretValue123456",
        "export AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        "aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      ].join("\n"),
      // A-007: families that previously had no pattern at all.
      "config.txt": [
        "sk_live_51H8xQ2eZvKYlo2CmPfRkTn0aBcDeFgHiJkLmNoPqRs",
        "xoxb-2334455667-2334455667788-AbCdEfGhIjKlMnOpQrStUvWx",
        "https://hooks.slack.com/services/T0000000/B0000000/XXXXXXXXXXXXXXXXXXXXXXXX",
        `AIzaSyD${"1aB-_2cD".repeat(4)}`,
        "npm_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789",
        "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk",
        "postgres://admin:S3cr3tP4ssw0rd@db.example.com:5432/prod",
      ].join("\n"),
    });

    const result = runSecurityGate(r.root, { baseRef: base, headRef: r.head() });

    expect(result.status).toBe("fail");
    const families = new Set(result.matches!.map((m) => m.pattern));
    for (const family of [
      "generic-assignment",
      "stripe-api-key",
      "slack-token",
      "slack-webhook-url",
      "google-api-key",
      "npm-token",
      "jwt",
      "url-userinfo-credentials",
    ]) {
      expect(families, family).toContain(family);
    }
    // Every leaked line is caught: 4 in .env, 7 in config.txt.
    const lines = new Set(result.matches!.map((m) => `${m.file}:${m.line}`));
    for (let i = 1; i <= 4; i++) expect(lines, `.env:${i}`).toContain(`.env:${i}`);
    for (let i = 1; i <= 7; i++) expect(lines, `config.txt:${i}`).toContain(`config.txt:${i}`);
  });

  it("skips binary files even when matching bytes are present", () => {
    const r = repo();
    const base = r.head();
    writeFileSync(
      join(r.root, "leak.bin"),
      Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(`sk-${"b2".repeat(20)}`)]),
    );
    r.commit("add binary with secret-like bytes");

    const result = runSecurityGate(r.root, { baseRef: base, headRef: r.head() });

    expect(result.status).toBe("pass");
    expect(result.detail).toContain("skipped 1 binary file");
    expect(result.matches).toBeUndefined();
  });

  it("clean diff passes", () => {
    const r = repo();
    const base = r.head();
    r.commit("add clean file", {
      "src/app.ts": "export const tokenCount = 5;\n",
      "docs/notes.md": "Rotate credentials during the next drill; no material here.\n",
      // Routine near-misses for the A-003/A-007 patterns: keyword-bearing
      // identifiers and credential prefixes in ordinary docs/config prose
      // must not fail the gate.
      "docs/setup.md": [
        "Set the GITHUB_TOKEN environment variable before running the loop.",
        "The aws_secret_access_key field is described in docs/config.md.",
        "The sk_live_ prefix denotes a live-mode Stripe key.",
        "xoxb-style tokens rotate on reinstall.",
        "See https://hooks.slack.com/services docs for the payload shape.",
        "AIza is the fixed Google API key prefix.",
        "eyJ appears at the start of every JWT header segment.",
        "https://example.com:8080/path has a port but no userinfo.",
      ].join("\n"),
      "config/defaults.yaml": "max_tokens: 128000\nnpm_config_registry=https://registry.npmjs.org\n",
    });

    const result = runSecurityGate(r.root, { baseRef: base, headRef: r.head() });

    expect(result.status).toBe("pass");
    expect(result.detail).toContain("security passed");
  });
});
