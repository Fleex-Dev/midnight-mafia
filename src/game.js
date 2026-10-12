const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const ROLE_INFO = {
  mafia: {
    name: "마피아",
    icon: "◆",
    team: "mafia",
    description:
      "밤마다 시민 한 명을 제거하세요. 마피아의 수가 시민과 같아지면 승리합니다.",
  },
  cop: {
    name: "경찰",
    icon: "◎",
    team: "citizen",
    description: "밤마다 한 명을 조사해 마피아인지 확인하세요.",
  },
  doctor: {
    name: "의사",
    icon: "+",
    team: "citizen",
    description: "밤마다 한 명을 지켜 마피아의 공격을 막으세요.",
  },
  citizen: {
    name: "시민",
    icon: "●",
    team: "citizen",
    description: "대화를 통해 마피아를 찾아 낮 투표로 제거하세요.",
  },
};

export class GameError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function makeId(size = 12) {
  let value = "";
  while (value.length < size * 2) {
    value += globalThis.crypto.randomUUID().replaceAll("-", "");
  }
  return value.slice(0, size * 2);
}

function randomInt(max) {
  if (!Number.isSafeInteger(max) || max < 1)
    throw new RangeError("max must be a positive integer");
  const range = 0x1_0000_0000;
  const limit = range - (range % max);
  const values = new Uint32Array(1);
  do globalThis.crypto.getRandomValues(values);
  while (values[0] >= limit);
  return values[0] % max;
}

function makeCode(existing) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let code = "";
    for (let index = 0; index < 4; index += 1) {
      code += ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)];
    }
    if (!existing.has(code)) return code;
  }
  throw new GameError("방 코드를 만들지 못했습니다. 다시 시도해 주세요.", 500);
}

function cleanName(value) {
  const name = String(value || "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ");
  if ([...name].length < 1 || [...name].length > 12)
    throw new GameError("이름은 1~12자로 입력해 주세요.");
  if (/[\p{Cc}\p{Cf}\p{Cs}]/u.test(name))
    throw new GameError("이름에 사용할 수 없는 문자가 포함되어 있습니다.");
  return name;
}

function shuffle(items) {
  const output = [...items];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swap = randomInt(index + 1);
    [output[index], output[swap]] = [output[swap], output[index]];
  }
  return output;
}

function roleSummary(count, settings) {
  const mafia = Math.max(1, Math.floor(count / 4));
  const cop = settings.copEnabled ? 1 : 0;
  const doctor = settings.doctorEnabled ? 1 : 0;
  return {
    mafia,
    cop,
    doctor,
    citizen: Math.max(0, count - mafia - cop - doctor),
  };
}

function roleDeck(count, settings) {
  const summary = roleSummary(count, settings);
  const roles = Array(summary.mafia).fill("mafia");
  if (summary.cop) roles.push("cop");
  if (summary.doctor) roles.push("doctor");
  while (roles.length < count) roles.push("citizen");
  return shuffle(roles);
}

function requireRoom(rooms, rawCode) {
  const code = String(rawCode || "")
    .trim()
    .toUpperCase();
  const room = rooms.get(code);
  if (!room)
    throw new GameError("방을 찾을 수 없습니다. 코드를 확인해 주세요.", 404);
  return room;
}

function requirePlayer(room, playerId, token) {
  const player = room.players.get(String(playerId || ""));
  if (!player || player.token !== token)
    throw new GameError("참가 정보를 확인할 수 없습니다.", 401);
  return player;
}

function requireHost(room, player) {
  if (room.hostId !== player.id)
    throw new GameError("방장만 진행할 수 있습니다.", 403);
}

function alivePlayers(room) {
  return [...room.players.values()].filter((player) => player.alive);
}

function touchRoom(room) {
  room.lastActivityAt = Date.now();
}

function requireSelectionOpen(room, player) {
  const current = room.actions.get(player.id);
  if (current && current.confirmed !== false)
    throw new GameError("이미 선택을 확정했습니다.", 409);
}

function mostSelected(entries) {
  const counts = new Map();
  for (const entry of entries)
    counts.set(entry.targetId, (counts.get(entry.targetId) || 0) + 1);
  const highest = Math.max(...counts.values());
  return [...counts.entries()]
    .filter(([, count]) => count === highest)
    .map(([id]) => id);
}

function roleWas(role) {
  const name = ROLE_INFO[role].name;
  const last = name.charCodeAt(name.length - 1);
  const hasFinalConsonant =
    last >= 0xac00 && last <= 0xd7a3 && (last - 0xac00) % 28 !== 0;
  return `${name}${hasFinalConsonant ? "이었습니다" : "였습니다"}`;
}

function checkWinner(room, precedingAnnouncement = "") {
  const alive = alivePlayers(room);
  const mafia = alive.filter((player) => player.role === "mafia").length;
  const citizens = alive.length - mafia;
  if (mafia === 0) {
    room.phase = "ended";
    room.winner = "citizen";
    room.announcement = [
      precedingAnnouncement,
      "모든 마피아를 찾아냈습니다. 시민 팀 승리!",
    ]
      .filter(Boolean)
      .join(" ");
    return true;
  }
  if (mafia >= citizens) {
    room.phase = "ended";
    room.winner = "mafia";
    room.announcement = [
      precedingAnnouncement,
      "마피아가 마을을 장악했습니다. 마피아 팀 승리!",
    ]
      .filter(Boolean)
      .join(" ");
    return true;
  }
  return false;
}

function recordInvestigation(room, player, action) {
  if (player.role !== "cop" || !action?.targetId || action.confirmed === false)
    return;
  const target = room.players.get(action.targetId);
  if (!target) return;
  room.investigations.set(player.id, {
    round: room.round,
    targetName: target.name,
    isMafia: target.role === "mafia",
  });
}

function beginNight(room) {
  room.phase = "night";
  room.openingDay = false;
  room.actions.clear();
  room.dayReady.clear();
  room.resultReady.clear();
  room.voteResult = null;
  room.announcement = `${room.round}번째 밤입니다. 각자의 화면에서 행동을 선택하세요.`;
}

function beginDay(room, announcement = "", openingDay = false) {
  room.phase = "day";
  room.round += 1;
  room.openingDay = openingDay;
  room.actions.clear();
  room.dayReady.clear();
  room.resultReady.clear();
  if (announcement) room.announcement = announcement;
}

function beginVote(room) {
  Object.assign(room, {
    phase: "vote",
    voteRound: 1,
    announcement: "의심되는 사람 한 명을 각자 휴대폰에서 선택하세요.",
  });
  room.actions.clear();
  room.dayReady.clear();
  room.resultReady.clear();
  room.voteResult = null;
}

function resolveNight(room) {
  const required = alivePlayers(room).filter((player) =>
    ["mafia", "cop", "doctor"].includes(player.role),
  );
  if (
    !required.every((player) => {
      const action = room.actions.get(player.id);
      return action && action.confirmed !== false;
    })
  )
    return;

  const mafia = required.filter((player) => player.role === "mafia");
  const leaders = mostSelected(
    mafia.map((player) => room.actions.get(player.id)),
  );
  if (leaders.length > 1) {
    for (const player of mafia) {
      room.actions.delete(player.id);
      room.privateNotices.set(
        player.id,
        "마피아의 선택이 갈렸습니다. 같은 대상을 다시 선택하세요.",
      );
    }
    return;
  }

  const victim = room.players.get(leaders[0]);
  const doctor = required.find((player) => player.role === "doctor");
  const protectedId = doctor ? room.actions.get(doctor.id)?.targetId : null;
  const cop = required.find((player) => player.role === "cop");
  if (cop) recordInvestigation(room, cop, room.actions.get(cop.id));

  let nightResult;
  if (victim && victim.id !== protectedId) {
    victim.alive = false;
    nightResult = `${victim.name} 님이 밤사이 사라졌습니다. 정체는 ${roleWas(victim.role)}.`;
  } else {
    nightResult =
      "평온한 아침입니다. 지난밤에는 아무도 사라지지 않았습니다.";
  }
  room.announcement = nightResult;
  room.actions.clear();
  if (!checkWinner(room, nightResult)) beginDay(room);
}

function resolveVote(room) {
  const alive = alivePlayers(room);
  if (
    !alive.every((player) => {
      const action = room.actions.get(player.id);
      return action && action.confirmed !== false;
    })
  )
    return;
  const votes = alive.map((player) => room.actions.get(player.id));
  const leaders = mostSelected(votes);
  const counts = new Map();
  for (const vote of votes)
    counts.set(vote.targetId, (counts.get(vote.targetId) || 0) + 1);
  const topVotes = Math.max(...counts.values());
  const requiredVotes = Math.floor(alive.length / 2) + 1;
  room.actions.clear();

  room.phase = "vote-result";
  room.resultReady.clear();
  if (leaders.length > 1) {
    room.voteResult = {
      eliminated: false,
      reason: "tie",
      topVotes,
      requiredVotes,
    };
    room.announcement =
      "최다 득표가 동률이어서 아무도 추방되지 않았습니다.";
    return;
  }

  if (topVotes < requiredVotes) {
    room.voteResult = {
      eliminated: false,
      reason: "no-majority",
      topVotes,
      requiredVotes,
    };
    room.announcement =
      "과반수 득표자가 없어 아무도 추방되지 않았습니다.";
    return;
  }

  const eliminated = room.players.get(leaders[0]);
  eliminated.alive = false;
  room.voteResult = {
    eliminated: true,
    reason: "majority",
    playerId: eliminated.id,
    playerName: eliminated.name,
    role: eliminated.role,
    roleName: ROLE_INFO[eliminated.role].name,
    topVotes,
    requiredVotes,
  };
  room.announcement = `${eliminated.name} 님은 ${roleWas(eliminated.role)}.`;
}

export function createGameService() {
  const rooms = new Map();

  function createRoom(hostName, preferredCode = "") {
    const requestedCode = String(preferredCode || "").trim().toUpperCase();
    const code = requestedCode || makeCode(rooms);
    if (!/^[A-Z2-9]{4}$/.test(code) || /[IO10]/.test(code)) {
      throw new GameError("방 코드 형식이 올바르지 않습니다.");
    }
    if (rooms.has(code)) throw new GameError("이미 사용 중인 방 코드입니다.", 409);
    const host = {
      id: makeId(),
      token: makeId(18),
      name: cleanName(hostName),
      role: null,
      alive: true,
      ready: false,
    };
    const room = {
      code,
      hostId: host.id,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      phase: "lobby",
      round: 0,
      voteRound: 0,
      openingDay: false,
      winner: null,
      announcement: "친구들이 모두 들어오면 게임을 시작하세요.",
      players: new Map([[host.id, host]]),
      actions: new Map(),
      dayReady: new Set(),
      resultReady: new Set(),
      investigations: new Map(),
      privateNotices: new Map(),
      voteResult: null,
      joinUrl: "",
      settings: {
        copEnabled: true,
        doctorEnabled: false,
        doctorCustomized: false,
      },
    };
    rooms.set(code, room);
    return { room, player: host };
  }

  function joinRoom(rawCode, rawName) {
    const room = requireRoom(rooms, rawCode);
    if (room.phase !== "lobby")
      throw new GameError("이미 시작한 게임에는 참가할 수 없습니다.");
    if (room.players.size >= 12)
      throw new GameError("이 방은 최대 인원 12명이 모두 찼습니다.");
    const name = cleanName(rawName);
    if (
      [...room.players.values()].some(
        (player) =>
          player.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
      )
    )
      throw new GameError("이미 사용 중인 이름입니다.");
    const player = {
      id: makeId(),
      token: makeId(18),
      name,
      role: null,
      alive: true,
      ready: false,
    };
    room.players.set(player.id, player);
    touchRoom(room);
    if (!room.settings.doctorCustomized && room.players.size >= 5)
      room.settings.doctorEnabled = true;
    return { room, player };
  }

  function authenticate(rawCode, playerId, token) {
    const room = requireRoom(rooms, rawCode);
    return { room, player: requirePlayer(room, playerId, token) };
  }

  function applyAction(room, player, action) {
    const type = String(action?.type || "");
    touchRoom(room);
    room.privateNotices.delete(player.id);
    if (type === "update-settings") {
      requireHost(room, player);
      if (room.phase !== "lobby")
        throw new GameError("대기실에서만 역할을 바꿀 수 있습니다.");
      if (typeof action.copEnabled === "boolean")
        room.settings.copEnabled = action.copEnabled;
      if (typeof action.doctorEnabled === "boolean") {
        room.settings.doctorEnabled = action.doctorEnabled;
        room.settings.doctorCustomized = true;
      }
      return;
    }
    if (type === "start") {
      requireHost(room, player);
      if (room.phase !== "lobby")
        throw new GameError("이미 게임이 시작되었습니다.");
      if (room.players.size < 4)
        throw new GameError("게임을 시작하려면 최소 4명이 필요합니다.");
      const roles = roleDeck(room.players.size, room.settings);
      [...room.players.values()].forEach((current, index) => {
        current.role = roles[index];
        current.alive = true;
        current.ready = false;
      });
      Object.assign(room, {
        phase: "reveal",
        round: 0,
        voteRound: 0,
        openingDay: false,
        winner: null,
        announcement: "역할을 혼자 확인한 뒤 준비 버튼을 눌러 주세요.",
      });
      room.actions.clear();
      room.dayReady.clear();
      room.resultReady.clear();
      room.investigations.clear();
      room.voteResult = null;
      return;
    }
    if (type === "ready") {
      if (room.phase !== "reveal")
        throw new GameError("지금은 준비할 단계가 아닙니다.");
      player.ready = true;
      if ([...room.players.values()].every((current) => current.ready))
        beginDay(
          room,
          "첫 번째 낮입니다. 서로 이야기한 뒤 밤을 준비하세요.",
          true,
        );
      return;
    }
    if (type === "night-select") {
      if (room.phase !== "night" || !player.alive)
        throw new GameError("지금은 밤 행동을 할 수 없습니다.");
      if (!["mafia", "cop", "doctor"].includes(player.role))
        throw new GameError("이 역할은 밤 행동이 없습니다.");
      requireSelectionOpen(room, player);
      const target = room.players.get(String(action.targetId || ""));
      if (!target?.alive) throw new GameError("선택할 수 없는 대상입니다.");
      if (player.role === "mafia" && target.role === "mafia")
        throw new GameError("같은 마피아는 선택할 수 없습니다.");
      if (player.role === "cop" && target.id === player.id)
        throw new GameError("자신은 조사할 수 없습니다.");
      room.actions.set(player.id, {
        targetId: target.id,
        confirmed: false,
      });
      return;
    }
    if (type === "night-confirm") {
      if (room.phase !== "night" || !player.alive)
        throw new GameError("지금은 밤 행동을 할 수 없습니다.");
      if (!["mafia", "cop", "doctor"].includes(player.role))
        throw new GameError("이 역할은 밤 행동이 없습니다.");
      const selection = room.actions.get(player.id);
      if (!selection?.targetId)
        throw new GameError("먼저 대상을 선택해 주세요.");
      if (selection.confirmed !== false)
        throw new GameError("이미 선택을 확정했습니다.", 409);
      room.actions.set(player.id, { ...selection, confirmed: true });
      recordInvestigation(room, player, room.actions.get(player.id));
      resolveNight(room);
      return;
    }
    if (type === "set-day-ready") {
      if (room.phase !== "day")
        throw new GameError("지금은 투표를 준비할 수 없습니다.");
      if (!player.alive)
        throw new GameError("탈락한 참가자는 투표를 준비할 수 없습니다.");
      if (action.ready === false) room.dayReady.delete(player.id);
      else room.dayReady.add(player.id);
      if (alivePlayers(room).every((current) => room.dayReady.has(current.id))) {
        if (room.openingDay) beginNight(room);
        else beginVote(room);
      }
      return;
    }
    if (type === "vote-select") {
      if (room.phase !== "vote" || !player.alive)
        throw new GameError("지금은 투표할 수 없습니다.");
      requireSelectionOpen(room, player);
      const target = room.players.get(String(action.targetId || ""));
      if (!target?.alive || target.id === player.id)
        throw new GameError("선택할 수 없는 대상입니다.");
      room.actions.set(player.id, {
        targetId: target.id,
        confirmed: false,
      });
      return;
    }
    if (type === "vote-confirm") {
      if (room.phase !== "vote" || !player.alive)
        throw new GameError("지금은 투표할 수 없습니다.");
      const selection = room.actions.get(player.id);
      if (!selection?.targetId)
        throw new GameError("먼저 투표할 사람을 선택해 주세요.");
      if (selection.confirmed !== false)
        throw new GameError("이미 선택을 확정했습니다.", 409);
      room.actions.set(player.id, { ...selection, confirmed: true });
      resolveVote(room);
      return;
    }
    if (type === "confirm-vote-result") {
      if (room.phase !== "vote-result")
        throw new GameError("지금은 투표 결과를 확인할 수 없습니다.");
      if (!player.alive)
        throw new GameError("탈락한 참가자는 진행 확인 인원에 포함되지 않습니다.");
      room.resultReady.add(player.id);
      if (
        alivePlayers(room).every((current) =>
          room.resultReady.has(current.id),
        )
      ) {
        if (!checkWinner(room)) beginNight(room);
      }
      return;
    }
    if (type === "kick") {
      requireHost(room, player);
      if (room.phase !== "lobby")
        throw new GameError("대기실에서만 내보낼 수 있습니다.");
      const targetId = String(action.targetId || "");
      if (targetId === player.id)
        throw new GameError("자기 자신은 내보낼 수 없습니다.");
      removePlayer(room, targetId);
      if (!room.settings.doctorCustomized && room.players.size < 5)
        room.settings.doctorEnabled = false;
      return;
    }
    if (type === "restart") {
      requireHost(room, player);
      if (room.phase !== "ended")
        throw new GameError("게임이 끝난 뒤 다시 시작할 수 있습니다.");
      Object.assign(room, {
        phase: "lobby",
        round: 0,
        voteRound: 0,
        openingDay: false,
        winner: null,
        announcement: "같은 멤버로 새 게임을 준비합니다.",
      });
      room.actions.clear();
      room.dayReady.clear();
      room.resultReady.clear();
      room.investigations.clear();
      room.privateNotices.clear();
      room.voteResult = null;
      for (const current of room.players.values()) {
        current.role = null;
        current.alive = true;
        current.ready = false;
      }
      return;
    }
    throw new GameError("알 수 없는 요청입니다.");
  }

  function removePlayer(room, playerId) {
    const player = room.players.get(String(playerId || ""));
    if (!player) return false;

    room.players.delete(player.id);
    room.actions.delete(player.id);
    room.dayReady.delete(player.id);
    room.resultReady.delete(player.id);
    room.investigations.delete(player.id);
    room.privateNotices.delete(player.id);
    for (const [actorId, action] of room.actions) {
      if (action?.targetId === player.id) room.actions.delete(actorId);
    }
    touchRoom(room);

    if (room.hostId === player.id) {
      room.hostId = room.players.keys().next().value || null;
    }

    if (
      room.phase === "lobby" &&
      !room.settings.doctorCustomized &&
      room.players.size < 5
    ) {
      room.settings.doctorEnabled = false;
    }

    if (room.players.size === 0) {
      rooms.delete(room.code);
      return true;
    }

    if (room.phase === "lobby" || room.phase === "ended") return true;
    if (room.phase === "vote-result") {
      if (
        alivePlayers(room).every((current) =>
          room.resultReady.has(current.id),
        )
      ) {
        if (!checkWinner(room)) beginNight(room);
      }
      return true;
    }
    if (checkWinner(room)) return true;

    if (room.phase === "reveal") {
      if ([...room.players.values()].every((current) => current.ready)) {
        beginDay(
          room,
          "첫 번째 낮입니다. 서로 이야기한 뒤 밤을 준비하세요.",
          true,
        );
      }
    } else if (room.phase === "night") {
      resolveNight(room);
    } else if (room.phase === "day") {
      if (alivePlayers(room).every((current) => room.dayReady.has(current.id))) {
        if (room.openingDay) beginNight(room);
        else beginVote(room);
      }
    } else if (room.phase === "vote") {
      resolveVote(room);
    }

    return true;
  }

  function getState(room, player, connectedIds = new Set()) {
    const action = room.actions.get(player.id);
    const mafiaTeam =
      player.role === "mafia"
        ? alivePlayers(room)
            .filter(
              (current) => current.role === "mafia" && current.id !== player.id,
            )
            .map((current) => current.name)
        : [];
    const mafiaSelections =
      room.phase === "night" && player.alive && player.role === "mafia"
        ? alivePlayers(room)
            .filter((current) => current.role === "mafia")
            .map((current) => {
              const selection = room.actions.get(current.id);
              const target = selection
                ? room.players.get(selection.targetId)
                : null;
              return {
                playerName: current.name,
                targetName: target?.name || "",
                confirmed: Boolean(
                  selection && selection.confirmed !== false,
                ),
                isSelf: current.id === player.id,
              };
            })
        : [];
    let targets = [];
    if (
      room.phase === "night" &&
      player.alive &&
      ["mafia", "cop", "doctor"].includes(player.role)
    ) {
      targets = alivePlayers(room)
        .filter(
          (target) => !(player.role === "mafia" && target.role === "mafia"),
        )
        .filter((target) => !(player.role === "cop" && target.id === player.id))
        .map(({ id, name }) => ({ id, name }));
    }
    if (room.phase === "vote" && player.alive)
      targets = alivePlayers(room)
        .filter((target) => target.id !== player.id)
        .map(({ id, name }) => ({ id, name }));
    return {
      code: room.code,
      phase: room.phase,
      round: room.round,
      voteRound: room.voteRound,
      openingDay: Boolean(room.openingDay),
      winner: room.winner,
      announcement: room.announcement,
      voteResult: room.phase === "vote-result" ? room.voteResult : null,
      joinUrl: room.joinUrl,
      qrDataUrl:
        room.phase === "lobby" && room.joinUrl
          ? `/api/rooms/${room.code}/qr`
          : "",
      settings: {
        copEnabled: room.settings.copEnabled,
        doctorEnabled: room.settings.doctorEnabled,
      },
      roleSummary: roleSummary(room.players.size, room.settings),
      you: {
        id: player.id,
        name: player.name,
        role: player.role,
        roleInfo: player.role ? ROLE_INFO[player.role] : null,
        alive: player.alive,
        ready: player.ready,
        dayReady: room.dayReady.has(player.id),
        resultReady: room.resultReady.has(player.id),
        isHost: player.id === room.hostId,
        actionSubmitted: Boolean(action && action.confirmed !== false),
        selectedTargetId: action?.targetId || "",
        investigation: room.investigations.get(player.id),
        mafiaTeam,
        mafiaSelections,
        privateNotice: room.privateNotices.get(player.id) || "",
      },
      targets,
      players: [...room.players.values()].map((current) => ({
        id: current.id,
        name: current.name,
        alive: current.alive,
        ready: room.phase === "reveal" ? current.ready : undefined,
        dayReady:
          room.phase === "day" && current.alive
            ? room.dayReady.has(current.id)
            : undefined,
        resultReady:
          room.phase === "vote-result" && current.alive
            ? room.resultReady.has(current.id)
            : undefined,
        isHost: current.id === room.hostId,
        connected: connectedIds.has(current.id),
        role: room.phase === "ended" ? current.role : undefined,
      })),
      dayReadyCount: room.phase === "day" ? room.dayReady.size : undefined,
      dayReadyRequiredCount:
        room.phase === "day" ? alivePlayers(room).length : undefined,
      submittedCount:
        room.phase === "vote"
          ? [...room.actions.values()].filter(
              (current) => current.confirmed !== false,
            ).length
          : undefined,
      requiredCount:
        room.phase === "vote" ? alivePlayers(room).length : undefined,
      resultReadyCount:
        room.phase === "vote-result" ? room.resultReady.size : undefined,
      resultReadyRequiredCount:
        room.phase === "vote-result" ? alivePlayers(room).length : undefined,
    };
  }

  function removeStaleRooms(maxAge = 1000 * 60 * 60 * 8) {
    const cutoff = Date.now() - maxAge;
    let removed = 0;
    for (const [code, room] of rooms) {
      if ((room.lastActivityAt || room.createdAt) < cutoff) {
        rooms.delete(code);
        removed += 1;
      }
    }
    return removed;
  }

  function exportSnapshot() {
    return {
      version: 1,
      rooms: [...rooms.values()].map((room) => {
        const { qrDataUrl: _legacyQrDataUrl, ...savedRoom } = room;
        return {
          ...savedRoom,
          players: [...room.players.entries()],
          actions: [...room.actions.entries()],
          dayReady: [...room.dayReady],
          resultReady: [...room.resultReady],
          investigations: [...room.investigations.entries()],
          privateNotices: [...room.privateNotices.entries()],
        };
      }),
    };
  }

  function importSnapshot(snapshot) {
    if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.rooms)) {
      return 0;
    }

    let restored = 0;
    for (const saved of snapshot.rooms) {
      if (!saved?.code || !Array.isArray(saved.players)) continue;
      rooms.set(saved.code, {
        ...saved,
        lastActivityAt: Number(
          saved.lastActivityAt || saved.createdAt || Date.now(),
        ),
        players: new Map(saved.players),
        actions: new Map(saved.actions || []),
        dayReady: new Set(saved.dayReady || []),
        resultReady: new Set(saved.resultReady || []),
        investigations: new Map(saved.investigations || []),
        privateNotices: new Map(saved.privateNotices || []),
      });
      restored += 1;
    }
    return restored;
  }

  return {
    rooms,
    createRoom,
    joinRoom,
    authenticate,
    applyAction,
    getState,
    touchRoom,
    removePlayer,
    removeStaleRooms,
    exportSnapshot,
    importSnapshot,
  };
}
