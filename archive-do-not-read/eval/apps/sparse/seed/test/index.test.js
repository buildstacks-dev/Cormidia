import assert from "node:assert/strict";
import test from "node:test";
import { label } from "../src/index.js";

test("labels a value", () => assert.equal(label(" sparse "), "sparse"));
