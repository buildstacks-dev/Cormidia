// `cormidia-job` process entry. Mirrors src/cli.ts's shape for the main binary:
// argv in, exit code out, typed errors rendered with an actionable next step.
// The launcher shim (src/cormidia-job.cjs) imports the built form of this file,
// which sets process.exitCode on import exactly as dist/cli.js does.

import { cmdJob, describeJobError } from "./cli.js";

export async function main(argv: string[]): Promise<number> {
  try {
    return await cmdJob(argv);
  } catch (error) {
    process.stderr.write(`${describeJobError(error)}\n`);
    return 1;
  }
}

process.exitCode = await main(process.argv.slice(2));
