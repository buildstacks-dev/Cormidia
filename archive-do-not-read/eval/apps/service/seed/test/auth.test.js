import assert from "node:assert/strict";
import test from "node:test";
import { normalizeApiKey } from "../src/auth.js";

test("trims an API key", () => assert.equal(normalizeApiKey(" abc "), "abc"));
