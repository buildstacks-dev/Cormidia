import { describe, expect, it } from "vitest";
import { OBSERVE_CSS, OBSERVE_HTML, OBSERVE_JS } from "../../src/observe/assets.js";
import { GRAPH_NODE_STATES } from "../../src/observe/types.js";
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

// The Live UI's contract is that EVERY major section states which scope it is
// showing. These are static because the bundle is a template literal that
// `pnpm typecheck` cannot see inside: a mis-ordered argument to the extended
// primitives compiles cleanly and renders a plausible-but-wrong badge.
describe("every major section declares its scope (#98)", () => {
  const badgeIds = [...OBSERVE_HTML.matchAll(/class="scope-badge"[^>]*id="([^"]+)"|id="([^"]+)"[^>]*class="scope-badge"/g)]
    .map((match) => match[1] ?? match[2]!);
  const renderCalls = [...OBSERVE_JS.matchAll(/renderSectionScope\('([^']+)'\s*,\s*'([^']*)'\s*,/g)];

  it("gives every section heading exactly one identified scope badge", () => {
    const headings = [...OBSERVE_HTML.matchAll(/<div class="section-heading">([\s\S]*?)<\/div>/g)].map((match) => match[1]!);
    expect(headings.length).toBeGreaterThanOrEqual(8);
    for (const heading of headings) {
      const badges = [...heading.matchAll(/class="scope-badge"/g)];
      // A new section with a heading but no badge is the regression this
      // catches: it would render with no statement of what it is showing.
      expect(badges.length, `section heading without exactly one scope badge: ${heading}`).toBe(1);
      expect(/id="[^"]+"[^>]*class="scope-badge"|class="scope-badge"[^>]*id="[^"]+"/.test(heading), heading).toBe(true);
    }
  });

  it("renders every declared badge and declares every rendered badge", () => {
    expect(badgeIds.length).toBeGreaterThanOrEqual(9);
    const rendered = new Set(renderCalls.map((match) => match[1]!));
    // A badge id nothing renders would sit permanently empty; a rendered id the
    // markup never declares would throw. Both directions are asserted.
    expect([...new Set(badgeIds)].filter((id) => !rendered.has(id)), "declared scope badges nothing renders").toEqual([]);
    expect([...rendered].filter((id) => !badgeIds.includes(id)), "rendered scope badges the markup never declares").toEqual([]);
  });

  it("calls the extended renderSectionScope with its full arity and a declared list id", () => {
    expect(renderCalls.length).toBeGreaterThanOrEqual(9);
    const ids = new Set([...OBSERVE_HTML.matchAll(/id="([^"]+)"/g)].map((match) => match[1]!));
    for (const call of renderCalls) {
      expect(ids.has(call[2]!), `renderSectionScope list id not declared in OBSERVE_HTML: ${call[2]}`).toBe(true);
      // The old 3-argument shape would land the badge TEXT in the `kind` slot,
      // producing an invalid data-scope-kind and an empty badge. Only a static
      // check catches that inside a template literal.
      const tail = OBSERVE_JS.slice(OBSERVE_JS.indexOf(call[0]!) + call[0]!.length, OBSERVE_JS.indexOf(call[0]!) + call[0]!.length + 400);
      expect(/^\s*(kind|'app_wide_context'|scope\s*\?)/.test(tail), `renderSectionScope third argument is not a scope kind: ${call[0]}`).toBe(true);
    }
  });

  it("states a reason for every section that is deliberately not narrowed", () => {
    const reasons = /const APP_WIDE_REASONS = \{([\s\S]*?)\n  \};/.exec(OBSERVE_JS);
    expect(reasons, "APP_WIDE_REASONS is missing").not.toBeNull();
    const entries = [...reasons![1]!.matchAll(/'([^']+)':'([^']*)'/g)];
    expect(entries.length).toBeGreaterThanOrEqual(3);
    for (const [, id, reason] of entries) {
      // 'unaffected' is not an escape hatch: a section may only declare itself
      // app-wide if it can say why, and the reason must name a real badge.
      expect(badgeIds, `APP_WIDE_REASONS names an undeclared badge: ${id}`).toContain(id!);
      expect(reason!.trim().length, `APP_WIDE_REASONS['${id}'] is empty`).toBeGreaterThan(10);
    }
  });
});

// The legend teaches the operator what a node means. An over-broad legend
// teaches them to look for a state that cannot occur; a missing row leaves an
// emitted state unexplained. Both are failures.
describe("the graph legend covers exactly the emitted node vocabulary (#95)", () => {
  it("matches GRAPH_NODE_STATES exactly and styles every token", () => {
    const legend = [...OBSERVE_HTML.matchAll(/data-legend-state="([^"]+)"/g)].map((match) => match[1]!);
    expect([...legend].sort()).toEqual([...GRAPH_NODE_STATES].sort());
    for (const token of GRAPH_NODE_STATES) {
      expect(new RegExp(`\\.trace-node\\.${token}(?![\\w-])`).test(OBSERVE_CSS), `OBSERVE_CSS has no .trace-node.${token} rule`).toBe(true);
    }
  });

  it("explains the arrow and the absent-stage rule as well as the states", () => {
    expect(OBSERVE_HTML).toContain("data-legend-arrow");
    expect(OBSERVE_HTML).toContain("data-legend-manifest");
  });
});
