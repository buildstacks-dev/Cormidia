import { createReadStream, existsSync } from "node:fs";
import { lstat, realpath, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { dirname, join, resolve, sep } from "node:path";
import { OBSERVE_CSS, OBSERVE_HTML, OBSERVE_JS } from "./assets.js";
import type { ObserveService } from "./live-source.js";

const LOOPBACK_HOST = "127.0.0.1";
const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

export interface ObserveServerOptions {
  service: ObserveService;
  stateHome: string;
  token?: string;
  artifactLimitBytes?: number;
}

export interface StartedObserveServer {
  server: Server;
  host: typeof LOOPBACK_HOST;
  port: number;
  token: string;
  url: string;
  close(): Promise<void>;
}

export function mintCapabilityToken(): string {
  return randomBytes(32).toString("base64url");
}

export function createObserveServer(options: ObserveServerOptions): { server: Server; token: string } {
  const token = options.token ?? mintCapabilityToken();
  const server = createServer((request, response) => {
    void route(request, response, { ...options, token }).catch((error) => {
      const status = error instanceof HttpError ? error.status : 500;
      if (!response.headersSent) writeHeaders(response, status, "application/json; charset=utf-8");
      if (!response.writableEnded) response.end(JSON.stringify({ error: safeError(error) }));
    });
  });
  return { server, token };
}

export async function startObserveServer(
  options: ObserveServerOptions & { port?: number },
): Promise<StartedObserveServer> {
  const { server, token } = createObserveServer(options);
  const requestedPort = options.port ?? 41730;
  let port = requestedPort;
  try {
    port = await listen(server, requestedPort);
  } catch (error) {
    if (requestedPort === 0 || !isAddressInUse(error)) throw error;
    port = await listen(server, 0);
  }
  const url = `http://${LOOPBACK_HOST}:${port}/?token=${encodeURIComponent(token)}`;
  return {
    server,
    host: LOOPBACK_HOST,
    port,
    token,
    url,
    close: () => closeServer(server),
  };
}

async function route(
  request: IncomingMessage,
  response: ServerResponse,
  options: ObserveServerOptions & { token: string },
): Promise<void> {
  const method = request.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") {
    writeHeaders(response, 405, "application/json; charset=utf-8", { Allow: "GET, HEAD" });
    response.end(JSON.stringify({ error: "method_not_allowed", read_only: true }));
    return;
  }
  const url = new URL(request.url ?? "/", `http://${LOOPBACK_HOST}`);
  if (!authorized(request, url, options.token)) {
    writeHeaders(response, 401, "application/json; charset=utf-8");
    response.end(JSON.stringify({ error: "capability_required" }));
    return;
  }
  const cookie = url.searchParams.get("token") === options.token
    ? { "Set-Cookie": `operon_observe=${encodeURIComponent(options.token)}; HttpOnly; SameSite=Strict; Path=/` }
    : undefined;

  if (url.pathname === "/" || url.pathname === "/index.html") {
    sendText(response, method, 200, "text/html; charset=utf-8", OBSERVE_HTML, cookie);
    return;
  }
  if (url.pathname === "/assets/observe.css") {
    sendText(response, method, 200, "text/css; charset=utf-8", OBSERVE_CSS);
    return;
  }
  if (url.pathname === "/assets/observe.js") {
    sendText(response, method, 200, "text/javascript; charset=utf-8", OBSERVE_JS);
    return;
  }
  if (url.pathname === "/healthz") {
    sendJson(response, method, 200, { status: "ok", read_only: true, schema_version: 1, cursor: options.service.snapshot().cursor });
    return;
  }
  if (url.pathname === "/api/v1/snapshot") {
    sendJson(response, method, 200, options.service.snapshot());
    return;
  }
  if (url.pathname === "/api/v1/events") {
    if (method === "HEAD") {
      writeHeaders(response, 200, "text/event-stream; charset=utf-8");
      response.end();
      return;
    }
    writeHeaders(response, 200, "text/event-stream; charset=utf-8", {
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    response.write("retry: 1000\n\n");
    const lastEventId = request.headers["last-event-id"];
    options.service.subscribe(
      response,
      url.searchParams.get("cursor") ?? (Array.isArray(lastEventId) ? lastEventId[0] : lastEventId),
    );
    return;
  }
  const artifact = /^\/api\/v1\/artifacts\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(url.pathname);
  if (artifact !== null) {
    await serveRunArtifact(response, method, options, decodeSegment(artifact[1]!), decodeSegment(artifact[2]!), decodeSegment(artifact[3]!));
    return;
  }
  const task = /^\/api\/v1\/tasks\/([^/]+)\/([^/]+)$/.exec(url.pathname);
  if (task !== null) {
    await serveTaskArtifact(response, method, options, decodeSegment(task[1]!), decodeSegment(task[2]!));
    return;
  }
  writeHeaders(response, 404, "application/json; charset=utf-8");
  response.end(JSON.stringify({ error: "not_found" }));
}

async function serveRunArtifact(
  response: ServerResponse,
  method: string,
  options: ObserveServerOptions,
  app: string,
  runId: string,
  kind: string,
): Promise<void> {
  assertId(app, "app");
  assertId(runId, "run");
  const allowlist: Record<string, string> = {
    envelope: "envelope.json",
    events: "events.jsonl",
    brief: "brief.md",
    prompt: "prompt.md",
    output: "output.md",
    activity_log: "session.log",
  };
  const filename = allowlist[kind];
  if (filename === undefined) throw new HttpError(404, "unknown_artifact");
  await serveSafeFile(response, method, options, join("runs", app, runId, filename), filename);
}

async function serveTaskArtifact(
  response: ServerResponse,
  method: string,
  options: ObserveServerOptions,
  taskId: string,
  kind: string,
): Promise<void> {
  assertId(taskId, "task");
  const allowlist: Record<string, string> = { prompt: "prompt.md", task: "task.json" };
  const filename = allowlist[kind];
  if (filename === undefined) throw new HttpError(404, "unknown_artifact");
  await serveSafeFile(response, method, options, join("tasks", taskId, filename), filename);
}

async function serveSafeFile(
  response: ServerResponse,
  method: string,
  options: ObserveServerOptions,
  relative: string,
  filename: string,
): Promise<void> {
  const root = await realpath(resolve(options.stateHome));
  const target = resolve(root, relative);
  if (target !== root && !target.startsWith(`${root}${sep}`)) throw new HttpError(403, "path_outside_state_home");
  if (!existsSync(target)) throw new HttpError(404, "artifact_not_found");
  await rejectSymlinkComponents(root, target);
  const actual = await realpath(target);
  if (actual !== root && !actual.startsWith(`${root}${sep}`)) throw new HttpError(403, "symlink_escape");
  const info = await stat(actual);
  if (!info.isFile()) throw new HttpError(404, "artifact_not_file");
  if (info.size > (options.artifactLimitBytes ?? MAX_ARTIFACT_BYTES)) throw new HttpError(413, "artifact_too_large");
  writeHeaders(response, 200, "text/plain; charset=utf-8", {
    "Content-Length": String(info.size),
    "Content-Disposition": `inline; filename="${filename.replace(/[^A-Za-z0-9._-]/g, "-")}"`,
  });
  if (method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(actual).on("error", () => response.destroy()).pipe(response);
}

async function rejectSymlinkComponents(root: string, target: string): Promise<void> {
  let current = root;
  const relative = target.slice(root.length).split(sep).filter(Boolean);
  for (const segment of relative) {
    current = join(current, segment);
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new HttpError(403, "symlink_escape");
  }
}

function authorized(request: IncomingMessage, url: URL, expected: string): boolean {
  const query = url.searchParams.get("token");
  const bearer = request.headers.authorization?.startsWith("Bearer ")
    ? request.headers.authorization.slice("Bearer ".length)
    : undefined;
  const cookie = parseCookie(request.headers.cookie ?? "")["operon_observe"];
  for (const candidate of [query, bearer, cookie]) {
    if (candidate !== undefined && candidate !== null && secureEqual(candidate, expected)) return true;
  }
  return false;
}

function parseCookie(value: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of value.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    try {
      out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      // Invalid cookie encoding cannot authenticate.
    }
  }
  return out;
}

function secureEqual(candidate: string, expected: string): boolean {
  const left = Buffer.from(candidate);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function writeHeaders(response: ServerResponse, status: number, contentType: string, extra: Record<string, string> = {}): void {
  response.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store, max-age=0",
    Pragma: "no-cache",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    "Cross-Origin-Resource-Policy": "same-origin",
    ...extra,
  });
}

function sendText(response: ServerResponse, method: string, status: number, type: string, body: string, extra?: Record<string, string>): void {
  writeHeaders(response, status, type, { "Content-Length": String(Buffer.byteLength(body)), ...(extra ?? {}) });
  response.end(method === "HEAD" ? undefined : body);
}

function sendJson(response: ServerResponse, method: string, status: number, body: unknown): void {
  sendText(response, method, status, "application/json; charset=utf-8", `${JSON.stringify(body)}\n`);
}

function assertId(value: string, kind: string): void {
  if (!ID_RE.test(value) || value === "." || value === "..") throw new HttpError(400, `invalid_${kind}_id`);
}

function decodeSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new HttpError(400, "invalid_path_encoding");
  }
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once("error", onError);
    server.listen(port, LOOPBACK_HOST, () => {
      server.off("error", onError);
      const address = server.address();
      if (address === null || typeof address === "string") return reject(new Error("observer did not bind a TCP address"));
      if (address.address !== LOOPBACK_HOST) return reject(new Error(`observer refused non-loopback bind ${address.address}`));
      resolvePromise(address.port);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolvePromise, reject) => server.close((error) => error === undefined ? resolvePromise() : reject(error)));
}

function isAddressInUse(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as NodeJS.ErrnoException).code === "EADDRINUSE";
}

function safeError(error: unknown): string {
  if (error instanceof HttpError) return error.code;
  return error instanceof Error ? error.message : String(error);
}

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}
