// Cormidia's content policy for kernel-bound bytes (kernel contract §Source
// provenance and trust → ContentPolicy). It bounds size and JSON shape and
// classifies the payload; it never rewrites bytes, because a destination
// payload must pass the policy canonically unchanged (decision 0026). The
// OKF domain deny-list of design §6.2 (permissions, security posture,
// deployment, tool grants, gate semantics, constitution) stays with the
// candidate classifier — it is a routing decision, not a byte transform.

import { canonicalJsonText, sha256HexOfCanonicalJson, toJsonValue } from "@cormidia/learning-loop";
import type { ContentPolicy, Diagnostic, JsonValue } from "@cormidia/learning-loop";

export const OKF_CONTENT_POLICY_ID = "cormidia-okf-v1";
/** Spec §13 context budget default is 16 KiB per turn; one concept payload
 *  (draft markdown plus structured fields) is bounded at four times that. */
export const OKF_MAXIMUM_INPUT_BYTES = 65_536;

function diagnostic(code: string, message: string): Diagnostic {
  return { code, severity: "error", message };
}

function classify(value: JsonValue): string {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return "scalar";
  if (typeof Reflect.get(value, "markdown") === "string") return "okf-concept-draft";
  if (typeof Reflect.get(value, "text") === "string") return "plain-text";
  return "structured";
}

export function createOkfContentPolicy(): ContentPolicy {
  const digest = sha256HexOfCanonicalJson({
    id: OKF_CONTENT_POLICY_ID,
    maximumInputBytes: OKF_MAXIMUM_INPUT_BYTES,
    outboundUse: "forbidden",
    rules: ["json-only", "byte-ceiling", "classify-without-rewrite"],
  });
  return {
    id: OKF_CONTENT_POLICY_ID,
    digest,
    maximumInputBytes: OKF_MAXIMUM_INPUT_BYTES,
    outboundUse: "forbidden",
    transform: (input: unknown) => {
      let accepted: JsonValue;
      try {
        accepted = toJsonValue(input);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return Promise.resolve({
          accepted: null,
          classification: "rejected",
          diagnostics: [diagnostic("content.not_json", `content is not a JSON value: ${message}`)],
        });
      }
      const bytes = Buffer.byteLength(canonicalJsonText(accepted), "utf8");
      if (bytes > OKF_MAXIMUM_INPUT_BYTES) {
        return Promise.resolve({
          accepted: null,
          classification: "rejected",
          diagnostics: [
            diagnostic(
              "content.too_large",
              `content is ${bytes} canonical bytes; the ceiling is ${OKF_MAXIMUM_INPUT_BYTES}`,
            ),
          ],
        });
      }
      return Promise.resolve({ accepted, classification: classify(accepted), diagnostics: [] });
    },
  };
}
