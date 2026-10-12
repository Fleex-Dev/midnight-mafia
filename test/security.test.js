import test from "node:test";
import assert from "node:assert/strict";
import worker, {
  assertTrustedOrigin,
  readJsonBody,
} from "../src/worker.js";
import { GameError } from "../game.js";

test("cross-site API and WebSocket origins are rejected", () => {
  assert.doesNotThrow(() =>
    assertTrustedOrigin(
      new Request("https://midnight-mafia.fleex.app/api/rooms", {
        headers: { origin: "https://midnight-mafia.fleex.app" },
      }),
    ),
  );
  assert.throws(
    () =>
      assertTrustedOrigin(
        new Request("https://midnight-mafia.fleex.app/api/rooms", {
          headers: { origin: "https://attacker.example" },
        }),
      ),
    (error) => error instanceof GameError && error.status === 403,
  );
  assert.throws(
    () =>
      assertTrustedOrigin(
        new Request("https://midnight-mafia.fleex.app/api/rooms", {
          headers: { "sec-fetch-site": "cross-site" },
        }),
      ),
    (error) => error instanceof GameError && error.status === 403,
  );
  assert.throws(
    () =>
      assertTrustedOrigin(
        new Request("https://midnight-mafia.fleex.app/api/rooms"),
      ),
    (error) => error instanceof GameError && error.status === 403,
  );
});

test("JSON bodies enforce content type, object shape, and size", async () => {
  const valid = await readJsonBody(
    new Request("https://example.test/action", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ type: "ready" }),
    }),
  );
  assert.deepEqual(valid, { type: "ready" });

  await assert.rejects(
    readJsonBody(
      new Request("https://example.test/action", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({ type: "ready" }),
      }),
    ),
    (error) => error instanceof GameError && error.status === 415,
  );
  await assert.rejects(
    readJsonBody(
      new Request("https://example.test/action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "[]",
      }),
    ),
    (error) => error instanceof GameError && error.status === 400,
  );
  await assert.rejects(
    readJsonBody(
      new Request("https://example.test/action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payload: "x".repeat(5000) }),
      }),
    ),
    (error) => error instanceof GameError && error.status === 413,
  );
});

test("all Worker responses include hardened browser headers", async () => {
  const response = await worker.fetch(
    new Request("https://midnight-mafia.fleex.app/healthz"),
    {},
  );
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("strict-transport-security"),
    "max-age=63072000; includeSubDomains",
  );
  assert.equal(response.headers.get("cross-origin-opener-policy"), "same-origin");
  assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});

test("Worker rejects cross-site and non-JSON room creation before storage access", async () => {
  const hostile = await worker.fetch(
    new Request("https://midnight-mafia.fleex.app/api/rooms", {
      method: "POST",
      headers: {
        origin: "https://attacker.example",
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "attacker" }),
    }),
    {},
  );
  assert.equal(hostile.status, 403);

  const wrongType = await worker.fetch(
    new Request("https://midnight-mafia.fleex.app/api/rooms", {
      method: "POST",
      headers: {
        origin: "https://midnight-mafia.fleex.app",
        "content-type": "text/plain",
      },
      body: JSON.stringify({ name: "player" }),
    }),
    {},
  );
  assert.equal(wrongType.status, 415);
});
