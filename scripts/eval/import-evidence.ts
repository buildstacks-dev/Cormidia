import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { importSanitizedPromotionEvidence } from "./promotion.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const archiveRoot = option("--archive");
const receiptPath = option("--receipt");
if (!archiveRoot || !receiptPath) throw new Error("usage: pnpm eval:import-evidence -- --archive <schema-v2-archive> --receipt <campaign-archive-receipt>");
console.log(JSON.stringify(importSanitizedPromotionEvidence({ root, archiveRoot, receiptPath }), null, 2));

function option(name: string): string | undefined { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }
