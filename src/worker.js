import QRCode from "qrcode";
import { createGameService, GameError } from "./game.js";

const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_IDLE_TTL_MS = 8 * 60 * 60 * 1000;
const DISCONNECT_GRACE_MS = 30 * 60 * 1000;
const WS_AUTH_TIMEOUT_MS = 10 * 1000;
const MAX_JSON_BYTES = 4 * 1024;
const MAX_WS_MESSAGE_BYTES = 2 * 1024;
const MAX_ROOM_SOCKETS = 36;
const publicRateWindows = new Map();
const TEMPLATE_NAMES = [
  "player",
  "target",
  "lobby",
  "reveal-hidden",
  "reveal",
  "waiting",
  "night",
  "day",
  "vote",
  "vote-result",
  "ended",
  "header",
  "footer",
  "landing-start",
  "landing-create",
  "landing-join",
];
const STATIC_ASSET_PATHS = new Map([
  ["/", "/index.html"],
  ["/guide.html", "/pages/ko/guide.html"],
  ["/privacy.html", "/pages/ko/privacy.html"],
  ["/roles.html", "/pages/ko/roles.html"],
  ["/rules.html", "/pages/ko/rules.html"],
  ["/en/guide.html", "/pages/en/guide.html"],
  ["/en/privacy.html", "/pages/en/privacy.html"],
  ["/en/roles.html", "/pages/en/roles.html"],
  ["/en/rules.html", "/pages/en/rules.html"],
]);

const SECURITY_HEADERS = {
  "content-security-policy":
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "referrer-policy": "same-origin",
  "strict-transport-security": "max-age=63072000; includeSubDomains",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

function randomInt(max) {
  const range = 0x1_0000_0000;
  const limit = range - (range % max);
  const values = new Uint32Array(1);
  do globalThis.crypto.getRandomValues(values);
  while (values[0] >= limit);
  return values[0] % max;
}

function makeRoomCode() {
  let code = "";
  for (let index = 0; index < 4; index += 1) {
    code += ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)];
  }
  return code;
}

function clientIp(request) {
  return request.headers.get("cf-connecting-ip") || "unknown";
}

function pruneRateWindows(windows, now) {
  if (windows.size < 256) return;
  for (const [key, entry] of windows) {
    if (entry.resetAt <= now) windows.delete(key);
  }
  while (windows.size >= 512) {
    windows.delete(windows.keys().next().value);
  }
}

function enforceRateLimit(windows, key, limit, windowMs) {
  const now = Date.now();
  pruneRateWindows(windows, now);
  const current = windows.get(key);
  if (!current || current.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  if (current.count >= limit)
    throw new GameError("요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.", 429);
  current.count += 1;
}

export function assertTrustedOrigin(request) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site")
    throw new GameError("허용되지 않은 요청 출처입니다.", 403);
  if (!origin || origin !== new URL(request.url).origin)
    throw new GameError("허용되지 않은 요청 출처입니다.", 403);
}

export async function readJsonBody(request, maxBytes = MAX_JSON_BYTES) {
  const contentType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== "application/json")
    throw new GameError("JSON 요청만 허용됩니다.", 415);
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes)
    throw new GameError("요청이 너무 큽니다.", 413);
  if (!request.body) throw new GameError("요청 형식이 올바르지 않습니다.");
  const reader = request.body.getReader();
  const chunks = [];
  let receivedBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    receivedBytes += value.byteLength;
    if (receivedBytes > maxBytes) {
      await reader.cancel();
      throw new GameError("요청이 너무 큽니다.", 413);
    }
    chunks.push(value);
  }
  const buffer = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const value = JSON.parse(new TextDecoder().decode(buffer));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Body must be an object");
    return value;
  } catch {
    throw new GameError("요청 형식이 올바르지 않습니다.");
  }
}

function json(status, value) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      ...SECURITY_HEADERS,
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function errorResponse(error) {
  const status = error instanceof GameError ? error.status : 500;
  if (!(error instanceof GameError)) console.error(error);
  return json(status, {
    error:
      error instanceof GameError
        ? error.message
        : "서버에서 문제가 발생했습니다.",
  });
}

export function personalizeLandingHtml(html, origin, roomCode, language = "ko") {
  const locale = language === "en" ? "en" : "ko";
  const title =
    locale === "en"
      ? `Midnight Mafia · Room code ${roomCode}`
      : `심야 마피아 · 방 코드 ${roomCode}`;
  const description =
    locale === "en"
      ? `Join room ${roomCode}, reveal your role, and play Midnight Mafia together.`
      : `심야 마피아 방 ${roomCode}에 참가해 역할을 확인하고 함께 게임을 시작하세요.`;
  const roomUrl = `${origin}/?room=${roomCode}&lang=${locale}`;
  const imageUrl = `${origin}/og/room/${roomCode}.jpg?lang=${locale}&v=2`;
  return html
    .replace("<title>심야 마피아</title>", `<title>${title}</title>`)
    .replace(
      '<meta name="description" content="앱 설치 없이 휴대폰으로 역할 확인과 투표를 진행하는 실시간 마피아 게임" />',
      `<meta name="description" content="${description}" />`,
    )
    .replace(
      '<meta property="og:title" content="심야 마피아" />',
      `<meta property="og:title" content="${title}" />`,
    )
    .replace(
      '<meta property="og:description" content="앱 설치 없이 휴대폰으로 역할 확인과 투표를 진행하는 실시간 마피아 게임" />',
      `<meta property="og:description" content="${description}" />`,
    )
    .replace(
      '<meta property="og:url" content="https://midnight-mafia.fleex.app/" />',
      `<meta property="og:url" content="${roomUrl}" />`,
    )
    .replace(
      '<meta property="og:image" content="https://midnight-mafia.fleex.app/og/default.jpg?lang=ko&amp;v=2" />',
      `<meta property="og:image" content="${imageUrl}" />`,
    )
    .replace(
      '<meta property="og:image:secure_url" content="https://midnight-mafia.fleex.app/og/default.jpg?lang=ko&amp;v=2" />',
      `<meta property="og:image:secure_url" content="${imageUrl}" />`,
    )
    .replace(
      '<meta name="twitter:title" content="심야 마피아" />',
      `<meta name="twitter:title" content="${title}" />`,
    )
    .replace(
      '<meta name="twitter:description" content="앱 설치 없이 각자의 휴대폰으로 역할을 확인하고 투표하는 실시간 마피아 게임" />',
      `<meta name="twitter:description" content="${description}" />`,
    )
    .replace(
      '<meta name="twitter:image" content="https://midnight-mafia.fleex.app/og/default.jpg?lang=ko&amp;v=2" />',
      `<meta name="twitter:image" content="${imageUrl}" />`,
    );
}

function sessionFor(room, player) {
  return { code: room.code, playerId: player.id, token: player.token };
}

function authentication(request) {
  return {
    playerId: request.headers.get("x-player-id"),
    token: request.headers.get("x-player-token"),
  };
}

export class RoomDurableObject {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.service = createGameService();
    this.disconnectDeadlines = {};
    this.rateWindows = new Map();
    this.ready = this.ctx.blockConcurrencyWhile(async () => {
      const [snapshot, deadlines] = await Promise.all([
        this.ctx.storage.get("snapshot"),
        this.ctx.storage.get("disconnectDeadlines"),
      ]);
      if (snapshot) this.service.importSnapshot(snapshot);
      if (deadlines) this.disconnectDeadlines = deadlines;
    });
  }

  room() {
    return this.service.rooms.values().next().value || null;
  }

  connectedIds() {
    const connected = new Set();
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment();
      if (attachment?.authenticated) connected.add(attachment.playerId);
    }
    return connected;
  }

  async scheduleAlarm() {
    const room = this.room();
    const deadlines = Object.values(this.disconnectDeadlines).filter(Number.isFinite);
    const candidates = [...deadlines];
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment();
      if (!attachment?.authenticated && Number.isFinite(attachment?.authDeadline))
        candidates.push(attachment.authDeadline);
    }
    if (room && this.connectedIds().size === 0) {
      candidates.push((room.lastActivityAt || room.createdAt) + ROOM_IDLE_TTL_MS);
    }
    if (candidates.length) {
      await this.ctx.storage.setAlarm(Math.max(Date.now() + 1_000, Math.min(...candidates)));
    } else {
      await this.ctx.storage.deleteAlarm();
    }
  }

  async persist() {
    const room = this.room();
    if (!room) {
      await this.ctx.storage.deleteAll();
      await this.ctx.storage.deleteAlarm();
      this.disconnectDeadlines = {};
      return;
    }
    await Promise.all([
      this.ctx.storage.put("snapshot", this.service.exportSnapshot()),
      this.ctx.storage.put("disconnectDeadlines", this.disconnectDeadlines),
    ]);
    await this.scheduleAlarm();
  }

  async sendState(socket) {
    const attachment = socket.deserializeAttachment();
    if (!attachment?.authenticated) return;
    try {
      const { room, player } = this.service.authenticate(
        attachment.roomCode,
        attachment.playerId,
        attachment.token,
      );
      socket.send(
        JSON.stringify({
          type: "state",
          state: this.service.getState(room, player, this.connectedIds()),
        }),
      );
    } catch {
      socket.close(1008, "Session expired");
    }
  }

  async broadcast() {
    await Promise.all(
      this.ctx.getWebSockets().map((socket) => this.sendState(socket)),
    );
  }

  async fetch(request) {
    await this.ready;
    try {
      const url = new URL(request.url);
      if (request.method === "POST" && url.pathname === "/create") {
        if (this.room()) throw new GameError("이미 사용 중인 방 코드입니다.", 409);
        const body = await readJsonBody(request);
        const { room, player } = this.service.createRoom(body.name, body.code);
        room.joinUrl = body.joinUrl;
        await this.persist();
        return json(201, {
          session: sessionFor(room, player),
          state: this.service.getState(room, player),
        });
      }

      const room = this.room();
      if (request.method === "GET" && url.pathname === "/exists") {
        return new Response(null, {
          status: room ? 204 : 404,
          headers: SECURITY_HEADERS,
        });
      }
      if (!room) throw new GameError("방을 찾을 수 없습니다. 코드를 확인해 주세요.", 404);

      if (request.method === "GET" && url.pathname === "/qr") {
        enforceRateLimit(
          this.rateWindows,
          `qr:${clientIp(request)}`,
          60,
          60 * 1000,
        );
        const joinUrl = new URL(room.joinUrl);
        const language = url.searchParams.get("lang");
        if (language === "ko" || language === "en") {
          joinUrl.searchParams.set("lang", language);
        }
        const image = await QRCode.toString(joinUrl.href, {
          type: "svg",
          width: 360,
          margin: 1,
          color: { dark: "#090914", light: "#ffffff" },
        });
        return new Response(image, {
          headers: {
            ...SECURITY_HEADERS,
            "content-type": "image/svg+xml; charset=utf-8",
            "cache-control": "private, max-age=60",
          },
        });
      }

      if (request.method === "GET" && url.pathname === "/ws") {
        if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
          throw new GameError("WebSocket 연결이 필요합니다.", 426);
        }
        enforceRateLimit(
          this.rateWindows,
          `ws:${clientIp(request)}`,
          48,
          60 * 1000,
        );
        if (this.ctx.getWebSockets().length >= MAX_ROOM_SOCKETS) {
          throw new GameError(
            "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
            429,
          );
        }
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        server.serializeAttachment({
          authenticated: false,
          authDeadline: Date.now() + WS_AUTH_TIMEOUT_MS,
        });
        this.ctx.acceptWebSocket(server);
        await this.scheduleAlarm();
        return new Response(null, { status: 101, webSocket: client });
      }

      if (request.method === "POST" && url.pathname === "/join") {
        enforceRateLimit(
          this.rateWindows,
          `join:${clientIp(request)}`,
          24,
          60 * 1000,
        );
        const body = await readJsonBody(request);
        const { player } = this.service.joinRoom(room.code, body.name);
        await this.persist();
        await this.broadcast();
        return json(201, {
          session: sessionFor(room, player),
          state: this.service.getState(room, player, this.connectedIds()),
        });
      }

      const credentials = authentication(request);
      enforceRateLimit(
        this.rateWindows,
        `api:${clientIp(request)}`,
        120,
        10 * 1000,
      );
      const { player } = this.service.authenticate(
        room.code,
        credentials.playerId,
        credentials.token,
      );

      if (request.method === "GET" && url.pathname === "/state") {
        this.service.touchRoom(room);
        await this.persist();
        return json(200, {
          state: this.service.getState(room, player, this.connectedIds()),
        });
      }

      if (request.method === "POST" && url.pathname === "/action") {
        enforceRateLimit(
          this.rateWindows,
          `action:${player.id}`,
          30,
          10 * 1000,
        );
        this.service.applyAction(room, player, await readJsonBody(request));
        await this.persist();
        const state = this.service.getState(room, player, this.connectedIds());
        await this.broadcast();
        return json(200, { state });
      }

      if (request.method === "POST" && url.pathname === "/leave") {
        this.service.removePlayer(room, player.id);
        delete this.disconnectDeadlines[player.id];
        await this.persist();
        await this.broadcast();
        return new Response(null, { status: 204, headers: SECURITY_HEADERS });
      }

      throw new GameError("요청을 찾을 수 없습니다.", 404);
    } catch (error) {
      return errorResponse(error);
    }
  }

  async webSocketMessage(socket, rawMessage) {
    await this.ready;
    const attachment = socket.deserializeAttachment();
    if (attachment?.authenticated) return;
    try {
      const text =
        typeof rawMessage === "string"
          ? rawMessage
          : new TextDecoder().decode(rawMessage);
      if (new TextEncoder().encode(text).byteLength > MAX_WS_MESSAGE_BYTES) {
        socket.close(1009, "Message too large");
        return;
      }
      const message = JSON.parse(text);
      if (
        !message ||
        typeof message !== "object" ||
        Array.isArray(message) ||
        message.type !== "authenticate" ||
        typeof message.room !== "string" ||
        typeof message.playerId !== "string" ||
        typeof message.token !== "string" ||
        message.room.length !== 4 ||
        message.playerId.length > 64 ||
        message.token.length > 128
      )
        throw new Error("Invalid message");
      const { room, player } = this.service.authenticate(
        message.room,
        message.playerId,
        message.token,
      );
      for (const current of this.ctx.getWebSockets()) {
        if (current === socket) continue;
        const currentAttachment = current.deserializeAttachment();
        if (
          currentAttachment?.authenticated &&
          currentAttachment.playerId === player.id
        )
          current.close(1000, "Replaced by a new connection");
      }
      socket.serializeAttachment({
        authenticated: true,
        roomCode: room.code,
        playerId: player.id,
        token: player.token,
      });
      delete this.disconnectDeadlines[player.id];
      this.service.touchRoom(room);
      await this.persist();
      await this.broadcast();
    } catch {
      socket.close(1008, "Invalid session");
    }
  }

  async webSocketClose(socket) {
    await this.ready;
    const attachment = socket.deserializeAttachment();
    const room = this.room();
    if (!attachment?.authenticated || !room?.players.has(attachment.playerId)) {
      await this.scheduleAlarm();
      return;
    }
    const hasOtherConnection = this.ctx
      .getWebSockets()
      .some((current) => {
        if (current === socket) return false;
        const currentAttachment = current.deserializeAttachment();
        return (
          currentAttachment?.authenticated &&
          currentAttachment.playerId === attachment.playerId
        );
      });
    if (hasOtherConnection) {
      delete this.disconnectDeadlines[attachment.playerId];
    } else {
      this.disconnectDeadlines[attachment.playerId] =
        Date.now() + DISCONNECT_GRACE_MS;
    }
    await this.persist();
    await this.broadcast();
  }

  async webSocketError(socket) {
    await this.webSocketClose(socket);
  }

  async alarm() {
    await this.ready;
    const room = this.room();
    if (!room) return;
    const now = Date.now();
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment();
      if (
        !attachment?.authenticated &&
        Number.isFinite(attachment?.authDeadline) &&
        attachment.authDeadline <= now
      )
        socket.close(1008, "Authentication timeout");
    }
    const connected = this.connectedIds();
    for (const [playerId, deadline] of Object.entries(this.disconnectDeadlines)) {
      if (connected.has(playerId)) {
        delete this.disconnectDeadlines[playerId];
      } else if (deadline <= now) {
        this.service.removePlayer(room, playerId);
        delete this.disconnectDeadlines[playerId];
      }
    }
    const currentRoom = this.room();
    if (
      currentRoom &&
      connected.size === 0 &&
      (currentRoom.lastActivityAt || currentRoom.createdAt) + ROOM_IDLE_TTL_MS <= now
    ) {
      this.service.rooms.delete(currentRoom.code);
    }
    await this.persist();
    await this.broadcast();
  }
}

async function templatesResponse(request, env) {
  const entries = await Promise.all(
    TEMPLATE_NAMES.map(async (name) => {
      const url = new URL(`/templates/${name}.html`, request.url);
      const response = await env.ASSETS.fetch(new Request(url));
      if (!response.ok) throw new Error(`Missing template: ${name}`);
      return [name, await response.text()];
    }),
  );
  return json(200, Object.fromEntries(entries));
}

async function roomExists(env, code) {
  const response = await routeRoom(
    new Request("https://room.internal/exists"),
    env,
    code,
    "exists",
  );
  return response.status === 204;
}

async function socialImageResponse(request, env, requestedCode = "") {
  const language =
    new URL(request.url).searchParams.get("lang") === "en" ? "en" : "ko";
  const code =
    requestedCode && (await roomExists(env, requestedCode))
      ? requestedCode
      : "";
  const baseUrl = new URL("/images/social-card-base.png", request.url);
  const base = await env.ASSETS.fetch(new Request(baseUrl));
  if (!base.ok) throw new Error("Missing social card background");
  const fallback = base.clone();
  try {
    const englishFont = {
      url: new URL("/fonts/inter-700.ttf", request.url).href,
    };
    const koreanFont = {
      url: new URL("/fonts/pretendard-700.woff2", request.url).href,
    };
    const font = language === "en" ? englishFont : koreanFont;
    let image = env.IMAGES.input(base.body).transform({
      width: 1200,
      height: 630,
      fit: "cover",
    });
    image = image.draw(
      env.IMAGES.text(language === "en" ? "MIDNIGHT MAFIA" : "심야 마피아", {
        font,
        color: "#eee7dc",
        size: language === "en" ? 62 : 68,
      }),
      { left: 72, top: 48 },
    );
    image = image
      .draw(
        env.IMAGES.text("CASE FILE", {
          font: englishFont,
          color: "#c93442",
          size: 24,
        }),
        { left: 76, top: 365 },
      )
      .draw(
        env.IMAGES.text(code || "00:00", {
          font: englishFont,
          color: "#e25b67",
          size: code ? 62 : 56,
        }),
        { left: 72, top: 402 },
      );
    const response = (
      await image.output({ format: "image/jpeg", quality: 90 })
    ).response();
    return withSecurityHeaders(response, {
      "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
    });
  } catch (error) {
    console.error("Social image transformation failed", error);
    return withSecurityHeaders(fallback, {
      "cache-control": "public, max-age=300",
    });
  }
}

function withSecurityHeaders(response, extraHeaders = {}) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value);
  }
  for (const [name, value] of Object.entries(extraHeaders)) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function staticAssetRequest(request) {
  const url = new URL(request.url);
  const assetPath = STATIC_ASSET_PATHS.get(url.pathname);
  if (!assetPath) return request;
  url.pathname = assetPath;
  return new Request(url, request);
}

async function routeRoom(request, env, code, operation) {
  const id = env.ROOMS.idFromName(code);
  const stub = env.ROOMS.get(id);
  const internalUrl = new URL(`https://room.internal/${operation}`);
  internalUrl.search = new URL(request.url).search;
  return stub.fetch(new Request(internalUrl, request));
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/") && request.method !== "GET")
        assertTrustedOrigin(request);
      if (request.method === "GET" && url.pathname === "/healthz") {
        return json(200, { ok: true, platform: "cloudflare" });
      }
      if (request.method === "GET" && url.pathname === "/templates.json") {
        return templatesResponse(request, env);
      }
      const socialImageMatch = url.pathname.match(
        /^\/og\/(?:default|room\/([A-HJ-NP-Z2-9]{4}))\.jpg$/,
      );
      if (request.method === "GET" && socialImageMatch) {
        enforceRateLimit(
          publicRateWindows,
          `og:${clientIp(request)}`,
          60,
          60 * 1000,
        );
        return socialImageResponse(request, env, socialImageMatch[1] || "");
      }
      if (request.method === "POST" && url.pathname === "/api/rooms") {
        enforceRateLimit(
          publicRateWindows,
          `create:${clientIp(request)}`,
          10,
          60 * 1000,
        );
        const body = await readJsonBody(request);
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const code = makeRoomCode();
          const response = await routeRoom(
            new Request("https://room.internal/create", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                name: body.name,
                code,
                joinUrl: `${url.origin}/?room=${code}`,
              }),
            }),
            env,
            code,
            "create",
          );
          if (response.status !== 409) return response;
        }
        throw new GameError("방 코드를 만들지 못했습니다. 다시 시도해 주세요.", 500);
      }

      const match = url.pathname.match(
        /^\/api\/rooms\/([A-Z0-9]{4})\/(join|state|action|leave|qr|ws)$/i,
      );
      if (match) {
        const code = match[1].toUpperCase();
        if (match[2].toLowerCase() === "ws") assertTrustedOrigin(request);
        return routeRoom(request, env, code, match[2].toLowerCase());
      }
      if (url.pathname.startsWith("/api/")) {
        return json(404, { error: "요청을 찾을 수 없습니다." });
      }
      const crawlerHeaders =
        request.method === "GET" &&
        url.pathname === "/" &&
        url.searchParams.has("room")
          ? { "x-robots-tag": "noindex" }
          : {};
      let assetResponse = await env.ASSETS.fetch(staticAssetRequest(request));
      const roomCode = url.searchParams.get("room")?.toUpperCase() || "";
      if (
        request.method === "GET" &&
        url.pathname === "/" &&
        /^[A-HJ-NP-Z2-9]{4}$/.test(roomCode) &&
        assetResponse.ok
      ) {
        const headers = new Headers(assetResponse.headers);
        headers.set("cache-control", "no-store");
        assetResponse = new Response(
          personalizeLandingHtml(
            await assetResponse.text(),
            url.origin,
            roomCode,
            url.searchParams.get("lang"),
          ),
          { status: 200, headers },
        );
      }
      return withSecurityHeaders(assetResponse, crawlerHeaders);
    } catch (error) {
      return errorResponse(error);
    }
  },
};
