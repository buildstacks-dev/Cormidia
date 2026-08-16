import { mkdir, open, unlink } from "node:fs/promises";
import { dirname } from "node:path";

export async function createSoakState(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  let handle;
  try {
    handle = await open(path, "wx", 0o600);
  } catch (error) {
    if (isExists(error)) throw new Error("soak campaign state already exists");
    throw error;
  }
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function withSoakStateMutation<T>(path: string, action: () => Promise<T>): Promise<T> {
  const lockPath = `${path}.mutation-lock`;
  await mkdir(dirname(lockPath), { recursive: true });
  let handle;
  try {
    handle = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if (isExists(error)) throw new Error("soak state mutation refused: another writer owns the checkpoint lock");
    throw error;
  }
  try {
    return await action();
  } finally {
    await handle.close();
    await unlink(lockPath);
  }
}

function isExists(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}
