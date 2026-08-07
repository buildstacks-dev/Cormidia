// Price lookup over the centralized harness metadata (#332).
//
// The lookup rules themselves are behavior, not drifting facts, so they live in
// code while every number lives in `harness-metadata.json`:
//
//  - **Longest matching id PREFIX wins.** Vendor rosters spell effort into the
//    id (`gpt-5.6-sol-high`, `claude-opus-5-thinking-xhigh`), so an exact-id
//    table would silently miss and fall back on every real assignment.
//  - **An unmatched id takes the declared fallback, never $0.** These estimates
//    also back the hard per-turn budget cap, so unknown spend must round away
//    from zero. Each fallback carries its own recorded rationale — it is a
//    documented upper bound, never an invented number.
//  - **Published surcharge bands are modifiers**, applied on top (GPT-5.6's
//    long-context multipliers today).

import { harnessMetadata, type ModelPrice } from "./harness-metadata.js";
import type { RuntimeKind } from "./types.js";

/** Multipliers a published surcharge band applies to one turn's estimate. */
export interface PriceMultipliers {
  readonly input: number;
  readonly output: number;
}

/**
 * The price Cormidia asserts for `model` on this harness. Throws when the
 * harness declares no table at all — a harness whose provider reports real
 * spend must never be quietly handed an estimate.
 */
export function harnessModelPrice(runtime: RuntimeKind, model: string): ModelPrice {
  const pricing = harnessMetadata(runtime).pricing;
  if (pricing === null) {
    throw new Error(`harness ${runtime} asserts no price table; its provider reports spend directly`);
  }
  const id = model.toLowerCase();
  let best: ModelPrice | undefined;
  let bestLength = -1;
  for (const row of pricing.rows) {
    if (id.startsWith(row.prefix) && row.prefix.length > bestLength) {
      best = row.price;
      bestLength = row.prefix.length;
    }
  }
  if (best !== undefined) return best;
  for (const rule of pricing.fallback.suffixRules) {
    if (id.endsWith(rule.suffix)) return rule.price;
  }
  return pricing.fallback.price;
}

/**
 * Published surcharge multipliers for one turn. `{ input: 1, output: 1 }` when
 * no band applies, so callers multiply unconditionally.
 */
export function harnessPriceMultipliers(runtime: RuntimeKind, model: string, tokensIn: number): PriceMultipliers {
  const pricing = harnessMetadata(runtime).pricing;
  if (pricing === null) return { input: 1, output: 1 };
  const id = model.toLowerCase();
  let input = 1;
  let output = 1;
  for (const modifier of pricing.modifiers) {
    if (!id.startsWith(modifier.prefix) || tokensIn <= modifier.thresholdTokens) continue;
    input *= modifier.inputMultiplier;
    output *= modifier.outputMultiplier;
  }
  return { input, output };
}
