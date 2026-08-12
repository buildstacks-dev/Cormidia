export interface RunnerConfiguration {
  readonly repository: string;
  readonly repositoryUrl: string;
  readonly label: string;
  readonly namePrefix: string;
  readonly image: string;
  readonly runnerVersion: string;
  readonly runnerSha256: string;
  readonly baseImage: string;
  readonly cpus: number;
  readonly memory: string;
  readonly pidsLimit: number;
}

export interface DockerRunSpec {
  args: string[];
  env: Record<string, string | undefined>;
}

export interface RunnerRow {
  readonly id?: number;
  readonly name?: string;
  readonly status?: string;
  readonly busy?: boolean;
  readonly labels?: readonly { readonly name?: string }[];
}

export const RUNNER_CONFIG: RunnerConfiguration;

export function dockerRunSpec(registrationToken: string): DockerRunSpec;
export function managedOfflineRunnerIds(rows: readonly RunnerRow[]): number[];
export function renderLaunchAgent(options: {
  nodePath: string;
  cliPath: string;
  workingDirectory: string;
  stdoutPath: string;
  stderrPath: string;
}): string;
export function auditRunnerAppliance(options: {
  dockerfile: string;
  entrypoint: string;
  runSpec: DockerRunSpec;
}): string[];
