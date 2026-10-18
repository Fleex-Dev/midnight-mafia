import { createScreens } from "./js/screens.js";
import { loadTemplates } from "./js/templates.js";

const container = document.querySelector("#preview-container");
const roleSelect = document.querySelector("#role-select");
const stageSelect = document.querySelector("#case-select");
const previousButton = document.querySelector("#preview-previous");
const replayButton = document.querySelector("#preview-play");
const nextButton = document.querySelector("#preview-next");
const timeline = document.querySelector("#preview-timeline");
const status = document.querySelector("#preview-status");
const previewIntro = document.querySelector("#preview-intro");

const ROLE_NAMES = {
  mafia: "마피아",
  cop: "경찰",
  doctor: "의사",
  citizen: "시민",
};

const ROLE_INFO = {
  mafia: {
    name: "마피아",
    description: "밤마다 동료와 공격할 사람을 선택합니다.",
  },
  cop: {
    name: "경찰",
    description: "밤마다 한 명을 조사해 마피아인지 확인합니다.",
  },
  citizen: {
    name: "시민",
    description: "토론과 투표로 숨어 있는 마피아를 찾아냅니다.",
  },
  doctor: {
    name: "의사",
    description: "밤마다 한 명을 마피아의 공격으로부터 보호합니다.",
  },
};

const ROLE_VIEWERS = {
  mafia: "mafia-2",
  cop: "cop",
  citizen: "host",
  doctor: "doctor",
};

const NIGHT_ACTIONS = {
  mafia: "공격",
  cop: "조사",
  citizen: "대기",
  doctor: "보호",
};

let previewRole = roleSelect.value;

const PLAYER_DEFINITIONS = [
  { id: "host", name: "현진", role: "citizen", isHost: true },
  { id: "cop", name: "지수", role: "cop" },
  { id: "doctor", name: "민서", role: "doctor" },
  { id: "mafia-1", name: "용혁", role: "mafia" },
  { id: "mafia-2", name: "도윤", role: "mafia" },
  { id: "citizen-2", name: "서연", role: "citizen" },
];

const metric = (key, score, max, earned, possible) => ({
  key,
  score,
  max,
  earned,
  possible,
});

const FINAL_ANALYSIS = {
  rounds: 3,
  participantCount: 6,
  dayExiles: 2,
  nightVictims: 1,
  mvpIds: ["cop"],
  players: [
    {
      id: "cop",
      name: "지수",
      role: "cop",
      team: "citizen",
      alive: true,
      score: 94,
      metrics: [
        metric("investigation-success", 45, 45, 2, 2),
        metric("mafia-vote-hit", 10, 10, 2, 2),
        metric("mafia-exile-contribution", 15, 15, 2, 2),
        metric("survival", 9, 15, 3, 4),
        metric("team-win", 15, 15, 1, 1),
      ],
    },
    {
      id: "host",
      name: "현진",
      role: "citizen",
      team: "citizen",
      alive: true,
      score: 81,
      metrics: [
        metric("mafia-vote-hit", 45, 45, 2, 2),
        metric("mafia-exile-contribution", 15, 25, 1, 2),
        metric("survival", 6, 15, 2, 4),
        metric("team-win", 15, 15, 1, 1),
      ],
    },
    {
      id: "doctor",
      name: "민서",
      role: "doctor",
      team: "citizen",
      alive: true,
      score: 74,
      metrics: [
        metric("attack-prevention", 25, 25, 1, 1),
        metric("rescue-maintained", 10, 10, 1, 1),
        metric("mafia-vote-hit", 10, 20, 1, 2),
        metric("mafia-exile-contribution", 7.5, 15, 1, 2),
        metric("survival", 6.5, 15, 2, 4),
        metric("team-win", 15, 15, 1, 1),
      ],
    },
    {
      id: "mafia-1",
      name: "용혁",
      role: "mafia",
      team: "mafia",
      alive: false,
      score: 68,
      metrics: [
        metric("night-attack-success", 45, 45, 1, 1),
        metric("citizen-exile-contribution", 12.5, 25, 1, 2),
        metric("survival", 10.5, 15, 2, 3),
        metric("team-win", 0, 15, 0, 1),
      ],
    },
    {
      id: "citizen-2",
      name: "서연",
      role: "citizen",
      team: "citizen",
      alive: false,
      score: 52.5,
      metrics: [
        metric("mafia-vote-hit", 22.5, 45, 1, 2),
        metric("mafia-exile-contribution", 12.5, 25, 1, 2),
        metric("survival", 2.5, 15, 1, 3),
        metric("team-win", 15, 15, 1, 1),
      ],
    },
    {
      id: "mafia-2",
      name: "도윤",
      role: "mafia",
      team: "mafia",
      alive: false,
      score: 45,
      metrics: [
        metric("night-attack-success", 30, 45, 1, 2),
        metric("citizen-exile-contribution", 7.5, 25, 1, 3),
        metric("survival", 7.5, 15, 2, 3),
        metric("team-win", 0, 15, 0, 1),
      ],
    },
  ],
};

function players({
  eliminated = [],
  ready = [],
  dayReady = [],
  resultReady = [],
} = {}) {
  const viewerId = ROLE_VIEWERS[previewRole];
  return PLAYER_DEFINITIONS.map((player) => ({
    ...player,
    isHost: player.id === viewerId,
    alive: !eliminated.includes(player.id),
    connected: true,
    ready: ready.includes(player.id),
    dayReady: dayReady.includes(player.id),
    resultReady: resultReady.includes(player.id),
  }));
}

function targets(phase, eliminated = []) {
  const viewerId = ROLE_VIEWERS[previewRole];
  return PLAYER_DEFINITIONS.filter((player) => {
    if (player.id === viewerId || eliminated.includes(player.id)) return false;
    if (phase === "night" && previewRole === "mafia")
      return player.role !== "mafia";
    return true;
  }).map(({ id, name }) => ({ id, name }));
}

function nightSelection(round) {
  return {
    mafia: round === 1 ? "host" : "citizen-2",
    cop: round === 1 ? "mafia-1" : "mafia-2",
    citizen: null,
    doctor: "host",
  }[previewRole];
}

function voteSelection(round) {
  if (previewRole === "mafia") return round === 2 ? "citizen-2" : "host";
  return round === 2 ? "mafia-1" : "mafia-2";
}

function baseState({
  phase,
  round = 1,
  eliminated = [],
  playerState = {},
  playerFlags = {},
  announcement = "",
  openingDay = false,
} = {}) {
  const viewerId = ROLE_VIEWERS[previewRole];
  const viewer = PLAYER_DEFINITIONS.find((player) => player.id === viewerId);
  const selectedTargetId =
    playerState.selectedTargetId ??
    (phase === "night" ? nightSelection(round) : null);
  const mafiaTeam =
    previewRole === "mafia"
      ? PLAYER_DEFINITIONS.filter(
          (player) =>
            player.role === "mafia" &&
            player.id !== viewerId &&
            !eliminated.includes(player.id),
        ).map((player) => player.name)
      : [];
  const mafiaSelections =
    phase === "night" && previewRole === "mafia"
      ? PLAYER_DEFINITIONS.filter(
          (player) =>
            player.role === "mafia" && !eliminated.includes(player.id),
        ).map((player) => ({
          playerName: player.name,
          targetName: PLAYER_DEFINITIONS.find(
            (target) => target.id === selectedTargetId,
          )?.name,
          confirmed: player.id !== viewerId,
          isSelf: player.id === viewerId,
        }))
      : [];
  return {
    code: "SIM1",
    phase,
    round,
    openingDay,
    winner: null,
    announcement,
    joinUrl: `${location.origin}/play/?room=SIM1`,
    qrDataUrl: "/api/rooms/SIM1/qr",
    settings: { copEnabled: true, doctorEnabled: true },
    roleSummary: { mafia: 2, cop: 1, doctor: 1, citizen: 2 },
    players: players({ eliminated, ...playerFlags }),
    targets: targets(phase, eliminated),
    dayResult: null,
    nightResult: null,
    dayReadyCount: 0,
    dayReadyRequiredCount: 0,
    resultReadyCount: 0,
    resultReadyRequiredCount: 0,
    submittedCount: 0,
    requiredCount: 0,
    you: {
      id: viewerId,
      name: viewer.name,
      role: previewRole,
      roleInfo: ROLE_INFO[previewRole],
      isHost: true,
      alive: !eliminated.includes(viewerId),
      ready: false,
      dayReady: false,
      resultReady: false,
      actionSubmitted: false,
      privateNotice: "",
      ...playerState,
      selectedTargetId,
      mafiaTeam,
      mafiaSelections,
      investigation:
        previewRole === "cop" ? playerState.investigation || null : null,
    },
  };
}

const STAGES = [
  {
    id: "lobby",
    label: "대기실",
    description: "6명이 모였고 방장이 역할 구성을 확인한 상태입니다.",
    makeState() {
      const state = baseState({ phase: "lobby" });
      state.you = {
        ...state.you,
        role: null,
        roleInfo: null,
        isHost: true,
      };
      return state;
    },
  },
  {
    id: "reveal-hidden",
    label: "역할 확인 전",
    description: "다른 참가자에게 보이지 않도록 화면을 가린 상태입니다.",
    roleRevealed: false,
    makeState: () => baseState({ phase: "reveal" }),
  },
  {
    id: "reveal-cop",
    label: "경찰 역할 공개",
    description: "경찰 역할과 능력을 본인에게만 공개합니다.",
    roleRevealed: true,
    roleReveal: true,
    makeState: () =>
      baseState({
        phase: "reveal",
        playerFlags: { ready: ["host", "doctor", "mafia-1", "mafia-2"] },
      }),
  },
  {
    id: "opening-day",
    label: "첫날 낮",
    description: "첫날은 투표 없이 전원이 준비하면 첫 번째 밤으로 넘어갑니다.",
    makeState() {
      const state = baseState({
        phase: "day",
        openingDay: true,
        playerFlags: { dayReady: ["host", "doctor", "mafia-1"] },
      });
      state.dayReadyCount = 3;
      state.dayReadyRequiredCount = 6;
      return state;
    },
  },
  {
    id: "night-one",
    label: "첫째 밤 · 조사",
    description: "경찰이 용혁을 선택했습니다. 확정 전까지 대상을 바꿀 수 있습니다.",
    makeState: () =>
      baseState({
        phase: "night",
        playerState: { selectedTargetId: nightSelection(1) },
      }),
  },
  {
    id: "night-result-safe",
    label: "첫째 밤 결과",
    description: "의사가 공격을 막았고 경찰은 첫 번째 마피아를 찾았습니다.",
    resultScene: true,
    makeState() {
      const state = baseState({
        phase: "result-night",
        playerState: {
          investigation: { targetName: "용혁", isMafia: true },
        },
        playerFlags: { resultReady: ["host"] },
      });
      state.nightResult = { status: "safe", role: null };
      state.resultReadyCount = 1;
      state.resultReadyRequiredCount = 6;
      return state;
    },
  },
  {
    id: "day-two",
    label: "둘째 날 토론",
    description: "지난밤 결과와 경찰의 비공개 조사 결과를 함께 확인합니다.",
    makeState() {
      const state = baseState({
        phase: "day",
        round: 2,
        announcement: "지난밤에는 아무도 사라지지 않았습니다.",
        playerState: {
          investigation: { targetName: "용혁", isMafia: true },
        },
        playerFlags: { dayReady: ["host", "doctor"] },
      });
      state.dayReadyCount = 2;
      state.dayReadyRequiredCount = 6;
      return state;
    },
  },
  {
    id: "vote-one",
    label: "둘째 날 투표",
    description: "의심 대상을 고른 뒤 별도의 확정 버튼으로 투표합니다.",
    makeState() {
      const state = baseState({
        phase: "vote",
        round: 2,
        announcement: "토론이 끝났습니다. 각자 의심되는 사람을 선택하세요.",
        playerState: { selectedTargetId: voteSelection(2) },
      });
      state.submittedCount = 2;
      state.requiredCount = 6;
      return state;
    },
  },
  {
    id: "day-result-one",
    label: "둘째 날 결과",
    description: "용혁이 과반수 표를 받아 첫 번째 마피아로 밝혀졌습니다.",
    resultScene: true,
    makeState() {
      const eliminated = ["mafia-1"];
      const state = baseState({
        phase: "result-day",
        round: 2,
        eliminated,
        playerFlags: { resultReady: ["host"] },
      });
      state.dayResult = {
        status: "mafia-caught",
        playerId: "mafia-1",
        playerName: "용혁",
        role: "mafia",
        roleName: "마피아",
        reason: "majority",
        topVotes: 4,
        requiredVotes: 4,
      };
      state.resultReadyCount = 1;
      state.resultReadyRequiredCount = 5;
      return state;
    },
  },
  {
    id: "night-two",
    label: "둘째 밤 · 조사",
    description: "남은 생존자 중 도윤을 조사 대상으로 선택했습니다.",
    makeState: () =>
      baseState({
        phase: "night",
        round: 2,
        eliminated: ["mafia-1"],
        announcement: "용혁 님은 마피아였습니다.",
        playerState: {
          selectedTargetId: nightSelection(2),
          investigation: { targetName: "용혁", isMafia: true },
        },
      }),
  },
  {
    id: "night-result-victim",
    label: "둘째 밤 결과",
    description: "서연이 희생되었지만 경찰은 남은 마피아를 확인했습니다.",
    resultScene: true,
    makeState() {
      const eliminated = ["mafia-1", "citizen-2"];
      const state = baseState({
        phase: "result-night",
        round: 2,
        eliminated,
        playerState: {
          investigation: { targetName: "도윤", isMafia: true },
        },
        playerFlags: { resultReady: ["host"] },
      });
      state.nightResult = {
        status: "night-victim",
        playerId: "citizen-2",
        playerName: "서연",
        role: "citizen",
        roleName: "시민",
      };
      state.resultReadyCount = 1;
      state.resultReadyRequiredCount = 4;
      return state;
    },
  },
  {
    id: "day-three",
    label: "셋째 날 토론",
    description: "마지막 마피아를 찾기 위한 토론과 투표 준비 단계입니다.",
    makeState() {
      const eliminated = ["mafia-1", "citizen-2"];
      const state = baseState({
        phase: "day",
        round: 3,
        eliminated,
        announcement: "서연 님이 밤사이 희생되었습니다. 정체는 시민이었습니다.",
        playerState: {
          investigation: { targetName: "도윤", isMafia: true },
        },
        playerFlags: { dayReady: ["host", "doctor"] },
      });
      state.dayReadyCount = 2;
      state.dayReadyRequiredCount = 4;
      return state;
    },
  },
  {
    id: "vote-two",
    label: "셋째 날 투표",
    description: "도윤을 선택한 상태이며, 투표 확정 전에는 변경할 수 있습니다.",
    makeState() {
      const state = baseState({
        phase: "vote",
        round: 3,
        eliminated: ["mafia-1", "citizen-2"],
        announcement: "마지막 투표입니다. 신중하게 선택하세요.",
        playerState: { selectedTargetId: voteSelection(3) },
      });
      state.submittedCount = 1;
      state.requiredCount = 4;
      return state;
    },
  },
  {
    id: "day-result-two",
    label: "셋째 날 결과",
    description: "도윤이 마피아로 밝혀지며 시민 팀의 승리가 확정됩니다.",
    resultScene: true,
    finalTransition: true,
    makeState() {
      const eliminated = ["mafia-1", "mafia-2", "citizen-2"];
      const state = baseState({
        phase: "result-day",
        round: 3,
        eliminated,
        playerFlags: { resultReady: ["host"] },
      });
      state.dayResult = {
        status: "mafia-caught",
        playerId: "mafia-2",
        playerName: "도윤",
        role: "mafia",
        roleName: "마피아",
        reason: "majority",
        topVotes: 3,
        requiredVotes: 3,
      };
      state.resultReadyCount = 1;
      state.resultReadyRequiredCount = 3;
      state.winner = "citizen";
      return state;
    },
  },
  {
    id: "end-citizen",
    label: "최종 결과",
    description: "시민 팀 승리와 참가자별 활약 점수를 확인합니다.",
    makeState() {
      const state = baseState({
        phase: "ended",
        round: 3,
        eliminated: ["mafia-1", "mafia-2", "citizen-2"],
      });
      state.winner = "citizen";
      state.analysis = FINAL_ANALYSIS;
      return state;
    },
  },
];

let stageIndex = 0;
let currentState = null;
let renderSequence = 0;
const stageStates = new Map();

function stageLabel(stage) {
  if (stage.id === "reveal-cop")
    return `${ROLE_NAMES[previewRole]} 역할 공개`;
  if (stage.id === "night-one")
    return `첫째 밤 · ${NIGHT_ACTIONS[previewRole]}`;
  if (stage.id === "night-two")
    return `둘째 밤 · ${NIGHT_ACTIONS[previewRole]}`;
  return stage.label;
}

function stageDescription(stage) {
  const roleCopy = {
    "reveal-cop": `${ROLE_NAMES[previewRole]} 역할과 능력을 본인에게만 공개합니다.`,
    "night-one": {
      mafia: "동료의 선택을 보며 현진을 공격 대상으로 선택합니다.",
      cop: "용혁을 조사 대상으로 선택합니다. 확정 전에는 바꿀 수 있습니다.",
      citizen: "시민은 별도 행동 없이 다른 역할의 선택을 기다립니다.",
      doctor: "현진을 보호 대상으로 선택합니다. 확정 전에는 바꿀 수 있습니다.",
    }[previewRole],
    "night-result-safe": {
      mafia: "공격 대상이 보호되어 희생자가 발생하지 않았습니다.",
      cop: "의사가 공격을 막았고 첫 번째 마피아를 찾았습니다.",
      citizen: "아무도 희생되지 않은 첫째 밤 결과를 확인합니다.",
      doctor: "선택한 보호 대상이 공격을 받아 구조에 성공했습니다.",
    }[previewRole],
    "day-two":
      previewRole === "cop"
        ? "지난밤 결과와 본인에게만 보이는 조사 결과를 함께 확인합니다."
        : "지난밤 결과를 확인하고 둘째 날 토론을 준비합니다.",
    "night-two": {
      mafia: "동료와 같은 시민을 공격 대상으로 선택합니다.",
      cop: "남은 마피아인 도윤을 조사 대상으로 선택합니다.",
      citizen: "시민은 별도 행동 없이 둘째 밤의 결과를 기다립니다.",
      doctor: "현진을 보호 대상으로 선택합니다.",
    }[previewRole],
    "night-result-victim":
      previewRole === "cop"
        ? "서연이 희생되었지만 남은 마피아를 조사로 확인했습니다."
        : "서연이 밤의 희생자가 된 결과를 확인합니다.",
  }[stage.id];
  return roleCopy || stage.description;
}

function stateFor(stage) {
  if (!stageStates.has(stage.id)) stageStates.set(stage.id, stage.makeState());
  return stageStates.get(stage.id);
}

function previewQr() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21"><rect width="21" height="21" fill="white"/><g fill="#100e0d"><path d="M1 1h6v6H1zm2 2v2h2V3zM14 1h6v6h-6zm2 2v2h2V3zM1 14h6v6H1zm2 2v2h2v-2z" fill-rule="evenodd"/><path d="M9 1h2v2H9zm3 2h2v2h-2zM8 5h3v2H8zm2 3h2v2h-2zm3 0h2v3h-2zM8 11h3v2H8zm4 1h2v2h-2zm3 2h2v2h-2zm3-5h2v3h-2zm-9 6h3v2H9zm0 3h2v2H9zm4-1h2v3h-2zm4 1h3v2h-3z"/></g></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function rendererFor(screens, phase) {
  return {
    lobby: screens.renderLobby,
    reveal: screens.renderReveal,
    night: screens.renderNight,
    "result-night": screens.renderNightResult,
    day: screens.renderDay,
    vote: screens.renderVote,
    "result-day": screens.renderDayResult,
    ended: screens.renderEnded,
  }[phase];
}

function updateNavigation(stage) {
  const currentLabel = stageLabel(stage);
  previewIntro.textContent = `${ROLE_NAMES[previewRole]} 시점으로 한 게임의 모든 단계를 실제 화면과 같은 렌더러로 확인합니다.`;
  STAGES.forEach((item, index) => {
    const label = stageLabel(item);
    const prefix = String(index + 1).padStart(2, "0");
    stageSelect.options[index].textContent = `${prefix} · ${label}`;
    const timelineButton = timeline.children[index]?.querySelector("button");
    if (timelineButton) {
      timelineButton.title = label;
      timelineButton.setAttribute("aria-label", `${index + 1}단계: ${label}`);
    }
  });
  stageSelect.value = stage.id;
  previousButton.disabled = stageIndex === 0;
  nextButton.disabled = stageIndex === STAGES.length - 1;
  nextButton.textContent =
    stageIndex === STAGES.length - 1 ? "마지막 단계" : "다음 단계 →";
  status.textContent = `${stageIndex + 1} / ${STAGES.length} · ${currentLabel} — ${stageDescription(stage)}`;
  timeline.querySelectorAll("button").forEach((button, index) => {
    if (index === stageIndex) button.setAttribute("aria-current", "step");
    else button.removeAttribute("aria-current");
  });
  timeline.children[stageIndex]?.querySelector("button")?.scrollIntoView({
    behavior: "smooth",
    block: "nearest",
    inline: "nearest",
  });
}

function bindPreviewActions(root) {
  root
    .querySelector('[data-attr-src="qrDataUrl"]')
    ?.setAttribute("src", previewQr());

  root.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      if (currentState.you.actionSubmitted) return;
      currentState.you.selectedTargetId = button.dataset.id;
      const selected = currentState.targets.find(
        (target) => target.id === button.dataset.id,
      );
      const selfSelection = currentState.you.mafiaSelections.find(
        (selection) => selection.isSelf,
      );
      if (selfSelection) {
        selfSelection.targetName = selected?.name || "";
        selfSelection.confirmed = false;
      }
      renderStage({ animate: false });
    });
  });

  for (const selector of [
    "#reveal-role",
    "#start",
    "#ready",
    "#day-ready",
    "#night-confirm",
    "#vote-confirm",
    "#confirm-result-day",
    "#confirm-result-night",
  ]) {
    root
      .querySelector(selector)
      ?.addEventListener("click", () => goTo(stageIndex + 1));
  }

  root.querySelector("#restart")?.addEventListener("click", () => {
    stageStates.clear();
    goTo(0);
  });

  root.querySelector("[data-result-skip]")?.addEventListener("click", () => {
    root.classList.remove("is-revealing");
  });

  root.querySelector("#share")?.addEventListener("click", (event) => {
    const label = event.currentTarget.querySelector("span");
    if (label) label.textContent = "복사 완료";
  });
}

async function renderStage({ animate = true } = {}) {
  const sequence = ++renderSequence;
  const stage = STAGES[stageIndex];
  currentState = stateFor(stage);
  updateNavigation(stage);

  const screens = createScreens({
    getState: () => currentState,
    getRoleRevealed: () => stage.roleRevealed !== false,
    roleName: (role) => ROLE_NAMES[role] || role,
    locale: "ko",
  });
  const renderer = rendererFor(screens, currentState.phase);

  try {
    const root = renderer();
    if (sequence !== renderSequence) return;
    root.dataset.previewStage = stage.id;
    if (animate && !stage.resultScene) root.classList.add("screen-enter");
    if (stage.roleReveal) root.classList.add("role-reveal-enter");
    if (stage.resultScene && animate) root.classList.add("is-revealing");
    if (stage.finalTransition) {
      let finalButton = root.querySelector("#confirm-result-day");
      if (!finalButton) {
        finalButton = document.createElement("button");
        finalButton.id = "confirm-result-day";
        finalButton.className = "button primary result-confirm";
        const note = root.querySelector(".privacy-note, .waiting-copy");
        root.insertBefore(finalButton, note);
      }
      finalButton.hidden = false;
      finalButton.disabled = false;
      finalButton.textContent = "최종 결과 보기";
      const progress = root.querySelector(".privacy-note");
      if (progress)
        progress.textContent =
          "승패가 결정되었습니다. 연출을 확인한 뒤 최종 결과를 직접 열어 보세요.";
    }
    container.replaceChildren(root);
    bindPreviewActions(root);
  } catch (error) {
    if (sequence !== renderSequence) return;
    const message = document.createElement("p");
    message.className = "panel";
    message.setAttribute("role", "alert");
    message.textContent = `${error.message} · 개발 서버와 템플릿을 확인하세요.`;
    container.replaceChildren(message);
  }
}

function goTo(nextIndex, options) {
  if (nextIndex < 0 || nextIndex >= STAGES.length) return;
  stageIndex = nextIndex;
  renderStage(options);
}

for (const [index, stage] of STAGES.entries()) {
  const option = document.createElement("option");
  option.value = stage.id;
  option.textContent = `${String(index + 1).padStart(2, "0")} · ${stage.label}`;
  stageSelect.append(option);

  const item = document.createElement("li");
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = String(index + 1).padStart(2, "0");
  button.title = stage.label;
  button.setAttribute("aria-label", `${index + 1}단계: ${stage.label}`);
  button.addEventListener("click", () => goTo(index));
  item.append(button);
  timeline.append(item);
}

stageSelect.addEventListener("change", () => {
  goTo(STAGES.findIndex((stage) => stage.id === stageSelect.value));
});
roleSelect.addEventListener("change", () => {
  previewRole = roleSelect.value;
  stageStates.clear();
  renderStage({ animate: false });
});
previousButton.addEventListener("click", () => goTo(stageIndex - 1));
nextButton.addEventListener("click", () => goTo(stageIndex + 1));
replayButton.addEventListener("click", () => renderStage());

await loadTemplates();
renderStage();
