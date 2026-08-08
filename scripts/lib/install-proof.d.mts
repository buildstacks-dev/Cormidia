export const INSTALL_PROOF_SCHEMA: "cormidia-install-packaged-proof/1";

export interface TarballIdentity {
  name: string;
  sha256: string;
}

export function tarballIdentity(path: string): Promise<TarballIdentity>;

export function packagedInstallProof(input: {
  argv: readonly string[];
  installedVersion: string;
  tarball: TarballIdentity;
}): {
  schema: typeof INSTALL_PROOF_SCHEMA;
  mode: "install";
  argv: string[];
  installed_version: string;
  tarball: TarballIdentity;
  replaced_source_links: boolean;
};
