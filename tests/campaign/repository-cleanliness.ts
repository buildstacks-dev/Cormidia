import { execFileSync } from "node:child_process";

/** Match upstream exact-revision admission: design overlays are authoring
 * input, while any staged, unstaged, or untracked product path is a refusal. */
export function assertNoDirtyCampaignProductPaths(root: string): void {
  const paths = new Set([
    ...gitPaths(root, ["diff", "--no-renames", "--name-only", "-z"]),
    ...gitPaths(root, ["diff", "--cached", "--no-renames", "--name-only", "-z"]),
    ...gitPaths(root, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);
  const productPaths = [...paths]
    .filter((path) => path !== "validation-design" && !path.startsWith("validation-design/"))
    .sort();
  if (productPaths.length > 0) {
    throw new Error(`campaign refused: product paths differ from the authorized commit: ${productPaths.join(", ")}`);
  }
}

function gitPaths(cwd: string, args: string[]): string[] {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    .split("\0")
    .filter((path) => path !== "");
}
