// Cooperative process-signal ownership for live CLI commands.
//
// Node's default SIGINT/SIGTERM behavior exits immediately. That prevents the
// pass executor from finalizing its envelope and gives embedded runtimes no
// chance to stop their own descendants. Live commands install this bridge,
// pass its AbortSignal through every orchestration layer, and dispose it once
// their durable terminal state has been written.

interface ProcessCancellation {
  signal: AbortSignal;
  /** Conventional shell exit code (130 SIGINT, 143 SIGTERM), once signalled. */
  readonly exitCode: number | undefined;
  dispose(): void;
}

export function installProcessCancellation(): ProcessCancellation {
  const controller = new AbortController();
  let exitCode: number | undefined;

  const cancel = (name: "SIGINT" | "SIGTERM"): void => {
    if (controller.signal.aborted) return;
    exitCode = name === "SIGINT" ? 130 : 143;
    controller.abort({
      status: "cancelled",
      errorCode: "error_cancelled",
      reason: `operator cancellation (${name})`,
    });
  };
  const onSigint = (): void => cancel("SIGINT");
  const onSigterm = (): void => cancel("SIGTERM");
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);

  return {
    signal: controller.signal,
    get exitCode(): number | undefined {
      return exitCode;
    },
    dispose(): void {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
    },
  };
}

export function waitForDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}
