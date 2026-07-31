import { createServer } from "node:http";

export function makeServer() {
  return createServer((request, response) => {
    if (request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"ok":true}\n');
      return;
    }
    response.writeHead(404).end();
  });
}
