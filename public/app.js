import { loadTemplates, view, visible } from "./js/templates.js";
import { createScreens } from "./js/screens.js";
import {
  locale,
  localePreference,
  localize,
  setLocalePreference,
  tr,
} from "./js/i18n.js";

// ============================================================
// 1. 상수 및 상태
// ============================================================

const app = document.querySelector("#app");
const toast = document.querySelector("#toast");

const STORAGE_KEY = "midnight-mafia-session";
const PLAY_ROUTES = {
  entry: "/play/",
  lobby: "/play/lobby/",
  game: "/play/game/",
};

const phaseLabels = {
  lobby: "대기실",
  reveal: "역할 확인",
  night: "밤",
  "result-night": "밤 결과",
  day: "낮",
  vote: "투표",
  "result-day": "낮 결과",
  ended: "게임 종료",
};

const roleLabels = {
  mafia: "마피아",
  cop: "경찰",
  doctor: "의사",
  citizen: "시민",
};

let session = readSession();
let state = null;
let socket = null;
let reconnectTimer = null;
let reconnectDelay = 1000;

let roleRevealed = false;
let roleVisible = false;
let busy = false;
let resultAnimation = {
  key: "",
  endAt: 0,
  complete: false,
  autoAdvanceSent: false,
  timer: null,
};
let renderedViewKey = "";
let roleRevealAnimationPending = false;

// ============================================================
// 2. 공통 유틸
// ============================================================

function invitedRoomCode() {
  return (
    new URLSearchParams(location.search)
      .get("room")
      ?.trim()
      .toUpperCase()
      .slice(0, 4) || ""
  );
}

function requestedLandingMode() {
  if (invitedRoomCode()) return "join";
  const mode = new URLSearchParams(location.search).get("mode");
  return ["create", "join"].includes(mode) ? mode : "start";
}

function playRouteUrl(path, code = "") {
  const url = new URL(path, location.origin);
  const language = new URLSearchParams(location.search).get("lang");

  if (code) url.searchParams.set("room", code);
  if (language === "ko" || language === "en") {
    url.searchParams.set("lang", language);
  }

  return url;
}

function navigateToPlayRoute(path, code = "") {
  const target = playRouteUrl(path, code);

  if (location.pathname === target.pathname && location.search === target.search) {
    return false;
  }

  location.replace(target.href);
  return true;
}

function stateRoute() {
  return state?.phase === "lobby" ? PLAY_ROUTES.lobby : PLAY_ROUTES.game;
}

function syncStateRoute() {
  return state ? navigateToPlayRoute(stateRoute(), state.code) : false;
}

function resetEntryRoute(code = "") {
  const target = playRouteUrl(PLAY_ROUTES.entry, code);
  history.replaceState(null, "", `${target.pathname}${target.search}`);
}

function readSession() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

function saveSession(next) {
  session = next;

  if (next) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function roleName(role) {
  return roleLabels[role] || role;
}

function canShowMyRole() {
  return (
    !!state?.you?.role &&
    state.phase !== "lobby" &&
    (state.phase !== "reveal" || roleRevealed)
  );
}

function resetRoleVisibility() {
  roleRevealed = false;
  roleVisible = false;
}

function showToast(message, kind = "error") {
  toast.textContent = tr(message);
  toast.dataset.kind = kind;
  toast.classList.add("show");

  clearTimeout(showToast.timer);

  showToast.timer = setTimeout(() => {
    toast.classList.remove("show");
  }, 3200);
}

async function run(task) {
  if (busy) return;

  busy = true;
  document.body.classList.add("busy");

  try {
    await task();
  } catch (error) {
    showToast(error.message);
  } finally {
    busy = false;
    document.body.classList.remove("busy");
  }
}

// ============================================================
// 3. 화면 렌더러 초기화
// ============================================================

const screens = createScreens({
  getState: () => state,
  getRoleRevealed: () => roleRevealed,
  roleName,
  locale,
});

// ============================================================
// 4. API 통신
// ============================================================

async function api(path, options = {}) {
  const headers = {
    "content-type": "application/json",
    ...(options.headers || {}),
  };

  if (session) {
    headers["x-player-id"] = session.playerId;
    headers["x-player-token"] = session.token;
  }

  const response = await fetch(path, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(tr(data.error || "요청을 처리하지 못했습니다."));
  }

  return data;
}

function sendAction(action) {
  return run(async () => {
    const data = await api(`/api/rooms/${session.code}/action`, {
      method: "POST",
      body: JSON.stringify(action),
    });

    state = data.state;
    if (syncStateRoute()) return;
    renderGame();
  });
}

// ============================================================
// 5. WebSocket 연결
// ============================================================

function connect() {
  if (!session) return;

  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  socket?.close(1000, "Replaced");

  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const currentSocket = new WebSocket(
    `${protocol}//${location.host}/api/rooms/${session.code}/ws`,
  );
  socket = currentSocket;

  currentSocket.addEventListener("open", () => {
    if (socket !== currentSocket || !session) return;
    reconnectDelay = 1000;
    currentSocket.send(
      JSON.stringify({
        type: "authenticate",
        room: session.code,
        playerId: session.playerId,
        token: session.token,
      }),
    );
  });

  currentSocket.addEventListener("message", (event) => {
    if (socket !== currentSocket) return;
    const message = JSON.parse(event.data);

    if (message.type !== "state") return;

    const phaseChanged = state && state.phase !== message.state.phase;

    state = message.state;

    if (phaseChanged) {
      resetRoleVisibility();
    }

    if (syncStateRoute()) return;
    renderGame();
  });

  currentSocket.addEventListener("close", (event) => {
    if (socket !== currentSocket) return;
    socket = null;
    if (!session || event.code === 1000) return;

    if (event.code === 1008) {
      saveSession(null);
      state = null;
      resetRoleVisibility();

      if (location.pathname !== PLAY_ROUTES.entry) {
        navigateToPlayRoute(PLAY_ROUTES.entry, invitedRoomCode());
        return;
      }

      renderLanding("참가 정보가 만료되었습니다. 다시 입장해 주세요.");
      return;
    }

    const delay = reconnectDelay + Math.floor(Math.random() * 350);
    reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (session) connect();
    }, delay);
  });
}

function resumeConnection() {
  if (!session || document.visibilityState === "hidden") return;
  connect();
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") resumeConnection();
});
window.addEventListener("pageshow", resumeConnection);
window.addEventListener("online", resumeConnection);

async function restoreSession() {
  try {
    const data = await api(`/api/rooms/${session.code}/state`);

    state = data.state;
    resetRoleVisibility();

    if (syncStateRoute()) return;
    renderGame();
    connect();
  } catch (error) {
    console.error("세션 복원 실패:", error);

    saveSession(null);
    state = null;
    resetRoleVisibility();

    if (location.pathname !== PLAY_ROUTES.entry) {
      navigateToPlayRoute(PLAY_ROUTES.entry, invitedRoomCode());
      return;
    }

    renderLanding("이전 참가 정보를 복원할 수 없습니다.");
  }
}

// ============================================================
// 6. 초대 링크 복사
// ============================================================

async function copyInviteLink() {
  const inviteUrl = playRouteUrl(PLAY_ROUTES.entry, state.code);
  inviteUrl.searchParams.set("lang", locale);

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(inviteUrl.href);
      return true;
    } catch {
      // 로컬 HTTP 환경에서는 Clipboard API가 제한될 수 있음
    }
  }

  const input = document.querySelector("#invite-link");

  if (!input) return false;

  input.value = inviteUrl.href;

  input.focus();
  input.select();
  input.setSelectionRange(0, input.value.length);

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  }
}

async function copyInvite() {
  if (await copyInviteLink()) {
    showToast("초대 링크를 복사했습니다.", "success");
  } else {
    showToast("주소가 선택됐습니다. 길게 눌러 복사해 주세요.");
  }
}

// ============================================================
// 7. 공통 화면 요소
// ============================================================

function brandHeader() {
  const header = view("header", {
    code: state?.code || "",
  });

  visible(header, "room", !!state);

  return header.outerHTML;
}

function siteFooter() {
  const prefix = locale === "en" ? "/en" : "";

  const signature =
    locale === "en"
      ? "Midnight Mafia\n© 2026 FLEEX"
      : "심야 마피아\n© 2026 FLEEX";

  const footer = view("footer", {
    signature,
  });

  footer.querySelectorAll("[data-page]").forEach((link) => {
    link.href = `${prefix}/${link.dataset.page}.html`;
  });

  const selector = footer.querySelector("#language-select");

  if (selector) {
    const languageLabels =
      locale === "en"
        ? {
            auto: "System",
            ko: "한국어",
            en: "English",
            aria: "Language",
          }
        : {
            auto: "자동",
            ko: "한국어",
            en: "English",
            aria: "언어",
          };

    selector.setAttribute("aria-label", languageLabels.aria);

    for (const option of selector.options) {
      option.textContent = languageLabels[option.value];
    }

    selector.value = localePreference;
  }

  return footer.outerHTML;
}

function bindLanguageSelector() {
  document
    .querySelector("#language-select")
    ?.addEventListener("change", (event) => {
      setLocalePreference(event.target.value);
    });
}

// ============================================================
// 8. 게임 상태 패널
// ============================================================

function gameStatusPanel() {
  const panel = document.createElement("section");
  panel.className = "game-status";

  const phase = state.phase;
  const round = state.round || 1;

  // 진행 상태
  const progress = document.createElement("div");
  progress.className = "game-status-item";

  const progressLabel = document.createElement("span");
  progressLabel.className = "game-status-label";
  progressLabel.textContent = "진행 상태";

  const progressValue = document.createElement("strong");
  progressValue.textContent = phaseLabels[phase] || phase;

  const roundText = document.createElement("small");

  if (phase === "lobby") {
    roundText.textContent = "게임 시작 전";
  } else if (phase === "ended") {
    roundText.textContent = "게임 종료";
  } else {
    roundText.textContent = `${round}라운드`;
  }

  progress.append(progressLabel, progressValue, roundText);

  panel.appendChild(progress);

  // 내 역할
  if (canShowMyRole()) {
    const role = document.createElement("div");
    role.className = "game-status-item";

    const roleLabel = document.createElement("span");
    roleLabel.className = "game-status-label";
    roleLabel.textContent = "내 역할 · 비공개";

    const roleButton = document.createElement("button");
    roleButton.type = "button";
    roleButton.id = "status-role-toggle";
    roleButton.className = "status-role-toggle";

    roleButton.textContent = roleVisible
      ? `${roleName(state.you.role)} · 감추기`
      : "내 역할 보기";

    const life = document.createElement("small");
    life.textContent = state.you.alive ? "생존" : "사망";

    role.append(roleLabel, roleButton, life);

    panel.appendChild(role);
  }

  return panel;
}

function setupResultAnimation(content) {
  if (!content.matches("[data-result-scene]")) return;

  const result = state.dayResult || state.nightResult || {};
  const key = [
    state.code,
    state.phase,
    state.round,
    result.playerId || result.reason || "none",
  ].join(":");
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const duration = 4100;

  if (resultAnimation.key !== key) {
    clearTimeout(resultAnimation.timer);
    resultAnimation = {
      key,
      endAt: Date.now() + duration,
      complete: reduceMotion,
      autoAdvanceSent: false,
      timer: null,
    };
  }

  const confirmButton = content.querySelector(".result-confirm");
  const skipButton = content.querySelector("[data-result-skip]");

  const finish = () => {
    if (resultAnimation.key !== key) return;
    clearTimeout(resultAnimation.timer);
    resultAnimation.complete = true;
    content.classList.remove("is-revealing");
    skipButton?.setAttribute("hidden", "");
    if (confirmButton) confirmButton.disabled = Boolean(state.you.resultReady);
    if (
      state.winner &&
      !resultAnimation.autoAdvanceSent &&
      ["result-day", "result-night"].includes(state.phase)
    ) {
      resultAnimation.autoAdvanceSent = true;
      sendAction({
        type:
          state.phase === "result-day"
            ? "confirm-result-day"
            : "confirm-result-night",
      });
    }
  };

  const remaining = resultAnimation.endAt - Date.now();
  if (resultAnimation.complete || remaining <= 0) {
    finish();
    return;
  }

  content.classList.add("is-revealing");
  if (confirmButton) confirmButton.disabled = true;
  skipButton?.addEventListener("click", finish);
  resultAnimation.timer = setTimeout(finish, remaining);
}

// ============================================================
// 9. 랜딩 화면
// ============================================================

function renderLanding(note = "", mode = requestedLandingMode()) {
  state = null;
  resetRoleVisibility();

  const presetRoom = invitedRoomCode();

  const templateName = {
    start: "landing-start",
    create: "landing-create",
    join: "landing-join",
  }[mode];

  if (!templateName) {
    throw new Error(`알 수 없는 랜딩 화면: ${mode}`);
  }

  const panel = view(templateName, { note });

  const viewKey = `landing:${mode}`;
  if (renderedViewKey !== viewKey) panel.classList.add("screen-enter");
  renderedViewKey = viewKey;

  app.replaceChildren();

  app.insertAdjacentHTML("beforeend", brandHeader());

  app.appendChild(panel);

  app.insertAdjacentHTML(
    "beforeend",
    `<p class="footer-note">
      인터넷에 연결된 휴대폰에서 초대 링크를 열어 참가할 수 있습니다.
    </p>${siteFooter()}`,
  );

  localize(app);
  bindLanguageSelector();

  // 첫 선택 화면
  if (mode === "start") {
    panel.querySelector("#go-create")?.addEventListener("click", () => {
      renderLanding("", "create");
    });

    panel.querySelector("#go-join")?.addEventListener("click", () => {
      renderLanding("", "join");
    });

    return;
  }

  const nameInput = panel.querySelector("#name");
  const roomInput = panel.querySelector("#room");

  // 돌아가기
  panel.querySelector("#back")?.addEventListener("click", () => {
    resetEntryRoute();
    renderLanding("", "start");
  });

  // 새 게임 만들기
  if (mode === "create") {
    const createGame = () =>
      run(async () => {
        const name = nameInput.value.trim();

        if (!name) {
          showToast("먼저 이름을 입력해 주세요.");
          nameInput.focus();
          return;
        }

        const data = await api("/api/rooms", {
          method: "POST",
          body: JSON.stringify({ name }),
        });

        saveSession(data.session);
        state = data.state;

        navigateToPlayRoute(PLAY_ROUTES.lobby, state.code);
      });

    panel.querySelector("#create")?.addEventListener("click", createGame);

    nameInput?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        createGame();
      }
    });

    return;
  }

  // 방 참가하기
  if (mode === "join") {
    const clearRoomButton = panel.querySelector("#clear-room");

    roomInput.value = presetRoom;
    roomInput.readOnly = !!presetRoom;

    function updateRoomInput() {
      roomInput.value = roomInput.value
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 4);

      if (clearRoomButton) {
        clearRoomButton.hidden = !roomInput.value;
      }
    }

    updateRoomInput();

    roomInput.addEventListener("input", updateRoomInput);

    // 방 코드 X 버튼
    clearRoomButton?.addEventListener("click", () => {
      const url = new URL(location.href);
      url.searchParams.delete("room");

      history.replaceState(null, "", url.pathname + url.search + url.hash);

      roomInput.readOnly = false;
      roomInput.value = "";

      updateRoomInput();
      roomInput.focus();
    });

    const joinGame = () =>
      run(async () => {
        const code = roomInput.value.trim().toUpperCase();

        const name = nameInput.value.trim();

        if (code.length !== 4) {
          showToast("네 자리 방 코드를 입력해 주세요.");
          roomInput.focus();
          return;
        }

        if (!name) {
          showToast("먼저 이름을 입력해 주세요.");
          nameInput.focus();
          return;
        }

        const data = await api(`/api/rooms/${code}/join`, {
          method: "POST",
          body: JSON.stringify({ name }),
        });

        saveSession(data.session);
        state = data.state;

        navigateToPlayRoute(PLAY_ROUTES.lobby, state.code);
      });

    panel.querySelector("#join")?.addEventListener("click", joinGame);

    for (const input of [roomInput, nameInput]) {
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          joinGame();
        }
      });
    }
  }
}

// ============================================================
// 10. 게임 화면
// ============================================================

function renderGame() {
  if (!state) {
    renderLanding();
    return;
  }

  const renderer = {
    lobby: screens.renderLobby,
    reveal: screens.renderReveal,
    night: screens.renderNight,
    "result-night": screens.renderNightResult,
    day: screens.renderDay,
    vote: screens.renderVote,
    "result-day": screens.renderDayResult,
    ended: screens.renderEnded,
  }[state.phase];

  if (!renderer) {
    throw new Error(`알 수 없는 게임 단계: ${state.phase}`);
  }

  const content = renderer();
  const viewKey = `game:${state.code}:${state.phase}:${state.round || 0}`;
  if (
    renderedViewKey !== viewKey &&
    !content.matches("[data-result-scene]")
  ) {
    content.classList.add("screen-enter");
  }
  if (roleRevealAnimationPending && state.phase === "reveal") {
    content.classList.add("role-reveal-enter");
    roleRevealAnimationPending = false;
  }
  renderedViewKey = viewKey;
  setupResultAnimation(content);

  app.replaceChildren();

  // 헤더: 방 코드
  app.insertAdjacentHTML("beforeend", brandHeader());

  // 게임 진행 상태 및 내 역할
  app.appendChild(gameStatusPanel());

  // 현재 게임 화면
  app.appendChild(content);

  // 나가기 버튼 및 푸터
  app.insertAdjacentHTML(
    "beforeend",
    `<button id="leave" class="link-button">
      게임에서 나가기
    </button>${siteFooter()}`,
  );

  localize(app);
  bindGameEvents();
}

// ============================================================
// 11. 게임 이벤트
// ============================================================

function bindGameEvents() {
  bindLanguageSelector();

  // 내 역할 보기 / 감추기
  document
    .querySelector("#status-role-toggle")
    ?.addEventListener("click", () => {
      roleVisible = !roleVisible;
      renderGame();
    });

  // 게임에서 나가기
  document.querySelector("#leave")?.addEventListener("click", () => {
    if (
      !confirm(
        tr(
          "이 기기에서 게임을 나갈까요? 진행 중인 방에서는 다시 들어올 수 없습니다.",
        ),
      )
    ) {
      return;
    }

    run(async () => {
      try {
        await api(`/api/rooms/${session.code}/leave`, { method: "POST" });
      } finally {
        socket?.close(1000);
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
        saveSession(null);
        state = null;
        resetRoleVisibility();
        location.replace(locale === "en" ? "/en/" : "/");
      }
    });
  });

  // 초대 링크 복사
  document.querySelector("#share")?.addEventListener("click", copyInvite);

  // 경찰 / 의사 사용 설정
  const copSetting = document.querySelector("#setting-cop");

  const doctorSetting = document.querySelector("#setting-doctor");

  for (const setting of [copSetting, doctorSetting].filter(Boolean)) {
    setting.addEventListener("change", () => {
      sendAction({
        type: "update-settings",
        copEnabled: copSetting?.checked ?? false,
        doctorEnabled: doctorSetting?.checked ?? false,
      });
    });
  }

  // 최초 역할 확인
  document.querySelector("#reveal-role")?.addEventListener("click", () => {
    roleRevealed = true;
    roleRevealAnimationPending = true;
    renderGame();
  });

  // 게임 시작
  document.querySelector("#start")?.addEventListener("click", () => {
    sendAction({ type: "start" });
  });

  // 준비 완료
  document.querySelector("#ready")?.addEventListener("click", () => {
    sendAction({ type: "ready" });
  });

  // 낮 준비 완료 / 취소
  document.querySelector("#day-ready")?.addEventListener("click", () => {
    sendAction({
      type: "set-day-ready",
      ready: !state.you.dayReady,
    });
  });

  // 게임 재시작
  document.querySelector("#restart")?.addEventListener("click", () => {
    sendAction({ type: "restart" });
  });

  // 밤 행동 / 투표 대상 선택
  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      if (["night-select", "vote-select"].includes(button.dataset.action)) {
        sendAction({
          type: button.dataset.action,
          targetId: button.dataset.id,
        });
        return;
      }

      const label = button.querySelector("strong")?.textContent;

      if (!label) return;

      const question =
        locale === "en" ? `Choose ${label}?` : `${label} 님을 선택할까요?`;

      if (!confirm(question)) return;

      sendAction({
        type: button.dataset.action,
        targetId: button.dataset.id,
      });
    });
  });

  document.querySelector("#night-confirm")?.addEventListener("click", () => {
    sendAction({ type: "night-confirm" });
  });

  document.querySelector("#vote-confirm")?.addEventListener("click", () => {
    sendAction({ type: "vote-confirm" });
  });

  document
    .querySelector("#confirm-result-day")
    ?.addEventListener("click", () => {
      sendAction({ type: "confirm-result-day" });
    });

  document
    .querySelector("#confirm-result-night")
    ?.addEventListener("click", () => {
      sendAction({ type: "confirm-result-night" });
    });

  // 참가자 강퇴
  document.querySelectorAll(".kick").forEach((button) => {
    button.addEventListener("click", () => {
      if (!confirm(tr("이 참가자를 방에서 내보낼까요?"))) {
        return;
      }

      sendAction({
        type: "kick",
        targetId: button.dataset.id,
      });
    });
  });
}

// ============================================================
// 12. Web MCP
// ============================================================

function registerWebMcp() {
  const context = document.modelContext;

  if (!context?.registerTool) return;

  Promise.resolve(
    context.registerTool({
      name: "read_mafia_game_state",
      title: locale === "en" ? "Read game state" : "게임 상태 읽기",
      description:
        locale === "en"
          ? "Read the current phase, room code, players, and your status."
          : "현재 마피아 게임의 단계, 방 코드, 참가자와 내 상태를 읽습니다.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: true,
        untrustedContentHint: true,
      },
      execute: async () =>
        state
          ? {
              code: state.code,
              phase: state.phase,
              round: state.round,
              you: {
                name: state.you.name,
                alive: state.you.alive,
                role: state.you.role,
              },
              players: state.players.map(({ name, alive }) => ({
                name,
                alive,
              })),
            }
          : {
              phase: "not_joined",
            },
    }),
  ).catch(() => {});
}

// ============================================================
// 13. 앱 초기 실행
// ============================================================

registerWebMcp();

let templatesReady = false;
try {
  await loadTemplates();
  templatesReady = true;
} catch (error) {
  console.error(error);
  const panel = document.createElement("section");
  panel.className = "panel centered-panel";
  const title = document.createElement("h1");
  title.textContent = tr("화면을 불러오지 못했습니다");
  const description = document.createElement("p");
  description.className = "intro";
  description.textContent = tr("페이지를 새로고침해 주세요.");
  panel.append(title, description);
  app.replaceChildren(panel);
}

if (templatesReady) {
  const invitedRoom = invitedRoomCode();
  const nestedRoute = [PLAY_ROUTES.lobby, PLAY_ROUTES.game].includes(
    location.pathname,
  );

  if (
    nestedRoute &&
    (!invitedRoom || !session || invitedRoom !== session.code)
  ) {
    navigateToPlayRoute(PLAY_ROUTES.entry, invitedRoom);
  } else if (session && (!invitedRoom || invitedRoom === session.code)) {
    restoreSession();
  } else {
    renderLanding(
      session && invitedRoom
        ? "새 방에 참가하면 현재 방의 참가 정보가 이 기기에서 교체됩니다."
        : "",
    );
  }
}
