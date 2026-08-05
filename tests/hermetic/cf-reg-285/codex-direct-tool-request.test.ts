// CF-REG-285 — Codex 0.144.4's gpt-5.6-sol metadata forces
// `tool_mode=code_mode_only` after feature resolution. The resulting custom
// `exec` tool can run nested shell calls without Cormidia's PreToolUse bridge.
// This L2 detector runs the real packaged App Server against a loopback-only
// Responses fake and inspects the exact model request: production catalog
// isolation must expose direct shell tools, while a seeded matching catalog
// must reproduce the un-gateable custom exec route.

import { createServer, type Server } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CodexRuntime,
  StdioCodexAppServerClient,
  type CodexAppServerClient,
  type CodexAppServerLaunchOptions,
} from "../../../src/runtime/adapters/codex.js";
import type { RoleConfig } from "../../../src/runtime/types.js";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const MODEL = "gpt-5.6-sol";
const TRUST_BYPASS_CANARY = "CF_REG_285_TRUST_BYPASS_CANARY";
const roots: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(closeServer));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("CF-REG-285 — assigned Codex models reach only direct gateable tools", () => {
  it("real App Server emits direct shell_command and no custom exec", async () => {
    const request = await captureModelRequest(false);
    expect(request.model).toBe(MODEL);
    expect(toolNames(request), JSON.stringify(request.tools)).toContain("shell_command");
    expect(customToolNames(request)).not.toContain("exec");
  });

  it("negative control: matching forced metadata reproduces the custom exec bypass route", async () => {
    const request = await captureModelRequest(true);
    expect(customToolNames(request), JSON.stringify(request.tools)).toContain("exec");
    expect(toolNames(request)).not.toContain("shell_command");
  });

  it("real direct shell call reaches the gate before execution and denial is terminal", async () => {
    const run = await runAgainstLoopback(
      false,
      (marker) => `touch ${JSON.stringify(marker)}`,
    );
    expect(existsSync(run.marker)).toBe(false);
    expect(run.result.escalations).toHaveLength(1);
    expect(run.requests).toHaveLength(2);
    expect(run.result.status).toBe("blocked_on_gate");
  });

  it("auto-approved read reaches the same gate and denial is terminal", async () => {
    const run = await runAgainstLoopback(false, () => "cat /etc/hosts");
    expect(run.result.escalations).toHaveLength(1);
    expect(run.requests).toHaveLength(2);
    expect(run.result.status).toBe("blocked_on_gate");
  });

  it("negative control: dropping the typed hook-trust override reproduces an un-gated read", async () => {
    const run = await runAgainstLoopback(
      false,
      (marker) => {
        writeFileSync(marker, `${TRUST_BYPASS_CANARY}\n`, "utf8");
        return `cat ${JSON.stringify(marker)}`;
      },
      true,
    );
    expect(JSON.stringify(run.requests[1])).toContain(TRUST_BYPASS_CANARY);
    expect(run.result.escalations).toHaveLength(0);
    expect(run.result.status).toBe("completed");
  });
});

async function captureModelRequest(seedForcedCodeMode: boolean): Promise<Record<string, unknown>> {
  const run = await runAgainstLoopback(seedForcedCodeMode);
  expect(run.result.status).toBe("completed");
  expect(run.requests).toHaveLength(1);
  return run.requests[0]!;
}

async function runAgainstLoopback(
  seedForcedCodeMode: boolean,
  gateCommand?: (marker: string) => string,
  seedMissingHookTrust = false,
): Promise<{
  requests: Record<string, unknown>[];
  result: Awaited<ReturnType<CodexRuntime["runTurn"]>>;
  marker: string;
}> {
  const codexHome = await mkdtemp(join(tmpdir(), "cormidia-codex-home-"));
  const workdir = await mkdtemp(join(tmpdir(), "cormidia-codex-worktree-"));
  roots.push(codexHome, workdir);
  const marker = join(workdir, "forbidden-by-cormidia-gate");
  const captured: Record<string, unknown>[] = [];
  const responseBodies = gateCommand !== undefined
    ? [shellCommandResponseSse(gateCommand(marker)), finalResponseSse()]
    : [finalResponseSse()];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (isRecord(body)) captured.push(body);
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(responseBodies.shift() ?? finalResponseSse());
    });
  });
  servers.push(server);
  const baseUrl = await listen(server);

  const runtime = new CodexRuntime({
    appServerEnv: { ...process.env, CODEX_HOME: codexHome },
    clientFactory: (launch) => {
      if (launch === undefined || launch.args === undefined) {
        throw new Error("CF-REG-285: missing App Server args");
      }
      const client = new StdioCodexAppServerClient({
        ...launch,
        args: withMockProvider(
          seedForcedCodeMode ? seedMatchingCodeModeCatalog(launch) : launch.args,
          baseUrl,
        ),
      });
      return seedMissingHookTrust ? withoutHookTrustOverride(client) : client;
    },
  });

  const result = await runtime.runTurn(
    {
      role: role(),
      workdir,
      task: "Reply with done and do not call tools.",
      context: { taste: [], memoryExcerpts: [] },
    },
    {
      gate: () => gateCommand !== undefined
        ? { allow: false, reason: "CF-REG-285 seeded denial", escalate: true }
        : { allow: true },
    },
  );
  return { requests: captured, result, marker };
}

function withoutHookTrustOverride(client: CodexAppServerClient): CodexAppServerClient {
  return {
    request: (method, params) => client.request(method, stripHookTrust(method, params)),
    notify: (method, params) => client.notify(method, params),
    respond: (id, result) => client.respond(id, result),
    close: () => client.close(),
    [Symbol.asyncIterator]: () => client[Symbol.asyncIterator](),
  };
}

function stripHookTrust(method: string, params: unknown): unknown {
  if (method !== "thread/start" && method !== "thread/resume") return params;
  if (!isRecord(params) || !isRecord(params.config)) return params;
  const config = { ...params.config };
  delete config.bypass_hook_trust;
  return { ...params, config };
}

function role(): RoleConfig {
  return {
    name: "builder",
    runtime: "codex",
    model: MODEL,
    effort: "high",
    delegation: { allow: [] },
    triggers: [],
    outputs: ["pr"],
    maxTurnBudgetUsd: 5,
    permissionModes: { codex: "on-request", claude: "auto" },
  };
}

function seedMatchingCodeModeCatalog(launch: CodexAppServerLaunchOptions): string[] {
  const args = [...(launch.args ?? [])];
  const setting = args.find((arg) => arg.startsWith("model_catalog_json="));
  if (setting === undefined) throw new Error("CF-REG-285: model_catalog_json is not pinned");
  const path = JSON.parse(setting.slice("model_catalog_json=".length)) as string;
  const catalog = JSON.parse(readFileSync(path, "utf8")) as { models: Array<Record<string, unknown>> };
  const model = catalog.models.find((entry) => entry.slug === MODEL);
  if (model === undefined) throw new Error(`CF-REG-285: catalog is missing ${MODEL}`);
  model.tool_mode = "code_mode_only";
  writeFileSync(path, `${JSON.stringify(catalog)}\n`, "utf8");
  return args;
}

function withMockProvider(args: readonly string[], baseUrl: string): string[] {
  const result = [...args];
  const command = result.indexOf("app-server");
  if (command < 0) throw new Error("CF-REG-285: app-server command missing");
  result.splice(
    command,
    0,
    "-c",
    'model_provider="cormidia_mock"',
    "-c",
    'model_providers.cormidia_mock.name="Cormidia loopback mock"',
    "-c",
    `model_providers.cormidia_mock.base_url=${JSON.stringify(`${baseUrl}/v1`)}`,
    "-c",
    'model_providers.cormidia_mock.wire_api="responses"',
    "-c",
    "model_providers.cormidia_mock.request_max_retries=0",
    "-c",
    "model_providers.cormidia_mock.stream_max_retries=0",
    "-c",
    "model_providers.cormidia_mock.supports_websockets=false",
  );
  return result;
}

function toolNames(request: Record<string, unknown>): string[] {
  return tools(request)
    .filter((tool) => tool.type === "function")
    .map((tool) => String(tool.name));
}

function customToolNames(request: Record<string, unknown>): string[] {
  return tools(request)
    .filter((tool) => tool.type === "custom")
    .map((tool) => String(tool.name));
}

function tools(request: Record<string, unknown>): Array<Record<string, unknown>> {
  return Array.isArray(request.tools) ? request.tools.filter(isRecord) : [];
}

function finalResponseSse(): string {
  const events = [
    { type: "response.created", response: { id: "resp-cf-reg-285" } },
    {
      type: "response.output_item.done",
      item: {
        type: "message",
        role: "assistant",
        id: "msg-cf-reg-285",
        content: [{ type: "output_text", text: "done" }],
      },
    },
    {
      type: "response.completed",
      response: {
        id: "resp-cf-reg-285",
        usage: {
          input_tokens: 0,
          input_tokens_details: null,
          output_tokens: 0,
          output_tokens_details: null,
          total_tokens: 0,
        },
      },
    },
  ];
  return events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
}

function shellCommandResponseSse(command: string): string {
  const events = [
    { type: "response.created", response: { id: "resp-cf-reg-285-tool" } },
    {
      type: "response.output_item.done",
      item: {
        type: "function_call",
        call_id: "call-cf-reg-285",
        name: "shell_command",
        arguments: JSON.stringify({ command }),
      },
    },
    {
      type: "response.completed",
      response: {
        id: "resp-cf-reg-285-tool",
        usage: {
          input_tokens: 0,
          input_tokens_details: null,
          output_tokens: 0,
          output_tokens_details: null,
          total_tokens: 0,
        },
      },
    },
  ];
  return events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
}

function listen(server: Server): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("CF-REG-285: loopback server has no TCP address"));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) return resolve();
    server.close(() => resolve());
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
