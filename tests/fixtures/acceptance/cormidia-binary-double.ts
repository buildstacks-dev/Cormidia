// fixtures/acceptance/cormidia-binary-double.ts — a scripted stand-in for the
// packaged `cormidia` / `cormidia-job` binaries, written OUTSIDE the checkout
// and spawned as a real process.
//
// Outside the checkout matters: `createCliDriver` refuses a binary that
// realpaths inside this repository, because that is what a source-backed
// `link:local` install looks like. A double planted under `tests/` would be
// refused by the very check it exists to exercise — so the double lives in a
// temp root, which is also where a real npm-global install lives relative to
// the checkout.
//
// It records argv to a JSONL sidecar so a test can assert what the campaign
// actually invoked, not merely what it meant to.

import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** One scripted response, matched by the first argv token that names a command. */
export interface ScriptedCliResponse {
  /** Match when this string appears anywhere in argv (e.g. "plan", "loop"). */
  whenArgvIncludes: string;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
}

export interface CormidiaBinaryDouble {
  /** Absolute path to the scripted `cormidia`. */
  cormidiaPath: string;
  /** Absolute path to the scripted `cormidia-job`. */
  cormidiaJobPath: string;
  /** Root the doubles live in — outside any checkout. */
  root: string;
  /** Every argv the doubles were actually spawned with, in order. */
  invocations(): Promise<Array<{ binary: string; argv: string[] }>>;
  cleanup(): Promise<void>;
}

function script(binary: string, responses: readonly ScriptedCliResponse[], logPath: string): string {
  return [
    "#!/usr/bin/env node",
    `const fs = require("node:fs");`,
    `const argv = process.argv.slice(2);`,
    `fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify({ binary: ${JSON.stringify(binary)}, argv }) + "\\n");`,
    `const responses = ${JSON.stringify(responses)};`,
    `const hit = responses.find((r) => argv.includes(r.whenArgvIncludes));`,
    `if (hit === undefined) {`,
    `  process.stderr.write(${JSON.stringify(binary)} + ": no scripted response for " + argv.join(" ") + "\\n");`,
    `  process.exit(64);`,
    `}`,
    `if (hit.stdout) process.stdout.write(hit.stdout);`,
    `if (hit.stderr) process.stderr.write(hit.stderr);`,
    `process.exit(hit.exitCode || 0);`,
    "",
  ].join("\n");
}

export async function makeCormidiaBinaryDouble(
  responses: readonly ScriptedCliResponse[] = [],
): Promise<CormidiaBinaryDouble> {
  const root = await mkdtemp(join(tmpdir(), "cormidia-bin-double-"));
  const logPath = join(root, "invocations.jsonl");
  await writeFile(logPath, "", "utf8");
  const cormidiaPath = join(root, "cormidia");
  const cormidiaJobPath = join(root, "cormidia-job");
  await writeFile(cormidiaPath, script("cormidia", responses, logPath), "utf8");
  await writeFile(cormidiaJobPath, script("cormidia-job", responses, logPath), "utf8");
  await chmod(cormidiaPath, 0o755);
  await chmod(cormidiaJobPath, 0o755);

  return {
    cormidiaPath,
    cormidiaJobPath,
    root,
    async invocations() {
      const text = await readFile(logPath, "utf8");
      return text
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as { binary: string; argv: string[] });
    },
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
    },
  };
}
