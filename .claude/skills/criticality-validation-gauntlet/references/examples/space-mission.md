# Example: Space Mission Software

## Scenario

A mission repository contains ground planning tools, telemetry processing, simulation, flight software, and an attitude-control component. Hardware, communication links, and operating procedures exist outside the repository.

## Criticality profile

- Mission system: `C4 Safety/Mission-critical` where failure can cause loss of mission or physical harm.
- Components:
  - Documentation generator: `C1` if its output is not used for critical decisions.
  - Ground visualization: `C2` or `C3` depending on operator reliance.
  - Command generation and uplink: `C4` if incorrect commands can endanger the vehicle.
  - Telemetry archival: `C3` if data loss impairs mission operations.
  - Attitude-control loop: `C4`.
  - Offline analysis notebook: `C1` unless used as an authoritative operational input.
- Change criticality:
  - Documentation typo: `L0`.
  - Simulation-only visualization: `L1`.
  - Timing, control law, sensor fusion, fault handling, or command validation: `L3`.

## Assurance target

A repository reviewer should not claim total mission readiness. A valid scoped target may be:

> Determine whether the inspected software evidence is adequate to support the mission assurance case for the named components, and identify missing hardware, operational, hazard, timing, and independent-verification evidence.

## Important claims

- Safety and mission hazards have complete software-control traceability.
- Critical state transitions cannot issue unsafe commands.
- Timing, memory, power, and numerical behavior remain within bounded limits.
- Sensor, actuator, communication, and processor faults are detected or contained as designed.
- Redundant channels do not share unrecognized common-mode failures.
- The system reaches a defined safe or degraded state after specified failures.
- Ground tools cannot create or upload malformed or unauthorized commands.
- The exact deployed binary is traceable to reviewed source, toolchain, configuration, and test evidence.
- Operators receive accurate information and can intervene under credible failure conditions.

## Required evidence may include

- Approved system and software requirements.
- Hazard analysis, failure-mode analysis, and safety-control traceability.
- Unit, property, model-based, and integration tests.
- Formal analysis of selected critical invariants or state machines.
- Worst-case timing and resource analysis.
- Numerical stability and boundary analysis.
- High-fidelity simulation across mission phases and abnormal conditions.
- Fault injection.
- Processor- and hardware-in-the-loop testing.
- Environmental and communication-loss scenarios.
- Redundancy and common-mode analysis.
- Ground-system and operator-procedure validation.
- Independent verification and validation.
- Controlled configuration, toolchain, binary provenance, and acceptance records.

## Repository-review limits

A code review can establish:

- Traceability quality present in the repository.
- Test and analysis completeness for accessible claims.
- Source-level defects and missing evidence.
- Reproducibility of available software checks.

It cannot alone establish:

- Hardware behavior.
- Environmental tolerance.
- Operator performance.
- Communication-link behavior.
- Full hazard-control effectiveness.
- Mission readiness.

## Verdict example

> The inspected repository provides adequate code-level evidence for the telemetry parser under the stated input and platform assumptions. Evidence is insufficient to support the C4 command-uplink assurance claim because hardware-in-the-loop results, independent verification records, and end-to-end command authorization evidence were not available.
