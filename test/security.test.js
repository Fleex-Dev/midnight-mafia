import test from "node:test";
import assert from "node:assert/strict";
import worker, {
  assertTrustedOrigin,
  personalizeLandingHtml,
  readJsonBody,
} from "../src/worker.js";
import { GameError } from "../src/game.js";

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

test("room invite metadata links to its dynamic localized social image", () => {
  const source = `
    <title>심야 마피아</title>
    <meta name="description" content="앱 설치 없이 휴대폰으로 역할 확인과 투표를 진행하는 실시간 마피아 게임" />
    <meta property="og:title" content="심야 마피아" />
    <meta property="og:description" content="앱 설치 없이 휴대폰으로 역할 확인과 투표를 진행하는 실시간 마피아 게임" />
    <meta property="og:url" content="https://midnight-mafia.fleex.app/" />
    <meta property="og:image" content="https://midnight-mafia.fleex.app/og/default.png?lang=ko&amp;v=9" />
    <meta property="og:image:secure_url" content="https://midnight-mafia.fleex.app/og/default.png?lang=ko&amp;v=9" />
    <meta name="twitter:title" content="심야 마피아" />
    <meta name="twitter:description" content="앱 설치 없이 각자의 휴대폰으로 역할을 확인하고 투표하는 실시간 마피아 게임" />
    <meta name="twitter:image" content="https://midnight-mafia.fleex.app/og/default.png?lang=ko&amp;v=9" />
  `;
  const result = personalizeLandingHtml(
    source,
    "https://midnight-mafia.fleex.app",
    "A9UL",
  );
  assert.match(result, /심야 마피아 · 게임에 초대됐어요/);
  assert.match(result, /\/play\/\?room=A9UL&lang=ko/);
  assert.match(result, /\/og\/room\/A9UL\.png\?lang=ko&v=9/);
  assert.doesNotMatch(result, /og\/default\.png/);

  const english = personalizeLandingHtml(
    source,
    "https://midnight-mafia.fleex.app",
    "A9UL",
    "en",
  );
  assert.match(english, /Midnight Mafia · You’re invited/);
  assert.match(english, /\/play\/\?room=A9UL&lang=en/);
  assert.match(english, /\/og\/room\/A9UL\.png\?lang=en&v=9/);
});
