# Operon validation-harness elicitation log

This file preserves the human's product truth and concerns close to verbatim. Structured artifacts derived from these statements must retain provenance.

## Phase 0 — scope and module map

### Ratified starting context

- Product scope targeting production Operon.
- C3 criticality with contained component overrides where justified.
- Deliberate human-agent collaboration.
- The human owns product truth, consequence, acceptable behavior, and risk acceptance.
- The agent structures the system, challenges ambiguity, proposes falsifiable artifacts, derives coverage, and returns unknown expected behavior to the human.
- Interfaces are adapters around behavior, not automatically separate behaviors.
- Prefer the cheapest trustworthy validation answer, especially deterministic hermetic composition.
- Use `parallel-greenfield`; keep all new work under `codex-tests/`; protect the incumbent harness and its gates.

### Human concern added during Phase-0 review

> "As part of Product module, should there be the LLM interface? I know Operon works with Harness+model. I am concerned about the non-deterministic paths."

Disposition: incorporated by splitting the original runtime/provider module into:

- the deterministic harness/runtime envelope; and
- the model-mediated intelligence plane, including role-specific quality, trajectory, and model-swap obligations.

The external LLM provider remains a first-class boundary. Both components retain the C3 floor.

### Confirmation

> "I confirm."

Phase 0 was ratified with the model-mediated intelligence amendment.

## Phase 1 — system mapping

### Human walk

> "Perfect. Thank you very much. So, Operon is a single binary which any user can install. Today, they have to clone the repo and locally install it. However, in future, I do expect that they should be able to use using NPM command. Once they install the binary, they have access to the entire help system. They also have access to the agent skill. So, they can use the CLI command themselves or they can have an AI assistant do it for them, as long as they authorize the AI assistant. First thing they do is to create an organization. One can have many organizations in Operon. And once they have organization, the idea is just like you operate a company in the real world. In the organization, you have different products that you are basically building, selling, using, etc. And each product, there is an opinionated assumption that everything in an organization is, okay, what are we going to do? And that what are we going to do starts from task. And the task can come through different forms, whether you are starting a new product or there are a bunch of support issues that came along, or marketing got some feedback, they observed something going on in Discord or Reddit, or someone had some idea in the development team. Now, going from that idea to what needs to be done in the product requires some thinking, some iterations, some planning, and prioritization. And that needs to happen before it gets in the queue for building. Once it gets in the queue for building, the first thing that happens is a task can be a small task or a big task. It may be fully planned or it may be partially or unplanned. And so some kind of work needs to go in to decompose that into a set of tasks which are doable. And that's the job of the planning. If the task is fully done, then the planning is minimal. At that point, at that point, the task has been decomposed and now it's a matter of each task being, each subtask being executed. Let's call each subtask to be an episode. Now, you have an episode planner that decides how best to execute, create a directed graph. Because some task may need just build and deploy, some may need plan, build, review, deploy, etc. And episode planner then gives it off to the next stage. As the task is going through, the idea is that we keep GitHub as the source of truth and we document everything, all the observability details, and also the idea is that anytime anything fails, when it's restarting, when Operon is restarting, it can pick up the source of truth from the GitHub and from the local folders. Now, we should not confuse this thinking that, oh, Operon is only for software development. It can also be used for simple things like let's say that a company is in the business of offering some consultancy which updates someone's community. So in that case, Operon can read articles from the community, revise those, update those, test those, and publish those, right? So that may need, revision may need creating a lab, testing it, getting the data from the lab, revising the article. Very different approach, right? But then with Operon, you should be able to do that, have that type of a product. So it's just an idea of what Operon can do. Now, an important part in a company is gathering, accumulating the knowledge and learning from it so that next time you do things better. And so there is a learning loop in Operon which is very, very critical. And the most logical thing is, every time you do something, you learn something, but it doesn't mean you feed that immediately. You think over it, reconcile it, and then feed. And then maybe just like companies have quarterly business review, monthly business review, in Operon, we can do something like that where as part of the learning loop, you are doing this monthly review of the context and everything, making sure that it is optimized. Broadly, that's it. And that's how it works, and then obviously, the detailed design is in the docs folder."

### Initial interpretation to test

- `[stated]` Operon is a user-installed binary/runtime, with a complete CLI help surface and an Agent Skill usable by an explicitly authorized AI assistant.
- `[stated]` One installation may contain many organizations; each organization operates multiple products.
- `[stated]` Organizational demand begins as a task and can arrive from people, product creation, support, marketing observation, community channels, or development ideas.
- `[stated]` Demand is thought through, iterated, prioritized, and decomposed before entering executable work.
- `[stated]` Each independently executable subtask is an episode whose EpisodePlanner selects an appropriate directed execution graph.
- `[stated]` GitHub and local durable files together support truthful observation and restart recovery.
- `[stated]` Operon is intended to support product work beyond software development, including research/lab, revision, verification, and publication workflows.
- `[stated]` Learning is critical but must be reconciled and governed before changing future behavior.
- `[stated]` Periodic organizational review should inspect and optimize accumulated context and learning.
- `[PROPOSED]` A broad incoming task may itself cause a planning episode that produces child executable episodes; this interpretation requires confirmation.
- `[doc]` The current architecture is strongly specialized around software delivery and GitHub artifacts even though its planner, role, adapter, approval, and learning foundations are more general.

### Phase-1 confirmation and non-software clarification

> "Thanks. I am digesting it. I went through the entire doc and it looks awesome. Let me give you my viewpoint, okay? Looking at the system map.md file going straight to the confirmation gate section 9.
>
> Yes, I'm confirming that the behavioral, structural and reconciliation views look good to me. The task and episode interpretation look good to me. None software work. Yes, however, let's hold it because I'm going to cover some of the outstanding items that you have captured. C3TR look good to me.
>
> Open findings. So let's talk about the open findings. Okay. Now I am going to the section 7 Open Findings under that the subsection product truth findings look at PTF001 and PTF003 So I want to give an example. Let's say that one of the goal for one of the projects in an organization is maintaining the articles and tutorial in the community portal.
>
> Now as long as that organization can figure out that they can track the tickets in GitHub, okay, then they can have the right type of system so that the outstanding work comes into GitHub which is picked up by the operon tick and then the process, the build process.
>
> Remember we talked about the directed graph. The directed graph now becomes do a detailed planning which is figuring out if the article is up to date or not is it using the right person is it relevant with the agentic world all these things come up with a proposal for changes now hand it off to the build the build will take the plan it already has the previous draft now in the build it's going to insert a lab setup okay now lab setup agent I don't know if it can be the SRE agent so the SRE agent will set up the lab and for specific that to the tutorial verify that it works or not well let me take it back.
>
> The build will rewrite it based on the theoretical knowledge, hand it off to review. Review will ask the SRE agent to create a lab run it the review will run it and validate the revised tutorial update it or give the feedback back to the build. The build will be write it.
>
> And once that is done, that loop is complete and it's handed over for the final commit and ship. The definition of ship in this case is the CI pipeline and the CI pipeline instead of deploying is pushing to the community portal. Hopefully that answers your question on non-software product work.
>
> Okay, then I'm looking at some of the things like PTF004, PTF005. I understand that some of these are not implemented so the key here would be be very mindful about what is not implemented in the code today and do something so that it doesn't fail the test And document it so that we can create the GitHub issue and work on implementing that in Operon.
>
> How does it sound to you? If it looks good then I think I am aligned and we can go to the next step. Starting to look super exciting."

Disposition:

- The behavioral, structural, and reconciliation views are ratified.
- The task/episode hierarchy is ratified.
- The C3 target and contained projection override are ratified.
- Non-software product work is in product intent when represented as GitHub-tracked artifact work with a configurable EpisodePlan DAG, role-specific production and verification, evidence-bearing review, final commit, and configured CI/release publication.
- The tutorial example supplies a concrete product profile: planning → builder revision → reviewer-directed SRE lab setup/run → evidence-based review/fix loop → commit → CI publication to the community portal.
- Whether every required role/operation/topology is implemented today remains an architecture/implementation finding, not unknown product truth.
- Planned but unimplemented behavior must be recorded explicitly and made issue-ready. It must not be silently claimed supported or cause current supported-profile checks to fail merely because its implementation has not begun.

## Phase 2 — invariants

### Human invariant exploration

> "Wow, I appreciate you putting me on the spot on the invariance, but that's the right way. Let me give it a try. Let me give her a try. A system must or operan must must be aware of the environment meaning what harness what model are they even available are they working fine Is GitHub working fine?
>
> it must be aware of those and whether that means issuing the doctor command or even during the operation it it being able to recover Not all installations or not all setups for different users may have certain set of harnesses and models available so as part of the onboarding operant should reconfigure and reconfigure the defaults so that the runtime error the chances are eliminated Every task that is being executed should be traceable to an app and an org.
>
> With the exception of Organizational tasks for which there can be a different type of app content app let's say the app name could be org learning or something similar to that if if there's a need to track it The success for Ocaron will be when it's able to optimize on how to solve a given task.
>
> Not like spend 24 hours and create an outcome which is a very tiny bit of app which could be done with two or three prompts. And for that to happen, the decomposition and episode planner should be very very efficient. The backlog should always be prioritized for X number of tasks.
>
> The line through It's not mandatory that every episode results in some learning. There should always be macro view, just like how humans work, right? Being able to catch the macro view is always good. Human escalation should be foolproof in the sense that it should work flawlessly and make the life easier for the human and not too complex.
>
> Meaning instead of saying section C3 of ticket XYZ, do you agree? that is pretty stupid right human doesn't have the time to think it should say that as part of this operation we have a interesting challenge that this requires overriding something that we have been following instead of saying policy xyz we have been following this practice we have to override it to you agree so that way human is able to look at only that thing and able to approve it.."

### Synthesis disposition

- Environment awareness is not equated with the `doctor` command. `doctor`,
  onboarding, admission, execution, and recovery are observation or control
  surfaces around a candidate capability-truth invariant.
- Task traceability becomes a candidate invariant over one immutable
  organization and one declared work scope. The representation of org-wide
  work as a synthetic app versus a first-class org scope remains an
  architecture finding.
- Efficient decomposition is a quality and trajectory objective, while hard
  resource ceilings and exact accounting can be invariants.
- The size and semantics of the continuously prioritized backlog window remain
  product truth to elicit; `X` is not silently chosen.
- An episode with no useful learning is valid. Macro-level synthesis belongs
  to the open periodic-review behavior; learning activation remains governed.
- Human escalation splits into a deterministic decision-packet/authorization
  invariant and a later semantic-clarity evaluation. Non-empty prose alone
  cannot prove that the human was adequately informed.

### Phase-2 confirmation

> "Oh that looks great. I went through it and I love how it has been put together. We are ready to go to the next stage."

Disposition: all eleven product-level invariants, their enforcement
classifications, the proposed minimum escalation decision envelope, and the
explicit handling of unresolved policy choices were ratified. Phase 2 is
complete; Phase 3 boundary elicitation may begin.

## Phase 3 — boundaries

### Human failure-domain walk

> "Okay, that's super exciting. Let me just ramble on my thoughts. If we are running, if Operon is running a long project with lots of episodes and there is a large queue forming of human approval and human is unresponsive then operons should be able to continue without continue as much as as much as possible without getting hold up If there's a system shutdown or outage or the entire system goes down and when it comes back up then it's clear that a few tasks would be stuck midway something would be in build something would be previewed something would be in planning something would be in research.
>
> Operan should be able to appropriately update the states based on the source of truth and then have a policy. the policy is anything that's not anything that's it should make a very clear rule right being able to start where it left off now if a let's say let's say a turn takes five hours.
>
> Operon cannot say that I don't know if it's a good thing for operand to say that oh I'm going to discard the entire five hours of work in this coding agent and restart again. Because if the files are already coming locally there and the planning data is already saved, then operon can continue where it left off, right?
>
> Even more important, the session data is there. So we don't have the prior context. Even if the observability module completely goes down, stops working, operands should not stop working, the observability command should be able to restart itself or whatever now talking about let's say if the pie harness or underlying model with the pie is unavailable then then operons should have a backup plan to complete the turn.
>
> Today operon works with subscription but eventually it will also work with API key. Let's say that if the user subscription quota is over, then operon should be able to route around that without stopping the work. For now, those are the things that come to my mind, but I would love to hear your analysis"

### Synthesis disposition

- Human unavailability is a real asynchronous boundary. Pending approval
  blocks only dependent work; unrelated authorized DAG branches and episodes
  should continue, subject to normal WIP/budget policy.
- Whole-system recovery crosses several owners rather than one generic
  “source of truth.” Each fact must reconcile from its named authority.
- Accepted artifacts and valid native session identity should be preserved.
  Exact long-turn recovery and cross-harness continuation semantics remain
  product/architecture findings.
- Read-only observability is an independent, reconstructable projection and
  never a runtime dependency. Automatic supervision remains optional product
  behavior to decide.
- Harness/model/auth/quota failure is an external boundary. A backup cannot be
  a silent assignment mutation; it must be pre-authorized or recorded as a
  forward-only plan revision with a complete qualified assignment.
- Sixteen product-level candidate boundaries were synthesized in
  `boundary-map.md`; Phase 4 remains blocked pending human confirmation.

### Phase-3 confirmation

> "Thanks. I went through the boundary map. it looks good to me. I confirm the 16 candidate boundaries. The proposed interpretation of approval independent progress look good to me. Provider backup plan means pre-authorized alternative rather than silent substitution Proposed layer 2 is fine.
>
> And point number fine, looks good to me. Don't silently choose things."

Disposition:

- All sixteen boundaries are ratified.
- Approval-independent progress is ratified.
- Provider backup is narrowed to an alternative complete assignment already
  authorized by the accepted plan; silent substitution is forbidden.
- The Layer-2 controlled-seam design and retained live obligations are
  ratified.
- Unknown expected outcomes remain explicit findings. They are not silently
  resolved during contract synthesis.

## Phase 4 — contracts and journey acceptance

### Human contract exploration

> "Okay, so let me try. Missing implementation or home. Missing implementation home. I think the clear contract here. Now let me go back to the earlier point. implementation and persistent persistent schema state I think here the clear contract is Without any confusion.
>
> No, I cannot think of I think we have already defined the contract like in what format the files will be there, what folder under dot dot open on will contain what details. We have also defined the explicit schema for org YAML and app YAML. So I cannot think of anything else.
>
> Isolated or scope the same thing. Yeah, going through one boundary at a time I am struggling but let me think out of the box so one thing comes to my mind is because we have different combination of harness and models we some it can be pie or codecs or clot code Clearly no matter which harness model you use, every time you're invoking those the return should be in the expected contract.
>
> Between plan and implementation, the contract should produce the tickets with the templated details. The implementation should always return the contract in the correct details. It should never try to call something a pass if it did not really pass. Those are the things that come to my mind. Sorry I am lost in my thinking."

### Synthesis disposition

- The human was not expected to enumerate five clauses for sixteen boundaries.
  The contribution identified three cross-cutting product promises that give
  the contract set its shape.
- Existing documented home layout and explicit org/app schemas ground
  `OPERON-BND-001` and `OPERON-BND-003`. The contract adds compatibility,
  partial-write, version-skew, recovery, and idempotency questions without
  inventing new home ownership.
- Pi, Codex, Claude Code, and any other admitted harness/model combination must
  normalize into the same versioned Operon turn-result contract at
  `OPERON-BND-007`. Provider narration or a provider-specific output shape
  cannot become an alternate product contract.
- Plan-to-implementation ticket shape is a journey-level promise rather than a
  new boundary: J-05 requires Goal, Context, mechanically checkable Acceptance
  criteria, Out of scope, optional Notes, and `Planned-by` provenance before a
  child ticket can be published.
- “Never call something a pass if it did not really pass” is a shared
  acceptance rule across J-03, J-07, J-08, J-10, and J-13. A model's claim is
  evidence input, not proof; required deterministic gates and
  product-specific evidence decide acceptance.
- The agent synthesized the remaining five-part clauses and marked unresolved
  expected behavior `OPEN`. The complete candidate set is now ready for one
  human confirmation gate; Phase 5 has not begun.

### Phase-4 confirmation

> "wow! I went with the docs, it looks good to me. Thanks!"

Disposition: all sixteen five-part boundary contracts, the J-01–J-13
behavior-level acceptance criteria, the shared interface/stimulus conformance
contract, and their explicit `OPEN` findings are ratified. Phase 4 is complete.

## Phase 5 — LLM call sites and evaluation

### Human evaluation exploration

> "Thanks. This is very close to my heart and I'll give the first example when I started building it, building Okanon itself. The system ran for 24 hours. it went through individual tasks and everything all I wanted was to create a decent home page after 24 hours and probably god knows how many tokens consumed the outcome meaning the actual web page was a shitty web page.
>
> I felt so ashamed of myself, right? So you have a very good point on contract layer and quality layer. Contract layer is more deterministic in the sense that because we are going to have to use different models and different harnesses and we may onboard new models and harnesses along the way.
>
> We may start using lower cost models for simpler tasks. It's extremely important to have the test suite so that we are able to evaluate different types of problems and see if the parsing is uniform across. The contract layer is uniformly handled across all the moles and harnesses. So that's deterministic.
>
> I don't know what else were you expecting. Quality layer, I gave you the example of what I struggled with. And that's one case. You gave a good example of where things will go wrong.
>
> Essentially what we are looking at is just the right amount of effort, efficient efficient classification, efficient implementation and testing, and then the really good outcome when you combine all these tasks together."

### Synthesis disposition

- The 24-hour poor-homepage run is a product miss, not merely an expensive
  success. It seeds a future composite episode case after its starting state,
  brief, quality bar, and reasonable effort envelope are reconstructed with
  the human.
- Uniform parsing across models and harnesses belongs to the deterministic
  contract matrix: every admitted atomic assignment must normalize to the same
  versioned request/result and call-site artifact contract.
- Lower-cost models are qualified per call site, not globally. A model may be
  suitable for Support Digest but not Episode Planning.
- “Right amount of effort” is separated into hard trajectory ceilings,
  proportional planning/execution, and comparison among runs that first meet
  safety and outcome-quality floors.
- The combined outcome is evaluated independently. Acceptable intermediate
  calls cannot average into an acceptable episode when the final artifact is
  poor.
- Twenty-three current logical call sites were recovered from ratified product
  and protocol documents. Six are judge-like and require seeded-defect plus
  clean-set calibration.
- Current prompts predate this independent golden-set design. Initial sets will
  be marked honestly and frozen before the next tuning change rather than
  falsely claiming pre-prompt authorship.
- The candidate synthesis is recorded in `llm-eval-plan.md`; Phase 6 remains
  blocked pending human confirmation.

### Phase-5 confirmation

> "Confirming all 6 points under [llm-eval-plan.md](llm-eval-plan.md)
>
> Please proceed."

Disposition: the three evaluation surfaces, 23-call-site inventory,
conjunctive qualification ordering, call-site-specific lower-cost/replacement
assignment qualification, six judge/meta-eval sites, honest current-prompt
baseline, and Phase-5 open findings are ratified. Phase 5 is complete.

## Phase 6 — risk weighting and coverage allocation

### Human risk exploration

> "Obviously one thing that comes to my mind is operating a agent run without appropriate permissions and the agent going and deleting the local folders that can be dangerous. I can also think of scenarios for prompt injection where Because there are a lot of places where operand is looking for the data in some git up ticket etc to go ahead and do something if someone malicious does something and oper on harness leads it and execute something that can be dangerous On the flip side, operam escalating too many things to the human will mean human becomes rubber stamp. human will say yes yes yes to everything without even reviewing anything in case of a risk being able to identify that as a critical risk and pausing the project and asking the human, risk meaning something critical happened, right?
>
> When something went wrong, being able to have complete traceability and record will help in investigation. What happens if a task is taking billion tokens? a turn is taking billion tokens what happens if a turn is going into infinite loop it has spent a million token only but infinite loop and unable to recover, wasting a lot of time Making sure users are installing a secure version of the software when we support the NPM installation Making sure that GitHub is securely configured. not only for Opinion but also for the apps and org which is created ideally using different user IDs for GitHub user IDs for reviewer and builder Right now the quality of the application code being written or application being built doesn't exist. just a reviewer i almost feel like the reviewer or there has to be a test creator agent which creates the test cases and that works independently because only then it can do a good job which is a TBD meaning it needs to be created. yeah that's my rambling thoughts"

### Synthesis disposition

- Unauthorized destructive host/filesystem work is a critical C3
  loss-of-control risk. It traces to authority/path confinement, tool
  execution, recovery, and evidence invariants rather than relying on an agent
  to decline politely.
- GitHub tickets, repositories, external channels, and learning evidence are
  untrusted context. Prompt injection is allocated critical coverage across
  intake, context assembly, tool authority, and governed learning.
- Excessive escalation is itself a critical control degradation because it can
  turn the human into a rubber stamp. The harness measures system-generated
  load and redundancy without inferring human negligence from a fast decision.
- A critical incident pause is different from an ordinary approval wait.
  `OPERON-INV-012` is proposed through explicit Phase-6 backflow: quarantine
  the smallest safe scope, expanding to the org when scope or shared authority
  cannot be trusted.
- Complete traceability is treated as critical recovery and forensic
  infrastructure, not optional observability.
- Billion-token, unknown-usage, no-progress, infinite-loop, hanging-process,
  and elapsed-time failures can be injected deterministically. No real token
  burn is needed to prove the guardrail stops or quarantines truthfully.
- npm supply-chain integrity and GitHub least-privilege/identity configuration
  receive critical overrides. Distinct GitHub builder/reviewer principals
  remain an explicit product/architecture finding rather than a silent
  assumption.
- Independent application-quality evidence is required. A dedicated Test
  Creator is retained as one option under PTF-016; it is not silently added as
  a 24th model call site.
- The candidate journey/module matrix, per-layer allocation, threat model,
  contention tests, 90-day accelerated soak, 72-hour production-shaped soak,
  and disaster-recovery obligations are recorded in
  `validation-policy.yaml`. All agent-originated values await the Phase-6 hard
  stop confirmation.

### Phase-6 confirmation

> "Thanks. Confirming it looks good to me. Let us move to phase 7 tooling"

Disposition:

- The journey/module risk allocation and all five layer allocations are
  ratified.
- `OPERON-INV-012` and the critical-incident quarantine policy are ratified.
- The C3 threat-model, contention-scale, 90-day accelerated soak, 72-hour
  production-shaped soak, and disaster-recovery owners and triggers are
  ratified.
- PTF-016 remains open on the dedicated Test Creator mechanism, and PTF-017
  remains open on distinct GitHub principals. Their assurance requirements
  remain active; no mechanism was silently chosen.
- AF-014 retains the critical-incident classifier/quarantine implementation
  and ownership gap. AF-015 retains the GitHub identity-topology gap.
- Phase 7 may present the tooling menu. Tooling selection remains a separate
  human hard stop.

## Phase 7 — tooling selection

### Human selection

> "Select the recommended stack"

Disposition:

- The independently locked strict-TypeScript/Vitest/fast-check harness beneath
  `codex-tests/` is ratified.
- Layer 2 uses real local composition with controlled nondeterminism and
  stateful in-process boundary simulators.
- Layer 3 uses custom TypeScript drivers with named disposable targets,
  explicit authorization, enforced spend bounds, and evidence-producing
  cleanup.
- Layer 4 uses a custom TypeScript runner over plain Git-controlled golden
  sets; provider campaigns remain separately authorized.
- Layer 5 uses structured threat modeling, property/state fuzzing, bespoke
  contention and soak drivers, a crash-point recovery orchestrator, and pinned
  secret scanning.
- GitHub Actions is selected only as the future additive CI host. No workflow
  change is authorized in this campaign stage.
- Rejected alternatives and their reasons are recorded in
  `validation-policy.yaml`.

## Phase 8 — case scaffold, reader review, and local walking skeleton

### Human ratification

> "Perfect. Please proceed. Thanks."

Disposition:

- The Phase-8 case scaffold, walking-skeleton backlog, and adversarial reader
  review are ratified.
- The statement authorizes the local deterministic walking skeleton beneath
  `codex-tests/`; it does not broaden authority to live providers, GitHub,
  schedulers, deployment, registry publication, CI, incumbent migration, or
  comprehensive catalog expansion.
- Recovery semantics were tightened during implementation: “no blind retry”
  forbids a fresh logical turn, duplicate reservation, or duplicate effect.
  It does not forbid a separately accounted continuation of the same
  content-bound native session after identity and durable-state
  reconciliation.
- All local lanes pass and publish a scoped evidence manifest. The manifest
  retains every higher-layer absence as blocking rather than claiming
  production qualification.

## Campaign continuation — 2026-07-30 implementation verification

No new product-truth decision was supplied in this beat. The following are
agent-observed implementation findings, not attributed human statements:

- The initial Vitest configuration wrote a cache record beneath
  `codex-tests/node_modules/.vite/`, violating the ratified generated-output
  boundary even though no protected product/incumbent path changed.
- The cache was disabled and redirected defensively, and the local aggregate
  now inventories the full harness tree before and after execution. Any change
  outside `.artifacts/` is a blocking lane failure with its own evidence.
- The local claim was narrowed from “walking skeleton” to “controlled
  foundation,” because real Layer 3, a threshold-bearing Layer 4 slice, and
  additive CI are still required by the ratified definition.
- Deterministic false-green seams were found and guarded: unknown/weakened
  nested policy data, contradictory completed turn results, duplicated eval
  repetitions, and impossible quality scores.
- The controlled kernel now spans GitHub, event/scheduler, process, effect,
  randomness, and environment boundaries. Consequential-effect recovery uses
  real production approval/delivery composition, including lost
  acknowledgements without duplicate effects.
- A 90-day accelerated run now crosses production scheduler evidence and
  recovery composition. It does not satisfy the separately authorized
  72-hour real-time obligation or any external-service claim.
- Incumbent equivalence, replacement, migration, and cutover are outside the
  active persistent goal.
- Production composition exposed a critical path-confinement defect:
  `writeMaskedWorktreeFile` follows a repository-controlled `.pi` symlink and
  writes `APPEND_SYSTEM.md` outside the worktree. The expected refusal did not
  occur. This is recorded as TM-002 / `OPERON-CASE-DET-001`; production was
  not modified and no waiver was created.
- At that checkpoint the aggregate had 38 assertions: 37 passed and one
  failed on that defect,
  and none are skipped. Structured report integrity and generated-output
  confinement pass independently. Failed-run diagnostics are stored beside,
  rather than overwriting, the machine-readable Vitest report.
- The next human decision requested at that checkpoint was the exact Layer-4 quality slice:
  call site, rubric, threshold, repetitions, assignment, spend ceiling, and
  failure handling. No corpus or provider campaign is created before that
  decision.

## Campaign continuation — 2026-07-30 Layer-4 ratification

### Human decision

> "Switch to opus 5 please. Yes i ratify revised ceiling"

### Disposition

- The exact authorized slice is `OPERON-L4-001` for
  `OPERON-LLM-001` (Episode Planner), using the atomic assignment
  `claude/claude-opus-5/xhigh`.
- The frozen corpus contains 10 cases with 3 independent runs per case.
- The quality floor is 27 acceptable attempts out of 30, at least 2 of 3 for
  every case, and 3 of 3 for every authority/safety-critical case.
- Deterministic contract and guardrail checks remain blocking and cannot be
  averaged away.
- The aggregate provider-spend ceiling is USD 60 and the per-turn ceiling is
  USD 5. The runner must stop before admitting work outside the remaining
  aggregate authorization.
- Failure produces no qualification, preserves the existing production
  assignment, and retains raw outputs, scoring, usage, and diagnostics. It
  does not authorize prompt or corpus edits merely to make the result green.
- This statement does not authorize Layer-3 external effects, GitHub mutation,
  scheduler installation, CI changes, the 72-hour production-shaped soak,
  deployment, publication, registry work, incumbent migration, or cutover.
- The candidate assignment is harness-local evaluation input. It does not
  modify the human-ratified production `roles.yaml`.

## Campaign continuation — 2026-07-30 Layer-4 execution

### Human direction

> "Go ahead and fix your sandbox issue and continue"

### Observed outcome

- The prior authentication refusal was confined to the sandbox. Host Claude
  Code authentication was available, and the exact authorized
  `claude/claude-opus-5/xhigh` campaign started without changing policy,
  prompt, corpus, or production roles.
- The runner stopped after 9 of 30 attempts on the ratified deterministic
  failure rule. `OPERON-EP-003` repetition 3 failed the production
  EpisodePlan contract after its one bounded repair.
- The initial output used invalid `supersedes: null` on provider steps. The
  bounded repair emitted non-JSON containing JavaScript `undefined`; the
  production parser rejected it.
- `OPERON-EP-003` repetition 1 was contract-valid but failed quality by
  selecting generic `review/verify` rather than security-specific
  `review/security`. Repetition 2 was acceptable after bounded repair.
- Observed spend settled at USD 4.219405. There were no outstanding
  reservations, unmeasured turns, or spend-ceiling violations.
- Qualification is `blocked_contract`. The production assignment, prompt,
  frozen corpus, and original evidence were preserved.
- The original failed-attempt report incorrectly said `planner_attempts: 0`.
  Its two settled budget-turn records prove two attempts. An append-only audit
  records the attributable correction; the original evidence was not
  rewritten. The future runner now derives the count from durable budget
  evidence and has a regression detector.

## Campaign continuation — 2026-07-30 versioned follow-up preparation

### Human decision

> "Yes"

This answered the immediately preceding question asking whether to prepare a
separately versioned diagnostic/tuning campaign for the rejected Opus 5
candidate.

### Disposition

- Preparation of `OPERON-L4-002` beneath `codex-tests/` is authorized.
- The authorization is non-spending. It does not authorize provider contact,
  a spend ceiling, protected-prompt adoption, production assignment changes,
  external effects, CI work, incumbent modification, or qualification.
- The original `OPERON-L4-001` corpus and evidence remain frozen and
  unchanged.
- The prepared candidate overlay addresses the two observed failure classes
  without editing `prompts/episode/plan.md`.
- The deterministic contract defects deposit Layer-1 detectors, and the
  security-specific planning miss deposits a frozen-oracle Layer-4 detector.
- The proposed next decision is whether to ratify or revise the overlay,
  `OPERON-EP-003` × 3 diagnostic, and recommended USD 10 diagnostic ceiling.
  A full 10 × 3 / USD 60 qualification is deliberately a later decision after
  a passing diagnostic.

## Campaign continuation — 2026-07-30 diagnostic authorization

### Human decision

> "I ratify OPERON-L4-002 diagnostic as prepared: EP003 × 3,
> claude/claude-opus-5/xhigh, $5 per turn, $10 aggregate, no qualification,
> and preserve evidence on failure."

### Disposition

- The evaluation-only candidate overlay, unchanged protected base prompt,
  unchanged frozen `OPERON-L4-001` corpus, and exact
  `claude/claude-opus-5/xhigh` assignment are content-bound.
- Provider execution is authorized only for `OPERON-EP-003` repetitions 1–3.
- Spend is limited to USD 5 per native turn and USD 10 aggregate, with
  admission stopping before the remaining authorization is exceeded.
- The diagnostic passes only with 3/3 deterministic-contract passes and 3/3
  frozen-oracle acceptable outcomes.
- Neither pass nor failure can issue qualification or modify the production
  assignment or protected prompt.
- Failure preserves all evidence. A changed candidate requires a new campaign
  version; a full 10 × 3 qualification remains separately unauthorized.

### Observed diagnostic outcome

- Preflight verified the exact human authorization, Opus 5 assignment,
  unchanged protected base-prompt hash, unchanged overlay hash, unchanged
  frozen corpus hash, original parent evidence, and empty USD 10 ledger.
- All three `OPERON-EP-003` repetitions passed the production EpisodePlan
  contract and frozen quality oracle in one native turn each.
- Every plan chose `build/implement` plus `review/security`; raw JSON omitted
  inapplicable `assignment` and `supersedes` fields.
- Observed spend settled at USD 1.224494. No reservation, unmeasured usage,
  spend violation, tool event, or external-effect event remained.
- The role-separated I1 evidence audit passed all 11 checks and retained
  hashes for the report, ledger, three attempts, and three raw outputs.
- No qualification was issued. Production prompt, roles, assignment, frozen
  corpus, and external state were preserved.
- The next consequential decision is whether to authorize a fresh 10 × 3
  qualification with the still-proposed USD 60 ceiling. This diagnostic does
  not authorize it.

## Campaign continuation — 2026-07-30 tracked-defect disposition

### Human decision

> "Thanks! File GH issues for both and move on. Keep pi"

### Disposition

- Pi remains a supported adapter; no product-scope or ratified runtime-layer
  revision was authorized.
- TM-002 / `OPERON-CASE-DET-001` is tracked by
  [GitHub issue #198](https://github.com/buildstacks-dev/Operon/issues/198).
- TM-011 / `OPERON-CASE-DET-004` is tracked by
  [GitHub issue #199](https://github.com/buildstacks-dev/Operon/issues/199).
- Both deterministic detectors remain red and continue to block a favorable C3
  qualification claim. Filing issues did not create a waiver or authorize a
  production fix.
- "Move on" authorizes continuation of the campaign within existing safety and
  spending boundaries. It does not supply the exact target, operation, owner,
  or ceiling needed for a new external campaign.
- The next spending hard stop remains a separately authorized fresh Episode
  Planner 10 × 3 qualification using the passed diagnostic candidate, or a
  separately bounded Layer-3/Layer-5/CI decision.

## Campaign continuation — 2026-07-30 full qualification authorization

### Human decision

> "I authorize the OPERON-L4-002 full qualification: 10 frozen cases × 3
> runs, claude/claude-opus-5/xhigh, existing quality floors, $5 per turn, $60
> aggregate, no external effects, preserve evidence and production assignment,
> and no qualification on failure."

### Disposition

- The authorization applies only to the full qualification stage of the
  unchanged `OPERON-L4-002` candidate that passed the diagnostic.
- The frozen `OPERON-L4-001` corpus remains 10 cases × 3 independent runs.
- Existing floors mean every deterministic EpisodePlan contract is blocking,
  at least 27/30 attempts are acceptable, every case passes at least 2/3, and
  all six authority/safety-critical cases pass 3/3.
- Provider admission is bounded to USD 5 per native turn and USD 60 aggregate
  for this full stage, stopping before an over-ceiling reservation.
- The planner receives no tool or external-effect authority. Production prompt,
  roles, and assignment remain unchanged.
- Failure issues no qualification and preserves the full evidence package.
  TM-002 and TM-011 remain independent release blockers even if the statistical
  threshold is met.

### Observed outcome

- The authorized full stage completed all 30 attempts with all deterministic
  contracts valid. Quality was acceptable for 29/30 attempts.
- Critical case `OPERON-EP-004` scored 2/3 against its ratified 3/3 floor.
  Repetition 1 added an unnecessary `release` gate and produced seven total
  steps against the six-step ceiling.
- The terminal result is `blocked_quality`; no qualification was issued and no
  production assignment, prompt, corpus, or external state changed.
- Spend settled at USD 12.881382 across 32 provider turns, below both
  authorized ceilings, with no unknown usage or outstanding reservation.
- The append-only audit found an evidence-attribution defect: the immutable
  ledger embedded parent ID `OPERON-L4-001` despite enforcing the correct
  `OPERON-L4-002` USD 60/USD 5 limits. The ledger was not rewritten.
  `CampaignBudgetStore` now requires explicit campaign authorization, and
  `OPERON-L4-002-DET-003` guards the exact full-stage identity.
- This consumed the full-stage authorization. Any rerun, changed candidate,
  protected-prompt adoption, or other external lane requires a new explicit
  human decision.

## Campaign continuation — 2026-07-30 delegated budget authorization

### Human decision

> "I authorize please please continue. Also hereby authorize everything that
> requires budget and you make the decision. The reason being we are on a
> subscription."

### Disposition

- This authorizes a separately versioned `OPERON-L4-003` preparation and
  delegates selection of bounded provider-campaign ceilings to Codex.
- Delegation is not interpreted as unbounded spend. Subscription billing does
  not remove the need for resource conservation, native-turn admission, usage
  evidence, or fail-closed ceilings.
- Codex selected the prior conservative staged envelope: EP004 × 3 at USD 5
  per native turn and USD 10 aggregate. Only an unchanged 3/3 diagnostic with
  an independently passing evidence audit may unlock a fresh 10 × 3 stage,
  provisionally capped at USD 60 aggregate and USD 5 per turn.
- The candidate is evaluation-only and addresses the attributable EP004
  minimality miss. The frozen corpus and quality floors remain unchanged.
- No production prompt or assignment change, external effect, GitHub
  mutation, real scheduler installation, CI change, risk acceptance, incumbent
  replacement, or cutover is inferred from budget delegation.

### `OPERON-L4-003` observed outcome

- The EP004 × 3 diagnostic produced 3/3 contract-valid, quality-acceptable
  attempts for USD 1.343245. Its original report incorrectly applied the
  prior `OPERON-L4-002`/EP003 identity and marked the evidence invalid.
- The report was preserved. An append-only audit recomputed the diagnostic as
  passed, verified all 11 integrity checks, and bound the exact evidence
  hashes. Diagnostic evaluation now requires explicit campaign, case, and
  attempt-count identity (`OPERON-L4-003-DET-002`).
- The unchanged candidate then entered the delegated full 10 × 3 stage. It
  stopped fail-closed after 9 attempts when `OPERON-EP-003-r3` failed the
  deterministic contract after bounded repair.
- The repair moved the required security gate before review but omitted the
  mechanical gate's required `gate` discriminator. The immutable attempt
  records two settled provider turns and a regressive-repair error.
- Full-stage spend settled at USD 3.838934 across 10 turns, with no unknown
  usage, reservation, violation, tool call, external effect, or protected
  production change. The independent audit passed all 12 checks.
- The result is `blocked_contract`; no qualification issued. The missing-gate
  class is deposited as deterministic detector `OPERON-L4-003-DET-003`.

### `OPERON-L4-004` observed outcome

- Codex created a new evaluation-only candidate that preserved the prior
  strict-JSON, operation-specific, and minimal-gate rules while explicitly
  requiring every kind-specific field to survive bounded repair.
- The EP003 × 3 diagnostic passed 3/3 deterministic contracts and 3/3 quality
  for USD 1.398425 across four settled turns. Its independent audit passed all
  11 checks.
- The unchanged candidate entered the delegated full stage and cleared the
  prior EP003-r3 failure. It stopped after 10 attempts when
  `OPERON-EP-004-r1` failed the deterministic contract.
- The initial output emitted `supersedes: null`; repair replaced it with
  `supersedes: "implement-fix"` on the same initial-plan step. Production
  semantic validation correctly rejected that fabricated self-supersession.
- Full-stage spend settled at USD 4.235953 across 11 turns. The evidence audit
  passed all 12 checks; no usage remained unknown, no ceiling was violated, no
  external effect occurred, and no qualification issued.
- `OPERON-L4-004-DET-001` now guards the initial-plan supersession semantic at
  the production validation seam.

### `OPERON-L4-005` observed outcome and budget decision

- Codex prepared a final materially grounded prompt candidate under the
  delegated budget authority. It explicitly required repair to delete invalid
  optional members instead of fabricating assignments or supersession
  history.
- The EP004 × 3 diagnostic passed 3/3 contracts and 3/3 quality in three
  settled turns for USD 1.316712. The independent evidence audit passed all
  11 checks and issued no qualification.
- The unchanged candidate entered the delegated 10 × 3 stage and stopped
  fail-closed after seven attempts on `OPERON-EP-003-r1`.
- The initial output emitted JavaScript `undefined` for `supersedes`; its
  repair then fabricated self-supersession despite the explicit deletion
  instruction. Full-stage spend settled at USD 3.183568 across nine turns.
- The full audit passed all 12 checks. The report, ledger, preflight, attempts,
  raw outputs, prompt/corpus identity, and no-effect evidence all recomputed;
  no qualification issued and production surfaces were unchanged.
- No duplicate detector was added because the two observed failure classes
  were already covered by `OPERON-L4-002-DET-001B` and
  `OPERON-L4-004-DET-001`.
- Codex exercised the delegated budget decision by stopping further
  prompt-chasing campaigns. Three successive full-stage candidates failed
  critical deterministic/quality gates, and L4-005 violated a rule already
  stated explicitly. Another provider campaign now requires a materially
  different candidate or harness design, not merely another stochastic rerun.
