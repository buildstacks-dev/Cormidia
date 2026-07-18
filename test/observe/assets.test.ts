import { describe, expect, it } from "vitest";
import { OBSERVE_CSS, OBSERVE_HTML, OBSERVE_JS } from "../../src/observe/assets.js";
import { REPORT_CSS, REPORT_HTML, REPORT_JS } from "../../src/report/assets.js";

// The two browser bundles are JavaScript embedded in TypeScript template
// literals, so `pnpm typecheck` cannot see inside them: a stray parenthesis
// compiles cleanly and then blanks the page at runtime. Only a Playwright run
// caught that, which is a slow and indirect signal for a mechanical defect.
// This is the fast, direct one.
describe("embedded browser bundles", () => {
  for (const [name, source] of [["OBSERVE_JS", OBSERVE_JS], ["REPORT_JS", REPORT_JS]] as const) {
    it(`${name} is syntactically valid JavaScript`, () => {
      expect(() => new Function(source)).not.toThrow();
    });
  }

  it("references only element ids the served HTML actually defines", () => {
    for (const [jsName, js, htmlName, html] of [
      ["OBSERVE_JS", OBSERVE_JS, "OBSERVE_HTML", OBSERVE_HTML],
      ["REPORT_JS", REPORT_JS, "REPORT_HTML", REPORT_HTML],
    ] as const) {
      const defined = new Set([...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]!));
      const referenced = [...js.matchAll(/\bq\('([^']+)'\)/g)].map((match) => match[1]!);
      const missing = [...new Set(referenced)].filter((id) => !defined.has(id));
      expect(missing, `${jsName} queries ids absent from ${htmlName}`).toEqual([]);
    }
  });

  it("styles every class the served HTML declares up front", () => {
    for (const [cssName, css, htmlName, html] of [
      ["OBSERVE_CSS", OBSERVE_CSS, "OBSERVE_HTML", OBSERVE_HTML],
      ["REPORT_CSS", REPORT_CSS, "REPORT_HTML", REPORT_HTML],
    ] as const) {
      const declared = [...new Set(
        [...html.matchAll(/class="([^"]+)"/g)].flatMap((match) => match[1]!.trim().split(/\s+/)),
      )].filter(Boolean).sort();
      expect(declared.length, `${htmlName} declares no classes`).toBeGreaterThan(0);
      // A class in the served markup with no rule anywhere in the served
      // stylesheet is either dead markup or an unstyled element. The previous
      // version of this test asserted only that the stylesheet was non-empty,
      // which its own name did not describe and which nothing could fail.
      const unstyled = declared.filter((name) => !new RegExp(`\\.${name.replace(/[-.]/g, "\\$&")}(?![\\w-])`).test(css));
      expect(unstyled, `${cssName} has no rule for classes declared in ${htmlName}`).toEqual([]);
    }
  });

  it("wires every control the served HTML declares", () => {
    // The id test above catches a query for a missing element. This catches the
    // opposite drift: markup declaring a control the bundle never reads, which
    // ships as a dead input the operator can change with no effect.
    const defined = [...OBSERVE_HTML.matchAll(/<(?:select|button|input)\b[^>]*\bid="([^"]+)"/g)].map((match) => match[1]!);
    const referenced = new Set([...OBSERVE_JS.matchAll(/\bq\('([^']+)'\)/g)].map((match) => match[1]!));
    expect(defined.length).toBeGreaterThan(0);
    expect(defined.filter((id) => !referenced.has(id)), "OBSERVE_HTML declares controls OBSERVE_JS never reads").toEqual([]);
  });
});
