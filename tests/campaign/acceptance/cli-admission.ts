import type { CampaignBinary, RecordedInvocation } from "./cli-driver.js";

export interface InvocationRequest {
  id: string;
  binary: CampaignBinary;
  argv: readonly string[];
  scenarioId?: string;
}

/** A synchronous admission boundary around every packaged-binary invocation. */
export interface InvocationAdmission {
  before(request: InvocationRequest): Promise<void>;
  after(request: InvocationRequest, invocation: RecordedInvocation): Promise<void>;
}
