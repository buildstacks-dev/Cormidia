import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const COMPILER_REPORT = "compiler-report.json";

export async function assertCanonicalCompilerReport({ designRoot, modelRoot, modelFiles, views, revision, identity }) {
  const { compile, FakeRepositoryPort } = await import("validation-architect");
  const files = {};
  for (const name of modelFiles) {
    files[`validation-design/model/${name}`] = await readFile(join(modelRoot, name), "utf8");
  }
  for (const name of views) {
    files[`validation-design/${name}`] = await readFile(join(designRoot, name), "utf8");
  }
  const output = await compile(new FakeRepositoryPort({ revision, files }));
  if (!output.accepted || output.identity !== identity) {
    throw new Error("checked-model drift check received inconsistent public compiler identities");
  }
  const committed = await readFile(join(designRoot, COMPILER_REPORT), "utf8");
  if (committed !== output.report.content) {
    throw new Error(
      "checked-model drift check failed: compiler-report.json differs from the canonical public compile report",
    );
  }
}
