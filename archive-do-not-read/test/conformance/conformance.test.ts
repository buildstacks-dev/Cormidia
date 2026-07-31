// Tests the adapter-generic runtime conformance suite against FakeRuntime.
// Covers the reference expectations for task transport, gate denial, subagent
// gating, and scripted runtime behavior before real adapters reuse the suite.
// Uses the in-memory FakeRuntime only; no filesystem fixture, network, auth,
// real org state, or wall-clock time is required.

import { FakeRuntime, type ScriptedTurn } from "../../src/runtime/testing/fakeRuntime.js";
import { runConformanceSuite } from "./harness.js";

runConformanceSuite("fake", (turns: ScriptedTurn[]) => new FakeRuntime(turns));
