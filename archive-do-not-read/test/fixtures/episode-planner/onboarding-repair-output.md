{
  "schemaVersion": 1,
  "episodeId": "ticket:sonnet2-buildstack-dev:#1",
  "version": 1,
  "intentHash": "8230a2bb403303fca55594e3a72153fd143e473e2164a2e92af7908723301d36",
  "summary": "Establish the implementation stack with recorded rationale, meaningful stack-specific test and lint gates, and the first observable product slice for buildstacks.dev, delivered as an independently reviewed pull request for ticket #1.",
  "workflowClass": "greenfield_slice_delivery",
  "planningSource": "episode_planner",
  "steps": [
    {
      "kind": "mechanical_gate",
      "id": "provision",
      "objective": "Provision the ticket branch and worktree so the builder can implement the first product slice.",
      "dependsOn": [],
      "inputRefs": [
        { "ref": "ticket:sonnet2-buildstack-dev:#1", "required": true }
      ],
      "expectedOutputs": [
        { "id": "worktree", "kind": "worktree", "required": true }
      ],
      "gate": "ticket/provision"
    },
    {
      "kind": "provider_turn",
      "id": "contract",
      "objective": "Select the implementation stack with rationale (AC1), define the real source layout and local workflow (AC2), and specify the meaningful stack-specific test and lint gate contract (AC3, AC4) for the first slice.",
      "dependsOn": ["provision"],
      "inputRefs": [
        { "ref": "ticket:sonnet2-buildstack-dev:#1", "required": true },
        { "ref": "docs/REQUIREMENTS.md", "required": true },
        { "ref": "docs/VISION.md", "required": true },
        { "ref": "docs/ARCHITECTURE.md", "required": true },
        { "ref": "docs/TESTING.md", "required": false },
        { "ref": ".operon/config.yaml", "required": true }
      ],
      "expectedOutputs": [
        { "id": "contract", "kind": "contract", "required": true }
      ],
      "operation": "build/contract",
      "role": "builder",
      "requiredCapabilities": ["structured_verdict"],
      "maxTurnBudgetUsd": 15,
      "selectionReason": "Builder owns the contract pass that locks stack selection and the gate contract before code; fixed mode defers the configured harness/model/effort to the orchestrator."
    },
    {
      "kind": "provider_turn",
      "id": "implement",
      "objective": "Implement the stack manifest, source layout, local workflow, non-vacuous test and lint commands, and the first observable product slice per the accepted contract (AC2 through AC5).",
      "dependsOn": ["contract"],
      "inputRefs": [
        { "ref": "plan-output:contract.contract", "required": true },
        { "ref": "ticket:sonnet2-buildstack-dev:#1", "required": true },
        { "ref": "docs/REQUIREMENTS.md", "required": true },
        { "ref": ".operon/config.yaml", "required": true }
      ],
      "expectedOutputs": [
        { "id": "implementation", "kind": "build", "required": true }
      ],
      "operation": "build/implement",
      "role": "builder",
      "requiredCapabilities": ["structured_verdict", "tool_gate"],
      "maxTurnBudgetUsd": 15,
      "selectionReason": "Builder owns the implement pass with write access to produce the slice; fixed mode defers the configured assignment to the orchestrator."
    },
    {
      "kind": "mechanical_gate",
      "id": "gates-and-pr",
      "objective": "Run the configured stack-specific test and lint gates against the delivered revision and open the pull request.",
      "dependsOn": ["implement"],
      "inputRefs": [
        { "ref": "plan-output:implement.implementation", "required": true }
      ],
      "expectedOutputs": [
        { "id": "pr", "kind": "pr", "required": true }
      ],
      "gate": "ticket/gates-and-pr"
    },
    {
      "kind": "provider_turn",
      "id": "verify",
      "objective": "Independently verify the exact delivered revision against the acceptance criteria and the meaningful-gate requirement, and emit a merge verdict.",
      "dependsOn": ["gates-and-pr"],
      "inputRefs": [
        { "ref": "plan-output:gates-and-pr.pr", "required": true },
        { "ref": "ticket:sonnet2-buildstack-dev:#1", "required": true }
      ],
      "expectedOutputs": [
        { "id": "review", "kind": "review", "required": true },
        { "id": "merge-verdict", "kind": "merge-verdict", "required": true }
      ],
      "operation": "review/verify",
      "role": "reviewer",
      "requiredCapabilities": ["structured_verdict"],
      "maxTurnBudgetUsd": 15,
      "selectionReason": "Reviewer independently verifies the delivered revision to satisfy the required independent_review safety fact; fixed mode defers the configured assignment to the orchestrator."
    },
    {
      "kind": "mechanical_gate",
      "id": "review-authorization",
      "objective": "Record review authorization once the independent merge verdict clears the delivery.",
      "dependsOn": ["verify"],
      "inputRefs": [
        { "ref": "plan-output:verify.merge-verdict", "required": true }
      ],
      "expectedOutputs": [],
      "gate": "ticket/review-authorization"
    },
    {
      "kind": "mechanical_gate",
      "id": "ship",
      "objective": "Finalize delivery of the independently reviewed first product slice for ticket #1.",
      "dependsOn": ["review-authorization"],
      "inputRefs": [
        { "ref": "plan-output:gates-and-pr.pr", "required": true }
      ],
      "expectedOutputs": [
        { "id": "delivery", "kind": "delivery", "required": true }
      ],
      "gate": "ticket/ship"
    }
  ],
  "estimatedBudget": {
    "providerTurns": 3,
    "providerTurnBudgetUsd": 45,
    "mechanicalOverheadUsd": 0,
    "totalBudgetUsd": 45
  },
  "derivedSafetyRoute": {
    "label": "independent-review-delivery",
    "reasons": [
      "Episode requires an independent delivery review (independent_review safety fact).",
      "First-slice delivery opens a pull request and finalizes only after an independent merge verdict and review authorization."
    ],
    "gateStepIds": ["provision", "gates-and-pr", "review-authorization", "ship"],
    "approvalStepIds": []
  },
  "createdAt": "2026-07-21T00:06:53.053Z"
}
