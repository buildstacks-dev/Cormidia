// Cormidia SystemFingerprint (src/org/learning/fingerprint.ts, spec §6) onto
// the kernel's content-addressed fingerprint (kernel contract §Fingerprint and
// experiment). Each Cormidia section becomes one named component whose digest
// is the canonical JSON of that section, so a drift in any section changes
// exactly that component and the whole-fingerprint digest; the kernel
// recomputes the digest over the components it is given.

import {
  parseSystemFingerprint,
  sha256HexOfCanonicalJson,
  systemFingerprintDigest,
  toJsonValue,
} from "@cormidia/learning-loop";
import type { FingerprintComponent, SystemFingerprint as KernelFingerprint } from "@cormidia/learning-loop";
import type { SystemFingerprint } from "../learning/fingerprint.js";

function component(name: string, section: unknown, version?: string | null): FingerprintComponent {
  const digest = sha256HexOfCanonicalJson(toJsonValue(section));
  return version === undefined || version === null ? { name, digest } : { name, version, digest };
}

/** The ordered component projection of a Cormidia fingerprint. */
export function fingerprintComponents(fingerprint: SystemFingerprint): FingerprintComponent[] {
  return [
    component("cormidia", fingerprint.cormidia, fingerprint.cormidia.version),
    component("org", fingerprint.org),
    component("app", fingerprint.app, fingerprint.app.name),
    component("bundle", { versions: fingerprint.bundle_versions, lineage: fingerprint.bundle_lineage }),
    component("models", fingerprint.models),
    component("gates", { gates_hash: fingerprint.gates_hash, permissions_hash: fingerprint.permissions_hash }),
    component("budget_caps", fingerprint.budget_caps),
    component("env", fingerprint.env, fingerprint.env.node),
  ];
}

/** A kernel fingerprint keyed by Cormidia's content-addressed `fingerprint_id`. */
export function kernelFingerprint(fingerprint: SystemFingerprint): KernelFingerprint {
  const components = fingerprintComponents(fingerprint);
  return parseSystemFingerprint({
    schemaVersion: 1,
    id: fingerprint.fingerprint_id,
    components,
    digest: systemFingerprintDigest(components),
  });
}
