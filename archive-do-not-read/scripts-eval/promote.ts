import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeContractEvidenceProjections } from "./promotion.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const campaignPath = option("--campaign");
const attestationPath = option("--attestation");
if (!campaignPath || !attestationPath) throw new Error("usage: pnpm eval:promote -- --campaign <committed-sanitized-campaign> --attestation <release-attestation>");
console.log(JSON.stringify(writeContractEvidenceProjections({ root, campaignPath, attestationPath }), null, 2));

function option(name: string): string | undefined { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }
