// Types for the shared install table consumed by tests/unit/cf-reg-359/.
// The implementation is plain ESM (scripts/ is not compiled), so the structural
// pin needs a declaration to read PACKAGED_BINARIES/PACKAGED_SKILLS under
// `noImplicitAny`. Runtime-only; deliberately not in package.json `files`.

export interface PackagedBinary {
  /** package.json `bin` key. */
  readonly name: string;
  /** Shipped launcher, resolving into `dist/`. */
  readonly packagedLauncher: string;
  /** Source-backed launcher `pnpm link:local` puts on PATH. */
  readonly localLauncher: string;
  /** tsx runner the local launcher imports. */
  readonly localRunner: string;
  /** Historical same-checkout link targets this row may replace in place. */
  readonly migrateFrom: readonly string[];
}

export declare const PACKAGED_BINARIES: readonly PackagedBinary[];
export declare const PACKAGED_SKILLS: readonly string[];

export declare function resolveProviderSkillHomes(env?: NodeJS.ProcessEnv): Array<[provider: string, home: string]>;

export interface LinkedSkill {
  readonly skill: string;
  readonly provider: string;
  readonly source: string;
  readonly target: string;
  readonly action: "created" | "current" | "migrated";
}

export declare function linkPackagedSkills(packageRoot: string, env?: NodeJS.ProcessEnv): Promise<LinkedSkill[]>;

export declare function linkExact(
  source: string,
  target: string,
  kind: "file" | "dir",
  options?: { migrateFrom?: readonly string[]; adoptPriorInstall?: boolean },
): Promise<"created" | "current" | "migrated">;

export declare function refusal(target: string): Error;

export type InstallTargetState = "absent" | "current" | "checkout" | "prior-install" | "foreign";

export declare function classifyInstallTarget(
  target: string,
  options: { intendedSource?: string; packageRoot: string },
): Promise<InstallTargetState>;

export interface PackagedSkillTarget {
  readonly skill: string;
  readonly provider: string;
  readonly source: string;
  readonly target: string;
}

export declare function packagedSkillTargets(packageRoot: string, env?: NodeJS.ProcessEnv): PackagedSkillTarget[];
