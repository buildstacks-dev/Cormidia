// What models a harness will actually serve, answered without spending a token
// (ENH-004).
//
// A role's model id is otherwise only proven at dispatch, inside a live paid
// turn: `roles set` accepted any non-empty string and the org discovered a
// retired or misspelled id when a real ticket turn failed. Where a harness
// exposes its roster locally, that is checked before the ratified file is
// rewritten. Where it does not, this module says so explicitly and names why —
// an unverifiable id must be visible to the operator, never silent.

import { join } from "node:path";
import type { RuntimeKind } from "./types.js";

export type RuntimeModelCatalog =
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
 * Why `claude` and `codex` have no offline roster. Both are reachable
 * token-free, but only by launching the provider's own transport with a
 * working credential — which `operon roles set` must not require: editing the
 * org chart has to work on a machine that has not been authenticated yet, and
 * adapter probing is `operon doctor`'s job, not a config edit's.
 */
const UNAVAILABLE_REASON: Record<RuntimeKind, string | undefined> = {
  claude:
    "the Claude adapter ships no offline model roster; its catalog is only readable by " +
    "launching the Claude CLI transport with a working credential, which a config edit must not require",
  codex:
    "the Codex App Server protocol Operon speaks exposes account and thread methods only, " +
    "with no model enumeration; the id is proven when a turn starts",
  pi: undefined,
};

/**
 * Read the harness roster. Never contacts a provider, never sends a model
 * request, and never writes: the pi roster is the local model registry, and
 * the other two harnesses report unavailability rather than guessing.
 */
export async function readRuntimeModelCatalog(
  runtime: RuntimeKind,
): Promise<RuntimeModelCatalog> {
  if (runtime !== "pi") {
    return { runtime, available: false, reason: UNAVAILABLE_REASON[runtime]! };
  }
  try {
    const { AuthStorage, InMemoryAuthStorageBackend, ModelRegistry, getAgentDir } = await import(
      "@earendil-works/pi-coding-agent"
    );
    const modelsPath = join(getAgentDir(), "models.json");
    // An in-memory credential store: enumerating the roster needs no
    // credential, and the file-backed store would create and lock auth.json.
    const registry = ModelRegistry.create(
      AuthStorage.fromStorage(new InMemoryAuthStorageBackend()),
      modelsPath,
    );
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
export function modelServedByCatalog(
  catalog: RuntimeModelCatalog,
  model: string,
): boolean {
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
export function describeModelCatalogCheck(
  catalog: RuntimeModelCatalog,
  model: string,
): string {
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
