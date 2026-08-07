// Auth mode per (harness × provider-family) connection (#333).
//
// The same model can be reached under different billing depending on which
// harness reaches it: Opus through Claude Code on the operator's subscription
// and Opus through OpenCode on an Anthropic API key, simultaneously, in one
// org. So auth binds to the CONNECTION — the (harness, provider family) pair —
// and never to the model. A model-keyed declaration could not express that
// pair and would silently answer for the wrong billing.
//
// This module is the one machine-readable place the vocabulary lives: which
// modes each harness can be reached under, how the declaration is shaped, what
// a credential probe observed, and the verdict comparing the two. Readiness
// refusal, `cormidia doctor`, the app registry loader, and the settlement
// billing label all read it. Nothing here performs I/O or spends a token.

import type { RuntimeKind } from "./types.js";

/**
 * How an operator pays for a connection.
 *
 * `subscription` — the turn runs on the operator's own plan (Claude.ai Max,
 * ChatGPT Plus/Pro, a Cursor plan). There is no marginal dollar cost per turn.
 * `api_key` — the turn is metered and invoiced per token against a key.
 *
 * There is deliberately no third value: "whatever the credential store happens
 * to hold" is exactly the implicit state #333 exists to remove.
 */
export type AuthMode = "subscription" | "api_key";

export const AUTH_MODES: readonly AuthMode[] = ["subscription", "api_key"];

export interface HarnessAuthSupport {
  /** Modes this harness can actually be reached under. A mode absent here is
   *  invalid BY CONSTRUCTION — muse ships API-key auth only, so declaring
   *  `subscription` for it is a config error, not a runtime mismatch. */
  readonly modes: readonly AuthMode[];
  /** Multi-provider backbones (pi, opencode) reach several provider families
   *  through one harness and may declare a mode per family. Vendor-native
   *  harnesses have exactly one family and declare `auth:` alone. */
  readonly multiProvider: boolean;
  /** Canonical family for a single-provider harness; the key an observation
   *  and a whole-harness declaration agree on. */
  readonly providerFamily: string;
  /** The token-free probe that reads the ACTUAL credential state. Rendered by
   *  `cormidia doctor` so an operator can reproduce the verdict by hand. */
  readonly verification: string;
}

/**
 * Exhaustive by construction: a new `RuntimeKind` is a compile error until its
 * auth support is declared. Deliberate — an undeclared harness has no notion
 * of which modes are possible, and "possible" is what makes muse's
 * subscription declaration refusable before any probe runs.
 */
export const HARNESS_AUTH_SUPPORT: Record<RuntimeKind, HarnessAuthSupport> = {
  claude: {
    modes: ["subscription", "api_key"],
    multiProvider: false,
    providerFamily: "anthropic",
    verification: "`claude auth status --json` (authMethod/apiProvider) plus SDK accountInfo token/API-key source",
  },
  codex: {
    modes: ["subscription", "api_key"],
    multiProvider: false,
    providerFamily: "openai",
    verification: "Codex App Server `account/read` account type (ChatGPT sign-in vs API key)",
  },
  pi: {
    modes: ["subscription", "api_key"],
    multiProvider: true,
    providerFamily: "pi",
    verification: "pi `auth.json` credential records (`type: oauth` vs `type: api_key`) per provider",
  },
  cursor: {
    modes: ["subscription", "api_key"],
    multiProvider: false,
    providerFamily: "cursor",
    verification: "`cursor-agent status` stored login vs an explicit `CURSOR_API_KEY`",
  },
  grok: {
    modes: ["subscription", "api_key"],
    multiProvider: false,
    providerFamily: "xai",
    verification: "ACP auth method (`cached_token` browser login) vs an explicit `XAI_API_KEY`",
  },
  opencode: {
    modes: ["subscription", "api_key"],
    multiProvider: true,
    providerFamily: "opencode",
    verification: "the OpenCode auth store (`opencode auth list`; `type: oauth` vs `api`/`wellknown`) per provider",
  },
  muse: {
    // API key only, by vendor construction: `muse` resolves a key from
    // CORMIDIA_MUSE_API_KEY_FILE/CORMIDIA_MUSE_API_KEY/MUSE_API_KEY/
    // META_API_KEY and exposes no subscription login at all
    // (research/2026-08-06_adapter-upstream-references.md). A `subscription`
    // declaration here is refused at config load, not left to fail at a probe.
    modes: ["api_key"],
    multiProvider: false,
    providerFamily: "meta",
    verification:
      "resolvable Muse API key (CORMIDIA_MUSE_API_KEY_FILE/CORMIDIA_MUSE_API_KEY/MUSE_API_KEY/META_API_KEY)",
  },
};

/** One harness connection's declared billing. `providers` narrows per provider
 *  family on a multi-provider backbone; `auth` covers every family the
 *  declaration does not name. */
export interface HarnessAuthDeclaration {
  readonly auth?: AuthMode;
  readonly providers?: Readonly<Record<string, AuthMode>>;
}

/** Org-level declarations keyed by harness. Absent harness = undeclared: the
 *  connection is not verified and no turn is labeled, which is the same
 *  behaviour orgs had before #333. */
export type HarnessAuthConfig = Partial<Record<RuntimeKind, HarnessAuthDeclaration>>;

/** What a token-free credential probe actually found for one connection.
 *  `mode` absent means INDETERMINATE — the probe read the store and could not
 *  tell. Indeterminate never satisfies a declaration: guessing a billing mode
 *  is the failure this whole path exists to prevent. */
export interface ObservedConnectionAuth {
  readonly providerFamily: string;
  readonly mode?: AuthMode;
  /** Exactly what was read, named. Rendered verbatim into readiness detail. */
  readonly evidence: string;
}

export type AuthModeVerdict =
  | { readonly ok: true; readonly detail: string }
  | {
      readonly ok: false;
      readonly errorCode: "error_auth_mode_mismatch" | "error_auth_mode_unsupported" | "error_auth_mode_unverifiable";
      readonly detail: string;
    };

/** The mode declared for one (harness, provider family) connection, or
 *  `undefined` when the org declared nothing for it. */
export function declaredAuthMode(
  config: HarnessAuthConfig,
  harness: RuntimeKind,
  providerFamily: string,
): AuthMode | undefined {
  const declaration = config[harness];
  if (declaration === undefined) return undefined;
  return declaration.providers?.[providerFamily] ?? declaration.auth;
}

/**
 * Compare one harness's declaration against what its credential probe
 * observed. Fail-closed in every direction that is not an exact match:
 *
 * - declared `subscription`, credential is an API key → surprise billing;
 * - declared `api_key`, credential is a subscription → quota the operator
 *   never approved;
 * - declared a mode the harness cannot serve → invalid by construction;
 * - observation indeterminate → unverifiable, never "probably fine".
 *
 * A connection the declaration does not cover is reported, not refused: an org
 * may legitimately declare only the harnesses it cares about.
 */
export function verifyAuthModes(
  harness: RuntimeKind,
  declaration: HarnessAuthDeclaration | undefined,
  observed: readonly ObservedConnectionAuth[],
): AuthModeVerdict {
  if (declaration === undefined) {
    return { ok: true, detail: `auth mode undeclared for ${harness}; billing not verified` };
  }
  const support = HARNESS_AUTH_SUPPORT[harness];
  for (const [family, mode] of declaredPairs(declaration)) {
    if (!support.modes.includes(mode)) {
      return {
        ok: false,
        errorCode: "error_auth_mode_unsupported",
        detail:
          `${harness} cannot be reached under auth mode "${mode}"` +
          (family === undefined ? "" : ` (provider family ${family})`) +
          `; supported: ${support.modes.join(", ")} — ${support.verification}`,
      };
    }
  }

  const checked: string[] = [];
  for (const connection of observed) {
    const declared = declaration.providers?.[connection.providerFamily] ?? declaration.auth;
    if (declared === undefined) {
      checked.push(`${connection.providerFamily}: undeclared (observed ${connection.mode ?? "indeterminate"})`);
      continue;
    }
    if (connection.mode === undefined) {
      return {
        ok: false,
        errorCode: "error_auth_mode_unverifiable",
        detail:
          `${harness}/${connection.providerFamily} declares auth "${declared}", but its credential state is ` +
          `indeterminate, so the declaration cannot be verified: ${connection.evidence}`,
      };
    }
    if (connection.mode !== declared) {
      return {
        ok: false,
        errorCode: "error_auth_mode_mismatch",
        detail:
          `${harness}/${connection.providerFamily} declares auth "${declared}" but the credential in use is ` +
          `"${connection.mode}" (${connection.evidence}). ` +
          (declared === "subscription"
            ? "Running it anyway would bill the operator's API account for turns declared as subscription work."
            : "Running it anyway would consume subscription quota the operator did not approve.") +
          " Fix the credential or the declaration; Cormidia never falls back silently.",
      };
    }
    checked.push(`${connection.providerFamily}: ${connection.mode} (${connection.evidence})`);
  }
  return {
    ok: true,
    detail: checked.length === 0 ? `${harness} auth declaration matched no observed connection` : checked.join("; "),
  };
}

function declaredPairs(declaration: HarnessAuthDeclaration): Array<[string | undefined, AuthMode]> {
  const pairs: Array<[string | undefined, AuthMode]> = [];
  if (declaration.auth !== undefined) pairs.push([undefined, declaration.auth]);
  for (const [family, mode] of Object.entries(declaration.providers ?? {})) pairs.push([family, mode]);
  return pairs;
}
