export interface InstallTransaction {
  promotePath(source: string, target: string): Promise<void>;
  promoteSymlink(source: string, target: string, kind: "file" | "dir"): Promise<void>;
}

export interface InstallTransactionTarget {
  target: string;
  entry: { type: string; dev?: number; ino?: number; rawLink?: string };
}

export function transactionalReplace(
  targets: readonly (string | InstallTransactionTarget)[],
  apply: (transaction: InstallTransaction) => Promise<void>,
): Promise<void>;
