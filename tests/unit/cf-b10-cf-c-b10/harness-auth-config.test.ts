// Traceability: CF-B10 · CF-C-B10 · HB-014; the `harnesses:` declaration (#333), L1.
//
// Auth binds to the (harness × provider-family) CONNECTION, never to the
// model: the same Opus can be reached on the operator's Claude subscription
// through `claude` and on an Anthropic API key through `opencode`, in one org,
// at the same time. These cases pin that the config shape can say exactly that
// and refuses everything that cannot be true.
//
// Layer: 1 (unit). Zero network, zero tokens, zero adapters.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadApps } from "../../../src/org/apps.js";
import { describeHarnessAuth, harnessAuthYaml, parseHarnessAuthConfig } from "../../../src/org/harness-auth-config.js";
import { HARNESS_AUTH_SUPPORT, declaredAuthMode } from "../../../src/runtime/auth-mode.js";
import { RUNTIME_KINDS } from "../../../src/runtime/registry.js";

const err = (message: string): Error => new Error(message);

const temps: string[] = [];
afterEach(async () => {
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function writeRegistry(body: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "cormidia-auth-mode-"));
  temps.push(dir);
  const path = join(dir, "apps.yaml");
  await writeFile(path, body, "utf8");
  return path;
}

describe("CF-AUTH-MODE-CONFIG — per-connection auth declaration", () => {
  it("declares the SAME model under different billing through two harnesses", () => {
    const config = parseHarnessAuthConfig(
      {
        claude: { auth: "subscription" },
        opencode: { providers: { anthropic: "api_key", openai: "api_key" } },
      },
      err,
    );
    // The claim #333 exists to make: one org, one model family, two billings.
    expect(declaredAuthMode(config, "claude", "anthropic")).toBe("subscription");
    expect(declaredAuthMode(config, "opencode", "anthropic")).toBe("api_key");
  });

  it("a per-family entry narrows the harness-wide default", () => {
    const config = parseHarnessAuthConfig({ pi: { auth: "api_key", providers: { anthropic: "subscription" } } }, err);
    expect(declaredAuthMode(config, "pi", "anthropic")).toBe("subscription");
    expect(declaredAuthMode(config, "pi", "openai")).toBe("api_key");
  });

  it("an undeclared harness resolves to undefined — never a guessed default", () => {
    const config = parseHarnessAuthConfig({ claude: { auth: "subscription" } }, err);
    expect(declaredAuthMode(config, "codex", "openai")).toBeUndefined();
    expect(declaredAuthMode({}, "claude", "anthropic")).toBeUndefined();
  });

  it("muse under `subscription` is refused at load — invalid by construction", () => {
    // Muse exposes no subscription login at all, so no credential state could
    // ever satisfy the declaration. That is a config error, not a mismatch.
    expect(() => parseHarnessAuthConfig({ muse: { auth: "subscription" } }, err)).toThrow(
      /muse cannot be reached under "subscription"/,
    );
    expect(HARNESS_AUTH_SUPPORT.muse.modes).toEqual(["api_key"]);
    expect(parseHarnessAuthConfig({ muse: { auth: "api_key" } }, err).muse).toEqual({ auth: "api_key" });
  });

  it("`providers:` is refused on a single-provider harness", () => {
    for (const harness of RUNTIME_KINDS.filter((kind) => !HARNESS_AUTH_SUPPORT[kind].multiProvider)) {
      expect(() => parseHarnessAuthConfig({ [harness]: { providers: { anthropic: "api_key" } } }, err)).toThrow(
        /only meaningful for a multi-provider backbone/,
      );
    }
    // …and accepted on both backbones.
    for (const harness of RUNTIME_KINDS.filter((kind) => HARNESS_AUTH_SUPPORT[kind].multiProvider)) {
      expect(parseHarnessAuthConfig({ [harness]: { providers: { anthropic: "api_key" } } }, err)).toBeTruthy();
    }
  });

  it("rejects unknown harnesses, unknown keys, bad modes, and empty declarations", () => {
    expect(() => parseHarnessAuthConfig({ claud: { auth: "api_key" } }, err)).toThrow(/unknown harness "claud"/);
    expect(() => parseHarnessAuthConfig({ claude: { mode: "api_key" } }, err)).toThrow(/unknown key "mode"/);
    expect(() => parseHarnessAuthConfig({ claude: { auth: "oauth" } }, err)).toThrow(/must be one of/);
    expect(() => parseHarnessAuthConfig({ claude: {} }, err)).toThrow(/verifies nothing/);
    expect(() => parseHarnessAuthConfig({ claude: "subscription" }, err)).toThrow(/must be a mapping/);
    expect(() => parseHarnessAuthConfig(["claude"], err)).toThrow(/must be a mapping/);
  });

  it("absent block parses to an empty declaration set (pre-#333 behaviour)", () => {
    expect(parseHarnessAuthConfig(undefined, err)).toEqual({});
    expect(parseHarnessAuthConfig(null, err)).toEqual({});
    expect(describeHarnessAuth({})).toEqual([]);
  });

  it("round-trips through the public YAML spelling", () => {
    const config = parseHarnessAuthConfig(
      { opencode: { providers: { openai: "api_key", anthropic: "subscription" } }, claude: { auth: "subscription" } },
      err,
    );
    const yaml = harnessAuthYaml(config);
    expect(yaml).toEqual({
      claude: { auth: "subscription" },
      opencode: { providers: { anthropic: "subscription", openai: "api_key" } },
    });
    expect(parseHarnessAuthConfig(yaml, err)).toEqual(config);
    expect(describeHarnessAuth(config)).toEqual([
      "claude: *=subscription",
      "opencode: anthropic=subscription openai=api_key",
    ]);
  });

  it("loads from apps.yaml, and a bad declaration fails the registry loudly", async () => {
    const valid = await writeRegistry(
      [
        "org:",
        "  name: acme",
        "apps:",
        "  demo:",
        "    repo: acme/demo",
        "    status: live",
        "harnesses:",
        "  claude:",
        "    auth: subscription",
        "  opencode:",
        "    providers:",
        "      anthropic: api_key",
        "",
      ].join("\n"),
    );
    const file = await loadApps(valid);
    expect(file.harnesses).toEqual({
      claude: { auth: "subscription" },
      opencode: { providers: { anthropic: "api_key" } },
    });

    const invalid = await writeRegistry(
      ["org:", "  name: acme", "apps: {}", "harnesses:", "  muse:", "    auth: subscription", ""].join("\n"),
    );
    await expect(loadApps(invalid)).rejects.toThrow(/muse cannot be reached under "subscription"/);
  });

  it("a registry with no harnesses block still loads, declaring nothing", async () => {
    const path = await writeRegistry(
      ["org:", "  name: acme", "apps:", "  demo:", "    repo: acme/demo", "    status: live", ""].join("\n"),
    );
    expect((await loadApps(path)).harnesses).toEqual({});
  });

  it("every registered harness declares its auth support and verification method", () => {
    // Exhaustive by construction: a new harness cannot ship without saying
    // which modes it can be reached under and how that is verified.
    expect(RUNTIME_KINDS.length).toBeGreaterThan(0);
    for (const kind of RUNTIME_KINDS) {
      const support = HARNESS_AUTH_SUPPORT[kind];
      expect(support.modes.length).toBeGreaterThan(0);
      expect(support.verification.length).toBeGreaterThan(0);
      expect(support.providerFamily.length).toBeGreaterThan(0);
    }
  });
});
