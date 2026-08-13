// The provisioning idempotency marker (#382).
//
// Its own module because both the preflight and the adoption logic need it and
// neither should import the other. The marker is written into the created
// repository's DESCRIPTION — the one GitHub object in this flow with no body to
// hide a marker in — so a lost create response reconciles to the repository it
// actually made instead of creating a second one.

export function repositoryProvisionMarker(key: string): string {
  return `[cormidia:provision id=${key}]`;
}
