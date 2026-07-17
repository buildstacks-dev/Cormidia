import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeReleaseAttestation } from "./release-attestation.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const campaigns = options("--campaign").map((p) => resolve(p));
if (campaigns.length === 0) throw new Error("usage: pnpm eval:attest-release -- --campaign <committed-sanitized-campaign> [--campaign <soak-campaign>]");
const outPath = option("--out");
console.log(JSON.stringify(writeReleaseAttestation({ root, campaignPaths: campaigns, ...(outPath ? { outPath } : {}) }), null, 2));

function option(name: string): string | undefined { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }
function options(name: string): string[] { return process.argv.flatMap((value, index) => value === name && process.argv[index + 1] ? [process.argv[index + 1]!] : []); }
