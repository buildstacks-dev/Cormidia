import { randomUUID } from "node:crypto";
import { resolveCormidiaHomes } from "../org/home.js";
import { beginCliInvocation, finishCliInvocation } from "../runtime/invocation-ledger.js";
import { scrubSecrets } from "../runtime/runlog/redact.js";

interface AuditJobInvocationOptions {
  stateHome?: string;
  now?: () => Date;
}

/** Give the second packaged binary the same crash-durable command audit as the
 * primary CLI without importing the higher-ranked src/cli layer. */
export async function auditJobInvocation(
  argv: string[],
  run: () => Promise<number>,
  options: AuditJobInvocationOptions = {},
): Promise<number> {
  if (argv[0] !== "run") return run();
  const stateHome = options.stateHome ?? (await resolveCormidiaHomes()).stateHome;
  const clock = options.now ?? (() => new Date());
  const started = clock();
  const invocationId = `cli-${randomUUID()}`;
  await beginCliInvocation(stateHome, {
    schema_version: 2,
    at: started.toISOString(),
    kind: "cli",
    invocationId,
    command: "cormidia-job",
    subcommand: "run",
    argv: argv.map(scrubSecrets),
    dryRun: false,
  });
  const exitCode = await run();
  const finished = clock();
  await finishCliInvocation(stateHome, {
    schema_version: 2,
    at: started.toISOString(),
    finishedAt: finished.toISOString(),
    kind: "cli",
    invocationId,
    command: "cormidia-job",
    subcommand: "run",
    argv: argv.map(scrubSecrets),
    dryRun: false,
    outcome: exitCode === 0 ? "completed" : `failed: exit ${exitCode}`,
    exitCode,
    wallClockMs: Math.max(0, finished.getTime() - started.getTime()),
  });
  return exitCode;
}
