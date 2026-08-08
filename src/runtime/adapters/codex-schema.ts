// Provider-boundary JSON Schema translation for Codex strict structured output.
// Cormidia keeps and validates its richer canonical schema on return; this
// module only adapts the request to the narrower OpenAI-supported subset.

/**
 * Codex strict structured outputs require every object property, permit
 * nullable unions for semantically optional values, support `anyOf` rather
 * than `oneOf`, and require scalar types on const/enum nodes. The walk must
 * recurse through union branches: episode plans put step objects below one.
 */
export function toCodexStrictSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return strictSchemaNode(schema, false) as Record<string, unknown>;
}

function strictSchemaNode(node: unknown, nullable: boolean): unknown {
  if (node === null || typeof node !== "object" || Array.isArray(node)) return node;
  const src = node as Record<string, unknown>;
  const out: Record<string, unknown> = { ...src };
  delete out["$schema"];
  if (Object.hasOwn(src, "const")) {
    out["enum"] = [src["const"]];
    delete out["const"];
  }

  if (src["type"] === "object" && src["properties"] !== null && typeof src["properties"] === "object") {
    const props = src["properties"] as Record<string, unknown>;
    const originalRequired = new Set(
      Array.isArray(src["required"])
        ? (src["required"] as unknown[]).filter((key): key is string => typeof key === "string")
        : [],
    );
    out["properties"] = Object.fromEntries(
      Object.entries(props).map(([key, child]) => [key, strictSchemaNode(child, !originalRequired.has(key))]),
    );
    out["required"] = Object.keys(props);
    out["additionalProperties"] = false;
  } else if (src["type"] === "array" && src["items"] !== undefined) {
    out["items"] = strictSchemaNode(src["items"], false);
  }

  for (const keyword of ["allOf", "anyOf", "oneOf"] as const) {
    const branches = src[keyword];
    if (!Array.isArray(branches)) continue;
    const target = keyword === "oneOf" ? "anyOf" : keyword;
    out[target] = branches.map((branch) => strictSchemaNode(branch, false));
    if (keyword === "oneOf") delete out["oneOf"];
  }
  for (const keyword of ["not", "additionalProperties"] as const) {
    const child = src[keyword];
    if (child !== null && typeof child === "object" && !Array.isArray(child)) {
      out[keyword] = strictSchemaNode(child, false);
    }
  }
  for (const keyword of ["$defs", "definitions"] as const) {
    const definitions = src[keyword];
    if (definitions === null || typeof definitions !== "object" || Array.isArray(definitions)) continue;
    out[keyword] = Object.fromEntries(
      Object.entries(definitions).map(([key, child]) => [key, strictSchemaNode(child, false)]),
    );
  }

  const type = src["type"] ?? inferredScalarType(src);
  if (type !== undefined) out["type"] = nullable ? nullableType(type) : type;
  return out;
}

function inferredScalarType(schema: Record<string, unknown>): string | undefined {
  const values = schema["const"] === undefined ? schema["enum"] : [schema["const"]];
  if (!Array.isArray(values) || values.length === 0) return undefined;
  const types = new Set(values.map(jsonScalarType));
  return types.size === 1 ? [...types][0] : undefined;
}

function jsonScalarType(value: unknown): string | undefined {
  if (value === null) return "null";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return ["string", "boolean"].includes(typeof value) ? typeof value : undefined;
}

function nullableType(type: unknown): unknown {
  if (Array.isArray(type)) return type.includes("null") ? type : [...type, "null"];
  if (typeof type === "string") return type === "null" ? type : [type, "null"];
  return type;
}
