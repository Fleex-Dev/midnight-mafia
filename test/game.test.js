import test from "node:test";
import assert from "node:assert/strict";
import { createGameService, GameError } from "../game.js";

function addPlayers(service, count = 5) {
  const { room, player: host } = service.createRoom("방장");
  const players = [host];
  for (let index = 1; index < count; index += 1) {
    players.push(service.joinRoom(room.code, `참가자${index}`).player);
  }
  return { room, players, host };
}

function startAtDay(service, room, players, host) {
  service.applyAction(room, host, { type: "start" });
  for (const player of players)
    service.applyAction(room, player, { type: "ready" });
  assert.equal(room.phase, "day");
  assert.equal(room.round, 1);
}

function voteFor(service, room, players, target) {
  for (const player of players.filter((current) => current.alive)) {
    service.applyAction(room, player, {
      type: "vote",
      targetId:
        player.id === target.id
          ? players.find(
              (current) => current.alive && current.id !== target.id,
            ).id
          : target.id,
    });
  }
}

function confirmVoteResult(service, room, players) {
  for (const player of players.filter((current) => current.alive)) {
    service.applyAction(room, player, { type: "confirm-vote-result" });
  }
}

function enterFirstNight(service, room, players, host) {
  startAtDay(service, room, players, host);
  assert.equal(room.openingDay, true);
  for (const player of players) {
    service.applyAction(room, player, { type: "set-day-ready", ready: true });
  }
  assert.equal(room.phase, "night");
  assert.equal(room.round, 1);
  assert.equal(room.voteRound, 0);
}

function resolveFirstNight(service, room, players) {
  const mafia = players.find((player) => player.role === "mafia");
  const cop = players.find((player) => player.role === "cop");
  const doctor = players.find((player) => player.role === "doctor");
  const victim = players.find(
    (player) => player.role === "citizen" && player.alive,
  );
  service.applyAction(room, mafia, { type: "night-select", targetId: victim.id });
  service.applyAction(room, mafia, { type: "night-confirm" });
  if (cop) {
    service.applyAction(room, cop, { type: "night-select", targetId: mafia.id });
    service.applyAction(room, cop, { type: "night-confirm" });
  }
  if (doctor) {
    service.applyAction(room, doctor, {
      type: "night-select",
      targetId: doctor.id,
    });
    service.applyAction(room, doctor, { type: "night-confirm" });
  }
  return { mafia, cop, doctor, victim };
}

test("room creation, nickname validation, and role settings", () => {
  const service = createGameService();
  const { room, players, host } = addPlayers(service, 6);
  assert.throws(
    () => service.joinRoom(room.code, "참가자1"),
    (error) => error instanceof GameError && error.message === "이미 사용 중인 이름입니다.",
  );
  service.applyAction(room, host, {
    type: "update-settings",
    copEnabled: false,
    doctorEnabled: false,
  });
  startAtDay(service, room, players, host);
  assert.equal(players.some((player) => player.role === "cop"), false);
  assert.equal(players.some((player) => player.role === "doctor"), false);
});

test("a Durable Object can reserve and validate a room code", () => {
  const service = createGameService();
  const { room } = service.createRoom("방장", "AB23");
  assert.equal(room.code, "AB23");
  assert.throws(() => service.createRoom("다른 방장", "AB23"), /이미 사용 중/);
  assert.throws(() => service.createRoom("다른 방장", "IO10"), /형식/);
});

test("the opening day skips voting and starts the first night", () => {
  const service = createGameService();
  const { room, players, host } = addPlayers(service);
  enterFirstNight(service, room, players, host);
});

test("all living players prepare before voting and may cancel", () => {
  const service = createGameService();
  const { room, players, host } = addPlayers(service);
  enterFirstNight(service, room, players, host);
  resolveFirstNight(service, room, players);
  assert.equal(room.phase, "day");
  const alive = players.filter((player) => player.alive);
  service.applyAction(room, alive[0], { type: "set-day-ready", ready: true });
  service.applyAction(room, alive[0], { type: "set-day-ready", ready: false });
  assert.equal(service.getState(room, alive[0]).dayReadyCount, 0);
  for (const player of alive.slice(0, -1)) {
    service.applyAction(room, player, { type: "set-day-ready", ready: true });
  }
  assert.equal(room.phase, "day");
  service.applyAction(room, alive.at(-1), { type: "set-day-ready", ready: true });
  assert.equal(room.phase, "vote");
});

test("votes resolve and determine a winner", () => {
  const service = createGameService();
  const { room, players, host } = addPlayers(service);
  enterFirstNight(service, room, players, host);
  resolveFirstNight(service, room, players);
  const mafia = players.find((player) => player.role === "mafia");
  const alive = players.filter((player) => player.alive);
  for (const player of alive) {
    service.applyAction(room, player, { type: "set-day-ready", ready: true });
  }
  voteFor(service, room, players, mafia);
  assert.equal(room.phase, "vote-result");
  assert.equal(room.voteResult.playerName, mafia.name);
  assert.equal(room.voteResult.role, "mafia");
  assert.equal(room.voteResult.eliminated, true);
  assert.ok(room.voteResult.topVotes >= room.voteResult.requiredVotes);
  assert.equal(room.winner, null);
  confirmVoteResult(service, room, players);
  assert.equal(room.phase, "ended");
  assert.equal(room.winner, "citizen");
});

test("night advances immediately after every required action", () => {
  const service = createGameService();
  const { room, players, host } = addPlayers(service, 6);
  enterFirstNight(service, room, players, host);
  resolveFirstNight(service, room, players);
  assert.equal(room.phase, "day");
  assert.equal(room.round, 2);
});

test("night roles select, may change, and then confirm their action", () => {
  const service = createGameService();
  const { room, players, host } = addPlayers(service, 6);
  enterFirstNight(service, room, players, host);
  const mafia = players.find((player) => player.role === "mafia");
  const targets = players.filter((player) => player.role !== "mafia");

  service.applyAction(room, mafia, {
    type: "night-select",
    targetId: targets[0].id,
  });
  let state = service.getState(room, mafia);
  assert.equal(state.you.selectedTargetId, targets[0].id);
  assert.equal(state.you.actionSubmitted, false);

  service.applyAction(room, mafia, {
    type: "night-select",
    targetId: targets[1].id,
  });
  state = service.getState(room, mafia);
  assert.equal(state.you.selectedTargetId, targets[1].id);
  assert.equal(state.you.actionSubmitted, false);

  service.applyAction(room, mafia, { type: "night-confirm" });
  state = service.getState(room, mafia);
  assert.equal(state.you.actionSubmitted, true);
  assert.equal(room.phase, "night");
});

test("the Detective sees the private result immediately and keeps it the next morning", () => {
  const service = createGameService();
  const { room, players, host } = addPlayers(service, 6);
  enterFirstNight(service, room, players, host);
  const mafia = players.find((player) => player.role === "mafia");
  const cop = players.find((player) => player.role === "cop");
  const doctor = players.find((player) => player.role === "doctor");
  const victim = players.find((player) => player.role === "citizen");
  const citizen = players.find(
    (player) => player.role === "citizen" && player.id !== victim.id,
  );

  service.applyAction(room, cop, { type: "night-select", targetId: mafia.id });
  assert.equal(service.getState(room, cop).you.investigation, undefined);
  service.applyAction(room, cop, { type: "night-confirm" });

  let state = service.getState(room, cop);
  assert.equal(state.phase, "night");
  assert.equal(state.you.investigation.targetName, mafia.name);
  assert.equal(state.you.investigation.isMafia, true);
  assert.equal(service.getState(room, citizen).you.investigation, undefined);

  service.applyAction(room, mafia, { type: "night-select", targetId: victim.id });
  service.applyAction(room, mafia, { type: "night-confirm" });
  service.applyAction(room, doctor, { type: "night-select", targetId: doctor.id });
  service.applyAction(room, doctor, { type: "night-confirm" });

  state = service.getState(room, cop);
  assert.equal(state.phase, "day");
  assert.equal(state.round, 2);
  assert.match(state.announcement, new RegExp(`^${victim.name} 님이 밤사이`));
  assert.equal(state.you.investigation.targetName, mafia.name);
  assert.equal(state.you.investigation.isMafia, true);
  assert.equal(service.getState(room, citizen).you.investigation, undefined);
});

test("a tie or a top vote below the majority eliminates nobody", () => {
  function prepareVote() {
    const service = createGameService();
    const { room, players, host } = addPlayers(service, 6);
    enterFirstNight(service, room, players, host);
    resolveFirstNight(service, room, players);
    const alive = players.filter((player) => player.alive);
    for (const player of alive)
      service.applyAction(room, player, { type: "set-day-ready", ready: true });
    return { service, room, players, alive };
  }

  const tied = prepareVote();
  const [a, b, c, d, e] = tied.alive;
  for (const [player, target] of [
    [a, b],
    [b, a],
    [c, a],
    [d, b],
    [e, c],
  ])
    tied.service.applyAction(tied.room, player, {
      type: "vote",
      targetId: target.id,
    });

  assert.equal(tied.room.phase, "vote-result");
  assert.equal(tied.room.voteResult.eliminated, false);
  assert.equal(tied.room.voteResult.reason, "tie");
  assert.equal(tied.room.voteResult.topVotes, 2);
  assert.equal(tied.room.voteResult.requiredVotes, 3);
  assert.equal(tied.alive.every((player) => player.alive), true);
  confirmVoteResult(tied.service, tied.room, tied.players);
  assert.equal(tied.room.phase, "night");

  const belowMajority = prepareVote();
  const [f, g, h, i, j] = belowMajority.alive;
  for (const [player, target] of [
    [f, g],
    [g, f],
    [h, f],
    [i, h],
    [j, i],
  ])
    belowMajority.service.applyAction(belowMajority.room, player, {
      type: "vote",
      targetId: target.id,
    });

  assert.equal(belowMajority.room.phase, "vote-result");
  assert.equal(belowMajority.room.voteResult.eliminated, false);
  assert.equal(belowMajority.room.voteResult.reason, "no-majority");
  assert.equal(belowMajority.room.voteResult.topVotes, 2);
  assert.equal(belowMajority.room.voteResult.requiredVotes, 3);
  assert.equal(belowMajority.alive.every((player) => player.alive), true);
});

test("a night result remains visible when the final kill ends the game", () => {
  const service = createGameService();
  const { room, players, host } = addPlayers(service, 4);
  service.applyAction(room, host, {
    type: "update-settings",
    copEnabled: false,
    doctorEnabled: false,
  });
  enterFirstNight(service, room, players, host);

  const mafia = players.find((player) => player.role === "mafia");
  const firstVictim = players.find((player) => player.role === "citizen");
  service.applyAction(room, mafia, {
    type: "night-select",
    targetId: firstVictim.id,
  });
  service.applyAction(room, mafia, { type: "night-confirm" });

  const alive = players.filter((player) => player.alive);
  for (const player of alive)
    service.applyAction(room, player, { type: "set-day-ready", ready: true });
  for (let index = 0; index < alive.length; index += 1)
    service.applyAction(room, alive[index], {
      type: "vote",
      targetId: alive[(index + 1) % alive.length].id,
    });
  confirmVoteResult(service, room, players);

  const finalVictim = players.find(
    (player) => player.alive && player.role === "citizen",
  );
  service.applyAction(room, mafia, {
    type: "night-select",
    targetId: finalVictim.id,
  });
  service.applyAction(room, mafia, { type: "night-confirm" });

  assert.equal(room.phase, "ended");
  assert.equal(room.winner, "mafia");
  assert.match(room.announcement, new RegExp(finalVictim.name));
  assert.match(room.announcement, /정체는 시민이었습니다/);
  assert.match(room.announcement, /마피아 팀 승리/);
});

test("the vote result remains until every survivor confirms it", () => {
  const service = createGameService();
  const { room, players, host } = addPlayers(service, 6);
  enterFirstNight(service, room, players, host);
  resolveFirstNight(service, room, players);
  const alive = players.filter((player) => player.alive);
  for (const player of alive) {
    service.applyAction(room, player, { type: "set-day-ready", ready: true });
  }
  const target = alive.find((player) => player.role !== "mafia");
  voteFor(service, room, players, target);
  assert.equal(room.phase, "vote-result");
  assert.equal(room.voteResult.playerName, target.name);
  assert.equal(room.voteResult.role, target.role);
  assert.match(room.announcement, new RegExp(`^${target.name} 님은 `));
  assert.match(room.announcement, new RegExp(room.voteResult.roleName));

  const survivors = players.filter((player) => player.alive);
  const firstState = service.getState(room, survivors[0]);
  assert.equal(firstState.resultReadyCount, 0);
  assert.equal(firstState.resultReadyRequiredCount, survivors.length);
  for (const player of survivors.slice(0, -1)) {
    service.applyAction(room, player, { type: "confirm-vote-result" });
  }
  assert.equal(room.phase, "vote-result");
  service.applyAction(room, survivors.at(-1), {
    type: "confirm-vote-result",
  });
  assert.equal(room.phase, "night");
  assert.equal(room.voteResult, null);
  assert.match(room.announcement, /번째 밤입니다/);
});

test("a departing survivor cannot block the vote-result confirmation", () => {
  const service = createGameService();
  const { room, players, host } = addPlayers(service, 6);
  enterFirstNight(service, room, players, host);
  resolveFirstNight(service, room, players);
  const alive = players.filter((player) => player.alive);
  for (const player of alive) {
    service.applyAction(room, player, { type: "set-day-ready", ready: true });
  }
  const target = alive.find((player) => player.role === "citizen");
  voteFor(service, room, players, target);

  const survivors = players.filter((player) => player.alive);
  const departing = survivors.find((player) => player.role !== "mafia");
  for (const player of survivors.filter((player) => player.id !== departing.id)) {
    service.applyAction(room, player, { type: "confirm-vote-result" });
  }
  assert.equal(room.phase, "vote-result");
  service.removePlayer(room, departing.id);
  assert.equal(room.phase, "night");
});

test("Mafia can see team selections while other roles cannot", () => {
  const service = createGameService();
  const { room, players, host } = addPlayers(service, 8);
  enterFirstNight(service, room, players, host);
  const mafia = players.filter((player) => player.role === "mafia");
  const citizen = players.find((player) => player.role === "citizen");
  const target = players.find(
    (player) => player.alive && player.role !== "mafia",
  );

  service.applyAction(room, mafia[0], {
    type: "night-select",
    targetId: target.id,
  });

  const teammateState = service.getState(room, mafia[1]);
  const selection = teammateState.you.mafiaSelections.find(
    (current) => current.playerName === mafia[0].name,
  );
  assert.equal(selection.targetName, target.name);
  assert.equal(selection.confirmed, false);
  assert.equal(teammateState.you.mafiaSelections.length, mafia.length);
  assert.deepEqual(service.getState(room, citizen).you.mafiaSelections, []);

  service.applyAction(room, mafia[0], { type: "night-confirm" });
  const confirmedSelection = service
    .getState(room, mafia[1])
    .you.mafiaSelections.find(
      (current) => current.playerName === mafia[0].name,
    );
  assert.equal(confirmedSelection.confirmed, true);
});

test("leaving transfers the host and cannot block a phase", () => {
  const service = createGameService();
  const { room, players, host } = addPlayers(service);
  service.removePlayer(room, host.id);
  assert.equal(room.hostId, players[1].id);

  const remaining = players.slice(1);
  enterFirstNight(service, room, remaining, remaining[0]);
  const mafia = remaining.find((player) => player.role === "mafia");
  const cop = remaining.find((player) => player.role === "cop");
  const doctor = remaining.find((player) => player.role === "doctor");
  const target = remaining.find(
    (player) => player.role === "citizen" && player.alive,
  );
  service.applyAction(room, mafia, { type: "night-action", targetId: target.id });
  if (cop) service.applyAction(room, cop, { type: "night-action", targetId: mafia.id });
  if (doctor) service.removePlayer(room, doctor.id);
  assert.notEqual(room.phase, "night");
});

test("room snapshots restore maps, sets, and activity", () => {
  const source = createGameService();
  const { room } = addPlayers(source);
  room.lastActivityAt = 123456;
  const snapshot = source.exportSnapshot();
  const restored = createGameService();
  assert.equal(restored.importSnapshot(snapshot), 1);
  const restoredRoom = restored.rooms.get(room.code);
  assert.equal(restoredRoom.players.size, 5);
  assert.equal(restoredRoom.lastActivityAt, 123456);
  assert.ok(restoredRoom.dayReady instanceof Set);
  assert.ok(restoredRoom.resultReady instanceof Set);
  assert.ok(restoredRoom.actions instanceof Map);
});

test("only inactive rooms are removed", () => {
  const service = createGameService();
  const oldRoom = service.createRoom("오래된 방").room;
  const activeRoom = service.createRoom("활성 방").room;
  oldRoom.lastActivityAt = Date.now() - 10_000;
  activeRoom.lastActivityAt = Date.now();
  assert.equal(service.removeStaleRooms(5_000), 1);
  assert.equal(service.rooms.has(oldRoom.code), false);
  assert.equal(service.rooms.has(activeRoom.code), true);
});

test("lobby state uses a lightweight QR endpoint", () => {
  const service = createGameService();
  const { room, player } = service.createRoom("방장");
  room.joinUrl = `https://example.com/?room=${room.code}`;
  assert.equal(
    service.getState(room, player).qrDataUrl,
    `/api/rooms/${room.code}/qr`,
  );

  room.phase = "reveal";
  assert.equal(service.getState(room, player).qrDataUrl, "");
});

test("leaving removes actions that targeted the departing player", () => {
  const service = createGameService();
  const { room, players, host } = addPlayers(service);
  startAtDay(service, room, players, host);
  room.phase = "vote";
  room.actions.clear();
  const departing = players.find((player) => player.role === "citizen");
  const voter = players.find(
    (player) => player.id !== departing.id && player.alive,
  );
  room.actions.set(voter.id, { targetId: departing.id });

  assert.doesNotThrow(() => service.removePlayer(room, departing.id));
  assert.equal(room.actions.has(voter.id), false);
  assert.equal(room.phase, "vote");
});
