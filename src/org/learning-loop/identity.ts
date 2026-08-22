// Cormidia principals onto the kernel's IdentityPort (kernel contract
// §Principal and independence). Evidence originates from Cormidia's own role
// configuration or the approval decider — never from provider output — and
// the port mints a deterministic attestation over exactly that evidence, so
// the same principal always verifies to the same handle. Independence domain:
// a role's runtime (the builder ≠ reviewer cross-provider pairing in
// roles.yaml is what makes a learning reviewer independent of a distiller).

import { createIdentityPort, sha256HexOfCanonicalJson } from "@cormidia/learning-loop";
import type { IdentityPort } from "@cormidia/learning-loop";

export const CORMIDIA_IDENTITY_PORT_ID = "cormidia/identity";
const PORT_VERSION = "1.0.0";
const PRINCIPAL_KINDS = ["human", "agent", "service"] as const;
type PrincipalKind = (typeof PRINCIPAL_KINDS)[number];

export interface CormidiaPrincipalEvidence {
  readonly principalId: string;
  readonly kind: PrincipalKind;
  readonly independenceDomain: string;
}

/** An org role running on a named runtime (roles.yaml `runtime`). */
export function rolePrincipalEvidence(role: string, runtime: string): CormidiaPrincipalEvidence {
  return { principalId: `role:${role}`, kind: "agent", independenceDomain: `runtime:${runtime}` };
}

/** A human identity (approval decider, CLI operator). */
export function humanPrincipalEvidence(identity: string): CormidiaPrincipalEvidence {
  return { principalId: `human:${identity}`, kind: "human", independenceDomain: `human:${identity}` };
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`learning-loop: identity ${label} must be a non-empty string`);
  return value;
}

function principalKind(value: unknown): PrincipalKind {
  for (const kind of PRINCIPAL_KINDS) if (value === kind) return kind;
  throw new Error("learning-loop: identity kind must be human, agent, or service");
}

export function parsePrincipalEvidence(evidence: unknown): CormidiaPrincipalEvidence {
  if (evidence === null || typeof evidence !== "object" || Array.isArray(evidence)) {
    throw new Error("learning-loop: identity evidence must be an object");
  }
  return {
    principalId: nonEmptyString(Reflect.get(evidence, "principalId"), "principalId"),
    kind: principalKind(Reflect.get(evidence, "kind")),
    independenceDomain: nonEmptyString(Reflect.get(evidence, "independenceDomain"), "independenceDomain"),
  };
}

export function createCormidiaIdentityPort(): IdentityPort {
  const configurationDigest = sha256HexOfCanonicalJson({ kind: "cormidia-identity", schemaVersion: 1 });
  return createIdentityPort({
    id: CORMIDIA_IDENTITY_PORT_ID,
    version: PORT_VERSION,
    configurationDigest,
    verify: (evidence: unknown): Promise<unknown> => {
      const parsed = parsePrincipalEvidence(evidence);
      const attestationDigest = sha256HexOfCanonicalJson({ port: CORMIDIA_IDENTITY_PORT_ID, ...parsed });
      return Promise.resolve({
        ref: { id: parsed.principalId, kind: parsed.kind, independenceDomain: parsed.independenceDomain },
        attestationId: `cormidia-attestation-${attestationDigest.slice(0, 16)}`,
        attestationDigest,
      });
    },
  });
}
