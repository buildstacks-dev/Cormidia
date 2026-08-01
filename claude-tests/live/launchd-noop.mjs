// Harmless executable payload for CF-J16-A. RunAtLoad writes one attributable
// marker inside the exact temporary state home, proving the loaded definition
// actually ticked without dispatching an org or spending provider tokens.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const valueAfter = (flag) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const stateHome = valueAfter("--state-home");
const orgHome = valueAfter("--org-home");
if (stateHome === undefined || orgHome === undefined) throw new Error("launchd proof payload requires exact org/state homes");
const marker = join(stateHome, "scheduler", "launchd-proof-tick.json");
await mkdir(dirname(marker), { recursive: true });
await writeFile(marker, `${JSON.stringify({ schema_version: 1, at: new Date().toISOString(), pid: process.pid, org_home: orgHome, state_home: stateHome }, null, 2)}\n`, "utf8");
