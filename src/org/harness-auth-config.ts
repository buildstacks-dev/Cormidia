// The `harnesses:` block of apps.yaml / `.cormidia/config.yaml` — org-declared
// billing per harness connection (#333).
//
// This is ORG configuration, not role configuration. `roles.yaml` is a
// human-ratified surface and stays untouched: which harness a role runs on is
// a ratified assignment, while HOW that harness is paid for is a property of
// the operator's machine and their accounts. Putting the declaration on the
// role would also make it impossible to say the one thing #333 exists to say —
// that the same model is reached under different billing through different
// harnesses at the same time.
//
// Shape (org level, alongside `org:` and `defaults:`):
//
//   harnesses:
//     claude:
//       auth: subscription          # Claude Code on the operator's plan
//     opencode:
//       providers:
//         anthropic: api_key        # the same models, metered, in one org
//         openai: api_key
//     pi:
//       auth: api_key               # families the `providers:` map omits
//       providers:
//         anthropic: subscription

import {
  AUTH_MODES,
  HARNESS_AUTH_SUPPORT,
  type AuthMode,
  type HarnessAuthConfig,
  type HarnessAuthDeclaration,
} from "../runtime/auth-mode.js";
import { RUNTIME_KINDS } from "../runtime/registry.js";
import type { RuntimeKind } from "../runtime/types.js";

/** Parse the optional `harnesses:` block. Absent → `{}`: no connection is
 *  declared, nothing is verified, and behaviour is exactly pre-#333. Loud on
 *  malformation — a wrong billing declaration must fail at load, not at the
 *  moment an unexpected invoice arrives. */
export function parseHarnessAuthConfig(raw: unknown, err: (message: string) => Error): HarnessAuthConfig {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw err("harnesses must be a mapping of harness -> auth declaration");
  }
  const config: HarnessAuthConfig = {};
  for (const [name, declarationRaw] of Object.entries(raw as Record<string, unknown>)) {
    if (!RUNTIME_KINDS.includes(name as RuntimeKind)) {
      throw err(`harnesses: unknown harness "${name}" (known: ${[...RUNTIME_KINDS].sort().join(", ")})`);
    }
    config[name as RuntimeKind] = parseDeclaration(name as RuntimeKind, declarationRaw, err);
  }
  return config;
}

/** Convert the in-memory form back to the shared apps.yaml /
 *  `.cormidia/config.yaml` public schema. */
export function harnessAuthYaml(config: HarnessAuthConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const harness of [...RUNTIME_KINDS].sort()) {
    const declaration = config[harness];
    if (declaration === undefined) continue;
    const block: Record<string, unknown> = {};
    if (declaration.auth !== undefined) block["auth"] = declaration.auth;
    if (declaration.providers !== undefined && Object.keys(declaration.providers).length > 0) {
      block["providers"] = Object.fromEntries(
        Object.entries(declaration.providers).sort(([left], [right]) => left.localeCompare(right, "en")),
      );
    }
    out[harness] = block;
  }
  return out;
}

/** One-line human summary per declared connection, for `cormidia apps` and
 *  onboarding output. Undeclared harnesses are simply absent — the surface
 *  never implies a default the config did not state. */
export function describeHarnessAuth(config: HarnessAuthConfig): string[] {
  const lines: string[] = [];
  for (const harness of [...RUNTIME_KINDS].sort()) {
    const declaration = config[harness];
    if (declaration === undefined) continue;
    const parts: string[] = [];
    if (declaration.auth !== undefined) parts.push(`*=${declaration.auth}`);
    for (const [family, mode] of Object.entries(declaration.providers ?? {}).sort()) {
      parts.push(`${family}=${mode}`);
    }
    lines.push(`${harness}: ${parts.join(" ")}`);
  }
  return lines;
}

function parseDeclaration(harness: RuntimeKind, raw: unknown, err: (message: string) => Error): HarnessAuthDeclaration {
  const where = `harnesses.${harness}`;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw err(`${where} must be a mapping with "auth" and/or "providers"`);
  }
  const spec = raw as Record<string, unknown>;
  for (const key of Object.keys(spec)) {
    if (key !== "auth" && key !== "providers") {
      throw err(`${where}: unknown key "${key}" (allowed: auth, providers)`);
    }
  }
  const support = HARNESS_AUTH_SUPPORT[harness];
  const declaration: { auth?: AuthMode; providers?: Record<string, AuthMode> } = {};
  if (spec["auth"] !== undefined) {
    declaration.auth = parseMode(spec["auth"], harness, `${where}.auth`, err);
  }
  if (spec["providers"] !== undefined) {
    if (!support.multiProvider) {
      throw err(
        `${where}.providers is only meaningful for a multi-provider backbone ` +
          `(${RUNTIME_KINDS.filter((kind) => HARNESS_AUTH_SUPPORT[kind].multiProvider)
            .sort()
            .join(", ")}); ` +
          `${harness} reaches one provider family, so declare "auth" instead`,
      );
    }
    const providersRaw = spec["providers"];
    if (!providersRaw || typeof providersRaw !== "object" || Array.isArray(providersRaw)) {
      throw err(`${where}.providers must be a mapping of provider family -> auth mode`);
    }
    const providers: Record<string, AuthMode> = {};
    for (const [family, mode] of Object.entries(providersRaw as Record<string, unknown>)) {
      if (family.trim().length === 0 || family !== family.trim()) {
        throw err(`${where}.providers keys must be non-empty provider families with no surrounding whitespace`);
      }
      providers[family] = parseMode(mode, harness, `${where}.providers.${family}`, err);
    }
    declaration.providers = providers;
  }
  if (declaration.auth === undefined && declaration.providers === undefined) {
    throw err(`${where} must declare "auth" and/or "providers" — an empty declaration verifies nothing`);
  }
  return declaration;
}

function parseMode(raw: unknown, harness: RuntimeKind, field: string, err: (message: string) => Error): AuthMode {
  if (typeof raw !== "string" || !AUTH_MODES.includes(raw as AuthMode)) {
    throw err(`${field} must be one of ${AUTH_MODES.join(" | ")}`);
  }
  const mode = raw as AuthMode;
  const support = HARNESS_AUTH_SUPPORT[harness];
  if (!support.modes.includes(mode)) {
    // Invalid by construction, not a runtime mismatch: the vendor exposes no
    // such login, so no credential state could ever satisfy this declaration.
    throw err(
      `${field}: ${harness} cannot be reached under "${mode}" — it supports ${support.modes.join(", ")} only ` +
        `(verification: ${support.verification})`,
    );
  }
  return mode;
}
