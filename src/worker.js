import QRCode from "qrcode";
import { createGameService, GameError } from "../game.js";

const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_IDLE_TTL_MS = 8 * 60 * 60 * 1000;
const DISCONNECT_GRACE_MS = 2 * 60 * 1000;
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

const SECURITY_HEADERS = {
  "content-security-policy":
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "referrer-policy": "same-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

function makeRoomCode() {
  let code = "";
  for (let index = 0; index < 4; index += 1) {
    code += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)];
  }
  return code;
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
        const body = await request.json();
        const { room, player } = this.service.createRoom(body.name, body.code);
        room.joinUrl = body.joinUrl;
        await this.persist();
        return json(201, {
          session: sessionFor(room, player),
          state: this.service.getState(room, player),
        });
      }

      const room = this.room();
      if (!room) throw new GameError("방을 찾을 수 없습니다. 코드를 확인해 주세요.", 404);

      if (request.method === "GET" && url.pathname === "/qr") {
        const image = await QRCode.toString(room.joinUrl, {
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
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        server.serializeAttachment({ authenticated: false });
        this.ctx.acceptWebSocket(server);
        return new Response(null, { status: 101, webSocket: client });
      }

      if (request.method === "POST" && url.pathname === "/join") {
        const body = await request.json();
        const { player } = this.service.joinRoom(room.code, body.name);
        await this.persist();
        await this.broadcast();
        return json(201, {
          session: sessionFor(room, player),
          state: this.service.getState(room, player, this.connectedIds()),
        });
      }

      const credentials = authentication(request);
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
        this.service.applyAction(room, player, await request.json());
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
      const message = JSON.parse(text);
      if (message.type !== "authenticate") throw new Error("Invalid message");
      const { room, player } = this.service.authenticate(
        message.room,
        message.playerId,
        message.token,
      );
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
    if (!attachment?.authenticated || !room?.players.has(attachment.playerId)) return;
    this.disconnectDeadlines[attachment.playerId] =
      Date.now() + DISCONNECT_GRACE_MS;
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

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function routeRoom(request, env, code, operation) {
  const id = env.ROOMS.idFromName(code);
  const stub = env.ROOMS.get(id);
  const internalUrl = new URL(`https://room.internal/${operation}`);
  return stub.fetch(new Request(internalUrl, request));
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/healthz") {
        return json(200, { ok: true, platform: "cloudflare" });
      }
      if (request.method === "GET" && url.pathname === "/templates.json") {
        return templatesResponse(request, env);
      }
      if (request.method === "POST" && url.pathname === "/api/rooms") {
        const body = await request.json();
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
        return routeRoom(request, env, code, match[2].toLowerCase());
      }
      if (url.pathname.startsWith("/api/")) {
        return json(404, { error: "요청을 찾을 수 없습니다." });
      }
      return withSecurityHeaders(await env.ASSETS.fetch(request));
    } catch (error) {
      return errorResponse(error);
    }
  },
};
