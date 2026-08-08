// `cormidia-job` process entry: audited argv in, actionable exit code out.

import { cmdJob, describeJobError } from "./cli.js";
import { auditJobInvocation } from "./invocation-audit.js";

export async function main(argv: string[]): Promise<number> {
  return auditJobInvocation(argv, async () => {
    try {
      return await cmdJob(argv);
    } catch (error) {
      process.stderr.write(`${describeJobError(error)}\n`);
      return 1;
    }
  });
}

process.exitCode = await main(process.argv.slice(2));
