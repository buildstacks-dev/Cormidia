import { expect, it } from "vitest";
import { renderQualificationHtml } from "../../scripts/eval/report.js";
import { emptyQualificationMetrics, type Qualification } from "../../scripts/eval/core.js";

function qualification(overrides: Partial<Qualification>): Qualification {
  return { schema_version: 1, campaign_id: "fixture", campaign_sha256: `sha256:${"a".repeat(64)}`, outcome: "not_qualified", attempts: 0, attempt_ids: [], counts: { passed: 0, product_miss: 0, safety_stop: 0, budget_stop: 0, infra_invalid: 0, harness_error: 0, not_run: 0 }, reasons: [], metrics: emptyQualificationMetrics(), attempt_details: [], ...overrides };
}

it("J-RPT-01 positive: renders portable CSP-safe qualification evidence without executable L3", () => {
  const html = renderQualificationHtml(qualification({ campaign_id: "bad<script>", attempts: 1, attempt_ids: ["attempt-1"], counts: { passed: 0, product_miss: 1, safety_stop: 0, budget_stop: 0, infra_invalid: 0, harness_error: 0, not_run: 0 }, reasons: ["oracle <failed>"] }));
  expect(html).toContain("Content-Security-Policy");
  expect(html).not.toContain("bad<script>");
  expect(html).not.toContain("oracle <failed>");
  expect(html).toContain("not_qualified");
  expect(html).toContain('href="results/attempt-1.json"');
  expect(html).toContain("Route outcomes");
  expect(html).not.toMatch(/prompt|output\.md|session\.log/i);
});

it("J-RPT-01 near-miss safely renders an empty qualified campaign", () => {
  const html = renderQualificationHtml(qualification({ campaign_id: "empty", campaign_sha256: `sha256:${"b".repeat(64)}`, outcome: "qualified" }));
  expect(html).toContain("qualified");
  expect(html).toContain("<li>None</li>");
});

it("J-RPT-01 honest failure escapes script-closing payloads in embedded JSON", () => {
  const html = renderQualificationHtml(qualification({ campaign_id: "</script><script>alert(1)</script>", campaign_sha256: `sha256:${"c".repeat(64)}`, outcome: "invalid", reasons: ["</script>"] }));
  expect(html).not.toContain("</script><script>");
  expect(html).toContain("\\u003c/script\\u003e");
});
