// What models a harness will actually serve, answered without spending a token
// (ENH-004).
//
// A role's model id is otherwise only proven at dispatch, inside a live paid
// turn: `roles set` accepted any non-empty string and the org discovered a
// retired or misspelled id when a real ticket turn failed. Where a harness
// exposes its roster locally, that is checked before the ratified file is
// rewritten. Where it does not, this module says so explicitly and names why —
// an unverifiable id must be visible to the operator, never silent.

import type { CreateModelRuntimeOptions } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { harnessMetadata } from "./harness-metadata.js";
import type { RuntimeKind } from "./types.js";

type RuntimeModelCatalog =
  | {
      runtime: RuntimeKind;
      available: true;
      /** Where the roster came from, for the operator's benefit. */
      source: string;
      /** Every identifier the harness accepts, in the form roles.yaml uses. */
      models: string[];
    }
  | {
      runtime: RuntimeKind;
      available: false;
      /** Why no token-free roster exists for this harness right now. */
      reason: string;
    };

/** Injection point: tests and callers supply a deterministic roster. */
export type RuntimeModelCatalogReader = (runtime: RuntimeKind) => Promise<RuntimeModelCatalog>;

/**
 * Reads as empty, refuses to write. Roster enumeration is credential-free by
 * construction, so a store that cannot persist is the honest one: no auth.json
 * is created, locked, or mutated by a config-time read.
 */
const EMPTY_CREDENTIAL_STORE: NonNullable<CreateModelRuntimeOptions["credentials"]> = {
  read: async () => undefined,
  list: async () => [],
  modify: async () => undefined,
  delete: async () => {},
};

/**
 * Why `claude` and `codex` have no offline roster. Both are reachable
 * token-free, but only by launching the provider's own transport with a
 * working credential — which `cormidia roles set` must not require: editing the
 * org chart has to work on a machine that has not been authenticated yet, and
 * adapter probing is `cormidia doctor`'s job, not a config edit's.
 */
const UNAVAILABLE_REASON: Record<RuntimeKind, string | undefined> = {
  claude:
    "the Claude adapter ships no offline model roster; its catalog is only readable by " +
    "launching the Claude CLI transport with a working credential, which a config edit must not require",
  codex:
    "the Codex App Server protocol Cormidia speaks exposes account and thread methods only, " +
    "with no model enumeration; the id is proven when a turn starts",
  cursor:
    "the Cursor roster is account-scoped and reachable only by running `cursor-agent --list-models` " +
    "with a working credential, which a config edit must not require; the id is proven when a turn starts",
  opencode: undefined,
  pi: undefined,
  grok: "the Grok Build roster is only readable by running `grok models` with a working credential, which a config edit must not require; the id is proven by `cormidia doctor` and then inside a live turn",
  muse: undefined,
};

/** How long the OpenCode roster listing may take before it is reported as
 *  unavailable. The command is local (it reads the install's own catalog with
 *  network refresh disabled) and completed in well under a second on 1.18.15. */
const OPENCODE_CATALOG_TIMEOUT_MS = 15_000;

/**
 * The Muse Spark identifiers Muse Code accepts are a published DOCUMENTED list,
 * not a probe: `muse` exposes no token-free enumeration command. The list and
 * the announcement it came from live in `harness-metadata.json` (#332) with the
 * other facts that drift upstream, so `source` names that record rather than a
 * local file. Publishing a roster never assigns a model to a role.
 */
function documentedRoster(runtime: RuntimeKind): { models: string[]; source: string } {
  const roster = harnessMetadata(runtime).roster;
  if (roster === null) throw new Error(`harness ${runtime} declares no documented roster in harness-metadata.json`);
  return { models: [...roster.models], source: `${roster.source.evidence} (${roster.source.url})` };
}

/**
 * Read the harness roster. Never contacts a provider, never sends a model
 * request, and never writes: the pi roster is the local model registry, and
 * the other two harnesses report unavailability rather than guessing.
 */
export async function readRuntimeModelCatalog(runtime: RuntimeKind): Promise<RuntimeModelCatalog> {
  if (runtime === "opencode") return readOpencodeModelCatalog();
  if (runtime === "muse") {
    return { runtime, available: true, ...documentedRoster(runtime) };
  }
  if (runtime !== "pi") {
    return { runtime, available: false, reason: UNAVAILABLE_REASON[runtime]! };
  }
  try {
    const { ModelRegistry, ModelRuntime, getAgentDir } = await import("@earendil-works/pi-coding-agent");
    const modelsPath = join(getAgentDir(), "models.json");
    // A credential store that holds nothing: enumerating the roster needs no
    // credential, and the file-backed store would create and lock auth.json.
    // pi 0.84 stopped exporting its auth-storage classes, so the empty store is
    // supplied directly. `allowModelNetwork` stays default-false — reading the
    // roster must never reach a provider.
    const modelRuntime = await ModelRuntime.create({ modelsPath, credentials: EMPTY_CREDENTIAL_STORE });
    const registry = new ModelRegistry(modelRuntime);
    const error = registry.getError();
    if (error !== undefined) {
      return { runtime, available: false, reason: `the pi model registry is invalid: ${error}` };
    }
    const models = piCatalogIdentifiers(registry.getAll());
    if (models.length === 0) {
      return { runtime, available: false, reason: `the pi model registry at ${modelsPath} is empty` };
    }
    return { runtime, available: true, source: modelsPath, models };
  } catch (error) {
    return {
      runtime,
      available: false,
      reason: `the pi model registry could not be read: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * The OpenCode roster is what THIS install can actually serve — `opencode
 * models` prints the credential-resolved `provider/model` ids, not the whole
 * models.dev catalog, so an id for an unauthenticated provider is correctly
 * reported as not served. Run with catalog refresh disabled and the config root
 * redirected at an empty directory, so listing sends no provider request and
 * cannot pick up operator-global configuration.
 */
async function readOpencodeModelCatalog(): Promise<RuntimeModelCatalog> {
  const runtime = "opencode" as const;
  try {
    const [{ execFile }, { mkdtemp, rm }, { tmpdir }, { join: joinPath }, { promisify }] = await Promise.all([
      import("node:child_process"),
      import("node:fs/promises"),
      import("node:os"),
      import("node:path"),
      import("node:util"),
    ]);
    const { resolveOpencodeBinary, opencodeHermeticEnv } = await import("./adapters/opencode-server.js");
    const binary = resolveOpencodeBinary();
    const configHome = await mkdtemp(joinPath(tmpdir(), "cormidia-oc-cat-"));
    try {
      const { stdout } = await promisify(execFile)(binary, ["models"], {
        env: opencodeHermeticEnv(configHome),
        encoding: "utf8",
        timeout: OPENCODE_CATALOG_TIMEOUT_MS,
      });
      const models = [...new Set(stdout.split(/\r?\n/).map((line) => line.trim()))]
        .filter((line) => /^[^\s/]+\/\S+$/.test(line))
        .sort();
      if (models.length === 0) {
        return { runtime, available: false, reason: "the opencode install reports no reachable models" };
      }
      return { runtime, available: true, source: `${binary} models`, models };
    } finally {
      await rm(configHome, { recursive: true, force: true });
    }
  } catch (error) {
    return {
      runtime,
      available: false,
      reason: `the opencode model roster could not be read: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function piCatalogIdentifiers(models: readonly unknown[]): string[] {
  const identifiers = new Set<string>();
  for (const entry of models) {
    const record = entry as { provider?: unknown; id?: unknown };
    if (typeof record.id !== "string" || record.id === "") continue;
    identifiers.add(record.id);
    if (typeof record.provider === "string" && record.provider !== "") {
      identifiers.add(`${record.provider}/${record.id}`);
    }
  }
  return [...identifiers].sort();
}

/**
 * Whether the roster serves this id. Mirrors the resolution the adapters
 * perform: an explicit `provider/model` or `provider:model` selector, or a
 * bare model id.
 */
export function modelServedByCatalog(catalog: RuntimeModelCatalog, model: string): boolean {
  if (!catalog.available) return true;
  const served = new Set(catalog.models);
  if (served.has(model)) return true;
  const colon = model.indexOf(":");
  return colon > 0 && served.has(`${model.slice(0, colon)}/${model.slice(colon + 1)}`);
}

/**
 * Operator-facing one-liner naming what was and was not proven.
 *
 * Three outcomes, three sentences. This used to assert "is served by" whenever
 * a roster merely existed, without consulting `modelServedByCatalog` — so an
 * unlisted pi id printed "is served by the pi adapter" directly above
 * "BLOCKED model_not_served" in the same block. The lookup decides the claim.
 */
export function describeModelCatalogCheck(catalog: RuntimeModelCatalog, model: string): string {
  if (!catalog.available) {
    return (
      `model catalog: WARNING ${model} is NOT VERIFIED against the ${catalog.runtime} adapter — ` +
      `${catalog.reason}; the id is first proven inside a live paid turn`
    );
  }
  if (!modelServedByCatalog(catalog, model)) {
    return (
      `model catalog: ${model} is NOT served by the ${catalog.runtime} adapter ` +
      `(${catalog.models.length} models in ${catalog.source})`
    );
  }
  return (
    `model catalog: ${model} is served by the ${catalog.runtime} adapter ` +
    `(${catalog.models.length} models in ${catalog.source})`
  );
}
