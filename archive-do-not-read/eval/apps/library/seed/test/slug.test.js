import assert from "node:assert/strict";
import test from "node:test";
import { slug } from "../src/slug.js";

test("creates a slug", () => assert.equal(slug("Eval Library"), "eval-library"));
