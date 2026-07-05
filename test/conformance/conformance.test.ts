// Runs the adapter-generic conformance suite (build plan M0.4) against
// M0.2's FakeRuntime — the reference double every future live-adapter
// conformance file is proven against first. If this file goes red, the bug
// is in the harness/cases, not an adapter; once a live adapter gets its own
// conformance file (M1.2+) reusing runConformanceSuite, a failure there
// while this one stays green isolates the bug to that adapter.

import { FakeRuntime, type ScriptedTurn } from "../../src/runtime/testing/fakeRuntime.js";
import { runConformanceSuite } from "./harness.js";

runConformanceSuite("fake", (turns: ScriptedTurn[]) => new FakeRuntime(turns));
