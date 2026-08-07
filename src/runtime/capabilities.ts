import type { RuntimeKind } from "./types.js";

/**
 * Adapter surfaces that can affect how a turn should be executed.
 *
 * Keep this list small and behavioral. A capability belongs here when the
 * orchestrator validates it or when an agent inside the turn needs to know
 * whether it can rely on the surface. Role tools and permissions deliberately
 * do not belong here: selecting a harness must never grant authority.
 */
const RUNTIME_CAPABILITIES = [
  "cache_telemetry",
  "cancellation",
  "intra_turn_fanout",
  "session_resume",
  "structured_verdict",
  "tool_gate",
] as const;

export type RuntimeCapability = (typeof RUNTIME_CAPABILITIES)[number];

const RUNTIME_CAPABILITY_SUPPORT = ["native", "adapter", "fallback", "unsupported"] as const;

/** `fallback` is intentionally rendered to agents as "fallback (degraded)". */
type RuntimeCapabilitySupport = (typeof RUNTIME_CAPABILITY_SUPPORT)[number];

export interface RuntimeCapabilityProfile {
  /** Versioned identifier also used by assignment qualification records. */
  ref: `${RuntimeKind}/v${number}`;
  runtime: RuntimeKind;
  capabilities: Record<RuntimeCapability, RuntimeCapabilitySupport>;
  cache: {
    supported: boolean;
    observable: boolean;
    fields: string[];
  };
}

const PROFILES: Record<RuntimeKind, RuntimeCapabilityProfile> = {
  claude: {
    ref: "claude/v1",
    runtime: "claude",
    capabilities: {
      cache_telemetry: "native",
      cancellation: "native",
      intra_turn_fanout: "native",
      session_resume: "native",
      structured_verdict: "native",
      tool_gate: "native",
    },
    cache: {
      supported: true,
      observable: true,
      fields: ["tokensInUncached", "cacheCreationTokens", "cacheReadTokens"],
    },
  },
  codex: {
    ref: "codex/v1",
    runtime: "codex",
    capabilities: {
      cache_telemetry: "adapter",
      cancellation: "adapter",
      intra_turn_fanout: "native",
      session_resume: "native",
      structured_verdict: "adapter",
      tool_gate: "adapter",
    },
    cache: {
      supported: true,
      observable: true,
      fields: ["tokensInUncached", "cacheReadTokens"],
    },
  },
  pi: {
    ref: "pi/v1",
    runtime: "pi",
    capabilities: {
      cache_telemetry: "adapter",
      cancellation: "adapter",
      // Pi has no fan-out surface. The adapter's degradation artifact makes
      // that absence visible after the turn, but it does not provide fan-out.
      intra_turn_fanout: "unsupported",
      session_resume: "native",
      structured_verdict: "fallback",
      tool_gate: "adapter",
    },
    cache: {
      supported: true,
      observable: true,
      fields: ["tokensInUncached", "cacheCreationTokens", "cacheReadTokens"],
    },
  },
  muse: {
    ref: "muse/v1",
    runtime: "muse",
    capabilities: {
      // Token counts (including the cached split) exist only in the durable
      // session log, which the adapter reads; the stream reports no dollars.
      cache_telemetry: "adapter",
      cancellation: "adapter",
      // Muse Code's swarm is the harness advantage, but no hook/permission
      // seam covering swarm members was observed on 0.1.0-R708.1, and the
      // owner-decided fallback is contract truth: never an ungated swarm
      // (contracts/B-26-muse-code.md, F-PT-028). Fan-out stays absent.
      intra_turn_fanout: "unsupported",
      session_resume: "native",
      // No JSON-schema output surface; the loop's lenient parser is the path.
      structured_verdict: "fallback",
      // `muse exec` auto-approves headlessly and no managed hook fired across
      // twenty configurations, so no pre-execution classification seam was
      // proven. The adapter refuses every turn whose seam is unproven rather
      // than running one ungated (INV-002); that refusal is the degradation
      // artifact this tier owes.
      tool_gate: "unsupported",
    },
    cache: {
      supported: true,
      observable: true,
      fields: ["tokensInUncached", "cacheReadTokens"],
    },
  },
};

const CAPABILITY_LABELS: Record<RuntimeCapability, string> = {
  cache_telemetry: "cache telemetry",
  cancellation: "cancellation",
  intra_turn_fanout: "intra-turn fan-out",
  session_resume: "session resume",
  structured_verdict: "structured verdict",
  tool_gate: "tool gate",
};

export function runtimeCapabilityProfile(runtime: RuntimeKind): RuntimeCapabilityProfile {
  const profile = PROFILES[runtime];
  return {
    ...profile,
    capabilities: { ...profile.capabilities },
    cache: { ...profile.cache, fields: [...profile.cache.fields] },
  };
}

export function isRuntimeCapability(value: unknown): value is RuntimeCapability {
  return typeof value === "string" && RUNTIME_CAPABILITIES.includes(value as RuntimeCapability);
}

export function validateRuntimeCapabilities(values: unknown, context = "runtime capabilities"): RuntimeCapability[] {
  if (!Array.isArray(values)) throw new Error(`${context} must be an array`);
  const capabilities = values.map((value, index) => {
    if (!isRuntimeCapability(value)) {
      throw new Error(`${context}[${index}] must be one of ${RUNTIME_CAPABILITIES.join(" | ")}`);
    }
    return value;
  });
  const duplicate = capabilities.find((capability, index) => capabilities.indexOf(capability) !== index);
  if (duplicate !== undefined) {
    throw new Error(`${context} duplicates ${JSON.stringify(duplicate)}`);
  }
  return capabilities.sort();
}

export function hasRuntimeCapability(profile: RuntimeCapabilityProfile, capability: RuntimeCapability): boolean {
  const support = profile.capabilities[capability];
  return support !== undefined && support !== "unsupported";
}

/** Stable evidence projection: known, non-unsupported surface names only. */
export function resolvedRuntimeCapabilities(runtime: RuntimeKind): RuntimeCapability[] {
  const profile = runtimeCapabilityProfile(runtime);
  return RUNTIME_CAPABILITIES.filter((capability) => hasRuntimeCapability(profile, capability)).sort();
}

function runtimeCapabilitySupportLabel(support: RuntimeCapabilitySupport): string {
  if (support === "adapter") return "adapter-built";
  if (support === "fallback") return "fallback (degraded)";
  return support;
}

/**
 * Concise, deterministic turn guidance. Harness-specific facts come only from
 * runtimeCapabilityProfile(); callers may identify required surfaces but
 * cannot supply or rewrite capability prose.
 */
export function runtimeCapabilityGuidance(
  runtime: RuntimeKind,
  requiredValues: readonly RuntimeCapability[] = [],
): string[] {
  const profile = runtimeCapabilityProfile(runtime);
  const required = new Set(validateRuntimeCapabilities([...requiredValues], "required capabilities"));
  for (const capability of required) {
    if (!hasRuntimeCapability(profile, capability)) {
      throw new Error(`${runtime} lacks required capability ${capability}`);
    }
  }
  return RUNTIME_CAPABILITIES.map((capability) => {
    const support = profile.capabilities[capability];
    const requirement = required.has(capability) ? "; required for this turn" : "";
    const constraint =
      capability === "intra_turn_fanout" && support === "unsupported"
        ? "; unavailable—work serially"
        : support === "unsupported"
          ? "; do not rely on this surface"
          : "";
    return `- ${CAPABILITY_LABELS[capability]}: ${runtimeCapabilitySupportLabel(support)}${requirement}${constraint}`;
  });
}
