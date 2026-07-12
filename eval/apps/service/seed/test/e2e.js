import assert from "node:assert/strict";
import { once } from "node:events";
import { makeServer } from "../src/server.js";

const server = makeServer().listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert.equal(typeof address, "object");
const response = await fetch(`http://127.0.0.1:${address.port}/health`);
assert.equal(response.status, 200);
server.close();
