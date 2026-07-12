import { expect, it } from "vitest";
import { renderQualificationHtml } from "../../scripts/eval/report.js";

it("J-RPT-01 renders portable CSP-safe qualification evidence without executable L3", () => {
  const html = renderQualificationHtml({ schema_version: 1, campaign_id: "bad<script>", campaign_sha256: `sha256:${"a".repeat(64)}`, outcome: "not_qualified", attempts: 1, attempt_ids: ["attempt-1"], counts: { passed: 0, product_miss: 1, safety_stop: 0, budget_stop: 0, infra_invalid: 0, harness_error: 0, not_run: 0 }, reasons: ["oracle <failed>"] });
  expect(html).toContain("Content-Security-Policy");
  expect(html).not.toContain("bad<script>");
  expect(html).not.toContain("oracle <failed>");
  expect(html).toContain("not_qualified");
  expect(html).not.toMatch(/prompt|output\.md|session\.log/i);
});
