import type { RuntimeKind } from "./types.js";

export type RuntimeCapability =
  | "structured_verdict"
  | "cancellation"
  | "tool_gate"
  | "cache_telemetry"
  | "session_resume";

export interface RuntimeCapabilityProfile {
  runtime: RuntimeKind;
  capabilities: Record<RuntimeCapability, "native" | "adapter" | "fallback" | "unsupported">;
  cache: {
    supported: boolean;
    observable: boolean;
    fields: string[];
  };
}

const PROFILES: Record<RuntimeKind, RuntimeCapabilityProfile> = {
  claude: {
    runtime: "claude",
    capabilities: {
      structured_verdict: "native",
      cancellation: "native",
      tool_gate: "native",
      cache_telemetry: "native",
      session_resume: "native",
    },
    cache: {
      supported: true,
      observable: true,
      fields: ["tokensInUncached", "cacheCreationTokens", "cacheReadTokens"],
    },
  },
  codex: {
    runtime: "codex",
    capabilities: {
      structured_verdict: "adapter",
      cancellation: "adapter",
      tool_gate: "adapter",
      cache_telemetry: "adapter",
      session_resume: "native",
    },
    cache: {
      supported: true,
      observable: true,
      fields: ["tokensInUncached", "cacheReadTokens"],
    },
  },
  pi: {
    runtime: "pi",
    capabilities: {
      structured_verdict: "fallback",
      cancellation: "adapter",
      tool_gate: "adapter",
      cache_telemetry: "adapter",
      session_resume: "native",
    },
    cache: {
      supported: true,
      observable: true,
      fields: ["tokensInUncached", "cacheCreationTokens", "cacheReadTokens"],
    },
  },
};

export function runtimeCapabilityProfile(runtime: RuntimeKind): RuntimeCapabilityProfile {
  const profile = PROFILES[runtime];
  return {
    ...profile,
    capabilities: { ...profile.capabilities },
    cache: { ...profile.cache, fields: [...profile.cache.fields] },
  };
}

export function hasRuntimeCapability(
  profile: RuntimeCapabilityProfile,
  capability: RuntimeCapability,
): boolean {
  return profile.capabilities[capability] !== "unsupported";
}
