import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import express, { type ErrorRequestHandler } from "express";
import { asyncHandler } from "./async-handler";

test("forwards async route failures without taking down the server", async (context) => {
  const app = express();
  app.get("/failure", asyncHandler(async () => {
    throw new Error("database unavailable");
  }));
  app.get("/health", (_req, res) => res.sendStatus(200));

  const errorHandler: ErrorRequestHandler = (_error, _req, res, _next) => {
    res.status(500).json({ error: "Something went wrong on our end" });
  };
  app.use(errorHandler);

  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));

  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const failure = await fetch(`${baseUrl}/failure`);
  assert.equal(failure.status, 500);
  assert.deepEqual(await failure.json(), { error: "Something went wrong on our end" });

  const health = await fetch(`${baseUrl}/health`);
  assert.equal(health.status, 200);
});