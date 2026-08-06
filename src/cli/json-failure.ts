import { NoActiveOrgError } from "../org/home.js";
import { reportCliInvocationFailure } from "./invocation-audit.js";
import { definedProps } from "../runtime/optional-properties.js";

interface JsonCliFailureEnvelope {
  schema_version: 1;
  ok: false;
  error: {
    code: string;
    message: string;
    remediation: string;
  };
}

/** Convert an expected typed failure, or an unexpected thrown value, into the
 * one top-level JSON failure contract. Unknown errors keep their existing
 * diagnostic as the message but never escape as bare text in JSON mode. */
export function jsonCliFailure(error: unknown, command: string): JsonCliFailureEnvelope {
  if (error instanceof NoActiveOrgError) {
    return {
      schema_version: 1,
      ok: false,
      error: {
        code: error.code,
        message: error.publicMessage,
        remediation: error.remediation,
      },
    };
  }

  return {
    schema_version: 1,
    ok: false,
    error: {
      code: "command_failed",
      message: error instanceof Error ? error.message : String(error),
      remediation: `Run \`cormidia ${command} --help\` and correct the invocation or configuration.`,
    },
  };
}

type OutputChannel = "stdout" | "stderr";
type OutputCall =
  | { kind: "console"; channel: OutputChannel; values: unknown[] }
  | { kind: "write"; channel: OutputChannel; chunk: string | Buffer; encoding?: BufferEncoding };

type WriteCallback = (error?: Error | null) => void;

/**
 * Hold JSON-mode console output and raw stdout/stderr writes until the command
 * has finished. On success it is replayed unchanged. On a throw, every partial
 * write is discarded and replaced by exactly one JSON document on stdout.
 */
export async function runJsonCliCommand(command: string, run: () => number | Promise<number>): Promise<number> {
  const originalLog = console.log;
  const originalError = console.error;
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  const calls: OutputCall[] = [];
  let restored = false;

  const restore = (): void => {
    if (restored) return;
    console.log = originalLog;
    console.error = originalError;
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    restored = true;
  };

  console.log = (...values: unknown[]): void => {
    calls.push({ kind: "console", channel: "stdout", values });
  };
  console.error = (...values: unknown[]): void => {
    calls.push({ kind: "console", channel: "stderr", values });
  };
  process.stdout.write = bufferedWrite("stdout", calls) as typeof process.stdout.write;
  process.stderr.write = bufferedWrite("stderr", calls) as typeof process.stderr.write;

  try {
    const code = await run();
    restore();
    for (const call of calls) {
      if (call.kind === "console") {
        if (call.channel === "stdout") originalLog(...call.values);
        else originalError(...call.values);
      } else if (call.channel === "stdout") {
        replayWrite(process.stdout, originalStdoutWrite, call);
      } else {
        replayWrite(process.stderr, originalStderrWrite, call);
      }
    }
    return code;
  } catch (error) {
    reportCliInvocationFailure(error);
    restore();
    originalLog(JSON.stringify(jsonCliFailure(error, command), null, 2));
    return 1;
  } finally {
    restore();
  }
}

function bufferedWrite(
  channel: OutputChannel,
  calls: OutputCall[],
): (
  chunk: string | Uint8Array,
  encodingOrCallback?: BufferEncoding | WriteCallback,
  callback?: WriteCallback,
) => boolean {
  return (chunk, encodingOrCallback, callback) => {
    const encoding = typeof encodingOrCallback === "string" ? encodingOrCallback : undefined;
    const done = typeof encodingOrCallback === "function" ? encodingOrCallback : callback;
    calls.push({
      kind: "write",
      channel,
      chunk: typeof chunk === "string" ? chunk : Buffer.from(chunk),
      ...definedProps({ encoding }),
    });
    done?.();
    return true;
  };
}

function replayWrite(
  stream: NodeJS.WriteStream,
  write: NodeJS.WriteStream["write"],
  call: Extract<OutputCall, { kind: "write" }>,
): void {
  if (typeof call.chunk === "string" && call.encoding !== undefined) {
    write.call(stream, call.chunk, call.encoding);
  } else {
    write.call(stream, call.chunk);
  }
}
