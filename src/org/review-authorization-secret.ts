import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { link, mkdir, open, unlink } from "node:fs/promises";
import { join } from "node:path";

const SECRET_DIRECTORY = "state";
const SECRET_FILENAME = "self-approval-secret";
const GENERATED_SECRET = /^[A-Za-z0-9_-]{43}$/;

export interface ReviewAuthorizationSecretOptions {
  /** Explicit compatibility override. The caller owns keeping this value out
   * of provider environments and prompt context. */
  environmentSecret?: string;
  /** Preview paths may read an existing secret, but never create state. */
  dryRun?: boolean;
}

export function reviewAuthorizationSecretPath(stateHome: string): string {
  return join(stateHome, SECRET_DIRECTORY, SECRET_FILENAME);
}

/** Resolve the orchestrator-only signer used by both review publication and
 * merge authorization. The default is durable org state, never a repository
 * file or provider-visible environment variable. */
export async function resolveReviewAuthorizationSecret(
  stateHome: string,
  options: ReviewAuthorizationSecretOptions = {},
): Promise<string | undefined> {
  if (options.environmentSecret !== undefined) {
    if (options.environmentSecret.trim().length === 0) {
      throw new Error("OPERON_SELF_APPROVAL_SECRET is set but empty");
    }
    return options.environmentSecret;
  }

  const path = reviewAuthorizationSecretPath(stateHome);
  try {
    return await readSecret(path);
  } catch (error) {
    if (!isCode(error, "ENOENT")) throw error;
  }
  if (options.dryRun === true) return undefined;

  await mkdir(join(stateHome, SECRET_DIRECTORY), { recursive: true, mode: 0o700 });
  const generated = randomBytes(32).toString("base64url");
  const temporary = join(
    stateHome,
    SECRET_DIRECTORY,
    `.${SECRET_FILENAME}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`,
  );
  try {
    const handle = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      0o600,
    );
    try {
      await handle.writeFile(`${generated}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    // Link the fully-written inode into its durable name. `link` fails with
    // EEXIST instead of replacing a concurrent winner, and no resolver can
    // observe a partially-written target.
    await link(temporary, path);
  } catch (error) {
    // A concurrent orchestrator may have won exclusive publication. Resolve
    // and validate exactly that file; every other failure remains loud.
    if (!isCode(error, "EEXIST")) throw error;
  } finally {
    try {
      await unlink(temporary);
    } catch (error) {
      if (!isCode(error, "ENOENT")) throw error;
    }
  }
  return readSecret(path);
}

async function readSecret(path: string): Promise<string> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (isCode(error, "ELOOP")) {
      throw new Error(`review authorization secret must not be a symlink: ${path}`, { cause: error });
    }
    throw error;
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) {
      throw new Error(`review authorization secret is not a regular file: ${path}`);
    }
    if (stat.nlink !== 1) {
      throw new Error(`review authorization secret must not have hard links: ${path}`);
    }
    if ((stat.mode & 0o077) !== 0 || (stat.mode & 0o400) === 0) {
      throw new Error(
        `review authorization secret permissions are unsafe at ${path}; require owner-readable and no group/other access`,
      );
    }
    const raw = await handle.readFile("utf8");
    const secret = raw.trim();
    if (!GENERATED_SECRET.test(secret) || raw !== `${secret}\n`) {
      throw new Error(`review authorization secret is corrupt at ${path}`);
    }
    return secret;
  } finally {
    await handle.close();
  }
}

function isCode(error: unknown, code: string): boolean {
  return error !== null && typeof error === "object" && "code" in error && error.code === code;
}
