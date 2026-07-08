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
    });

    const result = runSecurityGate(r.root, { baseRef: base, headRef: r.head() });

    expect(result.status).toBe("pass");
    expect(result.detail).toContain("security passed");
  });
});
