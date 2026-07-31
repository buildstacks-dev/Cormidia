import { join } from "node:path";
import { pathToFileURL } from "node:url";

export async function grade(root: string): Promise<boolean> {
  const imported = await import(`${pathToFileURL(join(root, "src/slug.js")).href}?grader=${encodeURIComponent(root)}`) as { slug(value: string, options?: { preserveUnderscores?: boolean }): string };
  return imported.slug("Eval_Library") === "eval-library" && imported.slug("Eval_Library", { preserveUnderscores: true }) === "eval_library" && imported.slug(" A__B ", { preserveUnderscores: true }) === "a_b";
}
