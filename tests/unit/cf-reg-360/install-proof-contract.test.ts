// CF-REG-360 — the real packaged installer emits the identity the campaign
// proof parser requires. The original double emitted it while the real script
// printed prose and deleted the tarball, so every offline campaign test passed
// and no live report could answer which tarball ran.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { INSTALL_PROOF_SCHEMA, packagedInstallProof, tarballIdentity } from "../../../scripts/lib/install-proof.mjs";

const cleanups: string[] = [];
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("CF-REG-360 — real packaged-install proof", () => {
  it("binds the exact tarball bytes and emits the parser's terminal schema", async () => {
    const root = await mkdtemp(join(tmpdir(), "cormidia-install-proof-"));
    cleanups.push(root);
    const tarball = join(root, "cormidia-0.1.1.tgz");
    await writeFile(tarball, "exact packed bytes", "utf8");

    const proof = packagedInstallProof({
      argv: ["--replace-source-links"],
      installedVersion: "0.1.1",
      tarball: await tarballIdentity(tarball),
    });
    expect(proof).toEqual({
      schema: INSTALL_PROOF_SCHEMA,
      mode: "install",
      argv: ["--replace-source-links"],
      installed_version: "0.1.1",
      tarball: {
        name: "cormidia-0.1.1.tgz",
        sha256: "8de48d42ae349f81e346c27c0246bbe5e047137170a1ce8b1ab06cd5630b4bb2",
      },
      replaced_source_links: true,
    });
  });

  it("pins the real script to print that proof after verification", async () => {
    const source = await readFile(join(repoRoot, "scripts", "install-packaged.mjs"), "utf8");
    expect(source).toContain("const identity = await tarballIdentity(tarball)");
    expect(source).toContain("await transactionalReplace(");
    expect(source).toContain("packagedInstallProof({");
    expect(source.indexOf("packagedInstallProof({")).toBeGreaterThan(source.indexOf("await transactionalReplace("));
  });
});
