import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { executeAppPromotion, planAppPromotion } from "../../src/org/app-lifecycle.js";
import { executeAppReset, planAppReset } from "../../src/org/app-reset.js";
import { joinExistingOrg, loadApps } from "../../src/org/apps.js";
import { executeOrgUpgrade, planOrgUpgrade } from "../../src/org/org-upgrade.js";
import { hashTree } from "../../scripts/eval/core.js";
import { FakeGhOps } from "../support/fakeGhOps.js";
import { bootstrapReachable, makeLifecycleTestWorld, type LifecycleTestWorld } from "./helpers.js";

const worlds: LifecycleTestWorld[] = [];
afterEach(() => { for (const world of worlds.splice(0)) world.cleanup(); });

describe("C-LIFE-04 app isolation", () => {
  it("upgrade, promotion, and reset of one app preserve every second-app byte and policy", async () => {
    const world = await makeLifecycleTestWorld(); worlds.push(world);
    await bootstrapReachable(world);
    await joinExistingOrg(world.orgHome, { name: "second", repo: "local/second", status: "live", cadence: {} });
    const secondRoot = join(world.stateHome, "repos", "second");
    mkdirSync(secondRoot, { recursive: true });
    writeFileSync(join(secondRoot, "sentinel"), "second-app-owned\n");
    const secondBefore = hashTree(secondRoot);
    const secondEntryBefore = (await loadApps(join(world.orgHome, "apps.yaml"))).apps.find((app) => app.name === "second");

    const upgradeInput = { orgHome: world.orgHome, stateHome: world.stateHome, authorityChoice: "preserve" as const, archiveRoot: world.archives };
    expect((await executeOrgUpgrade(upgradeInput, await planOrgUpgrade(upgradeInput))).status).toBe("up_to_date");
    const promoteInput = { orgHome: world.orgHome, stateHome: world.stateHome, appName: "sparse", to: "live" as const };
    expect((await executeAppPromotion(promoteInput, await planAppPromotion(promoteInput))).status).toBe("promoted");

    const resetInput = { orgHome: world.orgHome, stateHome: world.stateHome, appsFile: await loadApps(join(world.orgHome, "apps.yaml")), appName: "sparse", gh: new FakeGhOps({ repo: "local/sparse" }), archiveRoot: world.archives };
    await executeAppReset(resetInput, await planAppReset(resetInput));
    expect(hashTree(secondRoot)).toBe(secondBefore);
    expect(readFileSync(join(secondRoot, "sentinel"), "utf8")).toBe("second-app-owned\n");
    expect((await loadApps(join(world.orgHome, "apps.yaml"))).apps.find((app) => app.name === "second")).toEqual(secondEntryBefore);
    expect(existsSync(join(world.stateHome, "repos", "sparse"))).toBe(false);
  });
});
