// Process entry for `pnpm test:acceptance`. Thin on purpose: argv in, exit code
// out, with every decision in campaign-main.ts where it is testable.
import { main } from "./campaign-main.js";

process.exitCode = await main(process.argv.slice(2));
