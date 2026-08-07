// Scripted pi SDK transport for the REAL PiRuntime (HB-024). The fake owns
// session/provider mechanics only; gate-extension activation, resume binding,
// budget checks, and result mapping remain product code.

import type {
  CreateAgentSessionOptions,
  CreateAgentSessionResult,
  ExtensionFactory,
  ResourceLoader,
} from "@earendil-works/pi-coding-agent";
import { PiRuntime } from "../../../src/runtime/adapters/pi.js";
import type { Runtime } from "../../../src/runtime/types.js";
import type {
  AdapterScenario,
  RecordedGateConsultation,
  RecordedToolPlay,
  ScriptedTurnObservation,
  ScriptedUsage,
} from "./scenario.js";

export interface PiRecordedTurn extends ScriptedTurnObservation {
  promptCalled: boolean;
  /** The exact task payload the adapter handed to session.prompt() — the
   *  provider-side ground truth for the C-CORE §1 payload-transport pin. */
  promptText: string | undefined;
  disposed: boolean;
}

export interface PiDouble {
  runtime: Runtime;
  recorder: { turns: PiRecordedTurn[] };
}

export function piDouble(scenarios: AdapterScenario[], opts: { omitGateExtension?: boolean } = {}): PiDouble {
  const recorder: PiDouble["recorder"] = { turns: [] };
  let next = 0;
  let active:
    | { scenario: AdapterScenario; turn: PiRecordedTurn; toolHandler?: (event: unknown) => Promise<unknown> }
    | undefined;

  const resourceLoaderFactory = async (input: { extensionFactories: ExtensionFactory[] }): Promise<ResourceLoader> => {
    const scenario = scenarios[next++];
    if (scenario === undefined) {
      throw new Error(`pi-double: over-called — only ${scenarios.length} scenario(s) scripted`);
    }
    const turn: PiRecordedTurn = {
      scenario,
      sessionReported: false,
      usageReported: false,
      resultDelivered: false,
      toolPlays: [],
      sequence: [],
      endedBy: "no_result",
      promptCalled: false,
      promptText: undefined,
      disposed: false,
    };
    recorder.turns.push(turn);
    active = { scenario, turn };
    if (!opts.omitGateExtension) {
      for (const factory of input.extensionFactories) {
        factory({
          on: (event: string, handler: (value: unknown) => Promise<unknown>) => {
            if (event === "tool_call") active!.toolHandler = handler;
          },
        } as never);
      }
    }
    return fakeResourceLoader();
  };

  const createAgentSessionFn = async (_options: CreateAgentSessionOptions): Promise<CreateAgentSessionResult> => {
    if (active === undefined) throw new Error("pi-double: session created before resources");
    active.turn.sessionReported = true;
    active.turn.sequence.push("emit:session");
    return {
      session: fakeSession(active) as CreateAgentSessionResult["session"],
      extensionsResult: fakeResourceLoader().getExtensions(),
    };
  };

  const fakeModel = { provider: "anthropic", id: "claude-scripted-model" };
  const runtime = new PiRuntime({
    resourceLoaderFactory: resourceLoaderFactory as never,
    createAgentSessionFn,
    // pi 0.84 folded AuthStorage + ModelRegistry into one async ModelRuntime.
    // The double fakes the SDK object the adapter actually consumes; the
    // registry facade the adapter builds over it reads `getModels()`.
    modelRuntimeFactory: async () => ({ getModels: () => [fakeModel] }) as never,
    sessionManagerFactory: () => ({}) as never,
    agentDir: "/tmp/cormidia-pi-double-agent",
  });
  return { runtime, recorder };
}

function fakeSession(active: {
  scenario: AdapterScenario;
  turn: PiRecordedTurn;
  toolHandler?: (event: unknown) => Promise<unknown>;
}): object {
  const subscribers = new Set<(event: unknown) => void>();
  let stats = statsFor("absent", 0);
  let lastText: string | undefined;
  let aborted = false;
  const emit = (event: unknown): void => {
    for (const subscriber of subscribers) subscriber(event);
  };
  return {
    sessionFile: active.scenario.sessionId,
    sessionId: active.scenario.sessionId,
    subscribe(handler: (event: unknown) => void) {
      subscribers.add(handler);
      return () => subscribers.delete(handler);
    },
    async prompt(task: string) {
      active.turn.promptCalled = true;
      active.turn.promptText = task;
      for (const step of active.scenario.steps ?? []) {
        if (step.step === "usage") {
          stats = statsFor(step.usage, 0);
          active.turn.usageReported = true;
          active.turn.sequence.push("emit:usage");
          emit({ type: "turn_end", message: { role: "assistant", stopReason: "stop" } });
          continue;
        }
        if (step.step === "subagent_started") continue;
        if ((step.channel ?? "hook") === "permission") {
          throw new Error("pi-double: pi has no permission/backstop channel");
        }
        const play: RecordedToolPlay = { step, consultations: [], executed: false };
        active.turn.toolPlays.push(play);
        if (active.toolHandler === undefined) {
          throw new Error("pi-double: gate handler absent at prompt execution");
        }
        active.turn.sequence.push(`consult:hook:${step.tool}`);
        const decision = (await active.toolHandler({
          toolName: step.tool,
          input: step.input,
          ...(step.fromSubagent === true ? { fromSubagent: true } : {}),
        })) as { block?: boolean; reason?: string } | undefined;
        const consultation: RecordedGateConsultation = {
          channel: "hook",
          toolName: step.tool,
          toolInput: step.input,
          allowed: decision?.block !== true,
          reason: decision?.reason,
        };
        play.consultations.push(consultation);
        play.executed = decision?.block !== true;
        if (play.executed) active.turn.sequence.push(`execute:${step.tool}`);
      }
      const outcome = active.scenario.outcome;
      if (outcome.kind === "stream_drop") {
        active.turn.endedBy = "stream_drop";
        throw new Error(outcome.message ?? "scripted pi transport drop");
      }
      if (outcome.kind === "no_result") {
        active.turn.endedBy = "no_result";
        return;
      }
      if (outcome.usage !== "absent") {
        stats = statsFor(outcome.usage, outcome.costUsd);
        active.turn.usageReported = true;
      }
      active.turn.resultDelivered = true;
      active.turn.endedBy = "result";
      if (outcome.kind === "success") {
        lastText = outcome.text;
        emit({ type: "turn_end", message: { role: "assistant", stopReason: "stop" } });
      } else {
        emit({
          type: "message_end",
          message: { role: "assistant", stopReason: "error", errorMessage: outcome.errors.join("; ") },
        });
      }
    },
    getSessionStats: () => stats,
    getLastAssistantText: () => lastText,
    async abort() {
      aborted = true;
    },
    dispose() {
      active.turn.disposed = true;
    },
    get aborted() {
      return aborted;
    },
  };
}

function statsFor(usage: ScriptedUsage | "absent", cost: number) {
  return {
    tokens: {
      input: usage === "absent" ? 0 : usage.inputTokens,
      cacheRead: usage === "absent" ? 0 : (usage.cacheReadTokens ?? 0),
      cacheWrite: usage === "absent" ? 0 : (usage.cacheCreationTokens ?? 0),
      output: usage === "absent" ? 0 : usage.outputTokens,
    },
    cost,
  };
}

function fakeResourceLoader(): ResourceLoader {
  const extensions = {
    extensions: [],
    errors: [],
    runtime: {},
  } as unknown as ReturnType<ResourceLoader["getExtensions"]>;
  return {
    getExtensions: () => extensions,
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => undefined,
    // pi 0.84 added provenance accessors alongside the prompt getters. The
    // adapter writes .pi/APPEND_SYSTEM.md and never reads them back, so the
    // double reports "no source" rather than inventing a path.
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
}
