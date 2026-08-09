export type InstallState = "absent" | "packaged" | "source" | "prior-install" | "foreign";

export interface InstallArtifact {
  kind: "package" | "binary" | "shadow" | "skill";
  label: string;
  target: string;
  state: InstallState;
  evidence: string;
  entry: { type: string; dev?: number; ino?: number; rawLink?: string };
}

export interface InstallPlan {
  package: { state: string; version?: string; evidence?: string };
  artifacts: InstallArtifact[];
  conflicts: InstallArtifact[];
  sourceLinks: InstallArtifact[];
  targetArtifacts: InstallArtifact[];
  targets: string[];
}

export function inspectInstall(options: {
  globalBin: string;
  installedRoot: string;
  packageRoot: string;
  pathDirs: string[];
  env?: NodeJS.ProcessEnv;
}): Promise<InstallPlan>;

export function installPlanFingerprint(plan: InstallPlan): string;
export function formatInstallConflicts(conflicts: readonly InstallArtifact[]): Promise<string>;

export function inspectPackagedSkills(
  packageRoot: string,
  env?: NodeJS.ProcessEnv,
): Promise<{ owner: { state: string; version?: string }; artifacts: InstallArtifact[]; conflicts: InstallArtifact[] }>;
