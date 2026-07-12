import { writeFile } from "node:fs/promises";

const receipt = process.env.OPERON_EVAL_EFFECT_RECEIPT;
if (!receipt) throw new Error("eval effect receipt path required");
await writeFile(receipt, JSON.stringify({ effect: "deploy", target: "eval-recorder", at: "fixture-clock" }) + "\n", { flag: "wx" });
