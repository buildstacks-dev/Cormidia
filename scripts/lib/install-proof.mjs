import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

export const INSTALL_PROOF_SCHEMA = "cormidia-install-packaged-proof/1";

export async function tarballIdentity(path) {
  const bytes = await readFile(path);
  return { name: basename(path), sha256: createHash("sha256").update(bytes).digest("hex") };
}

export function packagedInstallProof({ argv, installedVersion, tarball }) {
  return {
    schema: INSTALL_PROOF_SCHEMA,
    mode: "install",
    argv: [...argv],
    installed_version: installedVersion,
    tarball,
    replaced_source_links: argv.includes("--replace-source-links"),
  };
}
