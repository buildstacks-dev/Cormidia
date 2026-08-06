#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import {
  captureSoakCheckpoint,
  finishSoak,
  loadSoakConfig,
  startSoak,
  type SoakRotationEvidenceV1,
} from "./soak-protocol.js";
import { assertCampaignRepositoryBinding } from "../campaign/repository-binding.js";

async function main(): Promise<void> {
  const config = await loadSoakConfig();
  await assertCampaignRepositoryBinding({ commit: config.commit, policyPath: config.policy_path });
  const [verb, ...args] = process.argv.slice(2);
  if (verb === "start") {
    const state = await startSoak(config);
    console.log(
      JSON.stringify({ campaign_id: state.campaign_id, status: "running", started_at: state.started_at }, null, 2),
    );
    return;
  }
  if (verb === "checkpoint") {
    const values = flags(args);
    const rotation =
      values["rotation-evidence"] === undefined ? undefined : await loadRotation(values["rotation-evidence"]);
    const state = await captureSoakCheckpoint(config, {
      checkpointId: required(values["id"], "--id"),
      ...(values["slept-at"] === undefined ? {} : { sleptAt: values["slept-at"] }),
      ...(values["woke-at"] === undefined ? {} : { wokeAt: values["woke-at"] }),
      ...(rotation === undefined ? {} : { rotation }),
    });
    console.log(
      JSON.stringify(
        { campaign_id: state.campaign_id, checkpoints: state.checkpoints.length, last: state.checkpoints.at(-1) },
        null,
        2,
      ),
    );
    return;
  }
  if (verb === "finish") {
    const report = await finishSoak(config);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.outcome.verdict === "pass" ? 0 : report.outcome.verdict === "fail" ? 1 : 2;
    return;
  }
  throw new Error(
    "usage: soak-cli.ts start | checkpoint --id ID [--slept-at ISO --woke-at ISO] [--rotation-evidence /absolute/file.json] | finish",
  );
}

function flags(args: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (key === undefined || value === undefined || !key.startsWith("--"))
      throw new Error("soak checkpoint flags require --name value pairs");
    out[key.slice(2)] = value;
  }
  return out;
}

async function loadRotation(path: string): Promise<SoakRotationEvidenceV1> {
  if (!isAbsolute(path)) throw new Error("--rotation-evidence must be absolute");
  return JSON.parse(await readFile(resolve(path), "utf8")) as SoakRotationEvidenceV1;
}

function required(value: string | undefined, name: string): string {
  if (value === undefined || value.trim() === "") throw new Error(`${name} is required`);
  return value;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
